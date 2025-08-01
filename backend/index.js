const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const Docker = require('dockerode');

// Import utility modules
const redisManager = require('./redis-utils');
const recoveryManager = require('./recovery-utils');

// Initialize Docker client
const docker = new Docker({
  socketPath: '/var/run/docker.sock'
});

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

let mysqlPool = null;

// Initialize Redis connection
redisManager.connect();

const connectToMySQL = () => {
  mysqlPool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'testuser',
    password: process.env.MYSQL_PASSWORD || 'testpass',
    database: process.env.MYSQL_DATABASE || 'testdb',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  console.log('[✔️] MySQL connection pool created');
};

// Initialize Redis connection
redisManager.connect();
connectToMySQL();

// User search API - checks Redis first, then MySQL (supports both name and phone number)
app.get('/user/search/:query', async (req, res) => {
  const { query } = req.params;
  
  try {
    // First, try to get from Redis
    let source = 'MySQL';
    if (redisManager.isConnected()) {
      try {
        const cachedUser = await redisManager.get(`user:${query}`);
        if (cachedUser) {
          source = 'Redis';
          console.log(`[📦] User found in Redis: ${query}`);
          return res.json({
            source: 'Redis',
            user: JSON.parse(cachedUser)
          });
        }
      } catch (redisError) {
        console.error('[❌] Redis error during search:', redisError.message);
      }
    }

    // If not in Redis, check MySQL
    if (mysqlPool) {
      const [rows] = await mysqlPool.execute(
        'SELECT id, name, phone_number, email, created_at FROM users WHERE phone_number = ? OR name LIKE ?',
        [query, `%${query}%`]
      );

      if (rows.length > 0) {
        const user = rows[0];
        
        // Cache in Redis for future requests (360 seconds TTL - 6 minutes)
        if (redisManager.isConnected()) {
          try {
            await redisManager.set(`user:${query}`, JSON.stringify(user), 360);
            console.log(`[💾] User cached in Redis: ${query} (360s TTL - 6 minutes)`);
          } catch (redisError) {
            console.error('[❌] Failed to cache user in Redis:', redisError.message);
          }
        }

        console.log(`[🗄️] User found in MySQL: ${query} (Redis unavailable - fallback to MySQL)`);
        return res.json({
          source: 'MySQL',
          user: user
        });
      }
    }

    res.status(404).json({
      error: 'User not found',
      query: query
    });

  } catch (error) {
    console.error('[❌] Error fetching user:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Get all users with source information
app.get('/users/all', async (req, res) => {
  try {
    const results = [];
    
    if (mysqlPool) {
      const [rows] = await mysqlPool.execute(
        'SELECT id, name, phone_number, email, created_at FROM users ORDER BY created_at DESC'
      );
      
      for (const user of rows) {
        let source = 'MySQL';
        
        // Check if user is cached in Redis
        if (redisManager.isConnected()) {
          try {
            const cachedUser = await redisManager.get(`user:${user.phone_number}`);
            if (cachedUser) {
              source = 'Redis';
            }
          } catch (redisError) {
            console.error('[❌] Redis error during user check:', redisError.message);
          }
        }
        
        results.push({
          ...user,
          source: source
        });
      }
      
      res.json({
        source: 'MySQL',
        users: results,
        total: results.length
      });
    } else {
      res.status(500).json({ error: 'MySQL not connected' });
    }
  } catch (error) {
    console.error('[❌] Error fetching users:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Get all Redis keys with their values
app.get('/redis/keys', async (req, res) => {
  try {
    if (!redisManager.isConnected()) {
      return res.json({
        source: 'Redis',
        keys: [],
        total: 0,
        status: 'Redis not connected'
      });
    }

    // Get all keys matching user:* pattern
    const keys = await redisManager.keys('user:*');
    const keyDetails = [];

    for (const key of keys) {
      try {
        const value = await redisManager.get(key);
        const ttl = await redisManager.ttl(key);
        
        let userData = null;
        try {
          userData = JSON.parse(value);
        } catch (e) {
          userData = { error: 'Invalid JSON' };
        }

        keyDetails.push({
          key: key,
          value: userData,
          ttl: ttl,
          ttlFormatted: ttl > 0 ? `${ttl}s` : 'Expired'
        });
      } catch (error) {
        keyDetails.push({
          key: key,
          value: { error: 'Failed to fetch value' },
          ttl: -1,
          ttlFormatted: 'Error'
        });
      }
    }

    res.json({
      source: 'Redis',
      keys: keyDetails,
      total: keyDetails.length,
      status: 'Connected'
    });

  } catch (error) {
    console.error('[❌] Error fetching Redis keys:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Loop test API - fetch same data multiple times with Redis restart resilience
app.post('/test-loop/:query/:count', async (req, res) => {
  const { query, count } = req.params;
  let loopCount = parseInt(count) || 100;
  
  // Limit the maximum number of iterations to prevent overwhelming the system
  const MAX_ITERATIONS = 10000000000000000000;
  if (loopCount > MAX_ITERATIONS) {
    loopCount = MAX_ITERATIONS;
    console.log(`[⚠️] Requested ${count} iterations, limited to ${MAX_ITERATIONS} for system safety`);
  }
  
  // Check if client wants real-time updates
  const realTime = req.headers.accept && req.headers.accept.includes('text/event-stream');
  
  if (realTime) {
    // Set up SSE headers for real-time updates
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
    
    // Send initial status
    res.write(`data: ${JSON.stringify({
      type: 'start',
      message: `Starting loop test with ${loopCount} iterations`,
      query: query,
      totalIterations: loopCount,
      timestamp: new Date().toISOString()
    })}\n\n`);
  }
  
  try {
    const results = [];
    let redisRestartDetected = false;
    let redisRecoveryTime = null;
    
    for (let i = 0; i < loopCount; i++) {
      try {
        // Send progress update every 100 iterations or at the start
        if (realTime && (i === 0 || i % 100 === 0 || i === loopCount - 1)) {
          const progress = {
            type: 'progress',
            current: i + 1,
            total: loopCount,
            percentage: Math.round(((i + 1) / loopCount) * 100),
            message: `${i + 1} / ${loopCount} iterations completed`,
            timestamp: new Date().toISOString()
          };
          res.write(`data: ${JSON.stringify(progress)}\n\n`);
        }
        
        // First, try to get from Redis
        let source = 'MySQL';
        let user = null;
        let redisStatus = 'disconnected';
        let previousSource = results.length > 0 ? results[results.length - 1].source : null;
        
        // Check Redis connection status
        if (redisManager.isConnected()) {
          redisStatus = 'connected';
          try {
            const cachedUser = await redisManager.get(`user:${query}`);
            if (cachedUser) {
              source = 'Redis';
              user = JSON.parse(cachedUser);
            }
          } catch (redisError) {
            console.log(`[🔄] Redis error in iteration ${i + 1}:`, redisError.message);
            redisStatus = 'error';
            // Continue with MySQL fallback
          }
        } else {
          redisStatus = 'disconnected';
          if (!redisRestartDetected) {
            redisRestartDetected = true;
            console.log(`[🔄] Redis disconnected detected at iteration ${i + 1}`);
          }
        }
        
        // Log source changes
        if (previousSource && previousSource !== source) {
          console.log(`[🔄] Source changed from ${previousSource} to ${source} at iteration ${i + 1}`);
        }

        // If not in Redis, check MySQL
        if (!user && mysqlPool) {
          try {
            const [rows] = await mysqlPool.execute(
              'SELECT id, name, phone_number, email, created_at FROM users WHERE phone_number = ? OR name LIKE ?',
              [query, `%${query}%`]
            );

            if (rows.length > 0) {
              user = rows[0];
              
              // Try to cache in Redis for future requests (360 seconds TTL - 6 minutes)
              if (redisManager.isConnected()) {
                try {
                  await redisManager.set(`user:${query}`, JSON.stringify(user), 360);
                  // If we successfully cached and this was after a restart, mark recovery
                  if (redisRestartDetected && !redisRecoveryTime) {
                    redisRecoveryTime = new Date().toISOString();
                    console.log(`[✅] Redis recovered at iteration ${i + 1}`);
                  }
                } catch (cacheError) {
                  console.log(`[⚠️] Failed to cache in Redis:`, cacheError.message);
                }
              }
            }
          } catch (mysqlError) {
            console.log(`[❌] MySQL error in iteration ${i + 1}:`, mysqlError.message);
          }
        }

        if (user) {
          results.push({
            iteration: i + 1,
            source: source,
            user: user,
            redisStatus: redisStatus,
            timestamp: new Date().toISOString()
          });
        } else {
          results.push({
            iteration: i + 1,
            error: 'User not found',
            redisStatus: redisStatus,
            timestamp: new Date().toISOString()
          });
        }
        
        // Add a small delay to prevent overwhelming the system
        if (i % 10 === 0 && i > 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        
      } catch (error) {
        results.push({
          iteration: i + 1,
          error: error.message,
          redisStatus: 'error',
          timestamp: new Date().toISOString()
        });
      }
    }
    
    // Calculate statistics
    const successfulRequests = results.filter(r => r.user).length;
    const failedRequests = results.filter(r => r.error).length;
    const redisRequests = results.filter(r => r.source === 'Redis').length;
    const mysqlRequests = results.filter(r => r.source === 'MySQL').length;
    
    if (realTime) {
      // Send final results for real-time mode
      const finalResults = {
        type: 'complete',
        query: query,
        totalIterations: loopCount,
        requestedIterations: parseInt(count) || 100,
        maxIterationsLimit: MAX_ITERATIONS,
        successfulRequests: successfulRequests,
        failedRequests: failedRequests,
        redisRequests: redisRequests,
        mysqlRequests: mysqlRequests,
        redisRestartDetected: redisRestartDetected,
        redisRecoveryTime: redisRecoveryTime,
        message: `Loop test completed: ${successfulRequests} successful, ${failedRequests} failed`,
        timestamp: new Date().toISOString()
      };
      res.write(`data: ${JSON.stringify(finalResults)}\n\n`);
      res.end();
    } else {
      // Send JSON response for non-real-time mode
      res.json({
        query: query,
        totalIterations: loopCount,
        requestedIterations: parseInt(count) || 100,
        maxIterationsLimit: MAX_ITERATIONS,
        successfulRequests: successfulRequests,
        failedRequests: failedRequests,
        redisRequests: redisRequests,
        mysqlRequests: mysqlRequests,
        redisRestartDetected: redisRestartDetected,
        redisRecoveryTime: redisRecoveryTime,
        results: results
      });
    }

  } catch (error) {
    console.error('[❌] Error in loop test:', error);
    if (realTime) {
      const errorResponse = {
        type: 'error',
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      };
      res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
      res.end();
    } else {
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }
});

// Get all users from MySQL
app.get('/users', async (req, res) => {
  try {
    if (mysqlPool) {
      const [rows] = await mysqlPool.execute(
        'SELECT id, name, phone_number, email, created_at FROM users ORDER BY created_at DESC'
      );
      
      res.json({
        source: 'MySQL',
        users: rows
      });
    } else {
      res.status(500).json({ error: 'MySQL not connected' });
    }
  } catch (error) {
    console.error('[❌] Error fetching users:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.get('/status', async (req, res) => {
  try {
    // Check if Redis is connected and available
    if (!redisManager.isConnected()) {
      return res.json({ 
        status: 'FAIL', 
        redisStatus: redisManager.getStatus(), 
        error: redisManager.getStatus() === 'Auth Failed' ? 'Authentication failed' : 'Redis not connected',
        connectionAttempts: redisManager.getConnectionAttempts(),
        ...redisManager.getDetailedStatus()
      });
    }

    // Try to set and get heartbeat
    await redisManager.set('heartbeat', '💓');
    const heartbeat = await redisManager.get('heartbeat');
    
    res.json({ 
      status: 'OK', 
      redisStatus: redisManager.getStatus(),
      connectionAttempts: redisManager.getConnectionAttempts(),
      heartbeat: heartbeat,
      ...redisManager.getDetailedStatus()
    });
  } catch (e) {
    res.json({ 
      status: 'FAIL', 
      redisStatus: redisManager.getStatus(), 
      error: e.message,
      connectionAttempts: redisManager.getConnectionAttempts(),
      ...redisManager.getDetailedStatus()
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    service: 'Redis Resilience PoC',
    version: '1.0.0',
    uptime: process.uptime(),
    redisStatus: redisManager.getStatus(),
    connectionAttempts: redisManager.getConnectionAttempts(),
    status: redisManager.getStatus() === 'Connected' ? 'healthy' : 'degraded'
  });
});

// Get detailed retry strategy information
app.get('/retry-info', (req, res) => {
  res.json(redisManager.getRetryInfo());
});

// Get container status using Docker Engine API
app.get('/container-status', async (req, res) => {
  try {
    const containerStatus = await recoveryManager.getContainerStatus();
    res.json(containerStatus);
  } catch (error) {
    console.error('[❌] Error getting container status:', error);
    res.status(500).json({
      error: 'Failed to get container status',
      message: error.message
    });
  }
});

// Get all containers status using Docker Engine API
app.get('/containers/all', async (req, res) => {
  try {
    const allContainers = await recoveryManager.getAllContainersStatus();
    res.json(allContainers);
  } catch (error) {
    console.error('[❌] Error getting all containers:', error);
    res.status(500).json({
      error: 'Failed to get all containers',
      message: error.message
    });
  }
});

// Get Redis container logs using Docker Engine API (batch mode)
app.get('/containers/redis/logs', async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    const redisContainer = containers.find(container => 
      container.Names.some(name => name.includes('redis-resilience-poc-redis'))
    );
    
    if (!redisContainer) {
      return res.status(404).json({
        error: 'Redis container not found'
      });
    }
    
    // Get container logs
    const container = docker.getContainer(redisContainer.Id);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail: 50, // Get last 50 lines
      timestamps: true
    });
    
    // Convert buffer to string and split into lines
    const logLines = logs.toString('utf8')
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => {
        // Clean up Docker log format
        let cleanLine = line;
        
        // Remove Docker stream headers and extract actual log content
        if (line.includes('*')) {
          // Find Redis log patterns
          const redisLogMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(\d+:[A-Z]+\s+\d+\s+\w+\s+\d+\s+\d+:\d+:\d+\.\d+\s+\*\s+.+)/);
          if (redisLogMatch) {
            return {
              timestamp: redisLogMatch[1],
              message: redisLogMatch[2],
              raw: line
            };
          }
        }
        
        // Try to extract any timestamp and message
        const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/);
        if (timestampMatch) {
          const timestamp = timestampMatch[1];
          const messageStart = line.indexOf(timestamp) + timestamp.length;
          const message = line.substring(messageStart).trim();
          return {
            timestamp: timestamp,
            message: message || 'Redis log entry',
            raw: line
          };
        }
        
        // Fallback for any other format
        return {
          timestamp: new Date().toISOString(),
          message: line.length > 100 ? line.substring(0, 100) + '...' : line,
          raw: line
        };
      })
      .reverse(); // Show newest logs first
    
    res.json({
      containerId: redisContainer.Id,
      containerName: redisContainer.Names[0],
      logs: logLines,
      total: logLines.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[❌] Error getting Redis logs:', error);
    res.status(500).json({
      error: 'Failed to get Redis logs',
      message: error.message
    });
  }
});

// Get MySQL container logs using Docker Engine API (batch mode)
app.get('/containers/mysql/logs', async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    const mysqlContainer = containers.find(container => 
      container.Names.some(name => name.includes('redis-resilience-poc-mysql'))
    );
    
    if (!mysqlContainer) {
      return res.status(404).json({
        error: 'MySQL container not found'
      });
    }
    
    // Get container logs
    const container = docker.getContainer(mysqlContainer.Id);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail: 50, // Get last 50 lines
      timestamps: true
    });
    
    // Convert buffer to string and split into lines
    const logLines = logs.toString('utf8')
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => {
        // Clean up Docker log format
        let cleanLine = line;
        
        // Try to extract any timestamp and message
        const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/);
        if (timestampMatch) {
          const timestamp = timestampMatch[1];
          const messageStart = line.indexOf(timestamp) + timestamp.length;
          const message = line.substring(messageStart).trim();
          return {
            timestamp: timestamp,
            message: message || 'MySQL log entry',
            raw: line
          };
        }
        
        // Fallback for any other format
        return {
          timestamp: new Date().toISOString(),
          message: line.length > 100 ? line.substring(0, 100) + '...' : line,
          raw: line
        };
      })
      .reverse(); // Show newest logs first
    
    res.json({
      containerId: mysqlContainer.Id,
      containerName: mysqlContainer.Names[0],
      logs: logLines,
      total: logLines.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[❌] Error getting MySQL logs:', error);
    res.status(500).json({
      error: 'Failed to get MySQL logs',
      message: error.message
    });
  }
});

// Get App container logs using Docker Engine API (batch mode)
app.get('/containers/app/logs', async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    const appContainer = containers.find(container => 
      container.Names.some(name => name.includes('redis-resilience-poc-app'))
    );
    
    if (!appContainer) {
      return res.status(404).json({
        error: 'App container not found'
      });
    }
    
    // Get container logs
    const container = docker.getContainer(appContainer.Id);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail: 50, // Get last 50 lines
      timestamps: true
    });
    
    // Convert buffer to string and split into lines
    const logLines = logs.toString('utf8')
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => {
        // Clean up Docker log format
        let cleanLine = line;
        
        // Try to extract any timestamp and message
        const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/);
        if (timestampMatch) {
          const timestamp = timestampMatch[1];
          const messageStart = line.indexOf(timestamp) + timestamp.length;
          const message = line.substring(messageStart).trim();
          return {
            timestamp: timestamp,
            message: message || 'App log entry',
            raw: line
          };
        }
        
        // Fallback for any other format
        return {
          timestamp: new Date().toISOString(),
          message: line.length > 100 ? line.substring(0, 100) + '...' : line,
          raw: line
        };
      })
      .reverse(); // Show newest logs first
    
    res.json({
      containerId: appContainer.Id,
      containerName: appContainer.Names[0],
      logs: logLines,
      total: logLines.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[❌] Error getting App logs:', error);
    res.status(500).json({
      error: 'Failed to get App logs',
      message: error.message
    });
  }
});

// Real-time Redis container logs streaming using Server-Sent Events
app.get('/containers/redis/logs/stream', async (req, res) => {
  try {
    const containers = await docker.listContainers({ all: true });
    const redisContainer = containers.find(container => 
      container.Names.some(name => name.includes('redis-resilience-poc-redis'))
    );
    
    if (!redisContainer) {
      return res.status(404).json({
        error: 'Redis container not found'
      });
    }

    // Set up Server-Sent Events headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    const container = docker.getContainer(redisContainer.Id);
    
    // Function to clean and parse log line
    const parseLogLine = (line) => {
      if (line.includes('*')) {
        const redisLogMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(\d+:[A-Z]+\s+\d+\s+\w+\s+\d+\s+\d+:\d+:\d+\.\d+\s+\*\s+.+)/);
        if (redisLogMatch) {
          return {
            timestamp: redisLogMatch[1],
            message: redisLogMatch[2],
            raw: line
          };
        }
      }
      
      const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/);
      if (timestampMatch) {
        const timestamp = timestampMatch[1];
        const messageStart = line.indexOf(timestamp) + timestamp.length;
        const message = line.substring(messageStart).trim();
        return {
          timestamp: timestamp,
          message: message || 'Redis log entry',
          raw: line
        };
      }
      
      return {
        timestamp: new Date().toISOString(),
        message: line.length > 100 ? line.substring(0, 100) + '...' : line,
        raw: line
      };
    };

    // Get initial logs
    const initialLogs = await container.logs({
      stdout: true,
      stderr: true,
      tail: 10,
      timestamps: true
    });

    const initialLogLines = initialLogs.toString('utf8')
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(parseLogLine)
      .reverse();

    // Send initial logs
    res.write(`data: ${JSON.stringify({
      type: 'initial',
      logs: initialLogLines,
      containerId: redisContainer.Id,
      containerName: redisContainer.Names[0]
    })}\n\n`);

    // Set up real-time log streaming
    const logStream = await container.logs({
      stdout: true,
      stderr: true,
      follow: true, // This enables real-time streaming
      timestamps: true,
      tail: 0 // Start from current time
    });

    // Handle real-time log stream
    logStream.on('data', (chunk) => {
      const lines = chunk.toString('utf8').split('\n').filter(line => line.trim() !== '');
      
      lines.forEach(line => {
        const parsedLog = parseLogLine(line);
        res.write(`data: ${JSON.stringify({
          type: 'log',
          log: parsedLog,
          timestamp: new Date().toISOString()
        })}\n\n`);
      });
    });

    logStream.on('error', (error) => {
      console.error('[❌] Log stream error:', error);
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      })}\n\n`);
    });

    // Handle client disconnect
    req.on('close', () => {
      console.log('[📋] Client disconnected from log stream');
      logStream.destroy();
    });

  } catch (error) {
    console.error('[❌] Error setting up log stream:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    })}\n\n`);
  }
});

