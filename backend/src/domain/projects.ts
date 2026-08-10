import { randomUUID } from "crypto";
import { DataSource, Repository } from "typeorm";

import { Project } from "../entities/project.entity";
import { HttpError } from "../errors";

const DEFAULT_PROJECT_ID = "default";
const DEFAULT_PROJECT_NAME = "Default Project";
const DEFAULT_PROJECT_KEY = "default";
const DASHBOARD_SETTINGS_KEY_PREFIX = "dashboards";
export class ProjectsService {
  constructor(
    private readonly projectRepository: Repository<Project>,
    private readonly dataSource: DataSource,
  ) {}

  private async getProjectByIdIncludingArchived(id: string): Promise<Project> {
    const normalized = id?.trim();
    if (!normalized) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");

    const project = await this.projectRepository.findOne({ where: { id: normalized } });
    if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
    return project;
  }

  private slugifyKey(value: string): string {
    const normalized = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return normalized.length > 0 ? normalized : "project";
  }

  private async ensureUniqueKey(baseKey: string, currentProjectId?: string): Promise<string> {
    let candidate = baseKey;
    let index = 1;
    while (true) {
      const existing = await this.projectRepository.findOne({ where: { key: candidate } });
      if (!existing || (currentProjectId && existing.id === currentProjectId)) return candidate;
      candidate = `${baseKey}-${index}`;
      index += 1;
    }
  }

  async ensureDefaultProject(): Promise<Project> {
    let project = await this.projectRepository.findOne({ where: { id: DEFAULT_PROJECT_ID } });

    if (!project) {
      project = this.projectRepository.create({
        id: DEFAULT_PROJECT_ID,
        name: DEFAULT_PROJECT_NAME,
        key: DEFAULT_PROJECT_KEY,
        description: "System default project for legacy and shared data",
        isDefault: true,
        isArchived: false,
      });
      project = await this.projectRepository.save(project);
    }

    if (!project.isDefault || project.isArchived) {
      project.isDefault = true;
      project.isArchived = false;
      project = await this.projectRepository.save(project);
    }

    await this.projectRepository.createQueryBuilder()
      .update(Project)
      .set({ isDefault: false })
      .where("id <> :id", { id: project.id })
      .andWhere("isDefault = true")
      .execute();

    return project;
  }

  async resolveProjectId(projectId?: string): Promise<string> {
    const normalized = projectId?.trim();

    if (!normalized || normalized === "default") {
      const defaultProject = await this.ensureDefaultProject();
      return defaultProject.id;
    }

    const existing = await this.projectRepository.findOne({ where: { id: normalized } });
    if (!existing) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
    if (existing.isArchived) throw new HttpError(400, "PROJECT_ARCHIVED", "Project is archived");
    return existing.id;
  }

  async getProjectById(id: string): Promise<Project> {
    const resolvedId = await this.resolveProjectId(id);
    const project = await this.projectRepository.findOne({ where: { id: resolvedId } });
    if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
    return project;
  }

  async listProjects(includeArchived = false): Promise<Project[]> {
    await this.ensureDefaultProject();
    return this.projectRepository.find({
      where: includeArchived ? {} : { isArchived: false },
      order: { isDefault: "DESC", name: "ASC" },
    });
  }

  async createProject(dto: { name: string; key?: string; description?: string; isDefault?: boolean }): Promise<Project> {
    const name = dto.name?.trim();
    if (!name) throw new HttpError(400, "PROJECT_VALIDATION", "Project name is required");

    await this.ensureDefaultProject();
    const baseKey = this.slugifyKey(dto.key?.trim() || name);
    const key = await this.ensureUniqueKey(baseKey);

    const project = this.projectRepository.create({
      id: randomUUID(),
      name,
      key,
      description: dto.description?.trim() || null,
      isArchived: false,
      isDefault: Boolean(dto.isDefault),
    });

    const saved = await this.projectRepository.save(project);
    if (saved.isDefault) {
      await this.projectRepository.createQueryBuilder()
        .update(Project)
        .set({ isDefault: false })
        .where("id <> :id", { id: saved.id })
        .execute();
    }

    return this.getProjectById(saved.id);
  }

  async updateProject(id: string, dto: { name?: string; key?: string; description?: string; isArchived?: boolean; isDefault?: boolean }): Promise<Project> {
    const project = await this.getProjectById(id);

    if (typeof dto.name === "string") {
      const name = dto.name.trim();
      if (!name) throw new HttpError(400, "PROJECT_VALIDATION", "Project name cannot be empty");
      project.name = name;
    }
    if (typeof dto.key === "string") {
      project.key = await this.ensureUniqueKey(this.slugifyKey(dto.key), project.id);
    }
    if (typeof dto.description === "string") {
      project.description = dto.description.trim() || null;
    }
    if (typeof dto.isArchived === "boolean") {
      if (project.isDefault && dto.isArchived) throw new HttpError(400, "PROJECT_VALIDATION", "Default project cannot be archived");
      project.isArchived = dto.isArchived;
    }
    if (typeof dto.isDefault === "boolean") {
      project.isDefault = dto.isDefault;
      if (dto.isDefault) project.isArchived = false;
    }

    const saved = await this.projectRepository.save(project);
    if (saved.isDefault) {
      await this.projectRepository.createQueryBuilder()
        .update(Project)
        .set({ isDefault: false })
        .where("id <> :id", { id: saved.id })
        .execute();
    }

    return this.getProjectById(saved.id);
  }

  async archiveProject(id: string): Promise<Project> {
    const project = await this.getProjectById(id);
    if (project.isDefault) throw new HttpError(400, "PROJECT_VALIDATION", "Default project cannot be archived");
    project.isArchived = true;
    project.isDefault = false;
    await this.projectRepository.save(project);
    return this.getProjectById(project.id);
  }

  async deleteProjectPermanently(id: string): Promise<Project> {
    const project = await this.getProjectByIdIncludingArchived(id);
    if (project.isDefault) throw new HttpError(400, "PROJECT_VALIDATION", "Default project cannot be deleted");

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM "notification_delivery" WHERE "projectId" = $1`, [project.id]);
      await manager.query(`DELETE FROM "test_run" WHERE "projectId" = $1`, [project.id]);
      await manager.query(
        `DELETE FROM "settings" WHERE "key" LIKE $1 OR "key" = $2 OR "key" = $3 OR "key" = $4`,
        [
          `${DASHBOARD_SETTINGS_KEY_PREFIX}:${project.id}:%`,
          `notifications:destinations:${project.id}`,
          `notifications:rules:${project.id}`,
          `notifications:templates:${project.id}`,
        ],
      );
      await manager.delete(Project, { id: project.id });
    });

    return project;
  }
}
