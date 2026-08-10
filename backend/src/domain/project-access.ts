import { In, Repository } from "typeorm";

import { ProjectMembership, type ProjectRole } from "../entities/project-membership.entity";
import { Project } from "../entities/project.entity";
import { User } from "../entities/user.entity";
import { HttpError } from "../errors";
import { ProjectsService } from "./projects";

export class ProjectAccessService {
  constructor(
    private readonly membershipRepository: Repository<ProjectMembership>,
    private readonly userRepository: Repository<User>,
    private readonly projectRepository: Repository<Project>,
    private readonly projectsService: ProjectsService,
  ) {}

  private normalizeUserId(value: string | number): number {
    const userId = typeof value === "string" ? parseInt(value, 10) : value;
    if (!Number.isInteger(userId) || userId <= 0) throw new HttpError(400, "INVALID_USER_ID", "Invalid user id");
    return userId;
  }

  async ensureDefaultProjectMemberships(): Promise<void> {
    // Memberships are assigned explicitly during bootstrap or by project owners.
    // Never recreate accounts with predictable email addresses on application start.
  }

  async listProjectMembers(projectId: string) {
    await this.ensureDefaultProjectMemberships();
    const resolvedProjectId = await this.projectsService.resolveProjectId(projectId);
    const members = await this.membershipRepository.find({
      where: { projectId: resolvedProjectId },
      relations: ["user", "project"],
      order: { createdAt: "ASC" },
    });
    return members.map((m) => ({
      userId: m.userId,
      userName: m.user?.name || "Unknown",
      userEmail: m.user?.email || "unknown@example.com",
      projectId: m.projectId,
      projectName: m.project?.name || "Unknown project",
      projectRole: m.projectRole,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    }));
  }

  async assignProjectMember(projectId: string, dto: { userId: string | number; projectRole: ProjectRole }) {
    const resolvedProjectId = await this.projectsService.resolveProjectId(projectId);
    const userId = this.normalizeUserId(dto.userId);

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");

    const project = await this.projectRepository.findOne({ where: { id: resolvedProjectId } });
    if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");

    let membership = await this.membershipRepository.findOne({ where: { userId, projectId: resolvedProjectId } });
    if (membership) {
      membership.projectRole = dto.projectRole;
    } else {
      membership = this.membershipRepository.create({ userId, projectId: resolvedProjectId, projectRole: dto.projectRole });
    }

    const saved = await this.membershipRepository.save(membership);
    return {
      userId: saved.userId,
      userName: user.name,
      userEmail: user.email,
      projectId: resolvedProjectId,
      projectName: project.name,
      projectRole: saved.projectRole,
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  async getProjectMember(projectId: string, userIdInput: string | number): Promise<ProjectMembership | null> {
    const resolvedProjectId = await this.projectsService.resolveProjectId(projectId);
    const userId = this.normalizeUserId(userIdInput);
    return this.membershipRepository.findOne({ where: { userId, projectId: resolvedProjectId } });
  }

  async removeProjectMember(projectId: string, userIdInput: string | number) {
    const resolvedProjectId = await this.projectsService.resolveProjectId(projectId);
    const userId = this.normalizeUserId(userIdInput);
    const membership = await this.membershipRepository.findOne({ where: { userId, projectId: resolvedProjectId } });
    if (!membership) throw new HttpError(404, "MEMBER_NOT_FOUND", "Project member not found");
    await this.membershipRepository.remove(membership);
    return { success: true, userId, projectId: resolvedProjectId };
  }

  async listUserProjectAccess(userIdInput?: string | number) {
    await this.ensureDefaultProjectMemberships();
    const userFilter = userIdInput !== undefined && userIdInput !== null ? this.normalizeUserId(userIdInput) : null;
    const users = await this.userRepository.find({ where: userFilter ? { id: userFilter } : {}, order: { id: "ASC" } });
    if (users.length === 0) return [];

    const userIds = users.map((u) => u.id);
    const memberships = await this.membershipRepository.find({
      where: { userId: In(userIds) },
      relations: ["project"],
      order: { createdAt: "ASC" },
    });

    const membershipsByUser = new Map<number, ProjectMembership[]>();
    for (const m of memberships) {
      const list = membershipsByUser.get(m.userId) ?? [];
      list.push(m);
      membershipsByUser.set(m.userId, list);
    }

    return users.map((u) => ({
      userId: u.id,
      userName: u.name,
      userEmail: u.email,
      platformRole: u.role,
      memberships: (membershipsByUser.get(u.id) ?? []).map((m) => ({
        projectId: m.projectId,
        projectName: m.project?.name || "Unknown project",
        projectRole: m.projectRole,
        isArchived: Boolean(m.project?.isArchived),
      })),
    }));
  }

  async hasProjectAccess(userIdInput: string | number, projectId: string, requiredRoles: ProjectRole[] = ["viewer", "maintainer", "owner"]): Promise<boolean> {
    await this.ensureDefaultProjectMemberships();
    const userId = this.normalizeUserId(userIdInput);
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) return false;
    if (user.role === "admin") return true;
    const resolvedProjectId = await this.projectsService.resolveProjectId(projectId);
    const membership = await this.membershipRepository.findOne({ where: { userId, projectId: resolvedProjectId } });
    if (!membership) return false;
    return requiredRoles.includes(membership.projectRole);
  }
}
