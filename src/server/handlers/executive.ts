import fs from 'fs/promises';
import path from 'path';
import { sanitizeProjectName } from '../../utils/validation.js';
import { ResponseBuilder, HandlerResponse } from '../../types/handlers.js';
import { StorageManager } from '../storage/index.js';
import { ProjectCompletedError } from '../../types/index.js';
import {
  SetExecutiveSummarySchema,
  GetExecutiveSummarySchema,
} from '../schemas.js';

export class ExecutiveSummaryHandler {
  private readonly workingDir: string;
  private readonly storage: StorageManager;

  constructor(workingDir?: string) {
    this.workingDir = path.resolve(workingDir ?? process.cwd());
    this.storage = new StorageManager(this.workingDir);
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    void this.storage.cleanup();
  }

  async setExecutiveSummary(params: unknown): Promise<HandlerResponse> {
    try {
      const { projectName, content } = SetExecutiveSummarySchema.parse(params);

      // Check if project exists and is not completed
      const project = await this.storage.getProject(projectName);
      if (project.status === 'completed') {
        throw new ProjectCompletedError(
          projectName,
          'update executive summary'
        );
      }

      const projectPath = this.getProjectPath(projectName);
      const summaryPath = path.join(projectPath, 'executive-summary.md');

      // Ensure project directory exists
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.mkdir(projectPath, { recursive: true });

      // Write executive summary
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await fs.writeFile(summaryPath, content, 'utf8');

      return ResponseBuilder.success(
        `Executive summary updated for project: ${projectName}\nPath: ${summaryPath}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ResponseBuilder.error(
        `Failed to set executive summary: ${message}`
      );
    }
  }

  async getExecutiveSummary(params: unknown): Promise<HandlerResponse> {
    try {
      const { projectName } = GetExecutiveSummarySchema.parse(params);
      const projectPath = this.getProjectPath(projectName);
      const summaryPath = path.join(projectPath, 'executive-summary.md');

      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const content = await fs.readFile(summaryPath, 'utf8');
        return ResponseBuilder.success(
          `Executive Summary for ${projectName}:\n\n${content}`
        );
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
          return ResponseBuilder.success(
            `No executive summary found for project: ${projectName}. Use set-executive-summary to create one.`
          );
        }
        throw readError;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ResponseBuilder.error(
        `Failed to get executive summary: ${message}`
      );
    }
  }

  /**
   * Get the project path with validation
   */
  private getProjectPath(projectName: string): string {
    const sanitized = sanitizeProjectName(projectName);
    const projectPath = path.join(this.workingDir, sanitized);

    // Basic validation that the project path is within working directory
    if (!projectPath.startsWith(this.workingDir)) {
      throw new Error(`Invalid project path: ${projectName}`);
    }

    return projectPath;
  }
}
