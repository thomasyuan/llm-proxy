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
    const decision: RoutingDecision | null = this.router.resolve();

    if (!decision) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No active provider available" }));
      return;
    }

    const { provider, keyIndex, format: _format, authHeader } = decision;
    const targetUrl = new URL(provider.baseUrl);

    const headers: Record<string, string> = {
      "Authorization": authHeader,
      "Content-Type": req.headers["content-type"] ?? "application/json",
    };

    const isHttps = targetUrl.protocol === "https:";
    const mod = isHttps ? require("https") : http;

    const upstreamReq = mod.request({
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers,
    }, (upstreamRes: http.IncomingMessage) => {
      const chunks: Buffer[] = [];
      upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
      upstreamRes.on("end", () => {
        const data = Buffer.concat(chunks);
        const status = upstreamRes.statusCode ?? 500;
        if (status >= 400) {
          this.router.handleFailure(keyIndex);
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(data);
          return;
        }
        res.writeHead(200, { "Content-Type": upstreamRes.headers["content-type"] ?? "application/json" });
        res.end(data);
      });
    });

    upstreamReq.on("error", (err: Error) => {
      this.router.handleFailure(keyIndex);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Upstream request failed", detail: err.message }));
    });

    upstreamReq.end(body);
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
