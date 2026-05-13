import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import fse from "fs-extra";
import { runSync } from "../../src/commands/sync.js";
import {
  ensureGitRoot,
  exists,
  makeTempProject,
  readFile,
  scaffoldAi,
} from "../helpers.js";

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
    const rule = await readFile(root, ".cursor/rules/style.mdc");
    expect(rule).toContain("managed by agent-config-sync");
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
    const text = await readFile(root, ".cursor/rules/style.mdc");
    expect(text).toContain("managed by agent-config-sync");
    expect(text).not.toContain("hand-written");
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
});
