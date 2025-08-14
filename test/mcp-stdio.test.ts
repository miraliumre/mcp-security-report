import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';

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
  };
  error?: {
    code: number;
    message: string;
  };
}

class MCPStdioClient {
  private process: ReturnType<typeof spawn>;
  private responseQueue: MCPResponse[] = [];
  private requestId = 0;
  private isReady = false;

  constructor(cliPath: string, projectDir: string) {
    this.process = spawn('node', [cliPath, 'serve', '--stdio', '--project-dir', projectDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    this.process.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          this.responseQueue.push(response);
        } catch (error) {
          // Ignore non-JSON lines (like server startup messages)
          console.log('Non-JSON output:', line);
        }
      }
    });

    this.process.stderr.on('data', (data: Buffer) => {
      console.error('Server stderr:', data.toString());
    });

    this.process.on('error', (error: Error) => {
      console.error('Process error:', error);
    });

    this.process.on('exit', (code: number, signal: string) => {
      console.log('Process exited with code:', code, 'signal:', signal);
    });
  }

  async sendRequest(method: string, params?: Record<string, unknown> | unknown[] | null): Promise<MCPResponse> {
    const id = ++this.requestId;
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    this.process.stdin.write(JSON.stringify(request) + '\n');

    // Wait for response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Request timeout for ${method}`));
      }, 10000);

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

  async initialize(): Promise<void> {
    // Send initialize request immediately
    const initResponse = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'test-client',
        version: '1.0.0',
      },
    });

    if (!initResponse.result) {
      throw new Error('Failed to initialize MCP server');
    }

    // Send initialized notification
    this.process.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n');

    // Brief wait for the server to be fully ready
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  close(): void {
    if (this.process) {
      this.process.kill();
    }
  }
}

