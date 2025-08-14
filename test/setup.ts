import { rm, mkdir } from 'fs/promises';
import { join } from 'path';

export async function setup() {
  // Create .tmp directory for tests
  const tmpDir = join(process.cwd(), '.tmp');
  await mkdir(tmpDir, { recursive: true });
  
  // Set NODE_ENV for tests
  process.env.NODE_ENV = 'test';
  
  // Use console logging in tests to avoid winston "no transports" warnings
  process.env.MCP_LOG_TARGET = 'console';
}

export async function teardown() {
  // Clean up .tmp directory after all tests
  const tmpDir = join(process.cwd(), '.tmp');
  try {
    await rm(tmpDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors if directory doesn't exist
  }
}