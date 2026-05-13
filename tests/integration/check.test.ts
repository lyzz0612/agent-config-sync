import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import fse from "fs-extra";
import { runCheck } from "../../src/commands/check.js";
import {
  ensureGitRoot,
  makeTempProject,
  scaffoldAi,
} from "../helpers.js";

describe("commands/check", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("reports success on a valid project", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await ensureGitRoot(root);
    await scaffoldAi(root);
    const { code, report } = await runCheck({ cwd: root, json: true });
    expect(code).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it("flags malformed JSON in mcp.json", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await ensureGitRoot(root);
    await scaffoldAi(root);
    await fse.writeFile(
      path.join(root, ".ai", "mcp.json"),
      "{ not json",
      "utf8",
    );
    const { code, report } = await runCheck({ cwd: root, json: true });
    expect(code).toBe(1);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it("errors when .ai/ is missing", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    await ensureGitRoot(root);
    const { code, report } = await runCheck({ cwd: root, json: true });
    expect(code).toBe(1);
    expect(report.errors.some((e) => e.includes(".ai/"))).toBe(true);
  });
});
