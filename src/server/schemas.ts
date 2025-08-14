import { z } from 'zod';
import { Severity, ToolNames } from '../types/enums.js';

// ============================================================================
// Base Schemas (Reusable Components)
// ============================================================================

// Common field definitions
const ProjectNameField = z.string().min(1).describe('Project name');
const FindingIdField = z
  .string()
  .min(1)
  .describe('Finding ID (e.g., VULN-001)');
const AuditIdField = z
  .string()
  .min(1)
  .describe('Audit trail ID (e.g., AUD-001)');

const SeverityField = z
  .enum([
    Severity.Critical,
    Severity.High,
    Severity.Medium,
    Severity.Low,
    Severity.Informative,
  ])
  .describe('Severity level');

// Base project fields schema with consistent naming
const BaseProjectFieldsSchema = z.object({
  client: z.string().min(1).max(200).optional().describe('Client name'),
  scope: z
    .array(z.string().min(1).max(500))
    .optional()
    .describe('URLs, domains, or systems in scope'),
  description: z
    .string()
    .min(1)
    .max(2000)
    .optional()
    .describe('Project description'),
});

// Base finding fields schema with consistent naming and validation
const BaseFindingFieldsSchema = z.object({
  title: z.string().min(1).max(200).describe('Finding title'),
  severity: SeverityField,
  cwe: z
    .string()
    .regex(/^(CWE-)?([1-9]|[1-9]\d{1,3})$/i)
    .optional()
    .describe('CWE identifier in format CWE-XXX or just number (1-9999)'),
  cvssString: z
    .string()
    .min(10)
    .max(200)
    .optional()
    .describe('CVSS vector string'),
  components: z
    .array(z.string().min(1).max(100))
    .max(50)
    .optional()
    .describe('Affected components'),
  description: z.string().min(1).max(5000).describe('Detailed description'),
  evidence: z
    .string()
    .min(1)
    .max(10000)
    .optional()
    .describe('Evidence or proof of concept'),
  recommendations: z
    .string()
    .min(1)
    .max(5000)
    .optional()
    .describe('Remediation recommendations'),
});

// Make finding fields optional for updates with consistent naming
const OptionalFindingFieldsSchema = BaseFindingFieldsSchema.partial().extend({
  title: z.string().min(1).max(200).optional().describe('Finding title'),
  description: z
    .string()
    .min(1)
    .max(5000)
    .optional()
    .describe('Detailed description'),
});

// ============================================================================
// Project Management Schemas
// ============================================================================

export const CreateProjectSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(100)
      .describe('Project name (will be sanitized)'),
  })
  .merge(BaseProjectFieldsSchema);

export const ListProjectsSchema = z.object({});

export const UpdateProjectSchema = z
  .object({
    projectName: ProjectNameField,
    status: z
      .enum(['in-progress', 'completed'])
      .optional()
      .describe('Project status'),
  })
  .merge(BaseProjectFieldsSchema);

export const DeleteProjectSchema = z.object({
  name: ProjectNameField.describe('Project name to delete'),
});

// ============================================================================
// Finding Management Schemas
// ============================================================================

export const CreateFindingSchema = z
  .object({
    projectName: ProjectNameField,
  })
  .merge(BaseFindingFieldsSchema);

