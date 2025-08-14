/**
 * Shared JSON-RPC 2.0 type definitions for MCP communication
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id: string | number | null;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
  };
  id: string | number | null;
}
