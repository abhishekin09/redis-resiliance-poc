#!/bin/bash

echo "🧪 Testing Redis Connection Resilience PoC..."
echo ""

# Test if Redis is running
echo "1. Testing Redis connection..."
if docker ps | grep -q redis; then
    echo "✅ Redis container is running"
else
    echo "❌ Redis container is not running"
    echo "   Run: docker-compose up -d"
    exit 1
fi

# Test if backend is running
echo "2. Testing backend API..."
if curl -s http://localhost:3002/health > /dev/null; then
    echo "✅ Backend API is responding"
else
    echo "❌ Backend API is not responding"
    echo "   Run: cd backend && node index.js"
    exit 1
fi

# Test Redis connection through API
echo "3. Testing Redis connection through API..."
RESPONSE=$(curl -s http://localhost:3002/status)
if echo "$RESPONSE" | grep -q '"status":"OK"'; then
    echo "✅ Redis connection is working"
    echo "   Response: $RESPONSE"
else
    echo "❌ Redis connection failed"
    echo "   Response: $RESPONSE"
fi

echo ""
echo "🎉 All tests completed!"
echo ""
echo "📱 Open frontend/index.html in your browser to see the UI"
echo "🧪 Try stopping Redis with: docker stop redis"
echo "🔄 Then restart it with: docker start redis" 