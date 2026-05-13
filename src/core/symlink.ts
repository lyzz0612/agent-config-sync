import fse from "fs-extra";
import path from "node:path";

export type LinkOutcome = "symlink" | "copy";

export interface LinkOptions {
  /** When true, do not modify the filesystem. */
  dryRun?: boolean;
}

/**
 * Create a symlink from `linkPath` to `target`. On platforms that disallow
 * symlinks (typically Windows without developer mode), fall back to a copy so
 * the file content is still available downstream.
 */
export async function linkOrCopy(
  target: string,
  linkPath: string,
  options: LinkOptions = {},
): Promise<LinkOutcome> {
  if (options.dryRun) {
    return "symlink";
  }
  await fse.ensureDir(path.dirname(linkPath));
  if (await fse.pathExists(linkPath)) {
    await fse.remove(linkPath);
  }
  try {
    const type = (await fse.stat(target)).isDirectory() ? "dir" : "file";
    await fse.symlink(target, linkPath, type);
    return "symlink";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
      await fse.copy(target, linkPath, { overwrite: true, dereference: true });
      return "copy";
    }
    throw err;
  }
}
