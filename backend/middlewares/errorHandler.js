/**
 * Global Error Handling Middleware
 * Logs full stack trace and returns a structured JSON error response.
 * Never exposes internal errors to the client.
 */
function errorHandler(err, req, res, next) {
  // Log the complete stack trace
  console.error('[Unhandled Error] Complete stack trace:');
  console.error(err);

  // Return structured JSON error
  const statusCode = err.status || 500;
  const message = statusCode === 500 ? 'Internal Server Error' : err.message;

  res.status(statusCode).json({
    success: false,
    message: message
  });
}

module.exports = errorHandler;
