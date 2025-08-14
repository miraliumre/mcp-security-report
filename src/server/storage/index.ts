import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { v4 as uuidv4 } from 'uuid';
import lockfile from 'proper-lockfile';
import * as yaml from 'js-yaml';
import { createChildLogger } from '../../utils/logger.js';

// Create child logger for storage operations
const logger = createChildLogger('storage');

// Get YAML size limit from environment with secure default
const getYamlSizeLimit = (): number => {
  const envLimit = process.env.MCP_SECURITY_REPORT_MAX_YAML_SIZE;
  if (envLimit) {
    const parsed = parseInt(envLimit, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 1000000) {
      // Max 1MB
      return parsed;
    }
  }
  return 10240; // 10KB default (reduced from 100KB)
};

// Safe gray-matter configuration to prevent YAML bombing and prototype pollution
const SAFE_MATTER_OPTIONS = {
  engines: {
    yaml: {
      parse: (input: string): object => {
        // Limit YAML input size to prevent memory exhaustion
        const sizeLimit = getYamlSizeLimit();
        if (input.length > sizeLimit) {
          throw new Error(
            `YAML frontmatter too large (>${Math.round(sizeLimit / 1024)}KB)`
          );
        }

        // Use js-yaml with safe parsing options
        const result = yaml.load(input, {
          schema: yaml.CORE_SCHEMA, // Restrict to core YAML types only
          json: true, // Ensures compatible with JSON
          onWarning: (warning: Error) => {
            logger.warn('YAML parsing warning', { message: warning.message });
          },
        });

        // Ensure we return an object (gray-matter requirement)
        if (result === null || result === undefined) {
          return {};
        }
        if (typeof result === 'object' && result !== null) {
          return result;
        }
        throw new Error('YAML frontmatter must be an object');
      },
    },
  },
};
import {
  ProjectMetadata,
  ProjectIndex,
  Finding,
  FindingInput,
  AuditTrailEntry,
  AuditTrailInput,
  CreateProjectInput,
  UpdateProjectInput,
  ProjectExistsError,
  ProjectNotFoundError,
  FindingNotFoundError,
  AuditTrailNotFoundError,
  ProjectCompletedError,
} from '../../types/index.js';
import {
  sanitizeProjectName,
  sanitizeFindingId,
  sanitizeAuditId,
} from '../../utils/validation.js';
import { calculateCVSSScore } from '../../utils/cvss.js';
import { getServerConfig } from '../../utils/env.js';

// Internal representation using Map to prevent prototype pollution
interface InternalProjectIndex {
  projects: Map<string, ProjectMetadata>;
  lastActive?: string | undefined;
}

interface CacheEntry<T> {
  data: T;
  lastModified: number;
  lastAccessed: number;
}

// Thread-safe LRU cache implementation with mutex for concurrent access
class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private operationMutex = new Map<string, Promise<void>>();

  constructor(maxSize: number = 50) {
    // Validate and constrain cache size to prevent memory issues
    if (typeof maxSize !== 'number' || !isFinite(maxSize) || maxSize < 1) {
      logger.warn(`Invalid cache size ${maxSize}, using default of 50`);
      this.maxSize = 50;
    } else if (maxSize > 10000) {
      logger.warn(`Cache size ${maxSize} too large, capping at 10000`);
      this.maxSize = 10000;
    } else {
      this.maxSize = Math.floor(maxSize);
    }
  }

  async get(key: string): Promise<CacheEntry<T> | undefined> {
    // Synchronize access to prevent race conditions
    return await this.withMutex(key, () => {
      const entry = this.cache.get(key);
      if (entry) {
        // Update access time for LRU tracking
        entry.lastAccessed = Date.now();
        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);
      }
      return entry;
    });
  }

  async set(key: string, data: T, lastModified: number): Promise<void> {
    // Synchronize access to prevent race conditions
    return await this.withMutex(key, () => {
      const entry: CacheEntry<T> = {
        data,
        lastModified,
        lastAccessed: Date.now(),
      };

      // Remove if already exists
      this.cache.delete(key);

      // Add to end
      this.cache.set(key, entry);

      // Evict oldest if over limit
      this.evictIfNeeded();
    });
  }

  async delete(key: string): Promise<boolean> {
    return await this.withMutex(key, () => {
      return this.cache.delete(key);
    });
  }

  clear(): void {
    // Clear all mutexes and cache
    this.operationMutex.clear();
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  private async withMutex<R>(key: string, operation: () => R): Promise<R> {
    // Check if there's already an operation in progress for this key
    const existingOperation = this.operationMutex.get(key);
    if (existingOperation) {
      await existingOperation;
    }

    // Create a new promise for this operation
    let resolveOperation!: () => void;
    const operationPromise = new Promise<void>((resolve) => {
      resolveOperation = resolve;
    });

    this.operationMutex.set(key, operationPromise);

    try {
      const result = operation();
      return result;
    } finally {
      // Clean up the mutex entry
      this.operationMutex.delete(key);
      resolveOperation();
    }
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxSize) {
      return;
    }

    // Remove the least recently used (first in Map)
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      this.cache.delete(firstKey);
    }
  }
}

export class StorageManager {
  private readonly workingDir: string;
  private readonly projectIndexPath: string;
  private readonly instanceLockPath: string;
  private projectIndexCache: InternalProjectIndex | null = null;
  private instanceLockRelease: (() => Promise<void>) | null = null;

  // LRU caches for findings and audit trails with configurable size limits
  private findingsCache: LRUCache<Finding[]>;
  private auditTrailsCache: LRUCache<AuditTrailEntry[]>;

  // Static cleanup management
  private static cleanupInterval: NodeJS.Timeout | null = null;
  private static instanceCount = 0;
  private static lastCleanup = 0;

