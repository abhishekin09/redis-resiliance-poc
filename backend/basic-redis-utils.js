const Redis = require('ioredis');

class BasicRedisManager {
  constructor() {
    this.redis = null;
    this.status = 'Disconnected';
    this.connectionAttempts = 0;
    
    // Basic configuration without retry strategy
    this.config = {
      host: process.env.REDIS_HOST || 'redis',
      port: 6379,
      db: 0,
      ttl: 360000, // 6 minutes in milliseconds
      maxRetriesPerRequest: 1, // Only 1 retry per request
      connectTimeout: 5000, // 5 seconds
      commandTimeout: 3000,  // 3 seconds
      lazyConnect: false,
      keepAlive: 30000, // 30 seconds
      family: 4 // IPv4
    };
  }

  // Basic connect without retry strategy
  connect() {
    console.log('[🔌] Basic Redis: Attempting to connect...');
    
    this.redis = new Redis({
      host: this.config.host,
      port: this.config.port,
      db: this.config.db,
      maxRetriesPerRequest: this.config.maxRetriesPerRequest,
      connectTimeout: this.config.connectTimeout,
      commandTimeout: this.config.commandTimeout,
      lazyConnect: this.config.lazyConnect,
      keepAlive: this.config.keepAlive,
      family: this.config.family,
    });

    this.redis.on('connect', () => {
      this.status = 'Connected';
      this.connectionAttempts = 0;
      console.log('[✔️] Basic Redis: Connected successfully');
    });

    this.redis.on('ready', () => {
      console.log('[✅] Basic Redis: Ready to accept commands');
    });

    this.redis.on('error', (err) => {
      this.status = 'Error';
      console.error('[❌] Basic Redis Error:', err.message);
      // NO failure recording
      // NO circuit breaker logic
    });

    this.redis.on('reconnecting', () => {
      this.status = 'Reconnecting';
      this.connectionAttempts++;
      console.log(`[⟳] Basic Redis: Reconnecting... (attempt ${this.connectionAttempts})`);
      // NO retry limit enforcement
      // NO exponential backoff
      // NO jitter
    });

    this.redis.on('close', () => {
      this.status = 'Disconnected';
      console.log('[🔌] Basic Redis: Connection closed');
    });

    this.redis.on('end', () => {
      this.status = 'Disconnected';
      console.log('[🔌] Basic Redis: Connection ended');
    });
  }

  // Basic disconnect
  async disconnect() {
    if (this.redis) {
      await this.redis.disconnect();
      this.redis = null;
      this.status = 'Disconnected';
      console.log('[🔌] Basic Redis: Disconnected');
    }
  }

  // Basic reset connection
  async resetConnection() {
    console.log('[🔄] Basic Redis: Resetting connection...');
    await this.disconnect();
    this.connect();
  }

  // Get Redis instance
  getRedis() {
    return this.redis;
  }

  // Get status
  getStatus() {
    return this.status;
  }

  // Get connection attempts
  getConnectionAttempts() {
    return this.connectionAttempts;
  }

  // Check if connected
  isConnected() {
    return this.status === 'Connected' && this.redis && this.redis.status === 'ready';
  }

  // Basic set operation
  async set(key, value, ttl = null) {
    try {
      if (!this.isConnected()) {
        throw new Error('Redis not connected');
      }
      
      if (ttl) {
        await this.redis.setex(key, ttl, JSON.stringify(value));
      } else {
        await this.redis.set(key, JSON.stringify(value));
      }
      
      console.log(`[💾] Basic Redis: Set key ${key}`);
      return true;
    } catch (error) {
      console.error(`[❌] Basic Redis: Failed to set key ${key}:`, error.message);
      throw error;
    }
  }

  // Basic get operation
  async get(key) {
    try {
      if (!this.isConnected()) {
        throw new Error('Redis not connected');
      }
      
      const value = await this.redis.get(key);
      if (value) {
        console.log(`[📖] Basic Redis: Get key ${key} from Redis`);
        return JSON.parse(value);
      }
      
      console.log(`[❓] Basic Redis: Key ${key} not found in Redis`);
      return null;
    } catch (error) {
      console.error(`[❌] Basic Redis: Failed to get key ${key}:`, error.message);
      throw error;
    }
  }

