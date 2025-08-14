import { describe, it, expect } from 'vitest';
import {
  sanitizeProjectName,
  isValidProjectName,
  sanitizeFindingId,
  sanitizeAuditId,
  validateEmail,
  validateURL,
  validateCWE,
} from './validation.js';

describe('validation utils', () => {
  describe('sanitizeProjectName', () => {
    it('should remove special characters and replace spaces with hyphens', () => {
      expect(sanitizeProjectName('My Project!@#')).toBe('my-project');
      expect(sanitizeProjectName('Test   Multiple   Spaces')).toBe(
        'test-multiple-spaces'
      );
      expect(sanitizeProjectName('CamelCase')).toBe('camelcase');
    });

    it('should handle edge cases', () => {
      expect(sanitizeProjectName('')).toBe('');
      expect(sanitizeProjectName('   ')).toBe('-'); // multiple spaces become single hyphen
      expect(sanitizeProjectName('!!!@@@###')).toBe('');
      expect(sanitizeProjectName('_underscore_')).toBe('_underscore_');
      expect(sanitizeProjectName('-hyphen-')).toBe('-hyphen-');
      expect(sanitizeProjectName('   -   ')).toBe('---'); // space-hyphen-space pattern
    });

    it('should preserve valid characters', () => {
      expect(sanitizeProjectName('abc123-_')).toBe('abc123-_');
      expect(sanitizeProjectName('Project-2024_v1')).toBe('project-2024_v1');
    });
  });

  describe('isValidProjectName', () => {
    it('should validate correct project names', () => {
      expect(isValidProjectName('valid-project')).toBe(true);
      expect(isValidProjectName('Project Name')).toBe(true);
      expect(isValidProjectName('test_123')).toBe(true);
    });

    it('should reject invalid project names', () => {
      expect(isValidProjectName('')).toBe(false);
      expect(isValidProjectName('   ')).toBe(true); // sanitizes to '---' which is valid
      expect(isValidProjectName('!!!@@@')).toBe(false);
      expect(isValidProjectName('a'.repeat(101))).toBe(false);
    });

    it('should accept names at boundary lengths', () => {
      expect(isValidProjectName('a')).toBe(true);
      expect(isValidProjectName('a'.repeat(100))).toBe(true);
    });
  });

  describe('sanitizeFindingId', () => {
    it('should create consistent finding ID format', () => {
      const id = sanitizeFindingId('SQL Injection');
      expect(id).toMatch(/^FIND-[a-z0-9]+-sql-injection$/);
    });

    it('should truncate long titles', () => {
      const longTitle =
        'This is a very long finding title that should be truncated';
      const id = sanitizeFindingId(longTitle);
      expect(id).toMatch(/^FIND-[a-z0-9]+-this-is-a-very-long/);
    });

    it('should handle special characters', () => {
      const id = sanitizeFindingId('XSS <script>alert(1)</script>');
      expect(id).toMatch(/^FIND-[a-z0-9]+-xss-scriptalert1scri/);
    });

    it('should generate unique IDs for same title', async () => {
      const id1 = sanitizeFindingId('Test Finding');
      // Add small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 1));
      const id2 = sanitizeFindingId('Test Finding');
      expect(id1).not.toBe(id2);
    });
  });

  describe('sanitizeAuditId', () => {
    it('should create consistent audit ID format', () => {
      const id = sanitizeAuditId('Security Review');
      expect(id).toMatch(/^AUDIT-[a-z0-9]+-security-review$/);
    });

    it('should truncate long titles', () => {
      const longTitle =
        'This is a very long audit title that should be truncated';
      const id = sanitizeAuditId(longTitle);
      expect(id).toMatch(/^AUDIT-[a-z0-9]+-this-is-a-very-long-$/);
    });

    it('should generate unique IDs for same title', async () => {
      const id1 = sanitizeAuditId('Test Audit');
      // Add small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 1));
      const id2 = sanitizeAuditId('Test Audit');
      expect(id1).not.toBe(id2);
    });
  });

  describe('validateEmail', () => {
    it('should validate correct email addresses', () => {
      expect(validateEmail('user@example.com')).toBe(true);
      expect(validateEmail('test.user@domain.co.uk')).toBe(true);
      expect(validateEmail('user+tag@example.org')).toBe(true);
      expect(validateEmail('user_name@sub.domain.com')).toBe(true);
    });

    it('should reject invalid email addresses', () => {
      expect(validateEmail('')).toBe(false);
      expect(validateEmail('notanemail')).toBe(false);
      expect(validateEmail('@example.com')).toBe(false);
      expect(validateEmail('user@')).toBe(false);
      expect(validateEmail('user @example.com')).toBe(false);
      expect(validateEmail('user@example')).toBe(false);
      expect(validateEmail('user@@example.com')).toBe(false);
    });
  });

  describe('validateURL', () => {
    it('should validate correct URLs', () => {
      expect(validateURL('http://example.com')).toBe(true);
      expect(validateURL('https://www.example.com')).toBe(true);
      expect(validateURL('ftp://files.example.com')).toBe(true);
      expect(validateURL('http://localhost:3000')).toBe(true);
      expect(validateURL('https://example.com/path?query=value')).toBe(true);
      expect(validateURL('https://example.com:8080/path#anchor')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(validateURL('')).toBe(false);
      expect(validateURL('not a url')).toBe(false);
      expect(validateURL('example.com')).toBe(false);
      expect(validateURL('//example.com')).toBe(false);
      expect(validateURL('http://')).toBe(false);
      expect(validateURL('http:// example.com')).toBe(false);
    });
  });

  describe('validateCWE', () => {
    it('should validate correct CWE identifiers', () => {
      expect(validateCWE('CWE-79')).toBe(true);
      expect(validateCWE('CWE-89')).toBe(true);
      expect(validateCWE('CWE-200')).toBe(true);
      expect(validateCWE('CWE-1021')).toBe(true);
      expect(validateCWE('CWE-1')).toBe(true);
    });

    it('should reject invalid CWE identifiers', () => {
      expect(validateCWE('')).toBe(false);
      expect(validateCWE('CWE')).toBe(false);
      expect(validateCWE('CWE-')).toBe(false);
      expect(validateCWE('cwe-79')).toBe(false);
      expect(validateCWE('CWE-ABC')).toBe(false);
      expect(validateCWE('79')).toBe(false);
      expect(validateCWE('CWE 79')).toBe(false);
      expect(validateCWE('CWE-79-1')).toBe(false);
    });
  });
});
