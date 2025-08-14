import cvssCalculator, {
  type CVSSCalculator,
  type CVSSScores,
} from 'ae-cvss-calculator';

const { Cvss2, Cvss3P0, Cvss3P1, Cvss4P0 } = cvssCalculator;

export interface CVSSResult {
  score: number;
  vector: string;
  version: string;
  baseScore: number;
  temporalScore?: number | undefined;
  environmentalScore?: number | undefined;
  rating: string;
}

export class CVSSError extends Error {
  public readonly vector?: string;
  public readonly cause?: Error;

  constructor(message: string, vector?: string, cause?: Error) {
    super(message);
    this.name = 'CVSSError';
    if (vector !== undefined) this.vector = vector;
    if (cause !== undefined) this.cause = cause;

    // Maintain proper stack trace (when supported)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CVSSError);
    }
  }
}

export function calculateCVSSScore(vector: string): CVSSResult {
  if (!vector || typeof vector !== 'string' || vector.trim().length === 0) {
    throw new CVSSError('Invalid CVSS vector: empty or null string', vector);
  }

  const cleanVector = vector.trim();

  try {
    // Determine CVSS version from vector string
    let cvssInstance: CVSSCalculator;
    let scores: CVSSScores;
    let version: string;

    if (cleanVector.startsWith('CVSS:4.0')) {
      cvssInstance = new Cvss4P0(cleanVector);
      scores = cvssInstance.calculateScores();
      version = '4.0';

      // Validate that we got valid scores
      if (!scores?.base) {
        throw new CVSSError(
          'CVSS 4.0 calculation returned invalid scores',
          vector
        );
      }

      return {
        score: scores.base, // Standardize to use base score like other versions
        vector: scores.vector,
        version,
        baseScore: scores.base,
        temporalScore: scores.temporal,
        environmentalScore: scores.environmental,
        rating: getCVSSSeverityRating(scores.base),
      };
    } else if (cleanVector.startsWith('CVSS:3.1')) {
      cvssInstance = new Cvss3P1(cleanVector);
      scores = cvssInstance.calculateScores();
      version = '3.1';

      if (!scores?.base) {
        throw new CVSSError(
          'CVSS 3.1 calculation returned invalid scores',
          vector
        );
      }

      return {
        score: scores.base,
        vector: scores.vector,
        version,
        baseScore: scores.base,
        temporalScore: scores.temporal,
        environmentalScore: scores.environmental,
        rating: getCVSSSeverityRating(scores.base),
      };
    } else if (cleanVector.startsWith('CVSS:3.0')) {
      cvssInstance = new Cvss3P0(cleanVector);
      scores = cvssInstance.calculateScores();
      version = '3.0';

      if (!scores?.base) {
        throw new CVSSError(
          'CVSS 3.0 calculation returned invalid scores',
          vector
        );
      }

      return {
        score: scores.base,
        vector: scores.vector,
        version,
        baseScore: scores.base,
        temporalScore: scores.temporal,
        environmentalScore: scores.environmental,
        rating: getCVSSSeverityRating(scores.base),
      };
    } else {
      // Assume CVSS 2.0 if no version prefix
      // Basic validation for CVSS 2.0 format
      if (!cleanVector.includes(':') || cleanVector.split('/').length < 3) {
        throw new CVSSError('Invalid CVSS vector format', vector);
      }

      cvssInstance = new Cvss2(cleanVector);
      scores = cvssInstance.calculateScores();
      version = '2.0';

      if (!scores?.base) {
        throw new CVSSError(
          'CVSS 2.0 calculation returned invalid scores',
          vector
        );
      }

      return {
        score: scores.base,
        vector: scores.vector,
        version,
        baseScore: scores.base,
        temporalScore: scores.temporal,
        environmentalScore: scores.environmental,
        rating: getCVSSSeverityRating(scores.base),
      };
    }
  } catch (error) {
    if (error instanceof CVSSError) {
      throw error;
    }

    // Enhanced error handling with proper error chaining
    const originalError =
      error instanceof Error ? error : new Error(String(error));

    // Categorize different types of errors for better debugging
    if (
      originalError.message.includes('Cannot read properties of undefined')
    ) {
      throw new CVSSError(
        'Invalid CVSS vector format - missing required components',
        vector,
        originalError
      );
    }

    if (originalError.message.includes('Invalid')) {
      throw new CVSSError(
        `CVSS validation failed: ${originalError.message}`,
        vector,
        originalError
      );
    }

    if (originalError.name === 'TypeError') {
      throw new CVSSError(
        'CVSS vector has invalid type or structure',
        vector,
        originalError
      );
    }

    if (originalError.name === 'RangeError') {
      throw new CVSSError(
        'CVSS vector values are out of valid range',
        vector,
        originalError
      );
    }

    // Generic fallback with original error preserved
    throw new CVSSError(
      `Failed to calculate CVSS score: ${originalError.message}`,
      vector,
      originalError
    );
  }
}

export function getCVSSSeverityRating(score: number): string {
  if (score >= 9.0) return 'Critical';
  if (score >= 7.0) return 'High';
  if (score >= 4.0) return 'Medium';
  if (score >= 0.1) return 'Low';
  return 'None';
}

export function formatCVSSDisplay(vector: string): string {
  try {
    const result = calculateCVSSScore(vector);
    return `${result.score.toFixed(1)} (${result.rating})`;
  } catch (error) {
    // Log the detailed error for debugging while returning a user-friendly message
    if (error instanceof CVSSError) {
      // For CVSSError, we can provide more specific feedback
      if (error.message.includes('empty or null')) {
        return 'Invalid CVSS: Empty vector';
      }
      if (error.message.includes('format')) {
        return 'Invalid CVSS: Bad format';
      }
      if (error.message.includes('validation failed')) {
        return 'Invalid CVSS: Validation failed';
      }
      if (error.message.includes('out of valid range')) {
        return 'Invalid CVSS: Values out of range';
      }
      return `Invalid CVSS: ${error.message.split(':')[0]}`;
    }

    // For non-CVSSError exceptions, keep it simple but log for debugging
    return 'Invalid CVSS';
  }
}

/**
 * Validates a CVSS vector string without throwing errors
 * @param vector CVSS vector string to validate
 * @returns boolean indicating if vector is valid
 */
export function isValidCVSSVector(vector: string): boolean {
  try {
    calculateCVSSScore(vector);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a CVSS vector and returns detailed error information
 * @param vector CVSS vector string to validate
 * @returns object with validation result and error details
 */
export function validateCVSSVector(vector: string): {
  valid: boolean;
  error?: string;
  details?: string;
} {
  try {
    calculateCVSSScore(vector);
    return { valid: true };
  } catch (error) {
    if (error instanceof CVSSError) {
      const result: { valid: false; error: string; details?: string } = {
        valid: false,
        error: error.message,
      };

      if (error.vector) {
        result.details = `Vector: ${error.vector}`;
      }

      return result;
    }

    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      error: errorMessage,
    };
  }
}
