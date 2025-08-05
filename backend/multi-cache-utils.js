const Redis = require('ioredis');

/**
 * MultiCacheManager - A problematic cache implementation
 * This class demonstrates common issues found in real-world cache managers
 */
class MultiCacheManager {
  constructor(cachePrefix, cacheConfig) {
    this.cachePrefix = cachePrefix;
    this.cacheConfig = cacheConfig;
    this.cacheInitialized = false;
    this.lock = null; // ❌ PROBLEM: Lock initialized lazily
    this.redis = null;
    this.memoryCache = new Map(); // Simple in-memory cache
    this.unusedNodeCache = null; // ❌ PROBLEM: Unused resource
    this.operationCount = 0;
    this.raceConditions = 0;
    this.redundantFetches = 0;
  }

  initCache() {
    if (this.cacheInitialized) {
      return;
    }

    // ❌ PROBLEM: Complex initialization that can fail
    try {
      this.redis = new Redis({
        host: this.cacheConfig.host || 'redis',
        port: this.cacheConfig.port || 6379,
        db: this.cacheConfig.db || 0,
        password: this.cacheConfig.auth,
        maxRetriesPerRequest: 1, // ❌ PROBLEM: No resilience
        connectTimeout: 5000,
        lazyConnect: false,
        // ❌ PROBLEM: No retry strategy, no circuit breaker
      });

      // ❌ PROBLEM: Creating unused resources
      this.unusedNodeCache = {
        stdTTL: this.cacheConfig.stdTTL || 600,
        checkperiod: this.cacheConfig.checkperiod || 120,
        useClones: true,
        maxKeys: 1000
      };

      this.cacheInitialized = true;
      console.log('[📦] MultiCacheManager initialized');
    } catch (error) {
      console.error('[❌] MultiCacheManager initialization failed:', error);
      throw error;
    }
  }

  /**
   * ❌ PROBLEMATIC IMPLEMENTATION with multiple issues
   */
  async getCachedData(key, func, ttlInSeconds) {
    this.operationCount++;
    const cacheKey = `${this.cachePrefix}-${key}`;
    
    // ❌ PROBLEM 1: Lock initialized lazily inside method (race condition risk)
    if (!this.lock) {
      const AsyncLock = require('async-lock');
      this.lock = new AsyncLock();
    }

    let result;
    let cacheError;

    try {
      // ❌ PROBLEM 2: Complex nested operations with redundant cache reads
      return await this.multiCache_wrap(cacheKey, async () => {
        return await this.lock.acquire(`${cacheKey}-lock`, async () => {
          try {
            // ❌ PROBLEM 3: Redundant cache read inside wrap function
            let cacheVal = await this.multiCache_get(cacheKey);
            
            if (cacheVal === undefined) {
              console.log(`[🔄] Cache miss for ${key}, calling function...`);
              let actualVal = await func();
              // ❌ PROBLEM 4: Manual serialization/deserialization overhead
              cacheVal = JSON.stringify(actualVal);
              console.log(`[💾] Storing in cache: ${key}`);
            } else {
              console.log(`[📦] Cache hit for ${key}`);
              this.redundantFetches++; // Track when we had to do redundant reads
            }
            
            return cacheVal;
          } catch (error) {
            console.error(`[❌] Cache operation failed for key: ${key}`, error);
            cacheError = error;
            throw error;
          }
        });
      }, { ttl: ttlInSeconds });
    } catch (error) {
      if (cacheError) {
        throw cacheError;
      }
      // ❌ PROBLEM 5: Poor error handling - falls back to direct function call
      console.log(`[⚠️] Cache completely failed, calling function directly for ${key}`);
      return await func();
    }
  }

  /**
   * Simulates cache-manager's wrap function with race condition issues
   */
  async multiCache_wrap(key, fetchFunction, options) {
    const ttl = options.ttl || 300;
    
    // Check if already in cache
    let cached = await this.multiCache_get(key);
    if (cached !== undefined) {
      // ❌ PROBLEM: Manual JSON parsing can fail
      try {
        return JSON.parse(cached);
      } catch (parseError) {
        console.error(`[❌] Failed to parse cached data for ${key}:`, parseError);
        // Continue to fetch fresh data
      }
    }

    // ❌ PROBLEM: Race condition - multiple concurrent requests for same key
    // can result in multiple function calls
    const fetchResult = await fetchFunction();
    
    // Store in cache
    await this.multiCache_set(key, fetchResult, ttl);
    
    return JSON.parse(fetchResult); // ❌ PROBLEM: Unnecessary parse of just-stringified data
  }

  /**
   * Multi-cache get - checks memory first, then Redis
   */
  async multiCache_get(key) {
    // Check memory cache first
    const memoryResult = this.memoryCache.get(key);
    if (memoryResult && memoryResult.expires > Date.now()) {
      console.log(`[⚡] Memory cache hit: ${key}`);
      return memoryResult.value;
    }

    // ❌ PROBLEM: If Redis is down, this will throw and break the entire flow
    try {
      if (this.redis && this.redis.status === 'ready') {
        const redisResult = await this.redis.get(key);
        if (redisResult) {
          console.log(`[📦] Redis cache hit: ${key}`);
          // Also store in memory for faster access
          this.memoryCache.set(key, {
            value: redisResult,
            expires: Date.now() + (300 * 1000) // 5 minutes
          });
          return redisResult;
        }
      }
    } catch (redisError) {
      // ❌ PROBLEM: Redis errors break the flow instead of graceful fallback
      console.error(`[❌] Redis get failed for ${key}:`, redisError.message);
      throw redisError; // This breaks the entire operation
    }

    return undefined;
  }

