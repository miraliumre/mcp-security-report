import { ProjectHandler } from '../server/handlers/project.js';
import { FindingHandler } from '../server/handlers/finding.js';
import { AuditTrailHandler } from '../server/handlers/audit.js';
import { ExecutiveSummaryHandler } from '../server/handlers/executive.js';
import { CweHandler } from '../server/handlers/cwe.js';
import { CvssHandler } from '../server/handlers/cvss.js';
import { StorageManager } from '../server/storage/index.js';
import { output } from '../utils/output.js';
import { emergencyWarn } from '../utils/emergencyLog.js';

/**
 * CLI handlers implementing all MCP server operations for UNIX-style command line tool
 */
export class CliHandlers {
  private readonly projectHandler: ProjectHandler;
  private readonly findingHandler: FindingHandler;
  private readonly auditHandler: AuditTrailHandler;
  private readonly executiveHandler: ExecutiveSummaryHandler;
  private readonly cweHandler: CweHandler;
  private readonly cvssHandler: CvssHandler;
  private readonly storageManager: StorageManager;
  private instanceLockAcquired = false;

  constructor(projectDir: string) {
    this.storageManager = new StorageManager(projectDir);
    this.projectHandler = new ProjectHandler(projectDir);
    this.findingHandler = new FindingHandler(projectDir);
    this.auditHandler = new AuditTrailHandler(projectDir);
    this.executiveHandler = new ExecutiveSummaryHandler(projectDir);
    this.cweHandler = new CweHandler();
    this.cvssHandler = new CvssHandler();
  }

  /**
   * Acquire instance lock for this working directory
   */
  async acquireInstanceLock(): Promise<void> {
    if (!this.instanceLockAcquired) {
      await this.storageManager.acquireInstanceLock();
      this.instanceLockAcquired = true;
    }
  }

  /**
   * Cleanup method to clear any cached data and release resources
   */
  async cleanup(): Promise<void> {
    // Clear any caches or resources held by handlers
    try {
      // Release instance lock first
      await this.storageManager.cleanup();
      this.instanceLockAcquired = false;

      // If handlers have cleanup methods, call them
      const handlers = [
        this.projectHandler,
        this.findingHandler,
        this.auditHandler,
        this.executiveHandler,
        this.cweHandler,
        this.cvssHandler,
      ];

      for (const handler of handlers) {
        const handlerWithCleanup = handler as { cleanup?: () => void };
        if (typeof handlerWithCleanup.cleanup === 'function') {
          handlerWithCleanup.cleanup();
        }
      }
    } catch (error) {
      // Log cleanup errors but don't throw to avoid cascading failures
      emergencyWarn('Error during handler cleanup', error);
    }
  }

  // Helper to safely get text from response
  private getResponseText(response: {
    content?: Array<{ text: string }>;
  }): string {
    if (
      response.content &&
      response.content.length > 0 &&
      response.content[0]
    ) {
      return response.content[0].text;
    }
    return JSON.stringify(response, null, 2);
  }

  // Project operations
  async createProject(options: {
    projectName: string;
    client?: string;
    scope?: string[];
    description?: string;
    projectDir: string;
  }): Promise<void> {
    const result = await this.projectHandler.createProject({
      name: options.projectName,
      client: options.client,
      scope: options.scope,
      description: options.description,
    });
    output.writeLine(this.getResponseText(result));
  }

  async listProjects(): Promise<void> {
    const result = await this.projectHandler.listProjects();
    output.writeLine(this.getResponseText(result));
  }

  async updateProject(options: {
    projectName: string;
    client?: string;
    scope?: string[];
    description?: string;
    status?: 'in-progress' | 'completed';
  }): Promise<void> {
    const result = await this.projectHandler.updateProject({
      projectName: options.projectName,
      client: options.client,
      scope: options.scope,
      description: options.description,
      status: options.status,
    });
    output.writeLine(this.getResponseText(result));
  }

  // Finding operations
  async createFinding(options: {
    projectName: string;
    title: string;
    severity: string;
    description: string;
    cwe?: string;
    cvssString?: string;
    components?: string[];
    evidence?: string;
    recommendations?: string;
  }): Promise<void> {
    const result = await this.findingHandler.createFinding({
      projectName: options.projectName,
      title: options.title,
      severity: options.severity,
      description: options.description,
      cwe: options.cwe,
      cvssString: options.cvssString,
      components: options.components,
      evidence: options.evidence,
      recommendations: options.recommendations,
    });
    output.writeLine(this.getResponseText(result));
  }

  async listFindings(
    projectName: string,
    options?: { limit?: number; offset?: number }
  ): Promise<void> {
    const params: { projectName: string; limit?: number; offset?: number } = {
      projectName,
    };
    if (options?.limit !== undefined) params.limit = options.limit;
    if (options?.offset !== undefined) params.offset = options.offset;
    const result = await this.findingHandler.listFindings(params);
    output.writeLine(this.getResponseText(result));
  }

