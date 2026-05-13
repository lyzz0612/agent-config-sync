import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import fse from "fs-extra";
import { runSync } from "../../src/commands/sync.js";
import { isSymlinkTo } from "../../src/core/symlink.js";
import {
  canCreateSymlinks,
  ensureGitRoot,
  exists,
  makeTempProject,
  readFile,
  scaffoldAi,
} from "../helpers.js";

/**
 * Assert that `editorRel` was produced by sync from `aiRel`. Sync now produces
 * one of three shapes depending on the platform / type:
 *   1. The file itself is a symlink that resolves to the source under .ai/.
 *   2. The file lives inside a directory link -- it is a regular file but its
 *      content is byte-identical to the source under .ai/.
 *   3. The platform refused to create any link, so the file is a managed copy
 *      that contains both the source body and a `managed by ...` marker.
 */
async function expectManagedReflection(
  root: string,
  editorRel: string,
  aiRel: string,
): Promise<void> {
  const editorAbs = path.join(root, editorRel);
  const aiAbs = path.join(root, aiRel);

  const lstat = await fse.lstat(editorAbs);
  if (lstat.isSymbolicLink()) {
    expect(
      await isSymlinkTo(editorAbs, aiAbs),
      `${editorRel} symlink does not resolve to ${aiRel}`,
    ).toBe(true);
    return;
  }

  const editorText = await fse.readFile(editorAbs, "utf8");
  const aiText = await fse.readFile(aiAbs, "utf8");

  if (editorText === aiText) {
    // File reached us through a parent directory link -- byte-equal mirror.
    return;
  }

  // Fall-back: it's a managed copy with a marker injected near the top. The
  // exact whitespace differs from the source (the marker line is inserted
  // after any frontmatter), so we verify the marker is present and that the
  // first non-empty body line of the source survives intact.
  expect(
    editorText,
    `${editorRel} is neither a symlink, a dir-link mirror, nor a managed copy of ${aiRel}`,
  ).toContain("managed by agent-config-sync");
  const firstSourceBodyLine = aiText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line !== "---" && !line.includes(":"));
  if (firstSourceBodyLine) {
    expect(editorText).toContain(firstSourceBodyLine);
  }
}

