import winston from 'winston';
import express, { Request, Response } from 'express';

// Create Winston logger instance for HTTP server with dynamic level checking
export const httpLogger = winston.createLogger({
  level: 'debug', // Always allow debug, we'll control it dynamically
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'http-server' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        // Dynamic level filtering based on current LOG_LEVEL - BEFORE colorize
        winston.format((info) => {
          const currentLevel = process.env.LOG_LEVEL?.toLowerCase() ?? 'info';
          const levels = ['error', 'warn', 'info', 'debug'];
          const currentLevelIndex = levels.indexOf(currentLevel);
          const messageLevelIndex = levels.indexOf(info.level);

          // Only pass through if message level is at or above current level
          return messageLevelIndex <= currentLevelIndex ? info : false;
        })(),
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// Consolidated nginx-style logging middleware with request/response correlation
export const createHttpLoggingMiddleware = (): express.RequestHandler => {
  return (req: Request, res: Response, next: () => void) => {
    // Skip health checks unless explicitly enabled
    if (req.path === '/health' && process.env.LOG_HEALTH !== 'true') {
      return next();
    }

    const startTime = Date.now();
    const requestId = `req-${Math.random().toString(36).substring(2, 15)}`;

    // Add request ID to request for handlers to use
    (req as Request & { requestId: string }).requestId = requestId;

    // Log initial request with all relevant details
    const requestInfo = {
      requestId,
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      host: req.headers.host,
      contentLength: req.headers['content-length'],
    };

    httpLogger.info('Request received', requestInfo);

    // Debug level request details
    if (process.env.LOG_LEVEL === 'debug') {
      httpLogger.debug('Request headers', {
        requestId,
        headers: req.headers,
      });

      if (
        req.body &&
        Object.keys(req.body as Record<string, unknown>).length > 0
      ) {
        const sanitizedBody = JSON.stringify(req.body).substring(0, 1000);
        httpLogger.debug('Request body', {
          requestId,
          body:
            sanitizedBody +
            (JSON.stringify(req.body).length > 1000 ? '...' : ''),
        });
      }
    }

    // Intercept response to log completion
    const originalSend = res.send;
    const originalJson = res.json;

    let responseLogged = false;
    const logResponse = (data: unknown): void => {
      if (responseLogged) return;
      responseLogged = true;

      const duration = Date.now() - startTime;
      const responseInfo = {
        requestId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        contentLength: res.get('content-length'),
      };

      // Log response completion (nginx-style)
      httpLogger.info('Request completed', responseInfo);

      // Debug level response body
      if (process.env.LOG_LEVEL === 'debug') {
        const responseBody =
          typeof data === 'string' ? data : JSON.stringify(data);
        const truncatedBody = responseBody.substring(0, 1000);
        httpLogger.debug('Response body', {
          requestId,
          body: truncatedBody + (responseBody.length > 1000 ? '...' : ''),
        });
      }
    };

    res.send = function (body: unknown): express.Response {
      logResponse(body);
      return originalSend.call(this, body);
    };

    res.json = function (obj: unknown): express.Response {
      logResponse(obj);
      return originalJson.call(this, obj);
    };

    next();
  };
};

// Legacy functions for backward compatibility - now just pass through
export const responseBodyCapture = (): express.RequestHandler => {
  return (_req: Request, _res: Response, next: () => void) => next();
};

export const requestDetailsLogger = (): express.RequestHandler => {
  return (_req: Request, _res: Response, next: () => void) => next();
};

// Error logging middleware
export const errorLogger = (): express.ErrorRequestHandler => {
  return (
    err: Error,
    req: Request,
    _res: Response,
    next: (err?: Error) => void
  ) => {
    httpLogger.error({
      message: err.message,
      stack: err.stack,
      method: req.method,
      url: req.url,
      ip: req.ip,
    });

    // Pass error to next error handler
    next(err);
  };
};
