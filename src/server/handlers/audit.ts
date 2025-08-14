import { StorageManager } from '../storage/index.js';
import { AppError } from '../../types/index.js';
import { ResponseBuilder, HandlerResponse } from '../../types/handlers.js';
import {
  AddAuditTrailSchema,
  ListAuditTrailsSchema,
  GetAuditTrailSchema,
} from '../schemas.js';

export class AuditTrailHandler {
  private readonly storage: StorageManager;

  constructor(workingDir?: string) {
    this.storage = new StorageManager(workingDir);
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    void this.storage.cleanup();
  }

  async addAuditTrail(params: unknown): Promise<HandlerResponse> {
    try {
      const parsed = AddAuditTrailSchema.parse(params);
      const { projectName, ...input } = parsed;
      const entry = await this.storage.createAuditTrail(projectName, input);

      const details = this.buildAuditTrailDetails(entry);
      return ResponseBuilder.success(
        `Added audit trail: ${entry.id}\n${details}`
      );
    } catch (error) {
      if (error instanceof AppError) {
        return ResponseBuilder.error(
          `Failed to add audit trail: ${error.message}`
        );
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ResponseBuilder.error(`Failed to add audit trail: ${message}`);
    }
  }

  async listAuditTrails(params: unknown): Promise<HandlerResponse> {
    try {
      const parsed = ListAuditTrailsSchema.parse(params);
      const { projectName, limit, offset } = parsed;
      const options: { limit?: number; offset?: number } = {};
      if (limit !== undefined) options.limit = limit;
      if (offset !== undefined) options.offset = offset;
      const entries = await this.storage.listAuditTrails(projectName, options);

      if (entries.length === 0) {
        return ResponseBuilder.success(
          'No audit trail entries found. Use add-audit-trail to add your first entry.'
        );
      }

      const auditList = entries.map((entry) => {
        const toolsDisplay = entry.tools?.length
          ? ` [${entry.tools.join(', ')}]`
          : '';
        return `• ${entry.id}: ${entry.title}${toolsDisplay} - ${entry.created.toLocaleDateString()}`;
      });

      return ResponseBuilder.success(`Audit Trails:\n${auditList.join('\n')}`);
    } catch (error) {
      if (error instanceof AppError) {
        return ResponseBuilder.error(
          `Failed to list audit trails: ${error.message}`
        );
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ResponseBuilder.error(`Failed to list audit trails: ${message}`);
    }
  }

  async getAuditTrail(params: unknown): Promise<HandlerResponse> {
    try {
      const { projectName, id } = GetAuditTrailSchema.parse(params);
      const entry = await this.storage.getAuditTrail(projectName, id);

      const details = this.buildAuditTrailDetails(entry);
      return ResponseBuilder.success(`Audit Trail: ${entry.id}\n${details}`);
    } catch (error) {
      if (error instanceof AppError) {
        return ResponseBuilder.error(
          `Failed to get audit trail: ${error.message}`
        );
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ResponseBuilder.error(`Failed to get audit trail: ${message}`);
    }
  }

  /**
   * Helper method to build consistent audit trail details display
   */
  private buildAuditTrailDetails(entry: {
    title: string;
    description: string;
    tools?: string[] | undefined;
    created: Date;
  }): string {
    const details: string[] = [
      `Title: ${entry.title}`,
      `Description: ${entry.description}`,
      `Created: ${entry.created.toISOString()}`,
    ];

    if (entry.tools && entry.tools.length > 0) {
      details.splice(2, 0, `Tools: ${entry.tools.join(', ')}`);
    }

    return details.join('\n');
  }
}