  constructor(workingDir: string = process.cwd()) {
    this.workingDir = path.resolve(workingDir);
    this.projectIndexPath = path.join(this.workingDir, '.mcp-projects.json');
    this.instanceLockPath = path.join(this.workingDir, '.mcp-instance');

    // Initialize caches with validated environment configuration
    const serverConfig = getServerConfig();
    this.findingsCache = new LRUCache<Finding[]>(serverConfig.cacheSize);
    this.auditTrailsCache = new LRUCache<AuditTrailEntry[]>(
      serverConfig.cacheSize
    );

    // Increment instance count and manage cleanup
    StorageManager.instanceCount++;
    this.schedulePeriodicCleanup();
  }

  /**
   * Schedule periodic cleanup if not already running
   * Only run cleanup when needed and avoid excessive cleanup calls
   */
  private schedulePeriodicCleanup(): void {
    const now = Date.now();
    const cleanupInterval = 5 * 60 * 1000; // 5 minutes

    // If cleanup was recent, don't schedule another one
    if (now - StorageManager.lastCleanup < cleanupInterval) {
      return;
    }

    // If periodic cleanup is not running, start it
    if (StorageManager.cleanupInterval === null) {
      StorageManager.cleanupInterval = setInterval(() => {
        this.performScheduledCleanup().catch((error) => {
          logger.warn('Scheduled lock cleanup failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }, cleanupInterval);

      // Also run cleanup immediately if it's been a while
      if (now - StorageManager.lastCleanup > cleanupInterval) {
        this.performScheduledCleanup().catch((error) => {
          logger.warn('Initial lock cleanup failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }
  }

  /**
   * Perform scheduled cleanup of stale locks
   */
  private async performScheduledCleanup(): Promise<void> {
    StorageManager.lastCleanup = Date.now();
    await this.cleanupStaleLocks();
  }

  /**
   * Static method to force cleanup cancellation (for testing or shutdown)
   */
  public static cancelPeriodicCleanup(): void {
    if (StorageManager.cleanupInterval !== null) {
      clearInterval(StorageManager.cleanupInterval);
      StorageManager.cleanupInterval = null;
    }
  }

  /**
   * Acquire instance lock to prevent concurrent instances in the same directory
   * @throws Error if another instance is already running or lock cannot be acquired
   */
  public async acquireInstanceLock(): Promise<void> {
    try {
      // Ensure the working directory exists before trying to create the lock
      await this.ensureDirectoryExists(this.workingDir);

      // Initialize the project index file if it doesn't exist
      // This prevents the corruption detection from firing when the server is restarted
      // in a directory that doesn't have projects yet but was previously used as an MCP directory
      await this.initializeProjectIndex();

      this.instanceLockRelease = await lockfile.lock(this.instanceLockPath, {
        retries: {
          retries: 0, // Don't retry for instance locks
          factor: 1,
          minTimeout: 0,
          maxTimeout: 0,
        },
        stale: 30000, // Consider instance locks stale after 30 seconds
        realpath: false,
      });

      logger.info('Instance lock acquired', { workingDir: this.workingDir });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('already being held')
      ) {
        throw new Error(
          `Another MCP Security Report instance is already running in ${this.workingDir}.\n` +
            'Running multiple instances in the same directory can lead to data corruption.\n' +
            'If you are certain no other instance is running, you can manually remove the lock file:\n' +
            `  rm -r "${this.instanceLockPath}.lock"`
        );
      }
      throw new Error(
        `Failed to acquire instance lock: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Release the instance lock
   */
  public async releaseInstanceLock(): Promise<void> {
    if (this.instanceLockRelease) {
      try {
        await this.instanceLockRelease();
        this.instanceLockRelease = null;
        logger.info('Instance lock released', { workingDir: this.workingDir });
      } catch (error) {
        logger.warn('Failed to release instance lock', {
          workingDir: this.workingDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Cleanup method to be called when StorageManager is destroyed
   */
  public async cleanup(): Promise<void> {
    // Release instance lock first
    await this.releaseInstanceLock();

    StorageManager.instanceCount--;

    // If this is the last instance, cancel periodic cleanup
    if (StorageManager.instanceCount <= 0) {
      StorageManager.cancelPeriodicCleanup();
      StorageManager.instanceCount = 0; // Ensure it doesn't go negative
    }
  }

  private async cleanupStaleLocks(): Promise<void> {
    try {
      const serverConfig = getServerConfig();
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const files = await fs.readdir(this.workingDir);
      const lockFiles = files.filter(
        (f) => f.startsWith('.mcp-lock-') || f === '.mcp-instance.lock'
      );

      for (const lockFile of lockFiles) {
        const lockPath = path.join(this.workingDir, lockFile);
        try {
          // Skip our own instance lock
          if (lockPath === this.instanceLockPath && this.instanceLockRelease) {
            continue;
          }

          // Check if lock is stale (using configurable timeout)
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          const stats = await fs.stat(lockPath);
          const ageMs = Date.now() - stats.mtimeMs;

          // Use shorter timeout for instance locks since they should be active
          const staleTimeout =
            lockFile === '.mcp-instance.lock'
              ? 60000
              : serverConfig.lockStaleMs;

          if (ageMs > staleTimeout) {
            // Remove lock regardless of whether it's a file or directory
            await fs.rm(lockPath, { recursive: true, force: true });
            logger.info(`Cleaned up stale lock: ${lockFile}`);
          }
        } catch (error) {
          // Ignore individual lock file errors
          logger.debug(`Failed to check/remove lock file ${lockFile}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      // Log but don't throw - this is a best-effort cleanup
      logger.debug('Lock cleanup scan failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      throw new Error(
        `Failed to create directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Initialize the project index file if it doesn't exist
   * This ensures that the .mcp-projects.json file is created when the server starts,
   * preventing corruption detection from firing incorrectly on server restarts
   */
  private async initializeProjectIndex(): Promise<void> {
    try {
      // Check if the project index file already exists
      try {
        await fs.access(this.projectIndexPath);
        // File exists, no need to initialize
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // Some other error occurred while checking file existence
          throw error;
        }
        // File doesn't exist, continue with initialization
      }

      // Create an empty project index
      const emptyIndex: ProjectIndex = {
        projects: {},
        // Don't set lastActive for a fresh index
      };

      // Write the empty index file atomically
      const tempPath = `${this.projectIndexPath}.tmp`;
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.writeFile(tempPath, JSON.stringify(emptyIndex, null, 2));
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.rename(tempPath, this.projectIndexPath);

      logger.info('Initialized empty project index', {
        indexPath: this.projectIndexPath,
      });

      // Clear any cached data to ensure fresh reads
      this.projectIndexCache = null;
    } catch (error) {
      // Clean up temporary file if it exists
      try {
        const tempPath = `${this.projectIndexPath}.tmp`;
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      throw new Error(
        `Failed to initialize project index: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async invalidateCache(
    projectName: string,
    type: 'findings' | 'audit-trails'
  ): Promise<void> {
    if (type === 'findings') {
      await this.findingsCache.delete(`${projectName}-findings`);
    } else {
      await this.auditTrailsCache.delete(`${projectName}-audit-trails`);
    }
  }

  private async getDirectoryLastModified(dirPath: string): Promise<number> {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const files = await fs.readdir(dirPath);
      if (files.length === 0) return 0;

      const stats = await Promise.all(
        files.map(async (file) => {
          try {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            const stat = await fs.stat(path.join(dirPath, file));
            return stat.mtimeMs;
          } catch {
            return 0;
          }
        })
      );

      return Math.max(...stats);
    } catch {
      return 0;
    }
  }

  private async withLock<T>(
    lockKey: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const lockPath = path.join(this.workingDir, `.mcp-lock-${lockKey}`);

    // Use proper-lockfile library to handle lock file creation atomically
    // No need to pre-create the lock file as the library handles this
    let release: (() => Promise<void>) | null = null;

    try {
      release = await lockfile.lock(lockPath, {
        retries: {
          retries: 10,
          factor: 2,
          minTimeout: 100,
          maxTimeout: 3000,
        },
        stale: 10000, // Consider locks stale after 10 seconds
        realpath: false, // Avoid unnecessary realpath calls for performance
      });

      return await operation();
    } catch (error) {
      // If lock acquisition failed, re-throw with context
      if (
        error instanceof Error &&
        error.message.includes('already being held')
      ) {
        throw new Error(`Operation timed out waiting for lock: ${lockKey}`);
      }
      throw error;
    } finally {
      if (release) {
        try {
          await release();
        } catch (releaseError) {
          logger.warn('Failed to release lock', {
            lockKey,
            error:
              releaseError instanceof Error
                ? releaseError.message
                : String(releaseError),
          });
        }
      }
    }
  }

  private async readProjectIndex(): Promise<InternalProjectIndex> {
    // Return cached data if available
    if (this.projectIndexCache !== null) {
      return this.projectIndexCache;
    }

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const content = await fs.readFile(this.projectIndexPath, 'utf-8');
      const data = JSON.parse(content) as ProjectIndex;

      // Convert to internal Map-based representation
      const projectsMap = new Map<string, ProjectMetadata>();
      for (const [projectId, metadata] of Object.entries(data.projects)) {
        projectsMap.set(projectId, {
          ...metadata,
          created: new Date(metadata.created),
          updated: new Date(metadata.updated),
        });
      }

      const internalIndex: InternalProjectIndex = {
        projects: projectsMap,
        lastActive: data.lastActive,
      };

      // Cache the result
      this.projectIndexCache = internalIndex;
      return internalIndex;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Check if this is a corrupted directory with projects but missing index
        await this.checkForCorruptedDirectory();

        const emptyIndex: InternalProjectIndex = { projects: new Map() };
        this.projectIndexCache = emptyIndex;
        return emptyIndex;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read project index: ${errorMsg}`);
    }
  }

  /**
   * Check if the working directory contains project directories but missing .mcp-projects.json
   * This indicates directory corruption and should trigger a fatal error
   */
  private async checkForCorruptedDirectory(): Promise<void> {
    try {
      // Skip corruption check for test directories and temporary directories
      if (
        this.workingDir.includes('tmp') ||
        this.workingDir.includes('temp') ||
        this.workingDir.includes('test') ||
        process.env.NODE_ENV === 'test' ||
        process.env.VITEST === 'true'
      ) {
        return;
      }

      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const entries = await fs.readdir(this.workingDir, {
        withFileTypes: true,
      });

      // Look for signs this was an established MCP directory:
      // 1. Has lock files or other MCP artifacts
      // 2. Has multiple project directories (indicates established usage)
      const hasLockFiles = entries.some(
        (entry) =>
          entry.name.startsWith('.mcp-lock-') ||
          entry.name === '.mcp-instance.lock'
      );

      // Look for directories that could be project directories
      const projectLikeDirs = entries.filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          !entry.name.startsWith('node_modules') &&
          !entry.name.startsWith('tmp') &&
          !entry.name.startsWith('temp')
      );

      // Check if any of these directories contain project.json files
      const actualProjectDirs: string[] = [];
      for (const dir of projectLikeDirs) {
        try {
          const projectJsonPath = path.join(
            this.workingDir,
            dir.name,
            'project.json'
          );
          await fs.access(projectJsonPath);
          actualProjectDirs.push(dir.name);
        } catch {
          // Not a project directory, continue
        }
      }

      // Only trigger corruption detection if:
      // 1. We found project directories AND
      // 2. There are signs this was an established MCP directory (lock files OR multiple projects)
      if (
        actualProjectDirs.length > 0 &&
        (hasLockFiles || actualProjectDirs.length > 1)
      ) {
        const errorMessage =
          `FATAL: MCP Security Report directory corruption detected!\n` +
          `Found ${actualProjectDirs.length} project directories but missing .mcp-projects.json index file.\n` +
          `Projects found: ${actualProjectDirs.join(', ')}\n` +
          `Working directory: ${this.workingDir}\n\n` +
          `This indicates data corruption or manual deletion of the index file.\n` +
          `To recover, either:\n` +
          `1. Restore .mcp-projects.json from backup, or\n` +
          `2. Move existing project directories to a safe location and reinitialize\n\n` +
          `The server cannot safely continue operation in this state.`;

        logger.error('MCP directory corruption detected', {
          workingDir: this.workingDir,
          projectDirs: actualProjectDirs,
          indexPath: this.projectIndexPath,
          hasLockFiles,
        });

        throw new Error(errorMessage);
      }
    } catch (error) {
      // If the error is our own corruption error, re-throw it
      if (
        error instanceof Error &&
        error.message.includes(
          'FATAL: MCP Security Report directory corruption'
        )
      ) {
        throw error;
      }

      // For other errors (like permission issues), log but don't fail
      // Better to continue with empty index than crash unnecessarily
      logger.warn('Failed to check for directory corruption', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async writeProjectIndex(index: InternalProjectIndex): Promise<void> {
    const tempPath = `${this.projectIndexPath}.tmp`;
    try {
      // Convert Map to plain object for JSON serialization
      const jsonIndex: ProjectIndex = {
        projects: Object.fromEntries(index.projects),
        lastActive: index.lastActive,
      };

      // Write to temporary file first for atomic operation
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.writeFile(tempPath, JSON.stringify(jsonIndex, null, 2));
      // Atomic rename
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.rename(tempPath, this.projectIndexPath);

      // Invalidate cache after successful write
      this.projectIndexCache = null;
    } catch (error) {
      // Clean up temporary file if it exists
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write project index: ${errorMsg}`);
    }
  }

  private getProjectPath(projectName: string): string {
    const sanitized = sanitizeProjectName(projectName);
    const projectPath = path.join(this.workingDir, sanitized);

    // Basic validation that the project path is within working directory
    if (!projectPath.startsWith(this.workingDir)) {
      throw new Error(`Invalid project path: ${projectName}`);
    }

    return projectPath;
  }

  async createProject(input: CreateProjectInput): Promise<ProjectMetadata> {
    const sanitizedName = sanitizeProjectName(input.name);
    if (!sanitizedName) {
      throw new Error('Invalid project name');
    }

    const projectPath = this.getProjectPath(sanitizedName);

    // Use locking to prevent concurrent project creation
    return this.withLock('project-index', async () => {
      // Check if project already exists
      try {
        await fs.access(projectPath);
        throw new ProjectExistsError(sanitizedName);
      } catch (error) {
        if (
          !(error instanceof ProjectExistsError) &&
          (error as NodeJS.ErrnoException).code !== 'ENOENT'
        ) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to check project existence: ${errorMsg}`);
        }
        if (error instanceof ProjectExistsError) {
          throw error;
        }
      }

      const metadata: ProjectMetadata = {
        id: uuidv4(),
        name: sanitizedName,
        client: input.client ?? undefined,
        created: new Date(),
        updated: new Date(),
        scope: input.scope ?? undefined,
        status: 'in-progress',
        description: input.description ?? undefined,
      };

      // Perform the entire operation in a transaction-like pattern
      return this.executeProjectCreationTransaction(
        sanitizedName,
        projectPath,
        metadata
      );
    });
  }

  /**
   * Execute project creation as a transaction with automatic rollback on failure
   */
  private async executeProjectCreationTransaction(
    sanitizedName: string,
    projectPath: string,
    metadata: ProjectMetadata
  ): Promise<ProjectMetadata> {
    // Track operations for rollback in reverse order with state tracking
    const operations: Array<{
      operation: () => Promise<void>;
      description: string;
      completed: boolean;
    }> = [];
    let originalIndexState: InternalProjectIndex | null = null;

    try {
      // Step 1: Create directory structure
      await this.ensureDirectoryExists(projectPath);
      operations.push({
        operation: async () => {
          await fs.rm(projectPath, { recursive: true, force: true });
        },
        description: 'Remove project directory',
        completed: true,
      });

      await this.ensureDirectoryExists(path.join(projectPath, 'findings'));
      await this.ensureDirectoryExists(path.join(projectPath, 'audit-trails'));

      // Step 2: Write project metadata atomically
      const projectFile = path.join(projectPath, 'project.json');
      const tempFile = `${projectFile}.tmp`;

      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.writeFile(tempFile, JSON.stringify(metadata, null, 2));
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.rename(tempFile, projectFile);

      // Step 3: Backup current index state before modification
      originalIndexState = await this.readProjectIndex();

      // Step 4: Update project index (most critical step - do last)
      const newIndex: InternalProjectIndex = {
        projects: new Map(originalIndexState.projects),
        lastActive: originalIndexState.lastActive,
      };
      newIndex.projects.set(sanitizedName, metadata);

      operations.push({
        operation: async () => {
          if (originalIndexState) {
            await this.writeProjectIndex(originalIndexState);
            this.projectIndexCache = null; // Invalidate cache
          }
        },
        description: 'Restore project index',
        completed: false,
      });

      await this.writeProjectIndex(newIndex);
      const lastOperation = operations[operations.length - 1];
      if (lastOperation) {
        lastOperation.completed = true;
      }

      // If we reach here, the transaction succeeded
      logger.info(`Project created successfully: ${sanitizedName}`);
      return metadata;
    } catch (error) {
      // Execute rollback operations in reverse order atomically
      logger.warn(
        `Project creation failed for ${sanitizedName}, executing atomic rollback...`
      );

      const rollbackErrors: string[] = [];

      // Perform rollback in reverse order
      for (let i = operations.length - 1; i >= 0; i--) {
        const rollbackItem = operations.at(i);
        if (rollbackItem?.completed) {
          try {
            await rollbackItem.operation();
            logger.debug(`Rollback completed: ${rollbackItem.description}`);
          } catch (rollbackError) {
            const rollbackMsg =
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError);
            rollbackErrors.push(`${rollbackItem.description}: ${rollbackMsg}`);
            logger.error('Rollback operation failed', {
              step: i,
              description: rollbackItem.description,
              error: rollbackMsg,
            });
          }
        }
      }

      // Always clear the project index cache to ensure fresh reads
      this.projectIndexCache = null;

      // If rollback had errors, include them in the error message
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (rollbackErrors.length > 0) {
        throw new Error(
          `Failed to create project: ${errorMsg}. Rollback errors: ${rollbackErrors.join('; ')}`
        );
      } else {
        throw new Error(`Failed to create project: ${errorMsg}`);
      }
    }
  }

  async listProjects(): Promise<ProjectMetadata[]> {
    const index = await this.readProjectIndex();
    return Array.from(index.projects.values()).sort(
      (a, b) => b.updated.getTime() - a.updated.getTime()
    );
  }

  async getProject(projectName: string): Promise<ProjectMetadata> {
    const sanitizedName = sanitizeProjectName(projectName);
    const index = await this.readProjectIndex();
    const metadata = index.projects.get(sanitizedName);

    if (!metadata) {
      throw new ProjectNotFoundError(sanitizedName);
    }

    return metadata;
  }

  /**
   * Check if a project is completed and throw error if attempting to modify it
   * @param projectName - The project name to check
   * @param operation - Description of the operation being attempted for error message
   * @throws ProjectCompletedError if the project is completed
   */
  private async checkProjectNotCompleted(
    projectName: string,
    operation: string
  ): Promise<void> {
    const project = await this.getProject(projectName);
    if (project.status === 'completed') {
      throw new ProjectCompletedError(projectName, operation);
    }
  }

  async updateProject(
    projectName: string,
    updates: UpdateProjectInput
  ): Promise<ProjectMetadata> {
    return this.withLock('project-index', async () => {
      const metadata = await this.getProject(projectName);

      // Prevent ANY updates to completed projects
      if (metadata.status === 'completed') {
        throw new ProjectCompletedError(projectName, 'update');
      }

      const updated: ProjectMetadata = {
        ...metadata,
        ...updates,
        updated: new Date(),
        // Ensure required fields are properly typed
        status: updates.status ?? metadata.status,
      };

      const projectPath = this.getProjectPath(projectName);
      const projectFile = path.join(projectPath, 'project.json');
      const tempFile = `${projectFile}.tmp`;

      try {
        // Write to temporary file first
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.writeFile(tempFile, JSON.stringify(updated, null, 2));

        // Atomic rename of project file first (safer order)
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.rename(tempFile, projectFile);

        // Update project index after successful file update
        const index = await this.readProjectIndex();
        index.projects.set(sanitizeProjectName(projectName), updated);
        await this.writeProjectIndex(index);

        return updated;
      } catch (error) {
        // Clean up temporary file
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          await fs.unlink(tempFile);
        } catch {
          // Ignore cleanup errors
        }
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to update project: ${errorMsg}`);
      }
    });
  }

  async deleteProject(projectName: string): Promise<void> {
    const sanitizedName = sanitizeProjectName(projectName);

    return this.withLock('project-index', async () => {
      // Verify project exists
      await this.getProject(sanitizedName);

      // Prevent deletion of completed projects for audit integrity
      await this.checkProjectNotCompleted(sanitizedName, 'delete');

      const projectPath = this.getProjectPath(sanitizedName);

      // Store original index for potential rollback
      const originalIndex = await this.readProjectIndex();

      // The correct order is: update index first (safer), then delete directory
      // This way, if directory deletion fails, the project still exists in the filesystem
      try {
        // Step 1: Update index to remove project
        const index: InternalProjectIndex = {
          projects: new Map(originalIndex.projects),
          lastActive: originalIndex.lastActive,
        };
        index.projects.delete(sanitizedName);

        if (index.lastActive === sanitizedName) {
          delete index.lastActive;
        }

        await this.writeProjectIndex(index);

        // Step 2: Delete directory after successful index update
        await fs.rm(projectPath, { recursive: true, force: true });

        logger.info(`Project deleted successfully: ${sanitizedName}`);
      } catch (error) {
        // If index was updated but directory deletion failed, restore the index
        try {
          await this.writeProjectIndex(originalIndex);
          this.projectIndexCache = null; // Clear cache to ensure fresh read
          logger.info(
            `Restored project index after failed directory deletion: ${sanitizedName}`
          );
        } catch (restoreError) {
          logger.error(
            'Failed to restore project index after directory deletion failure',
            {
              project: sanitizedName,
              error:
                restoreError instanceof Error
                  ? restoreError.message
                  : String(restoreError),
            }
          );
          // Clear cache to prevent stale data
          this.projectIndexCache = null;
        }

        const errorMsg =
          error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to delete project: ${errorMsg}`);
      }
    });
  }

  async createFinding(
    projectName: string,
    input: FindingInput
  ): Promise<Finding> {
    await this.getProject(projectName);

    // Prevent creating findings in completed projects
    await this.checkProjectNotCompleted(projectName, 'create finding');

    const finding: Finding = {
      ...input,
      id: sanitizeFindingId(input.title),
      created: new Date(),
      updated: new Date(),
      cvssScore: undefined,
    };

    if (input.cvssString) {
      try {
        const cvssResult = calculateCVSSScore(input.cvssString);
        finding.cvssScore = cvssResult.score;
      } catch (error) {
        throw new Error(
          `Invalid CVSS string: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const lockKey = `finding-${projectName}-${finding.id}`;
    return this.withLock(lockKey, async () => {
      const projectPath = this.getProjectPath(projectName);
      const findingPath = path.join(
        projectPath,
        'findings',
        `${finding.id}.md`
      );
      const tempPath = `${findingPath}.tmp`;

      // Check if finding already exists
      try {
        await fs.access(findingPath);
        throw new Error(`Finding with ID '${finding.id}' already exists`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      const frontmatter: Record<string, unknown> = {
        id: finding.id,
        title: finding.title,
        severity: finding.severity,
        created: finding.created.toISOString(),
        updated: finding.updated.toISOString(),
      };

      // Only add fields that are not undefined to avoid YAML serialization errors
      if (finding.cwe !== undefined) {
        frontmatter.cwe = finding.cwe;
      }
      if (finding.cvssString !== undefined) {
        frontmatter.cvssString = finding.cvssString;
      }
      if (finding.cvssScore !== undefined) {
        frontmatter.cvssScore = finding.cvssScore;
      }
      if (finding.components !== undefined) {
        frontmatter.components = finding.components;
      }

      const content = matter.stringify(
        `## Description\n\n${finding.description}\n\n${finding.evidence ? `## Evidence\n\n${finding.evidence}\n\n` : ''}${finding.recommendations ? `## Recommendations\n\n${finding.recommendations}` : ''}`,
        frontmatter
      );

      try {
        // Write to temporary file first for atomic operation
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.writeFile(tempPath, content);
        // Atomic rename
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.rename(tempPath, findingPath);
        await this.updateProject(projectName, {}); // Update timestamp

        // Invalidate findings cache
        await this.invalidateCache(projectName, 'findings');

        return finding;
      } catch (error) {
        // Clean up temporary file if it exists
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          await fs.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
        throw new Error(
          `Failed to create finding: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  async getFinding(projectName: string, findingId: string): Promise<Finding> {
    await this.getProject(projectName);

    const projectPath = this.getProjectPath(projectName);
    const findingPath = path.join(projectPath, 'findings', `${findingId}.md`);

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const content = await fs.readFile(findingPath, 'utf-8');
      const parsed = matter(content, SAFE_MATTER_OPTIONS);
      const data = parsed.data as Record<string, unknown>;

      // Parse markdown content using regex for better reliability
      const markdownContent = parsed.content;

      const extractSection = (sectionName: string): string | undefined => {
        // eslint-disable-next-line security/detect-non-literal-regexp
        const regex = new RegExp(
          `## ${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`,
          'i'
        );
        const match = markdownContent.match(regex);
        return match?.[1]?.trim() ?? undefined;
      };

      const description = extractSection('Description') ?? '';
      const evidence = extractSection('Evidence');
      const recommendations = extractSection('Recommendations');

      return {
        id: data.id as string,
        title: data.title as string,
        severity: data.severity as Finding['severity'],
        cwe: data.cwe as string | undefined,
        cvssString: data.cvssString as string | undefined,
        cvssScore: data.cvssScore as number | undefined,
        components: data.components as string[] | undefined,
        description,
        evidence,
        recommendations,
        created: new Date(data.created as string),
        updated: new Date(data.updated as string),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FindingNotFoundError(findingId);
      }
      throw new Error(
        `Failed to read finding: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async listFindings(
    projectName: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<Finding[]> {
    const { limit = 100, offset = 0 } = options;
    await this.getProject(projectName);

    const projectPath = this.getProjectPath(projectName);
    const findingsDir = path.join(projectPath, 'findings');
    const cacheKey = `${projectName}-findings`;

    try {
      // Check if we have cached data and if it's still valid
      const lastModified = await this.getDirectoryLastModified(findingsDir);
      const cached = await this.findingsCache.get(cacheKey);

      if (cached && cached.lastModified >= lastModified) {
        // Apply pagination to cached data
        return cached.data.slice(offset, offset + limit);
      }

      // Get file list and filter for markdown files
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const files = await fs.readdir(findingsDir, { withFileTypes: true });
      const mdFiles = files
        .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.md'))
        .map((dirent) => dirent.name);

      // For efficient pagination, we'll use a different strategy:
      // 1. Get file stats in smaller batches
      // 2. Sort incrementally
      // 3. Stop when we have enough for the requested page

      // Adaptive batch size based on dataset size and pagination parameters
      const isLargeOffset = offset > 500;
      const isLargeDataset = mdFiles.length > 1000;
      const batchSize = isLargeDataset
        ? Math.min(25, limit * 2)
        : Math.min(50, limit * 3);
      const targetCount = offset + limit;
      const filesByMtime: Array<{ file: string; mtime: Date }> = [];

      // For very large offsets, we need a different strategy to avoid loading too much into memory
      const memoryLimit = isLargeOffset
        ? Math.min(targetCount + 100, 2000)
        : targetCount + 50;

      // Process files in batches to avoid loading all file stats at once
      for (let i = 0; i < mdFiles.length; i += batchSize) {
        const batch = mdFiles.slice(i, i + batchSize);
        const batchStats = await Promise.allSettled(
          batch.map(async (file) => {
            const filePath = path.join(findingsDir, file);
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            const stat = await fs.stat(filePath);
            return { file, mtime: stat.mtime };
          })
        );

        // Add successful stats to our collection
        const successfulStats = batchStats
          .filter(
            (
              result
            ): result is PromiseFulfilledResult<{
              file: string;
              mtime: Date;
            }> => result.status === 'fulfilled'
          )
          .map((result) => result.value);

        filesByMtime.push(...successfulStats);

        // Sort and trim to keep memory usage reasonable
        filesByMtime.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

        // Enforce memory limit by trimming older entries
        if (filesByMtime.length > memoryLimit) {
          filesByMtime.splice(memoryLimit);
        }

        // If we have enough files for the current page, we can stop processing
        // (with some buffer for potential failed file reads)
        if (filesByMtime.length >= targetCount + Math.min(20, batchSize)) {
          break;
        }
      }

      // Final sort and pagination
      const sortedFiles = filesByMtime
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
        .slice(offset, offset + limit)
        .map(({ file }) => file);

      // Read only the files we need for the current page
      const findingResults = await Promise.allSettled(
        sortedFiles.map(async (file) => {
          const findingPath = path.join(findingsDir, file);

          // eslint-disable-next-line security/detect-non-literal-fs-filename
          const content = await fs.readFile(findingPath, 'utf-8');

          // Extract only frontmatter for listing performance
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (!frontmatterMatch) {
            throw new Error(`No frontmatter found in ${file}`);
          }

          const parsed = matter(content, SAFE_MATTER_OPTIONS);
          const data = parsed.data as Record<string, unknown>;

          // For listing, we only need metadata, not the full content parsing
          return {
            id: data.id as string,
            title: data.title as string,
            severity: data.severity as Finding['severity'],
            cwe: data.cwe as string | undefined,
            cvssString: data.cvssString as string | undefined,
            cvssScore: data.cvssScore as number | undefined,
            components: data.components as string[] | undefined,
            // For listing, we only include a truncated description from frontmatter
            description: '', // Will be populated from content when needed
            evidence: undefined,
            recommendations: undefined,
            created: new Date(data.created as string),
            updated: new Date(data.updated as string),
          } as Finding;
        })
      );

      // Process results and log errors for failed files
      const findings: Finding[] = [];
      findingResults.forEach((result, index) => {
        if (result && result.status === 'fulfilled') {
          findings.push(result.value);
        } else if (result && result.status === 'rejected') {
          const fileName = sortedFiles.at(index);
          if (fileName) {
            logger.warn('Failed to parse finding file', {
              fileName,
              reason:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            });
          }
        }
      });

      // Sort findings by their update time (secondary sort since primary sort was by file mtime)
      const sortedFindings = findings.sort(
        (a, b) => b.updated.getTime() - a.updated.getTime()
      );

      // Note: We no longer cache the full results since we're doing efficient pagination
      // The cache would need to be redesigned to support partial caching by page

      return sortedFindings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Cache empty result for missing directory
        await this.findingsCache.set(cacheKey, [], Date.now());
        return [];
      }
      throw new Error(
        `Failed to list findings: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async updateFinding(
    projectName: string,
    findingId: string,
    updates: Partial<FindingInput>
  ): Promise<Finding> {
    const lockKey = `finding-${projectName}-${findingId}`;
    return this.withLock(lockKey, async () => {
      const existing = await this.getFinding(projectName, findingId);

      // Prevent updating findings in completed projects
      await this.checkProjectNotCompleted(projectName, 'update finding');

      const updated: Finding = {
        ...existing,
        ...updates,
        updated: new Date(),
      };

      if (updates.cvssString !== undefined) {
        if (updates.cvssString) {
          try {
            const cvssResult = calculateCVSSScore(updates.cvssString);
            updated.cvssScore = cvssResult.score;
          } catch (error) {
            throw new Error(
              `Invalid CVSS string: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        } else {
          updated.cvssScore = undefined as number | undefined;
        }
      }

      const projectPath = this.getProjectPath(projectName);
      const findingPath = path.join(
        projectPath,
        'findings',
        `${findingId}.md`
      );
      const tempPath = `${findingPath}.tmp`;

      const frontmatter: Record<string, unknown> = {
        id: updated.id,
        title: updated.title,
        severity: updated.severity,
        created: updated.created.toISOString(),
        updated: updated.updated.toISOString(),
      };

      // Only add fields that are not undefined to avoid YAML serialization errors
      if (updated.cwe !== undefined) {
        frontmatter.cwe = updated.cwe;
      }
      if (updated.cvssString !== undefined) {
        frontmatter.cvssString = updated.cvssString;
      }
      if (updated.cvssScore !== undefined) {
        frontmatter.cvssScore = updated.cvssScore;
      }
      if (updated.components !== undefined) {
        frontmatter.components = updated.components;
      }

      const content = matter.stringify(
        `## Description\n\n${updated.description}\n\n${updated.evidence ? `## Evidence\n\n${updated.evidence}\n\n` : ''}${updated.recommendations ? `## Recommendations\n\n${updated.recommendations}` : ''}`,
        frontmatter
      );

      try {
        // Write to temporary file first for atomic operation
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.writeFile(tempPath, content);
        // Atomic rename
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.rename(tempPath, findingPath);
        await this.updateProject(projectName, {});

        // Invalidate findings cache
        await this.invalidateCache(projectName, 'findings');

        return updated;
      } catch (error) {
        // Clean up temporary file if it exists
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          await fs.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
        throw new Error(
          `Failed to update finding: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  async deleteFinding(projectName: string, findingId: string): Promise<void> {
    const lockKey = `finding-${projectName}-${findingId}`;
    return this.withLock(lockKey, async () => {
      await this.getFinding(projectName, findingId);

      // Prevent deleting findings in completed projects
      await this.checkProjectNotCompleted(projectName, 'delete finding');

      const projectPath = this.getProjectPath(projectName);
      const findingPath = path.join(
        projectPath,
        'findings',
        `${findingId}.md`
      );

      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.unlink(findingPath);
        await this.updateProject(projectName, {});

        // Invalidate findings cache
        await this.invalidateCache(projectName, 'findings');
      } catch (error) {
        throw new Error(
          `Failed to delete finding: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  async createAuditTrail(
    projectName: string,
    input: AuditTrailInput
  ): Promise<AuditTrailEntry> {
    await this.getProject(projectName);

    // Prevent creating audit trails in completed projects
    await this.checkProjectNotCompleted(projectName, 'create audit trail');

    const entry: AuditTrailEntry = {
      ...input,
      id: sanitizeAuditId(input.title),
      created: new Date(),
      tools: input.tools ?? undefined,
    };

    const lockKey = `audit-${projectName}-${entry.id}`;
    return this.withLock(lockKey, async () => {
      const projectPath = this.getProjectPath(projectName);
      const auditPath = path.join(
        projectPath,
        'audit-trails',
        `${entry.id}.md`
      );
      const tempPath = `${auditPath}.tmp`;

      // Check if audit trail already exists
      try {
        await fs.access(auditPath);
        throw new Error(`Audit trail with ID '${entry.id}' already exists`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // Build frontmatter, excluding undefined values to avoid YAML issues
      const frontmatter: Record<string, unknown> = {
        id: entry.id,
        title: entry.title,
        created: entry.created.toISOString(),
      };

      // Only add optional fields if they are defined
      if (entry.tools !== undefined) frontmatter.tools = entry.tools;
      if (entry.methodology !== undefined)
        frontmatter.methodology = entry.methodology;
      if (entry.results !== undefined) frontmatter.results = entry.results;
      if (entry.notes !== undefined) frontmatter.notes = entry.notes;

      const content = matter.stringify(entry.description, frontmatter);

      try {
        await this.ensureDirectoryExists(
          path.join(projectPath, 'audit-trails')
        );
        // Write to temporary file first for atomic operation
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.writeFile(tempPath, content);
        // Atomic rename
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.rename(tempPath, auditPath);
        await this.updateProject(projectName, {});

        // Invalidate audit trails cache
        await this.invalidateCache(projectName, 'audit-trails');

        return entry;
      } catch (error) {
        // Clean up temporary file if it exists
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          await fs.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
        throw new Error(
          `Failed to create audit trail: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  async getAuditTrail(
    projectName: string,
    auditId: string
  ): Promise<AuditTrailEntry> {
    await this.getProject(projectName);

    const projectPath = this.getProjectPath(projectName);
    const auditPath = path.join(projectPath, 'audit-trails', `${auditId}.md`);

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const content = await fs.readFile(auditPath, 'utf-8');
      const parsed = matter(content, SAFE_MATTER_OPTIONS);
      const data = parsed.data as Record<string, unknown>;

      return {
        id: data.id as string,
        title: data.title as string,
        description: parsed.content,
        tools: data.tools as string[] | undefined,
        created: new Date(data.created as string),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AuditTrailNotFoundError(auditId);
      }
      throw new Error(
        `Failed to read audit trail: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async listAuditTrails(
    projectName: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<AuditTrailEntry[]> {
    const { limit = 100, offset = 0 } = options;
    await this.getProject(projectName);

    const projectPath = this.getProjectPath(projectName);
    const auditDir = path.join(projectPath, 'audit-trails');
    const cacheKey = `${projectName}-audit-trails`;

    try {
      // Check if we have cached data and if it's still valid
      const lastModified = await this.getDirectoryLastModified(auditDir);
      const cached = await this.auditTrailsCache.get(cacheKey);

      if (cached && cached.lastModified >= lastModified) {
        // Apply pagination to cached data
        return cached.data.slice(offset, offset + limit);
      }

      // Get file list and filter for markdown files
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const files = await fs.readdir(auditDir, { withFileTypes: true });
      const mdFiles = files
        .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.md'))
        .map((dirent) => dirent.name);

      // Use efficient batch processing for large directories
      const batchSize = Math.min(50, limit * 3);
      const targetCount = offset + limit;
      const filesByMtime: Array<{ file: string; mtime: Date }> = [];

      // Process files in batches to avoid loading all file stats at once
      for (let i = 0; i < mdFiles.length; i += batchSize) {
        const batch = mdFiles.slice(i, i + batchSize);
        const batchStats = await Promise.allSettled(
          batch.map(async (file) => {
            const filePath = path.join(auditDir, file);
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            const stat = await fs.stat(filePath);
            return { file, mtime: stat.mtime };
          })
        );

        // Add successful stats to our collection
        const successfulStats = batchStats
          .filter(
            (
              result
            ): result is PromiseFulfilledResult<{
              file: string;
              mtime: Date;
            }> => result.status === 'fulfilled'
          )
          .map((result) => result.value);

        filesByMtime.push(...successfulStats);

        // Sort and trim to keep memory usage reasonable
        filesByMtime.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

        // Early termination if we have enough files
        if (filesByMtime.length >= targetCount + 10) {
          break;
        }
      }

      // Final sort and pagination
      const sortedFiles = filesByMtime
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
        .slice(offset, offset + limit)
        .map(({ file }) => file);

      // Only read the files we need for the current page
      const auditResults = await Promise.allSettled(
        sortedFiles.map(async (file) => {
          const auditPath = path.join(auditDir, file);

          // eslint-disable-next-line security/detect-non-literal-fs-filename
          const content = await fs.readFile(auditPath, 'utf-8');

          // Extract only frontmatter for listing performance
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (!frontmatterMatch) {
            throw new Error(`No frontmatter found in ${file}`);
          }

          const parsed = matter(content, SAFE_MATTER_OPTIONS);
          const data = parsed.data as Record<string, unknown>;

          // For listing, parse frontmatter only - description will be empty for performance
          return {
            id: data.id as string,
            title: data.title as string,
            description: '', // Only include description when specifically requested via getAuditTrail
            tools: data.tools as string[] | undefined,
            created: new Date(data.created as string),
          } as AuditTrailEntry;
        })
      );

      // Process results and log errors for failed files
      const entries: AuditTrailEntry[] = [];
      auditResults.forEach((result, index) => {
        if (result && result.status === 'fulfilled') {
          entries.push(result.value);
        } else if (result && result.status === 'rejected') {
          const fileName = sortedFiles.at(index);
          if (fileName) {
            logger.warn('Failed to parse audit trail file', {
              fileName,
              reason:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            });
          }
        }
      });

      // Sort entries by creation time (secondary sort since primary sort was by file mtime)
      const sortedEntries = entries.sort(
        (a, b) => b.created.getTime() - a.created.getTime()
      );

      // Note: We no longer cache the full results since we're doing efficient pagination
      // The cache would need to be redesigned to support partial caching by page

      return sortedEntries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Cache empty result for missing directory
        await this.auditTrailsCache.set(cacheKey, [], Date.now());
        return [];
      }
      throw new Error(
        `Failed to list audit trails: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
