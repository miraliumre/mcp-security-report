import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageManager } from './index.js';
import { ProjectCompletedError } from '../../types/index.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';

describe('StorageManager LRU Cache', () => {
  let tempDir: string;
  let storageManager: StorageManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcp-storage-test-'));
    // Set very small cache size for testing
    process.env.MCP_SECURITY_REPORT_CACHE_SIZE = '2';
    storageManager = new StorageManager(tempDir);
  });

  afterEach(async () => {
    delete process.env.MCP_SECURITY_REPORT_CACHE_SIZE;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should respect cache size limits and evict LRU entries', async () => {
    // Create a test project first
    await storageManager.createProject({
      name: 'test-project',
      client: 'Test Client',
      description: 'Test project for cache testing',
    });

    // Create findings to populate cache
    await storageManager.createFinding('test-project', {
      title: 'Finding 1',
      severity: 'High',
      description: 'Test finding 1',
    });

    await storageManager.createFinding('test-project', {
      title: 'Finding 2',
      severity: 'Medium',
      description: 'Test finding 2',
    });

    // First list should cache findings
    const findings1 = await storageManager.listFindings('test-project');
    expect(findings1).toHaveLength(2);

    // Create another project to test cache eviction
    await storageManager.createProject({
      name: 'test-project-2',
      description: 'Second test project',
    });

    await storageManager.createFinding('test-project-2', {
      title: 'Finding 3',
      severity: 'Low',
      description: 'Test finding 3',
    });

    // This should cause cache eviction due to size limit of 2
    const findings2 = await storageManager.listFindings('test-project-2');
    expect(findings2).toHaveLength(1);

    // Create third project to further test eviction
    await storageManager.createProject({
      name: 'test-project-3',
      description: 'Third test project',
    });

    await storageManager.createFinding('test-project-3', {
      title: 'Finding 4',
      severity: 'Critical',
      description: 'Test finding 4',
    });

    const findings3 = await storageManager.listFindings('test-project-3');
    expect(findings3).toHaveLength(1);

    // All operations should still work correctly despite cache eviction
    const refreshedFindings1 =
      await storageManager.listFindings('test-project');
    expect(refreshedFindings1).toHaveLength(2);
  });

  it('should invalidate cache when findings are modified', async () => {
    await storageManager.createProject({
      name: 'test-project',
      description: 'Test project for cache invalidation',
    });

    await storageManager.createFinding('test-project', {
      title: 'Original Finding',
      severity: 'Medium',
      description: 'Original description',
    });

    // Cache the findings list
    const originalFindings = await storageManager.listFindings('test-project');
    expect(originalFindings).toHaveLength(1);
    expect(originalFindings[0]?.title).toBe('Original Finding');

    // Get the actual finding ID that was generated
    const findingId = originalFindings[0]?.id;
    expect(findingId).toBeDefined();

    // Update the finding - this should invalidate cache
    await storageManager.updateFinding('test-project', findingId!, {
      title: 'Updated Finding',
      description: 'Updated description',
    });

    // List should return updated data, not cached data
    const updatedFindings = await storageManager.listFindings('test-project');
    expect(updatedFindings).toHaveLength(1);
    expect(updatedFindings[0]?.title).toBe('Updated Finding');
  });
});

