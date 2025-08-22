#!/usr/bin/env node

// Parse verbose flag early, before any module imports that create loggers
if (process.argv.includes('--verbose') || process.argv.includes('-v')) {
  process.env.MCP_SECURITY_REPORT_LOG_LEVEL = 'debug';
}

import { Command } from '@commander-js/extra-typings';
import { SecurityReportServer } from './server/index.js';
import { CliHandlers } from './cli/handlers.js';
import { createChildLogger } from './utils/logger.js';
import {
  validateWorkingDirectory,
  checkDirectoryStateSync,
} from './utils/pathSanitizer.js';
import { emergencyWarn } from './utils/emergencyLog.js';
import { getServerConfig } from './utils/env.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get package.json version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
) as { version: string };
const version: string = packageJson.version;

// Custom error classes for better error handling
class CliError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'CLI_ERROR') {
    super(message);
    this.name = 'CliError';
    this.code = code;
  }
}

class CommandExecutionError extends CliError {
  public readonly commandName: string;
  public readonly originalError: Error;

  constructor(commandName: string, originalError: Error) {
    super(
      `Failed to ${commandName}: ${originalError.message}`,
      'COMMAND_EXECUTION_ERROR'
    );
    this.name = 'CommandExecutionError';
    this.commandName = commandName;
    this.originalError = originalError;
  }
}

/**
 * Initialize logger early - before Commander.js processes arguments
 * This ensures logger is always available for error handling
 */
function initializeLogger(): ReturnType<typeof createChildLogger> {
  const logger = createChildLogger('cli');

  // Confirm verbose mode is active if MCP_SECURITY_REPORT_LOG_LEVEL is debug
  if (process.env.MCP_SECURITY_REPORT_LOG_LEVEL === 'debug') {
    logger.debug('Verbose logging enabled');
  }

  return logger;
}

// Initialize logger immediately so it's available for all operations
const logger = initializeLogger();

const program = new Command();

// Registry for CLI handlers with LRU cache behavior and cleanup
class CliHandlerRegistry {
  private readonly handlers = new Map<string, CliHandlers>();
  private readonly maxSize: number;
  private readonly lastAccess = new Map<string, number>();

  constructor(maxSize = 10) {
    this.maxSize = maxSize;
  }

  async get(projectDir: string): Promise<CliHandlers> {
    // Validate the working directory
    const validation = validateWorkingDirectory(projectDir);
    if (!validation.valid || !validation.resolvedPath) {
      throw new Error(
        `Invalid project directory: ${validation.error ?? 'Unknown validation error'}`
      );
    }

    const resolvedDir = validation.resolvedPath;

    // Check directory state
    const dirState = checkDirectoryStateSync(resolvedDir);
    if (dirState.error) {
      throw new Error(`Directory validation failed: ${dirState.error}`);
    }

    // If directory exists but is not empty and doesn't have .mcp-projects.json, warn and fail
    // unless the unsafe bypass is enabled
    const serverConfig = getServerConfig();
    const bypassUnsafeCheck = serverConfig.unsafeNonemptyDir;

    if (
      dirState.exists &&
      dirState.isDirectory &&
      !dirState.isEmpty &&
      !dirState.hasMcpProjects &&
      !bypassUnsafeCheck
    ) {
      throw new Error(
        `Directory ${resolvedDir} is not empty and does not appear to be an MCP Security Report directory.\n` +
          'This could lead to data conflicts. Please use an empty directory or an existing MCP directory.\n' +
          'If this is an existing MCP directory, ensure the .mcp-projects.json file exists.\n' +
          'To bypass this check (UNSAFE), set MCP_SECURITY_REPORT_UNSAFE_NONEMPTY_DIR=true'
      );
    }

    // Log warning if unsafe bypass is used
    if (
      bypassUnsafeCheck &&
      dirState.exists &&
      dirState.isDirectory &&
      !dirState.isEmpty &&
      !dirState.hasMcpProjects
    ) {
      logger.warn(
        'UNSAFE: Using non-empty directory without MCP project files. This may cause data conflicts.'
      );
    }

    // Update access time
    this.lastAccess.set(resolvedDir, Date.now());

    if (!this.handlers.has(resolvedDir)) {
      const handler = new CliHandlers(resolvedDir);
      this.handlers.set(resolvedDir, handler);
      this.evictOldestIfNeeded();

      // Acquire instance lock for new handlers
      try {
        await handler.acquireInstanceLock();
      } catch (error) {
        // Remove handler if lock acquisition fails
        this.handlers.delete(resolvedDir);
        this.lastAccess.delete(resolvedDir);
        throw error;
      }
    }

    const handler = this.handlers.get(resolvedDir);
    if (!handler) {
      throw new Error(
        `Failed to get CLI handler for directory: ${resolvedDir}`
      );
    }
    return handler;
  }

