/**
 * Request Logging Middleware
 * Redacts sensitive fields like password/token.
 */
function requestLogger(req, res, next) {
  const { method, originalUrl } = req;

  const sanitize = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const clean = Array.isArray(obj) ? [] : {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (
          key.toLowerCase().includes('password') ||
          key.toLowerCase().includes('secret') ||
          key.toLowerCase().includes('token')
        ) {
          clean[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          clean[key] = sanitize(obj[key]);
        } else {
          clean[key] = obj[key];
        }
      }
    }
    return clean;
  };

  const sanitizedBody = sanitize(req.body);

  res.on('finish', () => {
    // In production, only log warnings (4xx) and errors (5xx) to minimize I/O overhead
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && res.statusCode < 400) return;

    const user = req.user ? `${req.user.username} (${req.user.role})` : 'Anonymous';
    console.log(
      `[HTTP Request] ${method} ${originalUrl} - Status: ${res.statusCode} - User: ${user} - Body: ${JSON.stringify(
        sanitizedBody
      )}`
    );
  });

  next();
}

module.exports = requestLogger;
