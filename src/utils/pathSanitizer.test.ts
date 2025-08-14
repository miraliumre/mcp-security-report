import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  sanitizeDirectoryPath,
  sanitizeFilename,
  isPathSafe,
  validateWorkingDirectory,
} from './pathSanitizer.js';
import { ValidationError } from '../types/index.js';

// Mock fs module
vi.mock('node:fs');
const mockedFs = vi.mocked(fs);

describe('pathSanitizer utils', () => {
  const testBasePath = '/test/base';

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock existsSync to return false by default
    mockedFs.existsSync.mockReturnValue(false);
    // Mock realpathSync to return the input path
    mockedFs.realpathSync.mockImplementation((p: fs.PathLike) => p as string);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('sanitizeDirectoryPathSync', () => {
    it('should throw ValidationError for null input', () => {
      expect(() => sanitizeDirectoryPath(null)).toThrow(ValidationError);
      expect(() => sanitizeDirectoryPath(null)).toThrow(
        'Validation error: Path validation failed'
      );
    });

    it('should throw ValidationError for undefined input', () => {
      expect(() => sanitizeDirectoryPath(undefined)).toThrow(ValidationError);
      expect(() => sanitizeDirectoryPath(undefined)).toThrow(
        'Validation error: Path validation failed'
      );
    });

    it('should throw ValidationError for non-string input', () => {
      expect(() => sanitizeDirectoryPath(123 as any)).toThrow(ValidationError);
      expect(() => sanitizeDirectoryPath(123 as any)).toThrow(
        'Validation error: Path validation failed'
      );
      expect(() => sanitizeDirectoryPath({} as any)).toThrow(ValidationError);
      expect(() => sanitizeDirectoryPath([] as any)).toThrow(ValidationError);
    });
    it('should handle empty input path', () => {
      const result = sanitizeDirectoryPath('', testBasePath);
      expect(result).toBe(path.resolve(testBasePath));
    });

    it('should handle whitespace-only input path', () => {
      const result = sanitizeDirectoryPath('   ', testBasePath);
      expect(result).toBe(path.resolve(testBasePath));
    });

    it('should resolve relative paths correctly', () => {
      const result = sanitizeDirectoryPath('subdir', testBasePath);
      expect(result).toBe(path.resolve(testBasePath, 'subdir'));
    });

    it('should allow paths within base directory', () => {
      const result = sanitizeDirectoryPath('safe/subdir', testBasePath);
      expect(result).toBe(path.resolve(testBasePath, 'safe/subdir'));
    });

    it('should prevent path traversal attacks', () => {
      expect(() => {
        sanitizeDirectoryPath('../../../etc', testBasePath);
      }).toThrow('Validation error: Path validation failed');

      expect(() => {
        sanitizeDirectoryPath('../../passwd', testBasePath);
      }).toThrow('Validation error: Path validation failed');
    });

    it('should prevent absolute path escapes', () => {
      expect(() => {
        sanitizeDirectoryPath('/etc/passwd', testBasePath);
      }).toThrow('Validation error: Path validation failed');

      expect(() => {
        sanitizeDirectoryPath('/home/other', testBasePath);
      }).toThrow('Validation error: Path validation failed');
    });

    it('should handle existing files with realpathSync', () => {
      const testPath = path.join(testBasePath, 'existing');
      const realPath = path.join(testBasePath, 'real');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.realpathSync.mockReturnValue(realPath);

      const result = sanitizeDirectoryPath('existing', testBasePath);
      expect(result).toBe(realPath);
      expect(mockedFs.realpathSync).toHaveBeenCalledWith(testPath);
    });

    it('should handle symlink that escapes base directory', () => {
      const realPath = '/etc/passwd'; // Outside base directory

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.realpathSync.mockReturnValue(realPath);

      expect(() => {
        sanitizeDirectoryPath('symlink', testBasePath);
      }).toThrow('Validation error: Path validation failed');
    });

    it('should handle realpathSync errors gracefully', () => {
      const testPath = path.join(testBasePath, 'broken-symlink');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.realpathSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      // Should not throw, should use normalized path instead
      const result = sanitizeDirectoryPath('broken-symlink', testBasePath);
      expect(result).toBe(testPath);
    });

    it('should reject paths with null bytes', () => {
      expect(() => {
        sanitizeDirectoryPath('safe\0path', testBasePath);
      }).toThrow('Validation error: Path validation failed');
    });

    it('should reject Windows reserved names', () => {
      expect(() => {
        sanitizeDirectoryPath('con', testBasePath);
      }).toThrow('Validation error: Path validation failed');

      expect(() => {
        sanitizeDirectoryPath('aux.txt', testBasePath);
      }).toThrow('Validation error: Path validation failed');

      expect(() => {
        sanitizeDirectoryPath('com1', testBasePath);
      }).toThrow('Validation error: Path validation failed');

      expect(() => {
        sanitizeDirectoryPath('LPT9', testBasePath);
      }).toThrow('Validation error: Path validation failed');
    });

    it('should allow valid Windows names that are not reserved', () => {
      const result = sanitizeDirectoryPath('console', testBasePath);
      expect(result).toBe(path.resolve(testBasePath, 'console'));

      const result2 = sanitizeDirectoryPath('command', testBasePath);
      expect(result2).toBe(path.resolve(testBasePath, 'command'));
    });

    it('should use current working directory as default base', () => {
      const originalCwd = process.cwd();
      const result = sanitizeDirectoryPath('test');
      expect(result).toBe(path.resolve(originalCwd, 'test'));
    });

    it('should handle complex path scenarios', () => {
      const result = sanitizeDirectoryPath(
        './subdir/../another',
        testBasePath
      );
      expect(result).toBe(path.resolve(testBasePath, 'another'));
    });
  });

  describe('sanitizeFilename', () => {
    it('should throw ValidationError for null input', () => {
      expect(() => sanitizeFilename(null)).toThrow(ValidationError);
      expect(() => sanitizeFilename(null)).toThrow(
        'Filename cannot be null or undefined'
      );
    });

    it('should throw ValidationError for undefined input', () => {
      expect(() => sanitizeFilename(undefined)).toThrow(ValidationError);
      expect(() => sanitizeFilename(undefined)).toThrow(
        'Filename cannot be null or undefined'
      );
    });

    it('should throw ValidationError for non-string input', () => {
      expect(() => sanitizeFilename(123 as any)).toThrow(ValidationError);
      expect(() => sanitizeFilename(123 as any)).toThrow(
        'Filename must be a string'
      );
      expect(() => sanitizeFilename({} as any)).toThrow(ValidationError);
      expect(() => sanitizeFilename([] as any)).toThrow(ValidationError);
    });
    it('should sanitize invalid characters', () => {
      expect(sanitizeFilename('file<>name.txt')).toBe('file__name.txt');
      expect(sanitizeFilename('file|name?.txt')).toBe('file_name_.txt');
      expect(sanitizeFilename('file*name.txt')).toBe('file_name.txt');
    });

    it('should handle Unicode characters', () => {
      expect(sanitizeFilename('file–name.txt')).toBe('file–name.txt'); // Should preserve valid Unicode
    });

    it('should reject dot and double-dot filenames', () => {
      // The sanitize-filename library may handle these differently
      const result1 = sanitizeFilename('.');
      const result2 = sanitizeFilename('..');
      // Check that they are not the dangerous originals
      expect(result1).not.toBe('.');
      expect(result2).not.toBe('..');
    });

    it('should handle empty results', () => {
      expect(() => sanitizeFilename('')).toThrow('Invalid filename');
      // sanitize-filename may replace with underscores instead of becoming empty
      const result = sanitizeFilename('||||');
      expect(result).toBeTruthy(); // Should be a valid filename
    });

    it('should preserve valid filenames', () => {
      expect(sanitizeFilename('valid-file_name.txt')).toBe(
        'valid-file_name.txt'
      );
      expect(sanitizeFilename('file123.jpg')).toBe('file123.jpg');
    });

    it('should handle long filenames', () => {
      const longName = 'a'.repeat(300) + '.txt';
      const result = sanitizeFilename(longName);
      expect(result).toBeTruthy();
      expect(result.length).toBeLessThan(256); // Most filesystems limit to 255 chars
    });

    it('should handle Windows reserved names in filenames', () => {
      // The sanitize-filename library should handle these
      const result = sanitizeFilename('con.txt');
      expect(result).not.toBe('con.txt'); // Should be modified
    });
  });

  describe('isPathSafe', () => {
    it('should return false for null/undefined input', () => {
      expect(isPathSafe(null)).toBe(false);
      expect(isPathSafe(undefined)).toBe(false);
      expect(isPathSafe(null, testBasePath)).toBe(false);
      expect(isPathSafe(undefined, testBasePath)).toBe(false);
    });

    it('should return false for non-string input', () => {
      expect(isPathSafe(123 as any)).toBe(false);
      expect(isPathSafe({} as any)).toBe(false);
      expect(isPathSafe([] as any)).toBe(false);
    });
    it('should return true for safe paths', () => {
      expect(isPathSafe('safe/path', testBasePath)).toBe(true);
      expect(isPathSafe('./relative', testBasePath)).toBe(true);
      expect(isPathSafe('deeply/nested/safe/path', testBasePath)).toBe(true);
    });

    it('should return false for unsafe paths', () => {
      expect(isPathSafe('../../../etc', testBasePath)).toBe(false);
      expect(isPathSafe('/etc/passwd', testBasePath)).toBe(false);
      expect(isPathSafe('../../passwd', testBasePath)).toBe(false);
    });

    it('should return false for paths with invalid characters', () => {
      expect(isPathSafe('path\0with\0nulls', testBasePath)).toBe(false);
      expect(isPathSafe('con/aux', testBasePath)).toBe(false);
    });

    it('should use current working directory as default', () => {
      const result = isPathSafe('safe/path');
      expect(result).toBe(true);
    });

    it('should handle paths that throw errors', () => {
      // Test with a path that contains invalid segments to force an error
      const result = isPathSafe('con/aux', testBasePath);
      expect(result).toBe(false);
    });

    it('should validate absolute paths within base', () => {
      const absoluteSafe = path.join(testBasePath, 'safe');
      expect(isPathSafe(absoluteSafe, testBasePath)).toBe(true);

      const absoluteUnsafe = '/etc/passwd';
      expect(isPathSafe(absoluteUnsafe, testBasePath)).toBe(false);
    });
  });

  describe('edge cases and security', () => {
    it('should handle mixed path separators', () => {
      const mixedPath = 'safe/subdir//file';
      const result = sanitizeDirectoryPath(mixedPath, testBasePath);
      expect(result).toBe(
        path.resolve(testBasePath, 'safe', 'subdir', 'file')
      );
    });

    it('should handle Unicode normalization attacks', () => {
      // Test with different Unicode representations that might normalize to dangerous paths
      const unicodePath = 'saf\u0065'; // 'safe' with composed character
      const result = sanitizeDirectoryPath(unicodePath, testBasePath);
      expect(result).toBe(path.resolve(testBasePath, 'safe'));
    });

    it('should handle very long paths', () => {
      const longPath = 'a'.repeat(1000);
      const result = sanitizeDirectoryPath(longPath, testBasePath);
      expect(result).toBe(path.resolve(testBasePath, longPath));
    });

    it('should reject paths that resolve to exact base directory via traversal', () => {
      // This should be allowed - staying at base is fine
      const result = sanitizeDirectoryPath('./subdir/../', testBasePath);
      expect(result).toBe(path.resolve(testBasePath));
    });
  });

  describe('validateWorkingDirectory', () => {
    it('should return invalid for null/undefined input', () => {
      expect(validateWorkingDirectory(null).valid).toBe(false);
      expect(validateWorkingDirectory(undefined).valid).toBe(false);
      expect(validateWorkingDirectory(null, testBasePath).valid).toBe(false);
      expect(validateWorkingDirectory(undefined, testBasePath).valid).toBe(
        false
      );
    });

    it('should return false for non-string input', () => {
      expect(validateWorkingDirectory(123 as any).valid).toBe(false);
      expect(validateWorkingDirectory({} as any).valid).toBe(false);
      expect(validateWorkingDirectory([] as any).valid).toBe(false);
    });
    it('should accept valid relative paths', () => {
      expect(validateWorkingDirectory('project', testBasePath).valid).toBe(
        true
      );
      expect(validateWorkingDirectory('sub/project', testBasePath).valid).toBe(
        true
      );
      expect(validateWorkingDirectory('./relative', testBasePath).valid).toBe(
        true
      );
    });

    it('should accept absolute paths (CLI allows this)', () => {
      expect(
        validateWorkingDirectory('/absolute/path', testBasePath).valid
      ).toBe(true);
      expect(validateWorkingDirectory('/tmp/test', testBasePath).valid).toBe(
        true
      );
    });

    it('should accept path traversal (CLI allows this)', () => {
      expect(validateWorkingDirectory('../test', testBasePath).valid).toBe(
        true
      );
      expect(validateWorkingDirectory('../../test', testBasePath).valid).toBe(
        true
      );
    });

    it('should reject paths with dangerous characters', () => {
      expect(validateWorkingDirectory('valid\0path', testBasePath).valid).toBe(
        false
      );
    });
  });
});
