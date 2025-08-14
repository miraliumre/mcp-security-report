/**
 * Centralized error message templates to ensure consistency
 * and prevent information disclosure
 */

export interface ErrorTemplate {
  userMessage: string | ((...args: any[]) => string);
  logMessage?: string | ((...args: any[]) => string);
  code: string;
}

export const ErrorMessages = {
  // Project-related errors
  PROJECT_NOT_FOUND: {
    userMessage: (projectName: string) =>
      `Project "${projectName}" not found.`,
    logMessage: (projectName: string, context?: string) =>
      `Project not found: ${projectName}${context ? ` (${context})` : ''}`,
    code: 'PROJECT_NOT_FOUND',
  },

  PROJECT_EXISTS: {
    userMessage: (projectName: string) =>
      `Project "${projectName}" already exists.`,
    logMessage: (projectName: string, context?: string) =>
      `Project creation failed - already exists: ${projectName}${context ? ` (${context})` : ''}`,
    code: 'PROJECT_EXISTS',
  },

  PROJECT_OPERATION_FAILED: {
    userMessage: (operation: string) => `Failed to ${operation} project.`,
    logMessage: (operation: string, projectName?: string, error?: string) =>
      `Project ${operation} failed${projectName ? ` for ${projectName}` : ''}${error ? `: ${error}` : ''}`,
    code: 'PROJECT_OPERATION_FAILED',
  },

  // Finding-related errors
  FINDING_NOT_FOUND: {
    userMessage: (findingId: string) => `Finding "${findingId}" not found.`,
    logMessage: (findingId: string, projectName?: string, context?: string) =>
      `Finding not found: ${findingId}${projectName ? ` in project ${projectName}` : ''}${context ? ` (${context})` : ''}`,
    code: 'FINDING_NOT_FOUND',
  },

  FINDING_OPERATION_FAILED: {
    userMessage: (operation: string) => `Failed to ${operation} finding.`,
    logMessage: (
      operation: string,
      findingId?: string,
      projectName?: string,
      error?: string
    ) =>
      `Finding ${operation} failed${findingId ? ` for ${findingId}` : ''}${projectName ? ` in project ${projectName}` : ''}${error ? `: ${error}` : ''}`,
    code: 'FINDING_OPERATION_FAILED',
  },

  // Audit trail errors
  AUDIT_TRAIL_NOT_FOUND: {
    userMessage: (auditId: string) => `Audit trail "${auditId}" not found.`,
    logMessage: (auditId: string, projectName?: string, context?: string) =>
      `Audit trail not found: ${auditId}${projectName ? ` in project ${projectName}` : ''}${context ? ` (${context})` : ''}`,
    code: 'AUDIT_TRAIL_NOT_FOUND',
  },

  AUDIT_TRAIL_OPERATION_FAILED: {
    userMessage: (operation: string) => `Failed to ${operation} audit trail.`,
    logMessage: (
      operation: string,
      auditId?: string,
      projectName?: string,
      error?: string
    ) =>
      `Audit trail ${operation} failed${auditId ? ` for ${auditId}` : ''}${projectName ? ` in project ${projectName}` : ''}${error ? `: ${error}` : ''}`,
    code: 'AUDIT_TRAIL_OPERATION_FAILED',
  },

  // Validation errors
  VALIDATION_ERROR: {
    userMessage: (field?: string) =>
      `Invalid ${field ? field + ' ' : ''}input provided.`,
    logMessage: (details: string, context?: string) =>
      `Validation error: ${details}${context ? ` (${context})` : ''}`,
    code: 'VALIDATION_ERROR',
  },

  CVSS_VALIDATION_ERROR: {
    userMessage: () => 'Invalid CVSS vector provided.',
    logMessage: (vector: string, error: string) =>
      `CVSS validation failed for vector "${vector}": ${error}`,
    code: 'CVSS_VALIDATION_ERROR',
  },

  // File system errors
  FILE_OPERATION_FAILED: {
    userMessage: (operation: string) => `File ${operation} operation failed.`,
    logMessage: (operation: string, path?: string, error?: string) =>
      `File ${operation} failed${path ? ` for ${path}` : ''}${error ? `: ${error}` : ''}`,
    code: 'FILE_OPERATION_FAILED',
  },

  DIRECTORY_ACCESS_ERROR: {
    userMessage: () => 'Unable to access the requested directory.',
    logMessage: (path: string, error: string) =>
      `Directory access error for ${path}: ${error}`,
    code: 'DIRECTORY_ACCESS_ERROR',
  },

  // Security errors
  PATH_TRAVERSAL_ATTEMPT: {
    userMessage: () => 'Invalid path provided.',
    logMessage: (path: string, context?: string) =>
      `Path traversal attempt detected: ${path}${context ? ` (${context})` : ''}`,
    code: 'PATH_TRAVERSAL_ATTEMPT',
  },

  UNAUTHORIZED_ACCESS: {
    userMessage: () => 'Access denied.',
    logMessage: (resource: string, context?: string) =>
      `Unauthorized access attempt to ${resource}${context ? ` (${context})` : ''}`,
    code: 'UNAUTHORIZED_ACCESS',
  },

  // Network/HTTP errors
  REQUEST_TIMEOUT: {
    userMessage: () => 'Request timed out. Please try again.',
    logMessage: (endpoint?: string, duration?: number) =>
      `Request timeout${endpoint ? ` for ${endpoint}` : ''}${duration ? ` after ${duration}ms` : ''}`,
    code: 'REQUEST_TIMEOUT',
  },

  RATE_LIMIT_EXCEEDED: {
    userMessage: () => 'Too many requests. Please try again later.',
    logMessage: (clientId?: string, endpoint?: string) =>
      `Rate limit exceeded${clientId ? ` for client ${clientId}` : ''}${endpoint ? ` on ${endpoint}` : ''}`,
    code: 'RATE_LIMIT_EXCEEDED',
  },

  // Generic errors
  INTERNAL_ERROR: {
    userMessage: () => 'An internal error occurred. Please try again.',
    logMessage: (operation: string, error?: string) =>
      `Internal error during ${operation}${error ? `: ${error}` : ''}`,
    code: 'INTERNAL_ERROR',
  },

  RESOURCE_UNAVAILABLE: {
    userMessage: (resource?: string) =>
      `${resource ?? 'Resource'} is temporarily unavailable.`,
    logMessage: (resource: string, reason?: string) =>
      `Resource unavailable: ${resource}${reason ? ` - ${reason}` : ''}`,
    code: 'RESOURCE_UNAVAILABLE',
  },

  // CWE/CVSS specific errors
  CWE_API_ERROR: {
    userMessage: () => 'Unable to retrieve CWE information at this time.',
    logMessage: (cweId?: string, error?: string) =>
      `CWE API error${cweId ? ` for ${cweId}` : ''}${error ? `: ${error}` : ''}`,
    code: 'CWE_API_ERROR',
  },
} as const;