  private evictOldestIfNeeded(): void {
    if (this.handlers.size <= this.maxSize) {
      return;
    }

    // Find the least recently accessed handler
    let oldestDir: string | null = null;
    let oldestTime = Date.now();

    for (const [dir, time] of this.lastAccess) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestDir = dir;
      }
    }

    if (oldestDir) {
      // Clean up the handler before removing it
      const handler = this.handlers.get(oldestDir);
      if (handler) {
        handler.cleanup().catch((error) => {
          emergencyWarn(`Failed to cleanup handler for ${oldestDir}`, error);
        });
      }
      this.handlers.delete(oldestDir);
      this.lastAccess.delete(oldestDir);
    }
  }

  clear(): void {
    // Clean up all handlers before clearing
    for (const handler of this.handlers.values()) {
      handler.cleanup().catch((error) => {
        emergencyWarn('Failed to cleanup handler during clear', error);
      });
    }
    this.handlers.clear();
    this.lastAccess.clear();
  }
}

const cliHandlerRegistry = new CliHandlerRegistry();

/**
 * Get or create a CLI handler for a specific project directory
 */
async function getCliHandler(projectDir: string): Promise<CliHandlers> {
  return await cliHandlerRegistry.get(projectDir);
}

// Cleanup registry on process exit
const cleanupRegistry = (): void => {
  cliHandlerRegistry.clear();
};

process.on('exit', cleanupRegistry);
process.on('SIGTERM', cleanupRegistry);
process.on('SIGINT', cleanupRegistry);

/**
 * Helper function to build update options object from command-line options
 * Filters out undefined values for cleaner object construction
 * Uses explicit allowed keys for maximum security
 */
function buildProjectUpdateOptions(
  projectName: string,
  options: {
    client?: string;
    scope?: string[];
    description?: string;
    status?: 'in-progress' | 'completed';
  }
): Record<string, unknown> {
  const result: Record<string, unknown> = { projectName };

  // Explicitly handle each allowed property to avoid security issues
  if (options.client !== undefined) {
    result.client = options.client;
  }
  if (options.scope !== undefined) {
    result.scope = options.scope;
  }
  if (options.description !== undefined) {
    result.description = options.description;
  }
  if (options.status !== undefined) {
    result.status = options.status;
  }

  return result;
}

/**
 * Wrapper function for CLI commands that should exit after completion
 * with improved type safety and error context
 */
async function executeCommand<T extends unknown[]>(
  commandName: string,
  handler: (...args: T) => Promise<void> | void,
  ...args: T
): Promise<void> {
  try {
    await handler(...args);

    // Force cleanup after successful command execution
    cleanupRegistry();

    // Ensure the process exits cleanly for CLI commands
    // Use setTimeout to allow any pending async operations to complete
    setTimeout(() => {
      process.exit(0);
    }, 0);
  } catch (error) {
    // Convert unknown errors to our custom error types for better handling
    let cliError: CommandExecutionError;

    if (error instanceof Error) {
      cliError = new CommandExecutionError(commandName, error);
    } else {
      // Handle non-Error objects (strings, objects, etc.)
      const genericError = new Error(String(error));
      cliError = new CommandExecutionError(commandName, genericError);
    }

    logger.error(cliError.message);
    if (cliError.originalError.stack) {
      logger.debug('Stack trace:', { stack: cliError.originalError.stack });
    }

    // Force cleanup before exit on error
    cleanupRegistry();

    process.exit(1);
  }
}

