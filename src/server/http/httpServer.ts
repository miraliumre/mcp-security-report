import express from 'express';
import rateLimit from 'express-rate-limit';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createChildLogger } from '../../utils/logger.js';
import {
  createHttpLoggingMiddleware,
  requestDetailsLogger,
  responseBodyCapture,
  httpLogger,
} from '../middleware/logging.js';
import { MessageRouter } from './messageRouter.js';
import type { HandlerFunction } from '../../types/handlers.js';
import type { JsonRpcRequest } from '../../types/jsonrpc.js';

const logger = createChildLogger('http-server');

export interface HttpServerOptions {
  readonly cors?: boolean;
  readonly corsOrigin?: string | undefined;
  readonly corsCredentials?: boolean;
  readonly port: number;
  readonly host: string;
  readonly maxSseConnections?: number;
}

/**
 * HTTP server for MCP communication using Server-Sent Events
 */
interface SSEConnection {
  res: express.Response;
  timeout: NodeJS.Timeout;
  heartbeat: NodeJS.Timeout;
  clientId: string;
  state: 'connecting' | 'connected' | 'closing' | 'closed';
  createdAt: number;
}

export class HttpServer {
  private app: express.Application;
  private messageRouter: MessageRouter;
  private options: HttpServerOptions;
  private sseConnections = new Map<string, SSEConnection>();
  private sseTransports = new Map<string, SSEServerTransport>();
  private readonly maxSseConnections: number;
  private mcpServer: McpServer;

