import { StorageManager } from '../storage/index.js';
import { ResponseBuilder, HandlerResponse } from '../../types/handlers.js';
import { ErrorHandler } from '../utils/errorHandling.js';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  DeleteProjectSchema,
} from '../schemas.js';

export class ProjectHandler {
  private storage: StorageManager;

  constructor(workingDir?: string) {
    this.storage = new StorageManager(workingDir);
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    void this.storage.cleanup();
  }

  async createProject(params: unknown): Promise<HandlerResponse> {
    let projectName = '';
    try {
      const input = CreateProjectSchema.parse(params);
      projectName = input.name;
      const project = await this.storage.createProject(input);

      const details = [
        `Created project: ${project.name}`,
        `ID: ${project.id}`,
        `Status: ${project.status}`,
        `Created: ${project.created.toISOString()}`,
      ].join('\n');

      return ResponseBuilder.success(details);
    } catch (error) {
      const context = { projectName };
      ErrorHandler.logError(error, 'create project', context);
      return ErrorHandler.handleError(error, 'create project', context);
    }
  }

  async listProjects(): Promise<HandlerResponse> {
    try {
      const projects = await this.storage.listProjects();

      if (projects.length === 0) {
        return ResponseBuilder.success(
          'No projects found. Use create-project to create your first project.'
        );
      }

      const projectList = projects.map(
        (p) =>
          `• ${p.name} (${p.status}) - ${p.client ?? 'No client'} - Updated: ${p.updated.toLocaleDateString()}`
      );

      return ResponseBuilder.success(`Projects:\n${projectList.join('\n')}`);
    } catch (error) {
      ErrorHandler.logError(error, 'list projects');
      return ErrorHandler.handleError(error, 'list projects');
    }
  }

  async updateProject(params: unknown): Promise<HandlerResponse> {
    let projectName = '';
    try {
      const parsed = UpdateProjectSchema.parse(params);
      const { projectName: parsedProjectName, ...updates } = parsed;
      projectName = parsedProjectName;
      const project = await this.storage.updateProject(projectName, updates);

      const details = [
        `Updated project: ${project.name}`,
        `Status: ${project.status}`,
        `Last updated: ${project.updated.toISOString()}`,
      ].join('\n');

      return ResponseBuilder.success(details);
    } catch (error) {
      const context = { projectName };
      ErrorHandler.logError(error, 'update project', context);
      return ErrorHandler.handleError(error, 'update project', context);
    }
  }

  async deleteProject(params: unknown): Promise<HandlerResponse> {
    let projectName = '';
    try {
      const input = DeleteProjectSchema.parse(params);
      projectName = input.name;
      await this.storage.deleteProject(input.name);

      return ResponseBuilder.success(`Deleted project: ${input.name}`);
    } catch (error) {
      const context = { projectName };
      ErrorHandler.logError(error, 'delete project', context);
      return ErrorHandler.handleError(error, 'delete project', context);
    }
  }
}
