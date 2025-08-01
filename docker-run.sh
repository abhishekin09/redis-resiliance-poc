#!/bin/bash

# Redis Resilience PoC Docker Management Script

case "$1" in
  "start")
    echo "🚀 Starting Redis Resilience PoC..."
    docker-compose up -d
    echo "✅ Services started!"
    echo "📱 Frontend: http://localhost:8000"
    echo "🔗 API: http://localhost:8000/health"
    echo "📊 Status: http://localhost:8000/status"
    ;;
  "stop")
    echo "🛑 Stopping Redis Resilience PoC..."
    docker-compose down
    echo "✅ Services stopped!"
    ;;
  "restart")
    echo "🔄 Restarting Redis Resilience PoC..."
    docker-compose down
    docker-compose up -d
    echo "✅ Services restarted!"
    ;;
  "build")
    echo "🔨 Building Docker image..."
    docker-compose build --no-cache
    echo "✅ Image built!"
    ;;
  "logs")
    echo "📋 Showing logs..."
    docker-compose logs -f
    ;;
  "status")
    echo "📊 Service Status:"
    docker-compose ps
    echo ""
    echo "🔍 Health Check:"
    curl -s http://localhost:8000/health | jq . 2>/dev/null || echo "❌ Service not responding"
    ;;
  "test")
    echo "🧪 Testing Redis connection..."
    curl -s http://localhost:8000/status | jq . 2>/dev/null || echo "❌ Service not responding"
    ;;
  "clean")
    echo "🧹 Cleaning up..."
    docker-compose down --volumes --remove-orphans
    docker system prune -f
    echo "✅ Cleanup complete!"
    ;;
  *)
    echo "🔌 Redis Resilience PoC Docker Management"
    echo ""
    echo "Usage: $0 {start|stop|restart|build|logs|status|test|clean}"
    echo ""
    echo "Commands:"
    echo "  start   - Start the application"
    echo "  stop    - Stop the application"
    echo "  restart - Restart the application"
    echo "  build   - Build the Docker image"
    echo "  logs    - Show application logs"
    echo "  status  - Show service status and health"
    echo "  test    - Test Redis connection"
    echo "  clean   - Clean up Docker resources"
    echo ""
    echo "Access Points:"
    echo "  📱 Frontend: http://localhost:8000"
    echo "  🔗 API Health: http://localhost:8000/health"
    echo "  📊 API Status: http://localhost:8000/status"
    ;;
esac 