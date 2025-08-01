# 🔌 Redis Resilience Proof of Concept

A comprehensive demonstration of Redis connection resilience, caching strategies, and fault tolerance mechanisms in a Node.js application.

## 🎯 Overview

This PoC showcases advanced Redis resilience patterns including:
- **Automatic reconnection** with exponential backoff
- **Read-through caching** with MySQL fallback
- **Real-time monitoring** and health checks
- **Graceful degradation** during Redis outages
- **Enhanced restart simulation** with 45-second downtime
- **Connection state management** and stuck retry detection

## 🏗️ Architecture

### Core Components

#### 1. **Redis Manager (`redis-utils.js`)**
- **Connection Management**: Handles Redis connection lifecycle with automatic reconnection
- **Resilience Features**:
  - Exponential backoff retry strategy
  - Stuck retry loop detection and auto-reset
  - Connection state monitoring
  - Graceful error handling

#### 2. **Caching Strategy**
- **Redis-First Approach**: All data queries check Redis first
- **MySQL Fallback**: Automatic fallback to MySQL when Redis is unavailable
- **TTL Management**: Configurable cache expiration (default: 6 minutes)
- **Cache Warming**: Automatic population of Redis cache from MySQL

#### 3. **Health Monitoring**
- **Real-time Status**: Continuous monitoring of Redis connection state
- **Connection Attempts**: Tracking of reconnection attempts and success rates
- **Auto-Recovery**: Automatic detection and resolution of stuck connections

## 🚀 Key Features

### Redis Resilience Implementation

#### **1. Connection Resilience**
```javascript
// Automatic reconnection with exponential backoff
const redisManager = new RedisManager({
  maxRetries: 10,
  retryDelay: 1000,
  reconnectOnError: true
});
```

#### **2. Stuck Retry Detection**
```javascript
// Detect and auto-reset stuck connections
if (redisManager.isStuckInRetry()) {
  redisManager.forceResetIfStuck();
}
```

#### **3. Graceful Degradation**
```javascript
// Redis-first with MySQL fallback
async function searchUser(query) {
  if (redisManager.isConnected()) {
    const cached = await redisManager.get(`user:${query}`);
    if (cached) return { user: cached, source: 'Redis' };
  }
  // Fallback to MySQL
  const user = await mysqlQuery(query);
  if (redisManager.isConnected()) {
    await redisManager.set(`user:${query}`, user, 360);
  }
  return { user, source: 'MySQL' };
}
```

#### **4. Enhanced Restart Simulation**
- **45-second downtime simulation**
- **Real-time retry strategy visualization**
- **Connection recovery monitoring**
- **Automatic fallback to MySQL during downtime**

### Loop Testing with Resilience

#### **Large-Scale Testing**
- **Millions of iterations** with Redis resilience
- **Real-time progress updates** for large tests
- **Automatic continuation** after Redis restarts
- **Performance metrics** and success rate tracking

#### **Redis Restart Handling**
```javascript
// Continue loop testing even during Redis restarts
if (!redisManager.isConnected()) {
  redisRestartDetected = true;
  // Wait for Redis to come back online
  while (!redisManager.isConnected()) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  redisRecoveryTime = Date.now();
}
```

## 🛠️ Configuration

### Redis Settings (`config.json`)
```json
{
  "redis": {
    "connection": {
      "maxRetries": 10,
      "retryDelay": 1000,
      "reconnectOnError": true
    },
    "caching": {
      "ttl": 360,
      "keyPrefix": "user:"
    },
    "resilience": {
      "stuckRetryThreshold": 50,
      "autoResetInterval": 30000
    }
  }
}
```

## 📊 Monitoring & Testing

### Real-Time Features
- **Connection Status**: Live Redis connection monitoring
- **Container Logs**: Real-time logs from all containers
- **Performance Metrics**: Success rates, response times, error tracking
- **Auto-Refresh**: Configurable refresh intervals

### Simulation Tools
- **Redis Crash Simulation**: Test application behavior during Redis outages
- **Enhanced Restart**: 45-second downtime with real-time monitoring
- **Auth Failure Testing**: Simulate Redis authentication issues
- **Loop Testing**: Large-scale testing with resilience validation

## 🔧 Installation & Setup

### Prerequisites
- Docker and Docker Compose
- Node.js 18+ (for local development)

### Quick Start
```bash
# Clone the repository
git clone <repository-url>
cd redis-resilience-poc

# Start the application
docker-compose up --build -d

# Access the application
open http://localhost:8000
```

### Environment Variables
```bash
# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_MAX_RETRIES=10

# MySQL Configuration
MYSQL_HOST=mysql
MYSQL_DATABASE=redis_poc
MYSQL_USER=root
MYSQL_PASSWORD=password
```

## 🧪 Testing Scenarios

### 1. **Normal Operation**
- Search users and observe Redis-first caching
- Monitor cache hits and MySQL fallbacks
- View real-time connection status

### 2. **Redis Outage Simulation**
- Use "Crash Redis" to simulate Redis failure
- Observe automatic fallback to MySQL
- Monitor connection retry attempts

### 3. **Enhanced Restart Testing**
- Run "Enhanced Restart (45s)" simulation
- Watch real-time retry strategy in action
- Observe automatic recovery and cache restoration

### 4. **Large-Scale Testing**
- Run loop tests with millions of iterations
- Test Redis resilience during high load
- Monitor performance and success rates

## 📈 Performance & Resilience Metrics

### Key Metrics Tracked
- **Redis Connection Success Rate**: Percentage of successful Redis operations
- **MySQL Fallback Rate**: Frequency of MySQL fallback usage
- **Recovery Time**: Time to restore Redis connectivity
- **Cache Hit Rate**: Efficiency of Redis caching
- **Error Rates**: Connection and operation error frequencies

### Resilience Indicators
- **Automatic Reconnection**: Successful recovery from connection losses
- **Graceful Degradation**: Continued operation during Redis outages
- **Data Consistency**: Accurate data retrieval from both sources
- **Performance Maintenance**: Minimal impact during failover scenarios

## 🔍 Troubleshooting

### Common Issues
1. **Redis Connection Failures**: Check container health and network connectivity
2. **Stuck Retry Loops**: Monitor connection attempts and auto-reset functionality
3. **Cache Inconsistencies**: Verify TTL settings and cache warming processes

### Debug Tools
- **Container Logs**: Real-time logs from Redis, MySQL, and App containers
- **Connection History**: Track connection state changes over time
- **Health Checks**: Continuous monitoring of service availability

## 📚 Technical Details

### Redis Resilience Patterns
- **Circuit Breaker**: Automatic fallback to MySQL during Redis failures
- **Retry with Exponential Backoff**: Intelligent retry strategy for reconnections
- **Connection Pooling**: Efficient connection management
- **Health Checks**: Continuous monitoring of Redis availability

### Caching Strategy
- **Write-Through**: Data written to both Redis and MySQL
- **Read-Through**: Redis-first reading with MySQL fallback
- **TTL Management**: Configurable cache expiration
- **Cache Warming**: Automatic population from MySQL

## 🤝 Contributing

This PoC demonstrates production-ready Redis resilience patterns. For enhancements:
1. Test new resilience scenarios
2. Validate performance impact
3. Update configuration as needed
4. Document new features

## 📄 License

This project is for educational and demonstration purposes. 