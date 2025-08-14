/**
 * Emergency logging utility for critical failures when Winston logger is unavailable
 * Provides direct stderr output with proper formatting for production environments
 */

import fs from 'fs';
import path from 'path';

/**
 * Write emergency log to file in stdio mode
 * Creates emergency log in .logs directory to avoid contaminating stdio streams
 */
function writeToEmergencyLogFile(
  level: 'WARN' | 'ERROR',
  message: string,
  error?: unknown
): void {
  try {
    const logDir =
      process.env.MCP_LOG_DIR ?? path.join(process.cwd(), '.logs');
    const timestamp = new Date().toISOString();
    const logFile = path.join(logDir, 'emergency.log');

    // Ensure log directory exists
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(logDir)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.mkdirSync(logDir, { recursive: true });
    }

    let errorStr = '';
    if (error instanceof Error) {
      errorStr = error.message;
    } else if (
      error !== undefined &&
      error !== null &&
      typeof error === 'string'
    ) {
      errorStr = error;
    } else if (error !== undefined && error !== null) {
      errorStr = 'Non-string error occurred';
    }

    const fullMessage = errorStr
      ? `${timestamp} [${level}] ${message}: ${errorStr}\n`
      : `${timestamp} [${level}] ${message}\n`;

    // Append to emergency log file
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.appendFileSync(logFile, fullMessage);
  } catch {
    // If emergency logging fails, there's nothing we can do without contaminating stdio
    // Silently fail to prevent infinite recursion or protocol contamination
  }
}

/**
 * Write emergency log message directly to stderr
 * Used when Winston logger has failed or is unavailable
 * In stdio mode, writes to a file to avoid contaminating stdout/stderr
 */
export function emergencyWarn(message: string, error?: unknown): void {
  // In stdio mode, write to emergency log file instead of stderr
  const isStdioMode = process.argv.includes('--stdio');
  if (isStdioMode) {
    writeToEmergencyLogFile('WARN', message, error);
    return;
  }

  const timestamp = new Date().toISOString();
  let errorStr = '';
  if (error instanceof Error) {
    errorStr = error.message;
  } else if (
    error !== undefined &&
    error !== null &&
    typeof error === 'string'
  ) {
    errorStr = error;
  } else if (error !== undefined && error !== null) {
    errorStr = 'Non-string error occurred';
  }

  const fullMessage = errorStr
    ? `${timestamp} [WARN] ${message}: ${errorStr}\n`
    : `${timestamp} [WARN] ${message}\n`;

  // Write directly to stderr bypassing any logging infrastructure
  process.stderr.write(fullMessage);
}

/**
 * Write emergency error message directly to stderr
 * Used for critical system failures
 * In stdio mode, writes to emergency log file instead of dropping
 */
export function emergencyError(message: string, error?: unknown): void {
  // In stdio mode, write to emergency log file instead of stderr
  const isStdioMode = process.argv.includes('--stdio');
  if (isStdioMode) {
    writeToEmergencyLogFile('ERROR', message, error);
    return;
  }

  const timestamp = new Date().toISOString();
  let errorStr = '';
  if (error instanceof Error) {
    errorStr = error.message;
  } else if (
    error !== undefined &&
    error !== null &&
    typeof error === 'string'
  ) {
    errorStr = error;
  } else if (error !== undefined && error !== null) {
    errorStr = 'Non-string error occurred';
  }

  const fullMessage = errorStr
    ? `${timestamp} [ERROR] ${message}: ${errorStr}\n`
    : `${timestamp} [ERROR] ${message}\n`;

  // Write directly to stderr bypassing any logging infrastructure
  process.stderr.write(fullMessage);
}