  constructor(
    toolRegistry: Map<string, HandlerFunction>,
    mcpServer: McpServer,
    options: HttpServerOptions
  ) {
    this.app = express();
    this.messageRouter = new MessageRouter(toolRegistry);
    this.mcpServer = mcpServer;
    this.options = options;
    this.maxSseConnections = options.maxSseConnections ?? 100;
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Add rate limiting to prevent DoS attacks
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
      message: {
        error: 'Too many requests from this IP, please try again later.',
      },
      standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
      legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    });
    this.app.use(limiter);

    // Add CORS if enabled
    if (this.options.cors) {
      void this.setupCors(this.options.corsOrigin);
    }

    // Add request size limits to prevent resource exhaustion
    this.app.use(
      express.json({
        limit: process.env.MCP_SECURITY_REPORT_MAX_REQUEST_SIZE ?? '1mb',
      })
    );

    // Add proper logging middleware
    this.app.use(createHttpLoggingMiddleware());

    // Add request details logging in debug mode
    if (process.env.LOG_LEVEL === 'debug') {
      this.app.use(requestDetailsLogger());
      this.app.use(responseBodyCapture());
    }
  }

  private validateOriginUrl(origin: string): boolean {
    try {
      const url = new URL(origin);
      // Only allow http and https protocols
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private async setupCors(corsOrigin?: string): Promise<void> {
    const { default: cors } = await import('cors');

    // Parse CORS origins - support comma-separated values
    let allowedOrigins: string[] = [];
    if (corsOrigin) {
      allowedOrigins = corsOrigin
        .split(',')
        .map((origin) => origin.trim())
        .filter(
          (origin) => origin.length > 0 && this.validateOriginUrl(origin)
        );

      // Log warning if some origins were filtered out
      const originalCount = corsOrigin
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0).length;
      if (allowedOrigins.length < originalCount) {
        logger.warn(
          'Some CORS origins were invalid and filtered out. ' +
          `Valid origins: ${allowedOrigins.length}/${originalCount}`
        );
      }
    }

    // Create origin validation function that properly checks request origin against allowed origins
    const originValidator = (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void
    ): void => {
      // Allow requests with no origin (e.g., mobile apps, curl, Postman)
      if (!origin) {
        callback(null, true);
        return;
      }

      // Check if request origin is in allowed origins list
      if (allowedOrigins.length === 0) {
        // No CORS origins configured - reject all cross-origin requests
        logger.warn(
          `CORS request rejected: no origins configured, requested origin: ${origin}`
        );
        callback(null, false);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        logger.debug(`CORS request allowed for origin: ${origin}`);
        callback(null, true);
      } else {
        logger.warn(
          `CORS request rejected for unauthorized origin: ${origin}`
        );
        callback(null, false);
      }
    };

    // Only allow credentials if explicitly enabled AND we have specific origins configured
    const hasSpecificOrigins = allowedOrigins.length > 0;
    const allowCredentials =
      this.options.corsCredentials === true && hasSpecificOrigins;

    if (allowCredentials) {
      logger.info('CORS credentials enabled for specific origins');
    } else if (this.options.corsCredentials && !hasSpecificOrigins) {
      logger.warn(
        'CORS credentials requested but disabled due to missing specific origins (security requirement)'
      );
    }

    this.app.use(
      cors({
        origin: originValidator,
        exposedHeaders: ['Mcp-Session-Id'],
        allowedHeaders: ['Content-Type', 'mcp-session-id', 'Authorization'],
        credentials: allowCredentials,
        maxAge: 86400, // Cache preflight for 24 hours
        optionsSuccessStatus: 200, // For legacy browser support
      })
    );
  }

  private setupRoutes(): void {
    // Handle POST requests to /messages endpoint for SSE transport communication
    this.app.post('/messages', async (req, res) => {
      try {
        const sessionId = req.query.sessionId as string;
        httpLogger.info(`POST /messages (session: ${sessionId || 'unknown'})`);
        httpLogger.debug(`POST /messages body: ${JSON.stringify(req.body)}`);

        // Find the SSE transport for this session
        const transport = sessionId
          ? this.sseTransports.get(sessionId)
          : undefined;

        if (transport) {
          // Use the SSE transport to handle the message properly
          httpLogger.debug(
            `Routing message through SSE transport: ${sessionId}`
          );
          await transport.handlePostMessage(req, res, req.body);
        } else {
          // No transport found - this could be a stateless request or missing session
          httpLogger.warn(
            `No SSE transport found for session ${sessionId}, falling back to stateless routing`
          );

          // Fall back to stateless message routing
          const request = req.body as JsonRpcRequest;
          const response = await this.messageRouter.routeMessage(request);
          res.json(response);
        }
      } catch (error) {
        httpLogger.error('Error handling POST /messages:', error);
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal error',
          },
          id: null,
        });
      }
    });

    // Handle SSE endpoint for MCP protocol communication using proper transport
    this.app.get('/sse', async (req, res) => {
      httpLogger.debug(`New SSE connection request from ${req.ip}`, {
        userAgent: req.headers['user-agent'],
        origin: req.headers.origin,
        referer: req.headers.referer,
      });

      // Check connection limit
      const activeConnections = this.sseTransports.size;
      httpLogger.debug(
        `Current SSE transport count: ${activeConnections}, max_allowed=${this.maxSseConnections}`
      );

      if (activeConnections >= this.maxSseConnections) {
        httpLogger.warn(
          `SSE connection rejected - max connections (${this.maxSseConnections}) reached.`
        );
        res.status(503).json({
          error: 'Service temporarily unavailable',
          message: `Maximum concurrent connections (${this.maxSseConnections}) reached. Please try again later.`,
        });
        return;
      }

      try {
        // Create SSE transport for MCP protocol - this handles the MCP initialization properly
        const transport = new SSEServerTransport('/messages', res);
        const sessionId =
          transport.sessionId ||
          `sse-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        httpLogger.debug(
          `Created SSE transport with session ID: ${sessionId}`
        );

        // Store the transport
        this.sseTransports.set(sessionId, transport);

        // Handle transport cleanup
        const cleanup = (): void => {
          httpLogger.debug(`Cleaning up SSE transport: ${sessionId}`);
          this.sseTransports.delete(sessionId);
        };

        res.on('close', cleanup);
        res.on('error', (error) => {
          httpLogger.error(`SSE transport error for ${sessionId}:`, error);
          cleanup();
        });

        // Connect the MCP server to this transport
        await this.mcpServer.connect(transport);
        httpLogger.debug(
          `MCP server connected to SSE transport: ${sessionId}`
        );
      } catch (error) {
        httpLogger.error('Failed to create SSE transport:', error);
        res.status(500).json({
          error: 'Failed to establish SSE connection',
          message: 'Internal server error',
        });
      }
    });
  }

  /**
   * Clean up a specific SSE connection with guaranteed resource cleanup
   */
  private cleanupConnection(connection: SSEConnection): void {
    // Mark connection as closing first
    if (this.sseConnections.has(connection.clientId)) {
      const trackedConnection = this.sseConnections.get(connection.clientId);
      if (trackedConnection) {
        trackedConnection.state = 'closing';
      }
    }

    // Always clear timers first to prevent leaks, even if other operations fail
    let timersCleared = false;
    try {
      clearTimeout(connection.timeout);
      clearInterval(connection.heartbeat);
      timersCleared = true;
    } catch (timerError) {
      httpLogger.warn('Failed to clear connection timers:', timerError);
    }

    // Always remove from tracking map to prevent memory leaks
    let removedFromMap = false;
    try {
      removedFromMap = this.sseConnections.delete(connection.clientId);
    } catch (setError) {
      httpLogger.warn(
        'Failed to remove connection from tracking set:',
        setError
      );
    }

    // Try to end the response gracefully
    try {
      // Check if response is still open and can be ended
      if (connection.res && !connection.res.destroyed) {
        if (!connection.res.headersSent && connection.res.writable) {
          connection.res.end();
        } else if (connection.res.writable) {
          connection.res.end();
        } else {
          // Response is not writable, try to destroy it
          connection.res.destroy();
        }
      }
    } catch {
      // If ending fails, try to destroy the response
      try {
        if (connection.res && !connection.res.destroyed) {
          connection.res.destroy();
        }
      } catch (destroyError) {
        httpLogger.warn('Failed to destroy SSE response:', destroyError);
      }
    }

    httpLogger.debug(
      `SSE connection cleanup completed for ${connection.clientId}. ` +
      `Timers cleared: ${timersCleared}, ` +
      `Removed from map: ${removedFromMap}, ` +
      `Active connections: ${this.getActiveConnectionCount()}`
    );
  }

  /**
   * Get count of active SSE connections (connecting + connected)
   */
  private getActiveConnectionCount(): number {
    return Array.from(this.sseConnections.values()).filter(
      (conn) => conn.state === 'connecting' || conn.state === 'connected'
    ).length;
  }

  /**
   * Clean up all SSE connections
   */
  private cleanupAllConnections(): void {
    httpLogger.info(`Cleaning up ${this.sseConnections.size} SSE connections`);

    // Create a copy of the map values to avoid modification during iteration
    const connections = Array.from(this.sseConnections.values());

    for (const connection of connections) {
      this.cleanupConnection(connection);
    }
  }

  async start(): Promise<express.Application> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(
        this.options.port,
        this.options.host,
        () => {
          logger.info(
            `MCP server listening on http://${this.options.host}:${this.options.port}`
          );
          logger.info(
            `WebSocket endpoint: http://${this.options.host}:${this.options.port}/sse`
          );

          // Warn if server is bound to non-localhost address in SSE mode
          const isLocalhost = this.options.host === 'localhost' || 
                             this.options.host === '127.0.0.1' || 
                             this.options.host === '::1';
          if (!isLocalhost) {
            logger.warn(
              `The server is bound to ${this.options.host} - ` +
              `please ensure you are behind a secure network or proxy`
            );
          }

          resolve(this.app);
        }
      );

      server.on('error', (error) => {
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        logger.error(`Failed to start HTTP server: ${errorMsg}`, {
          error: errorMsg,
        });
        reject(new Error(`HTTP server startup failed: ${errorMsg}`));
      });

      // Graceful shutdown handling
      const gracefulShutdown = (): void => {
        logger.info('Shutting down HTTP server gracefully...');

        // Clean up all SSE connections first
        this.cleanupAllConnections();

        server.close((error) => {
          if (error) {
            logger.error('Error during HTTP server shutdown:', {
              error: error.message,
              stack: error.stack,
            });
          } else {
            logger.info('HTTP server shutdown complete');
          }
        });
      };

      process.on('SIGTERM', gracefulShutdown);
      process.on('SIGINT', gracefulShutdown);
    });
  }
}
