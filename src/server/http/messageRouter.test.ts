import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageRouter } from './messageRouter.js';
import {
  ProjectExistsError,
  ProjectNotFoundError,
  FindingNotFoundError,
  ProjectCompletedError,
} from '../../types/index.js';
import type { HandlerFunction } from '../../types/handlers.js';
import type { JsonRpcRequest } from '../../types/jsonrpc.js';

describe('MessageRouter JSON-RPC Error Responses', () => {
  let messageRouter: MessageRouter;
  let mockToolRegistry: Map<string, HandlerFunction>;

  beforeEach(() => {
    mockToolRegistry = new Map();
    messageRouter = new MessageRouter(mockToolRegistry);
  });

  describe('Tool Execution Error Handling', () => {
    it('should return JSON-RPC error response for ProjectExistsError', async () => {
      const mockHandler = vi
        .fn()
        .mockRejectedValue(new ProjectExistsError('test-project'));
      mockToolRegistry.set('create-project', mockHandler);

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'create-project',
          arguments: { name: 'test-project' },
        },
        id: 1,
      };

      const response = await messageRouter.routeMessage(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message:
            'Project "test-project" already exists. Cannot overwrite existing projects.',
        },
        id: 1,
      });
      expect(response.result).toBeUndefined();
    });

    it('should return JSON-RPC error response for ProjectNotFoundError', async () => {
      const mockHandler = vi
        .fn()
        .mockRejectedValue(new ProjectNotFoundError('nonexistent-project'));
      mockToolRegistry.set('get-project', mockHandler);

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get-project',
          arguments: { name: 'nonexistent-project' },
        },
        id: 2,
      };

      const response = await messageRouter.routeMessage(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: 'Project "nonexistent-project" not found.',
        },
        id: 2,
      });
      expect(response.result).toBeUndefined();
    });

    it('should return JSON-RPC error response for FindingNotFoundError', async () => {
      const mockHandler = vi
        .fn()
        .mockRejectedValue(new FindingNotFoundError('VULN-999'));
      mockToolRegistry.set('get-finding', mockHandler);

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get-finding',
          arguments: { projectName: 'test-project', id: 'VULN-999' },
        },
        id: 3,
      };

      const response = await messageRouter.routeMessage(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: 'Finding "VULN-999" not found.',
        },
        id: 3,
      });
      expect(response.result).toBeUndefined();
    });

    it('should return JSON-RPC error response for validation errors', async () => {
      const validationError = new Error(
        'Invalid parameters: name is required'
      );
      validationError.name = 'ValidationError';
      const mockHandler = vi.fn().mockRejectedValue(validationError);
      mockToolRegistry.set('create-project', mockHandler);

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'create-project',
          arguments: { name: '' },
        },
        id: 4,
      };

      const response = await messageRouter.routeMessage(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32602,
          message: 'Invalid parameters: Invalid parameters: name is required',
        },
        id: 4,
      });
      expect(response.result).toBeUndefined();
    });

    it('should return JSON-RPC error response for instance lock errors', async () => {
      const lockError = new Error(
        'Another MCP Security Report instance is already running in /test/dir.\n' +
          'Running multiple instances in the same directory can lead to data corruption.\n' +
          'If you are certain no other instance is running, you can manually remove the lock file:\n' +
          '  rm -r "/test/dir/.mcp-instance.lock"'
      );
      const mockHandler = vi.fn().mockRejectedValue(lockError);
      mockToolRegistry.set('create-project', mockHandler);

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'create-project',
          arguments: { name: 'test-project' },
        },
        id: 5,
      };

      const response = await messageRouter.routeMessage(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message:
            'Another MCP Security Report instance is already running in /test/dir.\n' +
            'Running multiple instances in the same directory can lead to data corruption.\n' +
            'If you are certain no other instance is running, you can manually remove the lock file:\n' +
            '  rm -r "/test/dir/.mcp-instance.lock"',
        },
        id: 5,
      });
      expect(response.result).toBeUndefined();
    });

    it('should return JSON-RPC error response for ProjectCompletedError', async () => {
      const mockHandler = vi
        .fn()
        .mockRejectedValue(
          new ProjectCompletedError('completed-project', 'add finding')
        );
      mockToolRegistry.set('create-finding', mockHandler);

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'create-finding',
          arguments: {
            projectName: 'completed-project',
            title: 'Test Finding',
            severity: 'High',
            description: 'Test description',
          },
        },
        id: 6,
      };

      const response = await messageRouter.routeMessage(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message:
            'Cannot add finding on completed project "completed-project". Completed projects are immutable for audit integrity.',
        },
        id: 6,
      });
      expect(response.result).toBeUndefined();
    });

    it('should return JSON-RPC error response for generic errors', async () => {
      const mockHandler = vi
        .fn()
        .mockRejectedValue(new Error('Database connection failed'));
      mockToolRegistry.set('list-projects', mockHandler);

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'list-projects',
          arguments: {},
        },
        id: 5,
      };

      const response = await messageRouter.routeMessage(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: 5,
      });
      expect(response.result).toBeUndefined();
    });

    it('should return JSON-RPC error response for timeout errors', async () => {
      const timeoutError = new Error('Operation timed out after 30 seconds');
      timeoutError.name = 'TimeoutError';
      const mockHandler = vi.fn().mockRejectedValue(timeoutError);
      mockToolRegistry.set('create-finding', mockHandler);

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'create-finding',
          arguments: {
            projectName: 'test',
            title: 'Test',
            severity: 'High',
            description: 'Test',
          },
        },
        id: 6,
      };

      const response = await messageRouter.routeMessage(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Operation timed out',
        },
        id: 6,
      });
      expect(response.result).toBeUndefined();
    });

    it('should never return success result for error cases', async () => {
      const errorCases = [
        new ProjectExistsError('test'),
        new ProjectNotFoundError('test'),
        new FindingNotFoundError('test'),
        new Error('Generic error'),
        Object.assign(new Error('Validation failed'), {
          name: 'ValidationError',
        }),
        Object.assign(new Error('Timeout'), { name: 'TimeoutError' }),
      ];

      for (const [index, error] of errorCases.entries()) {
        const mockHandler = vi.fn().mockRejectedValue(error);
        mockToolRegistry.set(`test-tool-${index}`, mockHandler);

        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: `test-tool-${index}`,
            arguments: {},
          },
          id: index + 10,
        };

        const response = await messageRouter.routeMessage(request);

        // Critical assertion: error cases must NEVER return success
        expect(response.result).toBeUndefined();
        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeLessThan(0);
        expect(response.error?.message).toBeTruthy();
        expect(response.id).toBe(index + 10);
        expect(response.jsonrpc).toBe('2.0');
      }
    });
  });

  describe('Tool Not Found Errors', () => {
    it('should return JSON-RPC error for unknown tool', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'nonexistent-tool',
          arguments: {},
        },
        id: 7,
      };

      const response = await messageRouter.routeMessage(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: 'Tool not found: nonexistent-tool',
        },
        id: 7,
      });
      expect(response.result).toBeUndefined();
    });
  });

  describe('Method Not Found Errors', () => {
    it('should return JSON-RPC error for unknown method', async () => {
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'unknown/method',
        params: {},
        id: 8,
      };

      const response = await messageRouter.routeMessage(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: 'Method not found: unknown/method',
        },
        id: 8,
      });
      expect(response.result).toBeUndefined();
    });
  });

  describe('Handler Error Response Objects', () => {
    it('should convert handler error responses to JSON-RPC errors', async () => {
      // This is the critical test case that was missing - handlers returning error response objects
      const mockHandler = vi.fn().mockResolvedValue({
        content: [
          { type: 'text', text: 'Error MCP-1001: Project "test" not found.' },
        ],
        errorCode: 'MCP-1001',
      });
      mockToolRegistry.set('error-response-tool', mockHandler);

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'error-response-tool',
          arguments: {},
        },
        id: 100,
      };

      const response = await messageRouter.routeMessage(request);

      // This should be a JSON-RPC error response, NOT a success response
      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Error MCP-1001: Project "test" not found.',
        },
        id: 100,
      });
      expect(response.result).toBeUndefined();
    });

    it('should handle handler error responses with empty content', async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        content: [],
        errorCode: 'MCP-1002',
      });
      mockToolRegistry.set('empty-error-tool', mockHandler);

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'empty-error-tool',
          arguments: {},
        },
        id: 101,
      };

      const response = await messageRouter.routeMessage(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Unknown error',
        },
        id: 101,
      });
      expect(response.result).toBeUndefined();
    });

    it('should handle handler error responses with missing text content', async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        content: [{ type: 'text' }], // Missing text property
        errorCode: 'MCP-1003',
      });
      mockToolRegistry.set('malformed-error-tool', mockHandler);

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'malformed-error-tool',
          arguments: {},
        },
        id: 102,
      };

      const response = await messageRouter.routeMessage(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Unknown error',
        },
        id: 102,
      });
      expect(response.result).toBeUndefined();
    });
  });

  describe('Successful Cases for Comparison', () => {
    it('should return success result for successful tool execution', async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Success!' }],
      });
      mockToolRegistry.set('test-tool', mockHandler);

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'test-tool',
          arguments: {},
        },
        id: 9,
      };

      const response = await messageRouter.routeMessage(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        result: {
          content: [{ type: 'text', text: 'Success!' }],
        },
        id: 9,
      });
      expect(response.error).toBeUndefined();
    });

    it('should return success for responses without errorCode', async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'All good!' }],
        someOtherProperty: 'value',
      });
      mockToolRegistry.set('success-tool', mockHandler);

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'success-tool',
          arguments: {},
        },
        id: 10,
      };

      const response = await messageRouter.routeMessage(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        result: {
          content: [{ type: 'text', text: 'All good!' }],
        },
        id: 10,
      });
      expect(response.error).toBeUndefined();
    });
  });
});
