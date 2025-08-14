/**
 * Constants and types for consistent type safety across the application
 * Using const assertions instead of enums for better tree-shaking and type safety
 */

/* eslint-disable no-redeclare */

export const Severity = {
  Critical: 'Critical',
  High: 'High',
  Medium: 'Medium',
  Low: 'Low',
  Informative: 'Informative',
} as const;

export type Severity = (typeof Severity)[keyof typeof Severity];

export const ProjectStatus = {
  InProgress: 'in-progress',
  Completed: 'completed',
} as const;

export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const HttpMethod = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE',
  PATCH: 'PATCH',
  OPTIONS: 'OPTIONS',
} as const;

export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod];

export const HttpStatusCode = {
  OK: 200,
  Created: 201,
  NoContent: 204,
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  MethodNotAllowed: 405,
  InternalServerError: 500,
  ServiceUnavailable: 503,
} as const;

export type HttpStatusCode =
  (typeof HttpStatusCode)[keyof typeof HttpStatusCode];

export const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

export type JsonRpcErrorCode =
  (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode];

export const ContentType = {
  Text: 'text',
  Image: 'image',
  Audio: 'audio',
  Video: 'video',
  Resource: 'resource',
} as const;

export type ContentType = (typeof ContentType)[keyof typeof ContentType];

/**
 * CVSS version constants
 */
export const CvssVersion = {
  V2_0: '2.0',
  V3_0: '3.0',
  V3_1: '3.1',
  V4_0: '4.0',
} as const;

export type CvssVersion = (typeof CvssVersion)[keyof typeof CvssVersion];

/**
 * Tool names for consistent reference
 */
export const ToolNames = {
  // Project Management
  CREATE_PROJECT: 'create-project',
  LIST_PROJECTS: 'list-projects',
  UPDATE_PROJECT: 'update-project',
  DELETE_PROJECT: 'delete-project',

  // Finding Management
  CREATE_FINDING: 'create-finding',
  LIST_FINDINGS: 'list-findings',
  GET_FINDING: 'get-finding',
  UPDATE_FINDING: 'update-finding',
  DELETE_FINDING: 'delete-finding',

  // Audit Trail
  ADD_AUDIT_TRAIL: 'add-audit-trail',
  LIST_AUDIT_TRAILS: 'list-audit-trails',
  GET_AUDIT_TRAIL: 'get-audit-trail',

  // Executive Summary
  SET_EXECUTIVE_SUMMARY: 'set-executive-summary',
  GET_EXECUTIVE_SUMMARY: 'get-executive-summary',

  // CWE
  GET_CWE_ID: 'get-cwe-id',
  GET_CWE_CATEGORIES: 'get-cwe-categories',
  GET_CWE_VIEWS: 'get-cwe-views',

  // CVSS
  VALIDATE_CVSS: 'validate-cvss',
} as const;

export type ToolName = (typeof ToolNames)[keyof typeof ToolNames];
