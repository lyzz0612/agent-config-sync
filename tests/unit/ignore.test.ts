import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import fse from "fs-extra";
import {
  applyManagedBlock,
  buildManagedBlock,
  DEFAULT_IGNORE_LINES,
  IGNORE_BEGIN,
  IGNORE_END,
  updateVcsIgnore,
} from "../../src/core/ignore.js";
import { ensureGitRoot, makeTempProject } from "../helpers.js";

describe("core/ignore", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("builds a managed block delimited by sentinel markers", () => {
    const block = buildManagedBlock(["foo", "bar"]);
    expect(block.startsWith(IGNORE_BEGIN)).toBe(true);
    expect(block.endsWith(IGNORE_END)).toBe(true);
    expect(block).toContain("foo");
    expect(block).toContain("bar");
  });

  it("applies the block to an empty file", () => {
    const block = buildManagedBlock(["a"]);
    const out = applyManagedBlock(null, block);
    expect(out.created).toBe(true);
    expect(out.next.includes(IGNORE_BEGIN)).toBe(true);
  });

  it("is idempotent on repeated application", () => {
    const block = buildManagedBlock(["a"]);
    const first = applyManagedBlock("keep me\n", block);
    expect(first.changed).toBe(true);
    const second = applyManagedBlock(first.next, block);
    expect(second.changed).toBe(false);
    expect(second.next).toBe(first.next);
  });

  it("rewrites the block in place without touching outside content", () => {
    const block = buildManagedBlock(["new"]);
    const existing = `keep
${IGNORE_BEGIN}
old
${IGNORE_END}
trailing
`;
    const out = applyManagedBlock(existing, block);
    expect(out.next.startsWith("keep")).toBe(true);
    expect(out.next.includes("new")).toBe(true);
    expect(out.next.includes("old")).toBe(false);
    expect(out.next.includes("trailing")).toBe(true);
  });

  it("updateVcsIgnore writes the project gitignore via upward scan", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await ensureGitRoot(root);
    const nested = path.join(root, "packages", "pkg-a");
    await fse.ensureDir(nested);
    const updates = await updateVcsIgnore(nested);
    expect(updates).toHaveLength(1);
    expect(updates[0].changed).toBe(true);
    const text = await fse.readFile(path.join(root, ".gitignore"), "utf8");
    for (const line of DEFAULT_IGNORE_LINES) {
      expect(text).toContain(line);
    }
    expect(text).not.toMatch(/\.ai\/?\b/);
  });
});
