import { z } from 'zod';
import { createChildLogger } from './logger.js';

const logger = createChildLogger('env-validation');

/**
 * Environment variable schema with validation and defaults
 */
const EnvSchema = z.object({
  // Server configuration
  MCP_SECURITY_REPORT_HOST: z.string().optional(),
  MCP_SECURITY_REPORT_PORT: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .optional(),
  MCP_SECURITY_REPORT_DIR: z.string().optional(),
  MCP_SECURITY_REPORT_TRANSPORT: z.enum(['stdio', 'sse']).optional(),

  // CORS configuration
  MCP_SECURITY_REPORT_CORS_ORIGIN: z.string().optional(),

  // Resource limits
  MCP_SECURITY_REPORT_MAX_YAML_SIZE: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .refine(
      (val) => val > 0 && val <= 10485760,
      'YAML size must be between 1 and 10MB'
    )
    .optional(),
  MCP_SECURITY_REPORT_MAX_REQUEST_SIZE: z.string().optional(),
  MCP_SECURITY_REPORT_CACHE_SIZE: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .refine(
      (val) => val >= 1 && val <= 10000,
      'Cache size must be between 1 and 10000'
    )
    .optional(),
  MCP_SECURITY_REPORT_MAX_SSE_CONNECTIONS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .refine(
      (val) => val >= 1 && val <= 1000,
      'Max SSE connections must be between 1 and 1000'
    )
    .optional(),
  MCP_SECURITY_REPORT_LOCK_STALE_MS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .refine(
      (val) => val >= 5000 && val <= 300000,
      'Lock stale time must be between 5s and 5min'
    )
    .optional(),

  // Logging
  MCP_SECURITY_REPORT_LOG_LEVEL: z
    .enum(['error', 'warn', 'info', 'debug'])
    .optional(),
  MCP_SECURITY_REPORT_LOG_TARGET: z
    .enum(['console', 'file', 'both'])
    .optional(),
  MCP_SECURITY_REPORT_LOG_DIR: z.string().optional(),

  // Safety overrides
  MCP_SECURITY_REPORT_UNSAFE_NONEMPTY_DIR: z
    .string()
    .transform((val) => val.toLowerCase() === 'true')
    .optional(),

  // Node environment
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
});

export type ValidatedEnv = z.infer<typeof EnvSchema>;

let validatedEnv: ValidatedEnv | null = null;

/**
 * Validates and caches environment variables
 * @returns Validated environment variables with defaults applied
 */
export function getValidatedEnv(): ValidatedEnv {
  if (validatedEnv === null) {
    try {
      validatedEnv = EnvSchema.parse(process.env);
      logger.debug('Environment variables validated successfully');
    } catch (error) {
      logger.warn('Environment validation failed, using defaults', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Return empty object for defaults to be applied by callers
      validatedEnv = {};
    }
  }
  return validatedEnv;
}

/**
 * Get server configuration with validated environment variables and defaults
 */
export function getServerConfig(): {
  host: string;
  port: number;
  workingDir: string;
  corsOrigin: string | undefined;
  maxYamlSize: number;
  maxRequestSize: string;
  cacheSize: number;
  maxSseConnections: number;
  lockStaleMs: number;
  logLevel: string;
  transport: 'stdio' | 'http' | 'sse';
  unsafeNonemptyDir: boolean;
} {
  const env = getValidatedEnv();

  return {
    host: env.MCP_SECURITY_REPORT_HOST ?? 'localhost',
    port: env.MCP_SECURITY_REPORT_PORT ?? 3000,
    workingDir: env.MCP_SECURITY_REPORT_DIR ?? process.cwd(),
    corsOrigin: env.MCP_SECURITY_REPORT_CORS_ORIGIN,
    maxYamlSize: env.MCP_SECURITY_REPORT_MAX_YAML_SIZE ?? 10240,
    maxRequestSize: env.MCP_SECURITY_REPORT_MAX_REQUEST_SIZE ?? '1mb',
    cacheSize: env.MCP_SECURITY_REPORT_CACHE_SIZE ?? 50,
    maxSseConnections: env.MCP_SECURITY_REPORT_MAX_SSE_CONNECTIONS ?? 100,
    lockStaleMs: env.MCP_SECURITY_REPORT_LOCK_STALE_MS ?? 60000,
    logLevel: env.MCP_SECURITY_REPORT_LOG_LEVEL ?? 'info',
    transport: env.MCP_SECURITY_REPORT_TRANSPORT ?? 'sse',
    unsafeNonemptyDir: env.MCP_SECURITY_REPORT_UNSAFE_NONEMPTY_DIR ?? false,
  };
}

/**
 * Check if environment variables are properly configured
 * @returns true if all required environment variables are valid
 */
export function validateEnvironment(): boolean {
  try {
    EnvSchema.parse(process.env);
    return true;
  } catch {
    return false;
  }
}