describe("commands/sync", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  async function makeFixture(): Promise<string> {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await ensureGitRoot(root);
    await scaffoldAi(root);
    await fse.ensureDir(path.join(root, ".cursor"));
    await fse.ensureDir(path.join(root, ".codex"));
    return root;
  }

  it("writes managed files into every detected editor", async () => {
    const root = await makeFixture();
    const result = await runSync({ cwd: root });
    expect(result.exitCode).toBe(0);
    expect(await exists(root, ".cursor/rules/style.mdc")).toBe(true);
    expect(await exists(root, ".cursor/mcp.json")).toBe(true);
    expect(await exists(root, ".codex/config.toml")).toBe(true);
    await expectManagedReflection(
      root,
      ".cursor/rules/style.mdc",
      ".ai/rules/style.md",
    );
    await expectManagedReflection(
      root,
      ".cursor/skills/demo.md",
      ".ai/skills/demo.md",
    );
    await expectManagedReflection(
      root,
      ".codex/skills/demo.md",
      ".ai/skills/demo.md",
    );
    // mcp / hooks.json are still transformed copies (need _managedBy injection)
    const cursorMcp = await readFile(root, ".cursor/mcp.json");
    expect(cursorMcp).toContain("_managedBy");
    const codexConfig = await readFile(root, ".codex/config.toml");
    expect(codexConfig).toContain("# managed by agent-config-sync");
  });

  it("respects --editor", async () => {
    const root = await makeFixture();
    const result = await runSync({ cwd: root, editor: "cursor" });
    expect(result.exitCode).toBe(0);
    expect(await exists(root, ".cursor/rules/style.mdc")).toBe(true);
    expect(await exists(root, ".codex/rules/style.md")).toBe(false);
    expect(await exists(root, ".codex/config.toml")).toBe(false);
  });

  it("--dry-run does not touch the filesystem", async () => {
    const root = await makeFixture();
    const result = await runSync({ cwd: root, dryRun: true });
    expect(result.exitCode).toBe(0);
    expect(await exists(root, ".cursor/rules/style.mdc")).toBe(false);
  });

  it("skips conflicts and exits non-zero", async () => {
    const root = await makeFixture();
    await fse.ensureDir(path.join(root, ".cursor", "rules"));
    await fse.writeFile(
      path.join(root, ".cursor", "rules", "style.mdc"),
      "hand-written\n",
      "utf8",
    );
    const result = await runSync({ cwd: root });
    expect(result.exitCode).toBe(2);
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(await readFile(root, ".cursor/rules/style.mdc")).toBe(
      "hand-written\n",
    );
  });

  it("--force overwrites unmanaged files", async () => {
    const root = await makeFixture();
    await fse.ensureDir(path.join(root, ".cursor", "rules"));
    await fse.writeFile(
      path.join(root, ".cursor", "rules", "style.mdc"),
      "hand-written\n",
      "utf8",
    );
    const result = await runSync({ cwd: root, force: true });
    expect(result.exitCode).toBe(0);
    const filePath = path.join(root, ".cursor/rules/style.mdc");
    const lstat = await fse.lstat(filePath);
    if (lstat.isSymbolicLink()) {
      expect(
        await isSymlinkTo(filePath, path.join(root, ".ai/rules/style.md")),
      ).toBe(true);
      // Hand-written content should be gone -- the symlink target is the .ai/ source.
      const content = await fse.readFile(filePath, "utf8");
      expect(content).not.toContain("hand-written");
    } else {
      const text = await fse.readFile(filePath, "utf8");
      expect(text).toContain("managed by agent-config-sync");
      expect(text).not.toContain("hand-written");
    }
  });

  it("re-running sync is idempotent", async () => {
    const root = await makeFixture();
    await runSync({ cwd: root });
    const result = await runSync({ cwd: root });
    expect(result.exitCode).toBe(0);
    for (const summary of result.summaries) {
      for (const r of summary.results) {
        expect(["unchanged", "written"]).toContain(r.outcome);
      }
    }
  });

  it("uses directory links for passthrough types", async () => {
    const root = await makeFixture();
    const result = await runSync({ cwd: root });
    expect(result.exitCode).toBe(0);

    // Directory-level link: skills / hooks dirs become a single junction or
    // dir symlink pointing back to the matching .ai/ directory. A junction on
    // Windows requires no special privilege, so this path should work even
    // without Developer Mode.
    for (const rel of [
      ".cursor/skills",
      ".cursor/hooks",
      ".codex/skills",
      ".codex/hooks",
      ".codex/rules",
    ]) {
      const abs = path.join(root, rel);
      const lstat = await fse.lstat(abs);
      expect(
        lstat.isSymbolicLink(),
        `${rel} should be a directory link`,
      ).toBe(true);
    }

    // Cursor rules need a .md -> .mdc rename, so they must stay file-level.
    // When the platform also allows file symlinks we get a symlink; otherwise
    // a managed copy is acceptable.
    if (await canCreateSymlinks()) {
      const lstat = await fse.lstat(
        path.join(root, ".cursor/rules/style.mdc"),
      );
      expect(lstat.isSymbolicLink()).toBe(true);
    }

    // mcp.json / hooks.json / config.toml / hooks.toml are content-transformed
    // and remain regular files.
    for (const rel of [
      ".cursor/mcp.json",
      ".cursor/hooks.json",
      ".codex/config.toml",
      ".codex/hooks.toml",
    ]) {
      const abs = path.join(root, rel);
      const lstat = await fse.lstat(abs);
      expect(lstat.isSymbolicLink(), `${rel} should be a regular file`).toBe(
        false,
      );
    }
  });

  it("editor-side files reflect .ai/ source after edits", async () => {
    const root = await makeFixture();
    await runSync({ cwd: root });

    // Update the source skill file under .ai/ and re-sync.
    await fse.writeFile(
      path.join(root, ".ai", "skills", "demo.md"),
      "# Demo skill v2\n",
      "utf8",
    );
    const result = await runSync({ cwd: root });
    expect(result.exitCode).toBe(0);

    // Whether the editor side is a symlink or a managed copy, reading it must
    // return the current .ai/ source content (modulo a possible marker line).
    const cursorBody = await readFile(root, ".cursor/skills/demo.md");
    expect(cursorBody).toContain("# Demo skill v2");
    const codexBody = await readFile(root, ".codex/skills/demo.md");
    expect(codexBody).toContain("# Demo skill v2");
  });
});
