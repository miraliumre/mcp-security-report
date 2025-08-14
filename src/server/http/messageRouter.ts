import { TOOL_DEFINITIONS } from '../schemas.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createChildLogger } from '../../utils/logger.js';
import { getServerInfo } from '../utils/serverInfo.js';
import type { HandlerFunction } from '../../types/handlers.js';
import type { JsonRpcRequest, JsonRpcResponse } from '../../types/jsonrpc.js';

const httpLogger = createChildLogger('message-router');

type MessageHandler = (
  request: JsonRpcRequest
) => JsonRpcResponse | Promise<JsonRpcResponse>;

/**
 * Routes MCP messages to appropriate handlers
 */
export class MessageRouter {
  private toolRegistry: Map<string, HandlerFunction>;
  private messageHandlers: Map<string, MessageHandler>;

  constructor(toolRegistry: Map<string, HandlerFunction>) {
    this.toolRegistry = toolRegistry;
    this.messageHandlers = this.createMessageHandlerMap();
  }

  /**
   * Creates a map of message handlers to replace the switch statement
   */
  private createMessageHandlerMap(): Map<string, MessageHandler> {
    const handlers = new Map<string, MessageHandler>();
    handlers.set('initialize', this.handleInitialize.bind(this));
    handlers.set('tools/list', this.handleToolsList.bind(this));
    handlers.set('tools/call', this.handleToolsCall.bind(this));
    handlers.set('ping', this.handlePing.bind(this));
    return handlers;
  }

  async routeMessage(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    httpLogger.debug(`Routing MCP message: ${request.method}`, {
      id: request.id,
      hasParams: !!request.params,
    });

    const handler = this.messageHandlers.get(request.method);

    if (!handler) {
      httpLogger.warn(`Unknown MCP method requested: ${request.method}`);
      return {
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`,
        },
        id: request.id,
      };
    }

    const response = await handler(request);
    httpLogger.debug(`MCP message ${request.method} handled successfully`, {
      id: request.id,
      hasResult: !!response.result,
      hasError: !!response.error,
    });

    return response;
  }

  private handleInitialize(request: JsonRpcRequest): JsonRpcResponse {
    const serverInfo = getServerInfo();

    return {
      jsonrpc: '2.0',
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: serverInfo.name,
          version: serverInfo.version,
        },
      },
      id: request.id,
    };
  }

  private handlePing(request: JsonRpcRequest): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      result: {},
      id: request.id,
    };
  }

  private handleToolsList(request: JsonRpcRequest): JsonRpcResponse {
    // Convert centralized tool definitions to JSON Schema format
    const tools = TOOL_DEFINITIONS.map((toolDef) => ({
      name: toolDef.name,
      description: toolDef.description,
      inputSchema: zodToJsonSchema(toolDef.schema),
    }));

    return {
      jsonrpc: '2.0',
      result: { tools },
      id: request.id,
    };
  }

  private async handleToolsCall(
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse> {
    // Type-safe parameter extraction
    const params = request.params;
    const toolName = params?.name as string;
    const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;

    try {
      httpLogger.info(
        `Executing tool ${toolName} with args: ${JSON.stringify(toolArgs)}`
      );

      const toolHandler = this.toolRegistry.get(toolName);
      if (!toolHandler) {
        return {
          jsonrpc: '2.0',
          error: {
            code: -32601,
            message: `Tool not found: ${toolName}`,
          },
          id: request.id,
        };
      }

      const result = await toolHandler(toolArgs);

      // Check if the handler returned an error response
      if ('errorCode' in result && result.errorCode) {
        const errorCode = typeof result.errorCode === 'string' ? result.errorCode : JSON.stringify(result.errorCode);
        httpLogger.warn(
          `Tool ${toolName} returned error: ${errorCode}`
        );

        // Extract error message from content if available
        const errorMessage = result.content?.[0]?.text ?? 'Unknown error';

        return {
          jsonrpc: '2.0',
          error: {
            code: -32000, // Server error
            message: errorMessage,
          },
          id: request.id,
        };
      }

      httpLogger.info(`Tool ${toolName} completed successfully`);

      return {
        jsonrpc: '2.0',
        result: {
          content: result.content ?? [],
        },
        id: request.id,
      };
    } catch (error) {
      // Enhanced error categorization for better debugging and security
      let errorCode = -32603; // Internal error default
      let errorMessage = 'Internal error';

      if (error instanceof Error) {
        // Categorize different types of errors
        if (
          error.name === 'ZodError' ||
          error.name === 'ValidationError' ||
          error.message.includes('validation')
        ) {
          errorCode = -32602; // Invalid params
          // For validation errors, provide specific details so client can fix the request
          errorMessage = `Invalid parameters: ${error.message}`;
        } else if (
          error.name === 'NotFoundError' ||
          error.message.includes('not found') ||
          error.constructor.name === 'ProjectNotFoundError' ||
          error.constructor.name === 'FindingNotFoundError' ||
          error.constructor.name === 'AuditTrailNotFoundError'
        ) {
          errorCode = -32601; // Method not found (repurposed for resource not found)
          // For not found errors, provide specific details so client knows what doesn't exist
          errorMessage = error.message;
        } else if (error.constructor.name === 'ProjectExistsError') {
          errorCode = -32000; // Server error (custom: resource already exists)
          errorMessage = error.message;
        } else if (
          error.name === 'PermissionError' ||
          error.message.includes('permission')
        ) {
          errorCode = -32000; // Server error with custom code
          errorMessage = 'Permission denied';
        } else if (
          error.name === 'TimeoutError' ||
          error.message.includes('timeout')
        ) {
          errorCode = -32000; // Server error
          errorMessage = 'Operation timed out';
        } else {
          // Log full error details for debugging (server-side only)
          httpLogger.error(`Tool execution error - ${toolName}:`, {
            message: error.message,
            stack: error.stack,
            name: error.name,
            error: error.message,
          });
          // For unexpected server errors, don't expose internal details
          errorMessage = 'Internal server error';
        }
      } else {
        httpLogger.error(`Non-Error thrown in tool ${toolName}:`, {
          error: String(error),
        });
        errorMessage = 'Unexpected error occurred';
      }

      return {
        jsonrpc: '2.0',
        error: {
          code: errorCode,
          message: errorMessage,
        },
        id: request.id,
      };
    }
  }
}