// Simulation endpoints - Using Docker Engine API
app.post('/simulate-crash', async (req, res) => {
  try {
    const result = await recoveryManager.simulateCrash();
    res.json(result);
  } catch (error) {
    console.error('[❌] Error crashing Redis container:', error);
    res.status(500).json({
      error: 'Failed to crash Redis container',
      message: error.message
    });
  }
});



app.post('/simulate-restart', async (req, res) => {
  try {
    const result = await recoveryManager.simulateRestart();
    res.json(result);
  } catch (error) {
    console.error('[❌] Error restarting Redis container:', error);
    res.status(500).json({
      error: 'Failed to restart Redis container',
      message: error.message
    });
  }
});

// Enhanced restart simulation with 20-second downtime and real-time feedback
app.post('/simulate-restart-enhanced', async (req, res) => {
  try {
    console.log('[🔄] Starting enhanced Redis restart simulation...');
    
    // Set up SSE headers for real-time updates
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
    
    // Send initial status
    res.write(`data: ${JSON.stringify({
      type: 'start',
      message: 'Enhanced Redis restart simulation started',
      timestamp: new Date().toISOString()
    })}\n\n`);
    
    // Step 1: Stop Redis container
    res.write(`data: ${JSON.stringify({
      type: 'step',
      step: 1,
      message: 'Stopping Redis container...',
      timestamp: new Date().toISOString()
    })}\n\n`);
    
    const containers = await docker.listContainers({ all: true });
    const redisContainer = containers.find(container => 
      container.Names.some(name => name.includes('redis-resilience-poc-redis'))
    );
    
    if (!redisContainer) {
      throw new Error('Redis container not found');
    }
    
    const container = docker.getContainer(redisContainer.Id);
    await container.stop();
    
    res.write(`data: ${JSON.stringify({
      type: 'step',
      step: 2,
      message: 'Redis container stopped successfully',
      timestamp: new Date().toISOString()
    })}\n\n`);
    
    // Step 2: Wait 20 seconds with real-time retry updates
    const startTime = Date.now();
    const downtimeDuration = 20000; // 20 seconds
    
    const retryInterval = setInterval(async () => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, downtimeDuration - elapsed);
      const progress = Math.min(100, (elapsed / downtimeDuration) * 100);
      
      // Check Redis connection status
      const redisStatus = redisManager.getStatus();
      const connectionAttempts = redisManager.getConnectionAttempts();
      
      res.write(`data: ${JSON.stringify({
        type: 'retry_update',
        elapsed: Math.floor(elapsed / 1000),
        remaining: Math.floor(remaining / 1000),
        progress: Math.round(progress),
        redisStatus: redisStatus,
        connectionAttempts: connectionAttempts,
        message: `Redis down for ${Math.floor(elapsed / 1000)}s, ${Math.floor(remaining / 1000)}s remaining`,
        timestamp: new Date().toISOString()
      })}\n\n`);
      
      // If 20 seconds have passed, stop the interval
      if (elapsed >= downtimeDuration) {
        clearInterval(retryInterval);
      }
    }, 1000); // Update every second
    
    // Wait for 20 seconds
    await new Promise(resolve => setTimeout(resolve, downtimeDuration));
    
    res.write(`data: ${JSON.stringify({
      type: 'step',
      step: 3,
      message: '20 seconds elapsed, starting Redis container...',
      timestamp: new Date().toISOString()
    })}\n\n`);
    
    // Step 3: Start Redis container
    await container.start();
    
    res.write(`data: ${JSON.stringify({
      type: 'step',
      step: 4,
      message: 'Redis container started, waiting for connection...',
      timestamp: new Date().toISOString()
    })}\n\n`);
    
    // Wait a bit for Redis to fully start up
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    res.write(`data: ${JSON.stringify({
      type: 'step',
      step: 5,
      message: 'Redis container should be ready, attempting reconnection...',
      timestamp: new Date().toISOString()
    })}\n\n`);
    
    // Step 4: Actively attempt reconnection and monitor recovery
    let recoveryAttempts = 0;
    const maxRecoveryAttempts = 10;
    
    const recoveryInterval = setInterval(async () => {
      recoveryAttempts++;
      const redisStatus = redisManager.getStatus();
      const connectionAttempts = redisManager.getConnectionAttempts();
      
      // Actively try to reconnect if not connected
      if (!redisManager.isConnected()) {
        console.log(`[🔄] Active reconnection attempt ${recoveryAttempts}/${maxRecoveryAttempts}`);
        
        // Force a new connection attempt
        try {
          // Only disconnect if we have an existing connection
          if (redisManager.getRedis()) {
            await redisManager.disconnect(); // Clean disconnect first
          }
          redisManager.connect(); // Start fresh connection
          
          // Wait a bit for the connection to establish
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.log(`[❌] Reconnection attempt ${recoveryAttempts} failed:`, error.message);
        }
      }
      
      res.write(`data: ${JSON.stringify({
        type: 'recovery_update',
        attempt: recoveryAttempts,
        maxAttempts: maxRecoveryAttempts,
        redisStatus: redisStatus,
        connectionAttempts: connectionAttempts,
        message: `Recovery attempt ${recoveryAttempts}/${maxRecoveryAttempts} - Status: ${redisStatus}`,
        timestamp: new Date().toISOString()
      })}\n\n`);
      
      // Check if Redis is connected
      if (redisManager.isConnected()) {
        clearInterval(recoveryInterval);
        res.write(`data: ${JSON.stringify({
          type: 'complete',
          message: 'Redis successfully reconnected!',
          finalStatus: redisStatus,
          totalAttempts: connectionAttempts,
          timestamp: new Date().toISOString()
        })}\n\n`);
        res.end();
        return;
      }
      
      // If max attempts reached, stop monitoring
      if (recoveryAttempts >= maxRecoveryAttempts) {
        clearInterval(recoveryInterval);
        res.write(`data: ${JSON.stringify({
          type: 'timeout',
          message: 'Redis recovery timeout - system will use MySQL fallback',
          finalStatus: redisStatus,
          totalAttempts: connectionAttempts,
          timestamp: new Date().toISOString()
        })}\n\n`);
        res.end();
        return;
      }
    }, 2000); // Check every 2 seconds
    
  } catch (error) {
    console.error('[❌] Error in enhanced restart simulation:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    })}\n\n`);
    res.end();
  }
});



