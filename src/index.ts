import { ProxyServer } from "./proxy/server.js";
import { Router } from "./proxy/router.js";
import { ProviderRegistry } from "./providers/registry.js";
import { AppRegistry } from "./apps/registry.js";
import { writeAppConfig } from "./apps/writer.js";
import { subscriptionAdd, subscriptionRemove, subscriptionStatus } from "./cli/subscription.js";

const HOST = process.env.LLM_PROXY_HOST ?? "127.0.0.1";
const PORT = parseInt(process.env.LLM_PROXY_PORT ?? "8899", 10);
const ACTIVE_PROVIDER = process.env.LLM_PROXY_ACTIVE_PROVIDER ?? "default";

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      result[key] = args[i + 1];
      i++;
    }
  }
  return result;
}

const HELP_TEXT = `llm-proxy — Local LLM proxy server with multi-provider failover

Usage:
  llm-proxy                    Start the proxy server
  llm-proxy --help             Show this help
  llm-proxy subscription add --provider <id> --type <type> --token <tok> [--refresh-token <rt>] [--refresh-url <url>]
  llm-proxy subscription remove --provider <id>
  llm-proxy subscription status --provider <id>
  llm-proxy app add --id <id> --name <name> --config-path <path> --config-type <json|toml>
  llm-proxy app remove --id <id>
  llm-proxy app list

Environment:
  LLM_PROXY_HOST       Proxy bind address (default: 127.0.0.1)
  LLM_PROXY_PORT       Proxy port (default: 8899)
  LLM_PROXY_ACTIVE_PROVIDER  Active provider id (default: default)
  LLM_PROXY_HOME       Config directory (default: <home>/.llm-proxy)
  CODEX_HOME           Codex config directory (default: <home>/.codex)`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (args.length > 0 && args[0] === "subscription") {
    const subCommand = args[1];
    const flags = parseArgs(args.slice(2));

    switch (subCommand) {
      case "add":
        subscriptionAdd({
          provider: flags.provider!,
          type: flags.type!,
          token: flags.token!,
          refreshToken: flags["refresh-token"],
          refreshUrl: flags["refresh-url"],
        });
        return;
      case "remove":
        subscriptionRemove({ provider: flags.provider! });
        return;
      case "status":
        subscriptionStatus({ provider: flags.provider! });
        return;
      default:
        console.error(`Unknown subscription command: ${subCommand}`);
        process.exit(1);
    }
  }

  if (args.length > 0 && args[0] === "app") {
    const subCommand = args[1];
    const flags = parseArgs(args.slice(2));
    const appRegistry = new AppRegistry();

    switch (subCommand) {
      case "add": {
        const app = {
          id: flags.id!,
          name: flags.name ?? flags.id!,
          configPath: flags["config-path"]!,
          configType: (flags["config-type"] ?? "json") as "json" | "toml",
          proxySetting: { url: "__PROXY_URL__", key: "__PROXY_KEY__" },
        };
        appRegistry.add(app);
        console.log(`App "${app.id}" registered`);
        return;
      }
      case "remove":
        appRegistry.remove(flags.id!);
        console.log(`App "${flags.id}" removed`);
        return;
      case "list": {
        const apps = appRegistry.list();
        if (apps.length === 0) {
          console.log("No apps registered.");
        } else {
          for (const a of apps) {
            console.log(`${a.id} — ${a.name} (${a.configType}) ${a.configPath}`);
          }
        }
        return;
      }
      default:
        console.error(`Unknown app command: ${subCommand}`);
        process.exit(1);
    }
  }

  const registry = new ProviderRegistry();
  const router = new Router(registry, [ACTIVE_PROVIDER]);
  const server = new ProxyServer(router, registry, { host: HOST, port: PORT });

  await server.start();

  process.on("SIGINT", () => {
    void server.stop().then(() => process.exit(0));
  });
}

void main();
