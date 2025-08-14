#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import express from 'express';
import { ProjectHandler } from './handlers/project.js';
import { FindingHandler } from './handlers/finding.js';
import { AuditTrailHandler } from './handlers/audit.js';
import { ExecutiveSummaryHandler } from './handlers/executive.js';
import { CweHandler } from './handlers/cwe.js';
import { CvssHandler } from './handlers/cvss.js';
import { TOOL_DEFINITIONS } from './schemas.js';
import { getSchemaShape } from './utils/schemaHelpers.js';
import {
  createToolRegistry,
  type HandlerMap,
} from './utils/toolHandlerMap.js';
import { type HandlerFunction } from '../types/handlers.js';
import { createChildLogger } from '../utils/logger.js';
import { getServerInfo } from './utils/serverInfo.js';
import { HttpServer } from './http/httpServer.js';
import { getServerConfig } from '../utils/env.js';
import { StorageManager } from './storage/index.js';

// Create child logger for server context
const logger = createChildLogger('server');

export interface ServerOptions {
  readonly workingDir?: string;
  readonly port?: number;
  readonly host?: string;
  readonly cors?: boolean;
  readonly corsOrigin?: string | undefined;
  readonly corsCredentials?: boolean;
}

export class SecurityReportServer {
  private readonly server: McpServer;
  private readonly projectHandler: ProjectHandler;
  private readonly findingHandler: FindingHandler;
  private readonly auditHandler: AuditTrailHandler;
  private readonly executiveHandler: ExecutiveSummaryHandler;
  private readonly cweHandler: CweHandler;
  private readonly cvssHandler: CvssHandler;
  private readonly options: Required<ServerOptions>;
  private readonly toolRegistry: Map<string, HandlerFunction>;
  private readonly storageManager: StorageManager;

  constructor(options: ServerOptions = {}) {
    // Get validated environment configuration
    const serverConfig = getServerConfig();

    this.options = {
      workingDir: options.workingDir ?? serverConfig.workingDir,
      port: options.port ?? serverConfig.port,
      host: options.host ?? serverConfig.host,
      cors: options.cors ?? serverConfig.corsOrigin !== undefined,
      corsOrigin: options.corsOrigin ?? serverConfig.corsOrigin,
      corsCredentials: options.corsCredentials ?? false, // Default to false for security
    };

    const serverInfo = getServerInfo();
    this.server = new McpServer({
      name: serverInfo.name,
      version: serverInfo.version,
    });

    // Initialize stateless handlers - shared across all requests
    // Each handler maintains its own internal state management
    const { workingDir } = this.options;

    // Initialize the storage manager for instance locking
    this.storageManager = new StorageManager(workingDir);

    this.projectHandler = new ProjectHandler(workingDir);
    this.findingHandler = new FindingHandler(workingDir);
    this.auditHandler = new AuditTrailHandler(workingDir);
    this.executiveHandler = new ExecutiveSummaryHandler(workingDir);
    this.cweHandler = new CweHandler();
    this.cvssHandler = new CvssHandler();

    // Create tool registry inline
    const handlerMap: HandlerMap = {
      projectHandler: this.projectHandler,
      findingHandler: this.findingHandler,
      auditHandler: this.auditHandler,
      executiveHandler: this.executiveHandler,
      cweHandler: this.cweHandler,
      cvssHandler: this.cvssHandler,
    };

    this.toolRegistry = createToolRegistry(handlerMap);
    this.setupTools();
  }

  private setupTools(): void {
    // Register all tools from centralized definitions
    for (const toolDef of TOOL_DEFINITIONS) {
      const handlerFunction = this.toolRegistry.get(toolDef.name);
      if (handlerFunction) {
        this.server.registerTool(
          toolDef.name,
          {
            title: toolDef.title,
            description: toolDef.description,
            inputSchema: getSchemaShape(toolDef.schema),
          },
          handlerFunction
        );
      }
    }
  }

  async startStdio(): Promise<void> {
    try {
      // Acquire instance lock first to prevent concurrent instances
      await this.storageManager.acquireInstanceLock();

      const transport = new StdioServerTransport();

      // Set up graceful shutdown for stdio mode
      const gracefulShutdown = (): void => {
        logger.info('Shutting down stdio MCP server gracefully...');
        try {
          void this.server.close?.();
          // Cleanup all handlers
          void this.cleanup();
        } catch (error) {
          logger.error('Error during stdio server shutdown', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      process.on('SIGTERM', () => {
        gracefulShutdown();
        setTimeout(() => process.exit(0), 1000);
      });

      process.on('SIGINT', () => {
        gracefulShutdown();
        setTimeout(() => process.exit(0), 1000);
      });

      await this.server.connect(transport);
      logger.info('MCP server started in stdio mode');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to start stdio server: ${errorMsg}`);
      throw new Error(`Stdio server startup failed: ${errorMsg}`);
    }
  }

  async startHttp(): Promise<express.Application> {
    try {
      // Acquire instance lock first to prevent concurrent instances
      await this.storageManager.acquireInstanceLock();

      const serverConfig = getServerConfig();
      const httpServer = new HttpServer(
        this.toolRegistry,
        this.server, // Pass the MCP server instance
        {
          cors: this.options.cors,
          corsOrigin: this.options.corsOrigin,
          corsCredentials: this.options.corsCredentials,
          port: this.options.port,
          host: this.options.host,
          maxSseConnections: serverConfig.maxSseConnections,
        }
      );

      // Set up graceful cleanup handlers
      process.on('SIGTERM', () => {
        logger.info('Received SIGTERM, cleaning up...');
        void this.cleanup();
      });

      process.on('SIGINT', () => {
        logger.info('Received SIGINT, cleaning up...');
        void this.cleanup();
      });

      return await httpServer.start();
    } catch (error) {
      // Release lock if startup fails
      await this.storageManager.releaseInstanceLock();
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to start HTTP server: ${errorMsg}`);
      throw new Error(`HTTP server startup failed: ${errorMsg}`);
    }
  }

  /**
   * Cleanup all handlers and release resources
   */
  async cleanup(): Promise<void> {
    try {
      // Cleanup all handlers
      this.projectHandler.cleanup();
      this.findingHandler.cleanup();
      this.auditHandler.cleanup();
      this.executiveHandler.cleanup();
      // CWE and CVSS handlers don't need cleanup (they're stateless)

      // Release the instance lock and cleanup storage
      await this.storageManager.cleanup();
    } catch (error) {
      logger.error('Error during server cleanup', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
