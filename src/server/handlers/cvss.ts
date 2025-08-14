import { calculateCVSSScore, validateCVSSVector } from '../../utils/cvss.js';
import { ResponseBuilder, HandlerResponse } from '../../types/handlers.js';
import { AppError } from '../../types/index.js';
import { ValidateCvssSchema } from '../schemas.js';

export class CvssHandler {
  /**
   * Validate and score a CVSS vector string
   */
  validateCvss(params: unknown): HandlerResponse {
    try {
      const input = ValidateCvssSchema.parse(params);

      // First, use detailed validation to get better error messages
      const validation = validateCVSSVector(input.vector);

      if (!validation.valid) {
        const errorResponse = {
          valid: false,
          error: validation.error ?? 'Invalid CVSS vector',
          details: validation.details,
          vector: input.vector,
        };
        return ResponseBuilder.json(errorResponse);
      }

      // If validation passes, calculate the score
      const result = calculateCVSSScore(input.vector);

      const response = {
        valid: true,
        score: result.score,
        severity: result.rating,
        vector: input.vector,
        version: result.version,
        baseScore: result.baseScore,
        ...(result.temporalScore && { temporalScore: result.temporalScore }),
        ...(result.environmentalScore && {
          environmentalScore: result.environmentalScore,
        }),
      };

      return ResponseBuilder.json(response);
    } catch (error) {
      // Fallback error handling for schema validation errors
      const errorResponse = {
        valid: false,
        error:
          error instanceof AppError || error instanceof Error
            ? error.message
            : 'Invalid request format',
      };

      return ResponseBuilder.json(errorResponse);
    }
  }

  /**
   * Calculate CVSS score from a vector string
   * (Alias for validateCvss with clearer naming for CLI usage)
   */
  calculateCvss(params: unknown): HandlerResponse {
    return this.validateCvss(params);
  }
}
