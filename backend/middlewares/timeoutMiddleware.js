/**
 * Express Request Timeout Middleware
 * Ensures every incoming HTTP request resolves or fails within a maximum timeout.
 * Prevents requests from hanging indefinitely and exceeding client timeouts.
 */
function requestTimeout(timeoutMs = 25000) {
  return (req, res, next) => {
    // Set socket timeout as well
    req.setTimeout(timeoutMs, () => {
      console.warn(`[Timeout Middleware] Socket timed out after ${timeoutMs}ms for ${req.method} ${req.originalUrl}`);
    });

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        console.error(`[Timeout Middleware] Request execution exceeded ${timeoutMs}ms: ${req.method} ${req.originalUrl}`);

        // Ensure CORS headers are attached so browser allows reading this response
        const origin = req.headers.origin;
        if (origin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }

        res.status(504).json({
          success: false,
          code: 'DATABASE_TIMEOUT',
          message: 'Database connection timeout. The server took too long to respond. Please try again.',
          timestamp: new Date().toISOString()
        });
      }
    }, timeoutMs);

    // Clear timeout on response finish or close
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
}

module.exports = requestTimeout;
