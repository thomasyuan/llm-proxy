import { ProxyServer } from "./proxy/server.js";
import { Router } from "./proxy/router.js";
import { ProviderRegistry } from "./providers/registry.js";
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);

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

  const registry = new ProviderRegistry();
  const router = new Router(registry, [ACTIVE_PROVIDER]);
  const server = new ProxyServer(router, registry, { host: HOST, port: PORT });

  await server.start();

  process.on("SIGINT", () => {
    void server.stop().then(() => process.exit(0));
  });
}

void main();
