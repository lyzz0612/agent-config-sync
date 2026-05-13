import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import fse from "fs-extra";
import { runStatus } from "../../src/commands/status.js";
import {
  ensureGitRoot,
  makeTempProject,
  scaffoldAi,
} from "../helpers.js";

describe("commands/status", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("returns pending writes for detected editors", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await ensureGitRoot(root);
    await scaffoldAi(root);
    await fse.ensureDir(path.join(root, ".cursor"));

    const { code, payload } = await runStatus({ cwd: root, json: true });
    expect(code).toBe(0);
    expect(payload.editors).toHaveLength(1);
    expect(payload.editors[0].editor).toBe("cursor");
    expect(payload.editors[0].toWrite).toBeGreaterThan(0);
    expect(payload.aiCounts.rules).toBeGreaterThan(0);
  });

  it("returns code 2 when conflicts are present", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await ensureGitRoot(root);
    await scaffoldAi(root);
    await fse.ensureDir(path.join(root, ".cursor", "rules"));
    await fse.writeFile(
      path.join(root, ".cursor", "rules", "style.mdc"),
      "hand-written\n",
      "utf8",
    );
    const { code, payload } = await runStatus({ cwd: root, json: true });
    expect(code).toBe(2);
    expect(payload.editors[0].conflicts).toBeGreaterThan(0);
  });
});
