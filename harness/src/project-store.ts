import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Project } from "./types.js";

interface ProjectData {
  projects: Project[];
}

export class ProjectStore {
  private filePath: string;
  private data: ProjectData;

  constructor(filePath: string) {
    this.filePath = filePath;
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      this.data = JSON.parse(raw);
    } else {
      this.data = { projects: [] };
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  register(project: Project): void {
    const idx = this.data.projects.findIndex((p) => p.name === project.name);
    if (idx >= 0) {
      this.data.projects[idx] = project;
    } else {
      this.data.projects.push(project);
    }
    this.persist();
  }

  get(name: string): Project | undefined {
    return this.data.projects.find((p) => p.name === name);
  }

  getAll(): Project[] {
    return this.data.projects;
  }

  remove(name: string): boolean {
    const before = this.data.projects.length;
    this.data.projects = this.data.projects.filter((p) => p.name !== name);
    if (this.data.projects.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }
}
