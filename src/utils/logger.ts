import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { emergencyWarn } from './emergencyLog.js';

/**
 * Clean Winston metadata by removing internal symbols and keeping only string keys
 */
function cleanWinstonMeta(
  info: Record<string | symbol, unknown>
): Record<string, unknown> {
  const meta = { ...info };

  // Remove standard properties
  delete meta.level;
  delete meta.message;
  delete meta.timestamp;
  delete meta.context;
  delete meta.stack;

  // Remove Winston internal symbols - these are safe to delete by symbol reference
  const winstonSymbols = [
    Symbol.for('level'),
    Symbol.for('message'),
    Symbol.for('splat'),
  ];

  winstonSymbols.forEach((symbol) => {
    if (symbol in meta) {
      // eslint-disable-next-line security/detect-object-injection
      delete (meta as Record<symbol, unknown>)[symbol];
    }
  });

  // Only include string keys for JSON serialization
  const cleanMeta: Record<string, unknown> = {};
  Object.keys(meta).forEach((key) => {
    // eslint-disable-next-line security/detect-object-injection
    cleanMeta[key] = meta[key as keyof typeof meta];
  });

  return cleanMeta;
}

/**
 * Remove ANSI escape codes from a string
 */
function stripAnsiColors(str: string): string {
  // Use unicode escape sequences to avoid control character regex issues
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Format metadata string for debug/verbose logs
 */
function formatMetaString(
  info: Record<string | symbol, unknown>,
  levelStr: string
): string {
  if (levelStr !== 'debug' && levelStr !== 'verbose') {
    return '';
  }

  const cleanMeta = cleanWinstonMeta(info);
  if (Object.keys(cleanMeta).length > 0) {
    return `\nMeta: ${JSON.stringify(cleanMeta, null, 2)}`;
  }
  return '';
}

// Enums for log levels and targets
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export enum LogTarget {
  CONSOLE = 'console',
  FILE = 'file',
  BOTH = 'both',
}

// Logger configuration interface
export interface LoggerConfig {
  level?: LogLevel;
  target?: LogTarget;
  context?: string;
  logDir?: string;
}

// Logger class wrapper around winston
export class Logger {
  private winstonLogger: winston.Logger;
  private config: Required<LoggerConfig>;

  constructor(config?: LoggerConfig) {
    // Set default configuration
    this.config = {
      level: config?.level ?? this.getDefaultLogLevel(),
      target: config?.target ?? this.detectLogTarget(),
      context: config?.context ?? 'mcp-security-report',
      logDir:
        config?.logDir ??
        process.env.MCP_SECURITY_REPORT_LOG_DIR ??
        path.join(
          process.env.MCP_SECURITY_REPORT_DIR ?? process.cwd(),
          '.logs'
        ),
    };

    // Detect stdio mode
    const isStdioMode =
      process.argv.includes('--stdio') ||
      process.env.MCP_SECURITY_REPORT_TRANSPORT === 'stdio';

    // Create winston logger with appropriate transports - ALL SYNCHRONOUS
    const transports: winston.transport[] = [];

    // Console transport
    if (
      this.config.target === LogTarget.CONSOLE ||
      this.config.target === LogTarget.BOTH
    ) {
      transports.push(
        new winston.transports.Console({
          stderrLevels: ['error', 'warn'], // Send error/warn to stderr, info/debug to stdout
          format: winston.format.combine(
            // Dynamic level filtering based on effective log level - BEFORE colorize
            winston.format((info) => {
              const currentLevel = this.config.level.toLowerCase();
              const levels = ['error', 'warn', 'info', 'debug'];
              const currentLevelIndex = levels.indexOf(currentLevel);
              const messageLevelIndex = levels.indexOf(info.level);

              // Only pass through if message level is at or above current level
              return messageLevelIndex <= currentLevelIndex ? info : false;
            })(),
            winston.format.colorize(),
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.printf((info) => {
              const contextStr = info.context
                ? ` [${info.context as string}]`
                : '';
              const stackStr = info.stack ? `\n${info.stack as string}` : '';

              // Include metadata in debug/verbose logs
              const levelStr = stripAnsiColors(info.level);
              const metaStr = formatMetaString(
                info as Record<string | symbol, unknown>,
                levelStr
              );

              return `${info.timestamp as string} ${info.level}${contextStr}: ${info.message as string}${stackStr}${metaStr}`;
            })
          ),
        })
      );
    }

    // File transport - defer creation in stdio mode to avoid blocking server startup
    if (
      (this.config.target === LogTarget.FILE ||
        this.config.target === LogTarget.BOTH) &&
      process.env.NODE_ENV !== 'test'
    ) {
      if (isStdioMode) {
        // In stdio mode, defer file transport creation to avoid interfering with transport setup
        // The file transport will be created asynchronously after a short delay
        setTimeout(() => {
          this.addFileTransportAsync();
        }, 100);
      } else {
        // In non-stdio mode, create file transport synchronously as before
        const fileTransport = this.createFileTransportSync();
        if (fileTransport) {
          transports.push(fileTransport);
        } else {
          emergencyWarn(
            'File transport creation failed, falling back to console transport to prevent log loss'
          );
          transports.push(
            new winston.transports.Console({
              stderrLevels: ['error', 'warn'],
              format: winston.format.combine(
                winston.format((info) => {
                  const currentLevel = this.config.level.toLowerCase();
                  const levels = ['error', 'warn', 'info', 'debug'];
                  const currentLevelIndex = levels.indexOf(currentLevel);
                  const messageLevelIndex = levels.indexOf(info.level);
                  return messageLevelIndex <= currentLevelIndex ? info : false;
                })(),
                winston.format.colorize(),
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.printf((info) => {
                  const contextStr = info.context
                    ? ` [${info.context as string}]`
                    : '';
                  const stackStr = info.stack
                    ? `\n${info.stack as string}`
                    : '';
                  const levelStr = stripAnsiColors(info.level);
                  const metaStr = formatMetaString(
                    info as Record<string | symbol, unknown>,
                    levelStr
                  );
                  return `${info.timestamp as string} ${info.level}${contextStr}: ${info.message as string}${stackStr}${metaStr} [FILE-TRANSPORT-FAILED]`;
                })
              ),
            })
          );
        }
      }
    }

    // Determine if logger should be silent
    const shouldBeSilent = isStdioMode && transports.length === 0;

    // Ensure we always have at least one transport to prevent Winston warnings
    if (transports.length === 0) {
      // This should never happen, but add a fallback console transport just in case
      transports.push(
        new winston.transports.Console({
          stderrLevels: ['error', 'warn'],
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.printf((info) => {
              return `${info.timestamp as string} ${info.level} [FALLBACK]: ${info.message as string}`;
            })
          ),
        })
      );
    }

    // Create the winston logger instance
    this.winstonLogger = winston.createLogger({
      level: this.config.level,
      defaultMeta: { context: this.config.context },
      transports,
      exitOnError: false,
      silent: shouldBeSilent, // Only silence in stdio mode with no file transport
    });
  }

  private getDefaultLogLevel(): LogLevel {
    // Check environment variable for log level
    const envLevel =
      process.env.MCP_SECURITY_REPORT_LOG_LEVEL?.toLowerCase() as LogLevel;
    if (envLevel && Object.values(LogLevel).includes(envLevel)) {
      return envLevel;
    }

    // Default to info level
    return LogLevel.INFO;
  }

  private detectLogTarget(): LogTarget {
    // Check environment variable first
    const envTarget = process.env.MCP_SECURITY_REPORT_LOG_TARGET;
    if (
      envTarget &&
      Object.values(LogTarget).includes(envTarget as LogTarget)
    ) {
      return envTarget as LogTarget;
    }

    // Check for stdio mode from environment or command line
    const isStdioMode =
      process.argv.includes('--stdio') ||
      process.env.MCP_SECURITY_REPORT_TRANSPORT === 'stdio';
    return isStdioMode ? LogTarget.FILE : LogTarget.CONSOLE;
  }

  private createFileTransportSync(): winston.transports.FileTransportInstance | null {
    try {
      // Create log directory synchronously
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (!fs.existsSync(this.config.logDir)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        fs.mkdirSync(this.config.logDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const logFile = path.join(
        this.config.logDir,
        `mcp-security-report-${timestamp}.log`
      );

      return new winston.transports.File({
        filename: logFile,
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
        tailable: true,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.printf((info) => {
            const contextStr = info.context
              ? ` [${info.context as string}]`
              : '';
            const stackStr = info.stack ? `\n${info.stack as string}` : '';

            // Include metadata in debug/verbose logs
            // eslint-disable-next-line no-control-regex
            const levelStr = info.level.replace(/\u001b\[[0-9;]*m/g, ''); // Remove ANSI color codes
            const metaStr = formatMetaString(
              info as Record<string | symbol, unknown>,
              levelStr
            );

            return `${info.timestamp as string} [${info.level}]${contextStr} ${info.message as string}${stackStr}${metaStr}`;
          })
        ),
      });
    } catch (error) {
      emergencyWarn('Failed to create file transport synchronously', error);
      return null;
    }
  }

  private addFileTransportAsync(): void {
    try {
      const fileTransport = this.createFileTransportSync();
      if (fileTransport) {
        this.winstonLogger.add(fileTransport);
      }
    } catch (error) {
      emergencyWarn(
        'Failed to add file transport asynchronously in stdio mode',
        error
      );
    }
  }

  // Logging methods
  public debug(message: string, meta?: Record<string, unknown>): void {
    this.winstonLogger.debug(message, meta);
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    this.winstonLogger.info(message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    this.winstonLogger.warn(message, meta);
  }

  public error(message: string | Error, meta?: Record<string, unknown>): void {
    if (message instanceof Error) {
      this.winstonLogger.error(message.message, {
        ...meta,
        stack: message.stack,
      });
    } else {
      this.winstonLogger.error(message, meta);
    }
  }

  // Allow changing log level dynamically
  public setLevel(level: LogLevel): void {
    this.config.level = level;
    this.winstonLogger.level = level;
  }

  // Create child logger using Winston's built-in child logger functionality
  public child(context: string): Logger {
    // Create a completely new logger instance with the same config but different context
    // This ensures the child inherits all the formatting behavior
    const childLogger = new Logger({ ...this.config, context });
    return childLogger;
  }

  // Clean up resources
  public end(): void {
    this.winstonLogger.end();
  }
}

// Create default logger instance
export const logger = new Logger();

// Create child logger function for context-specific logging
export function createChildLogger(context: string): Logger {
  return logger.child(context);
}

// Graceful shutdown management
let isShuttingDown = false;

const gracefulShutdown = (signal?: string): void => {
  if (isShuttingDown) {
    return; // Prevent multiple shutdown attempts
  }
  isShuttingDown = true;

  if (signal) {
    logger.info(`Received ${signal}, shutting down gracefully...`);
  }

  // Give logger time to flush any pending writes
  setTimeout(() => {
    logger.end();
  }, 100);
};

// Handle termination signals
process.on('SIGINT', () => {
  gracefulShutdown('SIGINT');
  // Allow time for cleanup before exit
  setTimeout(() => process.exit(0), 200);
});

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM');
  setTimeout(() => process.exit(0), 200);
});

// Handle uncaught exceptions and rejections more gracefully
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception - Application will exit:', {
    error: error.message,
    stack: error.stack,
    name: error.name,
  });
  gracefulShutdown();

  // Allow time for logging before exit
  setTimeout(() => {
    console.error('Uncaught exception occurred, exiting...');
    process.exit(1);
  }, 500);
});

process.on('unhandledRejection', (reason, _promise) => {
  const reasonStr = reason instanceof Error ? reason.message : String(reason);
  logger.error('Unhandled Promise Rejection - This should be handled:', {
    reason: reasonStr,
  });

  // Don't exit immediately for unhandled rejections - log and continue
  // This prevents the application from crashing on minor promise rejections
  if (reason instanceof Error && reason.name === 'AbortError') {
    // These are typically not fatal
    return;
  }

  // For more serious rejections, exit gracefully
  gracefulShutdown();
  setTimeout(() => {
    console.error('Critical unhandled promise rejection, exiting...');
    process.exit(1);
  }, 500);
});

// Clean up on normal exit (but don't call gracefulShutdown to avoid loops)
process.on('exit', () => {
  if (!isShuttingDown) {
    logger.end();
  }
});
