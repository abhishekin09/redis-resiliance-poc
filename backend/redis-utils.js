const Redis = require('ioredis');

class RedisManager {
  constructor() {
    this.redis = null;
    this.status = 'Disconnected';
    this.connectionAttempts = 0;
    this.healthCheckInterval = null;
    this.recoveryTimeout = null;
    this.circuitBreakerState = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.circuitBreakerFailures = 0;
    this.lastFailureTime = null;
    this.autoRecoveryInterval = null;
    
    // Retry configuration
    this.retryConfig = {
      maxRetries: 3, // Reduced from 5 to 3
      baseDelay: 1000, // 1 second
      maxDelay: 30000, // 30 seconds
      backoffMultiplier: 2,
      jitter: 0.1, // 10% jitter
      healthCheckInterval: 5000, // 5 seconds
      healthCheckTimeout: 3000, // 3 seconds
      crashRecoveryTimeout: 60000, // 60 seconds (1 minute)
      restartRecoveryTimeout: 30000, // 30 seconds
      circuitBreakerThreshold: 3, // Reduced from 5 to 3 (matches maxRetries)
      circuitBreakerTimeout: 30000, // 30 seconds
      autoRecoveryCheckInterval: 10000, // 10 seconds
      maxStuckRetryTime: 120000 // 120 seconds (2 minutes)
    };
    
    // Event listeners
    this.eventListeners = {
      connect: [],
      disconnect: [],
      error: [],
      reconnecting: [],
      ready: []
    };
  }

  // Enhanced retry strategy with exponential backoff and jitter
  calculateRetryDelay(attempt) {
    const delay = Math.min(
      this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1),
      this.retryConfig.maxDelay
    );
    
