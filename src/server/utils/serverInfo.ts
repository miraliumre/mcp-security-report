import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Cache for package.json data to avoid repeated file reads
let packageJsonCache: Record<string, unknown> | null = null;

/**
 * Get server information from package.json with caching
 * Reads package.json once and caches the result for subsequent calls
 */
export function getServerInfo(): { name: string; version: string } {
  if (!packageJsonCache) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packageJsonPath = join(__dirname, '../../../package.json');

    try {
      packageJsonCache = JSON.parse(
        readFileSync(packageJsonPath, 'utf-8')
      ) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Failed to read package.json: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    name: (packageJsonCache.name as string) ?? 'mcp-security-report',
    version: (packageJsonCache.version as string) ?? 'dev',
  };
}

/**
 * Clear the package.json cache (useful for testing)
 */
export function clearServerInfoCache(): void {
  packageJsonCache = null;
}
