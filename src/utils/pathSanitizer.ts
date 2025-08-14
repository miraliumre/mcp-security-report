import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { promisify } from 'node:util';
import sanitize from 'sanitize-filename';
import { ValidationError } from '../types/index.js';

const realpath = promisify(fs.realpath);

// Security check patterns (defined once, used everywhere)
const SECURITY_CHECKS = [
  {
    pattern: /\0/, // null bytes
    message: 'Path contains null bytes',
  },
  {
    pattern: /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i, // Windows reserved names (ReDoS safe)
    message: 'Path contains Windows reserved name',
  },
  {
    pattern: /\.\./, // Additional check for .. patterns anywhere
    message: 'Path contains traversal patterns (..)',
  },
  {
    pattern: /[<>:"|?*]/, // Windows invalid characters
    message: 'Path contains invalid characters',
  },
] as const;

/**
 * Core path sanitization logic shared between sync and async versions
 */
function validateInputAndResolve(
  inputPath: string | null | undefined,
  basePath: string
): { resolvedPath: string; normalizedPath: string } {
  // Validate input parameters
  if (inputPath === null || inputPath === undefined) {
    throw new ValidationError('Input path cannot be null or undefined');
  }

  if (typeof inputPath !== 'string') {
    throw new ValidationError('Input path must be a string');
  }

  // If no input path provided, use the base path
  if (!inputPath || inputPath.trim() === '') {
    const resolved = path.resolve(basePath);
    return { resolvedPath: resolved, normalizedPath: resolved };
  }

  // Resolve the path to get absolute path
  const resolvedPath = path.resolve(basePath, inputPath);

  // Normalize the path to remove any .. or . segments
  const normalizedPath = path.normalize(resolvedPath);

  return { resolvedPath, normalizedPath };
}

/**
 * Validate security checks on path segments
 */
function validatePathSecurity(realPath: string): void {
  const pathSegments = realPath.split(path.sep);
  for (const segment of pathSegments) {
    for (const check of SECURITY_CHECKS) {
      if (check.pattern.test(segment)) {
        throw new ValidationError(
          `Invalid path segment '${segment}': ${check.message}`
        );
      }
    }
  }
}

/**
 * Validate path traversal attempts
 */
function validatePathTraversal(
  inputPath: string,
  basePath: string,
  realPath: string
): void {
  // Ensure the resolved path is within the base path (prevent traversal)
  const normalizedBase = path.normalize(path.resolve(basePath));
  const normalizedReal = path.normalize(realPath);

  // Check if realPath is exactly the base or is a subdirectory of base
  // Use path separator to prevent partial directory name matches (e.g., /home/user vs /home/userdata)
  if (
    normalizedReal !== normalizedBase &&
    !normalizedReal.startsWith(normalizedBase + path.sep)
  ) {
    throw new ValidationError(
      `Invalid path: ${inputPath} attempts to access outside of ${basePath}`
    );
  }

  // Additional check: ensure the original input doesn't contain traversal attempts
  if (inputPath.includes('..')) {
    const resolvedInput = path.resolve(basePath, inputPath);
    const normalizedInput = path.normalize(resolvedInput);
    if (normalizedInput !== realPath) {
      throw new ValidationError(
        `Path traversal attempt detected in input: ${inputPath}`
      );
    }
  }
}

/**
 * Async version of sanitizeDirectoryPath for when you need async path checking
 * @param inputPath The input path to sanitize
 * @param basePath Optional base path to restrict access (defaults to cwd)
 * @returns Promise<string> The sanitized absolute path
 * @throws Error if the path is invalid or attempts traversal
 */
export async function sanitizeDirectoryPathAsync(
  inputPath: string | null | undefined,
  basePath: string = process.cwd()
): Promise<string> {
  const result = await corePathValidation(inputPath, basePath, {
    async: true,
    returnPath: true,
  });
  if (typeof result === 'string' && result.length > 0) {
    return result;
  }
  throw new ValidationError('Path validation failed');
}

/**
 * Synchronous version of sanitizeDirectoryPath for backward compatibility
 * @param inputPath The input path to sanitize
 * @param basePath Optional base path to restrict access (defaults to cwd)
 * @returns The sanitized absolute path
 * @throws Error if the path is invalid or attempts traversal
 */
export function sanitizeDirectoryPathSync(
  inputPath: string | null | undefined,
  basePath: string = process.cwd()
): string {
  const result = corePathValidation(inputPath, basePath, {
    async: false,
    returnPath: true,
  });
  if (typeof result === 'string' && result.length > 0) {
    return result;
  }
  throw new ValidationError('Path validation failed');
}

/**
 * Sanitizes and validates a directory path to prevent path traversal attacks
 * @param inputPath The input path to sanitize
 * @param basePath Optional base path to restrict access (defaults to cwd)
 * @returns The sanitized absolute path
 * @throws Error if the path is invalid or attempts traversal
 */
export function sanitizeDirectoryPath(
  inputPath: string | null | undefined,
  basePath: string = process.cwd()
): string {
  return sanitizeDirectoryPathSync(inputPath, basePath);
}

/**
 * Sanitizes a filename to prevent directory traversal and invalid characters
 * @param filename The filename to sanitize
 * @returns The sanitized filename
 */
export function sanitizeFilename(filename: string | null | undefined): string {
  // Validate input parameters
  if (filename === null || filename === undefined) {
    throw new ValidationError('Filename cannot be null or undefined');
  }

  if (typeof filename !== 'string') {
    throw new ValidationError('Filename must be a string');
  }

  // Use the sanitize-filename library to handle cross-platform issues
  const sanitized = sanitize(filename, {
    replacement: '_', // Replace invalid characters with underscore
  });

  // Additional check for empty or invalid result
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new ValidationError(`Invalid filename: ${filename}`);
  }

  return sanitized;
}

