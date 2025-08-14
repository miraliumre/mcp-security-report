import { describe, it, expect } from 'vitest';
import {
  calculateCVSSScore,
  isValidCVSSVector,
  getCVSSSeverityRating,
  formatCVSSDisplay,
  CVSSError,
} from './cvss.js';

describe('cvss utils', () => {
  describe('calculateCVSSScore', () => {
    describe('CVSS 2.0', () => {
      it('should calculate valid CVSS 2.0 vectors', () => {
        const result = calculateCVSSScore('AV:N/AC:L/Au:N/C:P/I:P/A:P');
        expect(result.version).toBe('2.0');
        expect(result.score).toBeGreaterThan(0);
        expect(result.baseScore).toBeGreaterThan(0);
        expect(result.rating).toBeTruthy();
        expect(result.vector).toBeTruthy();
      });

      it('should handle CVSS 2.0 with temporal metrics', () => {
        const result = calculateCVSSScore(
          'AV:N/AC:L/Au:N/C:C/I:C/A:C/E:F/RL:OF/RC:C'
        );
        expect(result.version).toBe('2.0');
        expect(result.baseScore).toBeGreaterThan(0);
        expect(result.temporalScore).toBeDefined();
      });
    });

    describe('CVSS 3.0', () => {
      it('should calculate valid CVSS 3.0 vectors', () => {
        const result = calculateCVSSScore(
          'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'
        );
        expect(result.version).toBe('3.0');
        expect(result.score).toBeCloseTo(9.8, 1);
        expect(result.baseScore).toBeCloseTo(9.8, 1);
        expect(result.rating).toBe('Critical');
      });

      it('should handle CVSS 3.0 with temporal metrics', () => {
        const result = calculateCVSSScore(
          'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:F/RL:O/RC:C'
        );
        expect(result.version).toBe('3.0');
        expect(result.baseScore).toBeGreaterThan(0);
        expect(result.temporalScore).toBeDefined();
      });
    });

    describe('CVSS 3.1', () => {
      it('should calculate valid CVSS 3.1 vectors', () => {
        const result = calculateCVSSScore(
          'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'
        );
        expect(result.version).toBe('3.1');
        expect(result.score).toBeCloseTo(9.8, 1);
        expect(result.baseScore).toBeCloseTo(9.8, 1);
        expect(result.rating).toBe('Critical');
      });

      it('should handle CVSS 3.1 medium severity', () => {
        const result = calculateCVSSScore(
          'CVSS:3.1/AV:N/AC:H/PR:L/UI:R/S:U/C:L/I:L/A:L'
        );
        expect(result.version).toBe('3.1');
        expect(result.score).toBeGreaterThan(3);
        expect(result.score).toBeLessThan(7);
        expect(result.rating).toBe('Medium');
      });

      it('should handle CVSS 3.1 low severity', () => {
        const result = calculateCVSSScore(
          'CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N'
        );
        expect(result.version).toBe('3.1');
        expect(result.score).toBeGreaterThan(0);
        expect(result.score).toBeLessThan(4);
        expect(result.rating).toBe('Low');
      });
    });

    describe('CVSS 4.0', () => {
      it('should calculate valid CVSS 4.0 vectors', () => {
        const result = calculateCVSSScore(
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H'
        );
        expect(result.version).toBe('4.0');
        expect(result.score).toBeGreaterThan(0);
        expect(result.baseScore).toBeGreaterThan(0);
        expect(result.rating).toBeTruthy();
      });
    });

    describe('error handling', () => {
      it('should throw CVSSError for empty strings', () => {
        expect(() => calculateCVSSScore('')).toThrow(CVSSError);
        expect(() => calculateCVSSScore('   ')).toThrow(
          'Invalid CVSS vector: empty or null string'
        );
      });

      it('should throw CVSSError for null or undefined', () => {
        expect(() => calculateCVSSScore(null as any)).toThrow(CVSSError);
        expect(() => calculateCVSSScore(undefined as any)).toThrow(CVSSError);
      });

      it('should throw CVSSError for invalid CVSS 2.0 format', () => {
        expect(() => calculateCVSSScore('invalid')).toThrow(CVSSError);
        expect(() => calculateCVSSScore('AV:X/AC:L')).toThrow(CVSSError);
        expect(() => calculateCVSSScore('random/string')).toThrow(CVSSError);
      });

      it('should throw CVSSError for malformed CVSS 3.x vectors', () => {
        expect(() => calculateCVSSScore('CVSS:3.1/invalid')).toThrow(
          CVSSError
        );
        expect(() => calculateCVSSScore('CVSS:3.1/AV:INVALID')).toThrow(
          CVSSError
        );
      });

      it('should throw CVSSError for malformed CVSS 4.0 vectors', () => {
        expect(() => calculateCVSSScore('CVSS:4.0/invalid')).toThrow(
          CVSSError
        );
        expect(() => calculateCVSSScore('CVSS:4.0/AV:INVALID')).toThrow(
          CVSSError
        );
      });

      it('should preserve vector in error', () => {
        try {
          calculateCVSSScore('invalid-vector');
        } catch (error) {
          expect(error).toBeInstanceOf(CVSSError);
          expect((error as CVSSError).vector).toBe('invalid-vector');
        }
      });
    });

    describe('edge cases', () => {
      it('should handle vectors with extra whitespace', () => {
        const result = calculateCVSSScore(
          '  CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H  '
        );
        expect(result.version).toBe('3.1');
        expect(result.score).toBeGreaterThan(0);
      });

      it('should handle CVSS 2.0 without version prefix', () => {
        const result = calculateCVSSScore('AV:L/AC:M/Au:S/C:N/I:P/A:N');
        expect(result.version).toBe('2.0');
      });
    });
  });

  describe('isValidCVSSVector', () => {
    it('should return true for valid vectors', () => {
      expect(isValidCVSSVector('AV:N/AC:L/Au:N/C:P/I:P/A:P')).toBe(true);
      expect(
        isValidCVSSVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')
      ).toBe(true);
      expect(
        isValidCVSSVector(
          'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H'
        )
      ).toBe(true);
    });

    it('should return false for invalid vectors', () => {
      expect(isValidCVSSVector('')).toBe(false);
      expect(isValidCVSSVector('invalid')).toBe(false);
      expect(isValidCVSSVector('CVSS:3.1/invalid')).toBe(false);
      expect(isValidCVSSVector('AV:X/AC:Y')).toBe(false);
    });
  });

  describe('getCVSSSeverityRating', () => {
    it('should return correct severity ratings', () => {
      expect(getCVSSSeverityRating(10.0)).toBe('Critical');
      expect(getCVSSSeverityRating(9.0)).toBe('Critical');
      expect(getCVSSSeverityRating(8.9)).toBe('High');
      expect(getCVSSSeverityRating(7.0)).toBe('High');
      expect(getCVSSSeverityRating(6.9)).toBe('Medium');
      expect(getCVSSSeverityRating(4.0)).toBe('Medium');
      expect(getCVSSSeverityRating(3.9)).toBe('Low');
      expect(getCVSSSeverityRating(0.1)).toBe('Low');
      expect(getCVSSSeverityRating(0.0)).toBe('None');
    });

    it('should handle boundary values', () => {
      expect(getCVSSSeverityRating(9.0)).toBe('Critical');
      expect(getCVSSSeverityRating(8.99)).toBe('High');
      expect(getCVSSSeverityRating(7.0)).toBe('High');
      expect(getCVSSSeverityRating(6.99)).toBe('Medium');
      expect(getCVSSSeverityRating(4.0)).toBe('Medium');
      expect(getCVSSSeverityRating(3.99)).toBe('Low');
      expect(getCVSSSeverityRating(0.1)).toBe('Low');
      expect(getCVSSSeverityRating(0.09)).toBe('None');
    });

    it('should handle negative values', () => {
      expect(getCVSSSeverityRating(-1)).toBe('None');
    });
  });

  describe('formatCVSSDisplay', () => {
    it('should format valid CVSS vectors', () => {
      const display = formatCVSSDisplay(
        'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'
      );
      expect(display).toMatch(/^\d+\.\d \(Critical\)$/);
    });

    it('should handle medium severity formatting', () => {
      const display = formatCVSSDisplay(
        'CVSS:3.1/AV:N/AC:H/PR:L/UI:R/S:U/C:L/I:L/A:L'
      );
      expect(display).toMatch(/^\d+\.\d \(Medium\)$/);
    });

    it('should return error message for invalid vectors', () => {
      expect(formatCVSSDisplay('')).toMatch(/^Invalid CVSS/);
      expect(formatCVSSDisplay('invalid')).toMatch(/^Invalid CVSS/);
      expect(formatCVSSDisplay('CVSS:3.1/invalid')).toMatch(/^Invalid CVSS/);
    });

    it('should provide specific error messages for different invalid cases', () => {
      expect(formatCVSSDisplay('')).toBe('Invalid CVSS: Empty vector');
      expect(formatCVSSDisplay('invalid')).toBe('Invalid CVSS: Bad format');
      expect(
        formatCVSSDisplay('CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')
      ).toBe('Invalid CVSS: CVSS 3.1 calculation returned invalid scores');
    });

    it('should format score to one decimal place', () => {
      const display = formatCVSSDisplay(
        'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'
      );
      const match = display.match(/^(\d+\.\d)/);
      expect(match).toBeTruthy();
      if (match) {
        const score = match[1];
        expect(score?.split('.')[1]).toHaveLength(1);
      }
    });
  });
});