  /**
   * Multi-cache set - stores in both memory and Redis
   */
  async multiCache_set(key, value, ttl) {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    const expires = Date.now() + (ttl * 1000);

    // Store in memory
    this.memoryCache.set(key, {
      value: stringValue,
      expires: expires
    });

    // ❌ PROBLEM: If Redis is down, this will throw
    try {
      if (this.redis && this.redis.status === 'ready') {
        await this.redis.setex(key, ttl, stringValue);
      }
    } catch (redisError) {
      // ❌ PROBLEM: Set operations fail completely instead of partial success
      console.error(`[❌] Redis set failed for ${key}:`, redisError.message);
      throw redisError;
    }
  }

  /**
   * Simulate concurrent access to demonstrate race conditions
   */
  async demonstrateRaceConditions(key, func, concurrent = 5) {
    console.log(`[🏁] Starting race condition test with ${concurrent} concurrent requests...`);
    
    const promises = [];
    for (let i = 0; i < concurrent; i++) {
      promises.push(
        this.getCachedData(key, async () => {
          console.log(`[🔄] Function called for request ${i + 1}`);
          await new Promise(resolve => setTimeout(resolve, 100)); // Simulate work
          return { requestId: i + 1, timestamp: Date.now(), data: `Result for ${key}` };
        }, 60)
      );
    }

    const results = await Promise.allSettled(promises);
    
    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');
    
    return {
      concurrent: concurrent,
      successes: successes.length,
      failures: failures.length,
      raceConditionDetected: successes.length > 1 && 
        new Set(successes.map(r => r.value?.requestId)).size > 1
    };
  }

  /**
   * Get detailed status including problems
   */
  getDetailedStatus() {
    const memoryEntries = Array.from(this.memoryCache.entries()).length;
    const redisConnected = this.redis && this.redis.status === 'ready';
    
    return {
      initialized: this.cacheInitialized,
      redisConnected: redisConnected,
      redisStatus: this.redis ? this.redis.status : 'not_initialized',
      memoryEntries: memoryEntries,
      operationCount: this.operationCount,
      redundantFetches: this.redundantFetches,
      lockInitialized: this.lock !== null,
      problems: [
        'Lazy lock initialization creates race conditions',
        'Redundant cache reads inside wrap function',
        'Manual JSON serialization/deserialization overhead',
        'Unused NodeCache instance wastes memory',
        'No retry strategy or circuit breaker',
        'Poor error handling breaks entire cache flow',
        'Race conditions in concurrent access',
        'No graceful degradation when Redis fails',
        'Complex nested async operations',
        'Inconsistent caching behavior across services'
      ],
      impact: [
        'Multiple function calls for same cache key (race conditions)',
        'Unnecessary CPU overhead from JSON operations',
        'Memory leaks from unused resources',
        'Application crashes when Redis is unavailable',
        'Poor performance under high concurrency',
        'Data inconsistency between cache layers',
        'Difficult to debug and maintain',
        'No monitoring or alerting capabilities'
      ]
    };
  }

  /**
   * Simulate the problems this cache manager creates
   */
  async simulateProblems() {
    const problems = [];

    // Problem 1: Race Conditions
    try {
      const raceTest = await this.demonstrateRaceConditions('race-test', async () => {
        return { message: 'This should only be called once!' };
      }, 3);
      
      if (raceTest.raceConditionDetected) {
        problems.push({
          type: 'race_condition',
          description: 'Multiple function calls for same cache key',
          details: raceTest
        });
      }
    } catch (error) {
      problems.push({
        type: 'race_condition_error',
        description: 'Race condition test failed',
        error: error.message
      });
    }

    // Problem 2: Serialization Overhead
    const startTime = Date.now();
    const largeObject = { data: new Array(1000).fill('test data') };
    try {
      await this.getCachedData('serialization-test', async () => largeObject, 60);
      const serializationTime = Date.now() - startTime;
      
      if (serializationTime > 10) {
        problems.push({
          type: 'serialization_overhead',
          description: 'Slow JSON serialization/deserialization',
          timeMs: serializationTime
        });
      }
    } catch (error) {
      problems.push({
        type: 'serialization_error',
        description: 'Serialization test failed',
        error: error.message
      });
    }

    // Problem 3: Redis Failure Handling
    if (this.redis) {
      try {
        // Simulate Redis being unavailable
        const originalStatus = this.redis.status;
        this.redis.status = 'end'; // Simulate disconnection
        
        await this.getCachedData('redis-fail-test', async () => {
          return { message: 'This should work even when Redis is down' };
        }, 60);
        
        this.redis.status = originalStatus; // Restore
      } catch (error) {
        problems.push({
          type: 'redis_failure_handling',
          description: 'Cache fails completely when Redis is unavailable',
          error: error.message
        });
      }
    }

    return {
      problemsDetected: problems.length,
      problems: problems,
      recommendations: [
        'Initialize AsyncLock in constructor, not in method',
        'Implement proper error handling with graceful fallback',
        'Add retry strategy and circuit breaker pattern',
        'Remove unused resources (NodeCache)',
        'Use native object caching instead of JSON serialization',
        'Implement proper race condition prevention',
        'Add monitoring and health checks',
        'Unify cache configuration across services'
      ]
    };
  }

  // Cleanup method
  async cleanup() {
    if (this.redis) {
      await this.redis.disconnect();
    }
    this.memoryCache.clear();
    this.lock = null;
  }
}

module.exports = MultiCacheManager;