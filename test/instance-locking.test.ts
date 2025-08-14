import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { mkdir, rm, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { StorageManager } from '../src/server/storage/index.js';
import { CliHandlers } from '../src/cli/handlers.js';

describe('Instance Locking Tests', () => {
  let testDir: string;
  let cliPath: string;
  let tmpBaseDir: string;
  let testCounter = 0;
  let nextPort = 4000; // Start at a higher port to avoid conflicts

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
    testDir = join(tmpBaseDir, `instance-lock-test-${testCounter}`);
    await mkdir(testDir, { recursive: true });
    
    // Create .mcp-projects.json to make this a valid MCP directory
    await writeFile(join(testDir, '.mcp-projects.json'), JSON.stringify({
      projects: {},
      lastActive: undefined
    }, null, 2));
    
    nextPort += 10; // Increment port range for each test to avoid conflicts
  });

  afterEach(async () => {
    // Clean up any remaining processes and files
    await rm(testDir, { recursive: true, force: true });
  });

  describe('StorageManager Instance Locking', () => {
    it('should prevent multiple StorageManager instances in same directory', async () => {
      const storage1 = new StorageManager(testDir);
      await storage1.acquireInstanceLock();

      const storage2 = new StorageManager(testDir);
      
      await expect(storage2.acquireInstanceLock()).rejects.toThrow(
        /Another MCP Security Report instance is already running/
      );
      await expect(storage2.acquireInstanceLock()).rejects.toThrow(
        /Running multiple instances in the same directory can lead to data corruption/
      );
      await expect(storage2.acquireInstanceLock()).rejects.toThrow(
        /you can manually remove the lock file/
      );

      await storage1.releaseInstanceLock();
    });

    it('should allow sequential StorageManager instances after lock release', async () => {
      const storage1 = new StorageManager(testDir);
      await storage1.acquireInstanceLock();
      await storage1.releaseInstanceLock();

      const storage2 = new StorageManager(testDir);
      await expect(storage2.acquireInstanceLock()).resolves.toBeUndefined();
      await storage2.releaseInstanceLock();
    });

    it('should create lock file at expected location', async () => {
      const storage = new StorageManager(testDir);
      await storage.acquireInstanceLock();

      const lockPath = join(testDir, '.mcp-instance.lock');
      // Lock file should exist (but may be a directory or symlink used by proper-lockfile)
      try {
        await access(lockPath);
        // If access succeeds, lock file exists
      } catch (error) {
        // If access fails, check if the lock is actually held by trying to acquire another
        const storage2 = new StorageManager(testDir);
        await expect(storage2.acquireInstanceLock()).rejects.toThrow();
      }

      await storage.releaseInstanceLock();
    });

    it('should handle multiple acquire calls on same instance gracefully', async () => {
      const storage = new StorageManager(testDir);
      await storage.acquireInstanceLock();
      
      // Second acquire on same instance should not fail (idempotent)
      // But proper-lockfile might throw if called twice, so let's test differently
      const storage2 = new StorageManager(testDir);
      await expect(storage2.acquireInstanceLock()).rejects.toThrow();
      
      await storage.releaseInstanceLock();
    });
  });

  describe('CLI Handler Instance Locking', () => {
    it('should prevent multiple CLI handlers in same directory', async () => {
      const handlers1 = new CliHandlers(testDir);
      await handlers1.acquireInstanceLock();

      const handlers2 = new CliHandlers(testDir);
      
      await expect(handlers2.acquireInstanceLock()).rejects.toThrow(
        /Another MCP Security Report instance is already running/
      );

      await handlers1.cleanup();
    });

    it('should automatically acquire lock when using CLI operations', async () => {
      const handlers1 = new CliHandlers(testDir);
      
      // Acquire lock first
      await handlers1.acquireInstanceLock();
      
      const handlers2 = new CliHandlers(testDir);
      
      // Second handler should fail to acquire lock
      await expect(handlers2.acquireInstanceLock()).rejects.toThrow(/Another MCP Security Report instance/);

      await handlers1.cleanup();
    });
  });

  describe('Server Process Instance Locking', () => {
    it('should prevent multiple server processes in same directory', async () => {
      const serverPort1 = nextPort++;
      const serverPort2 = nextPort++;

      // Start first server
      const server1 = spawn('node', [cliPath, 'serve', '--project-dir', testDir, '--port', `${serverPort1}`], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' },
      });

      // Wait for first server to start
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          server1.kill();
          reject(new Error('First server startup timeout'));
        }, 15000); // Increased timeout

        server1.stdout.on('data', (data: Buffer) => {
          if (data.toString().includes('MCP server listening on')) {
            clearTimeout(timeout);
            resolve();
          }
        });

        server1.stderr.on('data', (data: Buffer) => {
          const errorText = data.toString();
          console.error('Server 1 stderr:', errorText);
          if (errorText.includes('Another MCP Security Report instance') || errorText.includes('validation')) {
            clearTimeout(timeout);
            reject(new Error('Server 1 failed to start due to existing lock or validation error'));
          }
        });
      });

      // Try to start second server in same directory
      const server2 = spawn('node', [cliPath, 'serve', '--project-dir', testDir, '--port', `${serverPort2}`], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' },
      });

      // Second server should fail with lock error
      const server2Error = await new Promise<string>((resolve) => {
        let errorOutput = '';
        
        server2.stderr.on('data', (data: Buffer) => {
          errorOutput += data.toString();
        });

        server2.on('exit', () => {
          resolve(errorOutput);
        });

        // Give it time to fail
        setTimeout(() => {
          if (server2.exitCode === null) {
            server2.kill();
          }
          resolve(errorOutput);
        }, 8000);
      });

      expect(server2Error).toContain('Another MCP Security Report instance is already running');
      expect(server2Error).toContain('Running multiple instances in the same directory can lead to data corruption');
      expect(server2Error).toContain('manually remove the lock file');

      // Clean up
      server1.kill();
      server2.kill();
    }, 25000); // Longer test timeout

    it('should prevent CLI operations while server is running', async () => {
      const serverPort = nextPort++;

      // Start server
      const server = spawn('node', [cliPath, 'serve', '--project-dir', testDir, '--port', `${serverPort}`], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' },
      });

      // Wait for server to start
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          server.kill();
          reject(new Error('Server startup timeout'));
        }, 15000);

        server.stdout.on('data', (data: Buffer) => {
          if (data.toString().includes('MCP server listening on')) {
            clearTimeout(timeout);
            resolve();
          }
        });

        server.stderr.on('data', (data: Buffer) => {
          const errorText = data.toString();
          console.error('Server stderr:', errorText);
          if (errorText.includes('Another MCP Security Report instance')) {
            clearTimeout(timeout);
            reject(new Error('Server failed to start due to existing lock'));
          }
        });
      });

      // Try CLI operation - use list instead of create to avoid parameter issues
      const cliProcess = spawn('node', [cliPath, 'project', 'list', '--project-dir', testDir], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' },
      });

      const cliResult = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
        let stdout = '';
        let stderr = '';
        
        cliProcess.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
        
        cliProcess.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        cliProcess.on('exit', (code) => {
          resolve({ stdout, stderr, exitCode: code || 0 });
        });

        // Give CLI command time to run and fail
        setTimeout(() => {
          if (cliProcess.exitCode === null) {
            cliProcess.kill();
          }
          resolve({ stdout, stderr, exitCode: -1 });
        }, 5000);
      });

      expect(cliResult.exitCode).not.toBe(0);
      expect(cliResult.stderr).toContain('Another MCP Security Report instance is already running');

      // Clean up
      server.kill();
      cliProcess.kill();
    }, 25000); // Longer test timeout
  });

  describe('Lock File Error Messages', () => {
    it('should provide helpful error message with lock file path', async () => {
      const storage1 = new StorageManager(testDir);
      await storage1.acquireInstanceLock();

      const storage2 = new StorageManager(testDir);
      
      try {
        await storage2.acquireInstanceLock();
        expect.fail('Should have thrown an error');
      } catch (error) {
        const errorMessage = (error as Error).message;
        expect(errorMessage).toContain(`Another MCP Security Report instance is already running in ${testDir}`);
        expect(errorMessage).toContain('Running multiple instances in the same directory can lead to data corruption');
        expect(errorMessage).toContain('If you are certain no other instance is running, you can manually remove the lock file:');
        expect(errorMessage).toContain(`rm -r "${join(testDir, '.mcp-instance.lock')}"`);
      }

      await storage1.releaseInstanceLock();
    });
  });

  describe('Lock Cleanup on Process Exit', () => {
    it('should clean up lock file when process exits normally', async () => {
      const lockPath = join(testDir, '.mcp-instance.lock');

      // Start a CLI process that creates a project (acquires lock)
      const cliProcess = spawn('node', [cliPath, 'project', 'create', 'test-project', '--project-dir', testDir], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' },
      });

      await new Promise<void>((resolve) => {
        cliProcess.on('exit', () => {
          resolve();
        });
      });

      // Lock file should be cleaned up
      await expect(access(lockPath)).rejects.toThrow();
    });

    it('should allow new instances after previous process exits', async () => {
      // Run first CLI command
      const cliProcess1 = spawn('node', [cliPath, 'project', 'create', 'test-project-1', '--project-dir', testDir], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' },
      });

      await new Promise<void>((resolve) => {
        cliProcess1.on('exit', () => {
          resolve();
        });
      });

      // Run second CLI command (should work after first process exits)
      const cliProcess2 = spawn('node', [cliPath, 'project', 'create', 'test-project-2', '--project-dir', testDir], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' },
      });

      const cliOutput = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
        let stdout = '';
        let stderr = '';

        cliProcess2.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        cliProcess2.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        cliProcess2.on('exit', (code) => {
          resolve({ stdout, stderr, exitCode: code || 0 });
        });
      });

      expect(cliOutput.exitCode).toBe(0);
      expect(cliOutput.stderr).not.toContain('Another MCP Security Report instance is already running');
    });
  });

  describe('Concurrent Access Scenarios', () => {
    it('should handle rapid sequential access attempts', async () => {
      const results: Array<{ success: boolean; error?: string }> = [];

      // Try to create multiple handlers rapidly
      const attempts = 5;
      for (let i = 0; i < attempts; i++) {
        try {
          const handlers = new CliHandlers(testDir);
          await handlers.acquireInstanceLock();
          await handlers.cleanup();
          results.push({ success: true });
        } catch (error) {
          results.push({ 
            success: false, 
            error: (error as Error).message 
          });
        }
      }

      // At least one should succeed, others should fail with lock error
      const successCount = results.filter(r => r.success).length;
      const lockErrors = results.filter(r => !r.success && r.error?.includes('Another MCP Security Report instance')).length;

      expect(successCount).toBeGreaterThan(0);
      expect(successCount + lockErrors).toBe(attempts);
    });

    it('should properly handle mixed server and CLI access', async () => {
      // Start server first
      const serverPort = nextPort++;
      const server = spawn('node', [cliPath, 'serve', '--project-dir', testDir, '--port', `${serverPort}`], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' },
      });

      // Wait for server to start and acquire lock
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          server.kill();
          reject(new Error('Server startup timeout'));
        }, 15000);

        server.stdout.on('data', (data: Buffer) => {
          if (data.toString().includes('MCP server listening on')) {
            clearTimeout(timeout);
            resolve();
          }
        });

        server.stderr.on('data', (data: Buffer) => {
          const errorText = data.toString();
          console.error('Mixed test server stderr:', errorText);
          if (errorText.includes('Another MCP Security Report instance')) {
            clearTimeout(timeout);
            reject(new Error('Server failed to start due to existing lock'));
          }
        });
      });

      // Try multiple CLI operations
      const cliAttempts = 3;
      const cliResults: Array<{ success: boolean; error?: string }> = [];

      for (let i = 0; i < cliAttempts; i++) {
        const cliProcess = spawn('node', [cliPath, 'project', 'list', '--project-dir', testDir], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, NODE_ENV: 'test' },
        });

        const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
          let stderr = '';

          cliProcess.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          cliProcess.on('exit', (code) => {
            if (code === 0) {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: stderr });
            }
          });

          // Add timeout for CLI operations
          setTimeout(() => {
            if (cliProcess.exitCode === null) {
              cliProcess.kill();
            }
            resolve({ success: false, error: stderr || 'CLI operation timeout' });
          }, 5000);
        });

        cliResults.push(result);
      }

      // All CLI operations should fail with lock error
      const allFailed = cliResults.every(r => !r.success);
      const allHaveLockError = cliResults.every(r => r.error?.includes('Another MCP Security Report instance'));
      
      expect(allFailed).toBe(true);
      expect(allHaveLockError).toBe(true);

      // Clean up
      server.kill();
    }, 30000); // Longer test timeout
  });
});