/**
 * Wrapper function for server commands that should run continuously
 * with improved type safety and error context
 */
async function executeServerCommand<T extends unknown[]>(
  commandName: string,
  handler: (...args: T) => Promise<void> | void,
  ...args: T
): Promise<void> {
  try {
    await handler(...args);
  } catch (error) {
    // Convert unknown errors to our custom error types for better handling
    let cliError: CommandExecutionError;

    if (error instanceof Error) {
      cliError = new CommandExecutionError(commandName, error);
    } else {
      // Handle non-Error objects (strings, objects, etc.)
      const genericError = new Error(String(error));
      cliError = new CommandExecutionError(commandName, genericError);
    }

    logger.error(cliError.message);
    if (cliError.originalError.stack) {
      logger.debug('Stack trace:', { stack: cliError.originalError.stack });
    }

    process.exit(1);
  }
}

program
  .name('mcp-security-report')
  .description(
    'MCP server for managing application security audit findings and reports'
  )
  .version(version)
  .addHelpText(
    'after',
    `
Quick Start:
  1. Create project:        mcp-security-report project create my-audit
  2. Add finding:           mcp-security-report finding create my-audit
  3. Start MCP server:      mcp-security-report serve

Environment Variables:
  MCP_SECURITY_REPORT_DIR              - Default project directory
  MCP_SECURITY_REPORT_HOST             - Default server host (default: localhost)
  MCP_SECURITY_REPORT_PORT             - Default server port (default: 3000)
  MCP_SECURITY_REPORT_TRANSPORT        - Transport mode: stdio, sse (default: sse)
  MCP_SECURITY_REPORT_CORS_ORIGIN      - Comma-separated CORS origins (enables CORS)
  MCP_SECURITY_REPORT_MAX_YAML_SIZE    - Max YAML frontmatter size in bytes (default: 10240)
  MCP_SECURITY_REPORT_MAX_REQUEST_SIZE - Max HTTP request size (default: 1mb)
  MCP_SECURITY_REPORT_CACHE_SIZE       - LRU cache size for findings/audit trails (default: 50)
  
Logging Variables:
  MCP_SECURITY_REPORT_LOG_LEVEL        - Log level: error, warn, info, debug (default: info)
  MCP_SECURITY_REPORT_LOG_TARGET       - Log target: console, file, both (auto-detected)
  MCP_SECURITY_REPORT_LOG_DIR          - Custom log directory (default: <project-dir>/.logs)`
  );

