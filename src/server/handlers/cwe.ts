import { HandlerResponse } from '../../types/handlers.js';
import {
  GetCweSchema,
  GetCweCategoriesSchema,
  GetCweViewsSchema,
} from '../schemas.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createChildLogger } from '../../utils/logger.js';

// Read package.json for dynamic server info
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../../../package.json');
const packageJson = JSON.parse(
  readFileSync(packageJsonPath, 'utf-8')
) as Record<string, unknown>;
const SERVER_NAME = (packageJson.name as string) ?? 'mcp-security-report';
const SERVER_VERSION = (packageJson.version as string) ?? 'dev';

// CWE API response types
interface CweConsequence {
  Scope?: string[];
  Impact?: string[];
  Note?: string;
}

interface CweMitigation {
  Phase?: string[];
  Description?: string;
}

interface CweRelatedWeakness {
  Nature: string;
  CweID: string;
}

interface CweWeakness {
  ID: string;
  Name: string;
  Type?: string;
  Description?: string;
  ExtendedDescription?: string;
  Abstraction?: string;
  Structure?: string;
  Status?: string;
  LikelihoodOfExploit?: string;
  CommonConsequences?: CweConsequence[];
  PotentialMitigations?: CweMitigation[];
  RelatedWeaknesses?: CweRelatedWeakness[];
}

interface CweApiResponse {
  Weaknesses?: CweWeakness[];
}

interface CweCategory {
  ID: string;
  Name: string;
  Status?: string;
  Summary?: string;
  Relationships?: Array<{
    CweID: string;
    ViewID: string;
  }>;
}

interface CweCategoryResponse {
  Categories?: CweCategory[];
}

interface CweView {
  ID: string;
  Name: string;
  Type?: string;
  Status?: string;
  Objective?: string;
  Audience?: Array<{
    Type: string;
    Description?: string;
  }>;
  Members?: Array<{
    CweID: string;
    ViewID: string;
  }>;
}

interface CweViewResponse {
  Views?: CweView[];
}

// Error types for better error categorization
class NetworkError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class ValidationError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class CweHandler {
  private readonly baseUrl = 'https://cwe-api.mitre.org/api/v1';
  private readonly requestTimeout = 5000; // 5 seconds - faster timeout to prevent hangs
  private readonly maxRetries = 2; // Reduced retries to prevent long delays
  private readonly retryDelay = 500; // 500ms base delay - faster recovery
  private readonly userAgent = `${SERVER_NAME}/${SERVER_VERSION}`;
  private readonly logger = createChildLogger('CweHandler');

  private normalizeCweId(id: string): string {
    // Remove CWE- prefix if present and return just the number
    const normalized = id.replace(/^CWE-/i, '');

    // Validate that it's a valid CWE ID format
    if (!/^\d{1,5}$/.test(normalized)) {
      throw new ValidationError(`Invalid CWE ID format: ${id}`);
    }

    return normalized;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchJson<T>(url: string, retryCount = 0): Promise<T> {
    // Parse URL to extract query parameters for logging
    const urlObj = new URL(url);
    const params = Object.fromEntries(urlObj.searchParams.entries());

    // Log API call details with enhanced information
    this.logger.debug(`MITRE CWE API call initiated`, {
      fullUrl: url,
      method: 'GET',
      baseUrl: urlObj.origin + urlObj.pathname,
      queryParams: Object.keys(params).length > 0 ? params : undefined,
      userAgent: this.userAgent,
      retryAttempt: retryCount + 1,
      maxRetries: this.maxRetries,
      timeout: this.requestTimeout,
      timestamp: new Date().toISOString(),
    });

    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        this.logger.debug(`MITRE CWE API request timeout triggered`, {
          fullUrl: url,
          timeout: this.requestTimeout,
          retryAttempt: retryCount + 1,
        });
        controller.abort();
      }, this.requestTimeout);

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': this.userAgent,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Log response status with full details
      this.logger.info(
        `MITRE CWE API call: ${url} ${response.status} ${response.statusText}`
      );

