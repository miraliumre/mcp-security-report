import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExecutiveSummaryHandler } from './executive.js';
import { StorageManager } from '../storage/index.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';

describe('ExecutiveSummaryHandler Project Completion Validation', () => {
  let tempDir: string;
  let executiveHandler: ExecutiveSummaryHandler;
  let storageManager: StorageManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcp-executive-test-'));
    executiveHandler = new ExecutiveSummaryHandler(tempDir);
    storageManager = new StorageManager(tempDir);
  });

  afterEach(async () => {
    await executiveHandler.cleanup();
    await storageManager.cleanup();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should allow setting executive summary for in-progress projects', async () => {
    // Create a project
    await storageManager.createProject({
      name: 'test-project',
      description: 'Test project',
    });

    // Should allow setting executive summary
    const result = await executiveHandler.setExecutiveSummary({
      projectName: 'test-project',
      content: '# Executive Summary\n\nThis is a test summary.',
    });

    expect(result.content?.[0]?.text).toContain('Executive summary updated');
  });

  it('should prevent setting executive summary for completed projects', async () => {
    // Create and complete a project
    await storageManager.createProject({
      name: 'completed-project',
      description: 'Test completed project',
    });

    await storageManager.updateProject('completed-project', {
      status: 'completed',
    });

    // Should prevent setting executive summary
    const result = await executiveHandler.setExecutiveSummary({
      projectName: 'completed-project',
      content: '# Executive Summary\n\nThis should not be allowed.',
    });

    expect(result.content?.[0]?.text).toContain(
      'Failed to set executive summary'
    );
    expect(result.content?.[0]?.text).toContain(
      'Cannot update executive summary on completed project'
    );
  });

  it('should still allow getting executive summary for completed projects', async () => {
    // Create project and set executive summary first
    await storageManager.createProject({
      name: 'test-project',
      description: 'Test project',
    });

    await executiveHandler.setExecutiveSummary({
      projectName: 'test-project',
      content: '# Executive Summary\n\nTest summary content.',
    });

    // Complete the project
    await storageManager.updateProject('test-project', {
      status: 'completed',
    });

    // Should still allow reading the executive summary
    const result = await executiveHandler.getExecutiveSummary({
      projectName: 'test-project',
    });

    expect(result.content?.[0]?.text).toContain('Test summary content');
  });

  it('should handle validation errors properly', async () => {
    // Test with invalid parameters
    const result = await executiveHandler.setExecutiveSummary({
      projectName: '', // Invalid empty name
      content: 'Some content',
    });

    expect(result.content?.[0]?.text).toContain(
      'Failed to set executive summary'
    );
  });
});