// Server command
program
  .command('serve')
  .description('Start the MCP server')
  .option(
    '-d, --project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .option(
    '-p, --port <port>',
    'HTTP/SSE port (default: from MCP_SECURITY_REPORT_PORT or 3000)',
    (value: string) => {
      const parsed = parseInt(value, 10);
      if (isNaN(parsed) || parsed < 0 || parsed > 65535) {
        throw new Error(
          `Invalid port number: ${value}. Port must be between 0 and 65535.`
        );
      }
      return parsed;
    },
    ((): number => {
      const envPort = process.env.MCP_SECURITY_REPORT_PORT;
      return envPort ? parseInt(envPort, 10) : 3000;
    })()
  )
  .option(
    '-H, --host <host>',
    'HTTP/SSE host (default: from MCP_SECURITY_REPORT_HOST or localhost)',
    process.env.MCP_SECURITY_REPORT_HOST ?? 'localhost'
  )
  .option(
    '--stdio',
    'Use stdio transport instead of HTTP (can also be set via MCP_SECURITY_REPORT_TRANSPORT=stdio)'
  )
  .option(
    '--unsafe-nonempty-dir',
    'UNSAFE: Allow server to start in non-empty directories without MCP project files (can also be set via MCP_SECURITY_REPORT_UNSAFE_NONEMPTY_DIR=true)'
  )
  .option(
    '--enable-cors [origins]',
    'Enable CORS with optional comma-separated origins (e.g., --enable-cors "http://localhost:3000,https://example.com")'
  )
  .option(
    '--cors-credentials',
    'Allow CORS credentials (cookies, auth headers) - only works with specific origins for security'
  )
  .option('-v, --verbose', 'Enable verbose (debug) logging')
  .action(async (options): Promise<void> => {
    await executeServerCommand('start server', async () => {
      // Validate the working directory
      const validation = validateWorkingDirectory(options.projectDir);
      if (!validation.valid || !validation.resolvedPath) {
        throw new CliError(
          `Invalid project directory: ${validation.error ?? 'Unknown validation error'}`,
          'VALIDATION_ERROR'
        );
      }

      const workingDir = validation.resolvedPath;

      // Check directory state
      const dirState = checkDirectoryStateSync(workingDir);
      if (dirState.error) {
        throw new CliError(
          'validation',
          `Directory validation failed: ${dirState.error}`
        );
      }

      // If directory exists but is not empty and doesn't have .mcp-projects.json, warn and fail
      // unless the unsafe bypass is enabled
      const serverConfig = getServerConfig();
      const bypassUnsafeCheck =
        options.unsafeNonemptyDir ?? serverConfig.unsafeNonemptyDir;

      if (
        dirState.exists &&
        dirState.isDirectory &&
        !dirState.isEmpty &&
        !dirState.hasMcpProjects &&
        !bypassUnsafeCheck
      ) {
        throw new CliError(
          `Directory ${workingDir} is not empty and does not appear to be an MCP Security Report directory.\n` +
            'This could lead to data conflicts. Please use an empty directory or an existing MCP directory.\n' +
            'If this is an existing MCP directory, ensure the .mcp-projects.json file exists.\n' +
            'To bypass this check (UNSAFE), use --unsafe-nonempty-dir or set MCP_SECURITY_REPORT_UNSAFE_NONEMPTY_DIR=true',
          'VALIDATION_ERROR'
        );
      }

      // Log warning if unsafe bypass is used
      if (
        bypassUnsafeCheck &&
        dirState.exists &&
        dirState.isDirectory &&
        !dirState.isEmpty &&
        !dirState.hasMcpProjects
      ) {
        logger.warn(
          'UNSAFE: Starting server in non-empty directory without MCP project files. This may cause data conflicts.'
        );
      }

      // Handle CORS configuration
      let corsEnabled = false;
      let corsOrigin: string | undefined;

      if (options.enableCors !== undefined) {
        corsEnabled = true;
        corsOrigin =
          typeof options.enableCors === 'string'
            ? options.enableCors
            : process.env.MCP_SECURITY_REPORT_CORS_ORIGIN;
      } else {
        // Default: check environment variable
        corsOrigin = process.env.MCP_SECURITY_REPORT_CORS_ORIGIN;
        corsEnabled = corsOrigin !== undefined;
      }

      const serverOptions = {
        workingDir: workingDir,
        port: options.port,
        host: options.host,
        cors: corsEnabled,
        corsOrigin: corsOrigin ?? undefined,
        corsCredentials: options.corsCredentials === true,
      };

      const server = new SecurityReportServer(serverOptions);

      // Check both CLI option and environment variable for stdio mode
      const useStdio =
        (options.stdio ?? false) ||
        process.env.MCP_SECURITY_REPORT_TRANSPORT === 'stdio';

      if (useStdio) {
        logger.info('Starting MCP Security Report stdio server...');
        logger.info(`Working directory: ${workingDir}`);
        await server.startStdio();
      } else {
        logger.info('Starting MCP Security Report HTTP/SSE server...');
        logger.info(`Working directory: ${workingDir}`);
        if (corsEnabled && corsOrigin) {
          logger.info(`CORS enabled for origins: ${corsOrigin}`);
          if (options.corsCredentials) {
            logger.info('CORS credentials enabled for specified origins');
          }
        } else if (corsEnabled) {
          logger.warn(
            'CORS enabled but no origins specified; this allows all origins'
          );
          if (options.corsCredentials) {
            logger.warn(
              'CORS credentials disabled for security (wildcard origin not allowed with credentials)'
            );
          }
        } else {
          logger.info('CORS is disabled');
        }
        await server.startHttp();
      }
    });
  });

