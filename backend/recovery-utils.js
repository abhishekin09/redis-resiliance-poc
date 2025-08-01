const Docker = require('dockerode');
const redisManager = require('./redis-utils');

class RecoveryManager {
  constructor() {
    this.docker = new Docker({
      socketPath: '/var/run/docker.sock'
    });
    this.recoveryTimeout = null;
  }

  // Crash recovery monitoring with retry strategy
  startCrashRecoveryMonitoring() {
    console.log('[🔄] Starting crash recovery monitoring...');
    
    this.clearRecoveryTimeout();
    
    let recoveryAttempts = 0;
    const maxRecoveryAttempts = 12; // 12 attempts over 1 minute
    
    const attemptRecovery = async () => {
      recoveryAttempts++;
      
      try {
        console.log(`[🔄] Crash recovery attempt ${recoveryAttempts}/${maxRecoveryAttempts}`);
        
        // Check if container is running
        const containers = await this.docker.listContainers({ all: true });
        const redisContainer = containers.find(container => 
          container.Names.some(name => name.includes('redis-resilience-poc-redis'))
        );
        
        if (redisContainer && redisContainer.State === 'running') {
          console.log('[✅] Redis container is running, attempting to reconnect...');
          
          // Try to reconnect
          redisManager.connect();
          
          // Wait a bit and check if connection is successful
          setTimeout(async () => {
            if (redisManager.getStatus() === 'Connected') {
              console.log('[✅] Crash recovery successful - Redis reconnected');
              return;
            } else {
              console.log('[⚠️] Container running but connection failed, retrying...');
              if (recoveryAttempts < maxRecoveryAttempts) {
                this.recoveryTimeout = setTimeout(attemptRecovery, redisManager.calculateRetryDelay(recoveryAttempts));
              }
            }
          }, 2000);
          
        } else {
          console.log('[⏳] Redis container not running yet, waiting...');
          
          if (recoveryAttempts < maxRecoveryAttempts) {
            this.recoveryTimeout = setTimeout(attemptRecovery, redisManager.calculateRetryDelay(recoveryAttempts));
          } else {
            console.log('[❌] Crash recovery timeout - container not recovered within expected time');
          }
        }
        
      } catch (error) {
        console.error(`[❌] Crash recovery attempt ${recoveryAttempts} failed:`, error.message);
        
        if (recoveryAttempts < maxRecoveryAttempts) {
          this.recoveryTimeout = setTimeout(attemptRecovery, redisManager.calculateRetryDelay(recoveryAttempts));
        }
      }
    };
    
    // Start first recovery attempt
    this.recoveryTimeout = setTimeout(attemptRecovery, 2000);
  }

  // Restart recovery monitoring with retry strategy
  startRestartRecoveryMonitoring() {
    console.log('[🔄] Starting restart recovery monitoring...');
    
    this.clearRecoveryTimeout();
    
    let recoveryAttempts = 0;
    const maxRecoveryAttempts = 6; // 6 attempts over 30 seconds
    
    const attemptRecovery = async () => {
      recoveryAttempts++;
      
      try {
        console.log(`[🔄] Restart recovery attempt ${recoveryAttempts}/${maxRecoveryAttempts}`);
        
        // Check if container is running and healthy
        const containers = await this.docker.listContainers({ all: true });
        const redisContainer = containers.find(container => 
          container.Names.some(name => name.includes('redis-resilience-poc-redis'))
        );
        
        if (redisContainer && redisContainer.State === 'running') {
          console.log('[✅] Redis container is running, attempting to reconnect...');
          
          // Try to reconnect
          redisManager.connect();
          
          // Wait and verify connection
          setTimeout(async () => {
            if (redisManager.getStatus() === 'Connected') {
              console.log('[✅] Restart recovery successful - Redis reconnected');
              return;
            } else {
              console.log('[⚠️] Container running but connection failed, retrying...');
              if (recoveryAttempts < maxRecoveryAttempts) {
                this.recoveryTimeout = setTimeout(attemptRecovery, redisManager.calculateRetryDelay(recoveryAttempts));
              } else {
                console.log('[❌] Restart recovery timeout - connection failed after multiple attempts');
              }
            }
          }, 3000);
          
        } else {
          console.log('[⏳] Redis container not ready yet, waiting...');
          
          if (recoveryAttempts < maxRecoveryAttempts) {
            this.recoveryTimeout = setTimeout(attemptRecovery, redisManager.calculateRetryDelay(recoveryAttempts));
          } else {
            console.log('[❌] Restart recovery timeout - container not ready within expected time');
          }
        }
        
      } catch (error) {
        console.error(`[❌] Restart recovery attempt ${recoveryAttempts} failed:`, error.message);
        
        if (recoveryAttempts < maxRecoveryAttempts) {
          this.recoveryTimeout = setTimeout(attemptRecovery, redisManager.calculateRetryDelay(recoveryAttempts));
        }
      }
    };
    
    // Start first recovery attempt after a short delay
    this.recoveryTimeout = setTimeout(attemptRecovery, 2000);
  }