app.post('/simulate-auth-failure', async (req, res) => {
  try {
    console.log('[🔐] Actually simulating auth failure by changing Redis password...');
    
    if (redisManager.isConnected()) {
      try {
        // Change Redis password to cause auth failure
        const redis = redisManager.getRedis();
        await redis.config('SET', 'requirepass', 'wrongpassword');
        console.log('[🔐] Redis password changed to wrongpassword');
        
        // Disconnect current connection
        await redisManager.disconnect();
        console.log('[🔐] Redis connection disconnected due to auth change');
      } catch (redisError) {
        console.log('[🔐] Error changing Redis password:', redisError.message);
      }
    }
    
    res.json({
      message: 'Redis authentication failure simulated - password changed to wrongpassword',
      status: 'Auth Failed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[❌] Error simulating auth failure:', error);
    res.status(500).json({
      error: 'Failed to simulate auth failure',
      message: error.message
    });
  }
});

// Reset Redis password back to normal
app.post('/reset-redis-auth', async (req, res) => {
  try {
    console.log('[🔓] Resetting Redis password back to normal...');
    
    // Disconnect current connection first
    await redisManager.disconnect();
    
    // Create a temporary connection with wrong password to reset it
    const Redis = require('ioredis');
    const tempRedis = new Redis({
      host: process.env.REDIS_HOST || 'redis',
      port: 6379,
      password: 'wrongpassword',
      retryStrategy: (times) => Math.min(times * 100, 1000),
      maxRetriesPerRequest: 1,
    });
    
    try {
      // Reset Redis password back to empty
      await tempRedis.config('SET', 'requirepass', '');
      console.log('[🔓] Redis password reset to empty');
      await tempRedis.disconnect();
    } catch (tempError) {
      console.log('[🔓] Could not reset password with wrong password, trying direct connection');
    }
    
    // Wait a bit for the change to take effect
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Reconnect to Redis with no password
    redisManager.connect();
    
    res.json({
      message: 'Redis password reset successfully',
      status: redisManager.getStatus(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[❌] Error resetting Redis password:', error);
    res.status(500).json({
      error: 'Failed to reset Redis password',
      message: error.message
    });
  }
});

app.post('/reconnect', async (req, res) => {
  try {
    console.log('[🔄] Manual reconnect requested...');
    
    // Check if connection is stuck first
    if (redisManager.isStuckInRetry()) {
      console.log('[🔄] Connection appears stuck, performing forced reset...');
      await redisManager.forceResetIfStuck();
      res.json({ 
        message: 'Forced connection reset initiated due to stuck retry loop',
        wasStuck: true,
        status: redisManager.getStatus()
      });
    } else {
      // Normal reconnect
      await redisManager.resetConnection();
      res.json({ 
        message: 'Connection reset initiated',
        wasStuck: false,
        status: redisManager.getStatus()
      });
    }
  } catch (error) {
    console.error('[❌] Error during reconnect:', error);
    res.status(500).json({
      error: 'Failed to reconnect',
      message: error.message
    });
  }
});

app.post('/clear-cache', async (req, res) => {
  try {
    if (redisManager.isConnected()) {
      // Clear all user cache keys
      const keys = await redisManager.keys('user:*');
      if (keys.length > 0) {
        await redisManager.del(...keys);
        console.log(`[🗑️] Cleared ${keys.length} cached user records`);
      }
      res.json({ message: 'Cache cleared', clearedKeys: keys.length });
    } else {
      res.status(500).json({ error: 'Redis not connected' });
    }
  } catch (error) {
    console.error('[❌] Error clearing cache:', error);
    res.status(500).json({ error: 'Failed to clear cache', message: error.message });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`🚀 API running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  
  // Start periodic connection health check
  setInterval(async () => {
    try {
      // Check if connection is stuck and auto-reset if needed
      if (redisManager.isStuckInRetry()) {
        console.log('[🔄] Auto-detected stuck connection, performing reset...');
        await redisManager.forceResetIfStuck();
      }
    } catch (error) {
      console.error('[❌] Error in connection health check:', error);
    }
  }, 30000); // Check every 30 seconds
}); 