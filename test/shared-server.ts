import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export class SharedMCPServer {
  private static instance: SharedMCPServer;
  private server: ChildProcess | null = null;
  private isReady = false;
  private responseQueue: MCPResponse[] = [];
  private requestId = 0;

  private constructor() {}

  public static getInstance(): SharedMCPServer {
    if (!SharedMCPServer.instance) {
      SharedMCPServer.instance = new SharedMCPServer();
    }
    return SharedMCPServer.instance;
  }

  async start(projectDir: string): Promise<void> {
    if (this.server) {
      return;
    }

    const cliPath = join(process.cwd(), 'dist', 'cli.js');
    this.server = spawn('node', [cliPath, 'serve', '--stdio', '--project-dir', projectDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    this.server.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          this.responseQueue.push(response);
        } catch (error) {
          // Ignore non-JSON lines
        }
      }
    });

    this.server.stderr?.on('data', (data: Buffer) => {
      console.error('Server stderr:', data.toString());
    });

    // Initialize the server immediately
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });

    this.server.stdin?.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n');

    this.isReady = true;
  }

  async sendRequest(method: string, params?: unknown): Promise<MCPResponse> {
    if (!this.server) {
      throw new Error('Server not started');
    }

    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    this.server.stdin?.write(JSON.stringify(request) + '\n');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Request timeout for ${method}`));
      }, 5000);

      const checkForResponse = () => {
        const response = this.responseQueue.find(r => r.id === id);
        if (response) {
          clearTimeout(timeout);
          this.responseQueue = this.responseQueue.filter(r => r.id !== id);
          resolve(response);
        } else {
          setTimeout(checkForResponse, 1);
        }
      };

      checkForResponse();
    });
  }

  stop(): void {
    if (this.server) {
      this.server.kill();
      this.server = null;
      this.isReady = false;
      this.responseQueue = [];
      this.requestId = 0;
    }
  }
}