export const ListFindingsSchema = z.object({
  projectName: ProjectNameField,
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe('Maximum number of findings to return (default: 100)'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Number of findings to skip (default: 0)'),
});

export const GetFindingSchema = z.object({
  projectName: ProjectNameField,
  id: FindingIdField,
});

export const UpdateFindingSchema = z
  .object({
    projectName: ProjectNameField,
    id: FindingIdField,
  })
  .merge(OptionalFindingFieldsSchema);

export const DeleteFindingSchema = z.object({
  projectName: ProjectNameField,
  id: FindingIdField.describe('Finding ID to delete'),
});

// ============================================================================
// Audit Trail Schemas
// ============================================================================

export const AddAuditTrailSchema = z.object({
  projectName: ProjectNameField,
  title: z.string().min(1).max(200).describe('Activity title'),
  description: z
    .string()
    .min(1)
    .max(5000)
    .describe('Detailed description of the activity'),
  tools: z
    .array(z.string().min(1).max(100))
    .max(20)
    .optional()
    .describe('Tools used'),
  methodology: z
    .string()
    .min(1)
    .max(2000)
    .optional()
    .describe('Testing methodology used'),
  results: z
    .string()
    .min(1)
    .max(5000)
    .optional()
    .describe('Test results and outcomes'),
  notes: z
    .string()
    .min(1)
    .max(2000)
    .optional()
    .describe('Additional notes and observations'),
});

export const ListAuditTrailsSchema = z.object({
  projectName: ProjectNameField,
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe('Maximum number of audit trails to return (default: 100)'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Number of audit trails to skip (default: 0)'),
});

export const GetAuditTrailSchema = z.object({
  projectName: ProjectNameField,
  id: AuditIdField,
});

// ============================================================================
// Executive Summary Schemas
// ============================================================================

export const SetExecutiveSummarySchema = z.object({
  projectName: z.string().min(1).max(100).describe('Project name'),
  content: z
    .string()
    .min(1)
    .max(10000)
    .describe('Executive summary content in Markdown format'),
});

export const GetExecutiveSummarySchema = z.object({
  projectName: z.string().min(1).max(100).describe('Project name'),
});

// ============================================================================
// CWE Query Schemas
// ============================================================================

export const GetCweSchema = z.object({
  ids: z
    .string()
    .min(1)
    .describe('CWE ID or comma-separated CWE IDs (e.g., "79" or "79,89")'),
});

export const GetCweCategoriesSchema = z.object({
  ids: z
    .string()
    .min(1)
    .describe(
      'Category IDs from the "Comprehensive Categorization for Software Assurance Trends". Valid examples: "1397,1398,1399". Use view ID 1400 to see all available categories.'
    ),
});

export const GetCweViewsSchema = z.object({
  ids: z
    .string()
    .min(1)
    .describe('View IDs (not CWE weakness IDs), e.g., "1000,1003"'),
});

// ============================================================================
// CVSS Validation Schema
// ============================================================================

export const ValidateCvssSchema = z.object({
  vector: z
    .string()
    .min(10)
    .max(200)
    .describe(
      'CVSS vector string (e.g., "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" or "AV:N/AC:L/Au:N/C:P/I:P/A:P" for CVSS 2.0)'
    ),
});

// ============================================================================
// Tool Registry
// ============================================================================

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  schema: z.ZodSchema;
  // Removed redundant inputSchema property - schema is sufficient
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // Project Management Tools
  {
    name: ToolNames.CREATE_PROJECT,
    title: 'Create Project',
    description:
      'Create a new security audit project. Cannot overwrite existing projects.',
    schema: CreateProjectSchema,
  },
  {
    name: ToolNames.LIST_PROJECTS,
    title: 'List Projects',
    description: 'List all security audit projects in the current directory',
    schema: ListProjectsSchema,
  },
  {
    name: ToolNames.UPDATE_PROJECT,
    title: 'Update Project',
    description: 'Update project metadata',
    schema: UpdateProjectSchema,
  },
  {
    name: ToolNames.DELETE_PROJECT,
    title: 'Delete Project',
    description: 'Permanently delete a project and all its data',
    schema: DeleteProjectSchema,
  },
  // Finding Management Tools
  {
    name: ToolNames.CREATE_FINDING,
    title: 'Create Finding',
    description: 'Add a new security finding to the current project',
    schema: CreateFindingSchema,
  },
  {
    name: ToolNames.LIST_FINDINGS,
    title: 'List Findings',
    description: 'List all findings in the current project',
    schema: ListFindingsSchema,
  },
  {
    name: ToolNames.GET_FINDING,
    title: 'Get Finding',
    description: 'Get detailed information about a specific finding',
    schema: GetFindingSchema,
  },
  {
    name: ToolNames.UPDATE_FINDING,
    title: 'Update Finding',
    description: 'Update an existing finding',
    schema: UpdateFindingSchema,
  },
  {
    name: ToolNames.DELETE_FINDING,
    title: 'Delete Finding',
    description: 'Delete a finding from the current project',
    schema: DeleteFindingSchema,
  },
  // Audit Trail Tools
  {
    name: ToolNames.ADD_AUDIT_TRAIL,
    title: 'Add Audit Trail',
    description: 'Add a new audit trail entry to document testing activities',
    schema: AddAuditTrailSchema,
  },
  {
    name: ToolNames.LIST_AUDIT_TRAILS,
    title: 'List Audit Trails',
    description: 'List all audit trail entries in the current project',
    schema: ListAuditTrailsSchema,
  },
  {
    name: ToolNames.GET_AUDIT_TRAIL,
    title: 'Get Audit Trail',
    description: 'Get detailed information about a specific audit trail entry',
    schema: GetAuditTrailSchema,
  },
  // Executive Summary Tools
  {
    name: ToolNames.SET_EXECUTIVE_SUMMARY,
    title: 'Set Executive Summary',
    description: 'Set or update the executive summary for the current project',
    schema: SetExecutiveSummarySchema,
  },
  {
    name: ToolNames.GET_EXECUTIVE_SUMMARY,
    title: 'Get Executive Summary',
    description: 'Get the executive summary for the current project',
    schema: GetExecutiveSummarySchema,
  },
  // CWE Query Tools
  {
    name: ToolNames.GET_CWE_ID,
    title: 'Get CWE',
    description:
      'Get detailed information about CWE weakness(es) by ID(s) - supports single or comma-separated IDs',
    schema: GetCweSchema,
  },
  {
    name: ToolNames.GET_CWE_CATEGORIES,
    title: 'Get CWE Categories',
    description:
      'Get information about CWE categories by IDs (comma-separated). Works with "Comprehensive Categorization for Software Assurance Trends" categories. Query view CWE-1400 to see all available categories.',
    schema: GetCweCategoriesSchema,
  },
  {
    name: ToolNames.GET_CWE_VIEWS,
    title: 'Get CWE Views',
    description: 'Get information about CWE views by IDs (comma-separated)',
    schema: GetCweViewsSchema,
  },
  // CVSS Validation Tool
  {
    name: ToolNames.VALIDATE_CVSS,
    title: 'Validate CVSS',
    description:
      'Validate a CVSS vector string and return JSON with valid, score, and severity. Supports CVSS 2.0, 3.0, 3.1, and 4.0.',
    schema: ValidateCvssSchema,
  },
];

// ============================================================================
// Type Exports
// ============================================================================

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type ListProjectsInput = z.infer<typeof ListProjectsSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
export type DeleteProjectInput = z.infer<typeof DeleteProjectSchema>;
export type CreateFindingInput = z.infer<typeof CreateFindingSchema>;
export type ListFindingsInput = z.infer<typeof ListFindingsSchema>;
export type GetFindingInput = z.infer<typeof GetFindingSchema>;
export type UpdateFindingInput = z.infer<typeof UpdateFindingSchema>;
export type DeleteFindingInput = z.infer<typeof DeleteFindingSchema>;

export type AddAuditTrailInput = z.infer<typeof AddAuditTrailSchema>;
export type ListAuditTrailsInput = z.infer<typeof ListAuditTrailsSchema>;
export type GetAuditTrailInput = z.infer<typeof GetAuditTrailSchema>;

export type SetExecutiveSummaryInput = z.infer<
  typeof SetExecutiveSummarySchema
>;
export type GetExecutiveSummaryInput = z.infer<
  typeof GetExecutiveSummarySchema
>;

export type GetCweInput = z.infer<typeof GetCweSchema>;
export type GetCweCategoriesInput = z.infer<typeof GetCweCategoriesSchema>;
export type GetCweViewsInput = z.infer<typeof GetCweViewsSchema>;

export type ValidateCvssInput = z.infer<typeof ValidateCvssSchema>;

// ============================================================================
// JSON-RPC 2.0 Validation Schemas
// ============================================================================

// Define specific parameter schemas for better type safety
const JsonRpcParamsSchema = z
  .union([
    z.record(z.string(), z.unknown()), // Structured object parameters with string keys
    z.array(z.unknown()).max(100), // Limit array size to prevent DoS
    z.null(),
    z.undefined(),
  ])
  .optional();

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0').describe('JSON-RPC version'),
  method: z.string().min(1).max(100).describe('Method name'), // Add reasonable length limit
  params: JsonRpcParamsSchema.describe(
    'Method parameters with structured validation'
  ),
  id: z
    .union([z.string().max(255), z.number(), z.null()])
    .describe('Request identifier'),
});

export const JsonRpcBatchRequestSchema = z.array(JsonRpcRequestSchema).min(1);

export const JsonRpcRequestOrBatchSchema = z.union([
  JsonRpcRequestSchema,
  JsonRpcBatchRequestSchema,
]);

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;
export type JsonRpcBatchRequest = z.infer<typeof JsonRpcBatchRequestSchema>;
export type JsonRpcRequestOrBatch = z.infer<
  typeof JsonRpcRequestOrBatchSchema
>;
