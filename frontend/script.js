let autoRefreshInterval = null;
let history = [];
let containerStatus = null;
let containerAutoRefreshInterval = null;
let allContainersData = null;
let ttlUpdateInterval = null;
let ttlTimers = new Map(); // Store TTL countdown timers
let logsAutoRefreshInterval = null;
let redisLogsData = null;
let logEventSource = null; // Server-Sent Events connection
let realTimeLogs = []; // Store real-time logs
let loopTestResults = null; // Store loop test results persistently

async function checkStatus() {
  try {
    const res = await fetch('http://localhost:8000/status');
    const data = await res.json();
    
    // Update status displays with color coding
    updateStatusDisplay('status', data.status);
    updateStatusDisplay('redis', data.redisStatus);
    
    // Update status indicator with enhanced color coding
    updateStatusIndicator(data);
    
    // Update retry information display
    updateRetryInfoDisplay(data);
    
    // Add to history
    addToHistory(data);
    
  } catch (error) {
    updateStatusDisplay('status', 'ERROR', 'error');
    updateStatusDisplay('redis', 'Connection Failed', 'error');
    updateStatusIndicator({ status: 'ERROR', redisStatus: 'Connection Failed' });
    
    addToHistory({
      status: 'ERROR',
      redisStatus: 'Connection Failed',
      error: error.message,
      timestamp: new Date()
    });
  }
}

// New function for auto-refresh that only updates information sections
async function updateStatusInfo() {
  try {
    const res = await fetch('http://localhost:8000/status');
    const data = await res.json();
    
    // Only update status displays and indicators (no history updates)
    updateStatusDisplay('status', data.status);
    updateStatusDisplay('redis', data.redisStatus);
    updateStatusIndicator(data);
    updateRetryInfoDisplay(data);
    
  } catch (error) {
    updateStatusDisplay('status', 'ERROR', 'error');
    updateStatusDisplay('redis', 'Connection Failed', 'error');
    updateStatusIndicator({ status: 'ERROR', redisStatus: 'Connection Failed' });
  }
}

// Function to update retry information display
function updateRetryInfoDisplay(data) {
  const retryInfoContainer = document.getElementById('retry-info');
  if (!retryInfoContainer) return;
  
  let retryInfoHTML = '';
  
  if (data.retryConfig) {
    retryInfoHTML += `
      <div class="bg-gray-700 border border-gray-600 p-4 rounded-lg mb-4">
        <h3 class="font-semibold text-gray-100 mb-3">🔄 Retry Strategy</h3>
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-gray-400">Max Retries:</span>
            <span class="text-blue-400 ml-2">${data.retryConfig.maxRetries}</span>
          </div>
          <div>
            <span class="text-gray-400">Base Delay:</span>
            <span class="text-blue-400 ml-2">${data.retryConfig.baseDelay}ms</span>
          </div>
          <div>
            <span class="text-gray-400">Max Delay:</span>
            <span class="text-blue-400 ml-2">${data.retryConfig.maxDelay}ms</span>
          </div>
          <div>
            <span class="text-gray-400">Backoff Multiplier:</span>
            <span class="text-blue-400 ml-2">${data.retryConfig.backoffMultiplier}x</span>
          </div>
        </div>
        <div class="mt-3">
          <span class="text-gray-400">Connection Attempts:</span>
          <span class="text-yellow-400 ml-2">${data.connectionAttempts || 0}</span>
        </div>
      </div>
    `;
  }
  
  if (data.healthCheck) {
    const healthStatus = data.healthCheck.enabled ? '🟢 Enabled' : '🔴 Disabled';
    retryInfoHTML += `
      <div class="bg-gray-700 border border-gray-600 p-4 rounded-lg mb-4">
        <h3 class="font-semibold text-gray-100 mb-3">💓 Health Check</h3>
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-gray-400">Status:</span>
            <span class="ml-2">${healthStatus}</span>
          </div>
          <div>
            <span class="text-gray-400">Interval:</span>
            <span class="text-blue-400 ml-2">${data.healthCheck.interval}ms</span>
          </div>
          <div>
            <span class="text-gray-400">Timeout:</span>
            <span class="text-blue-400 ml-2">${data.healthCheck.timeout}ms</span>
          </div>
        </div>
      </div>
    `;
  }
  
  if (data.recovery) {
    const recoveryStatus = data.recovery.monitoring ? '🟢 Active' : '🔴 Inactive';
    retryInfoHTML += `
      <div class="bg-gray-700 border border-gray-600 p-4 rounded-lg mb-4">
        <h3 class="font-semibold text-gray-100 mb-3">🔄 Recovery Monitoring</h3>
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-gray-400">Status:</span>
            <span class="ml-2">${recoveryStatus}</span>
          </div>
          <div>
            <span class="text-gray-400">Crash Timeout:</span>
            <span class="text-blue-400 ml-2">${data.recovery.crashTimeout}ms</span>
          </div>
          <div>
            <span class="text-gray-400">Restart Timeout:</span>
            <span class="text-blue-400 ml-2">${data.recovery.restartTimeout}ms</span>
          </div>
        </div>
      </div>
    `;
  }
  
  retryInfoContainer.innerHTML = retryInfoHTML;
}

function updateStatusDisplay(elementId, status, type = 'status') {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  element.textContent = status;
  
  // Remove existing color classes
  element.className = element.className.replace(/text-(green|red|yellow|blue|gray)-[0-9]+/g, '');
  
  // Add color coding based on status
  let colorClass = 'text-gray-100'; // default
  
  if (type === 'error') {
    colorClass = 'text-red-400';
  } else if (elementId === 'status') {
    if (status === 'OK') {
      colorClass = 'text-green-400';
    } else if (status === 'FAIL') {
      colorClass = 'text-red-400';
    } else {
      colorClass = 'text-yellow-400';
    }
  } else if (elementId === 'redis') {
    if (status === 'Connected') {
      colorClass = 'text-green-400';
    } else if (status === 'Auth Failed') {
      colorClass = 'text-red-400';
    } else if (status === 'Reconnecting' || status === 'Connecting') {
      colorClass = 'text-yellow-400';
    } else if (status === 'Disconnected') {
      colorClass = 'text-red-400';
    } else if (status === 'Error') {
      colorClass = 'text-red-400';
    } else {
      colorClass = 'text-gray-400';
    }
  }
  
  element.className += ` ${colorClass}`;
}

function updateStatusIndicator(data) {
  const indicator = document.getElementById('status-indicator');
  if (!indicator) return;
  
  // Remove existing color classes and animations
  indicator.className = indicator.className.replace(/bg-(green|red|yellow|blue|gray)-[0-9]+/g, '');
  indicator.className = indicator.className.replace(/animate-pulse/g, '');
  
  // Enhanced color coding logic
  let colorClass = 'bg-gray-600'; // default
  let animationClass = '';
  
  if (data.status === 'OK' && data.redisStatus === 'Connected') {
    colorClass = 'bg-green-500';
  } else if (data.status === 'FAIL' || data.redisStatus === 'Auth Failed' || data.redisStatus === 'Error') {
    colorClass = 'bg-red-500';
    animationClass = 'animate-pulse';
  } else if (data.redisStatus === 'Reconnecting' || data.redisStatus === 'Connecting') {
    colorClass = 'bg-yellow-500';
    animationClass = 'animate-pulse';
  } else if (data.redisStatus === 'Disconnected') {
    colorClass = 'bg-red-500';
    animationClass = 'animate-pulse';
  } else if (data.status === 'OK' && data.redisStatus !== 'Connected') {
    colorClass = 'bg-yellow-500';
    animationClass = 'animate-pulse';
  }
  
  indicator.className = `w-4 h-4 rounded-full ${colorClass} ${animationClass} transition-colors duration-300`;
}



async function loadAllContainers() {
  try {
    const response = await fetch('http://localhost:8000/containers/all');
    if (response.ok) {
      allContainersData = await response.json();
      updateAllContainersDisplay();
      updateContainerOverview();
      updateNetworkStatus();
    } else {
      console.error('Failed to load containers');
    }
  } catch (error) {
    console.error('Error loading containers:', error);
  }
}