describe('MCP Stdio Integration Tests', () => {
  let sharedTestDir: string;
  let cliPath: string;
  let client: MCPStdioClient;
  let tmpBaseDir: string;
  let testCounter = 0;

  beforeAll(async () => {
    tmpBaseDir = join(process.cwd(), '.tmp');
    await mkdir(tmpBaseDir, { recursive: true });
    sharedTestDir = join(tmpBaseDir, `mcp-shared-${Date.now()}`);
    await mkdir(sharedTestDir, { recursive: true });
    cliPath = join(process.cwd(), 'dist', 'cli.js');
  });

  afterAll(async () => {
    await rm(sharedTestDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    testCounter++;
    const testDir = join(sharedTestDir, `test-${testCounter}`);
    await mkdir(testDir, { recursive: true });
    client = new MCPStdioClient(cliPath, testDir);
    await client.initialize();
  });

  afterEach(async () => {
    client.close();
  });

  describe('Server Capabilities', () => {
    it('should list available tools', async () => {
      const response = await client.sendRequest('tools/list');
      
      expect(response.result).toBeDefined();
      expect(response.result.tools).toBeInstanceOf(Array);
      
      const toolNames = response.result!.tools!.map(tool => tool.name);
      expect(toolNames).toContain('create-project');
      expect(toolNames).toContain('list-projects');
      expect(toolNames).toContain('create-finding');
      expect(toolNames).toContain('list-findings');
      expect(toolNames).toContain('add-audit-trail');
      expect(toolNames).toContain('get-cwe-id');
      expect(toolNames).toContain('validate-cvss');
    });

    it('should have proper tool schemas', async () => {
      const response = await client.sendRequest('tools/list');
      
      const createProjectTool = response.result!.tools!.find(tool => tool.name === 'create-project');
      expect(createProjectTool).toBeDefined();
      expect(createProjectTool.inputSchema).toBeDefined();
      expect(createProjectTool.description).toContain('Create a new security audit project');
    });
  });

  describe('Project Management via MCP', () => {
    it('should create a project via MCP', async () => {
      const response = await client.sendRequest('tools/call', {
        name: 'create-project',
        arguments: {
          name: 'mcp-test-project',
          client: 'MCP Test Client',
          description: 'Project created via MCP stdio',
        },
      });

      expect(response.result).toBeDefined();
      expect(response.result.content).toBeInstanceOf(Array);
      expect(response.result.content[0].text).toContain('Created project: mcp-test-project');
    });

    it('should list projects via MCP', async () => {
      // Create a project first
      await client.sendRequest('tools/call', {
        name: 'create-project',
        arguments: {
          name: 'project-1',
          client: 'Client 1',
        },
      });

      await client.sendRequest('tools/call', {
        name: 'create-project',
        arguments: {
          name: 'project-2',
          client: 'Client 2',
        },
      });

      const response = await client.sendRequest('tools/call', {
        name: 'list-projects',
        arguments: {},
      });

      expect(response.result).toBeDefined();
      expect(response.result.content[0].text).toContain('project-1');
      expect(response.result.content[0].text).toContain('project-2');
    });

    it('should update project via MCP', async () => {
      // Create a project first
      await client.sendRequest('tools/call', {
        name: 'create-project',
        arguments: {
          name: 'update-test',
          client: 'Original Client',
        },
      });

      const response = await client.sendRequest('tools/call', {
        name: 'update-project',
        arguments: {
          projectName: 'update-test',
          client: 'Updated Client',
          status: 'completed',
        },
      });

      expect(response.result).toBeDefined();
      expect(response.result.content[0].text).toContain('Updated project: update-test');
    });
  });

  describe('Finding Management via MCP', () => {
    beforeEach(async () => {
      // Create a project for findings tests
      await client.sendRequest('tools/call', {
        name: 'create-project',
        arguments: {
          name: 'findings-test',
        },
      });
    });

    it('should create a finding via MCP', async () => {
      const response = await client.sendRequest('tools/call', {
        name: 'create-finding',
        arguments: {
          projectName: 'findings-test',
          title: 'XSS Vulnerability',
          severity: 'High',
          description: 'Cross-site scripting vulnerability found in search form',
          cwe: 'CWE-79',
          cvssString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N',
        },
      });

      expect(response.result).toBeDefined();
      expect(response.result.content[0].text).toContain('Created finding');
      expect(response.result.content[0].text).toContain('XSS Vulnerability');
    });

    it('should list findings via MCP', async () => {
      // Create some findings
      await client.sendRequest('tools/call', {
        name: 'create-finding',
        arguments: {
          projectName: 'findings-test',
          title: 'SQL Injection',
          severity: 'Critical',
          description: 'SQL injection in login form',
        },
      });

      await client.sendRequest('tools/call', {
        name: 'create-finding',
        arguments: {
          projectName: 'findings-test',
          title: 'Weak Password Policy',
          severity: 'Medium',
          description: 'Password policy allows weak passwords',
        },
      });

      const response = await client.sendRequest('tools/call', {
        name: 'list-findings',
        arguments: {
          projectName: 'findings-test',
        },
      });

      expect(response.result).toBeDefined();
      expect(response.result.content[0].text).toContain('SQL Injection');
      expect(response.result.content[0].text).toContain('Weak Password Policy');
    });

    it('should get specific finding via MCP', async () => {
      // Create a finding
      const createResponse = await client.sendRequest('tools/call', {
        name: 'create-finding',
        arguments: {
          projectName: 'findings-test',
          title: 'Test Finding',
          severity: 'Low',
          description: 'Test finding for get operation',
        },
      });

      // Extract finding ID
      const idMatch = createResponse.result.content[0].text.match(/ID: (VULN-\\d+)/);
      if (idMatch) {
        const findingId = idMatch[1];

        const response = await client.sendRequest('tools/call', {
          name: 'get-finding',
          arguments: {
            projectName: 'findings-test',
            id: findingId,
          },
        });

        expect(response.result).toBeDefined();
        expect(response.result.content[0].text).toContain('Test Finding');
        expect(response.result.content[0].text).toContain(findingId);
      }
    });

    it('should update finding via MCP', async () => {
      // Create a finding
      const createResponse = await client.sendRequest('tools/call', {
        name: 'create-finding',
        arguments: {
          projectName: 'findings-test',
          title: 'Original Title',
          severity: 'Low',
          description: 'Original description',
        },
      });

      const idMatch = createResponse.result.content[0].text.match(/ID: (VULN-\\d+)/);
      if (idMatch) {
        const findingId = idMatch[1];

        const response = await client.sendRequest('tools/call', {
          name: 'update-finding',
          arguments: {
            projectName: 'findings-test',
            id: findingId,
            title: 'Updated Title',
            severity: 'High',
            description: 'Updated description',
          },
        });

        expect(response.result).toBeDefined();
        expect(response.result.content[0].text).toContain('Updated finding');
      }
    });

    it('should delete finding via MCP', async () => {
      // Create a finding
      const createResponse = await client.sendRequest('tools/call', {
        name: 'create-finding',
        arguments: {
          projectName: 'findings-test',
          title: 'To Delete',
          severity: 'Low',
          description: 'This finding will be deleted',
        },
      });

      const idMatch = createResponse.result.content[0].text.match(/ID: (VULN-\\d+)/);
      if (idMatch) {
        const findingId = idMatch[1];

        const response = await client.sendRequest('tools/call', {
          name: 'delete-finding',
          arguments: {
            projectName: 'findings-test',
            id: findingId,
          },
        });

        expect(response.result).toBeDefined();
        expect(response.result.content[0].text).toContain('Deleted finding');
      }
    });
  });

  describe('Audit Trail Management via MCP', () => {
    beforeEach(async () => {
      // Create a project for audit tests
      await client.sendRequest('tools/call', {
        name: 'create-project',
        arguments: {
          name: 'audit-test',
        },
      });
    });

    it('should create audit trail via MCP', async () => {
      const response = await client.sendRequest('tools/call', {
        name: 'add-audit-trail',
        arguments: {
          projectName: 'audit-test',
          title: 'Reconnaissance Phase',
          description: 'Information gathering and reconnaissance',
          methodology: 'OWASP Testing Guide',
          tools: ['nmap', 'dig', 'whois'],
          results: 'Found 5 open ports',
          notes: 'Additional manual testing required',
        },
      });

      expect(response.result).toBeDefined();
      expect(response.result.content[0].text).toContain('Added audit trail');
      expect(response.result.content[0].text).toContain('Reconnaissance Phase');
    });

    it('should list audit trails via MCP', async () => {
      // Create audit trails
      await client.sendRequest('tools/call', {
        name: 'add-audit-trail',
        arguments: {
          projectName: 'audit-test',
          title: 'Reconnaissance',
          description: 'Info gathering',
        },
      });

      await client.sendRequest('tools/call', {
        name: 'add-audit-trail',
        arguments: {
          projectName: 'audit-test',
          title: 'Vulnerability Scanning',
          description: 'Automated scanning phase',
        },
      });

      const response = await client.sendRequest('tools/call', {
        name: 'list-audit-trails',
        arguments: {
          projectName: 'audit-test',
        },
      });

      expect(response.result).toBeDefined();
      expect(response.result.content[0].text).toContain('Reconnaissance');
      expect(response.result.content[0].text).toContain('Vulnerability Scanning');
    });
  });

  describe('Executive Summary via MCP', () => {
    beforeEach(async () => {
      // Create a project for executive summary tests
      await client.sendRequest('tools/call', {
        name: 'create-project',
        arguments: {
          name: 'exec-test',
        },
      });
    });

    it('should set executive summary via MCP', async () => {
      const response = await client.sendRequest('tools/call', {
        name: 'set-executive-summary',
        arguments: {
          projectName: 'exec-test',
          content: `## Executive Overview

Comprehensive security assessment completed

## Key Findings

Found 3 critical and 5 high severity vulnerabilities

## Recommendations

Immediate patching required for critical issues

## Risk Assessment

High risk due to critical vulnerabilities`,
        },
      });

      expect(response.result).toBeDefined();
      expect(response.result.content[0].text).toContain('Executive summary updated');
    });

    it('should get executive summary via MCP', async () => {
      // Set summary first
      await client.sendRequest('tools/call', {
        name: 'set-executive-summary',
        arguments: {
          projectName: 'exec-test',
          content: 'Test executive overview\n\nKey findings summary',
        },
      });

      const response = await client.sendRequest('tools/call', {
        name: 'get-executive-summary',
        arguments: {
          projectName: 'exec-test',
        },
      });

      expect(response.result).toBeDefined();
      expect(response.result.content[0].text).toContain('Test executive overview');
      expect(response.result.content[0].text).toContain('Key findings summary');
    });
  });

  describe('CWE Operations via MCP', () => {
    it('should get CWE information via MCP', async () => {
      const response = await client.sendRequest('tools/call', {
        name: 'get-cwe-id',
        arguments: {
          ids: '79',
        },
      });

      expect(response.result).toBeDefined();
      expect(
        response.result.content[0].text.includes('CWE-79') || 
        response.result.content[0].text.includes('Cross-site Scripting')
      ).toBe(true);
    });

  });

  describe('CVSS Operations via MCP', () => {
    it('should validate CVSS vector via MCP', async () => {
      const response = await client.sendRequest('tools/call', {
        name: 'validate-cvss',
        arguments: {
          vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N',
        },
      });

      expect(response.result).toBeDefined();
      const resultText = response.result.content[0].text;
      expect(resultText.includes('valid') || resultText.includes('score')).toBe(true);
    });

    it('should handle invalid CVSS vector via MCP', async () => {
      const response = await client.sendRequest('tools/call', {
        name: 'validate-cvss',
        arguments: {
          vector: 'INVALID_CVSS_VECTOR',
        },
      });

      expect(response.result).toBeDefined();
      const resultText = response.result.content[0].text;
      expect(resultText.includes('valid') || resultText.includes('error')).toBe(true);
    });
  });

  describe('Error Handling via MCP', () => {
    it('should handle invalid tool calls', async () => {
      const response = await client.sendRequest('tools/call', {
        name: 'nonexistent-tool',
        arguments: {},
      });

      expect(response.error).toBeDefined();
      expect(response.error!.message).toContain('not found');
    });

    it('should handle missing required parameters', async () => {
      const response = await client.sendRequest('tools/call', {
        name: 'create-project',
        arguments: {
          // Missing required 'name' parameter
          client: 'Test Client',
        },
      });

      expect(response.error || response.result.content[0].text.includes('error')).toBeTruthy();
    });

    it('should handle project not found errors', async () => {
      const response = await client.sendRequest('tools/call', {
        name: 'list-findings',
        arguments: {
          projectName: 'nonexistent-project',
        },
      });

      expect(response.result).toBeDefined();
      expect(
        response.result.content[0].text.includes('not found') || 
        response.result.content[0].text.includes('No project')
      ).toBe(true);
    });
  });
});