      if (!response.ok) {
        // Log error response body for debugging
        let responseBody = '';
        try {
          responseBody = await response.text();
          this.logger.debug(`MITRE CWE API error response body`, {
            fullUrl: url,
            httpStatus: response.status,
            responseBody: responseBody.substring(0, 1000), // Limit to 1000 chars
            retryAttempt: retryCount + 1,
          });
        } catch (bodyError) {
          this.logger.debug(`Failed to read error response body`, {
            fullUrl: url,
            httpStatus: response.status,
            bodyError:
              bodyError instanceof Error
                ? bodyError.message
                : String(bodyError),
          });
        }

        // Categorize different HTTP errors
        if (response.status >= 400 && response.status < 500) {
          throw new ApiError(
            `Client error ${response.status}: ${response.statusText}`,
            response.status
          );
        } else if (response.status >= 500) {
          throw new ApiError(
            `Server error ${response.status}: ${response.statusText}`,
            response.status
          );
        } else {
          throw new ApiError(
            `HTTP error ${response.status}: ${response.statusText}`,
            response.status
          );
        }
      }

      // Add timeout protection for JSON parsing to prevent hangs on malformed responses
      const jsonParsePromise = response.json() as Promise<T>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('JSON parsing timeout')), 3000);
      });
      const data = await Promise.race([jsonParsePromise, timeoutPromise]);
      this.logger.debug(`MITRE CWE API successful response parsed`, {
        fullUrl: url,
        httpStatus: response.status,
        dataKeys:
          typeof data === 'object' && data !== null
            ? Object.keys(data)
            : undefined,
        dataSize: JSON.stringify(data).length,
        retryAttempt: retryCount + 1,
        timestamp: new Date().toISOString(),
      });
      return data;
    } catch (error) {
      // Log error details with enhanced information
      this.logger.debug(`MITRE CWE API error occurred`, {
        fullUrl: url,
        retryAttempt: retryCount + 1,
        maxRetries: this.maxRetries,
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      });

      // Handle different types of errors
      if (error instanceof ApiError || error instanceof ValidationError) {
        throw error; // Re-throw API and validation errors directly
      }

      if (error instanceof Error) {
        // Handle network timeouts and connection errors
        if (error.name === 'AbortError') {
          if (retryCount < this.maxRetries) {
            const delay = this.retryDelay * Math.pow(2, retryCount);
            this.logger.debug(`MITRE CWE API timeout, retrying`, {
              fullUrl: url,
              currentRetry: retryCount + 1,
              nextRetry: retryCount + 2,
              maxRetries: this.maxRetries,
              delayMs: delay,
            });
            await this.delay(delay);
            return this.fetchJson(url, retryCount + 1);
          }
          throw new NetworkError(
            `Request timeout after ${this.requestTimeout}ms`,
            error
          );
        }

        if (error.message.includes('fetch')) {
          if (retryCount < this.maxRetries) {
            const delay = this.retryDelay * Math.pow(2, retryCount);
            this.logger.debug(`MITRE CWE API network error, retrying`, {
              fullUrl: url,
              currentRetry: retryCount + 1,
              nextRetry: retryCount + 2,
              maxRetries: this.maxRetries,
              delayMs: delay,
            });
            await this.delay(delay);
            return this.fetchJson(url, retryCount + 1);
          }
          throw new NetworkError(
            `Network error after ${retryCount + 1} attempts: ${error.message}`,
            error
          );
        }

        throw new NetworkError(
          `Failed to fetch from CWE API: ${error.message}`,
          error
        );
      }

      throw new Error(`Unknown error: ${String(error)}`);
    }
  }

  async getCwe(params: unknown): Promise<HandlerResponse> {
    const input = GetCweSchema.parse(params);
    const normalizedIds = input.ids
      .split(',')
      .map((id) => this.normalizeCweId(id.trim()))
      .join(',');

    try {
      const url = `${this.baseUrl}/cwe/weakness/${normalizedIds}`;
      const data = await this.fetchJson<CweApiResponse>(url);

      if (!data.Weaknesses || data.Weaknesses.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No CWE weaknesses found for IDs: ${input.ids}`,
            },
          ],
        };
      }

      // If single weakness, show detailed format; if multiple, show list format
      const result =
        data.Weaknesses.length === 1 && data.Weaknesses[0]
          ? this.formatWeaknessDetails(data.Weaknesses[0])
          : this.formatWeaknessList(data.Weaknesses);

      this.logger.debug(`CWE formatting completed`, {
        resultLength: result.length,
        weaknessCount: data.Weaknesses.length,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: result,
          },
        ],
      };
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to query CWE: ${errorMessage}`,
          },
        ],
      };
    }
  }

  // Extract shared formatting logic to reduce code duplication
  private formatWeaknessDetails(weakness: CweWeakness): string {
    let result = `# CWE-${weakness.ID}: ${weakness.Name}\n\n`;

    if (weakness.Description) {
      result += `## Description\n${weakness.Description}\n\n`;
    }

    if (weakness.ExtendedDescription) {
      result += `## Extended Description\n${weakness.ExtendedDescription}\n\n`;
    }

    if (weakness.Abstraction) {
      result += `**Abstraction:** ${weakness.Abstraction}\n`;
    }

    if (weakness.Structure) {
      result += `**Structure:** ${weakness.Structure}\n`;
    }

    if (weakness.Status) {
      result += `**Status:** ${weakness.Status}\n`;
    }

    if (weakness.LikelihoodOfExploit) {
      result += `**Likelihood of Exploit:** ${weakness.LikelihoodOfExploit}\n`;
    }

    if (
      weakness.CommonConsequences &&
      weakness.CommonConsequences.length > 0
    ) {
      result += this.formatConsequences(weakness.CommonConsequences);
    }

    if (
      weakness.PotentialMitigations &&
      weakness.PotentialMitigations.length > 0
    ) {
      result += this.formatMitigations(weakness.PotentialMitigations);
    }

    if (weakness.RelatedWeaknesses && weakness.RelatedWeaknesses.length > 0) {
      result += this.formatRelatedWeaknesses(weakness.RelatedWeaknesses);
    }

    return result;
  }

  private formatWeakness(weakness: CweWeakness): string {
    // Simplified version for list display
    let result = `# CWE-${weakness.ID}: ${weakness.Name}\n\n`;

    if (weakness.Description) {
      result += `## Description\n${weakness.Description}\n\n`;
    }

    if (weakness.ExtendedDescription) {
      result += `## Extended Description\n${weakness.ExtendedDescription}\n\n`;
    }

    if (weakness.Abstraction) {
      result += `**Abstraction:** ${weakness.Abstraction}\n`;
    }

    if (weakness.Structure) {
      result += `**Structure:** ${weakness.Structure}\n`;
    }

    if (weakness.Status) {
      result += `**Status:** ${weakness.Status}\n`;
    }

    return result;
  }

  private formatWeaknessList(weaknesses: CweWeakness[]): string {
    let result = '';
    weaknesses.forEach((weakness: CweWeakness, index: number) => {
      if (index > 0) result += '\n---\n\n';
      result += this.formatWeakness(weakness);
    });
    return result;
  }

  private formatConsequences(consequences: CweConsequence[]): string {
    let result = `\n## Common Consequences\n`;
    consequences.forEach((consequence: CweConsequence, index: number) => {
      result += `${index + 1}. **Scope:** ${consequence.Scope?.join(', ') ?? 'N/A'}\n`;
      if (consequence.Impact) {
        result += `   **Impact:** ${consequence.Impact.join(', ')}\n`;
      }
      if (consequence.Note) {
        result += `   **Note:** ${consequence.Note}\n`;
      }
      result += '\n';
    });
    return result;
  }

  private formatMitigations(mitigations: CweMitigation[]): string {
    let result = `## Potential Mitigations\n`;
    mitigations.forEach((mitigation: CweMitigation, index: number) => {
      result += `${index + 1}. `;
      if (mitigation.Phase) {
        result += `**Phase:** ${mitigation.Phase.join(', ')}\n   `;
      }
      if (mitigation.Description) {
        result += `${mitigation.Description}\n`;
      }
      result += '\n';
    });
    return result;
  }

  private formatRelatedWeaknesses(related: CweRelatedWeakness[]): string {
    let result = `## Related Weaknesses\n`;
    related.forEach((weakness: CweRelatedWeakness) => {
      result += `- **${weakness.Nature}:** CWE-${weakness.CweID}\n`;
    });
    result += '\n';
    return result;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof NetworkError) {
      return `Network error: ${error.message}`;
    }
    if (error instanceof ApiError) {
      return `API error (${error.status}): ${error.message}`;
    }
    if (error instanceof ValidationError) {
      return `Validation error: ${error.message}`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unknown error occurred';
  }

  async getCweCategories(params: unknown): Promise<HandlerResponse> {
    const input = GetCweCategoriesSchema.parse(params);
    const categoryIds = input.ids
      .split(',')
      .map((id) => id.trim())
      .join(',');

    try {
      const url = `${this.baseUrl}/cwe/category/${categoryIds}`;
      const data = await this.fetchJson<CweCategoryResponse>(url);

      if (!data.Categories || data.Categories.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No CWE categories found for IDs: ${input.ids}`,
            },
          ],
        };
      }

      let result = '';
      data.Categories.forEach((category: CweCategory, index: number) => {
        if (index > 0) result += '\n---\n\n';
        result += `# CWE-${category.ID}: ${category.Name}\n\n`;

        if (category.Status) {
          result += `**Status:** ${category.Status}\n`;
        }

        if (category.Summary) {
          result += `\n## Summary\n${category.Summary}\n`;
        }

        if (category.Relationships && category.Relationships.length > 0) {
          result += `\n## Relationships\n`;
          category.Relationships.forEach((rel) => {
            result += `- CWE-${rel.CweID} (View ${rel.ViewID})\n`;
          });
        }
      });

      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to query CWE categories: ${errorMessage}`,
          },
        ],
      };
    }
  }

  async getCweViews(params: unknown): Promise<HandlerResponse> {
    const input = GetCweViewsSchema.parse(params);
    const viewIds = input.ids
      .split(',')
      .map((id) => id.trim())
      .join(',');

    try {
      const url = `${this.baseUrl}/cwe/view/${viewIds}`;
      const data = await this.fetchJson<CweViewResponse>(url);

      if (!data.Views || data.Views.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No CWE views found for IDs: ${input.ids}`,
            },
          ],
        };
      }

      let result = '';
      data.Views.forEach((view: CweView, index: number) => {
        if (index > 0) result += '\n---\n\n';
        result += `# CWE-${view.ID}: ${view.Name}\n\n`;

        if (view.Type) {
          result += `**Type:** ${view.Type}\n`;
        }

        if (view.Status) {
          result += `**Status:** ${view.Status}\n`;
        }

        if (view.Objective) {
          result += `\n## Objective\n${view.Objective}\n`;
        }

        if (view.Audience && view.Audience.length > 0) {
          result += `\n## Audience\n`;
          view.Audience.forEach((audience) => {
            result += `- **${audience.Type}:** ${audience.Description ?? 'N/A'}\n`;
          });
        }

        if (view.Members && view.Members.length > 0) {
          result += `\n## Members\n`;
          view.Members.forEach((member) => {
            result += `- CWE-${member.CweID} (View ${member.ViewID})\n`;
          });
        }
      });

      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to query CWE views: ${errorMessage}`,
          },
        ],
      };
    }
  }
}
