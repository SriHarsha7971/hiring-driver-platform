// middleware/authMiddleware.js
// Protects routes by verifying the JWT token sent in the Authorization header.
// Full implementation is in Module 2 (Authentication).
// This stub is here so server.js can import it without errors.

const jwt = require('jsonwebtoken');

// Middleware: verify token and attach user info to request
function authenticate(req, res, next) {
  try {
    // Get token from header: "Authorization: Bearer <token>"
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach decoded user data to the request object
    // Now any route after this middleware can use req.user
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.',
    });
  }
}

// Middleware: check if authenticated user has a specific role
// Usage: router.post('/route', authenticate, authorize('driver'), controller)
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.',
      });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