describe('StorageManager Error Handling', () => {
  let tempDir: string;
  let storageManager: StorageManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcp-storage-error-test-'));
    storageManager = new StorageManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should handle missing project errors gracefully', async () => {
    await expect(
      storageManager.getFinding('nonexistent-project', 'some-finding')
    ).rejects.toThrow('Project "nonexistent-project" not found.');

    await expect(
      storageManager.listFindings('nonexistent-project')
    ).rejects.toThrow('Project "nonexistent-project" not found.');
  });

  it('should handle missing finding errors gracefully', async () => {
    await storageManager.createProject({
      name: 'test-project',
      description: 'Test project',
    });

    await expect(
      storageManager.getFinding('test-project', 'nonexistent-finding')
    ).rejects.toThrow('Finding "nonexistent-finding" not found.');

    await expect(
      storageManager.updateFinding('test-project', 'nonexistent-finding', {
        title: 'Updated title',
      })
    ).rejects.toThrow('Finding "nonexistent-finding" not found.');

    await expect(
      storageManager.deleteFinding('test-project', 'nonexistent-finding')
    ).rejects.toThrow('Finding "nonexistent-finding" not found.');
  });

  it('should handle file system errors gracefully', async () => {
    await storageManager.createProject({
      name: 'test-project',
      description: 'Test project',
    });

    // Test with invalid project name that would cause file system issues
    await expect(
      storageManager.createProject({
        name: '', // Empty name should cause validation error
        description: 'Empty name project',
      })
    ).rejects.toThrow('Invalid project name');

    // Test creating finding in valid project should work
    const finding = await storageManager.createFinding('test-project', {
      title: 'Valid Finding',
      severity: 'Medium',
      description: 'This should work',
    });

    expect(finding.title).toBe('Valid Finding');
    expect(finding.id).toBeDefined();
  });
});

describe('StorageManager CVSS Integration', () => {
  let tempDir: string;
  let storageManager: StorageManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcp-storage-cvss-test-'));
    storageManager = new StorageManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should calculate CVSS scores automatically', async () => {
    await storageManager.createProject({
      name: 'test-project',
      description: 'Test project for CVSS',
    });

    const finding = await storageManager.createFinding('test-project', {
      title: 'CVSS Test Finding',
      severity: 'High',
      description: 'Finding with CVSS',
      cvssString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    });

    expect(finding.cvssScore).toBeDefined();
    expect(finding.cvssScore).toBeGreaterThan(0);
    expect(finding.cvssString).toBe(
      'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'
    );
  });

  it('should handle invalid CVSS strings', async () => {
    await storageManager.createProject({
      name: 'test-project',
      description: 'Test project for CVSS errors',
    });

    await expect(
      storageManager.createFinding('test-project', {
        title: 'Invalid CVSS Test',
        severity: 'Medium',
        description: 'Finding with invalid CVSS',
        cvssString: 'INVALID:CVSS:STRING',
      })
    ).rejects.toThrow(/Invalid CVSS string/);
  });
});

