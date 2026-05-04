import { describe, expect, it } from "vitest";
import { sha256 } from "../src/hash.js";

describe("sha256", () => {
  it("is deterministic", () => {
    const a = sha256("https://example.com/");
    const b = sha256("https://example.com/");
    expect(a).toBe(b);
  });

  it("produces a 64-char lowercase hex digest", () => {
    const h = sha256("anything");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differentiates similar inputs", () => {
    expect(sha256("https://a.example/")).not.toBe(sha256("https://b.example/"));
    expect(sha256("https://a.example/")).not.toBe(sha256("https://a.example"));
  });

  it("matches the canonical SHA-256 of an empty string", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