  async getFinding(projectName: string, id: string): Promise<void> {
    const result = await this.findingHandler.getFinding({ projectName, id });
    output.writeLine(this.getResponseText(result));
  }

  async updateFinding(options: {
    projectName: string;
    id: string;
    title?: string;
    severity?: string;
    description?: string;
    cwe?: string;
    cvssString?: string;
    components?: string[];
    evidence?: string;
    recommendations?: string;
  }): Promise<void> {
    const result = await this.findingHandler.updateFinding({
      projectName: options.projectName,
      id: options.id,
      title: options.title,
      severity: options.severity,
      description: options.description,
      cwe: options.cwe,
      cvssString: options.cvssString,
      components: options.components,
      evidence: options.evidence,
      recommendations: options.recommendations,
    });
    output.writeLine(this.getResponseText(result));
  }

  async deleteFinding(projectName: string, id: string): Promise<void> {
    const result = await this.findingHandler.deleteFinding({
      projectName,
      id,
    });
    output.writeLine(this.getResponseText(result));
  }

  // Audit trail operations
  async createAuditTrail(options: {
    projectName: string;
    title: string;
    description: string;
    methodology?: string;
    tools?: string[];
    results?: string;
    notes?: string;
  }): Promise<void> {
    const result = await this.auditHandler.addAuditTrail({
      projectName: options.projectName,
      title: options.title,
      description: options.description,
      methodology: options.methodology,
      tools: options.tools,
      results: options.results,
      notes: options.notes,
    });
    output.writeLine(this.getResponseText(result));
  }

  async listAuditTrails(
    projectName: string,
    options?: { limit?: number; offset?: number }
  ): Promise<void> {
    const params: { projectName: string; limit?: number; offset?: number } = {
      projectName,
    };
    if (options?.limit !== undefined) params.limit = options.limit;
    if (options?.offset !== undefined) params.offset = options.offset;
    const result = await this.auditHandler.listAuditTrails(params);
    output.writeLine(this.getResponseText(result));
  }

  async getAuditTrail(projectName: string, id: string): Promise<void> {
    const result = await this.auditHandler.getAuditTrail({ projectName, id });
    output.writeLine(this.getResponseText(result));
  }

  // Executive summary operations
  async setExecutiveSummary(options: {
    projectName: string;
    overview?: string;
    keyFindings?: string;
    recommendations?: string;
    riskAssessment?: string;
  }): Promise<void> {
    // Build content from individual sections
    const sections: string[] = [];

    if (options.overview) {
      sections.push(`## Executive Overview\n\n${options.overview}`);
    }

    if (options.keyFindings) {
      sections.push(`## Key Findings\n\n${options.keyFindings}`);
    }

    if (options.recommendations) {
      sections.push(`## Recommendations\n\n${options.recommendations}`);
    }

    if (options.riskAssessment) {
      sections.push(`## Risk Assessment\n\n${options.riskAssessment}`);
    }

    if (sections.length === 0) {
      throw new Error(
        'At least one section (overview, key-findings, recommendations, or risk-assessment) must be provided'
      );
    }

    const content = sections.join('\n\n');

    const result = await this.executiveHandler.setExecutiveSummary({
      projectName: options.projectName,
      content,
    });
    output.writeLine(this.getResponseText(result));
  }

  async getExecutiveSummary(projectName: string): Promise<void> {
    const result = await this.executiveHandler.getExecutiveSummary({
      projectName,
    });
    output.writeLine(this.getResponseText(result));
  }

  // CWE operations
  async getCweWeakness(id: string): Promise<void> {
    // Validate that ID looks like a CWE ID (number or CWE-number format)
    const cweIdPattern = /^(?:CWE-)?(\d+)$/i;
    if (!cweIdPattern.test(id.trim())) {
      throw new Error(
        `Invalid CWE ID format: ${id}. Use format like "79" or "CWE-79"`
      );
    }

    const result = await this.cweHandler.getCwe({ ids: id });
    output.writeLine(this.getResponseText(result));
  }

  async getRelatedCwes(ids: string, view?: string): Promise<void> {
    const result = await this.cweHandler.getCwe({ ids, view });
    output.writeLine(this.getResponseText(result));
  }

  // CVSS operations
  validateCvss(vector: string): void {
    const result = this.cvssHandler.validateCvss({ vector });
    output.writeLine(this.getResponseText(result));
  }

  calculateCvss(vector: string): void {
    const result = this.cvssHandler.calculateCvss({ vector });
    output.writeLine(this.getResponseText(result));
  }
}