/**
 * Core path validation and sanitization function
 * Consolidates all path validation logic into a single, configurable function
 */
interface PathValidationOptions {
  /** Whether to perform async validation */
  async?: boolean;
  /** Whether to return the sanitized path instead of boolean */
  returnPath?: boolean;
  /** Whether to validate as project path (more restrictive) */
  projectPath?: boolean;
}

function corePathValidation(
  inputPath: string | null | undefined,
  baseDir: string,
  options: PathValidationOptions = {}
): boolean | string | Promise<boolean | string> {
  // Handle null/undefined input
  if (
    inputPath === null ||
    inputPath === undefined ||
    typeof inputPath !== 'string'
  ) {
    return options.returnPath ? '' : false;
  }

  const {
    async: isAsync = false,
    returnPath = false,
    projectPath = false,
  } = options;

  // Input validation
  try {
    const { normalizedPath } = validateInputAndResolve(inputPath, baseDir);

    if (isAsync) {
      return (async (): Promise<boolean | string> => {
        try {
          let realPath = normalizedPath;
          try {
            realPath = await realpath(normalizedPath);
          } catch {
            // Path doesn't exist yet, that's okay for new directories
            realPath = normalizedPath;
          }

          validatePathTraversal(inputPath, baseDir, realPath);
          validatePathSecurity(realPath);

          // Additional project path validation if requested
          if (projectPath) {
            const resolvedBase = path.resolve(baseDir);
            if (
              realPath !== resolvedBase &&
              !realPath.startsWith(resolvedBase + path.sep)
            ) {
              throw new ValidationError('Path outside base directory');
            }
          }

          if (returnPath) {
            return realPath;
          } else {
            return true;
          }
        } catch {
          if (returnPath) {
            return '';
          } else {
            return false;
          }
        }
      })();
    } else {
      try {
        let realPath = normalizedPath;
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          realPath = fs.realpathSync(normalizedPath);
        } catch {
          // Path doesn't exist yet, that's okay for new directories
          realPath = normalizedPath;
        }

        validatePathTraversal(inputPath, baseDir, realPath);
        validatePathSecurity(realPath);

        // Additional project path validation if requested
        if (projectPath) {
          const resolvedBase = path.resolve(baseDir);
          if (
            realPath !== resolvedBase &&
            !realPath.startsWith(resolvedBase + path.sep)
          ) {
            throw new ValidationError('Path outside base directory');
          }
        }

        if (returnPath) {
          return realPath;
        } else {
          return true;
        }
      } catch {
        if (returnPath) {
          return '';
        } else {
          return false;
        }
      }
    }
  } catch {
    if (returnPath) {
      return '';
    } else {
      return false;
    }
  }
}

/**
 * Validates a project working directory for CLI/server usage
 * @param projectPath The project path to validate
 * @param baseDir The base working directory (for relative path resolution)
 * @returns Object with validation result and details
 */
