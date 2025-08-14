import { ProjectHandler } from '../handlers/project.js';
import { FindingHandler } from '../handlers/finding.js';
import { AuditTrailHandler } from '../handlers/audit.js';
import { ExecutiveSummaryHandler } from '../handlers/executive.js';
import { CweHandler } from '../handlers/cwe.js';
import { CvssHandler } from '../handlers/cvss.js';
import { HandlerFunction, HandlerResponse } from '../../types/handlers.js';
import { ToolNames } from '../../types/enums.js';

export interface HandlerMap {
  readonly projectHandler: ProjectHandler;
  readonly findingHandler: FindingHandler;
  readonly auditHandler: AuditTrailHandler;
  readonly executiveHandler: ExecutiveSummaryHandler;
  readonly cweHandler: CweHandler;
  readonly cvssHandler: CvssHandler;
}

/**
 * Configuration for mapping tools to their handlers
 */
interface ToolConfig {
  readonly handlerKey: keyof HandlerMap;
  readonly methodName: string;
  readonly isAsync?: boolean;
}

/**
 * Centralized tool-to-handler mapping configuration
 * This eliminates the need for large switch statements
 */
const TOOL_HANDLER_CONFIG: Record<string, ToolConfig> = {
  // Project Management
  [ToolNames.CREATE_PROJECT]: {
    handlerKey: 'projectHandler',
    methodName: 'createProject',
  },
  [ToolNames.LIST_PROJECTS]: {
    handlerKey: 'projectHandler',
    methodName: 'listProjects',
  },
  [ToolNames.UPDATE_PROJECT]: {
    handlerKey: 'projectHandler',
    methodName: 'updateProject',
  },
  [ToolNames.DELETE_PROJECT]: {
    handlerKey: 'projectHandler',
    methodName: 'deleteProject',
  },

  // Finding Management
  [ToolNames.CREATE_FINDING]: {
    handlerKey: 'findingHandler',
    methodName: 'createFinding',
  },
  [ToolNames.LIST_FINDINGS]: {
    handlerKey: 'findingHandler',
    methodName: 'listFindings',
  },
  [ToolNames.GET_FINDING]: {
    handlerKey: 'findingHandler',
    methodName: 'getFinding',
  },
  [ToolNames.UPDATE_FINDING]: {
    handlerKey: 'findingHandler',
    methodName: 'updateFinding',
  },
  [ToolNames.DELETE_FINDING]: {
    handlerKey: 'findingHandler',
    methodName: 'deleteFinding',
  },

  // Audit Trail
  [ToolNames.ADD_AUDIT_TRAIL]: {
    handlerKey: 'auditHandler',
    methodName: 'addAuditTrail',
  },
  [ToolNames.LIST_AUDIT_TRAILS]: {
    handlerKey: 'auditHandler',
    methodName: 'listAuditTrails',
  },
  [ToolNames.GET_AUDIT_TRAIL]: {
    handlerKey: 'auditHandler',
    methodName: 'getAuditTrail',
  },

  // Executive Summary
  [ToolNames.SET_EXECUTIVE_SUMMARY]: {
    handlerKey: 'executiveHandler',
    methodName: 'setExecutiveSummary',
  },
  [ToolNames.GET_EXECUTIVE_SUMMARY]: {
    handlerKey: 'executiveHandler',
    methodName: 'getExecutiveSummary',
  },

  // CWE
  [ToolNames.GET_CWE_ID]: {
    handlerKey: 'cweHandler',
    methodName: 'getCwe',
  },
  [ToolNames.GET_CWE_CATEGORIES]: {
    handlerKey: 'cweHandler',
    methodName: 'getCweCategories',
  },
  [ToolNames.GET_CWE_VIEWS]: {
    handlerKey: 'cweHandler',
    methodName: 'getCweViews',
  },

  // CVSS
  [ToolNames.VALIDATE_CVSS]: {
    handlerKey: 'cvssHandler',
    methodName: 'validateCvss',
    isAsync: false,
  },
} as const;

/**
 * Get a handler function for a specific tool
 * Uses the centralized configuration to eliminate switch statements
 */
export function getToolHandler(
  toolName: string,
  handlers: HandlerMap
): HandlerFunction | null {
  // eslint-disable-next-line security/detect-object-injection
  const config = TOOL_HANDLER_CONFIG[toolName];

  if (!config) {
    return null;
  }

  const handler = handlers[config.handlerKey];
  const method = (handler as unknown as Record<string, unknown>)[
    config.methodName
  ];

  if (typeof method !== 'function') {
    return null;
  }

  // Handle sync methods that need to be wrapped in Promise
  if (config.isAsync === false) {
    return async (args: Record<string, unknown>) => {
      const result = (
        method as (
          this: unknown,
          args: Record<string, unknown>
        ) => HandlerResponse
      ).call(handler, args);
      return Promise.resolve(result);
    };
  }

  // Most methods are already async
  return method.bind(handler) as HandlerFunction;
}

/**
 * Create a complete tool handler registry from a handler map
 * This provides a more efficient alternative to the switch statement approach
 */
export function createToolRegistry(
  handlers: HandlerMap
): Map<string, HandlerFunction> {
  const registry = new Map<string, HandlerFunction>();

  for (const [toolName] of Object.entries(TOOL_HANDLER_CONFIG)) {
    const handlerFunction = getToolHandler(toolName, handlers);

    if (handlerFunction) {
      registry.set(toolName, handlerFunction);
    }
  }

  return registry;
}

/**
 * Type-safe method to check if a tool exists
 */
export function isValidToolName(
  toolName: string
): toolName is keyof typeof ToolNames {
  return toolName in TOOL_HANDLER_CONFIG;
}

/**
 * Get all available tool names
 */
export function getAvailableToolNames(): readonly string[] {
  return Object.keys(TOOL_HANDLER_CONFIG);
}
