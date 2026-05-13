import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import fse from "fs-extra";
import { runImport } from "../../src/commands/import.js";
import { ensureGitRoot, makeTempProject, readFile } from "../helpers.js";

describe("commands/import", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("imports rules with overwrite strategy", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await ensureGitRoot(root);
    await fse.ensureDir(path.join(root, ".ai", "rules"));
    await fse.ensureDir(path.join(root, ".cursor", "rules"));
    await fse.writeFile(
      path.join(root, ".cursor", "rules", "from-cursor.mdc"),
      "---\ndescription: cursor-side\n---\n\nbody\n",
      "utf8",
    );
    const code = await runImport({
      cwd: root,
      source: "cursor",
      strategies: { rules: "overwrite" },
      syncAfter: false,
    });
    expect(code).toBe(0);
    const text = await readFile(root, ".ai/rules/from-cursor.md");
    expect(text).toContain("description: cursor-side");
  });

  it("strips _managedBy from imported JSON", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await ensureGitRoot(root);
    await fse.ensureDir(path.join(root, ".ai"));
    await fse.ensureDir(path.join(root, ".claude"));
    await fse.writeFile(
      path.join(root, ".claude", "mcp.json"),
      JSON.stringify(
        { _managedBy: "managed by agent-config-sync", mcpServers: { x: {} } },
        null,
        2,
      ),
      "utf8",
    );
    const code = await runImport({
      cwd: root,
      source: "claude",
      strategies: { mcp: "overwrite" },
      syncAfter: false,
    });
    expect(code).toBe(0);
    const data = JSON.parse(await readFile(root, ".ai/mcp.json"));
    expect(data._managedBy).toBeUndefined();
    expect(data.mcpServers).toEqual({ x: {} });
  });

  it("tolerates a UTF-8 BOM in editor-side JSON", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await ensureGitRoot(root);
    await fse.ensureDir(path.join(root, ".ai"));
    await fse.ensureDir(path.join(root, ".cursor"));
    const body = JSON.stringify(
      { mcpServers: { demo: { command: "node" } } },
      null,
      2,
    );
    await fse.writeFile(
      path.join(root, ".cursor", "mcp.json"),
      "\uFEFF" + body,
      "utf8",
    );
    const code = await runImport({
      cwd: root,
      source: "cursor",
      strategies: { mcp: "overwrite" },
      syncAfter: false,
    });
    expect(code).toBe(0);
    const data = JSON.parse(await readFile(root, ".ai/mcp.json"));
    expect(data.mcpServers).toEqual({ demo: { command: "node" } });
  });

  it("merge strategy does not overwrite existing .ai content", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await ensureGitRoot(root);
    await fse.ensureDir(path.join(root, ".ai", "skills"));
    await fse.writeFile(
      path.join(root, ".ai", "skills", "shared.md"),
      "original\n",
      "utf8",
    );
    await fse.ensureDir(path.join(root, ".qoder", "skills"));
    await fse.writeFile(
      path.join(root, ".qoder", "skills", "shared.md"),
      "incoming\n",
      "utf8",
    );
    await fse.writeFile(
      path.join(root, ".qoder", "skills", "extra.md"),
      "extra\n",
      "utf8",
    );
    const code = await runImport({
      cwd: root,
      source: "qoder",
      strategies: { skills: "merge" },
      syncAfter: false,
    });
    expect(code).toBe(0);
    expect(await readFile(root, ".ai/skills/shared.md")).toBe("original\n");
    expect(await readFile(root, ".ai/skills/extra.md")).toBe("extra\n");
  });
});
