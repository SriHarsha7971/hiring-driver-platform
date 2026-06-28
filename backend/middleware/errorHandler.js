// middleware/errorHandler.js
// A centralized error handler that catches all errors thrown in routes/controllers.
// Instead of crashing, it sends a clean JSON error response to the client.

function errorHandler(error, req, res, next) {
  // Log the full error in development for debugging
  if (process.env.NODE_ENV === 'development') {
    console.error('❌ Error:', error.stack);
  } else {
    console.error('❌ Error:', error.message);
  }

  // Determine the appropriate HTTP status code
  const statusCode = error.statusCode || error.status || 500;

  // Send a clean JSON response
  res.status(statusCode).json({
    success: false,
    message: error.message || 'An unexpected error occurred',
    // Only include stack trace in development mode
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
  });
}

// Helper function to create errors with a status code
// Usage: throw createError(404, 'Booking not found')
function createError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = { errorHandler, createError };
