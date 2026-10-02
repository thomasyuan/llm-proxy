import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "http";
import type { AddressInfo } from "net";
import { ProxyServer } from "../src/proxy/server.js";
import { Router } from "../src/proxy/router.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { Provider } from "../src/types.js";

function makeProvider(overrides?: Partial<Provider>): Provider {
  return {
    id: "test",
    name: "Test",
    baseUrl: "http://127.0.0.1:9999/v1",
    apiFormat: "openai",
    keys: [{ value: "test-key", status: "active" }],
    models: ["m1"],
    ...overrides,
  };
}

let portCounter = 8900;

describe("ProxyServer", () => {
  let tmpDir: string;
  let registry: ProviderRegistry;
  let router: Router;
  let server: ProxyServer;
  let upstream: http.Server;
  let proxyPort: number;
  let upstreamPort: number;

  beforeEach(async () => {
    tmpDir = `/tmp/llm-proxy-server-test-${Date.now()}`;
    proxyPort = ++portCounter;
    upstreamPort = ++portCounter;
    registry = new ProviderRegistry(tmpDir);
    registry.add(makeProvider({ baseUrl: `http://127.0.0.1:${upstreamPort}/v1` }));
    router = new Router(registry, "test");
    server = new ProxyServer(router, registry, { host: "127.0.0.1", port: proxyPort });

    upstream = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(upstreamPort, "127.0.0.1", () => resolve());
    });
  });

  afterEach(async () => {
    await server.stop();
    await new Promise((resolve) => upstream.close(resolve));
  });

  it("should start and stop cleanly", async () => {
    await server.start();
    expect(server).toBeDefined();
    await server.stop();
  });

  it("should forward request to upstream", async () => {
    await server.start();

    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: proxyPort,
        path: "/v1/chat/completions",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }));
      });
      req.on("error", reject);
      req.end(JSON.stringify({ model: "m1", messages: [] }));
    });

    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ ok: true });
  });

  it("should return 503 when no provider available", async () => {
    registry.remove("test");
    router.setProvider("nonexistent");
    await server.start();

    const result = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port: proxyPort,
        path: "/v1/chat/completions",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }, (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve({ status: res.statusCode! }));
      });
      req.on("error", reject);
      req.end("{}");
    });

    expect(result.status).toBe(503);
  });

  it("should rotate key on upstream 429", async () => {
    const mockUpstreamPort = ++portCounter;
    let requestCount = 0;
    const mockUpstream = http.createServer((req, res) => {
      requestCount++;
      if (requestCount === 1) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "rate limited" }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }
    });
    await new Promise<void>((resolve, reject) => {
      mockUpstream.once("error", reject);
      mockUpstream.listen(mockUpstreamPort, "127.0.0.1", () => resolve());
    });

    const p2 = makeProvider({ baseUrl: `http://127.0.0.1:${mockUpstreamPort}/v1`, keys: [
        { value: "key-1", status: "active" },
        { value: "key-2", status: "active" },
      ]});
    registry.remove("test");
    registry.add(p2);
    router.setProvider("test");

    await server.start();

    const r1 = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port: proxyPort, path: "/v1", method: "POST" }, (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve({ status: res.statusCode! }));
      });
      req.on("error", reject);
      req.end("{}");
    });

    expect(r1.status).toBe(429);
    const provider = registry.get("test")!;
    expect(provider.keys[0].status).toBe("exhausted");

    await new Promise((resolve) => mockUpstream.close(resolve));
  });

  it("should use subscription token for auth", async () => {
    const subProvider = makeProvider({
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      subscription: { type: "github_copilot" as const, token: "sub-token-abc" },
    });
    registry.remove("test");
    registry.add(subProvider);

    let capturedAuth = "";
    const subUpstream = http.createServer((req, res) => {
      capturedAuth = req.headers["authorization"] ?? "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const subPort = ++portCounter;
    await new Promise<void>((resolve, reject) => {
      subUpstream.once("error", reject);
      subUpstream.listen(subPort, "127.0.0.1", () => resolve());
    });

    registry.remove("test");
    registry.add(makeProvider({
      baseUrl: `http://127.0.0.1:${subPort}/v1`,
      subscription: { type: "github_copilot" as const, token: "sub-token-abc" },
    }));

    await server.start();

    const result = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port: proxyPort, path: "/v1", method: "POST" }, (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve({ status: res.statusCode! }));
      });
      req.on("error", reject);
      req.end("{}");
    });

    expect(result.status).toBe(200);
    expect(capturedAuth).toBe("Bearer sub-token-abc");

    await new Promise((resolve) => subUpstream.close(resolve));
  });

  it("should return 503 when subscription is expired", async () => {
    const expiredProvider = makeProvider({
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      subscription: {
        type: "openai_subscription" as const,
        token: "expired-token",
        expiresAt: new Date(Date.now() - 60000).toISOString(),
      },
    });
    registry.remove("test");
    registry.add(expiredProvider);

    await server.start();

    const result = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port: proxyPort, path: "/v1", method: "POST" }, (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve({ status: res.statusCode! }));
      });
      req.on("error", reject);
      req.end("{}");
    });

    expect(result.status).toBe(503);
  });
});
