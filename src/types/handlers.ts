/**
 * Shared types for all MCP handlers
 */

export interface TextContent {
  type: 'text';
  text: string;
  [x: string]: unknown;
}

export interface HandlerResponse {
  content: TextContent[];
  [x: string]: unknown;
}

export interface HandlerError {
  readonly error: string;
  readonly details?: unknown;
}

/**
 * Type for handler functions
 */
export type HandlerFunction = (
  args: Record<string, unknown>
) => Promise<HandlerResponse>;

/**
 * Standardized error codes for consistent error handling
 */
export const ErrorCodes = {
  // Project errors (1000-1099)
  PROJECT_NOT_FOUND: 'MCP-1001',
  PROJECT_ALREADY_EXISTS: 'MCP-1002',
  PROJECT_INVALID_NAME: 'MCP-1003',
  PROJECT_ACCESS_DENIED: 'MCP-1004',

  // Finding errors (1100-1199)
  FINDING_NOT_FOUND: 'MCP-1101',
  FINDING_INVALID_SEVERITY: 'MCP-1102',
  FINDING_INVALID_CVSS: 'MCP-1103',
  FINDING_INVALID_CWE: 'MCP-1104',

  // Audit trail errors (1200-1299)
  AUDIT_TRAIL_NOT_FOUND: 'MCP-1201',
  AUDIT_TRAIL_INVALID_DATA: 'MCP-1202',

  // Executive summary errors (1300-1399)
  EXECUTIVE_SUMMARY_NOT_FOUND: 'MCP-1301',
  EXECUTIVE_SUMMARY_INVALID_FORMAT: 'MCP-1302',

  // Validation errors (1400-1499)
  VALIDATION_ERROR: 'MCP-1401',
  PATH_TRAVERSAL_ATTEMPT: 'MCP-1402',
  INVALID_INPUT: 'MCP-1403',

  // System errors (1500-1599)
  STORAGE_ERROR: 'MCP-1501',
  NETWORK_ERROR: 'MCP-1502',
  PERMISSION_DENIED: 'MCP-1503',

  // Unknown errors (1999)
  UNKNOWN_ERROR: 'MCP-1999',
} as const;

/**
 * Standard response builder for handlers
 * Provides consistent response formatting across all handlers
 */
export class ResponseBuilder {
  /**
   * Create a successful response with text content
   */
  static success(text: string): HandlerResponse {
    return {
      content: [{ type: 'text' as const, text }],
    };
  }

  /**
   * Create an error response with standardized error code
   */
  static error(
    message: string,
    errorCode?: string,
    details?: unknown
  ): HandlerResponse {
    let errorText = errorCode
      ? `Error ${errorCode}: ${message}`
      : `Error: ${message}`;

    if (details) {
      errorText += `\nDetails: ${JSON.stringify(details, null, 2)}`;
    }

    return {
      content: [{ type: 'text' as const, text: errorText }],
      errorCode,
    };
  }

  /**
   * Create a response with a list of items
   */
  static list(items: readonly string[]): HandlerResponse {
    return {
      content: [{ type: 'text' as const, text: items.join('\n') }],
    };
  }

  /**
   * Create a response with JSON-formatted data
   */
  static json(data: unknown): HandlerResponse {
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify(data, null, 2) },
      ],
    };
  }

  /**
   * Create a response with multiple text sections
   */
  static multi(...texts: string[]): HandlerResponse {
    return {
      content: texts.map((text) => ({ type: 'text' as const, text })),
    };
  }

  /**
   * Create an empty response
   */
  static empty(): HandlerResponse {
    return {
      content: [],
    };
  }
}
