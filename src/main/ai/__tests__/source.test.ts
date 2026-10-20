import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normaliseSourcePath, readSource, searchSource } from "../source";

let root: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "slv-src-"));
  outside = mkdtempSync(join(tmpdir(), "slv-outside-"));
  mkdirSync(join(root, "chrome/browser/ash/net"), { recursive: true });
  writeFileSync(
    join(root, "chrome/browser/ash/net/wifi.cc"),
    Array.from({ length: 60 }, (_, i) =>
      i === 41 ? `  LOG(ERROR) << "Wi-Fi disconnected, reason " << reason;` : `// line ${i + 1}`
    ).join("\n")
  );
  writeFileSync(join(outside, "secret.txt"), "do not read");
  symlinkSync(outside, join(root, "escape"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "chrome"], { cwd: root });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("source tools", () => {
  it("turns a log's source location into a checkout path", () => {
    expect(normaliseSourcePath("../../chrome/browser/ash/net/wifi.cc:42")).toEqual({
      path: "chrome/browser/ash/net/wifi.cc",
      line: 42
    });
    expect(normaliseSourcePath("ui/base/x.cc")).toEqual({ path: "ui/base/x.cc", line: null });
  });

  it("reads around the line a log points at", () => {
    const text = readSource(root, "../../chrome/browser/ash/net/wifi.cc:42", null, 2);
    expect(text).toContain("chrome/browser/ash/net/wifi.cc (lines 37-47 of 60)");
    expect(text).toContain('    42>   LOG(ERROR) << "Wi-Fi disconnected');
  });

  it("refuses paths that leave the checkout, including through symlinks", () => {
    expect(readSource(root, "../../../etc/passwd", 1, 5)).toMatch(/^Not found/);
    expect(readSource(root, "escape/secret.txt", 1, 5)).toMatch(/^Not found/);
  });

  it("greps the checkout within a path", async () => {
    expect(await searchSource(root, "disconnected, reason", "chrome/browser")).toContain(
      "chrome/browser/ash/net/wifi.cc:42:"
    );
    expect(await searchSource(root, "nothing-like-this", "chrome")).toBe("No matches.");
  });
});