function updateAllContainersDisplay() {
  if (!allContainersData) return;
  
  const containersDiv = document.getElementById('containersDetails');
  
  if (containersDiv) {
    const containersHtml = allContainersData.containers.map(container => {
      const stateColor = container.state === 'running' ? 'text-green-600' : 
                        container.state === 'exited' ? 'text-red-600' : 'text-yellow-600';
      
      const stateIcon = container.state === 'running' ? '🟢' : 
                       container.state === 'exited' ? '🔴' : '🟡';
      
      const portsHtml = container.ports.length > 0 ? 
        container.ports.map(port => `${port.PrivatePort}:${port.PublicPort}`).join(', ') : 'No ports';
      
      const createdAt = new Date(container.createdAt * 1000).toLocaleString();
      
      return `
        <div class="border border-gray-600 rounded-lg p-4 mb-4 bg-gray-800">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-3">
              <span class="text-xl">${stateIcon}</span>
              <div>
                <div class="font-semibold text-gray-100">${container.name}</div>
                <div class="text-xs text-gray-400">${container.containerId.substring(0, 12)}...</div>
              </div>
            </div>
            <span class="font-medium ${stateColor} text-lg">${container.state.toUpperCase()}</span>
          </div>
          
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 text-sm">
            <div class="space-y-2">
              <div class="text-gray-300"><span class="font-medium">Image:</span> ${container.image}</div>
              <div class="text-gray-300"><span class="font-medium">Status:</span> ${container.status}</div>
              <div class="text-gray-300"><span class="font-medium">Created:</span> ${createdAt}</div>
            </div>
            <div class="space-y-2">
              <div class="text-gray-300"><span class="font-medium">Ports:</span> ${portsHtml}</div>
              <div class="text-gray-300"><span class="font-medium">Labels:</span> ${Object.keys(container.labels).length}</div>
              <div class="text-gray-300"><span class="font-medium">Networks:</span> ${Object.keys(container.networkSettings.Networks || {}).length}</div>
            </div>
            <div class="space-y-2">
              <div class="text-gray-300"><span class="font-medium">Size:</span> ${(container.sizeRw / 1024 / 1024).toFixed(2)} MB</div>
              <div class="text-gray-300"><span class="font-medium">Memory:</span> ${(container.memory / 1024 / 1024).toFixed(2)} MB</div>
              <div class="text-gray-300"><span class="font-medium">CPU:</span> ${container.cpuPercent || 0}%</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    containersDiv.innerHTML = containersHtml;
  }
}

function updateContainerOverview() {
  if (!allContainersData) return;
  
  const containers = allContainersData.containers;
  const total = containers.length;
  const running = containers.filter(c => c.state === 'running').length;
  const stopped = containers.filter(c => c.state === 'exited').length;
  const other = total - running - stopped;
  
  document.getElementById('totalContainers').textContent = total;
  document.getElementById('runningContainers').textContent = running;
  document.getElementById('stoppedContainers').textContent = stopped;
  document.getElementById('otherContainers').textContent = other;
}

function updateNetworkStatus() {
  if (!allContainersData) return;
  
  const containers = allContainersData.containers;
  
  // Find specific containers
  const redisContainer = containers.find(c => c.name.includes('redis'));
  const mysqlContainer = containers.find(c => c.name.includes('mysql'));
  const appContainer = containers.find(c => c.name.includes('app'));
  
  document.getElementById('redisNetworkStatus').textContent = redisContainer ? 
    (redisContainer.state === 'running' ? '🟢 Online' : '🔴 Offline') : '⚪ Unknown';
  
  document.getElementById('mysqlNetworkStatus').textContent = mysqlContainer ? 
    (mysqlContainer.state === 'running' ? '🟢 Online' : '🔴 Offline') : '⚪ Unknown';
  
  document.getElementById('appNetworkStatus').textContent = appContainer ? 
    (appContainer.state === 'running' ? '🟢 Online' : '🔴 Offline') : '⚪ Unknown';
}

function toggleContainerAutoRefresh() {
  const btn = document.getElementById('container-auto-refresh-btn');
  const quickBtn = document.getElementById('quickAutoRefreshBtn');
  
  if (containerAutoRefreshInterval) {
    clearInterval(containerAutoRefreshInterval);
    containerAutoRefreshInterval = null;
    btn.textContent = '🔄 Auto Refresh: OFF';
    btn.className = 'bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg';
    quickBtn.textContent = '🔄 Auto Refresh';
    quickBtn.className = 'w-full bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors';
  } else {
    containerAutoRefreshInterval = setInterval(loadAllContainers, 3000);
    btn.textContent = '🔄 Auto Refresh: ON';
    btn.className = 'bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg';
    quickBtn.textContent = '🔄 Auto Refresh: ON';
    quickBtn.className = 'w-full bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors';
  }
}

// Start container auto-refresh automatically when page loads
function startContainerAutoRefresh() {
  const btn = document.getElementById('container-auto-refresh-btn');
  if (!containerAutoRefreshInterval) {
    containerAutoRefreshInterval = setInterval(loadAllContainers, 3000);
    btn.textContent = '🔄 Auto Refresh: ON';
    btn.className = 'bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-lg font-medium transition-colors';
  }
}

// Container Logs Functions
let containerLogsData = {
  redis: null,
  mysql: null,
  app: null
};

async function loadContainerLogs() {
  try {
    // Show the container logs section
    const resultDiv = document.getElementById('containerLogsResult');
    if (resultDiv) {
      resultDiv.classList.remove('hidden');
    }
    
    // Load logs for all containers
    await Promise.all([
      loadRedisLogs(),
      loadMySQLLogs(),
      loadAppLogs()
    ]);
    
    // Show Redis logs by default
    showContainerLogs('redis');
    
  } catch (error) {
    console.error('Error loading container logs:', error);
  }
}

async function loadRedisLogs() {
  try {
    const response = await fetch('http://localhost:8000/containers/redis/logs');
    if (response.ok) {
      containerLogsData.redis = await response.json();
      updateRedisLogsDisplay();
    } else {
      console.error('Failed to load Redis logs');
    }
  } catch (error) {
    console.error('Error loading Redis logs:', error);
  }
}

async function loadMySQLLogs() {
  try {
    const response = await fetch('http://localhost:8000/containers/mysql/logs');
    if (response.ok) {
      containerLogsData.mysql = await response.json();
      updateMySQLLogsDisplay();
    } else {
      console.error('Failed to load MySQL logs');
    }
  } catch (error) {
    console.error('Error loading MySQL logs:', error);
  }
}

async function loadAppLogs() {
  try {
    const response = await fetch('http://localhost:8000/containers/app/logs');
    if (response.ok) {
      containerLogsData.app = await response.json();
      updateAppLogsDisplay();
    } else {
      console.error('Failed to load App logs');
    }
  } catch (error) {
    console.error('Error loading App logs:', error);
  }
}

function showContainerLogs(containerType) {
  // Hide all sections first
  document.getElementById('redisLogsSection').classList.add('hidden');
  document.getElementById('mysqlLogsSection').classList.add('hidden');
  document.getElementById('appLogsSection').classList.add('hidden');
  document.getElementById('allLogsSection').classList.add('hidden');
  
  // Remove active class from all buttons
  document.getElementById('redisLogsBtn').classList.remove('bg-red-700');
  document.getElementById('mysqlLogsBtn').classList.remove('bg-blue-700');
  document.getElementById('appLogsBtn').classList.remove('bg-green-700');
  document.getElementById('allLogsBtn').classList.remove('bg-purple-700');
  
  // Show selected section and highlight button
  switch (containerType) {
    case 'redis':
      document.getElementById('redisLogsSection').classList.remove('hidden');
      document.getElementById('redisLogsBtn').classList.add('bg-red-700');
      break;
    case 'mysql':
      document.getElementById('mysqlLogsSection').classList.remove('hidden');
      document.getElementById('mysqlLogsBtn').classList.add('bg-blue-700');
      break;
    case 'app':
      document.getElementById('appLogsSection').classList.remove('hidden');
      document.getElementById('appLogsBtn').classList.add('bg-green-700');
      break;
    case 'all':
      document.getElementById('allLogsSection').classList.remove('hidden');
      document.getElementById('allLogsBtn').classList.add('bg-purple-700');
      updateAllLogsDisplay();
      break;
  }
}

function updateRedisLogsDisplay() {
  const logsDiv = document.getElementById('redisLogsDetails');
  
  if (logsDiv) {
    // Use real-time logs if available, otherwise use batch logs
    const logsToDisplay = realTimeLogs.length > 0 ? realTimeLogs : (containerLogsData.redis ? containerLogsData.redis.logs : []);
    
    const logsHtml = logsToDisplay.map(log => {
      const timestamp = new Date(log.timestamp).toLocaleTimeString();
      
      // Clean up the message for better display
      let cleanMessage = log.message;
      
      // Remove Docker stream headers and extract Redis log content
      if (cleanMessage.includes('*')) {
        const redisLogMatch = cleanMessage.match(/(\d+:[A-Z]+\s+\d+\s+\w+\s+\d+\s+\d+:\d+:\d+\.\d+\s+\*\s+.+)/);
        if (redisLogMatch) {
          cleanMessage = redisLogMatch[1];
        }
      }
      
      // Remove any remaining control characters
      cleanMessage = cleanMessage.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
      
      // Truncate if too long
      if (cleanMessage.length > 150) {
        cleanMessage = cleanMessage.substring(0, 150) + '...';
      }
      
      return `<div class="mb-1">
        <span class="text-blue-400">[${timestamp}]</span> 
        <span class="text-green-400">${cleanMessage}</span>
      </div>`;
    }).join('');
    
    logsDiv.innerHTML = logsHtml || '<div class="text-gray-500">No Redis logs available</div>';
    
    // Auto-scroll to bottom
    logsDiv.scrollTop = logsDiv.scrollHeight;
  }
}

function updateMySQLLogsDisplay() {
  const logsDiv = document.getElementById('mysqlLogsDetails');
  
  if (logsDiv) {
    const logsToDisplay = containerLogsData.mysql ? containerLogsData.mysql.logs : [];
    
    const logsHtml = logsToDisplay.map(log => {
      const timestamp = new Date(log.timestamp).toLocaleTimeString();
      let cleanMessage = log.message.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
      
      if (cleanMessage.length > 150) {
        cleanMessage = cleanMessage.substring(0, 150) + '...';
      }
      
      return `<div class="mb-1">
        <span class="text-blue-400">[${timestamp}]</span> 
        <span class="text-blue-400">${cleanMessage}</span>
      </div>`;
    }).join('');
    
    logsDiv.innerHTML = logsHtml || '<div class="text-gray-500">No MySQL logs available</div>';
    logsDiv.scrollTop = logsDiv.scrollHeight;
  }
}

function updateAppLogsDisplay() {
  const logsDiv = document.getElementById('appLogsDetails');
  
  if (logsDiv) {
    const logsToDisplay = containerLogsData.app ? containerLogsData.app.logs : [];
    
    const logsHtml = logsToDisplay.map(log => {
      const timestamp = new Date(log.timestamp).toLocaleTimeString();
      let cleanMessage = log.message.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
      
      if (cleanMessage.length > 150) {
        cleanMessage = cleanMessage.substring(0, 150) + '...';
      }
      
      return `<div class="mb-1">
        <span class="text-blue-400">[${timestamp}]</span> 
        <span class="text-green-400">${cleanMessage}</span>
      </div>`;
    }).join('');
    
    logsDiv.innerHTML = logsHtml || '<div class="text-gray-500">No App logs available</div>';
    logsDiv.scrollTop = logsDiv.scrollHeight;
  }
}

function updateAllLogsDisplay() {
  const logsDiv = document.getElementById('allLogsDetails');
  
  if (logsDiv) {
    const allLogs = [];
    
    // Combine logs from all containers
    if (containerLogsData.redis && containerLogsData.redis.logs) {
      containerLogsData.redis.logs.forEach(log => {
        allLogs.push({ ...log, container: 'Redis', color: 'text-red-400' });
      });
    }
    
    if (containerLogsData.mysql && containerLogsData.mysql.logs) {
      containerLogsData.mysql.logs.forEach(log => {
        allLogs.push({ ...log, container: 'MySQL', color: 'text-blue-400' });
      });
    }
    
    if (containerLogsData.app && containerLogsData.app.logs) {
      containerLogsData.app.logs.forEach(log => {
        allLogs.push({ ...log, container: 'App', color: 'text-green-400' });
      });
    }
    
    // Sort by timestamp
    allLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    const logsHtml = allLogs.map(log => {
      const timestamp = new Date(log.timestamp).toLocaleTimeString();
      let cleanMessage = log.message.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
      
      if (cleanMessage.length > 120) {
        cleanMessage = cleanMessage.substring(0, 120) + '...';
      }
      
      return `<div class="mb-1">
        <span class="text-gray-400">[${timestamp}]</span>
        <span class="text-yellow-400">[${log.container}]</span>
        <span class="${log.color}">${cleanMessage}</span>
      </div>`;
    }).join('');
    
    logsDiv.innerHTML = logsHtml || '<div class="text-gray-500">No logs available</div>';
    logsDiv.scrollTop = logsDiv.scrollHeight;
  }
}

// Real-time log streaming using Server-Sent Events
function startRealTimeLogStream() {
  if (logEventSource) {
    logEventSource.close();
  }
  
  try {
    logEventSource = new EventSource('http://localhost:8000/containers/redis/logs/stream');
    
    logEventSource.onopen = function(event) {
      console.log('[📋] Real-time log stream connected');
    };
    
    logEventSource.onmessage = function(event) {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'initial':
            // Initial logs received
            realTimeLogs = data.logs || [];
            updateRedisLogsDisplay();
            break;
            
          case 'log':
            // New real-time log received
            if (data.log) {
              realTimeLogs.push(data.log);
              
              // Keep only last 100 logs to prevent memory issues
              if (realTimeLogs.length > 100) {
                realTimeLogs = realTimeLogs.slice(-100);
              }
              
              updateRedisLogsDisplay();
            }
            break;
            
          case 'error':
            console.error('[❌] Log stream error:', data.error);
            break;
        }
      } catch (error) {
        console.error('[❌] Error parsing log stream data:', error);
      }
    };
    
    logEventSource.onerror = function(event) {
      console.error('[❌] Log stream connection error:', event);
      // Try to reconnect after 5 seconds
      setTimeout(() => {
        if (logEventSource && logEventSource.readyState === EventSource.CLOSED) {
          console.log('[📋] Attempting to reconnect to log stream...');
          startRealTimeLogStream();
        }
      }, 5000);
    };
    
  } catch (error) {
    console.error('[❌] Error starting log stream:', error);
  }
}

function stopRealTimeLogStream() {
  if (logEventSource) {
    logEventSource.close();
    logEventSource = null;
    console.log('[📋] Real-time log stream disconnected');
  }
}

function toggleLogsAutoRefresh() {
  const btn = document.getElementById('logs-auto-refresh-btn');
  
  if (logEventSource && logEventSource.readyState === EventSource.OPEN) {
    // Stop real-time streaming
    stopRealTimeLogStream();
    btn.textContent = '📋 Real-time Logs: OFF';
    btn.className = 'bg-purple-500 hover:bg-purple-600 text-white px-6 py-3 rounded-lg font-medium transition-colors';
  } else {
    // Start real-time streaming
    startRealTimeLogStream();
    btn.textContent = '📋 Real-time Logs: ON';
    btn.className = 'bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-lg font-medium transition-colors';
  }
}

// Start real-time logs automatically when page loads
function startLogsAutoRefresh() {
  const btn = document.getElementById('logs-auto-refresh-btn');
  if (!logEventSource || logEventSource.readyState !== EventSource.OPEN) {
    startRealTimeLogStream();
    btn.textContent = '📋 Real-time Logs: ON';
    btn.className = 'bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-lg font-medium transition-colors';
  }
}

function addToHistory(data) {
  const timestamp = new Date();
  const historyEntry = {
    ...data,
    timestamp: timestamp
  };
  
  history.unshift(historyEntry);
  if (history.length > 10) {
    history.pop();
  }
  
  updateHistoryDisplay();
}

function updateHistoryDisplay() {
  const historyDiv = document.getElementById('history');
  
  if (history.length === 0) {
    historyDiv.innerHTML = '<p class="text-gray-500 text-center">No history yet...</p>';
    return;
  }
  
  historyDiv.innerHTML = history.map(entry => {
    const time = entry.timestamp.toLocaleTimeString();
    const statusColor = entry.status === 'OK' ? 'text-green-600' : 'text-red-600';
    const redisColor = entry.redisStatus === 'Connected' ? 'text-green-600' : 'text-red-600';
    
    return `
      <div class="flex justify-between items-center p-2 bg-gray-50 rounded">
        <span class="text-sm text-gray-500">${time}</span>
        <span class="text-sm ${statusColor} font-medium">${entry.status}</span>
        <span class="text-sm ${redisColor} font-medium">${entry.redisStatus}</span>
      </div>
    `;
  }).join('');
}

// Auto-refresh configuration
let autoRefreshConfig = {
  enabled: false,
  interval: 3000, // 3 seconds default
  intervals: [2000, 3000, 5000] // Available intervals: 2s, 3s, 5s
};

function toggleAutoRefresh() {
  const btn = document.getElementById('auto-refresh-btn');
  
  if (autoRefreshInterval) {
    // If auto-refresh is active, change interval instead of stopping
    changeAutoRefreshInterval();
  } else {
    // Start auto-refresh
    autoRefreshConfig.enabled = true;
    autoRefreshInterval = setInterval(updateStatusInfo, autoRefreshConfig.interval);
    btn.textContent = `🔄 Auto Refresh: ON (${autoRefreshConfig.interval/1000}s)`;
    btn.className = 'bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg';
  }
}

function stopAutoRefresh() {
  const btn = document.getElementById('auto-refresh-btn');
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    autoRefreshConfig.enabled = false;
    btn.textContent = '🔄 Auto Refresh: OFF';
    btn.className = 'bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg';
  }
}

function changeAutoRefreshInterval() {
  if (autoRefreshConfig.enabled) {
    // Cycle through available intervals
    const currentIndex = autoRefreshConfig.intervals.indexOf(autoRefreshConfig.interval);
    const nextIndex = (currentIndex + 1) % autoRefreshConfig.intervals.length;
    autoRefreshConfig.interval = autoRefreshConfig.intervals[nextIndex];
    
    // Restart with new interval
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(updateStatusInfo, autoRefreshConfig.interval);
    
    const btn = document.getElementById('auto-refresh-btn');
    btn.textContent = `🔄 Auto Refresh: ON (${autoRefreshConfig.interval/1000}s)`;
    
    // Show brief feedback
    const originalText = btn.textContent;
    btn.textContent = `⏱️ ${autoRefreshConfig.interval/1000}s`;
    btn.className = 'bg-blue-600 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 transform scale-95 shadow-lg';
    
    setTimeout(() => {
      btn.textContent = originalText;
      btn.className = 'bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg';
    }, 500);
  }
}

async function simulateCrash() {
  const btn = document.querySelector('button[onclick="simulateCrash()"]');
  const originalText = btn.textContent;
  
  try {
    btn.textContent = '💥 Crashing...';
    btn.disabled = true;
    btn.className = 'bg-red-700 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform scale-95 shadow-lg cursor-not-allowed';
    
    // Show simulation status
    showSimulationStatus('Redis Crash Simulation');
    
    const response = await fetch('http://localhost:8000/simulate-crash', { method: 'POST' });
    const data = await response.json();
    
    if (response.ok) {
      addToHistory({
        status: 'SIMULATION',
        redisStatus: 'Crash Initiated',
        timestamp: new Date()
      });
      
      // Show success feedback
      btn.textContent = '✅ Crashed!';
      btn.className = 'bg-green-600 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform scale-95 shadow-lg';
      
      // Update simulation status
      updateSimulationStatus('Redis container crashed successfully', 'Crash Complete', 'Redis Down', 'MySQL');
      
      // Reset button after 2 seconds
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
        btn.className = 'bg-red-600 hover:bg-red-700 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg';
      }, 2000);
    }
  } catch (error) {
    console.error('Crash simulation failed:', error);
    btn.textContent = '❌ Failed';
    btn.className = 'bg-gray-600 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform scale-95 shadow-lg';
    
    updateSimulationStatus('Crash simulation failed', 'Failed', 'Error', '--');
    
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
      btn.className = 'bg-red-600 hover:bg-red-700 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg';
    }, 2000);
  }
}

async function simulateRestart() {
  const btn = document.querySelector('button[onclick="simulateRestart()"]');
  const originalText = btn.textContent;
  
  try {
    btn.textContent = '🔄 Restarting...';
    btn.disabled = true;
    btn.className = 'bg-yellow-700 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform scale-95 shadow-lg cursor-not-allowed';
    
    // Show simulation status
    showSimulationStatus('Redis Restart Simulation');
    
    const response = await fetch('http://localhost:8000/simulate-restart', { method: 'POST' });
    const data = await response.json();
    
    if (response.ok) {
      addToHistory({
        status: 'SIMULATION',
        redisStatus: 'Restart Initiated',
        timestamp: new Date()
      });
      
      // Show success feedback
      btn.textContent = '✅ Restarted!';
      btn.className = 'bg-green-600 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform scale-95 shadow-lg';
      
      // Update simulation status
      updateSimulationStatus('Redis container restarted successfully', 'Restart Complete', 'Redis Connected', 'Redis');
      
      // Reset button after 2 seconds
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
        btn.className = 'bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg';
      }, 2000);
    }
  } catch (error) {
    console.error('Restart simulation failed:', error);
    btn.textContent = '❌ Failed';
    btn.className = 'bg-gray-600 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform scale-95 shadow-lg';
    
    updateSimulationStatus('Restart simulation failed', 'Failed', 'Error', '--');
    
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
      btn.className = 'bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg';
    }, 2000);
  }
}

async function simulateRestartEnhanced() {
  const btn = document.querySelector('button[onclick="simulateRestartEnhanced()"]');
  const originalText = btn.textContent;
  const statusDiv = document.getElementById('enhancedRestartStatus');
  
  try {
    // Show status panel and disable button
    statusDiv.classList.remove('hidden');
    btn.textContent = '⏱️ Running...';
    btn.disabled = true;
    btn.className = 'bg-indigo-700 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform scale-95 shadow-lg cursor-not-allowed';
    
    // Initialize status display
    document.getElementById('restartProgressText').textContent = 'Starting enhanced restart simulation...';
    document.getElementById('restartProgressPercent').textContent = '0%';
    document.getElementById('restartProgressBar').style.width = '0%';
    document.getElementById('retryStrategyStatus').textContent = 'Initializing...';
    document.getElementById('connectionStatusDetails').textContent = 'Checking...';
    document.getElementById('timeStatusDetails').textContent = '--';
    document.getElementById('dataSourceStatus').textContent = '--';
    document.getElementById('restartLog').innerHTML = '<div class="text-gray-500">Starting simulation...</div>';
    
    // Create fetch request with streaming for real-time updates
    const response = await fetch('http://localhost:8000/simulate-restart-enhanced', {
      method: 'POST',
      headers: {
        'Accept': 'text/event-stream'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    // Process real-time updates
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            switch (data.type) {
              case 'start':
                addToLog(`🚀 ${data.message}`);
                break;
                
              case 'step':
                addToLog(`📋 Step ${data.step}: ${data.message}`);
                break;
                
              case 'retry_update':
                updateRetryStatus(data);
                break;
                
              case 'recovery_update':
                updateRecoveryStatus(data);
                break;
                
              case 'complete':
                addToLog(`✅ ${data.message}`);
                updateFinalStatus(data, true);
                break;
                
              case 'timeout':
                addToLog(`⏰ ${data.message}`);
                updateFinalStatus(data, false);
                break;
                
              case 'error':
                addToLog(`❌ Error: ${data.error}`);
                break;
            }
          } catch (error) {
            console.error('Error parsing SSE data:', error);
          }
        }
      }
    }
    
    // Reset button after completion
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
      btn.className = 'bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg';
    }, 3000);
    
  } catch (error) {
    console.error('Enhanced restart simulation failed:', error);
    addToLog(`❌ Simulation failed: ${error.message}`);
    
    btn.textContent = '❌ Failed';
    btn.className = 'bg-gray-600 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform scale-95 shadow-lg';
    
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
      btn.className = 'bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg';
    }, 3000);
  }
}

function addToLog(message) {
  const logDiv = document.getElementById('restartLog');
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = document.createElement('div');
  logEntry.innerHTML = `<span class="text-gray-500">[${timestamp}]</span> ${message}`;
  logDiv.appendChild(logEntry);
  logDiv.scrollTop = logDiv.scrollHeight;
}

function showSimulationStatus(title) {
  const statusDiv = document.getElementById('enhancedRestartStatus');
  statusDiv.classList.remove('hidden');
  
  // Update title
  document.querySelector('#enhancedRestartStatus h3').textContent = `⏱️ ${title}`;
  
  // Initialize status display
  document.getElementById('restartProgressText').textContent = 'Starting simulation...';
  document.getElementById('restartProgressPercent').textContent = '0%';
  document.getElementById('restartProgressBar').style.width = '0%';
  document.getElementById('retryStrategyStatus').textContent = 'Initializing...';
  document.getElementById('connectionStatusDetails').textContent = 'Checking...';
  document.getElementById('timeStatusDetails').textContent = '--';
  document.getElementById('dataSourceStatus').textContent = '--';
  
  // Clear log
  document.getElementById('restartLog').innerHTML = '<div class="text-gray-400">Simulation started...</div>';
}

function updateSimulationStatus(message, retryStatus, connectionStatus, dataSource) {
  document.getElementById('restartProgressText').textContent = message;
  document.getElementById('restartProgressPercent').textContent = '100%';
  document.getElementById('restartProgressBar').style.width = '100%';
  document.getElementById('retryStrategyStatus').textContent = retryStatus;
  document.getElementById('connectionStatusDetails').textContent = connectionStatus;
  document.getElementById('timeStatusDetails').textContent = new Date().toLocaleTimeString();
  document.getElementById('dataSourceStatus').textContent = dataSource;
  
  addToLog(`✅ ${message}`);
}

function updateRetryStatus(data) {
  // Update progress bar
  document.getElementById('restartProgressText').textContent = data.message;
  document.getElementById('restartProgressPercent').textContent = `${data.progress}%`;
  document.getElementById('restartProgressBar').style.width = `${data.progress}%`;
  
  // Update status details
  document.getElementById('retryStrategyStatus').textContent = `Retrying (${data.connectionAttempts} attempts)`;
  document.getElementById('connectionStatusDetails').textContent = data.redisStatus;
  document.getElementById('timeStatusDetails').textContent = `${data.elapsed}s elapsed, ${data.remaining}s remaining`;
  document.getElementById('dataSourceStatus').textContent = data.redisStatus === 'Connected' ? 'Redis' : 'MySQL';
  
  // Add to log
  addToLog(`🔄 ${data.message} - Status: ${data.redisStatus}`);
}

function updateRecoveryStatus(data) {
  // Update status details
  document.getElementById('retryStrategyStatus').textContent = `Recovery attempt ${data.attempt}/${data.maxAttempts}`;
  document.getElementById('connectionStatusDetails').textContent = data.redisStatus;
  document.getElementById('timeStatusDetails').textContent = `Recovery in progress...`;
  document.getElementById('dataSourceStatus').textContent = data.redisStatus === 'Connected' ? 'Redis' : 'MySQL';
  
  // Add to log
  addToLog(`🔄 ${data.message}`);
}

function updateFinalStatus(data, success) {
  // Update final status
  document.getElementById('retryStrategyStatus').textContent = success ? 'Recovery Successful' : 'Recovery Timeout';
  document.getElementById('connectionStatusDetails').textContent = data.finalStatus;
  document.getElementById('timeStatusDetails').textContent = `Total attempts: ${data.totalAttempts}`;
  document.getElementById('dataSourceStatus').textContent = success ? 'Redis' : 'MySQL';
  
  // Update progress to 100%
  document.getElementById('restartProgressText').textContent = success ? 'Redis successfully reconnected!' : 'Redis recovery timeout';
  document.getElementById('restartProgressPercent').textContent = '100%';
  document.getElementById('restartProgressBar').style.width = '100%';
  
  // Add to history
  addToHistory({
    status: 'ENHANCED_SIMULATION',
    redisStatus: success ? 'Recovery Successful' : 'Recovery Timeout',
    timestamp: new Date()
  });
}

async function simulateAuthFailure() {
  const btn = document.querySelector('button[onclick="simulateAuthFailure()"]');
  const originalText = btn.textContent;
  
  try {
    btn.textContent = '🔐 Failing Auth...';
    btn.disabled = true;
    btn.className = 'bg-purple-700 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform scale-95 shadow-lg cursor-not-allowed';
    
    // Show simulation status
    showSimulationStatus('Redis Auth Failure Simulation');
    
    const response = await fetch('http://localhost:8000/simulate-auth-failure', { method: 'POST' });
    const data = await response.json();
    
    if (response.ok) {
      addToHistory({
        status: 'SIMULATION',
        redisStatus: 'Auth Failure Initiated',
        timestamp: new Date()
      });
      
      // Show success feedback
      btn.textContent = '✅ Auth Failed!';
      btn.className = 'bg-red-600 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform scale-95 shadow-lg';
      
      // Update simulation status
      updateSimulationStatus('Redis authentication failed successfully', 'Auth Failed', 'Redis Disconnected', 'MySQL');
      
      // Reset button after 2 seconds
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
        btn.className = 'bg-purple-600 hover:bg-purple-700 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg';
      }, 2000);
    }
  } catch (error) {
    console.error('Auth failure simulation failed:', error);
    btn.textContent = '❌ Failed';
    btn.className = 'bg-gray-600 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform scale-95 shadow-lg';
    
    updateSimulationStatus('Auth failure simulation failed', 'Failed', 'Error', '--');
    
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
      btn.className = 'bg-purple-600 hover:bg-purple-700 text-white px-4 py-3 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg';
    }, 2000);
  }
}

async function clearRedisCache() {
  try {
    // Show simulation status
    showSimulationStatus('Redis Cache Clear Simulation');
    
    const response = await fetch('http://localhost:8000/clear-cache', { method: 'POST' });
    if (response.ok) {
      addToHistory({
        status: 'CACHE_CLEARED',
        redisStatus: 'Cache Cleared',
        timestamp: new Date()
      });
      
      // Update simulation status
      updateSimulationStatus('Redis cache cleared successfully', 'Cache Cleared', 'Redis Connected', 'MySQL (next search)');
      
      alert('🗑️ Redis cache cleared! Next user search will fetch from MySQL.');
    }
  } catch (error) {
    console.log('Cache clear endpoint not available');
    updateSimulationStatus('Cache clear failed - endpoint not available', 'Failed', 'Error', '--');
    alert('💡 Tip: Use Redis CLI to clear cache manually');
  }
}



async function searchUser() {
  const query = document.getElementById('searchQuery').value.trim();
  const userResult = document.getElementById('userResult');
  const userDetails = document.getElementById('userDetails');
  
  if (!query) {
    alert('Please enter a name or phone number');
    return;
  }

  try {
    userDetails.innerHTML = '<div class="text-blue-600">🔍 Searching...</div>';
    userResult.classList.remove('hidden');
    document.getElementById('allUsersResult').classList.add('hidden');
    
    const response = await fetch(`http://localhost:8000/user/search/${encodeURIComponent(query)}`);
    const data = await response.json();
    
    if (response.ok) {
      const user = data.user;
      const source = data.source;
      const sourceIcon = source === 'Redis' ? '📦' : '🗄️';
      
      userDetails.innerHTML = `
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <span class="font-medium">Source:</span>
            <span class="text-blue-600">${sourceIcon} ${source}</span>
          </div>
          <div><span class="font-medium">Name:</span> ${user.name}</div>
          <div><span class="font-medium">Phone:</span> ${user.phone_number}</div>
          <div><span class="font-medium">Email:</span> ${user.email || 'N/A'}</div>
          <div><span class="font-medium">Created:</span> ${new Date(user.created_at).toLocaleString()}</div>
        </div>
      `;
      
      addToHistory({
        status: 'USER_FOUND',
        redisStatus: `Found in ${source}`,
        timestamp: new Date()
      });
    } else {
      userDetails.innerHTML = `
        <div class="text-red-600">
          ❌ User not found with query: ${query}
        </div>
      `;
      
      addToHistory({
        status: 'USER_NOT_FOUND',
        redisStatus: 'Not Found',
        timestamp: new Date()
      });
    }
    
    // Automatically load all users and show side-by-side view
    await loadAllUsers();
    
  } catch (error) {
    userDetails.innerHTML = `
      <div class="text-red-600">
        ❌ Error: ${error.message}
      </div>
    `;
    
    addToHistory({
      status: 'ERROR',
      redisStatus: 'Search Failed',
      timestamp: new Date()
    });
  }
}

// Global variables to store data
let mysqlUsersData = null;
let redisKeysData = null;

async function loadAllUsers() {
  const allUsersResult = document.getElementById('allUsersResult');
  
  try {
    // Show loading state
    allUsersResult.classList.remove('hidden');
    document.getElementById('userResult').classList.add('hidden');
    
    // Load both MySQL and Redis data
    await Promise.all([
      loadMySQLUsers(),
      loadRedisKeys()
    ]);
    
    // Show side-by-side view by default
    showSideBySideView();
    
    addToHistory({
      status: 'ALL_USERS_LOADED',
      redisStatus: `${mysqlUsersData?.total || 0} MySQL, ${redisKeysData?.total || 0} Redis`,
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error('Error loading users:', error);
    addToHistory({
      status: 'ERROR',
      redisStatus: 'Load Failed',
      timestamp: new Date()
    });
  }
}

async function loadMySQLUsers() {
  try {
    const response = await fetch('http://localhost:8000/users/all');
    const data = await response.json();
    
    if (response.ok) {
      mysqlUsersData = data;
      return data;
    } else {
      throw new Error('Failed to load MySQL users');
    }
  } catch (error) {
    console.error('Error loading MySQL users:', error);
    mysqlUsersData = { users: [], total: 0, error: error.message };
    return mysqlUsersData;
  }
}

async function loadRedisKeys() {
  try {
    const response = await fetch('http://localhost:8000/redis/keys');
    const data = await response.json();
    
    if (response.ok) {
      redisKeysData = data;
      // Initialize TTL data for real-time updates
      initializeTTLData();
      return data;
    } else {
      throw new Error('Failed to load Redis keys');
    }
  } catch (error) {
    console.error('Error loading Redis keys:', error);
    redisKeysData = { keys: [], total: 0, error: error.message };
    return redisKeysData;
  }
}

function showMySQLView() {
  hideAllViews();
  document.getElementById('mysqlView').classList.remove('hidden');
  updateButtonStates('mysql');
  
  if (mysqlUsersData) {
    const users = mysqlUsersData.users;
    document.getElementById('mysqlUsersDetails').innerHTML = `
      <div class="space-y-3">
        <div class="text-sm text-gray-500 mb-2">Total: ${mysqlUsersData.total} users</div>
        ${users.map(user => {
          const sourceIcon = user.source === 'Redis' ? '📦' : '🗄️';
          return `
            <div class="border-l-4 border-blue-200 pl-3 py-2 bg-white rounded">
              <div class="flex items-center justify-between">
                <div class="font-medium">${user.name}</div>
                <div class="text-xs text-blue-600">${sourceIcon} ${user.source}</div>
              </div>
              <div class="text-sm text-gray-600">${user.phone_number}</div>
              <div class="text-xs text-gray-500">${user.email || 'N/A'}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
}

function showRedisView() {
  hideAllViews();
  document.getElementById('redisView').classList.remove('hidden');
  updateButtonStates('redis');
  
  if (redisKeysData) {
    const keys = redisKeysData.keys;
    document.getElementById('redisKeysDetails').innerHTML = `
      <div class="space-y-3">
        <div class="text-sm text-gray-500 mb-2">Total: ${redisKeysData.total} keys</div>
        ${keys.length > 0 ? keys.map(keyData => {
          const user = keyData.value;
          const ttlColor = keyData.ttl > 0 ? 'text-green-600' : 'text-red-600';
          return `
            <div class="border-l-4 border-green-200 pl-3 py-2 bg-white rounded">
              <div class="flex items-center justify-between">
                <div class="font-medium">${user.name || 'Unknown'}</div>
                <div class="text-xs text-green-600">📦 Redis</div>
              </div>
              <div class="text-sm text-gray-600">${user.phone_number || 'N/A'}</div>
              <div class="text-xs text-gray-500">${user.email || 'N/A'}</div>
              <div class="text-xs ${ttlColor}" data-ttl-key="${keyData.key}">TTL: ${keyData.ttlFormatted}</div>
              <div class="text-xs text-gray-400">Key: ${keyData.key}</div>
            </div>
          `;
        }).join('') : `
          <div class="text-center text-gray-500 py-4">
            No Redis keys found
          </div>
        `}
      </div>
    `;
    
    // Initialize TTL data and start real-time updates
    initializeTTLData();
    startTTLUpdates();
  }
}

function showSideBySideView() {
  hideAllViews();
  document.getElementById('sideBySideView').classList.remove('hidden');
  updateButtonStates('sideBySide');
  
  // Update MySQL side
  if (mysqlUsersData) {
    const users = mysqlUsersData.users;
    document.getElementById('sideBySideMySQL').innerHTML = `
      <div class="space-y-3">
        <div class="text-sm text-gray-500 mb-2">Total: ${mysqlUsersData.total} users</div>
        ${users.map(user => {
          const sourceIcon = user.source === 'Redis' ? '📦' : '🗄️';
          return `
            <div class="border-l-4 border-blue-200 pl-3 py-2 bg-white rounded">
              <div class="flex items-center justify-between">
                <div class="font-medium">${user.name}</div>
                <div class="text-xs text-blue-600">${sourceIcon} ${user.source}</div>
              </div>
              <div class="text-sm text-gray-600">${user.phone_number}</div>
              <div class="text-xs text-gray-500">${user.email || 'N/A'}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
  
  // Update Redis side
  if (redisKeysData) {
    const keys = redisKeysData.keys;
    document.getElementById('sideBySideRedis').innerHTML = `
      <div class="space-y-3">
        <div class="text-sm text-gray-500 mb-2">Total: ${redisKeysData.total} keys</div>
        ${keys.length > 0 ? keys.map(keyData => {
          const user = keyData.value;
          const ttlColor = keyData.ttl > 0 ? 'text-green-600' : 'text-red-600';
          return `
            <div class="border-l-4 border-green-200 pl-3 py-2 bg-white rounded">
              <div class="flex items-center justify-between">
                <div class="font-medium">${user.name || 'Unknown'}</div>
                <div class="text-xs text-green-600">📦 Redis</div>
              </div>
              <div class="text-sm text-gray-600">${user.phone_number || 'N/A'}</div>
              <div class="text-xs text-gray-500">${user.email || 'N/A'}</div>
              <div class="text-xs ${ttlColor}" data-ttl-key="${keyData.key}">TTL: ${keyData.ttlFormatted}</div>
              <div class="text-xs text-gray-400">Key: ${keyData.key}</div>
            </div>
          `;
        }).join('') : `
          <div class="text-center text-gray-500 py-4">
            No Redis keys found
          </div>
        `}
      </div>
    `;
    
    // Initialize TTL data and start real-time updates
    initializeTTLData();
    startTTLUpdates();
  }
}

function hideAllViews() {
  document.getElementById('mysqlView').classList.add('hidden');
  document.getElementById('redisView').classList.add('hidden');
  document.getElementById('sideBySideView').classList.add('hidden');
  
  // Stop TTL updates when hiding views
  stopTTLUpdates();
}

function updateButtonStates(activeView) {
  // Reset all buttons to primary color
  document.getElementById('mysqlViewBtn').className = 'btn-gradient-primary px-6 py-4 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 text-lg';
  document.getElementById('redisViewBtn').className = 'btn-gradient-primary px-6 py-4 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 text-lg';
  document.getElementById('sideBySideViewBtn').className = 'btn-gradient-primary px-6 py-4 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 text-lg';
  
  // Highlight active button with enhanced gradient effect
  switch(activeView) {
    case 'mysql':
      document.getElementById('mysqlViewBtn').className = 'btn-gradient-primary px-6 py-4 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 text-lg';
      break;
    case 'redis':
      document.getElementById('redisViewBtn').className = 'btn-gradient-primary px-6 py-4 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 text-lg';
      break;
    case 'sideBySide':
      document.getElementById('sideBySideViewBtn').className = 'btn-gradient-primary px-6 py-4 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 text-lg';
      break;
  }
}

// TTL Real-time update functions
function startTTLUpdates() {
  // Clear any existing interval
  if (ttlUpdateInterval) {
    clearInterval(ttlUpdateInterval);
  }
  
  // Start updating TTL every second
  ttlUpdateInterval = setInterval(updateAllTTLDisplays, 1000);
}

function stopTTLUpdates() {
  if (ttlUpdateInterval) {
    clearInterval(ttlUpdateInterval);
    ttlUpdateInterval = null;
  }
}

function updateAllTTLDisplays() {
  if (!redisKeysData || !redisKeysData.keys) return;
  
  // Update TTL for each key
  redisKeysData.keys.forEach(keyData => {
    updateTTLDisplay(keyData);
  });
}

function updateTTLDisplay(keyData) {
  const key = keyData.key;
  const ttlElement = document.querySelector(`[data-ttl-key="${key}"]`);
  
  if (ttlElement) {
    const currentTime = Math.floor(Date.now() / 1000);
    const expiryTime = keyData.expiryTime || (currentTime + keyData.ttl);
    const remainingTTL = Math.max(0, expiryTime - currentTime);
    
    // Update the TTL display
    const formattedTTL = formatTTL(remainingTTL);
    const ttlColor = remainingTTL > 0 ? 'text-green-600' : 'text-red-600';
    
    ttlElement.innerHTML = `
      <span class="text-xs ${ttlColor}">TTL: ${formattedTTL}</span>
    `;
    
    // If TTL is 0, mark as expired
    if (remainingTTL <= 0) {
      ttlElement.innerHTML = `
        <span class="text-xs text-red-600">TTL: Expired</span>
      `;
    }
  }
}

function formatTTL(seconds) {
  if (seconds <= 0) return 'Expired';
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${remainingSeconds}s`;
  }
}

function initializeTTLData() {
  if (!redisKeysData || !redisKeysData.keys) return;
  
  const currentTime = Math.floor(Date.now() / 1000);
  
  // Add expiry time to each key data
  redisKeysData.keys.forEach(keyData => {
    keyData.expiryTime = currentTime + keyData.ttl;
  });
}

async function runLoopTest() {
  const query = document.getElementById('loopQuery').value.trim();
  const count = document.getElementById('loopCount').value || 100;
  const loopTestResult = document.getElementById('loopTestResult');
  const loopTestDetails = document.getElementById('loopTestDetails');
  
  if (!query) {
    alert('Please enter a name or phone number to test');
    return;
  }

  // Check if there are existing results and ask user if they want to clear them
  if (loopTestResults) {
    const shouldContinue = confirm('Previous loop test results exist. Do you want to run a new test? (Previous results will be replaced)');
    if (!shouldContinue) {
      return;
    }
  }

  try {
    loopTestDetails.innerHTML = `
      <div class="text-blue-600 mb-4">
        🔄 Running ${count} iterations for: ${query}
        <div class="mt-2 text-sm">Testing Redis resilience with fallback to MySQL...</div>
      </div>
      <div id="loopProgress" class="mb-4">
        <div class="bg-gray-600 rounded-full h-2">
          <div id="progressBar" class="bg-blue-600 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
        </div>
        <div class="text-sm text-gray-400 mt-2">
          <span id="currentIteration">0</span> / ${count} iterations completed
        </span>
      </div>
    `;
    loopTestResult.classList.remove('hidden');
    
    // Run the loop test with detailed progress tracking
    const results = await runDetailedLoopTest(query, count);
    
    // Display results
    displayLoopTestResults(results, query, count);
    
  } catch (error) {
    loopTestDetails.innerHTML = `
      <div class="text-red-600">
        ❌ Error: ${error.message}
      </div>
    `;
    
    addToHistory({
      status: 'ERROR',
      redisStatus: 'Loop Test Failed',
      timestamp: new Date()
    });
  }
}

async function runDetailedLoopTest(query, count) {
  const results = {
    successful: 0,
    failed: 0,
    redisCount: 0,
    mysqlCount: 0,
    statusCodes: {},
    errors: [],
    iterations: [],
    redisRestartDetected: false,
    redisRecoveryTime: null
  };
  
  // Check if user wants real-time updates (for large iterations)
  const useRealTime = count > 1000;
  
  if (useRealTime) {
    return await runRealTimeLoopTest(query, count, results);
  } else {
    return await runStandardLoopTest(query, count, results);
  }
}

async function runRealTimeLoopTest(query, count, results) {
  try {
    // Set up progress display
    const progressBar = document.getElementById('progressBar');
    const currentIteration = document.getElementById('currentIteration');
    const loopTestDetails = document.getElementById('loopTestDetails');
    
    // Initialize progress
    progressBar.style.width = '0%';
    currentIteration.textContent = '0';
    
    // Show real-time status
    loopTestDetails.innerHTML = `
      <div class="bg-blue-900 border border-blue-600 p-4 rounded-lg">
        <h4 class="font-semibold text-blue-200 mb-2">🔄 Real-time Loop Test in Progress</h4>
        <div class="text-sm text-blue-300">
          <div>Query: <span class="font-semibold">${query}</span></div>
          <div>Target: <span class="font-semibold">${count.toLocaleString()}</span> iterations</div>
          <div>Status: <span class="text-yellow-400 font-semibold">Running...</span></div>
        </div>
      </div>
    `;
    
    // Create fetch request with streaming for real-time updates
    const response = await fetch(`http://localhost:8000/test-loop/${encodeURIComponent(query)}/${count}`, {
      method: 'POST',
      headers: {
        'Accept': 'text/event-stream'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    return new Promise(async (resolve, reject) => {
      try {
        let buffer = '';
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            break;
          }
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                switch (data.type) {
                  case 'start':
                    console.log('Loop test started:', data.message);
                    break;
                    
                  case 'progress':
                    // Update progress bar and current iteration
                    const percentage = data.percentage;
                    progressBar.style.width = `${percentage}%`;
                    currentIteration.textContent = data.current.toLocaleString();
                    
                    // Update real-time status
                    loopTestDetails.innerHTML = `
                      <div class="bg-blue-900 border border-blue-600 p-4 rounded-lg">
                        <h4 class="font-semibold text-blue-200 mb-2">🔄 Real-time Loop Test in Progress</h4>
                        <div class="text-sm text-blue-300">
                          <div>Query: <span class="font-semibold">${query}</span></div>
                          <div>Progress: <span class="font-semibold text-green-400">${data.current.toLocaleString()} / ${data.total.toLocaleString()}</span></div>
                          <div>Percentage: <span class="font-semibold text-yellow-400">${percentage}%</span></div>
                          <div>Status: <span class="text-yellow-400 font-semibold">Running...</span></div>
                        </div>
                      </div>
                    `;
                    break;
                    
                  case 'complete':
                    // Process final results
                    results.successful = data.successfulRequests;
                    results.failed = data.failedRequests;
                    results.redisCount = data.redisRequests;
                    results.mysqlCount = data.mysqlRequests;
                    results.redisRestartDetected = data.redisRestartDetected;
                    results.redisRecoveryTime = data.redisRecoveryTime;
                    
                    // Calculate status codes
                    results.statusCodes = {
                      '200': results.successful,
                      '404': results.failed
                    };
                    
                    // Update progress to 100%
                    progressBar.style.width = '100%';
                    currentIteration.textContent = data.totalIterations.toLocaleString();
                    
                    console.log('Loop test completed:', data.message);
                    resolve(results);
                    return;
                    
                  case 'error':
                    console.error('Loop test error:', data.message);
                    reject(new Error(data.message));
                    return;
                }
              } catch (error) {
                console.error('Error parsing SSE data:', error);
              }
            }
          }
        }
        
        // If we get here, the stream ended without a complete message
        reject(new Error('Stream ended unexpectedly'));
        
      } catch (error) {
        console.error('Error reading stream:', error);
        reject(error);
      }
    });
    
  } catch (error) {
    console.error('Error in real-time loop test:', error);
    results.failed = count;
    results.errors.push({
      iteration: 1,
      error: error.message
    });
    return results;
  }
}

async function runStandardLoopTest(query, count, results) {
  try {
    // Use the enhanced loop test endpoint that handles Redis restarts
    const response = await fetch(`http://localhost:8000/test-loop/${encodeURIComponent(query)}/${count}`, {
      method: 'POST'
    });
    
    if (response.ok) {
      const data = await response.json();
      
      // Update progress to 100% since the backend handles all iterations
      document.getElementById('progressBar').style.width = '100%';
      document.getElementById('currentIteration').textContent = count;
      
      // Process the results from the backend
      results.successful = data.successfulRequests;
      results.failed = data.failedRequests;
      results.redisCount = data.redisRequests;
      results.mysqlCount = data.mysqlRequests;
      results.redisRestartDetected = data.redisRestartDetected;
      results.redisRecoveryTime = data.redisRecoveryTime;
      
      // Process individual iteration results
      data.results.forEach(result => {
        if (result.user) {
          results.iterations.push({
            iteration: result.iteration,
            source: result.source,
            redisStatus: result.redisStatus,
            success: true
          });
        } else {
          results.failed++;
          results.errors.push({
            iteration: result.iteration,
            error: result.error || 'User not found',
            redisStatus: result.redisStatus
          });
        }
      });
      
      // Calculate status codes (simplified since backend handles the actual HTTP calls)
      results.statusCodes = {
        '200': results.successful,
        '404': results.failed
      };
      
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
  } catch (error) {
    console.error('Error in standard loop test:', error);
    results.failed = count;
    results.errors.push({
      iteration: 1,
      error: error.message
    });
  }
  
  return results;
}

function displayLoopTestResults(results, query, count) {
  const loopTestDetails = document.getElementById('loopTestDetails');
  
  // Store results globally for persistence
  loopTestResults = { results, query, count, timestamp: new Date() };
  
  // Create status code breakdown
  const statusCodeHtml = Object.entries(results.statusCodes)
    .map(([code, count]) => {
      const color = code >= 200 && code < 300 ? 'text-green-400' : 
                   code >= 400 && code < 500 ? 'text-yellow-400' : 'text-red-400';
      return `<span class="${color} font-semibold">${code}: ${count}</span>`;
    })
    .join(' | ');
  
  loopTestDetails.innerHTML = `
    <div class="space-y-6">
      <!-- Clear Results Button -->
      <div class="flex justify-end">
        <button onclick="clearLoopTestResults()" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200 transform hover:scale-105 shadow-lg">
          🗑️ Clear Results
        </button>
      </div>
      
      <!-- Summary Cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-green-900 border border-green-600 p-4 rounded-lg">
          <div class="font-medium text-green-200">✅ Successful</div>
          <div class="text-green-400 text-2xl font-bold">${results.successful}</div>
        </div>
        <div class="bg-red-900 border border-red-600 p-4 rounded-lg">
          <div class="font-medium text-red-200">❌ Failed</div>
          <div class="text-red-400 text-2xl font-bold">${results.failed}</div>
        </div>
        <div class="bg-blue-900 border border-blue-600 p-4 rounded-lg">
          <div class="font-medium text-blue-200">📦 Redis</div>
          <div class="text-blue-400 text-2xl font-bold">${results.redisCount}</div>
        </div>
        <div class="bg-yellow-900 border border-yellow-600 p-4 rounded-lg">
          <div class="font-medium text-yellow-200">🗄️ MySQL</div>
          <div class="text-yellow-400 text-2xl font-bold">${results.mysqlCount}</div>
        </div>
      </div>
      
      <!-- Redis Restart Information -->
      ${results.redisRestartDetected ? `
        <div class="bg-orange-900 border border-orange-600 p-4 rounded-lg">
          <h4 class="font-semibold text-orange-200 mb-3">🔄 Redis Restart Detected</h4>
          <div class="text-sm text-orange-300">
            <div class="mb-2">
              <span class="font-medium">Status:</span> 
              <span class="text-green-400">✅ System continued operating with MySQL fallback</span>
            </div>
            ${results.redisRecoveryTime ? `
              <div class="mb-2">
                <span class="font-medium">Recovery Time:</span> 
                <span class="text-green-400">${new Date(results.redisRecoveryTime).toLocaleTimeString()}</span>
              </div>
              <div>
                <span class="font-medium">Behavior:</span> 
                <span class="text-green-400">✅ Redis automatically resumed after restart</span>
              </div>
            ` : `
              <div>
                <span class="font-medium">Status:</span> 
                <span class="text-yellow-400">⚠️ Redis still recovering or not yet back online</span>
              </div>
            `}
          </div>
        </div>
      ` : `
        <div class="bg-green-900 border border-green-600 p-4 rounded-lg">
          <h4 class="font-semibold text-green-200 mb-3">✅ Redis Stability</h4>
          <div class="text-sm text-green-300">
            <div>Redis remained stable throughout the entire test</div>
            <div>No restarts or connection issues detected</div>
          </div>
        </div>
      `}
      
      <!-- Status Codes -->
      <div class="bg-gray-700 border border-gray-600 p-4 rounded-lg">
        <h4 class="font-semibold text-gray-200 mb-3">📊 HTTP Status Codes</h4>
        <div class="text-sm text-gray-300">
          ${statusCodeHtml}
        </div>
      </div>
      
      <!-- Error Summary -->
      ${results.errors.length > 0 ? `
        <div class="bg-red-900 border border-red-600 p-4 rounded-lg">
          <h4 class="font-semibold text-red-200 mb-3">🚨 Error Summary (${results.errors.length} errors)</h4>
          <div class="text-sm text-red-300 max-h-32 overflow-y-auto">
            ${results.errors.slice(0, 10).map(error => 
              `<div>Iteration ${error.iteration}: ${error.error}</div>`
            ).join('')}
            ${results.errors.length > 10 ? `<div class="text-red-400">... and ${results.errors.length - 10} more errors</div>` : ''}
          </div>
        </div>
      ` : ''}
      
      <!-- Test Info -->
      <div class="text-xs text-gray-500 text-center">
        Query: ${query} | Total Iterations: ${count} | 
        Redis Success Rate: ${((results.redisCount / results.successful) * 100).toFixed(1)}% |
        Overall Success Rate: ${((results.successful / count) * 100).toFixed(1)}%
      </div>
    </div>
  `;
  
  addToHistory({
    status: 'LOOP_TEST_COMPLETE',
    redisStatus: `${results.redisCount} Redis, ${results.mysqlCount} MySQL`,
    timestamp: new Date()
  });
}

// Function to clear loop test results
function clearLoopTestResults() {
  loopTestResults = null;
  const loopTestDetails = document.getElementById('loopTestDetails');
  const loopTestResult = document.getElementById('loopTestResult');
  
  // Hide the results section
  loopTestResult.classList.add('hidden');
  
  // Clear the details
  loopTestDetails.innerHTML = `
    <div class="text-gray-400 text-center py-8">
      <div class="text-2xl mb-2">📊</div>
      <div>No loop test results available</div>
      <div class="text-sm mt-2">Run a loop test to see results here</div>
    </div>
  `;
}

// Initialize on page load
window.onload = function() {
  checkStatus();
  
  // Load containers immediately
  loadAllContainers();
  
  // Load container logs and show all logs by default
  setTimeout(() => {
    loadContainerLogs();
    showContainerLogs('all');
  }, 1500);
  
  // Restore loop test results if they exist
  if (loopTestResults) {
    const loopTestResult = document.getElementById('loopTestResult');
    loopTestResult.classList.remove('hidden');
    displayLoopTestResults(loopTestResults.results, loopTestResults.query, loopTestResults.count);
  }
  
  // Start auto-refresh after 5 seconds
  setTimeout(() => {
    if (!autoRefreshInterval) {
      toggleAutoRefresh();
    }
  }, 5000);
  
  // Start container auto-refresh immediately
  setTimeout(() => {
    startContainerAutoRefresh();
  }, 1000);
  
  // Start logs auto-refresh after 2 seconds
  setTimeout(() => {
    startLogsAutoRefresh();
  }, 2000);
};

// POC Document Modal Functions
function showPOCDocument() {
  document.getElementById('pocModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function hidePOCDocument() {
  document.getElementById('pocModal').classList.add('hidden');
  document.body.style.overflow = 'auto';
}

// Close modal when clicking outside
document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('pocModal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        hidePOCDocument();
      }
    });
  }
}); 