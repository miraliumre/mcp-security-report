import { StorageManager } from '../storage/index.js';
import { FindingInput } from '../../types/index.js';
import { ResponseBuilder, HandlerResponse } from '../../types/handlers.js';
import { formatCVSSDisplay } from '../../utils/cvss.js';
import { ErrorHandler } from '../utils/errorHandling.js';
import {
  CreateFindingSchema,
  UpdateFindingSchema,
  ListFindingsSchema,
  GetFindingSchema,
  DeleteFindingSchema,
} from '../schemas.js';

export class FindingHandler {
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

  async createFinding(params: unknown): Promise<HandlerResponse> {
    let projectName = '';
    try {
      const parsed = CreateFindingSchema.parse(params);
      const { projectName: parsedProjectName, ...inputData } = parsed;
      projectName = parsedProjectName;

      // Construct FindingInput with proper type safety
      const input: FindingInput = {
        title: inputData.title,
        severity: inputData.severity,
        description: inputData.description,
        cwe: inputData.cwe,
        cvssString: inputData.cvssString,
        components: inputData.components,
        evidence: inputData.evidence,
        recommendations: inputData.recommendations,
      };

      const finding = await this.storage.createFinding(projectName, input);

      const details = this.buildFindingDetails(finding);
      return ResponseBuilder.success(
        `Created finding: ${finding.id}\n${details}`
      );
    } catch (error) {
      const context = { projectName };
      ErrorHandler.logError(error, 'create finding', context);
      return ErrorHandler.handleError(error, 'create finding', context);
    }
  }

  async listFindings(params: unknown): Promise<HandlerResponse> {
    let projectName = '';
    try {
      const parsed = ListFindingsSchema.parse(params);
      projectName = parsed.projectName;
      const { limit, offset } = parsed;
      const options: { limit?: number; offset?: number } = {};
      if (limit !== undefined) options.limit = limit;
      if (offset !== undefined) options.offset = offset;
      const findings = await this.storage.listFindings(projectName, options);

      if (findings.length === 0) {
        return ResponseBuilder.success(
          'No findings found. Use create-finding to add your first finding.'
        );
      }

      const findingsList = findings.map((finding) => {
        const cvssDisplay = finding.cvssScore
          ? ` (CVSS: ${finding.cvssScore.toFixed(1)})`
          : '';
        const cweDisplay = finding.cwe ? ` [${finding.cwe}]` : '';
        return `• ${finding.id}: ${finding.title} - ${finding.severity}${cvssDisplay}${cweDisplay}`;
      });

      return ResponseBuilder.success(`Findings:\n${findingsList.join('\n')}`);
    } catch (error) {
      const context = { projectName };
      ErrorHandler.logError(error, 'list findings', context);
      return ErrorHandler.handleError(error, 'list findings', context);
    }
  }

  async getFinding(params: unknown): Promise<HandlerResponse> {
    let projectName = '';
    let id = '';
    try {
      const parsed = GetFindingSchema.parse(params);
      projectName = parsed.projectName;
      id = parsed.id;
      const finding = await this.storage.getFinding(projectName, id);

      const details = this.buildFindingDetails(finding);
      return ResponseBuilder.success(`Finding: ${finding.id}\n${details}`);
    } catch (error) {
      const context = { projectName, findingId: id };
      ErrorHandler.logError(error, 'get finding', context);
      return ErrorHandler.handleError(error, 'get finding', context);
    }
  }

  async updateFinding(params: unknown): Promise<HandlerResponse> {
    let projectName = '';
    let id = '';
    try {
      const parsed = UpdateFindingSchema.parse(params);
      const {
        projectName: parsedProjectName,
        id: parsedId,
        ...updates
      } = parsed;
      projectName = parsedProjectName;
      id = parsedId;
      // Remove undefined values from updates
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([, value]) => value !== undefined)
      ) as Partial<FindingInput>;
      const finding = await this.storage.updateFinding(
        projectName,
        id,
        cleanUpdates
      );

      const details = this.buildFindingDetails(finding);
      return ResponseBuilder.success(
        `Updated finding: ${finding.id}\n${details}`
      );
    } catch (error) {
      const context = { projectName, findingId: id };
      ErrorHandler.logError(error, 'update finding', context);
      return ErrorHandler.handleError(error, 'update finding', context);
    }
  }

  async deleteFinding(params: unknown): Promise<HandlerResponse> {
    let projectName = '';
    let id = '';
    try {
      const parsed = DeleteFindingSchema.parse(params);
      projectName = parsed.projectName;
      id = parsed.id;
      await this.storage.deleteFinding(projectName, id);

      return ResponseBuilder.success(`Deleted finding: ${id}`);
    } catch (error) {
      const context = { projectName, findingId: id };
      ErrorHandler.logError(error, 'delete finding', context);
      return ErrorHandler.handleError(error, 'delete finding', context);
    }
  }

  /**
   * Helper method to build consistent finding details display
   */
  private buildFindingDetails(finding: {
    title: string;
    severity: string;
    cvssScore?: number | undefined;
    cvssString?: string | undefined;
    cwe?: string | undefined;
    components?: string[] | undefined;
    description: string;
    evidence?: string | undefined;
    recommendations?: string | undefined;
    created: Date;
    updated: Date;
  }): string {
    const details: string[] = [
      `Title: ${finding.title}`,
      `Severity: ${finding.severity}`,
    ];

    if (finding.cvssScore && finding.cvssString) {
      details.push(`CVSS: ${formatCVSSDisplay(finding.cvssString)}`);
    }

    if (finding.cwe) {
      details.push(`CWE: ${finding.cwe}`);
    }

    if (finding.components && finding.components.length > 0) {
      details.push(`Components: ${finding.components.join(', ')}`);
    }

    details.push(
      `Description: ${finding.description}`,
      `Created: ${finding.created.toISOString()}`,
      `Updated: ${finding.updated.toISOString()}`
    );

    if (finding.evidence) {
      details.push(`\nEvidence:\n${finding.evidence}`);
    }

    if (finding.recommendations) {
      details.push(`\nRecommendations:\n${finding.recommendations}`);
    }

    return details.join('\n');
  }
}
