import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AppConfig } from "../types.js";

export class AppRegistry {
  private apps: Map<string, AppConfig> = new Map();
  private configDir: string;
  private filePath: string;

  constructor(configDir?: string) {
    this.configDir = configDir ?? path.join(os.homedir(), ".llm-proxy");
    this.filePath = path.join(this.configDir, "apps.json");
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const data: AppConfig[] = JSON.parse(raw);
      for (const a of data) {
        this.apps.set(a.id, a);
      }
    }
  }

  private save(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    const data = Array.from(this.apps.values());
    const tmpPath = this.filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }

  add(app: AppConfig): void {
    this.apps.set(app.id, app);
    this.save();
  }

  remove(id: string): void {
    this.apps.delete(id);
    this.save();
  }

  get(id: string): AppConfig | undefined {
    return this.apps.get(id);
  }

  list(): AppConfig[] {
    return Array.from(this.apps.values());
  }

  persist(): void {
    this.save();
  }
}