// Project management commands
const projectCmd = program
  .command('project')
  .description('Project management operations');

projectCmd
  .command('create')
  .description('Create a new project')
  .argument('<name>', 'Project name')
  .option('-c, --client <client>', 'Client name')
  .option('-s, --scope <urls...>', 'URLs, domains, or systems in scope')
  .option(
    '-d, --project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .option('--description <desc>', 'Project description')
  .option('-v, --verbose', 'Enable verbose (debug) logging')
  .action(async (name: string, options): Promise<void> => {
    await executeCommand('create project', async () => {
      const handler = await getCliHandler(options.projectDir);
      await handler.createProject({
        ...options,
        projectName: name,
        projectDir: options.projectDir,
      });
    });
  });

projectCmd
  .command('list')
  .description('List all projects')
  .option(
    '-d, --project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .option('-v, --verbose', 'Enable verbose (debug) logging')
  .action(async (options): Promise<void> => {
    await executeCommand('list projects', async () => {
      const handler = await getCliHandler(options.projectDir);
      await handler.listProjects();
    });
  });

projectCmd
  .command('update')
  .description('Update project metadata')
  .argument('<project>', 'Project name')
  .option('-c, --client <client>', 'Client name')
  .option('-s, --scope <urls...>', 'URLs, domains, or systems in scope')
  .option('--description <desc>', 'Project description')
  .option('--status <status>', 'Project status (in-progress|completed)')
  .option(
    '-d, --project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (projectName: string, options): Promise<void> => {
    await executeCommand('update project', async () => {
      const handler = await getCliHandler(options.projectDir);

      // Build update options with improved type safety and cleaner construction
      const updateData: {
        client?: string;
        scope?: string[];
        description?: string;
        status?: 'in-progress' | 'completed';
      } = {};

      if (options.client) updateData.client = options.client;
      if (options.scope) updateData.scope = options.scope;
      if (options.description) updateData.description = options.description;
      if (options.status)
        updateData.status = options.status as 'in-progress' | 'completed';

      const updateOptions = buildProjectUpdateOptions(
        projectName,
        updateData
      ) as Parameters<typeof handler.updateProject>[0];

      await handler.updateProject(updateOptions);
    });
  });

// Finding management commands
const findingCmd = program
  .command('finding')
  .description('Security finding operations');

findingCmd
  .command('create')
  .description('Create a new security finding')
  .argument('<project>', 'Project name')
  .requiredOption('-t, --title <title>', 'Finding title')
  .requiredOption(
    '-s, --severity <severity>',
    'Severity (critical|high|medium|low|informative)'
  )
  .requiredOption('-d, --description <desc>', 'Detailed description')
  .option('--cwe <cwe>', 'CWE identifier (e.g., CWE-79)')
  .option('--cvss <vector>', 'CVSS vector string')
  .option('-c, --components <components...>', 'Affected components')
  .option('-e, --evidence <evidence>', 'Evidence or proof of concept')
  .option(
    '-r, --recommendations <recommendations>',
    'Remediation recommendations'
  )
  .option(
    '--project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (projectName: string, options): Promise<void> => {
    await executeCommand('create finding', async () => {
      const handler = await getCliHandler(options.projectDir);
      await handler.createFinding({ projectName, ...options });
    });
  });

