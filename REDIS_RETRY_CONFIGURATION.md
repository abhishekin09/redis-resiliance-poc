# Redis Retry Configuration - Values in Seconds

## 🔧 Main Redis Configuration (redis-utils.js)

### Retry Strategy Configuration
```javascript
retryStrategy: (times) => {
  // Stop retrying if we've had too many auth failures
  if (this.status === 'Auth Failed' && times > 2) {
    return false; // Stop after 2 auth failures
  }
  
  // Stop retrying if we've exceeded max retries
  if (times > this.retryConfig.maxRetries) {
    return false; // Stop after 3 attempts
  }
  
  const delay = this.calculateRetryDelay(times);
  return delay;
}
```

### maxRetriesPerRequest Configuration
```javascript
maxRetriesPerRequest: 3 // Maximum 3 retries per individual request
```

### Retry Configuration Values (All in Seconds)

| Configuration Parameter | Value (ms) | Value (seconds) | Description |
|------------------------|------------|-----------------|-------------|
| **maxRetries** | 3000 | **3 seconds** | Maximum connection retry attempts |
| **baseDelay** | 1000 | **1 second** | Base delay for first retry |
| **maxDelay** | 30000 | **30 seconds** | Maximum delay cap |
| **backoffMultiplier** | 2 | **2x** | Exponential backoff multiplier |
| **jitter** | 0.1 | **10%** | Randomization factor |
| **healthCheckInterval** | 5000 | **5 seconds** | Health check frequency |
| **healthCheckTimeout** | 3000 | **3 seconds** | Health check timeout |
| **crashRecoveryTimeout** | 60000 | **60 seconds** | Crash recovery timeout |
| **restartRecoveryTimeout** | 30000 | **30 seconds** | Restart recovery timeout |
| **circuitBreakerThreshold** | 3 | **3 failures** | Failures before circuit opens |
| **circuitBreakerTimeout** | 30000 | **30 seconds** | Circuit breaker timeout |
| **autoRecoveryCheckInterval** | 10000 | **10 seconds** | Auto-recovery check frequency |
| **maxStuckRetryTime** | 120000 | **120 seconds** | Stuck retry timeout |

### Retry Delay Progression (3 Attempts)

| Attempt | Base Delay | With Jitter | Total Time |
|---------|------------|-------------|------------|
| **1** | 1 second | 0.9 - 1.1 seconds | ~1 second |
| **2** | 2 seconds | 1.8 - 2.2 seconds | ~3 seconds total |
| **3** | 4 seconds | 3.6 - 4.4 seconds | ~7 seconds total |
| **4+** | **STOP** | **No more retries** | **Circuit breaker opens** |

### Circuit Breaker Behavior

| State | Trigger | Duration | Action |
|-------|---------|----------|--------|
| **CLOSED** | Normal operation | - | Allow connections |
| **OPEN** | 3 failures | 30 seconds | Block connections |
| **HALF_OPEN** | After 30 seconds | Test period | Allow 1 test connection |

## 🔧 Temporary Redis Configuration (index.js - Auth Reset)

### Retry Strategy Configuration
```javascript
retryStrategy: (times) => Math.min(times * 100, 1000)
// Linear progression: 100ms, 200ms, 300ms... up to 1000ms max
```

### maxRetriesPerRequest Configuration
```javascript
maxRetriesPerRequest: 1 // Only 1 retry for auth reset
```

### Auth Reset Retry Progression

| Attempt | Delay | Total Time |
|---------|-------|------------|
| **1** | 100ms | 0.1 seconds |
| **2** | 200ms | 0.3 seconds |
| **3** | 300ms | 0.6 seconds |
| **4** | 400ms | 1.0 seconds |
| **5** | 500ms | 1.5 seconds |
| **6** | 600ms | 2.1 seconds |
| **7** | 700ms | 2.8 seconds |
| **8** | 800ms | 3.6 seconds |
| **9** | 900ms | 4.5 seconds |
| **10** | 1000ms | 5.5 seconds |
| **11+** | 1000ms | **Capped at 1000ms** |

## 🎯 Key Changes Made

### Before (5 retries)
- **maxRetries**: 5 attempts
- **circuitBreakerThreshold**: 5 failures
- **Total max time**: ~31 seconds (1+2+4+8+16)

### After (3 retries) ⭐
- **maxRetries**: 3 attempts
- **circuitBreakerThreshold**: 3 failures
- **Total max time**: ~7 seconds (1+2+4)

## 🔄 Recovery Timeline

| Event | Time | Action |
|-------|------|--------|
| **Redis Crash** | 0 seconds | Connection fails |
| **Retry 1** | 1 second | First retry attempt |
| **Retry 2** | 3 seconds | Second retry attempt |
| **Retry 3** | 7 seconds | Final retry attempt |
| **Circuit Breaker Opens** | 7 seconds | Block all connections |
| **Auto-Recovery Check** | Every 10 seconds | Test Redis availability |
| **Circuit Breaker Timeout** | 37 seconds | Allow test connection |
| **Force Reset (if stuck)** | 127 seconds | Force connection reset |

## 📊 Benefits of 3-Retry Limit

1. **Faster Failure Detection**: 7 seconds vs 31 seconds
2. **Quicker Circuit Breaker**: Opens after 3 failures instead of 5
3. **Reduced Resource Usage**: Less time spent on failed connections
4. **Better User Experience**: Faster fallback to MySQL
5. **Improved Monitoring**: Quicker detection of Redis issues

## 🚀 Performance Impact

- **Connection Timeout**: Reduced from ~31s to ~7s
- **Circuit Breaker Activation**: Reduced from 5 to 3 failures
- **Auto-Recovery**: Still checks every 10 seconds
- **Force Reset**: Still available after 120 seconds if needed

This configuration provides **faster failure detection** and **quicker recovery** while maintaining **robust resilience**! 🎯 