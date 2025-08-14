# MCP Security Report

A [MCP (Model Context Protocol)] server for managing application security audit
findings and reports.

[MCP (Model Context Protocol)]: https://modelcontextprotocol.io/

## Motivation

Application security reports require a consistent, structured format to ensure
clarity and reliability. Each vulnerability finding should include a title,
description, severity level, CWE identifier, CVSS vector and score, affected
components, supporting evidence, and remediation recommendations.

This server enables MCP-compatible clients to generate standardized reports,
replacing ad hoc or unstructured documentation. It enforces validations, such as
checking CWE identifiers and CVSS vectors, to improve report accuracy and
quality.

It also offers utilities for querying CWE details directly from the [MITRE API],
in order to reduce the ocurrence of errors and reducing the risk of inaccurate
classifications or incomplete descriptions.

[MITRE API]: https://github.com/CWE-CAPEC/REST-API-wg/blob/main/Quick%20Start.md

## Features & MCP Tools

This server provides comprehensive security audit capabilities through both MCP
tools (for LLM clients) and CLI commands:

### Project Management

- `create-project`: Create new security audit projects
- `list-projects`: List all projects with status  
- `update-project`: Update project metadata and status
- `delete-project`: Permanently delete a project and all its data

### Security Finding Management

- `create-finding`: Create security findings with CVSS scoring and CWE mapping
- `list-findings`: List findings for a project with pagination
- `get-finding`: Get detailed finding information
- `update-finding`: Update finding details
- `delete-finding`: Remove findings

### Audit Trail Documentation

- `add-audit-trail`: Document testing procedures and methodology
- `list-audit-trails`: List audit documentation with pagination
- `get-audit-trail`: Get detailed audit information

### Executive Summaries

- `set-executive-summary`: Create executive summaries
- `get-executive-summary`: Retrieve executive summaries

### CWE Integration

- `get-cwe-id`: Get detailed CWE weakness information by ID(s)
- `get-cwe-categories`: Get CWE category information
- `get-cwe-views`: Get CWE view information

### CVSS Support

- `validate-cvss`: Validate and score CVSS vectors (supports 2.0, 3.0, 3.1, 4.0)

### Additional Capabilities

- HTTP Server-Sent Events and stdio transport modes for MCP
- Command-line interface mirroring all MCP operations
- Markdown files with YAML frontmatter for findings

## Limitations

### Single-User Design

This tool is designed for single-user operation. While file-level locking
prevents data corruption, running multiple MCP clients simultaneously against
the same project may result in operation timeouts or conflicts. For
collaborative environments, consider dedicated vulnerability management
platforms.

### No Authentication or Authorization

The server provides no authentication, authorization, or access control
mechanisms. All connected clients have full read and write access to all
projects and data. This is intentional for the single-user, local development
use case.

### Network Security

**Use only in trusted, private networks.** The HTTP/SSE mode is intended for
local development or secure private networks only. Do not expose this server
to the public internet without implementing additional security layers such as:

- Reverse proxy with authentication (e.g., nginx with HTTP basic auth)
- VPN or private network access
- Firewall restrictions to trusted IP addresses
- TLS termination proxy for encrypted connections

### Data Isolation

Projects are stored as plain files on the local filesystem with no encryption
or access restrictions beyond standard filesystem permissions. Sensitive
security findings are stored in plaintext markdown files.

## Getting Started

This server integrates with MCP-compatible clients to provide structured security
audit capabilities. The most common deployment is as an MCP server with command
line coding assistants for security engagements.

### MCP Client Integration

To add this server to [Claude Code] or other MCP clients:

```bash
$ claude mcp add \
    --scope user \
    mcp-security-report mcp-security-report serve -- --stdio
```

### Project Directory Setup

The server stores project data in the current working directory by default.
For each security audit, create a dedicated directory:

```bash
$ mkdir my-security-audit
$ cd my-security-audit
$ claude  # Start your MCP client here
```

### Working with Existing Repositories

When performing security assessments on existing codebases, configure a
separate project storage directory to avoid conflicts:

**Option 1: Environment Variable**
```bash
$ export MCP_SECURITY_REPORT_DIR="~/security-reports"
$ cd /path/to/target/repository
$ claude  # Project data stored separately
```

**Option 2: Command Line Flag**
```bash
$ claude mcp add \
    --scope user \
    mcp-security-report \
    mcp-security-report serve -- --project-dir="~/security-reports" --stdio
```

### Alternative Transport Methods

**HTTP/SSE Mode** (for multiple concurrent clients):
```bash
$ mcp-security-report serve --host localhost --port 3000
```

Then configure your MCP client to connect via HTTP instead of stdio.

**Working in Non-Empty Directories** (not recommended):
```bash
$ export MCP_SECURITY_REPORT_UNSAFE_NONEMPTY_DIR=true
```

This bypasses safety checks but may cause conflicts with existing files.

[Claude Code]: https://www.anthropic.com/claude-code

## Configuration

### Environment Variables

#### Core Server Configuration

| Variable                            | Description                                            | Default                   |
|-------------------------------------|--------------------------------------------------------|---------------------------|
| `MCP_SECURITY_REPORT_DIR`           | Default project directory                              | Current working directory |
| `MCP_SECURITY_REPORT_HOST`          | Default server host                                    | `localhost`               |
| `MCP_SECURITY_REPORT_PORT`          | Default server port                                    | `3000`                    |
| `MCP_SECURITY_REPORT_TRANSPORT`     | Transport mode: stdio, sse                             | `sse`                     |

#### CORS Configuration

| Variable                            | Description                                                            | Default  |
|-------------------------------------------|------------------------------------------------------------------|----------|
| `MCP_SECURITY_REPORT_CORS_ORIGIN`         | Comma-separated CORS allowed origins (enables CORS when set)     | Disabled |

#### Resource Limits

| Variable                                  | Description                                            | Default            |
|-------------------------------------------|--------------------------------------------------------|--------------------|
| `MCP_SECURITY_REPORT_MAX_YAML_SIZE`       | Maximum YAML frontmatter size in bytes                 | `10240` (10KB)     |
| `MCP_SECURITY_REPORT_MAX_REQUEST_SIZE`    | Maximum HTTP request size                              | `1mb`              |
| `MCP_SECURITY_REPORT_CACHE_SIZE`          | LRU cache size for findings/audit trails               | `50`               |
| `MCP_SECURITY_REPORT_MAX_SSE_CONNECTIONS` | Maximum concurrent SSE connections                     | `100`              |
| `MCP_SECURITY_REPORT_LOCK_STALE_MS`       | Time in milliseconds before a lock is considered stale | `60000` (1 minute) |

#### Logging Configuration

| Variable                            | Description                                               | Default               |
|-------------------------------------|-----------------------------------------------------------|-----------------------|
| `MCP_SECURITY_REPORT_LOG_LEVEL`     | Log level: error, warn, info, debug                       | `info`                |
| `MCP_SECURITY_REPORT_LOG_TARGET`    | Log target: console, file, both                           | Auto-detected         |
| `MCP_SECURITY_REPORT_LOG_DIR`       | Custom log directory                                      | `<project-dir>/.logs` |

#### Safety Overrides

| Variable                                  | Description                                                                    | Default |
|-------------------------------------------|--------------------------------------------------------------------------------|---------|
| `MCP_SECURITY_REPORT_UNSAFE_NONEMPTY_DIR` | **UNSAFE**: Allow server to start in non-empty directories without MCP files   | `false` |

**Warning**: The `MCP_SECURITY_REPORT_UNSAFE_NONEMPTY_DIR` setting bypasses
safety checks designed to prevent data conflicts. Only use this in development
environments or when you are certain the directory structure won't conflict
with MCP project files.

## License

This project is released into the public domain under the Unlicense.

## Contributing

Contributions are welcome! Please ensure:

1. All tests pass: `npm test`
2. Code is properly formatted: `npm run format`
3. No linting errors: `npm run lint`
4. TypeScript compiles cleanly: `npm run typecheck`

## Support

For issues and feature requests, please use the GitHub issue tracker.