export function validateWorkingDirectory(
  projectPath: string | null | undefined,
  baseDir: string = process.cwd()
): { valid: boolean; resolvedPath?: string; error?: string } {
  // Handle null/undefined input
  if (
    projectPath === null ||
    projectPath === undefined ||
    typeof projectPath !== 'string'
  ) {
    return { valid: false, error: 'Project path must be a string' };
  }

  try {
    // Resolve the path (handles both relative and absolute paths)
    const resolvedPath = path.resolve(baseDir, projectPath);

    // Basic security check - prevent null bytes and other dangerous characters
    if (resolvedPath.includes('\0')) {
      return { valid: false, error: 'Path contains null bytes' };
    }

    return { valid: true, resolvedPath };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to resolve path: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Checks the state of a directory for MCP usage
 * @param dirPath The directory path to check
 * @returns Object with directory state information
 */
export async function checkDirectoryState(dirPath: string): Promise<{
  exists: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  hasMcpProjects: boolean;
  error?: string;
}> {
  try {
    // Check if path exists
    let stats;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      stats = await fsPromises.stat(dirPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          exists: false,
          isDirectory: false,
          isEmpty: true,
          hasMcpProjects: false,
        };
      }
      throw error;
    }

    // Check if it's a directory
    if (!stats.isDirectory()) {
      return {
        exists: true,
        isDirectory: false,
        isEmpty: false,
        hasMcpProjects: false,
        error: 'Path exists but is not a directory',
      };
    }

    // Check directory contents
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const files = await fsPromises.readdir(dirPath);
    const isEmpty = files.length === 0;
    const hasMcpProjects = files.includes('.mcp-projects.json');

    return {
      exists: true,
      isDirectory: true,
      isEmpty,
      hasMcpProjects,
    };
  } catch (error) {
    return {
      exists: false,
      isDirectory: false,
      isEmpty: false,
      hasMcpProjects: false,
      error: `Failed to check directory: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Synchronous version of checkDirectoryState
 */
export function checkDirectoryStateSync(dirPath: string): {
  exists: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  hasMcpProjects: boolean;
  error?: string;
} {
  try {
    // Check if path exists
    let stats;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      stats = fs.statSync(dirPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          exists: false,
          isDirectory: false,
          isEmpty: true,
          hasMcpProjects: false,
        };
      }
      throw error;
    }

    // Check if it's a directory
    if (!stats.isDirectory()) {
      return {
        exists: true,
        isDirectory: false,
        isEmpty: false,
        hasMcpProjects: false,
        error: 'Path exists but is not a directory',
      };
    }

    // Check directory contents
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const files = fs.readdirSync(dirPath);
    const isEmpty = files.length === 0;
    const hasMcpProjects = files.includes('.mcp-projects.json');

    return {
      exists: true,
      isDirectory: true,
      isEmpty,
      hasMcpProjects,
    };
  } catch (error) {
    return {
      exists: false,
      isDirectory: false,
      isEmpty: false,
      hasMcpProjects: false,
      error: `Failed to check directory: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Async version of validateWorkingDirectory
 * @param projectPath The project path to validate (relative or absolute within baseDir)
 * @param baseDir The base working directory
 * @returns Promise with validation result and details
 */
export async function validateWorkingDirectoryAsync(
  projectPath: string | null | undefined,
  baseDir: string = process.cwd()
): Promise<{ valid: boolean; resolvedPath?: string; error?: string }> {
  const validation = validateWorkingDirectory(projectPath, baseDir);
  if (!validation.valid || !validation.resolvedPath) {
    return validation;
  }

  // Additional async checks can be added here if needed
  const dirState = await checkDirectoryState(validation.resolvedPath);
  if (dirState.error) {
    return { valid: false, error: dirState.error };
  }

  return validation;
}

/**
 * Validates that a path is safe to use for file operations
 * @param filePath The file path to validate
 * @param allowedBase The allowed base directory
 * @returns boolean true if the path is safe
 */
export function isPathSafe(
  filePath: string | null | undefined,
  allowedBase: string = process.cwd()
): boolean {
  const result = corePathValidation(filePath, allowedBase, { async: false });
  return typeof result === 'boolean' ? result : false;
}

/**
 * Async version of isPathSafe
 * @param filePath The file path to validate
 * @param allowedBase The allowed base directory
 * @returns Promise<boolean> true if the path is safe
 */
export async function isPathSafeAsync(
  filePath: string | null | undefined,
  allowedBase: string = process.cwd()
): Promise<boolean> {
  const result = await corePathValidation(filePath, allowedBase, {
    async: true,
  });
  return typeof result === 'boolean' ? result : false;
}
