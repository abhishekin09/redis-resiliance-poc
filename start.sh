#!/bin/bash

echo "🔌 Starting Redis Connection Resilience PoC..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Start Redis
echo "🐳 Starting Redis container..."
docker-compose up -d

# Wait for Redis to be ready
echo "⏳ Waiting for Redis to be ready..."
sleep 3

# Check if Redis is running
if docker ps | grep -q redis; then
    echo "✅ Redis is running"
else
    echo "❌ Failed to start Redis"
    exit 1
fi

# Start backend
echo "🚀 Starting backend server..."
cd backend
npm install
node index.js &
BACKEND_PID=$!

# Wait for backend to start
sleep 2

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📱 Frontend: Open frontend/index.html in your browser"
echo "🔗 Backend: http://localhost:3002"
echo "📊 Health: http://localhost:3002/health"
echo ""
echo "🧪 To simulate failures:"
echo "   💥 Crash Redis: docker stop redis"
echo "   🔄 Restart Redis: docker start redis"
echo ""
echo "Press Ctrl+C to stop all services"

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Stopping services..."
    kill $BACKEND_PID 2>/dev/null
    docker-compose down
    echo "✅ Cleanup complete"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Keep script running
wait $BACKEND_PID 