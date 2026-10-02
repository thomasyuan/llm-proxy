import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const CODEX_CONFIG = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "config.toml");

export interface CodexProxySetting {
  providerId: string;
  baseUrl: string;
  apiKey: string;
}

export function writeCodexConfig(setting: CodexProxySetting): void {
  if (!fs.existsSync(CODEX_CONFIG)) {
    throw new Error(`Codex config not found: ${CODEX_CONFIG}`);
  }

  const content = fs.readFileSync(CODEX_CONFIG, "utf-8");

  // Remove existing [model_providers.proxy] section if present
  const cleaned = removeTomlSection(content, "model_providers.proxy");

  // Set model_provider to "proxy"
  const withProvider = setModelProvider(cleaned, "proxy");

  // Add [model_providers.proxy] section
  const section = `[model_providers.${setting.providerId}]\n` +
    `name = "${setting.providerId}"\n` +
    `base_url = "${setting.baseUrl}"\n` +
    `wire_api = "responses"\n` +
    `requires_openai_auth = false\n` +
    `experimental_bearer_token = "${setting.apiKey}"`;

  const final = withProvider.trimEnd() + "\n\n" + section + "\n";
  fs.writeFileSync(CODEX_CONFIG, final);
}

function removeTomlSection(content: string, sectionName: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (line.trim().startsWith(`[${sectionName}]`)) {
      inSection = true;
      continue;
    }
    if (inSection && line.trim() === "") {
      inSection = false;
      continue;
    }
    if (!inSection) {
      result.push(line);
    }
  }
  return result.join("\n");
}

function setModelProvider(content: string, provider: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let found = false;

  for (const line of lines) {
    if (line.startsWith("model_provider")) {
      result.push(`model_provider = "${provider}"`);
      found = true;
    } else {
      result.push(line);
    }
  }

  if (!found) {
    result.unshift(`model_provider = "${provider}"`);
  }

  return result.join("\n");
}