/**
 * Helper function to create structured error responses
 */
export function createErrorResponse(
  template: ErrorTemplate,
  userParams?: unknown[],
  logParams?: unknown[],
  context?: string
): {
  userMessage: string;
  logMessage: string;
  code: string;
} {
  const userMessage =
    typeof template.userMessage === 'function'
      ? template.userMessage(...(userParams ?? []))
      : template.userMessage;

  const logMessage = template.logMessage
    ? typeof template.logMessage === 'function'
      ? template.logMessage(...(logParams ?? []), context)
      : template.logMessage
    : userMessage;

  return {
    userMessage,
    logMessage,
    code: template.code,
  };
}

/**
 * Sanitize error message to prevent information disclosure
 */
export function sanitizeErrorMessage(
  error: Error,
  fallbackMessage: string
): string {
  // Never expose internal paths, stack traces, or system information
  const sensitivePatterns = [
    /\/[a-zA-Z0-9_\-/]+/, // File paths
    /Error: ENOENT:.*/, // File system errors
    /Error: EACCES:.*/, // Permission errors
    /at [a-zA-Z0-9_\-/.]+:\d+:\d+/, // Stack trace lines
    /node_modules/,
    /process\.env/,
    /localhost:\d+/,
    /127\.0\.0\.1:\d+/,
  ];

  let message = error.message;

  for (const pattern of sensitivePatterns) {
    if (pattern.test(message)) {
      return fallbackMessage;
    }
  }

  return message;
}
