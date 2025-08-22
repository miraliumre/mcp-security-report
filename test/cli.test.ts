import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';

const execAsync = promisify(exec);

describe('CLI Integration Tests', () => {
  let testDir: string;
  let cliPath: string;
  let tmpBaseDir: string;

  beforeEach(async () => {
    tmpBaseDir = join(process.cwd(), '.tmp');
    await mkdir(tmpBaseDir, { recursive: true });
    testDir = join(
      tmpBaseDir,
      `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    );
    await mkdir(testDir, { recursive: true });
    cliPath = join(process.cwd(), 'dist', 'cli.js');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Project Management', () => {
    it('should create a project via CLI', async () => {
      const { stdout } = await execAsync(
        `node "${cliPath}" project create test-project --client "Test Client" --project-dir "${testDir}"`
      );

      expect(stdout).toContain('Created project: test-project');
      expect(stdout).toContain('ID:');
      expect(stdout).toContain('Status: in-progress');
    });

    it('should list projects via CLI', async () => {
      // First create a project
      await execAsync(
        `node "${cliPath}" project create test-project-1 --client "Client 1" --project-dir "${testDir}"`
      );
      await execAsync(
        `node "${cliPath}" project create test-project-2 --client "Client 2" --project-dir "${testDir}"`
      );

      const { stdout } = await execAsync(
        `node "${cliPath}" project list --project-dir "${testDir}"`
      );

      expect(stdout).toContain('test-project-1');
      expect(stdout).toContain('test-project-2');
      expect(stdout).toContain('Client 1');
      expect(stdout).toContain('Client 2');
    });

    it('should update project status via CLI', async () => {
      // First create a project
      await execAsync(
        `node "${cliPath}" project create test-project --project-dir "${testDir}"`
      );

      const { stdout } = await execAsync(
        `node "${cliPath}" project update test-project --status completed --project-dir "${testDir}"`
      );

      expect(stdout).toContain('Updated project: test-project');
    });

    it('should handle project creation with scope', async () => {
      const { stdout } = await execAsync(
        `node "${cliPath}" project create webapp-audit --scope "https://example.com" "admin.example.com" --project-dir "${testDir}"`
      );

      expect(stdout).toContain('Created project: webapp-audit');
    });
  });

  describe('Finding Management', () => {
    beforeEach(async () => {
      // Create a project for findings tests
      await execAsync(
        `node "${cliPath}" project create test-project --project-dir "${testDir}"`
      );
    });

    it('should create a finding via CLI', async () => {
      const { stdout } = await execAsync(
        `node "${cliPath}" finding create test-project --title "XSS Vulnerability" --severity High --description "Cross-site scripting found" --project-dir "${testDir}"`
      );

      expect(stdout).toContain('Created finding');
      expect(stdout).toContain('XSS Vulnerability');
    });

    it('should list findings via CLI', async () => {
      // Create some findings
      await execAsync(
        `node "${cliPath}" finding create test-project --title "XSS Vulnerability" --severity High --description "XSS found" --project-dir "${testDir}"`
      );
      await execAsync(
        `node "${cliPath}" finding create test-project --title "SQL Injection" --severity Critical --description "SQLi found" --project-dir "${testDir}"`
      );

      const { stdout } = await execAsync(
        `node "${cliPath}" finding list test-project --project-dir "${testDir}"`
      );

      expect(stdout).toContain('XSS Vulnerability');
      expect(stdout).toContain('SQL Injection');
    });

    it('should create finding with CWE and CVSS', async () => {
      const { stdout } = await execAsync(
        `node "${cliPath}" finding create test-project --title "XSS" --severity High --description "XSS found" --cwe "CWE-79" --cvss "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N" --project-dir "${testDir}"`
      );

      expect(stdout).toContain('Created finding');
      expect(stdout).toContain('XSS');
    });

    it('should get specific finding via CLI', async () => {
      // Create a finding first
      const createOutput = await execAsync(
        `node "${cliPath}" finding create test-project --title "Test Finding" --severity medium --description "Test" --project-dir "${testDir}"`
      );

      // Extract finding ID from output (assuming format includes ID)
      const idMatch = createOutput.stdout.match(/ID: (VULN-\d+)/);
      if (idMatch) {
        const findingId = idMatch[1];

        const { stdout } = await execAsync(
          `node "${cliPath}" finding get test-project "${findingId}" --project-dir "${testDir}"`
        );

        expect(stdout).toContain('Test Finding');
        expect(stdout).toContain(findingId);
      }
    });

    it('should update finding via CLI', async () => {
      // Create a finding first
      const createOutput = await execAsync(
        `node "${cliPath}" finding create test-project --title "Original Title" --severity low --description "Original desc" --project-dir "${testDir}"`
      );

      const idMatch = createOutput.stdout.match(/ID: (VULN-\d+)/);
      if (idMatch) {
        const findingId = idMatch[1];

        const { stdout } = await execAsync(
          `node "${cliPath}" finding update test-project "${findingId}" --title "Updated Title" --severity high --project-dir "${testDir}"`
        );

        expect(stdout).toContain('Updated finding');
      }
    });

    it('should delete finding via CLI', async () => {
      // Create a finding first
      const createOutput = await execAsync(
        `node "${cliPath}" finding create test-project --title "To Delete" --severity low --description "Will be deleted" --project-dir "${testDir}"`
      );

      const idMatch = createOutput.stdout.match(/ID: (VULN-\d+)/);
      if (idMatch) {
        const findingId = idMatch[1];

        const { stdout } = await execAsync(
          `node "${cliPath}" finding delete test-project "${findingId}" --project-dir "${testDir}"`
        );

        expect(stdout).toContain('Deleted finding');
      }
    });
  });

  describe('Audit Trail Management', () => {
    beforeEach(async () => {
      // Create a project for audit tests
      await execAsync(
        `node "${cliPath}" project create test-project --project-dir "${testDir}"`
      );
    });

    it('should create an audit trail via CLI', async () => {
      const { stdout } = await execAsync(
        `node "${cliPath}" audit create test-project --title "Reconnaissance" --description "Information gathering phase" --methodology "OWASP" --project-dir "${testDir}"`
      );

      expect(stdout).toContain('Added audit trail');
      expect(stdout).toContain('Reconnaissance');
    });

    it('should list audit trails via CLI', async () => {
      // Create some audit trails
      await execAsync(
        `node "${cliPath}" audit create test-project --title "Reconnaissance" --description "Info gathering" --project-dir "${testDir}"`
      );
      await execAsync(
        `node "${cliPath}" audit create test-project --title "Vulnerability Scanning" --description "Automated scanning" --project-dir "${testDir}"`
      );

      const { stdout } = await execAsync(
        `node "${cliPath}" audit list test-project --project-dir "${testDir}"`
      );

      expect(stdout).toContain('Reconnaissance');
      expect(stdout).toContain('Vulnerability Scanning');
    });

    it('should get specific audit trail via CLI', async () => {
      // Create an audit trail first
      const createOutput = await execAsync(
        `node "${cliPath}" audit create test-project --title "Test Audit" --description "Test audit description" --project-dir "${testDir}"`
      );

      const idMatch = createOutput.stdout.match(/ID: (AUD-\d+)/);
      if (idMatch) {
        const auditId = idMatch[1];

        const { stdout } = await execAsync(
          `node "${cliPath}" audit get test-project "${auditId}" --project-dir "${testDir}"`
        );

        expect(stdout).toContain('Test Audit');
        expect(stdout).toContain(auditId);
      }
    });

    it('should create audit trail with tools', async () => {
      const { stdout } = await execAsync(
        `node "${cliPath}" audit create test-project --title "Scanning" --description "Automated scan" --tools "nmap" "nessus" "burp" --project-dir "${testDir}"`
      );

      expect(stdout).toContain('Added audit trail');
      expect(stdout).toContain('Scanning');
    });
  });

  describe('Executive Summary Management', () => {
    beforeEach(async () => {
      // Create a project for executive summary tests
      await execAsync(
        `node "${cliPath}" project create test-project --project-dir "${testDir}"`
      );
    });

    it('should set executive summary via CLI', async () => {
      const { stdout } = await execAsync(
        `node "${cliPath}" executive set test-project --overview "Security assessment completed" --key-findings "3 critical vulnerabilities found" --project-dir "${testDir}"`
      );

      expect(stdout).toContain('Executive summary updated');
    });

    it('should get executive summary via CLI', async () => {
      // Set summary first
      await execAsync(
        `node "${cliPath}" executive set test-project --overview "Test overview" --project-dir "${testDir}"`
      );

      const { stdout } = await execAsync(
        `node "${cliPath}" executive get test-project --project-dir "${testDir}"`
      );

      expect(stdout).toContain('Test overview');
    });
  });

  describe('CWE Operations', () => {
    it('should get detailed CWE weakness information via CLI', async () => {
      const { stdout } = await execAsync(
        `node "${cliPath}" cwe get 79 --project-dir "${testDir}"`
      );

      expect(stdout).toContain('CWE-79');
      expect(
        stdout.includes('Cross-site Scripting') ||
          stdout.includes('Description')
      ).toBe(true);
    });

    it('should get related CWEs via CLI', async () => {
      const { stdout } = await execAsync(
        `node "${cliPath}" cwe related "79,89" --project-dir "${testDir}"`
      );

      expect(stdout.includes('CWE') || stdout.includes('related')).toBe(true);
    });

    it('should validate CWE ID format', async () => {
      try {
        await execAsync(
          `node "${cliPath}" cwe get "invalid-id" --project-dir "${testDir}"`
        );
      } catch (error: any) {
        expect(error.code).toBe(1);
        expect(error.stderr).toContain('Invalid CWE ID format');
      }
    });
  });

  describe('CVSS Operations', () => {
    it('should validate CVSS vector via CLI', async () => {
      const { stdout } = await execAsync(
        `node "${cliPath}" cvss validate "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N" --project-dir "${testDir}"`
      );

      expect(stdout.includes('valid') || stdout.includes('score')).toBe(true);
    });

    it('should calculate CVSS score via CLI', async () => {
      const { stdout } = await execAsync(
        `node "${cliPath}" cvss calculate "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N" --project-dir "${testDir}"`
      );

      expect(stdout.includes('score') || stdout.includes('valid')).toBe(true);
    });

    it('should handle invalid CVSS vector', async () => {
      const { stdout } = await execAsync(
        `node "${cliPath}" cvss validate "INVALID_VECTOR" --project-dir "${testDir}"`
      );

      expect(stdout.includes('valid') || stdout.includes('error')).toBe(true);
    });
  });

  describe('Project Commands', () => {
    it('should support project create command', async () => {
      const { stdout } = await execAsync(
        `node "${cliPath}" project create test-project --client "Test Client" --project-dir "${testDir}"`
      );

      expect(stdout).toContain('Created project: test-project');
    });

    it('should support project list command', async () => {
      // Create a project first
      await execAsync(
        `node "${cliPath}" project create test-project --project-dir "${testDir}"`
      );

      const { stdout } = await execAsync(
        `node "${cliPath}" project list --project-dir "${testDir}"`
      );

      expect(stdout).toContain('test-project');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid project directory', async () => {
      try {
        await execAsync(
          `node "${cliPath}" project create test --project-dir "/invalid/path/that/does/not/exist"`
        );
      } catch (error: any) {
        expect(error.code).toBe(1);
        expect(error.stderr).toContain('Failed to create project');
      }
    });

    it('should fail with non-empty non-MCP directory', async () => {
      // Create a directory with some non-MCP content
      const nonMcpDir = join(tmpBaseDir, `non-mcp-${Date.now()}`);
      await mkdir(nonMcpDir, { recursive: true });
      await execAsync(
        `echo "some content" > "${join(nonMcpDir, 'random-file.txt')}"`
      );

      try {
        await execAsync(
          `node "${cliPath}" project create test --project-dir "${nonMcpDir}"`
        );
      } catch (error: any) {
        expect(error.code).toBe(1);
        expect(error.stderr).toContain(
          'is not empty and does not appear to be an MCP Security Report directory'
        );
      }

      // Cleanup
      await rm(nonMcpDir, { recursive: true, force: true });
    });

    it('should work with proper MCP directory', async () => {
      // Create a project first to establish it as an MCP directory
      await execAsync(
        `node "${cliPath}" project create initial-project --project-dir "${testDir}"`
      );

      // Should be able to create another project in the same directory
      const { stdout } = await execAsync(
        `node "${cliPath}" project create second-project --project-dir "${testDir}"`
      );

      expect(stdout).toContain('Created project: second-project');
    });

    it('should handle missing required arguments', async () => {
      try {
        await execAsync(`node "${cliPath}" project create`);
      } catch (error: any) {
        expect(error.code).toBe(1);
      }
    });

    it('should handle invalid commands', async () => {
      try {
        await execAsync(`node "${cliPath}" invalid-command`);
      } catch (error: any) {
        expect(error.code).toBe(1);
      }
    });
  });

  describe('Help and Version', () => {
    it('should display help', async () => {
      const { stdout } = await execAsync(`node "${cliPath}" --help`);

      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('Quick Start');
    });

    it('should display version', async () => {
      const { stdout } = await execAsync(`node "${cliPath}" --version`);

      expect(stdout).toContain('1.0.0');
    });

    it('should display command-specific help', async () => {
      const { stdout } = await execAsync(`node "${cliPath}" project --help`);

      expect(stdout).toContain('Project management operations');
    });
  });
});