describe('StorageManager Project Completion Validation', () => {
  let tempDir: string;
  let storageManager: StorageManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcp-completion-test-'));
    storageManager = new StorageManager(tempDir);
  });

  afterEach(async () => {
    await storageManager.cleanup();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should prevent deletion of completed projects', async () => {
    // Create and complete a project
    await storageManager.createProject({
      name: 'completed-project',
      description: 'Test completed project',
    });

    await storageManager.updateProject('completed-project', {
      status: 'completed',
    });

    // Attempt to delete should fail
    await expect(
      storageManager.deleteProject('completed-project')
    ).rejects.toThrow(ProjectCompletedError);

    await expect(
      storageManager.deleteProject('completed-project')
    ).rejects.toThrow(/Cannot delete on completed project/);
  });

  it('should prevent updating completed projects', async () => {
    // Create and complete a project
    await storageManager.createProject({
      name: 'completed-project',
      description: 'Test completed project',
    });

    await storageManager.updateProject('completed-project', {
      status: 'completed',
    });

    // Any update attempt should fail
    await expect(
      storageManager.updateProject('completed-project', {
        client: 'New Client',
      })
    ).rejects.toThrow(ProjectCompletedError);

    await expect(
      storageManager.updateProject('completed-project', {
        status: 'in-progress',
      })
    ).rejects.toThrow(ProjectCompletedError);
  });

  it('should prevent creating findings in completed projects', async () => {
    // Create and complete a project
    await storageManager.createProject({
      name: 'completed-project',
      description: 'Test completed project',
    });

    await storageManager.updateProject('completed-project', {
      status: 'completed',
    });

    // Creating findings should fail
    await expect(
      storageManager.createFinding('completed-project', {
        title: 'New Finding',
        severity: 'High',
        description: 'Should not be allowed',
      })
    ).rejects.toThrow(ProjectCompletedError);

    await expect(
      storageManager.createFinding('completed-project', {
        title: 'New Finding',
        severity: 'High',
        description: 'Should not be allowed',
      })
    ).rejects.toThrow(/Cannot create finding on completed project/);
  });

  it('should prevent updating findings in completed projects', async () => {
    // Create project and finding first
    await storageManager.createProject({
      name: 'test-project',
      description: 'Test project',
    });

    const finding = await storageManager.createFinding('test-project', {
      title: 'Test Finding',
      severity: 'Medium',
      description: 'Test finding',
    });

    // Complete the project
    await storageManager.updateProject('test-project', {
      status: 'completed',
    });

    // Updating finding should fail
    await expect(
      storageManager.updateFinding('test-project', finding.id, {
        title: 'Updated Finding',
      })
    ).rejects.toThrow(ProjectCompletedError);
  });

  it('should prevent deleting findings in completed projects', async () => {
    // Create project and finding first
    await storageManager.createProject({
      name: 'test-project',
      description: 'Test project',
    });

    const finding = await storageManager.createFinding('test-project', {
      title: 'Test Finding',
      severity: 'Medium',
      description: 'Test finding',
    });

    // Complete the project
    await storageManager.updateProject('test-project', {
      status: 'completed',
    });

    // Deleting finding should fail
    await expect(
      storageManager.deleteFinding('test-project', finding.id)
    ).rejects.toThrow(ProjectCompletedError);
  });

  it('should prevent creating audit trails in completed projects', async () => {
    // Create and complete a project
    await storageManager.createProject({
      name: 'completed-project',
      description: 'Test completed project',
    });

    await storageManager.updateProject('completed-project', {
      status: 'completed',
    });

    // Creating audit trail should fail
    await expect(
      storageManager.createAuditTrail('completed-project', {
        title: 'New Audit Entry',
        description: 'Should not be allowed',
      })
    ).rejects.toThrow(ProjectCompletedError);
  });

  it('should still allow read operations on completed projects', async () => {
    // Create project with data
    await storageManager.createProject({
      name: 'test-project',
      description: 'Test project',
    });

    const finding = await storageManager.createFinding('test-project', {
      title: 'Test Finding',
      severity: 'High',
      description: 'Test finding',
    });

    const auditTrail = await storageManager.createAuditTrail('test-project', {
      title: 'Test Audit',
      description: 'Test audit trail',
    });

    // Complete the project
    await storageManager.updateProject('test-project', {
      status: 'completed',
    });

    // Read operations should still work
    const project = await storageManager.getProject('test-project');
    expect(project.status).toBe('completed');

    const retrievedFinding = await storageManager.getFinding(
      'test-project',
      finding.id
    );
    expect(retrievedFinding.title).toBe('Test Finding');

    const findings = await storageManager.listFindings('test-project');
    expect(findings).toHaveLength(1);

    const retrievedAudit = await storageManager.getAuditTrail(
      'test-project',
      auditTrail.id
    );
    expect(retrievedAudit.title).toBe('Test Audit');

    const auditTrails = await storageManager.listAuditTrails('test-project');
    expect(auditTrails).toHaveLength(1);
  });

  it('should allow transitioning from in-progress to completed', async () => {
    // Create a project
    const project = await storageManager.createProject({
      name: 'test-project',
      description: 'Test project',
    });

    expect(project.status).toBe('in-progress');

    // Should allow completing the project
    const completedProject = await storageManager.updateProject(
      'test-project',
      {
        status: 'completed',
      }
    );

    expect(completedProject.status).toBe('completed');
  });
});
