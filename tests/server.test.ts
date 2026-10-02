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

describe("ProxyServer", () => {
  let tmpDir: string;
  let registry: ProviderRegistry;
  let router: Router;
  let server: ProxyServer;
  let upstream: http.Server;

  beforeEach(async () => {
    tmpDir = `/tmp/llm-proxy-server-test-${Date.now()}`;
    registry = new ProviderRegistry(tmpDir);
    registry.add(makeProvider());
    router = new Router(registry, "test");
    server = new ProxyServer(router, registry, { host: "127.0.0.1", port: 8901 });

    // Mock upstream server
    upstream = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    upstream.listen(9999);
  });

  afterEach(async () => {
    await server.stop();
    upstream.close();
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
        port: 8901,
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
        port: 8901,
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
    // Set up two keys, first one will get a 429
    const p = makeProvider({
      keys: [
        { value: "key-1", status: "active" },
        { value: "key-2", status: "active" },
      ],
    });
    registry.remove("test");
    registry.add(p);

    // Mock upstream that returns 429 for first key, 200 for second
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
    mockUpstream.listen(9998);

    // Update provider to use mock upstream
    const p2 = makeProvider({ baseUrl: "http://127.0.0.1:9998/v1" });
    registry.remove("test");
    registry.add(p2);
    router.setProvider("test");

    await server.start();

    // First request should get 429 and trigger rotation
    const r1 = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request({ hostname: "127.0.1", port: 8901, path: "/v1", method: "POST" }, (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve({ status: res.statusCode! }));
      });
      req.on("error", reject);
      req.end("{}");
    });

    expect(r1.status).toBe(429);
    // Key should now be exhausted
    const provider = registry.get("test")!;
    expect(provider.keys[0].status).toBe("exhausted");

    mockUpstream.close();
  });
});
