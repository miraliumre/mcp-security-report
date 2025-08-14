import { Request, Response, NextFunction } from 'express';
import { createChildLogger } from '../../utils/logger.js';

// Extend Express Request interface to include requestId
declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

// Create child logger for HTTP middleware
const logger = createChildLogger('http-server');

// Enhanced request/response logging with correlation (nginx-style)
export function correlatedLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();
  const requestId = `req-${Math.random().toString(36).substring(2, 15)}`;

  // Add request ID to request for potential use in handlers
  req.requestId = requestId;

  // Log initial request
  const requestInfo = {
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    contentLength: req.headers['content-length'],
  };

  logger.info('Request received', requestInfo);

  // Debug level request summary (avoid logging full request body)
  if (req.body) {
    const bodyInfo = {
      requestId,
      hasBody: true,
      method:
        typeof req.body === 'object' &&
        req.body !== null &&
        'method' in req.body
          ? String((req.body as Record<string, unknown>).method)
          : undefined,
      bodyType: typeof req.body,
      bodySize: JSON.stringify(req.body).length,
    };
    logger.debug('Request body info', bodyInfo);
  }

  // Intercept response
  const originalSend = res.send;
  res.send = function (data: unknown): Response {
    const duration = Date.now() - startTime;
    const responseInfo = {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      contentLength: res.get('content-length'),
    };

    // Log response completion in nginx-style format
    logger.info('Request completed', responseInfo);

    // Debug level response summary (avoid logging full response body)
    const responseSize =
      typeof data === 'string' ? data.length : JSON.stringify(data).length;
    logger.debug('Response body info', {
      requestId,
      responseType: typeof data,
      responseSize,
    });

    return originalSend.call(this, data);
  };

  next();
}

export function errorHandlingMiddleware(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error(`Error handling request: ${err.message}`);
  logger.error(`Stack: ${err.stack}`);

  res.status(500).json({
    jsonrpc: '2.0',
    error: {
      code: -32603,
      message: 'Internal server error',
    },
    id: null,
  });
}
