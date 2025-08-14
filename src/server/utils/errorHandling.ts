import {
  AppError,
  ValidationError,
  ProjectExistsError,
  ProjectNotFoundError,
  FindingNotFoundError,
  AuditTrailNotFoundError,
} from '../../types/index.js';
import {
  ResponseBuilder,
  HandlerResponse,
  ErrorCodes,
} from '../../types/handlers.js';
import { createChildLogger } from '../../utils/logger.js';
import {
  ErrorMessages,
  createErrorResponse,
  sanitizeErrorMessage,
} from './errorMessages.js';

// Create logger for error handling
const logger = createChildLogger('error-handler');

/**
 * Centralized error handling utility for consistent error responses across handlers
 */
export class ErrorHandler {
  static handleError(
    error: unknown,
    operation: string,
    context?: Record<string, unknown>
  ): HandlerResponse {
    // Handle known application errors with standardized messages
    if (error instanceof ProjectExistsError) {
      const projectName = (context?.projectName as string) || 'unknown';
      const errorResponse = createErrorResponse(ErrorMessages.PROJECT_EXISTS, [
        projectName,
      ]);
      return ResponseBuilder.error(
        errorResponse.userMessage,
        ErrorCodes.PROJECT_ALREADY_EXISTS
      );
    }

    if (error instanceof ProjectNotFoundError) {
      const projectName = (context?.projectName as string) || 'unknown';
      const errorResponse = createErrorResponse(
        ErrorMessages.PROJECT_NOT_FOUND,
        [projectName]
      );
      return ResponseBuilder.error(
        errorResponse.userMessage,
        ErrorCodes.PROJECT_NOT_FOUND
      );
    }

    if (error instanceof FindingNotFoundError) {
      const findingId =
        (context?.findingId as string) || (context?.id as string) || 'unknown';
      const errorResponse = createErrorResponse(
        ErrorMessages.FINDING_NOT_FOUND,
        [findingId]
      );
      return ResponseBuilder.error(
        errorResponse.userMessage,
        ErrorCodes.FINDING_NOT_FOUND
      );
    }

    if (error instanceof AuditTrailNotFoundError) {
      const auditId =
        (context?.auditId as string) || (context?.id as string) || 'unknown';
      const errorResponse = createErrorResponse(
        ErrorMessages.AUDIT_TRAIL_NOT_FOUND,
        [auditId]
      );
      return ResponseBuilder.error(
        errorResponse.userMessage,
        ErrorCodes.AUDIT_TRAIL_NOT_FOUND
      );
    }

    if (error instanceof ValidationError) {
      const errorResponse = createErrorResponse(
        ErrorMessages.VALIDATION_ERROR
      );
      return ResponseBuilder.error(
        errorResponse.userMessage,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    // Handle generic application errors
    if (error instanceof AppError) {
      const errorResponse = createErrorResponse(
        ErrorMessages.INTERNAL_ERROR,
        [],
        [operation, this.getErrorMessage(error)]
      );
      return ResponseBuilder.error(
        errorResponse.userMessage,
        ErrorCodes.STORAGE_ERROR
      );
    }

    // Handle unknown errors with sanitization
    const sanitizedMessage =
      error instanceof Error
        ? sanitizeErrorMessage(
            error,
            ErrorMessages.INTERNAL_ERROR.userMessage()
          )
        : ErrorMessages.INTERNAL_ERROR.userMessage();

    return ResponseBuilder.error(sanitizedMessage, ErrorCodes.UNKNOWN_ERROR);
  }

  /**
   * Type guard to check if an error is a known application error
   */
  static isApplicationError(error: unknown): error is AppError {
    return error instanceof AppError;
  }

  /**
   * Extract error message safely from unknown error
   */
  static getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Log error with context for debugging using standardized messages
   */
  static logError(
    error: unknown,
    operation: string,
    context?: Record<string, unknown>
  ): void {
    let logMessage = '';
    const logMeta = context ?? {};

    // Create standardized log messages based on error type
    if (error instanceof ProjectExistsError) {
      const projectName = (context?.projectName as string) || 'unknown';
      const errorResponse = createErrorResponse(
        ErrorMessages.PROJECT_EXISTS,
        [],
        [projectName, operation]
      );
      logMessage = errorResponse.logMessage;
    } else if (error instanceof ProjectNotFoundError) {
      const projectName = (context?.projectName as string) || 'unknown';
      const errorResponse = createErrorResponse(
        ErrorMessages.PROJECT_NOT_FOUND,
        [],
        [projectName, operation]
      );
      logMessage = errorResponse.logMessage;
    } else if (error instanceof FindingNotFoundError) {
      const findingId =
        (context?.findingId as string) || (context?.id as string) || 'unknown';
      const projectName = context?.projectName as string;
      const errorResponse = createErrorResponse(
        ErrorMessages.FINDING_NOT_FOUND,
        [],
        [findingId, projectName, operation]
      );
      logMessage = errorResponse.logMessage;
    } else if (error instanceof AuditTrailNotFoundError) {
      const auditId =
        (context?.auditId as string) || (context?.id as string) || 'unknown';
      const projectName = context?.projectName as string;
      const errorResponse = createErrorResponse(
        ErrorMessages.AUDIT_TRAIL_NOT_FOUND,
        [],
        [auditId, projectName, operation]
      );
      logMessage = errorResponse.logMessage;
    } else if (error instanceof ValidationError) {
      const errorResponse = createErrorResponse(
        ErrorMessages.VALIDATION_ERROR,
        [],
        [this.getErrorMessage(error), operation]
      );
      logMessage = errorResponse.logMessage;
    } else {
      // Fallback for unknown errors
      const errorResponse = createErrorResponse(
        ErrorMessages.INTERNAL_ERROR,
        [],
        [operation, this.getErrorMessage(error)]
      );
      logMessage = errorResponse.logMessage;
    }

    if (error instanceof AppError) {
      // Application errors are expected and logged at warn level
      logger.warn(logMessage, logMeta);
    } else {
      // Unexpected errors are logged at error level with stack trace
      const errorMeta = { ...logMeta };
      if (error instanceof Error && error.stack) {
        errorMeta.stack = error.stack;
      }
      logger.error(logMessage, errorMeta);
    }
  }
}