findingCmd
  .command('list')
  .description('List findings for a project')
  .argument('<project>', 'Project name')
  .option(
    '--limit <limit>',
    'Maximum number of findings to return (default: 100)',
    parseInt
  )
  .option(
    '--offset <offset>',
    'Number of findings to skip (default: 0)',
    parseInt
  )
  .option(
    '--project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (projectName: string, options): Promise<void> => {
    await executeCommand('list findings', async () => {
      const handler = await getCliHandler(options.projectDir);
      const paginationOptions: { limit?: number; offset?: number } = {};
      if (options.limit !== undefined) paginationOptions.limit = options.limit;
      if (options.offset !== undefined)
        paginationOptions.offset = options.offset;
      await handler.listFindings(projectName, paginationOptions);
    });
  });

findingCmd
  .command('get')
  .description('Get a specific finding')
  .argument('<project>', 'Project name')
  .argument('<id>', 'Finding ID')
  .option(
    '--project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (projectName: string, id: string, options): Promise<void> => {
    await executeCommand('get finding', async () => {
      const handler = await getCliHandler(options.projectDir);
      await handler.getFinding(projectName, id);
    });
  });

findingCmd
  .command('update')
  .description('Update a finding')
  .argument('<project>', 'Project name')
  .argument('<id>', 'Finding ID')
  .option('-t, --title <title>', 'Finding title')
  .option(
    '-s, --severity <severity>',
    'Severity (critical|high|medium|low|informative)'
  )
  .option('-d, --description <desc>', 'Detailed description')
  .option('--cwe <cwe>', 'CWE identifier (e.g., CWE-79)')
  .option('--cvss <vector>', 'CVSS vector string')
  .option('-c, --components <components...>', 'Affected components')
  .option('-e, --evidence <evidence>', 'Evidence or proof of concept')
  .option(
    '-r, --recommendations <recommendations>',
    'Remediation recommendations'
  )
  .option(
    '--project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (projectName: string, id: string, options): Promise<void> => {
    await executeCommand('update finding', async () => {
      const handler = await getCliHandler(options.projectDir);
      await handler.updateFinding({ projectName, id, ...options });
    });
  });

findingCmd
  .command('delete')
  .description('Delete a finding')
  .argument('<project>', 'Project name')
  .argument('<id>', 'Finding ID')
  .option(
    '--project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (projectName: string, id: string, options): Promise<void> => {
    await executeCommand('delete finding', async () => {
      const handler = await getCliHandler(options.projectDir);
      await handler.deleteFinding(projectName, id);
    });
  });

// Audit trail commands
const auditCmd = program
  .command('audit')
  .description('Audit trail operations');

auditCmd
  .command('create')
  .description('Create a new audit trail entry')
  .argument('<project>', 'Project name')
  .requiredOption('-t, --title <title>', 'Audit trail title')
  .requiredOption('-d, --description <desc>', 'Detailed description')
  .option('-m, --methodology <methodology>', 'Testing methodology')
  .option('--tools <tools...>', 'Tools used')
  .option('-r, --results <results>', 'Test results')
  .option('-n, --notes <notes>', 'Additional notes')
  .option(
    '--project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (projectName: string, options): Promise<void> => {
    await executeCommand('create audit trail', async () => {
      const handler = await getCliHandler(options.projectDir);
      await handler.createAuditTrail({ projectName, ...options });
    });
  });

auditCmd
  .command('list')
  .description('List audit trails for a project')
  .argument('<project>', 'Project name')
  .option(
    '--limit <limit>',
    'Maximum number of audit trails to return (default: 100)',
    parseInt
  )
  .option(
    '--offset <offset>',
    'Number of audit trails to skip (default: 0)',
    parseInt
  )
  .option(
    '--project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (projectName: string, options): Promise<void> => {
    await executeCommand('list audit trails', async () => {
      const handler = await getCliHandler(options.projectDir);
      const paginationOptions: { limit?: number; offset?: number } = {};
      if (options.limit !== undefined) paginationOptions.limit = options.limit;
      if (options.offset !== undefined)
        paginationOptions.offset = options.offset;
      await handler.listAuditTrails(projectName, paginationOptions);
    });
  });

