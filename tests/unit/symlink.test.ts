import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import fse from "fs-extra";
import { linkOrCopy } from "../../src/core/symlink.js";
import { makeTempProject } from "../helpers.js";

describe("core/symlink", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("falls back to copy when symlink throws EPERM", async () => {
    const { root, dispose } = await makeTempProject();
    cleanups.push(dispose);
    const src = path.join(root, "src.txt");
    const dst = path.join(root, "dst.txt");
    await fse.writeFile(src, "hello\n", "utf8");
    const spy = vi.spyOn(fse, "symlink").mockImplementation(
      async () => {
        const err = new Error("EPERM") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      },
    );
    const outcome = await linkOrCopy(src, dst);
    spy.mockRestore();
    expect(outcome).toBe("copy");
    expect(await fse.readFile(dst, "utf8")).toBe("hello\n");
  });
});
