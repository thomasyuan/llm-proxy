import { ProxyServer } from "./proxy/server.js";
import { Router } from "./proxy/router.js";
import { ProviderRegistry } from "./providers/registry.js";

const HOST = process.env.LLM_PROXY_HOST ?? "127.0.0.1";
const PORT = parseInt(process.env.LLM_PROXY_PORT ?? "8899", 10);
const ACTIVE_PROVIDER = process.env.LLM_PROXY_ACTIVE_PROVIDER ?? "default";

async function main(): Promise<void> {
  const registry = new ProviderRegistry();
  const router = new Router(registry, ACTIVE_PROVIDER);
  const server = new ProxyServer(router, registry, { host: HOST, port: PORT });

  await server.start();

  process.on("SIGINT", () => {
    void server.stop().then(() => process.exit(0));
  });
}

void main();
