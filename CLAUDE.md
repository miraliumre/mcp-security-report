# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Core Development Commands

### Build and Testing
- `npm run build` - Build the TypeScript project to `dist/`
- `npm test` - Run tests with Vitest
- `npm run test:coverage` - Run tests with coverage reporting
- `npm run typecheck` - Type check without emitting files

### Code Quality
- `npm run lint` - Run ESLint on TypeScript files
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Format code with Prettier

### Development
- `npm run dev` - Run CLI in watch mode with development environment
- `npm run serve` - Start MCP server in development
- `npm run serve:prod` - Build and run production server

### Testing Individual Components
- Run single test: `npm test -- path/to/test.test.ts`
- Watch mode: `npm test -- --watch`

## Architecture Overview

This is an MCP (Model Context Protocol) server for managing security audit findings and reports. The codebase is organized into several key layers:

### Transport Layer (`src/server/http/` and MCP SDK)
- **HTTP Server**: Express-based server with SSE (Server-Sent Events) for HTTP transport
- **stdio Transport**: Direct stdio communication via MCP SDK
- **Message Router**: Routes JSON-RPC requests to appropriate handlers

### Handler Layer (`src/server/handlers/`)
Core business logic handlers that implement MCP tools:
- **ProjectHandler**: Manages security audit projects
- **FindingHandler**: Manages security vulnerability findings  
- **AuditTrailHandler**: Documents testing methodology and activities
- **ExecutiveSummaryHandler**: Creates executive summaries
- **CweHandler**: Integrates with MITRE CWE API for weakness data
- **CvssHandler**: Validates and calculates CVSS scores

### Storage Layer (`src/server/storage/`)
- File-based storage using Markdown files with YAML frontmatter
- Instance locking to prevent concurrent access conflicts
- Project directory structure management

### CLI Layer (`src/cli.ts` and `src/cli/handlers.ts`)
- Command-line interface that mirrors all MCP operations
- Comprehensive CLI commands for all server functionality

### Schema Layer (`src/server/schemas.ts`)
- Zod schemas for all tool inputs with strict validation
- Type-safe interfaces generated from schemas
- Centralized tool definitions for MCP registration

## Key Components

### Tool Registration System
Tools are defined in `schemas.ts` with a centralized `TOOL_DEFINITIONS` array that maps to handlers via `toolHandlerMap.ts`. This ensures consistency between CLI and MCP interfaces.

### Error Handling
- Custom error classes with proper error context
- Emergency logging for critical failures
- Graceful degradation and cleanup

### Security Features
- Path sanitization to prevent directory traversal
- Input validation via Zod schemas
- ESLint security plugin for static analysis
- Safe handling of user-provided data

### Data Format
Projects use a structured format:
- `.mcp-projects.json` - Project metadata registry
- `findings/` - Markdown files with YAML frontmatter for findings
- `audit-trails/` - Documentation of testing activities
- `executive-summary.md` - High-level project summary

## Important Patterns

### Handler Structure
All handlers follow a consistent pattern:
- Constructor takes `workingDir` parameter
- Implement validation via Zod schemas
- Use storage manager for file operations
- Provide cleanup methods for resource management

### Error Management
- Use typed error classes for different error categories
- Log errors with appropriate context
- Ensure cleanup on failure paths

### Type Safety
- Strict TypeScript configuration with extensive checks
- No `any` types allowed in production code
- Zod runtime validation for all external inputs

## Environment Configuration

The server uses extensive environment variable configuration. Key variables:
- `MCP_SECURITY_REPORT_DIR` - Project storage directory
- `MCP_SECURITY_REPORT_TRANSPORT` - Transport mode (stdio/sse)
- `MCP_SECURITY_REPORT_LOG_LEVEL` - Logging level
- `MCP_SECURITY_REPORT_UNSAFE_NONEMPTY_DIR` - Bypass safety checks

## Testing Strategy

- **Unit Tests**: Individual handler and utility testing
- **Integration Tests**: Full request/response cycle testing
- **Coverage Requirements**: 80% global, 70% per-file thresholds
- **Test Setup**: Global setup in `test/setup.ts` for environment

## Security Considerations

This tool handles sensitive security data:
- Findings contain vulnerability details and evidence
- No built-in authentication or encryption
- Designed for single-user, trusted environment use
- File-based storage with filesystem permission security

When making changes, ensure proper input validation, path sanitization, and follow the existing error handling patterns.