  // Basic delete operation
  async del(key) {
    try {
      if (!this.isConnected()) {
        throw new Error('Redis not connected');
      }
      
      const result = await this.redis.del(key);
      console.log(`[🗑️] Basic Redis: Deleted key ${key}`);
      return result;
    } catch (error) {
      console.error(`[❌] Basic Redis: Failed to delete key ${key}:`, error.message);
      throw error;
    }
  }

  // Basic TTL operation
  async ttl(key) {
    try {
      if (!this.isConnected()) {
        throw new Error('Redis not connected');
      }
      
      const ttl = await this.redis.ttl(key);
      return ttl;
    } catch (error) {
      console.error(`[❌] Basic Redis: Failed to get TTL for key ${key}:`, error.message);
      throw error;
    }
  }

  // Basic keys operation
  async keys(pattern) {
    try {
      if (!this.isConnected()) {
        throw new Error('Redis not connected');
      }
      
      const keys = await this.redis.keys(pattern);
      return keys;
    } catch (error) {
      console.error(`[❌] Basic Redis: Failed to get keys for pattern ${pattern}:`, error.message);
      throw error;
    }
  }

  // Basic flush all operation
  async flushAll() {
    try {
      if (!this.isConnected()) {
        throw new Error('Redis not connected');
      }
      
      await this.redis.flushall();
      console.log('[🗑️] Basic Redis: Flushed all keys');
      return true;
    } catch (error) {
      console.error('[❌] Basic Redis: Failed to flush all keys:', error.message);
      throw error;
    }
  }

  // Basic ping operation
  async ping() {
    try {
      if (!this.isConnected()) {
        throw new Error('Redis not connected');
      }
      
      const result = await this.redis.ping();
      return result;
    } catch (error) {
      console.error('[❌] Basic Redis: Failed to ping:', error.message);
      throw error;
    }
  }

  // Basic info operation
  async info() {
    try {
      if (!this.isConnected()) {
        throw new Error('Redis not connected');
      }
      
      const info = await this.redis.info();
      return info;
    } catch (error) {
      console.error('[❌] Basic Redis: Failed to get info:', error.message);
      throw error;
    }
  }

  // Get detailed status
  getDetailedStatus() {
    return {
      status: this.status,
      connectionAttempts: this.connectionAttempts,
      isConnected: this.isConnected(),
      redisStatus: this.redis ? this.redis.status : 'No Redis instance',
      config: {
        host: this.config.host,
        port: this.config.port,
        maxRetriesPerRequest: this.config.maxRetriesPerRequest,
        connectTimeout: this.config.connectTimeout,
        commandTimeout: this.config.commandTimeout
      },
      // NO circuit breaker info
      // NO retry strategy info
      // NO auto-recovery info
      // NO stuck retry detection
      problems: [
        'No retry strategy configured',
        'No circuit breaker pattern',
        'No auto-recovery mechanism',
        'No stuck retry detection',
        'No exponential backoff',
        'No jitter for randomization',
        'Limited error handling',
        'No health checks',
        'No graceful degradation'
      ]
    };
  }

  // Get retry info (shows what's missing)
  getRetryInfo() {
    return {
      hasRetryStrategy: false,
      hasCircuitBreaker: false,
      hasAutoRecovery: false,
      hasStuckRetryDetection: false,
      maxRetriesPerRequest: this.config.maxRetriesPerRequest,
      connectionAttempts: this.connectionAttempts,
      status: this.status,
      problems: [
        'No retryStrategy function configured',
        'No exponential backoff',
        'No jitter for randomization',
        'No circuit breaker pattern',
        'No auto-recovery mechanism',
        'No stuck retry detection',
        'Limited error handling',
        'No health checks',
        'No graceful degradation to fallback'
      ],
      impact: [
        'Connection failures cause immediate errors',
        'No automatic reconnection attempts',
        'No protection against infinite retry loops',
        'No fallback mechanism when Redis is down',
        'Poor user experience during Redis outages',
        'No monitoring or alerting capabilities',
        'Difficult to debug connection issues'
      ]
    };
  }
}

module.exports = BasicRedisManager; 