    // Add jitter to prevent thundering herd
    const jitter = delay * this.retryConfig.jitter * (Math.random() - 0.5);
    return Math.max(delay + jitter, 100); // Minimum 100ms
  }

  // Health check function
  async performHealthCheck() {
    if (!this.redis || this.status !== 'Connected') return false;
    
    try {
      const startTime = Date.now();
      await this.redis.ping();
      const responseTime = Date.now() - startTime;
      
      if (responseTime > this.retryConfig.healthCheckTimeout) {
        console.log(`[⚠️] Redis health check slow: ${responseTime}ms`);
        return false;
      }
      
      return true;
    } catch (error) {
      console.log(`[❌] Redis health check failed: ${error.message}`);
      return false;
    }
  }

  // Start health check monitoring
  startHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.healthCheckInterval = setInterval(async () => {
      const isHealthy = await this.performHealthCheck();
      if (!isHealthy && this.status === 'Connected') {
        console.log('[⚠️] Redis health check failed, marking as unhealthy');
        this.status = 'Unhealthy';
        this.emit('error', new Error('Health check failed'));
      }
    }, this.retryConfig.healthCheckInterval);
  }

  // Stop health check monitoring
  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  // Circuit breaker methods
  recordFailure() {
    this.circuitBreakerFailures++;
    this.lastFailureTime = Date.now();
    
    if (this.circuitBreakerFailures >= this.retryConfig.circuitBreakerThreshold) {
      this.circuitBreakerState = 'OPEN';
      console.log(`[🚫] Circuit breaker OPEN - too many failures (${this.circuitBreakerFailures})`);
      this.startAutoRecoveryCheck();
    }
  }

  recordSuccess() {
    this.circuitBreakerFailures = 0;
    this.circuitBreakerState = 'CLOSED';
    this.lastFailureTime = null;
    this.stopAutoRecoveryCheck();
    console.log('[✅] Circuit breaker CLOSED - connection successful');
  }

  isCircuitBreakerOpen() {
    if (this.circuitBreakerState === 'OPEN') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure >= this.retryConfig.circuitBreakerTimeout) {
        this.circuitBreakerState = 'HALF_OPEN';
        console.log('[🔄] Circuit breaker HALF_OPEN - attempting recovery');
        return false;
      }
      return true;
    }
    return false;
  }

  // Auto-recovery check for when Redis becomes available again
  startAutoRecoveryCheck() {
    if (this.autoRecoveryInterval) {
      clearInterval(this.autoRecoveryInterval);
    }
    
    console.log(`[🔄] Starting auto-recovery check every ${this.retryConfig.autoRecoveryCheckInterval}ms`);
    
    this.autoRecoveryInterval = setInterval(async () => {
      if (this.circuitBreakerState === 'OPEN' || this.circuitBreakerState === 'HALF_OPEN') {
        try {
          // Try to ping Redis to see if it's available
          const testRedis = new Redis({
            host: process.env.REDIS_HOST || 'redis',
            port: 6379,
            connectTimeout: 3000,
            commandTimeout: 2000,
            lazyConnect: true
          });
          
          await testRedis.ping();
          await testRedis.disconnect();
          
          console.log('[✅] Redis is available again, attempting reconnection');
          this.forceResetConnection();
          
        } catch (error) {
          // Redis still not available, continue waiting
          console.log(`[⏳] Redis still unavailable: ${error.message}`);
        }
      }
    }, this.retryConfig.autoRecoveryCheckInterval);
  }

  stopAutoRecoveryCheck() {
    if (this.autoRecoveryInterval) {
      clearInterval(this.autoRecoveryInterval);
      this.autoRecoveryInterval = null;
      console.log('[🛑] Stopped auto-recovery check');
    }
  }

  // Force reset connection when stuck
  async forceResetConnection() {
    console.log('[🔄] Force resetting Redis connection');
    
    try {
      // Disconnect existing connection
      if (this.redis) {
        this.redis.removeAllListeners();
        await this.redis.disconnect();
        this.redis = null;
      }
      
      // Reset state
      this.status = 'Disconnected';
      this.connectionAttempts = 0;
      this.circuitBreakerFailures = 0;
      this.circuitBreakerState = 'CLOSED';
      this.lastFailureTime = null;
      
      // Stop all intervals
      this.stopHealthCheck();
      this.stopAutoRecoveryCheck();
      
      // Wait a moment before reconnecting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Attempt fresh connection
      this.connect();
      
    } catch (error) {
      console.error('[❌] Error during force reset:', error.message);
    }
  }

  // Check if connection is stuck in retry loop
  isStuckInRetryLoop() {
    if (this.lastFailureTime && this.connectionAttempts > this.retryConfig.maxRetries) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      return timeSinceLastFailure > this.retryConfig.maxStuckRetryTime;
    }
    return false;
  }

  // Event emitter methods
  on(event, callback) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].push(callback);
    }
  }

  emit(event, data) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach(callback => callback(data));
    }
  }

  // Enhanced Redis connection with comprehensive retry strategy
  connect() {
    console.log('[🔌] Attempting to connect to Redis...');
    
    // Check circuit breaker state
    if (this.isCircuitBreakerOpen()) {
      console.log('[🚫] Circuit breaker is OPEN, not attempting connection');
      return;
    }
    
    // Check if stuck in retry loop
    if (this.isStuckInRetryLoop()) {
      console.log('[⚠️] Detected stuck retry loop, forcing connection reset');
      this.forceResetConnection();
      return;
    }
    
    // Reset connection attempts when starting a new connection
    this.connectionAttempts = 0;
    
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'redis',
      port: 6379,
      retryStrategy: (times) => {
        this.connectionAttempts = times;
        
        // Stop retrying if we've had too many auth failures
        if (this.status === 'Auth Failed' && times > 2) { // Reduced from 3 to 2
          console.log('[🚫] Stopping retry due to authentication failure');
          this.recordFailure();
          return false;
        }
        
        // Stop retrying if we've exceeded max retries
        if (times > this.retryConfig.maxRetries) {
          console.log(`[🚫] Stopping retry after ${times} attempts`);
          this.recordFailure();
          return false;
        }
        
        const delay = this.calculateRetryDelay(times);
        console.log(`[⟳] Retry attempt ${times}/${this.retryConfig.maxRetries} in ${delay}ms`);
        
        return delay;
      },
      maxRetriesPerRequest: 3,
      connectTimeout: 10000, // 10 seconds
      commandTimeout: 5000,  // 5 seconds
      lazyConnect: false,
      keepAlive: 30000, // 30 seconds
      family: 4, // IPv4
      db: 0,
      // Add reconnectOnError to handle reconnection better
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true; // Only reconnect on specific errors
        }
        return false;
      }
    });

    this.redis.on('connect', () => {
      this.status = 'Connected';
      this.connectionAttempts = 0;
      this.recordSuccess();
      console.log('[✔️] Connected to Redis successfully');
      this.startHealthCheck();
      this.emit('connect');
    });

    this.redis.on('ready', () => {
      console.log('[✅] Redis is ready to accept commands');
      this.emit('ready');
    });

    this.redis.on('error', (err) => {
      if (err.message.includes('NOAUTH') || err.message.includes('Authentication required')) {
        this.status = 'Auth Failed';
        console.error('[🔐] Redis Authentication Error:', err.message);
      } else {
        this.status = 'Error';
        console.error('[❌] Redis Error:', err.message);
        this.recordFailure();
      }
      this.stopHealthCheck();
      this.emit('error', err);
    });

    this.redis.on('reconnecting', () => {
      this.status = 'Reconnecting';
      console.log(`[⟳] Reconnecting to Redis... (attempt ${this.connectionAttempts})`);
      this.stopHealthCheck();
      this.emit('reconnecting');
      
      // If we've been reconnecting for too long, consider resetting
      if (this.connectionAttempts > this.retryConfig.maxRetries) {
        console.log('[⚠️] Too many reconnection attempts, considering connection reset');
      }
    });

    this.redis.on('close', () => {
      this.status = 'Disconnected';
      console.log('[🔌] Redis connection closed');
      this.stopHealthCheck();
      this.emit('disconnect');
    });

    this.redis.on('end', () => {
      this.status = 'Disconnected';
      console.log('[🔌] Redis connection ended');
      this.stopHealthCheck();
      this.emit('disconnect');
    });
  }

  // Disconnect from Redis
  async disconnect() {
    if (this.redis) {
      try {
        await this.redis.disconnect();
      } catch (error) {
        console.log('[🔌] Redis already disconnected');
      }
      this.redis = null;
      this.status = 'Disconnected';
      this.connectionAttempts = 0;
      this.stopHealthCheck();
    }
  }

  // Reset connection state and attempt reconnection
  async resetConnection() {
    console.log('[🔄] Resetting Redis connection...');
    await this.disconnect();
    this.status = 'Disconnected';
    this.connectionAttempts = 0;
    
    // Wait a moment before reconnecting
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    this.connect();
  }

  // Get Redis instance
  getRedis() {
    return this.redis;
  }

  // Get current status
  getStatus() {
    return this.status;
  }

  // Get connection attempts
  getConnectionAttempts() {
    return this.connectionAttempts;
  }

  // Get retry configuration
  getRetryConfig() {
    return this.retryConfig;
  }

  // Check if Redis is connected and healthy
  isConnected() {
    return this.redis && this.status === 'Connected';
  }

  // Check if connection is stuck in retry loop
  isStuckInRetry() {
    return this.connectionAttempts > this.retryConfig.maxRetries && 
           (this.status === 'Reconnecting' || this.status === 'Error');
  }

  // Force reset connection if stuck
  async forceResetIfStuck() {
    if (this.isStuckInRetry()) {
      console.log('[🔄] Connection appears stuck, forcing reset...');
      await this.resetConnection();
      return true;
    }
    return false;
  }

  // Set a key-value pair with optional TTL
  async set(key, value, ttl = null) {
    if (!this.isConnected()) {
      throw new Error('Redis not connected');
    }
    
    if (ttl) {
      return await this.redis.setex(key, ttl, value);
    } else {
      return await this.redis.set(key, value);
    }
  }

  // Get a value by key
  async get(key) {
    if (!this.isConnected()) {
      throw new Error('Redis not connected');
    }
    
    return await this.redis.get(key);
  }

  // Delete a key
  async del(key) {
    if (!this.isConnected()) {
      throw new Error('Redis not connected');
    }
    
    return await this.redis.del(key);
  }

  // Get TTL for a key
  async ttl(key) {
    if (!this.isConnected()) {
      throw new Error('Redis not connected');
    }
    
    return await this.redis.ttl(key);
  }

  // Get all keys matching a pattern
  async keys(pattern) {
    if (!this.isConnected()) {
      throw new Error('Redis not connected');
    }
    
    return await this.redis.keys(pattern);
  }

  // Clear all keys
  async flushAll() {
    if (!this.isConnected()) {
      throw new Error('Redis not connected');
    }
    
    return await this.redis.flushall();
  }

  // Ping Redis
  async ping() {
    if (!this.isConnected()) {
      throw new Error('Redis not connected');
    }
    
    return await this.redis.ping();
  }

  // Get Redis info
  async info() {
    if (!this.isConnected()) {
      throw new Error('Redis not connected');
    }
    
    return await this.redis.info();
  }

  // Get memory usage
  async memoryUsage() {
    if (!this.isConnected()) {
      throw new Error('Redis not connected');
    }
    
    return await this.redis.memory('USAGE');
  }

  // Get database size
  async dbSize() {
    if (!this.isConnected()) {
      throw new Error('Redis not connected');
    }
    
    return await this.redis.dbsize();
  }

  // Get detailed status information
  getDetailedStatus() {
    return {
      status: this.status === 'Connected' ? 'OK' : 'FAIL',
      redisStatus: this.status,
      connectionAttempts: this.connectionAttempts,
      retryConfig: {
        maxRetries: this.retryConfig.maxRetries,
        baseDelay: this.retryConfig.baseDelay,
        maxDelay: this.retryConfig.maxDelay,
        backoffMultiplier: this.retryConfig.backoffMultiplier
      },
      healthCheck: {
        enabled: this.healthCheckInterval !== null,
        interval: this.retryConfig.healthCheckInterval,
        timeout: this.retryConfig.healthCheckTimeout
      },
      recovery: {
        monitoring: this.recoveryTimeout !== null,
        crashTimeout: this.retryConfig.crashRecoveryTimeout,
        restartTimeout: this.retryConfig.restartRecoveryTimeout
      }
    };
  }

  // Get retry information
  getRetryInfo() {
    return {
      retryStrategy: {
        configuration: this.retryConfig,
        currentStatus: {
          connectionAttempts: this.connectionAttempts,
          status: this.status,
          healthCheckEnabled: this.healthCheckInterval !== null,
          recoveryMonitoring: this.recoveryTimeout !== null
        },
        nextRetryDelay: this.connectionAttempts > 0 ? this.calculateRetryDelay(this.connectionAttempts + 1) : null,
        maxRetriesReached: this.connectionAttempts >= this.retryConfig.maxRetries
      },
      healthCheck: {
        enabled: this.healthCheckInterval !== null,
        interval: this.retryConfig.healthCheckInterval,
        timeout: this.retryConfig.healthCheckTimeout,
        lastCheck: new Date().toISOString()
      },
      recovery: {
        crashRecovery: {
          enabled: this.recoveryTimeout !== null && this.status === 'Disconnected',
          timeout: this.retryConfig.crashRecoveryTimeout,
          maxAttempts: 12
        },
        restartRecovery: {
          enabled: this.recoveryTimeout !== null && this.status === 'Restarting',
          timeout: this.retryConfig.restartRecoveryTimeout,
          maxAttempts: 6
        }
      },
      timestamp: new Date().toISOString()
    };
  }

  // Set recovery timeout
  setRecoveryTimeout(timeout) {
    this.recoveryTimeout = timeout;
  }

  // Clear recovery timeout
  clearRecoveryTimeout() {
    if (this.recoveryTimeout) {
      clearTimeout(this.recoveryTimeout);
      this.recoveryTimeout = null;
    }
  }

  // Update status
  updateStatus(newStatus) {
    this.status = newStatus;
  }
}

// Create and export a singleton instance
const redisManager = new RedisManager();

module.exports = redisManager; 