import * as http from "http";
import type { AddressInfo } from "net";
import type { Router } from "./router.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { RoutingDecision } from "../types.js";

interface ServerOptions {
  host: string;
  port: number;
}

export class ProxyServer {
  private server: http.Server | null = null;
  private router: Router;
  private registry: ProviderRegistry;
  private opts: ServerOptions;

  constructor(router: Router, registry: ProviderRegistry, opts: ServerOptions) {
    this.router = router;
    this.registry = registry;
    this.opts = opts;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      this.server.listen(this.opts.port, this.opts.host, () => {
        const addr = this.server?.address() as AddressInfo;
        console.log(JSON.stringify({
          event: "proxy_started",
          host: addr.address,
          port: addr.port,
        }));
        resolve();
      });
      this.server.on("error", reject);
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await readBody(req);
    let lastError: { status: number; data: Buffer } | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const decision: RoutingDecision | null = await this.router.resolve();
      if (!decision) {
        if (lastError) {
          res.writeHead(lastError.status, { "Content-Type": "application/json" });
          res.end(lastError.data);
        } else {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No active provider available" }));
        }
        return;
      }

      const { providerId, provider, keyIndex, authHeader } = decision;
      const targetUrl = new URL(provider.baseUrl);

      const headers: Record<string, string> = {
        "Authorization": authHeader,
        "Content-Type": req.headers["content-type"] ?? "application/json",
      };

      const isHttps = targetUrl.protocol === "https:";
      const mod = isHttps ? require("https") : http;

      const result = await this.forwardRequest(mod, {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers,
      }, body);

      if (result.status < 400) {
        res.writeHead(result.status, { "Content-Type": result.headers["content-type"] ?? "application/json" });
        res.end(result.data);
        return;
      }

      this.router.handleFailure(providerId, keyIndex);
      lastError = { status: result.status, data: result.data };
    }

    if (lastError) {
      res.writeHead(lastError.status, { "Content-Type": "application/json" });
      res.end(lastError.data);
    }
  }

  private forwardRequest(mod: typeof http | typeof import("https"), options: Record<string, unknown>, body: string): Promise<{ status: number; data: Buffer; headers: Record<string, string> }> {
    return new Promise((resolve) => {
      const upstreamReq = mod.request(options as never, (upstreamRes: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstreamRes.on("end", () => {
          resolve({ status: upstreamRes.statusCode ?? 500, data: Buffer.concat(chunks), headers: upstreamRes.headers as Record<string, string> });
        });
      });
      upstreamReq.on("error", (err: Error) => {
        resolve({ status: 502, data: Buffer.from(JSON.stringify({ error: "Upstream request failed", detail: err.message })), headers: { "content-type": "application/json" } });
      });
      upstreamReq.end(body);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
