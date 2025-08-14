import { z } from 'zod';

/**
 * Extract the shape from a Zod object schema to use as inputSchema for MCP tools
 */
export function getSchemaShape(
  schema: z.ZodSchema
): z.ZodRawShape | Record<string, never> {
  if (schema instanceof z.ZodObject) {
    return schema.shape as z.ZodRawShape;
  }
  // For empty schemas or non-object schemas, return empty object
  return {};
}
