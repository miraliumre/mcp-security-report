import { randomBytes } from 'node:crypto';

export function sanitizeProjectName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_\s]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .trim();
}

export function isValidProjectName(name: string): boolean {
  const sanitized = sanitizeProjectName(name);
  return sanitized.length > 0 && sanitized.length <= 100;
}

export function sanitizeFindingId(title: string): string {
  const prefix = 'FIND';
  const randomId = randomBytes(4).toString('hex'); // Generate 8 hex chars directly
  const sanitized = title
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .substring(0, 20);

  return `${prefix}-${randomId}-${sanitized}`;
}

export function sanitizeAuditId(title: string): string {
  const prefix = 'AUDIT';
  const randomId = randomBytes(4).toString('hex'); // Generate 8 hex chars directly
  const sanitized = title
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .substring(0, 20);

  return `${prefix}-${randomId}-${sanitized}`;
}

// Path validation moved to pathSanitizer.ts for consistency

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validateURL(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function validateCWE(cwe: string): boolean {
  const cweRegex = /^CWE-\d+$/;
  return cweRegex.test(cwe);
}
