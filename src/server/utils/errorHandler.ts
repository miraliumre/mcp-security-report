import {
  ResponseBuilder,
  HandlerResponse,
  ErrorCodes,
} from '../../types/handlers.js';
import {
  ProjectExistsError,
  ProjectNotFoundError,
  NoActiveProjectError,
  FindingNotFoundError,
  AuditTrailNotFoundError,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Standardized error handling for MCP handlers
 */
export async function handleToolExecution<T>(
  fn: () => Promise<T>,
  formatSuccess: (result: T) => HandlerResponse
): Promise<HandlerResponse> {
  try {
    const result = await fn();
    return formatSuccess(result);
  } catch (error) {
    return handleError(error);
  }
}

export function handleError(error: unknown): HandlerResponse {
  if (error instanceof ProjectExistsError) {
    logger.warn('Project already exists', { error: error.message });
    return ResponseBuilder.error(
      error.message,
      ErrorCodes.PROJECT_ALREADY_EXISTS
    );
  }

  if (error instanceof ProjectNotFoundError) {
    logger.warn('Project not found', { error: error.message });
    return ResponseBuilder.error(error.message, ErrorCodes.PROJECT_NOT_FOUND);
  }

  if (error instanceof NoActiveProjectError) {
    logger.warn('No active project', { error: error.message });
    return ResponseBuilder.error(error.message, ErrorCodes.PROJECT_NOT_FOUND);
  }

  if (error instanceof FindingNotFoundError) {
    logger.warn('Finding not found', { error: error.message });
    return ResponseBuilder.error(error.message, ErrorCodes.FINDING_NOT_FOUND);
  }

  if (error instanceof AuditTrailNotFoundError) {
    logger.warn('Audit trail not found', { error: error.message });
    return ResponseBuilder.error(
      error.message,
      ErrorCodes.AUDIT_TRAIL_NOT_FOUND
    );
  }

  if (error instanceof Error) {
    logger.error('Error in handler execution', {
      error: error.message,
      stack: error.stack,
      name: error.name,
    });
    return ResponseBuilder.error(error.message);
  }

  logger.error('Unknown error occurred', { error: String(error) });
  return ResponseBuilder.error('An unknown error occurred', undefined, error);
}