  // Clear recovery timeout
  clearRecoveryTimeout() {
    if (this.recoveryTimeout) {
      clearTimeout(this.recoveryTimeout);
      this.recoveryTimeout = null;
    }
  }

  // Get recovery status
  isRecoveryActive() {
    return this.recoveryTimeout !== null;
  }

  // Simulate Redis crash
  async simulateCrash() {
    try {
      console.log('[💥] Actually crashing Redis container using Docker Engine API...');
      
      // Get Redis container
      const containers = await this.docker.listContainers();
      const redisContainer = containers.find(container => 
        container.Names.some(name => name.includes('redis-resilience-poc-redis'))
      );
      
      if (!redisContainer) {
        throw new Error('Redis container not found');
      }
      
      console.log(`[💥] Found Redis container: ${redisContainer.Id}`);
      
      // Stop the Redis container
      await this.docker.getContainer(redisContainer.Id).stop();
      console.log('[💥] Redis container stopped');
      
      // Update our connection status
      await redisManager.disconnect();
      redisManager.updateStatus('Disconnected');
      
      // Start crash recovery monitoring
      this.startCrashRecoveryMonitoring();
      
      return {
        message: 'Redis container crashed successfully using Docker Engine API',
        containerId: redisContainer.Id,
        status: 'Disconnected',
        timestamp: new Date().toISOString(),
        recoveryMonitoring: 'Started'
      };
    } catch (error) {
      console.error('[❌] Error crashing Redis container:', error);
      throw error;
    }
  }

  // Simulate Redis restart
  async simulateRestart() {
    try {
      console.log('[🔄] Actually restarting Redis container using Docker Engine API...');
      
      // Get Redis container
      const containers = await this.docker.listContainers({ all: true });
      const redisContainer = containers.find(container => 
        container.Names.some(name => name.includes('redis-resilience-poc-redis'))
      );
      
      if (!redisContainer) {
        throw new Error('Redis container not found');
      }
      
      console.log(`[🔄] Found Redis container: ${redisContainer.Id}`);
      
      // Start the Redis container if it's stopped
      if (redisContainer.State === 'exited') {
        await this.docker.getContainer(redisContainer.Id).start();
        console.log('[🔄] Redis container started');
      } else {
        // Restart the Redis container
        await this.docker.getContainer(redisContainer.Id).restart();
        console.log('[🔄] Redis container restarted');
      }
      
      // Start restart recovery monitoring with retry strategy
      this.startRestartRecoveryMonitoring();
      
      return {
        message: 'Redis container restarted successfully using Docker Engine API',
        containerId: redisContainer.Id,
        status: 'Restarting',
        timestamp: new Date().toISOString(),
        recoveryMonitoring: 'Started'
      };
    } catch (error) {
      console.error('[❌] Error restarting Redis container:', error);
      throw error;
    }
  }

  // Get container status
  async getContainerStatus() {
    try {
      const containers = await this.docker.listContainers({ all: true });
      const redisContainer = containers.find(container => 
        container.Names.some(name => name.includes('redis-resilience-poc-redis'))
      );
      
      if (redisContainer) {
        return {
          containerId: redisContainer.Id,
          name: redisContainer.Names[0],
          state: redisContainer.State,
          status: redisContainer.Status,
          image: redisContainer.Image,
          ports: redisContainer.Ports,
          createdAt: redisContainer.Created
        };
      } else {
        throw new Error('Redis container not found');
      }
    } catch (error) {
      console.error('[❌] Error getting container status:', error);
      throw error;
    }
  }

  // Get all containers status
  async getAllContainersStatus() {
    try {
      const containers = await this.docker.listContainers({ all: true });
      
      const containerDetails = containers.map(container => ({
        containerId: container.Id,
        name: container.Names[0] || 'Unknown',
        state: container.State,
        status: container.Status,
        image: container.Image,
        ports: container.Ports || [],
        createdAt: container.Created,
        labels: container.Labels || {},
        networkSettings: container.NetworkSettings || {}
      }));
      
      return {
        total: containerDetails.length,
        containers: containerDetails
      };
    } catch (error) {
      console.error('[❌] Error getting all containers status:', error);
      throw error;
    }
  }

  // Get container logs
  async getContainerLogs(containerId, options = {}) {
    try {
      const container = this.docker.getContainer(containerId);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail: options.tail || 100,
        ...options
      });
      
      return logs.toString('utf8');
    } catch (error) {
      console.error('[❌] Error getting container logs:', error);
      throw error;
    }
  }
}

// Create and export a singleton instance
const recoveryManager = new RecoveryManager();

module.exports = recoveryManager; 