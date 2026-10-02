import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { Provider } from "../src/types.js";

function makeProvider(overrides?: Partial<Provider>): Provider {
  return {
    id: "test-provider",
    name: "Test",
    baseUrl: "https://api.example.com/v1",
    apiFormat: "openai",
    keys: [
      { value: "key-1", status: "active" },
      { value: "key-2", status: "active" },
      { value: "key-3", status: "exhausted", failedAt: new Date().toISOString() },
    ],
    models: ["model-a"],
    ...overrides,
  };
}

describe("ProviderRegistry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = `/tmp/llm-proxy-test-${Date.now()}`;
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it("should load providers from file", () => {
    const provider = makeProvider();
    fs.writeFileSync(path.join(tmpDir, "providers.json"), JSON.stringify([provider]));

    const reg = new ProviderRegistry(tmpDir);
    expect(reg.get("test-provider")).toBeDefined();
  });

  it("should add a new provider and persist", () => {
    const reg = new ProviderRegistry(tmpDir);
    const p = makeProvider({ id: "new" });
    reg.add(p);
    expect(reg.get("new")).toBeDefined();

    // Verify persistence
    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, "providers.json"), "utf-8"));
    expect(raw).toHaveLength(1);
  });

  it("should return first active key index", () => {
    const reg = new ProviderRegistry(tmpDir);
    reg.add(makeProvider());
    expect(reg.nextKeyIndex("test-provider")).toBe(0);
  });

  it("should skip exhausted keys and return next active", () => {
    const p = makeProvider();
    p.keys[0].status = "exhausted";
    p.keys[0].failedAt = new Date().toISOString();
    const reg = new ProviderRegistry(tmpDir);
    reg.add(p);
    expect(reg.nextKeyIndex("test-provider")).toBe(1);
  });

  it("should return -1 when all keys exhausted", () => {
    const p = makeProvider();
    p.keys[0].status = "exhausted";
    p.keys[1].status = "exhausted";
    p.keys[2].status = "exhausted";
    const reg = new ProviderRegistry(tmpDir);
    reg.add(p);
    expect(reg.nextKeyIndex("test-provider")).toBe(-1);
  });

  it("should rotate key on failure", () => {
    const reg = new ProviderRegistry(tmpDir);
    reg.add(makeProvider());
    reg.rotateKey("test-provider", 0);
    const p = reg.get("test-provider")!;
    expect(p.keys[0].status).toBe("exhausted");
    expect(p.keys[0].failedAt).toBeDefined();
  });

  it("should detect all exhausted", () => {
    const p = makeProvider();
    p.keys[0].status = "exhausted";
    p.keys[1].status = "exhausted";
    p.keys[2].status = "exhausted";
    const reg = new ProviderRegistry(tmpDir);
    reg.add(p);
    expect(reg.allExhausted("test-provider")).toBe(true);
  });

  it("should not detect all exhausted when one active remains", () => {
    const reg = new ProviderRegistry(tmpDir);
    reg.add(makeProvider());
    expect(reg.allExhausted("test-provider")).toBe(false);
  });

  it("should remove a provider", () => {
    const reg = new ProviderRegistry(tmpDir);
    reg.add(makeProvider());
    reg.remove("test-provider");
    expect(reg.get("test-provider")).toBeUndefined();
  });

  it("should list all providers", () => {
    const reg = new ProviderRegistry(tmpDir);
    reg.add(makeProvider({ id: "a" }));
    reg.add(makeProvider({ id: "b" }));
    expect(reg.list()).toHaveLength(2);
  });
});
