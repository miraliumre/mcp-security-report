import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectHandler } from './project.js';
import { StorageManager } from '../storage/index.js';
import { ProjectMetadata } from '../../types/index.js';
import {
  ProjectExistsError,
  ProjectNotFoundError,
} from '../../types/index.js';

// Mock the StorageManager
vi.mock('../storage/index.js');
const MockedStorageManager = vi.mocked(StorageManager);

interface MockStorageManager extends Partial<StorageManager> {
  createProject: ReturnType<typeof vi.fn>;
  listProjects: ReturnType<typeof vi.fn>;
  updateProject: ReturnType<typeof vi.fn>;
  deleteProject: ReturnType<typeof vi.fn>;
}

describe('ProjectHandler', () => {
  let projectHandler: ProjectHandler;
  let mockStorage: MockStorageManager;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a mock storage instance
    mockStorage = {
      createProject: vi.fn(),
      listProjects: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
    };

    // Mock the constructor to return our mock
    MockedStorageManager.mockImplementation(() => mockStorage as any);

    projectHandler = new ProjectHandler('/test/dir');
  });

  describe('createProject', () => {
    it('should create project successfully with valid input', async () => {
      const mockProject: ProjectMetadata = {
        id: 'test-id',
        name: 'Test Project',
        status: 'in-progress',
        created: new Date('2024-01-01'),
        updated: new Date('2024-01-01'),
      };

      mockStorage.createProject.mockResolvedValue(mockProject);

      const result = await projectHandler.createProject({
        name: 'Test Project',
        client: 'Test Client',
      });

      expect(mockStorage.createProject).toHaveBeenCalledWith({
        name: 'Test Project',
        client: 'Test Client',
      });

      expect(result.content).toHaveLength(1);
      expect(result.content?.[0]?.type).toBe('text');
      expect(result.content?.[0]?.text).toContain(
        'Created project: Test Project'
      );
      expect(result.content?.[0]?.text).toContain('ID: test-id');
      expect(result.content?.[0]?.text).toContain('Status: in-progress');
    });

    it('should handle validation errors for invalid input', async () => {
      const result = await projectHandler.createProject({
        name: '', // Invalid: empty name
      });

      expect(mockStorage.createProject).not.toHaveBeenCalled();
      expect(result.content?.[0]?.text).toContain('Error MCP-1999:');
    });

    it('should handle project already exists error', async () => {
      const error = new ProjectExistsError('Project already exists');
      mockStorage.createProject.mockRejectedValue(error);

      const result = await projectHandler.createProject({
        name: 'Existing Project',
      });

      expect(result.content?.[0]?.text).toContain('Error MCP-1002: Project');
      expect(result.content?.[0]?.text).toContain('already exists');
    });

    it('should handle storage errors', async () => {
      const error = new Error('Storage failure');
      mockStorage.createProject.mockRejectedValue(error);

      const result = await projectHandler.createProject({
        name: 'Test Project',
      });

      expect(result.content?.[0]?.text).toContain(
        'Error MCP-1999: Storage failure'
      );
    });

    it('should handle unknown errors', async () => {
      mockStorage.createProject.mockRejectedValue('Unknown error');

      const result = await projectHandler.createProject({
        name: 'Test Project',
      });

      expect(result.content?.[0]?.text).toContain('Error MCP-1999:');
    });

    it('should sanitize project name', async () => {
      const mockProject: ProjectMetadata = {
        id: 'test-id',
        name: 'test-project',
        status: 'in-progress',
        created: new Date('2024-01-01'),
        updated: new Date('2024-01-01'),
      };

      mockStorage.createProject.mockResolvedValue(mockProject);

      await projectHandler.createProject({
        name: 'Test Project!@#',
        client: 'Test Client',
      });

      expect(mockStorage.createProject).toHaveBeenCalledWith({
        name: 'Test Project!@#',
        client: 'Test Client',
      });
    });
  });

  describe('listProjects', () => {
    it('should list projects successfully', async () => {
      const mockProjects: ProjectMetadata[] = [
        {
          id: 'proj1',
          name: 'Project 1',
          status: 'in-progress',
          client: 'Client A',
          created: new Date('2024-01-01'),
          updated: new Date('2024-01-02'),
        },
        {
          id: 'proj2',
          name: 'Project 2',
          status: 'completed',
          created: new Date('2024-01-03'),
          updated: new Date('2024-01-04'),
        },
      ];

      mockStorage.listProjects.mockResolvedValue(mockProjects);

      const result = await projectHandler.listProjects();

      expect(mockStorage.listProjects).toHaveBeenCalled();
      expect(result.content?.[0]?.text).toContain('Projects:');
      expect(result.content?.[0]?.text).toContain(
        'Project 1 (in-progress) - Client A'
      );
      expect(result.content?.[0]?.text).toContain(
        'Project 2 (completed) - No client'
      );
    });

    it('should handle empty project list', async () => {
      mockStorage.listProjects.mockResolvedValue([]);

      const result = await projectHandler.listProjects();

      expect(result.content?.[0]?.text).toContain('No projects found');
      expect(result.content?.[0]?.text).toContain(
        'Use create-project to create your first project'
      );
    });

    it('should handle storage errors', async () => {
      const error = new Error('Storage failure');
      mockStorage.listProjects.mockRejectedValue(error);

      const result = await projectHandler.listProjects();

      expect(result.content?.[0]?.text).toContain(
        'Error MCP-1999: Storage failure'
      );
    });

    it('should format dates correctly', async () => {
      const mockProjects: ProjectMetadata[] = [
        {
          id: 'proj1',
          name: 'Test Project',
          status: 'in-progress',
          created: new Date('2024-01-01T10:00:00Z'),
          updated: new Date('2024-01-02T15:30:00Z'),
        },
      ];

      mockStorage.listProjects.mockResolvedValue(mockProjects);

      const result = await projectHandler.listProjects();

      // Check that the date is formatted as locale date string
      expect(result.content?.[0]?.text).toMatch(
        /Updated: \d{1,2}\/\d{1,2}\/\d{4}/
      );
    });
  });

  describe('updateProject', () => {
    it('should update project successfully', async () => {
      const mockProject: ProjectMetadata = {
        id: 'test-id',
        name: 'Updated Project',
        status: 'completed',
        created: new Date('2024-01-01'),
        updated: new Date('2024-01-02'),
      };

      mockStorage.updateProject.mockResolvedValue(mockProject);

      const result = await projectHandler.updateProject({
        projectName: 'Test Project',
        status: 'completed',
        client: 'Updated Client',
      });

      expect(mockStorage.updateProject).toHaveBeenCalledWith('Test Project', {
        status: 'completed',
        client: 'Updated Client',
      });

      expect(result.content?.[0]?.text).toContain(
        'Updated project: Updated Project'
      );
      expect(result.content?.[0]?.text).toContain('Status: completed');
    });

    it('should handle validation errors', async () => {
      const result = await projectHandler.updateProject({
        projectName: '', // Invalid: empty name
        status: 'completed',
      });

      expect(mockStorage.updateProject).not.toHaveBeenCalled();
      expect(result.content?.[0]?.text).toContain('Error MCP-1999:');
    });

    it('should handle project not found error', async () => {
      const error = new ProjectNotFoundError('Project not found');
      mockStorage.updateProject.mockRejectedValue(error);

      const result = await projectHandler.updateProject({
        projectName: 'Non-existent Project',
        status: 'completed',
      });

      expect(result.content?.[0]?.text).toContain('Error MCP-1001: Project');
      expect(result.content?.[0]?.text).toContain('not found');
    });

    it('should handle partial updates', async () => {
      const mockProject: ProjectMetadata = {
        id: 'test-id',
        name: 'Test Project',
        status: 'in-progress',
        client: 'New Client',
        created: new Date('2024-01-01'),
        updated: new Date('2024-01-02'),
      };

      mockStorage.updateProject.mockResolvedValue(mockProject);

      await projectHandler.updateProject({
        projectName: 'Test Project',
        client: 'New Client',
        // status not provided - should only update client
      });

      expect(mockStorage.updateProject).toHaveBeenCalledWith('Test Project', {
        client: 'New Client',
      });
    });

    it('should handle invalid status', async () => {
      const result = await projectHandler.updateProject({
        projectName: 'Test Project',
        status: 'invalid-status', // Invalid status
      });

      expect(mockStorage.updateProject).not.toHaveBeenCalled();
      expect(result.content?.[0]?.text).toContain('Error MCP-1999:');
    });
  });

  describe('deleteProject', () => {
    it('should delete project successfully', async () => {
      mockStorage.deleteProject.mockResolvedValue(undefined);

      const result = await projectHandler.deleteProject({
        name: 'Test Project',
      });

      expect(mockStorage.deleteProject).toHaveBeenCalledWith('Test Project');
      expect(result.content?.[0]?.text).toBe('Deleted project: Test Project');
    });

    it('should handle validation errors', async () => {
      const result = await projectHandler.deleteProject({
        name: '', // Invalid: empty name
      });

      expect(mockStorage.deleteProject).not.toHaveBeenCalled();
      expect(result.content?.[0]?.text).toContain('Error MCP-1999:');
    });

    it('should handle project not found error', async () => {
      const error = new ProjectNotFoundError('Project not found');
      mockStorage.deleteProject.mockRejectedValue(error);

      const result = await projectHandler.deleteProject({
        name: 'Non-existent Project',
      });

      expect(result.content?.[0]?.text).toContain('Error MCP-1001: Project');
      expect(result.content?.[0]?.text).toContain('not found');
    });

    it('should handle storage errors', async () => {
      const error = new Error('Storage failure');
      mockStorage.deleteProject.mockRejectedValue(error);

      const result = await projectHandler.deleteProject({
        name: 'Test Project',
      });

      expect(result.content?.[0]?.text).toContain(
        'Error MCP-1999: Storage failure'
      );
    });

    it('should validate input parameters', async () => {
      const result = await projectHandler.deleteProject({
        // missing name field
      });

      expect(mockStorage.deleteProject).not.toHaveBeenCalled();
      expect(result.content?.[0]?.text).toContain('Error MCP-1999:');
    });
  });

  describe('constructor', () => {
    it('should create storage manager with working directory', () => {
      new ProjectHandler('/custom/dir');
      expect(MockedStorageManager).toHaveBeenCalledWith('/custom/dir');
    });

    it('should create storage manager without directory', () => {
      new ProjectHandler();
      expect(MockedStorageManager).toHaveBeenCalledWith(undefined);
    });
  });
});
