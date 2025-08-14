import { Severity, ProjectStatus } from './enums.js';
export { Severity, ProjectStatus } from './enums.js';

export interface ProjectMetadata {
  readonly id: string;
  readonly name: string;
  readonly client?: string | undefined;
  readonly created: Date;
  readonly updated: Date;
  readonly scope?: readonly string[] | undefined;
  readonly status: ProjectStatus;
  readonly description?: string | undefined;
}

export interface ProjectIndex {
  projects: Record<string, ProjectMetadata>;
  lastActive?: string | undefined;
}

export interface SessionState {
  activeProject?: string | undefined;
  workingDirectory: string;
}

export interface FindingInput {
  title: string;
  severity: Severity;
  cwe?: string | undefined;
  cvssString?: string | undefined;
  components?: string[] | undefined;
  description: string;
  evidence?: string | undefined;
  recommendations?: string | undefined;
}

export interface Finding extends FindingInput {
  id: string;
  cvssScore?: number | undefined;
  created: Date;
  updated: Date;
}

export interface AuditTrailEntry {
  id: string;
  title: string;
  description: string;
  created: Date;
  tools?: string[] | undefined;
  methodology?: string | undefined;
  results?: string | undefined;
  notes?: string | undefined;
}

export interface AuditTrailInput {
  title: string;
  description: string;
  tools?: string[] | undefined;
  methodology?: string | undefined;
  results?: string | undefined;
  notes?: string | undefined;
}

export interface ProjectExport {
  metadata: ProjectMetadata;
  findings: Finding[];
  auditTrails: AuditTrailEntry[];
  exportedAt: Date;
}

export interface ThemeConfig {
  $schema?: string | undefined;
  defs?: Record<string, string> | undefined;
  theme: {
    primary: string;
    secondary: string;
    accent: string;
    error: string;
    warning: string;
    success: string;
    info: string;
    text: string;
    textMuted: string;
    background: string;
    backgroundPanel: string;
    backgroundElement: string;
    border: string;
    borderActive: string;
    borderSubtle: string;
    [key: string]: string;
  };
}

export interface CreateProjectInput {
  name: string;
  client?: string | undefined;
  scope?: string[] | undefined;
  description?: string | undefined;
}

export interface UpdateProjectInput {
  client?: string | undefined;
  scope?: string[] | undefined;
  description?: string | undefined;
  status?: ProjectStatus | undefined;
}

/**
 * Base error class for all application errors
 */
export abstract class AppError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;

    // Maintain proper stack trace for where our error was thrown (V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when input validation fails
 */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(`Validation error: ${message}`);
  }
}

export class ProjectExistsError extends AppError {
  readonly code = 'PROJECT_EXISTS';

  constructor(projectName: string) {
    super(
      `Project "${projectName}" already exists. Cannot overwrite existing projects.`
    );
  }
}

export class ProjectNotFoundError extends AppError {
  readonly code = 'PROJECT_NOT_FOUND';

  constructor(projectName: string) {
    super(`Project "${projectName}" not found.`);
  }
}

export class NoActiveProjectError extends AppError {
  readonly code = 'NO_ACTIVE_PROJECT';

  constructor() {
    super('No active project. Please open or create a project first.');
  }
}

export class FindingNotFoundError extends AppError {
  readonly code = 'FINDING_NOT_FOUND';

  constructor(findingId: string) {
    super(`Finding "${findingId}" not found.`);
  }
}

export class AuditTrailNotFoundError extends AppError {
  readonly code = 'AUDIT_TRAIL_NOT_FOUND';

  constructor(auditId: string) {
    super(`Audit trail entry "${auditId}" not found.`);
  }
}

export class ProjectCompletedError extends AppError {
  readonly code = 'PROJECT_COMPLETED';

  constructor(projectName: string, operation: string) {
    super(
      `Cannot ${operation} on completed project "${projectName}". ` +
        `Completed projects are immutable for audit integrity.`
    );
  }
}
