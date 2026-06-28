// config/socket.js
// Attaches Socket.IO to our HTTP server and manages real-time connections.
// We store connected socket IDs mapped to user IDs so we can send
// targeted notifications to specific drivers or customers.

const { Server } = require('socket.io');
require('dotenv').config();

// This map stores: { userId: socketId }
// When a driver needs to be notified, we look up their socketId here
const connectedUsers = new Map();

let io; // Will hold the Socket.IO instance

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      // Allow any localhost/127.0.0.1 port — same policy as the HTTP CORS fix
      origin: function(origin, callback) {
        if (!origin) return callback(null, true);
        if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
          return callback(null, true);
        }
        if (origin === process.env.FRONTEND_URL) {
          return callback(null, true);
        }
        callback(new Error('Socket.IO: Not allowed by CORS'));
      },
      methods:     ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // When a user logs in on the frontend, they emit 'register' with their userId
    // This links their userId to their current socketId
    socket.on('register', (userId) => {
      // Coerce to string — PostgreSQL UUIDs and JS strings must match exactly
      const uid = String(userId).trim();
      connectedUsers.set(uid, socket.id);
      console.log(`👤 User ${uid} registered with socket ${socket.id}`);
      // Confirm registration back to the client
      socket.emit('registered', { userId: uid });
    });

    // Clean up when user disconnects
    socket.on('disconnect', () => {
      for (const [userId, socketId] of connectedUsers.entries()) {
        if (socketId === socket.id) {
          connectedUsers.delete(userId);
          console.log(`🔌 User ${userId} disconnected`);
          break;
        }
      }
    });
  });

  return io;
}

// Helper function: send an event to a specific user by their userId
function sendToUser(userId, event, data) {
  // Always coerce to string to match how we stored it
  const uid = String(userId).trim();
  const socketId = connectedUsers.get(uid);
  if (socketId) {
    io.to(socketId).emit(event, data);
    return true;
  }
  return false;
}

// Helper function: broadcast to all connected users (e.g., announcements)
function broadcast(event, data) {
  if (io) {
    io.emit(event, data);
  }
}

// Get the Socket.IO instance (used in other modules)
function getIO() {
  return io;
}

module.exports = { initSocket, sendToUser, broadcast, getIO, connectedUsers };
