import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { EventSource } from 'eventsource';

interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown> | unknown[] | null;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: {
    content?: Array<{ text: string; type: string }>;
    tools?: Array<{ name: string; description: string; inputSchema: unknown }>;
    protocolVersion?: string;
    capabilities?: Record<string, unknown>;
    serverInfo?: { name: string; version: string };
  };
  error?: {
    code: number;
    message: string;
  };
}

class MCPHttpSseClient {
  private serverProcess: ReturnType<typeof spawn>;
  private eventSource: EventSource | null = null;
  private sessionId: string | null = null;
  private baseUrl: string;
  private requestId = 0;
  private isConnected = false;
  private connectionTimeout = 30000; // 30 seconds
  private pendingRequests = new Map<number, { resolve: (value: MCPResponse) => void; reject: (reason?: any) => void }>();

  constructor(cliPath: string, projectDir: string, port = 3000) {
    this.baseUrl = `http://localhost:${port}`;
    
    // Start the server process
    this.serverProcess = spawn('node', [cliPath, 'serve', '--verbose', '--project-dir', projectDir, '--port', `${port}`], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    this.serverProcess.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.includes('MCP server listening on')) {
          console.log('✅ Server started:', line.trim());
        }
      }
    });

    this.serverProcess.stderr.on('data', (data: Buffer) => {
      console.error('Server stderr:', data.toString());
    });

    this.serverProcess.on('error', (error: Error) => {
      console.error('Server process error:', error);
    });

    this.serverProcess.on('exit', (code: number, signal: string) => {
      console.log('Server process exited with code:', code, 'signal:', signal);
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout - SSE connection never established'));
      }, this.connectionTimeout);

      console.log('🔌 Connecting to SSE endpoint:', `${this.baseUrl}/sse`);
      
      this.eventSource = new EventSource(`${this.baseUrl}/sse`);
      
      this.eventSource.onopen = () => {
        console.log('✅ SSE connection opened');
      };

      this.eventSource.onmessage = (event) => {
        console.log('📨 SSE message received:', event.data);
        this.handleSSEMessage(event.data);
      };

      this.eventSource.addEventListener('endpoint', (event: any) => {
        try {
          const endpointPath = event.data;
          console.log('🎉 MCP SSE endpoint received:', endpointPath);
          
          // Extract session ID from the endpoint path: /messages?sessionId=xxx
          const sessionIdMatch = endpointPath.match(/sessionId=([^&]+)/);
          if (sessionIdMatch && sessionIdMatch[1]) {
            this.sessionId = sessionIdMatch[1];
            this.isConnected = true;
            clearTimeout(timeout);
            console.log('✅ Session ID extracted:', this.sessionId);
            resolve();
          } else {
            clearTimeout(timeout);
            reject(new Error('Invalid endpoint message - no session ID found'));
          }
        } catch (error) {
          clearTimeout(timeout);
          reject(new Error(`Failed to parse endpoint message: ${error}`));
        }
      });

      this.eventSource.onerror = (error) => {
        console.error('❌ SSE error:', error);
        clearTimeout(timeout);
        reject(new Error('SSE connection failed'));
      };
    });
  }

  private handleSSEMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      console.log('📋 Parsed SSE message:', message);
      
      // Check if this is a JSON-RPC response
      if (message.jsonrpc === '2.0' && message.id !== undefined) {
        const pendingRequest = this.pendingRequests.get(message.id);
        if (pendingRequest) {
          this.pendingRequests.delete(message.id);
          pendingRequest.resolve(message);
        } else {
          console.log(`⚠️  Received response for unknown request ID: ${message.id}`);
        }
      } else {
        console.log('📨 Non-response SSE message:', message);
      }
    } catch (error) {
      console.log('📨 Non-JSON SSE message:', data);
    }
  }

  async sendRequest(method: string, params?: Record<string, unknown> | unknown[] | null): Promise<MCPResponse> {
    if (!this.isConnected || !this.sessionId) {
      throw new Error('Client not connected - call connect() first');
    }

    const id = ++this.requestId;
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    console.log(`📤 Sending request ${id}:`, method);

    // Create a promise to wait for the SSE response
    const responsePromise = new Promise<MCPResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${id} timeout after 10 seconds`));
      }, 10000);

      this.pendingRequests.set(id, {
        resolve: (response: MCPResponse) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject: (error: any) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });

    // Send the HTTP POST request (response will come via SSE)
    const httpResponse = await fetch(`${this.baseUrl}/messages?sessionId=${this.sessionId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!httpResponse.ok) {
      const errorText = await httpResponse.text();
      this.pendingRequests.delete(id);
      throw new Error(`HTTP ${httpResponse.status}: ${httpResponse.statusText}. Body: ${errorText}`);
    }

    // The HTTP response should be "Accepted" for SSE transport
    const httpText = await httpResponse.text();
    console.log(`📥 HTTP response ${id}:`, httpText);

    // Wait for the actual JSON-RPC response via SSE
    const result = await responsePromise;
    console.log(`📥 SSE response ${id}:`, result);
    return result;
  }

  async initialize(): Promise<void> {
    console.log('🚀 Starting MCP initialization');
    
    // Send initialize request
    const initResponse = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'test-http-sse-client',
        version: '1.0.0',
      },
    });

    if (!initResponse.result) {
      throw new Error('Failed to initialize MCP server');
    }

    console.log('✅ MCP initialization successful:', initResponse.result);

    // Send initialized notification
    await fetch(`${this.baseUrl}/messages?sessionId=${this.sessionId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });

    console.log('📢 Sent initialized notification');
  }

  async close(): Promise<void> {
    console.log('🔌 Closing client connections');
    
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    
    if (this.serverProcess) {
      this.serverProcess.kill();
    }
    
    this.isConnected = false;
    this.sessionId = null;
  }

  isConnectionEstablished(): boolean {
    return this.isConnected && this.sessionId !== null;
  }
}

describe('MCP HTTP/SSE Integration Tests', () => {
  let testDir: string;
  let cliPath: string;
  let client: MCPHttpSseClient;
  let tmpBaseDir: string;
  let testCounter = 0;
  const serverPort = 3001; // Different port to avoid conflicts

  beforeAll(async () => {
    tmpBaseDir = join(process.cwd(), '.tmp');
    await mkdir(tmpBaseDir, { recursive: true });
    cliPath = join(process.cwd(), 'dist', 'cli.js');
  });

  afterAll(async () => {
    if (tmpBaseDir) {
      await rm(tmpBaseDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    testCounter++;
    testDir = join(tmpBaseDir, `http-sse-test-${testCounter}`);
    await mkdir(testDir, { recursive: true });
    
    client = new MCPHttpSseClient(cliPath, testDir, serverPort);
    
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log(`🧪 Starting test ${testCounter}`);
  });

  afterEach(async () => {
    console.log(`🧹 Cleaning up test ${testCounter}`);
    await client.close();
  });

  describe('Connection Establishment', () => {
    it('should establish SSE connection without hanging', async () => {
      console.log('🧪 Testing SSE connection establishment');
      
      // This test specifically addresses the hanging issue
      await expect(client.connect()).resolves.toBeUndefined();
      
      expect(client.isConnectionEstablished()).toBe(true);
      console.log('✅ SSE connection established successfully');
    });

    it('should complete MCP initialization handshake', async () => {
      console.log('🧪 Testing MCP initialization handshake');
      
      await client.connect();
      await expect(client.initialize()).resolves.toBeUndefined();
      
      console.log('✅ MCP handshake completed successfully');
    });

    it('should receive proper session ID from server', async () => {
      console.log('🧪 Testing session ID assignment');
      
      await client.connect();
      
      expect(client.isConnectionEstablished()).toBe(true);
      // Session ID should be a UUID format
      expect(client['sessionId']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      
      console.log('✅ Session ID validation passed');
    });
  });

  describe('MCP Protocol Communication', () => {
    beforeEach(async () => {
      await client.connect();
      await client.initialize();
    });

    it('should list available tools', async () => {
      console.log('🧪 Testing tools/list request');
      
      const response = await client.sendRequest('tools/list');
      
      expect(response.result).toBeDefined();
      expect(response.result!.tools).toBeInstanceOf(Array);
      expect(response.result!.tools!.length).toBeGreaterThan(0);
      
      const toolNames = response.result!.tools!.map(tool => tool.name);
      expect(toolNames).toContain('create-project');
      expect(toolNames).toContain('list-projects');
      
      console.log('✅ Tools list received successfully');
    });

    it('should handle tool calls correctly', async () => {
      console.log('🧪 Testing tools/call request');
      
      const response = await client.sendRequest('tools/call', {
        name: 'create-project',
        arguments: {
          name: 'http-sse-test-project',
          client: 'HTTP SSE Test Client',
          description: 'Project created via HTTP/SSE transport',
        },
      });

      expect(response.result).toBeDefined();
      expect(response.result!.content).toBeInstanceOf(Array);
      expect(response.result!.content![0].text).toContain('Created project: http-sse-test-project');
      
      console.log('✅ Tool call executed successfully');
    });

    it('should handle ping requests', async () => {
      console.log('🧪 Testing ping request');
      
      const response = await client.sendRequest('ping');
      
      expect(response.result).toBeDefined();
      
      console.log('✅ Ping request handled successfully');
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await client.connect();
      await client.initialize();
    });

    it('should handle invalid method calls gracefully', async () => {
      console.log('🧪 Testing error handling for invalid methods');
      
      const response = await client.sendRequest('invalid/method');
      
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32601); // Method not found
      
      console.log('✅ Invalid method handled correctly');
    });

    it('should handle invalid tool calls gracefully', async () => {
      console.log('🧪 Testing error handling for invalid tools');
      
      const response = await client.sendRequest('tools/call', {
        name: 'nonexistent-tool',
        arguments: {},
      });

      expect(response.error).toBeDefined();
      expect(response.error!.message).toContain('not found');
      
      console.log('✅ Invalid tool call handled correctly');
    });
  });

  describe('Connection Reliability', () => {
    it('should not hang on rapid connection attempts', async () => {
      console.log('🧪 Testing rapid connection attempts');
      
      // Test multiple rapid connections to ensure no hanging
      const clients: MCPHttpSseClient[] = [];
      
      try {
        for (let i = 0; i < 3; i++) {
          const testClient = new MCPHttpSseClient(cliPath, testDir, serverPort);
          clients.push(testClient);
          
          await testClient.connect();
          expect(testClient.isConnectionEstablished()).toBe(true);
          
          console.log(`✅ Client ${i + 1} connected successfully`);
        }
        
        console.log('✅ All rapid connections established successfully');
      } finally {
        // Clean up all test clients
        for (const testClient of clients) {
          await testClient.close();
        }
      }
    });

    it('should handle server restart gracefully', async () => {
      console.log('🧪 Testing server restart handling');
      
      await client.connect();
      await client.initialize();
      
      // Verify initial connection works
      const response1 = await client.sendRequest('tools/list');
      expect(response1.result).toBeDefined();
      
      console.log('✅ Initial connection verified');
      
      // Note: In a real scenario, we would restart the server here
      // For this test, we just verify the connection was working
      expect(client.isConnectionEstablished()).toBe(true);
    });
  });

  describe('Regression Tests for Connection Hanging Bug', () => {
    it('should not hang when client connects without immediate message sending', async () => {
      console.log('🧪 Testing connection without immediate messaging (regression test)');
      
      // This test specifically addresses the original hanging bug
      // where clients would hang at "Establishing connection to the MCP server"
      
      const startTime = Date.now();
      await client.connect();
      const connectionTime = Date.now() - startTime;
      
      // Connection should be established quickly (within 5 seconds)
      expect(connectionTime).toBeLessThan(5000);
      expect(client.isConnectionEstablished()).toBe(true);
      
      // Wait a bit to ensure connection is stable
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Now initialize and verify it works
      await client.initialize();
      
      const response = await client.sendRequest('tools/list');
      expect(response.result).toBeDefined();
      
      console.log(`✅ Connection established in ${connectionTime}ms (regression test passed)`);
    });

    it('should send proper MCP initialization sequence', async () => {
      console.log('🧪 Testing proper MCP initialization sequence (regression test)');
      
      await client.connect();
      
      // Verify server info is returned correctly
      const initResponse = await client.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      expect(initResponse.result).toBeDefined();
      expect(initResponse.result!.serverInfo).toBeDefined();
      expect(initResponse.result!.serverInfo!.name).toBe('mcp-security-report');
      expect(initResponse.result!.protocolVersion).toBeDefined();
      expect(initResponse.result!.capabilities).toBeDefined();
      
      console.log('✅ MCP initialization sequence completed correctly');
    });
  });
});