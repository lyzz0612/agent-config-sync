import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import fse from "fs-extra";
import {
  isManaged,
  safeWrite,
  withMarker,
} from "../../src/core/conflict.js";
import { MANAGED_MARK } from "../../src/types.js";
import { makeTempProject } from "../helpers.js";

describe("core/conflict", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("adds an HTML marker by default", () => {
    const out = withMarker("hello\n");
    expect(out.startsWith("<!--")).toBe(true);
    expect(isManaged(out)).toBe(true);
  });

  it("places the marker after frontmatter", () => {
    const out = withMarker("---\nfoo: 1\n---\nbody\n");
    const lines = out.split(/\r?\n/);
    expect(lines[0]).toBe("---");
    expect(lines[1]).toBe("foo: 1");
    expect(lines[2]).toBe("---");
    expect(lines[3]).toContain(MANAGED_MARK);
  });

  it("safeWrite creates a missing file with the marker", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    const target = path.join(root, "a.md");
    const r = await safeWrite(target, "hello\n");
    expect(r.outcome).toBe("written");
    const written = await fse.readFile(target, "utf8");
    expect(isManaged(written)).toBe(true);
  });

  it("safeWrite skips unmanaged existing files by default", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    const target = path.join(root, "a.md");
    await fse.writeFile(target, "human edit\n", "utf8");
    const r = await safeWrite(target, "new content\n");
    expect(r.outcome).toBe("skipped-conflict");
    const current = await fse.readFile(target, "utf8");
    expect(current).toBe("human edit\n");
  });

  it("safeWrite force-overwrites with --force", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    const target = path.join(root, "a.md");
    await fse.writeFile(target, "human edit\n", "utf8");
    const r = await safeWrite(target, "new content\n", { force: true });
    expect(r.outcome).toBe("forced");
    const current = await fse.readFile(target, "utf8");
    expect(isManaged(current)).toBe(true);
  });

  it("safeWrite leaves a managed file untouched when the body is identical", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    const target = path.join(root, "a.md");
    const first = await safeWrite(target, "body\n");
    expect(first.outcome).toBe("written");
    const second = await safeWrite(target, "body\n");
    expect(second.outcome).toBe("unchanged");
  });

  it("safeWrite updates a managed file when content changes", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    const target = path.join(root, "a.md");
    await safeWrite(target, "body v1\n");
    const r = await safeWrite(target, "body v2\n");
    expect(r.outcome).toBe("updated");
    const current = await fse.readFile(target, "utf8");
    expect(current).toContain("body v2");
  });

  it("safeWrite dry-run does not touch the filesystem", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    const target = path.join(root, "a.md");
    const r = await safeWrite(target, "body\n", { dryRun: true });
    expect(r.outcome).toBe("skipped-dry-run");
    expect(await fse.pathExists(target)).toBe(false);
  });

  it("isManaged still detects a marker after UTF-8 BOM", () => {
    const text = "\uFEFF" + withMarker("body\n");
    expect(isManaged(text)).toBe(true);
  });
});
