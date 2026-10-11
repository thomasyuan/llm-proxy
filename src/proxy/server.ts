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
    // Handle /v1/models discovery
    if (req.url === "/v1/models" || req.url === "/models") {
      const models = await this.collectModels();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: models }));
      return;
    }

    const body = await readBody(req);
    let model: string | undefined;
    try {
      const parsed = JSON.parse(body);
      model = parsed.model;
    } catch { /* no model in body */ }

    let lastError: { status: number; data: Buffer } | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const decision: RoutingDecision | null = await this.router.resolve(model);
      if (!decision) {
        if (lastError) {
          res.writeHead(lastError.status, { "Content-Type": "application/json" });
          res.end(lastError.data);
        } else if (model) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `No provider supports model "${model}"` }));
        } else {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No active provider available" }));
        }
        return;
      }

      const { providerId, provider, keyIndex, authHeader } = decision;
      const targetUrl = new URL(provider.baseUrl);

      // Forward to provider baseUrl + original request path
      const reqPath = req.url ?? "/";
      let forwardPath: string;
      if (reqPath.startsWith("/v1/")) {
        // Client already includes /v1 prefix — replace provider's /v1 if present
        forwardPath = targetUrl.pathname.replace(/\/v1\/?$/, "") + reqPath;
      } else {
        // Client sends /chat/completions etc — prepend provider's base path
        forwardPath = (targetUrl.pathname.replace(/\/$/, "") + reqPath) || "/";
      }

      const headers: Record<string, string> = {
        "Content-Type": req.headers["content-type"] ?? "application/json",
      };
      if (authHeader) {
        headers["Authorization"] = authHeader;
      }

      const isHttps = targetUrl.protocol === "https:";
      const mod = isHttps ? require("https") : http;

      const result = await this.forwardRequest(mod, {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: forwardPath,
        method: req.method,
        headers,
      }, body);

      if (result.status < 400) {
        this.router.handleSuccess(providerId);
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

  private async collectModels(): Promise<Array<{ id: string; object: string }>> {
    const seen = new Set<string>();
    for (const id of this.router.getProviderOrder()) {
      const provider = this.registry.get(id);
      if (!provider) continue;
      if (this.registry.isDegraded(id)) continue;
      for (const m of provider.models) {
        if (m === "*") {
          seen.add(`${id}:*`);
        } else {
          seen.add(m);
        }
      }
    }
    const results: Array<{ id: string; object: string }> = [];
    for (const m of seen) {
      if (m.endsWith(":*")) {
        const providerId = m.slice(0, -2);
        const provider = this.registry.get(providerId);
        if (provider) {
          try {
            const url = new URL(provider.baseUrl);
            const mod = url.protocol === "https:" ? require("https") : http;
            const upstreamModels = await this.fetchUpstreamModels(mod, url);
            for (const um of upstreamModels) {
              results.push({ id: um, object: "model" });
            }
          } catch {
            // skip
          }
        }
      } else {
        results.push({ id: m, object: "model" });
      }
    }
    return results;
  }

  private fetchUpstreamModels(mod: typeof http | typeof import("https"), baseUrl: URL): Promise<string[]> {
    const path = baseUrl.pathname.replace(/\/$/, "") + "/models";
    return new Promise((resolve) => {
      const req = mod.request({
        hostname: baseUrl.hostname,
        port: baseUrl.port || (baseUrl.protocol === "https:" ? 443 : 80),
        path,
        method: "GET",
      }, (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            resolve((data.data ?? []).map((m: { id: string }) => m.id));
          } catch {
            resolve([]);
          }
        });
      });
      req.on("error", () => resolve([]));
      req.end();
    });
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
