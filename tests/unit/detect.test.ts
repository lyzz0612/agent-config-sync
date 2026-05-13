import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import fse from "fs-extra";
import {
  detectConfigTypes,
  detectEditors,
  detectProject,
  findProjectRoot,
} from "../../src/core/detect.js";
import { ensureGitRoot, makeTempProject, scaffoldAi } from "../helpers.js";

describe("core/detect", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("findProjectRoot walks up to a .git directory", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await ensureGitRoot(root);
    const nested = path.join(root, "packages", "pkg-a");
    await fse.ensureDir(nested);
    expect(await findProjectRoot(nested)).toBe(path.resolve(root));
  });

  it("findProjectRoot falls back to the starting directory without VCS metadata", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    expect(await findProjectRoot(root)).toBe(path.resolve(root));
  });

  it("detectEditors only reports directories that exist", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await fse.ensureDir(path.join(root, ".cursor"));
    await fse.ensureDir(path.join(root, ".qoder"));
    const editors = await detectEditors(root);
    expect(editors.sort()).toEqual(["cursor", "qoder"]);
  });

  it("detectConfigTypes ignores empty subdirectories", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await fse.ensureDir(path.join(root, ".ai", "rules"));
    await fse.ensureDir(path.join(root, ".ai", "skills"));
    await fse.writeFile(
      path.join(root, ".ai", "rules", "x.md"),
      "# x\n",
      "utf8",
    );
    const types = await detectConfigTypes(root);
    expect(types).toContain("rules");
    expect(types).not.toContain("skills");
  });

  it("detectProject combines everything", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await ensureGitRoot(root);
    await scaffoldAi(root);
    await fse.ensureDir(path.join(root, ".cursor"));
    const project = await detectProject(root);
    expect(project.root).toBe(path.resolve(root));
    expect(project.hasAi).toBe(true);
    expect(project.editors).toEqual(["cursor"]);
    expect(project.configTypes.sort()).toEqual([
      "hooks",
      "mcp",
      "rules",
      "skills",
    ]);
  });
});
