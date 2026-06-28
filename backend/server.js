// server.js
// The main entry point of the application.
// This file:
//   1. Creates the Express app
//   2. Connects middleware (CORS, JSON parsing)
//   3. Mounts all route groups
//   4. Attaches Socket.IO for real-time features
//   5. Starts the HTTP server

require('dotenv').config(); // Load .env file first

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

// Import our custom modules
const { initSocket } = require('./config/socket');
const { errorHandler } = require('./middleware/errorHandler');

// Import route files
const authRoutes          = require('./routes/authRoutes');
const bookingRoutes       = require('./routes/bookingRoutes');
const driverRoutes        = require('./routes/driverRoutes');
const ratingRoutes        = require('./routes/ratingRoutes');
const mapRoutes           = require('./routes/mapRoutes');
const fareRoutes          = require('./routes/fareRoutes');
const notificationRoutes  = require('./routes/notificationRoutes');
const customerRoutes      = require('./routes/customerRoutes');
const statsRoutes         = require('./routes/statsRoutes');

// ─────────────────────────────────────────────
// 1. Create Express App and HTTP Server
// ─────────────────────────────────────────────
const app = express();
const httpServer = http.createServer(app); // Wrap Express in an HTTP server for Socket.IO

// ─────────────────────────────────────────────
// 2. Initialize Socket.IO
// ─────────────────────────────────────────────
initSocket(httpServer);

// ─────────────────────────────────────────────
// 3. Global Middleware
// ─────────────────────────────────────────────

// CORS: Allow all localhost/127.0.0.1 origins for local development
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    // Allow any localhost or 127.0.0.1 port
    const allowed = [
      /^http:\/\/localhost:\d+$/,
      /^http:\/\/127\.0\.0\.1:\d+$/,
    ];
    if (allowed.some(pattern => pattern.test(origin))) {
      return callback(null, true);
    }
    // Also allow the explicit FRONTEND_URL from .env
    if (origin === process.env.FRONTEND_URL) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Parse incoming JSON bodies (req.body)
app.use(express.json());

// Parse URL-encoded form data
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from the frontend folder
// This allows the frontend to be accessed at http://localhost:3000
app.use(express.static(path.join(__dirname, '../frontend')));

// ─────────────────────────────────────────────
// 4. API Routes
// All API routes are prefixed with /api
// ─────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/bookings',      bookingRoutes);
app.use('/api/drivers',       driverRoutes);
app.use('/api/ratings',       ratingRoutes);
app.use('/api/map',           mapRoutes);
app.use('/api/fare',          fareRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/customers',     customerRoutes);
app.use('/api/stats',         statsRoutes);

// ─────────────────────────────────────────────
// 5. Health Check Route
// Used to verify the server is running
// ─────────────────────────────────────────────
// Debug: check connected socket users (only in development)
app.get('/api/debug/sockets', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ message: 'Not found' });
  }
  const { connectedUsers } = require('./config/socket');
  const users = [];
  for (const [userId, socketId] of connectedUsers.entries()) {
    users.push({ userId, socketId });
  }
  res.json({ connected: users.length, users });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Hiring Driver Platform API is running!',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// ─────────────────────────────────────────────
// 6. Catch-all: Serve frontend index.html for non-API routes
// This supports single-page navigation
// ─────────────────────────────────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../frontend/pages/index.html'));
  } else {
    res.status(404).json({ success: false, message: 'API route not found' });
  }
});

// ─────────────────────────────────────────────
// 7. Global Error Handler (must be LAST middleware)
// ─────────────────────────────────────────────
app.use(errorHandler);

// ─────────────────────────────────────────────
// 8. Start the Server
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   🚗 Hiring Driver Platform API        ║');
  console.log(`║   🌐 Server running on port ${PORT}       ║`);
  console.log(`║   🔧 Mode: ${process.env.NODE_ENV || 'development'}                  ║`);
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log(`📡 API Base URL: http://localhost:${PORT}/api`);
  console.log(`❤️  Health Check: http://localhost:${PORT}/api/health`);
  console.log('');
});

app.listen(5000, "0.0.0.0", () => {
  console.log("Server running");
});

module.exports = { app, httpServer };
