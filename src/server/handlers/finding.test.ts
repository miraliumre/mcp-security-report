import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FindingHandler } from './finding.js';
import { StorageManager } from '../storage/index.js';
import { Finding } from '../../types/index.js';
import {
  ProjectNotFoundError,
  FindingNotFoundError,
} from '../../types/index.js';
import { formatCVSSDisplay } from '../../utils/cvss.js';

// Mock dependencies
vi.mock('../storage/index.js');
vi.mock('../../utils/cvss.js');

const MockedStorageManager = vi.mocked(StorageManager);
const mockedFormatCVSSDisplay = vi.mocked(formatCVSSDisplay);

interface MockStorageManager extends Partial<StorageManager> {
  createFinding: ReturnType<typeof vi.fn>;
  listFindings: ReturnType<typeof vi.fn>;
  getFinding: ReturnType<typeof vi.fn>;
  updateFinding: ReturnType<typeof vi.fn>;
  deleteFinding: ReturnType<typeof vi.fn>;
}

describe('FindingHandler', () => {
  let findingHandler: FindingHandler;
  let mockStorage: MockStorageManager;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a mock storage instance
    mockStorage = {
      createFinding: vi.fn(),
      listFindings: vi.fn(),
      getFinding: vi.fn(),
      updateFinding: vi.fn(),
      deleteFinding: vi.fn(),
    };

    // Mock the constructor to return our mock
    MockedStorageManager.mockImplementation(() => mockStorage as any);

    // Mock CVSS formatting
    mockedFormatCVSSDisplay.mockReturnValue('7.5 (High)');

    findingHandler = new FindingHandler('/test/dir');
  });

  const mockFinding: Finding = {
    id: 'FIND-001',
    title: 'SQL Injection',
    severity: 'High',
    description: 'SQL injection vulnerability found',
    cvssScore: 7.5,
    cvssString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    cwe: 'CWE-89',
    components: ['login.php', 'database.php'],
    evidence: 'Proof of concept code',
    recommendations: 'Use parameterized queries',
    created: new Date('2024-01-01'),
    updated: new Date('2024-01-02'),
  };

  describe('createFinding', () => {
    it('should create finding successfully with valid input', async () => {
      mockStorage.createFinding.mockResolvedValue(mockFinding);

      const result = await findingHandler.createFinding({
        projectName: 'Test Project',
        title: 'SQL Injection',
        severity: 'High',
        description: 'SQL injection vulnerability found',
        cvssString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        cwe: 'CWE-89',
        components: ['login.php', 'database.php'],
        evidence: 'Proof of concept code',
        recommendations: 'Use parameterized queries',
      });

      expect(mockStorage.createFinding).toHaveBeenCalledWith('Test Project', {
        title: 'SQL Injection',
        severity: 'High',
        description: 'SQL injection vulnerability found',
        cvssString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        cwe: 'CWE-89',
        components: ['login.php', 'database.php'],
        evidence: 'Proof of concept code',
        recommendations: 'Use parameterized queries',
      });

      expect(result.content?.[0]?.text).toContain('Created finding: FIND-001');
      expect(result.content?.[0]?.text).toContain('Title: SQL Injection');
      expect(result.content?.[0]?.text).toContain('Severity: High');
    });

    it('should handle validation errors for invalid input', async () => {
      const result = await findingHandler.createFinding({
        projectName: 'Test Project',
        title: '', // Invalid: empty title
        severity: 'High',
        description: 'Test description',
      });

      expect(mockStorage.createFinding).not.toHaveBeenCalled();
      expect(result.content?.[0]?.text).toContain('Error MCP-1999:');
    });

    it('should handle project not found error', async () => {
      const error = new ProjectNotFoundError('Project not found');
      mockStorage.createFinding.mockRejectedValue(error);

      const result = await findingHandler.createFinding({
        projectName: 'Non-existent Project',
        title: 'Test Finding',
        severity: 'High',
        description: 'Test description',
      });

      expect(result.content?.[0]?.text).toContain('Error MCP-1001: Project');
      expect(result.content?.[0]?.text).toContain('not found');
    });

    it('should handle storage errors', async () => {
      const error = new Error('Storage failure');
      mockStorage.createFinding.mockRejectedValue(error);

      const result = await findingHandler.createFinding({
        projectName: 'Test Project',
        title: 'Test Finding',
        severity: 'High',
        description: 'Test description',
      });

      expect(result.content?.[0]?.text).toContain(
        'Error MCP-1999: Storage failure'
      );
    });

    it('should handle missing projectName', async () => {
      const result = await findingHandler.createFinding({
        title: 'Test Finding',
        severity: 'High',
        description: 'Test description',
      });

      expect(mockStorage.createFinding).not.toHaveBeenCalled();
      expect(result.content?.[0]?.text).toContain('Error MCP-1999:');
    });
  });

  describe('listFindings', () => {
    it('should list findings successfully', async () => {
      const mockFindings: Finding[] = [
        {
          ...mockFinding,
          id: 'FIND-001',
          title: 'SQL Injection',
          severity: 'High',
          cvssScore: 7.5,
          cwe: 'CWE-89',
        },
        {
          ...mockFinding,
          id: 'FIND-002',
          title: 'XSS Vulnerability',
          severity: 'Medium',
          cvssScore: 5.4,
          cwe: 'CWE-79',
        },
      ];

      mockStorage.listFindings.mockResolvedValue(mockFindings);

      const result = await findingHandler.listFindings({
        projectName: 'Test Project',
      });

      expect(mockStorage.listFindings).toHaveBeenCalledWith(
        'Test Project',
        {}
      );
      expect(result.content?.[0]?.text).toContain('Findings:');
      expect(result.content?.[0]?.text).toContain(
        'FIND-001: SQL Injection - High (CVSS: 7.5) [CWE-89]'
      );
      expect(result.content?.[0]?.text).toContain(
        'FIND-002: XSS Vulnerability - Medium (CVSS: 5.4) [CWE-79]'
      );
    });

    it('should handle findings without CVSS scores', async () => {
      const mockFindings: Finding[] = [
        {
          ...mockFinding,
          id: 'FIND-001',
          title: 'Information Disclosure',
          severity: 'Low',
          cvssScore: undefined,
          cwe: undefined,
        },
      ];

      mockStorage.listFindings.mockResolvedValue(mockFindings);

      const result = await findingHandler.listFindings({
        projectName: 'Test Project',
      });

      expect(result.content?.[0]?.text).toContain(
        'FIND-001: Information Disclosure - Low'
      );
      expect(result.content?.[0]?.text).not.toContain('CVSS:');
      expect(result.content?.[0]?.text).not.toContain('[CWE-');
    });

    it('should handle empty findings list', async () => {
      mockStorage.listFindings.mockResolvedValue([]);

      const result = await findingHandler.listFindings({
        projectName: 'Test Project',
      });

      expect(result.content?.[0]?.text).toContain('No findings found');
      expect(result.content?.[0]?.text).toContain(
        'Use create-finding to add your first finding'
      );
    });

    it('should handle project not found error', async () => {
      const error = new ProjectNotFoundError('Project not found');
      mockStorage.listFindings.mockRejectedValue(error);

      const result = await findingHandler.listFindings({
        projectName: 'Non-existent Project',
      });

      expect(result.content?.[0]?.text).toContain('Error MCP-1001: Project');
      expect(result.content?.[0]?.text).toContain('not found');
    });

    it('should handle validation errors', async () => {
      const result = await findingHandler.listFindings({
        // Missing projectName
      });

      expect(mockStorage.listFindings).not.toHaveBeenCalled();
      expect(result.content?.[0]?.text).toContain('Error MCP-1999:');
    });
  });

  describe('getFinding', () => {
    it('should get finding successfully', async () => {
      mockStorage.getFinding.mockResolvedValue(mockFinding);

      const result = await findingHandler.getFinding({
        projectName: 'Test Project',
        id: 'FIND-001',
      });

      expect(mockStorage.getFinding).toHaveBeenCalledWith(
        'Test Project',
        'FIND-001'
      );
      expect(result.content?.[0]?.text).toContain('Finding: FIND-001');
      expect(result.content?.[0]?.text).toContain('Title: SQL Injection');
      expect(result.content?.[0]?.text).toContain('CVSS: 7.5 (High)');
      expect(result.content?.[0]?.text).toContain('CWE: CWE-89');
      expect(result.content?.[0]?.text).toContain(
        'Components: login.php, database.php'
      );
      expect(result.content?.[0]?.text).toContain(
        'Evidence:\nProof of concept code'
      );
      expect(result.content?.[0]?.text).toContain(
        'Recommendations:\nUse parameterized queries'
      );
    });

    it('should handle finding not found error', async () => {
      const error = new FindingNotFoundError('Finding not found');
      mockStorage.getFinding.mockRejectedValue(error);

      const result = await findingHandler.getFinding({
        projectName: 'Test Project',
        id: 'FIND-999',
      });

      expect(result.content?.[0]?.text).toContain('Error MCP-1101: Finding');
      expect(result.content?.[0]?.text).toContain('not found');
    });

    it('should handle validation errors', async () => {
      const result = await findingHandler.getFinding({
        projectName: 'Test Project',
        // Missing id
      });

      expect(mockStorage.getFinding).not.toHaveBeenCalled();
      expect(result.content?.[0]?.text).toContain('Error MCP-1999:');
    });

    it('should format finding details correctly without optional fields', async () => {
      const simpleFinding: Finding = {
        id: 'FIND-002',
        title: 'Simple Finding',
        severity: 'Low',
        description: 'Basic description',
        created: new Date('2024-01-01'),
        updated: new Date('2024-01-02'),
      };

      mockStorage.getFinding.mockResolvedValue(simpleFinding);

      const result = await findingHandler.getFinding({
        projectName: 'Test Project',
        id: 'FIND-002',
      });

      expect(result.content?.[0]?.text).toContain('Title: Simple Finding');
      expect(result.content?.[0]?.text).toContain('Severity: Low');
      expect(result.content?.[0]?.text).toContain(
        'Description: Basic description'
      );
      expect(result.content?.[0]?.text).not.toContain('CVSS:');
      expect(result.content?.[0]?.text).not.toContain('CWE:');
      expect(result.content?.[0]?.text).not.toContain('Components:');
      expect(result.content?.[0]?.text).not.toContain('Evidence:');
      expect(result.content?.[0]?.text).not.toContain('Recommendations:');
    });
  });

  describe('updateFinding', () => {
    it('should update finding successfully', async () => {
      const updatedFinding: Finding = {
        ...mockFinding,
        title: 'Updated SQL Injection',
        severity: 'Critical',
      };

      mockStorage.updateFinding.mockResolvedValue(updatedFinding);

      const result = await findingHandler.updateFinding({
        projectName: 'Test Project',
        id: 'FIND-001',
        title: 'Updated SQL Injection',
        severity: 'Critical',
      });

      expect(mockStorage.updateFinding).toHaveBeenCalledWith(
        'Test Project',
        'FIND-001',
        {
          title: 'Updated SQL Injection',
          severity: 'Critical',
        }
      );

      expect(result.content?.[0]?.text).toContain('Updated finding: FIND-001');
      expect(result.content?.[0]?.text).toContain(
        'Title: Updated SQL Injection'
      );
      expect(result.content?.[0]?.text).toContain('Severity: Critical');
    });

    it('should handle partial updates', async () => {
      mockStorage.updateFinding.mockResolvedValue(mockFinding);

      await findingHandler.updateFinding({
        projectName: 'Test Project',
        id: 'FIND-001',
        severity: 'Critical',
        // Only updating severity, other fields undefined
      });

      expect(mockStorage.updateFinding).toHaveBeenCalledWith(
        'Test Project',
        'FIND-001',
        {
          severity: 'Critical',
        }
      );
    });

    it('should filter out undefined values', async () => {
      mockStorage.updateFinding.mockResolvedValue(mockFinding);

      await findingHandler.updateFinding({
        projectName: 'Test Project',
        id: 'FIND-001',
        title: 'New Title',
        severity: undefined,
        description: undefined,
      });

      expect(mockStorage.updateFinding).toHaveBeenCalledWith(
        'Test Project',
        'FIND-001',
        {
          title: 'New Title',
        }
      );
    });

    it('should handle finding not found error', async () => {
      const error = new FindingNotFoundError('Finding not found');
      mockStorage.updateFinding.mockRejectedValue(error);

      const result = await findingHandler.updateFinding({
        projectName: 'Test Project',
        id: 'FIND-999',
        title: 'Updated Title',
      });

      expect(result.content?.[0]?.text).toContain('Error MCP-1101: Finding');
      expect(result.content?.[0]?.text).toContain('not found');
    });

    it('should handle validation errors', async () => {
      const result = await findingHandler.updateFinding({
        projectName: 'Test Project',
        // Missing id
        title: 'Updated Title',
      });

      expect(mockStorage.updateFinding).not.toHaveBeenCalled();
      expect(result.content?.[0]?.text).toContain('Error MCP-1999:');
    });
  });

  describe('deleteFinding', () => {
    it('should delete finding successfully', async () => {
      mockStorage.deleteFinding.mockResolvedValue(undefined);

      const result = await findingHandler.deleteFinding({
        projectName: 'Test Project',
        id: 'FIND-001',
      });

      expect(mockStorage.deleteFinding).toHaveBeenCalledWith(
        'Test Project',
        'FIND-001'
      );
      expect(result.content?.[0]?.text).toBe('Deleted finding: FIND-001');
    });

    it('should handle finding not found error', async () => {
      const error = new FindingNotFoundError('Finding not found');
      mockStorage.deleteFinding.mockRejectedValue(error);

      const result = await findingHandler.deleteFinding({
        projectName: 'Test Project',
        id: 'FIND-999',
      });

      expect(result.content?.[0]?.text).toContain('Error MCP-1101: Finding');
      expect(result.content?.[0]?.text).toContain('not found');
    });

    it('should handle validation errors', async () => {
      const result = await findingHandler.deleteFinding({
        projectName: 'Test Project',
        // Missing id
      });

      expect(mockStorage.deleteFinding).not.toHaveBeenCalled();
      expect(result.content?.[0]?.text).toContain('Error MCP-1999:');
    });

    it('should handle storage errors', async () => {
      const error = new Error('Storage failure');
      mockStorage.deleteFinding.mockRejectedValue(error);

      const result = await findingHandler.deleteFinding({
        projectName: 'Test Project',
        id: 'FIND-001',
      });

      expect(result.content?.[0]?.text).toContain(
        'Error MCP-1999: Storage failure'
      );
    });
  });

  describe('buildFindingDetails', () => {
    it('should format all fields correctly', async () => {
      mockStorage.getFinding.mockResolvedValue(mockFinding);

      const result = await findingHandler.getFinding({
        projectName: 'Test Project',
        id: 'FIND-001',
      });

      const details = result.content?.[0]?.text;
      expect(details).toContain('Title: SQL Injection');
      expect(details).toContain('Severity: High');
      expect(details).toContain('CVSS: 7.5 (High)');
      expect(details).toContain('CWE: CWE-89');
      expect(details).toContain('Components: login.php, database.php');
      expect(details).toContain(
        'Description: SQL injection vulnerability found'
      );
      expect(details).toContain('Created: 2024-01-01T00:00:00.000Z');
      expect(details).toContain('Updated: 2024-01-02T00:00:00.000Z');
      expect(details).toContain('Evidence:\nProof of concept code');
      expect(details).toContain('Recommendations:\nUse parameterized queries');
    });

    it('should handle empty components array', async () => {
      const findingWithEmptyComponents: Finding = {
        ...mockFinding,
        components: [],
      };

      mockStorage.getFinding.mockResolvedValue(findingWithEmptyComponents);

      const result = await findingHandler.getFinding({
        projectName: 'Test Project',
        id: 'FIND-001',
      });

      expect(result.content?.[0]?.text).not.toContain('Components:');
    });
  });

  describe('constructor', () => {
    it('should create storage manager with working directory', () => {
      new FindingHandler('/custom/dir');
      expect(MockedStorageManager).toHaveBeenCalledWith('/custom/dir');
    });

    it('should create storage manager without directory', () => {
      new FindingHandler();
      expect(MockedStorageManager).toHaveBeenCalledWith(undefined);
    });
  });
});
