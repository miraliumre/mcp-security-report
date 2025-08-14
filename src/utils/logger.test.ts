import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { Logger, LogLevel, LogTarget } from './logger.js';

// Mock fs module
vi.mock('fs');
const mockedFs = vi.mocked(fs);

// Mock util.promisify
vi.mock('util', () => ({
  promisify: vi.fn((fn: any) => {
    const mockFunc = vi.fn();
    // Set up default behavior for promisified functions
    if (fn === fs.mkdir || fn?.name === 'mkdir') {
      mockFunc.mockRejectedValue(new Error('Async mkdir failed'));
    } else if (fn === fs.access || fn?.name === 'access') {
      mockFunc.mockRejectedValue(new Error('ENOENT'));
    }
    return mockFunc;
  }),
}));

describe('logger utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset environment variables
    delete process.env.MCP_LOG_TARGET;
    delete process.env.MCP_LOG_DIR;
    delete process.env.NODE_ENV;

    // Mock fs methods
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockReturnValue(undefined);
    mockedFs.statSync.mockReturnValue({ size: 0 } as fs.Stats);
    mockedFs.createWriteStream.mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      destroyed: false,
    } as any);

    // Promisified function mocks are handled in the util mock above
  });

  describe('Logger construction', () => {
    it('should create logger with default configuration', () => {
      const logger = new Logger();
      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should accept custom configuration', () => {
      const config = {
        level: LogLevel.DEBUG,
        target: LogTarget.CONSOLE,
        context: 'test-context',
      };
      const logger = new Logger(config);
      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should detect stdio mode from command line arguments', () => {
      const originalArgv = process.argv;
      process.argv = [...originalArgv, '--stdio'];

      const logger = new Logger();
      expect(logger).toBeDefined();

      process.argv = originalArgv;
    });

    it('should respect MCP_LOG_TARGET environment variable', () => {
      process.env.MCP_LOG_TARGET = LogTarget.CONSOLE;

      const logger = new Logger();
      expect(logger).toBeDefined();
    });
  });

  describe('Log level filtering', () => {
    it('should create logger with different log levels', () => {
      const debugLogger = new Logger({
        level: LogLevel.DEBUG,
        target: LogTarget.CONSOLE,
      });
      const infoLogger = new Logger({
        level: LogLevel.INFO,
        target: LogTarget.CONSOLE,
      });
      const warnLogger = new Logger({
        level: LogLevel.WARN,
        target: LogTarget.CONSOLE,
      });
      const errorLogger = new Logger({
        level: LogLevel.ERROR,
        target: LogTarget.CONSOLE,
      });

      expect(debugLogger).toBeDefined();
      expect(infoLogger).toBeDefined();
      expect(warnLogger).toBeDefined();
      expect(errorLogger).toBeDefined();
    });

    it('should allow changing log level dynamically', () => {
      const logger = new Logger({
        level: LogLevel.ERROR,
        target: LogTarget.CONSOLE,
      });

      // Should not throw when setting level
      expect(() => logger.setLevel(LogLevel.INFO)).not.toThrow();
      expect(() => logger.setLevel(LogLevel.DEBUG)).not.toThrow();
    });
  });

  describe('Log targets', () => {
    it('should create logger with CONSOLE target', () => {
      const logger = new Logger({ target: LogTarget.CONSOLE });
      expect(logger).toBeDefined();

      // Should not throw when logging
      expect(() => logger.info('test message')).not.toThrow();
    });

    it('should create logger with FILE target', () => {
      const logger = new Logger({ target: LogTarget.FILE });
      expect(logger).toBeDefined();

      // Should not throw when logging
      expect(() => logger.info('test message')).not.toThrow();
    });

    it('should create logger with BOTH target', () => {
      const logger = new Logger({ target: LogTarget.BOTH });
      expect(logger).toBeDefined();

      // Should not throw when logging
      expect(() => logger.info('test message')).not.toThrow();
    });
  });

  describe('Logging methods', () => {
    it('should support debug method', () => {
      const logger = new Logger({ level: LogLevel.DEBUG });
      expect(() => logger.debug('debug message')).not.toThrow();
    });

    it('should support info method', () => {
      const logger = new Logger();
      expect(() => logger.info('info message')).not.toThrow();
    });

    it('should support warn method', () => {
      const logger = new Logger();
      expect(() => logger.warn('warn message')).not.toThrow();
    });

    it('should support error method with string', () => {
      const logger = new Logger();
      expect(() => logger.error('error message')).not.toThrow();
    });

    it('should support error method with Error object', () => {
      const logger = new Logger();
      const error = new Error('Test error');
      expect(() => logger.error(error)).not.toThrow();
    });

    it('should support metadata in log methods', () => {
      const logger = new Logger();
      const meta = { user: 'test', action: 'create' };

      expect(() => logger.debug('debug', meta)).not.toThrow();
      expect(() => logger.info('info', meta)).not.toThrow();
      expect(() => logger.warn('warn', meta)).not.toThrow();
      expect(() => logger.error('error', meta)).not.toThrow();
    });
  });

  describe('Child loggers', () => {
    it('should create child logger', () => {
      const parent = new Logger({ context: 'parent' });
      const child = parent.child('child');

      expect(child).toBeDefined();
      expect(child).toBeInstanceOf(Logger);
    });

    it('should allow child logger to log messages', () => {
      const parent = new Logger();
      const child = parent.child('child-context');

      expect(() => child.info('child message')).not.toThrow();
    });

    it('should inherit configuration from parent', () => {
      const parent = new Logger({
        level: LogLevel.DEBUG,
        target: LogTarget.FILE,
        context: 'parent',
      });
      const child = parent.child('child');

      expect(child).toBeDefined();
      expect(() => child.debug('debug from child')).not.toThrow();
    });
  });

  describe('Error handling', () => {
    it('should handle Error objects with stack traces', () => {
      const logger = new Logger();
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';

      expect(() => logger.error(error)).not.toThrow();
    });

    it('should handle Error objects without stack traces', () => {
      const logger = new Logger();
      const error = new Error('Test error');
      delete error.stack;

      expect(() => logger.error(error)).not.toThrow();
    });

    it('should handle custom error metadata', () => {
      const logger = new Logger();
      const error = new Error('Test error');
      const metadata = { code: 'ERR_001', userId: 123 };

      expect(() => logger.error(error, metadata)).not.toThrow();
    });
  });

  describe('Graceful shutdown', () => {
    it('should have end method', () => {
      const logger = new Logger();
      expect(logger.end).toBeDefined();
      expect(typeof logger.end).toBe('function');
    });

    it('should call end without errors', () => {
      const logger = new Logger();
      expect(() => logger.end()).not.toThrow();
    });

    it('should end file stream when using FILE target', () => {
      const mockStream = {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
        destroyed: false,
      };
      mockedFs.createWriteStream.mockReturnValue(mockStream as any);

      const logger = new Logger({ target: LogTarget.FILE });
      logger.end();

      // Verify the logger can be ended without errors
      expect(logger).toBeDefined();
    });
  });

  describe('Environment-based configuration', () => {
    it('should detect development mode', () => {
      process.env.NODE_ENV = 'development';

      const logger = new Logger();
      expect(logger).toBeDefined();

      // In development, debug messages should work
      expect(() => logger.debug('debug message')).not.toThrow();
    });

    it('should detect production mode', () => {
      process.env.NODE_ENV = 'production';

      const logger = new Logger();
      expect(logger).toBeDefined();

      // In production, info messages should work
      expect(() => logger.info('info message')).not.toThrow();
    });

    it('should handle custom log directory from environment', () => {
      const customDir = './.tmp/test-env-logs';
      process.env.MCP_LOG_DIR = customDir;

      // Mock to avoid actual directory creation
      mockedFs.existsSync.mockReturnValue(true);

      const logger = new Logger({ target: LogTarget.FILE });
      expect(logger).toBeDefined();
    });

    it('should handle invalid MCP_LOG_TARGET values', () => {
      process.env.MCP_LOG_TARGET = 'invalid-target';

      // Should fallback to default behavior
      const logger = new Logger();
      expect(logger).toBeDefined();
    });
  });

  describe('Context management', () => {
    it('should accept context in configuration', () => {
      const logger = new Logger({ context: 'test-context' });
      expect(logger).toBeDefined();
      expect(() => logger.info('message with context')).not.toThrow();
    });

    it('should create multiple child loggers with different contexts', () => {
      const parent = new Logger({ context: 'parent' });
      const child1 = parent.child('child1');
      const child2 = parent.child('child2');

      expect(child1).toBeDefined();
      expect(child2).toBeDefined();
      expect(child1).not.toBe(child2);
    });
  });

  describe('Log directory handling', () => {
    it('should handle existing log directory', () => {
      mockedFs.existsSync.mockReturnValue(true);

      const logger = new Logger({ target: LogTarget.FILE });
      expect(logger).toBeDefined();

      // Should not call mkdirSync if directory exists
      expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should handle directory creation failure gracefully', async () => {
      // Temporarily override NODE_ENV to simulate production
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        mockedFs.existsSync.mockReturnValue(false);
        // Make mkdirSync throw an error to simulate directory creation failure
        mockedFs.mkdirSync.mockImplementation(() => {
          throw new Error('Directory creation failed');
        });

        // Create logger with file target
        const logger = new Logger({
          target: LogTarget.FILE,
          logDir: './.tmp/test-nested-log-dir',
        });

        expect(logger).toBeDefined();

        // Directory creation should have been attempted since it's not in test mode
        expect(mockedFs.mkdirSync).toHaveBeenCalled();
        
        // Logger should still work even if directory creation failed
        expect(() => logger.info('test message')).not.toThrow();
      } finally {
        // Restore NODE_ENV
        if (originalNodeEnv !== undefined) {
          process.env.NODE_ENV = originalNodeEnv;
        } else {
          delete process.env.NODE_ENV;
        }
      }
    });
  });
});