auditCmd
  .command('get')
  .description('Get a specific audit trail')
  .argument('<project>', 'Project name')
  .argument('<id>', 'Audit trail ID')
  .option(
    '--project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (projectName: string, id: string, options): Promise<void> => {
    await executeCommand('get audit trail', async () => {
      const handler = await getCliHandler(options.projectDir);
      await handler.getAuditTrail(projectName, id);
    });
  });

// Executive summary commands
const execCmd = program
  .command('executive')
  .description('Executive summary operations');

execCmd
  .command('set')
  .description('Set executive summary for a project')
  .argument('<project>', 'Project name')
  .option('-o, --overview <overview>', 'Executive overview')
  .option('-k, --key-findings <findings>', 'Key findings summary')
  .option(
    '-r, --recommendations <recommendations>',
    'High-level recommendations'
  )
  .option('--risk-assessment <assessment>', 'Risk assessment summary')
  .option(
    '--project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (projectName: string, options): Promise<void> => {
    await executeCommand('set executive summary', async () => {
      const handler = await getCliHandler(options.projectDir);
      const summaryOptions: Parameters<typeof handler.setExecutiveSummary>[0] =
        { projectName };
      if (options.overview) summaryOptions.overview = options.overview;
      if (options.keyFindings)
        summaryOptions.keyFindings = options.keyFindings;
      if (options.recommendations)
        summaryOptions.recommendations = options.recommendations;
      if (options.riskAssessment)
        summaryOptions.riskAssessment = options.riskAssessment;
      await handler.setExecutiveSummary(summaryOptions);
    });
  });

execCmd
  .command('get')
  .description('Get executive summary for a project')
  .argument('<project>', 'Project name')
  .option(
    '--project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (projectName: string, options): Promise<void> => {
    await executeCommand('get executive summary', async () => {
      const handler = await getCliHandler(options.projectDir);
      await handler.getExecutiveSummary(projectName);
    });
  });

// CWE commands
const cweCmd = program
  .command('cwe')
  .description('CWE (Common Weakness Enumeration) operations');

cweCmd
  .command('get')
  .description('Get detailed CWE weakness information by ID')
  .argument('<id>', 'CWE ID (e.g., 79 or CWE-79)')
  .option(
    '--project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (id: string, options): Promise<void> => {
    await executeCommand('get CWE weakness', async () => {
      const handler = await getCliHandler(options.projectDir);
      await handler.getCweWeakness(id);
    });
  });

cweCmd
  .command('related')
  .description('Get related CWEs')
  .argument('<ids>', 'Comma-separated CWE IDs')
  .option('-r, --relationships <view>', 'View ID to filter relationships')
  .option(
    '--project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (ids: string, options): Promise<void> => {
    await executeCommand('get related CWEs', async () => {
      const handler = await getCliHandler(options.projectDir);
      await handler.getRelatedCwes(ids, options.relationships);
    });
  });

// CVSS commands
const cvssCmd = program.command('cvss').description('CVSS scoring operations');

cvssCmd
  .command('validate')
  .description('Validate a CVSS vector string')
  .argument('<vector>', 'CVSS vector string')
  .option(
    '--project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (vector: string, options): Promise<void> => {
    await executeCommand('validate CVSS', async () => {
      const handler = await getCliHandler(options.projectDir);
      handler.validateCvss(vector);
    });
  });

cvssCmd
  .command('calculate')
  .description('Calculate CVSS score from vector string')
  .argument('<vector>', 'CVSS vector string')
  .option(
    '--project-dir <dir>',
    'Working directory for projects',
    process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd()
  )
  .action(async (vector: string, options): Promise<void> => {
    await executeCommand('calculate CVSS', async () => {
      const handler = await getCliHandler(options.projectDir);
      handler.calculateCvss(vector);
    });
  });

// Error handling with proper help support

program.exitOverride((err) => {
  if (err.exitCode === 0) {
    // For successful exits (help, version, etc.), exit silently
    process.exit(0);
  } else {
    // Only log actual errors, not help requests
    if (err.message !== '(outputHelp)') {
      logger.error(err.message);
    }
    process.exit(err.exitCode);
  }
});

program.parse();
