# Use Node.js Alpine as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files for backend
COPY backend/package*.json ./backend/

# Install backend dependencies
WORKDIR /app/backend
RUN npm config set strict-ssl false && npm install --omit=dev

# Copy backend source code
COPY backend/ ./

# Copy frontend files to backend public directory
WORKDIR /app
COPY frontend/ ./backend/public/

# Expose port 3002
EXPOSE 3002

# Start the backend application
WORKDIR /app/backend
CMD ["node", "index.js"] 