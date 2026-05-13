import fse from "fs-extra";
import path from "node:path";
import { WriteResult } from "../types.js";
import { isManaged, withMarker } from "./conflict.js";
import { listDir, pathExists, walkFiles } from "../utils/fs.js";

export type LinkOutcome = "symlink" | "copy";

export interface LinkOptions {
  /** When true, do not modify the filesystem. */
  dryRun?: boolean;
}

/**
 * Create a symlink from `linkPath` to `target`. On platforms that disallow
 * symlinks (typically Windows without developer mode), fall back to a copy so
 * the file content is still available downstream.
 *
 * Kept for backwards compatibility with existing tests. Prefer `safeLink`
 * for the conflict-aware variant used by adapters.
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

export interface SafeLinkOptions {
  /** Show planned actions but do not write. */
  dryRun?: boolean;
  /** Overwrite even when the existing target is not managed by this tool. */
  force?: boolean;
}

/** lstat that returns null when the path does not exist. */
async function tryLstat(target: string): Promise<import("fs").Stats | null> {
  try {
    return await fse.lstat(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Resolve the absolute filesystem path a symlink points to. Relative link
 * targets are resolved against the directory holding the link itself.
 */
export async function resolveSymlinkTarget(
  linkPath: string,
): Promise<string | null> {
  try {
    const raw = await fse.readlink(linkPath);
    const abs = path.isAbsolute(raw)
      ? raw
      : path.resolve(path.dirname(linkPath), raw);
    return path.resolve(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EINVAL" || code === "UNKNOWN") {
      return null;
    }
    throw err;
  }
}

async function realpathOrNull(target: string): Promise<string | null> {
  try {
    return await fse.realpath(target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EINVAL" || code === "UNKNOWN") {
      return null;
    }
    throw err;
  }
}

function samePath(a: string, b: string): boolean {
  const normalise = (p: string): string =>
    process.platform === "win32"
      ? path.resolve(p).toLowerCase()
      : path.resolve(p);
  return normalise(a) === normalise(b);
}

/**
 * True when `linkPath` is a symbolic link that, after following all hops,
 * resolves to the same filesystem entry as `expectedTarget`.
 *
 * We compare canonical paths (via `realpath`) because relative link targets,
 * Windows short paths, and case differences would otherwise produce false
 * negatives. Inode/device equality is used as a fast path so that two paths
 * pointing to the same file return true even if one of the real paths is
 * unavailable for some reason.
 */
export async function isSymlinkTo(
  linkPath: string,
  expectedTarget: string,
): Promise<boolean> {
  const lstat = await tryLstat(linkPath);
  if (!lstat || !lstat.isSymbolicLink()) return false;

  try {
    const [linkStat, targetStat] = await Promise.all([
      fse.stat(linkPath),
      fse.stat(expectedTarget),
    ]);
    if (
      linkStat.ino !== 0 &&
      linkStat.ino === targetStat.ino &&
      linkStat.dev === targetStat.dev
    ) {
      return true;
    }
  } catch {
    // fall through to realpath comparison
  }

  const [linkReal, targetReal] = await Promise.all([
    realpathOrNull(linkPath),
    realpathOrNull(expectedTarget),
  ]);
  if (!linkReal || !targetReal) return false;
  return samePath(linkReal, targetReal);
}

/**
 * Process-wide cache that records whether we have observed a successful
 * `fse.symlink` call so far. Used to keep dry-run reporting accurate without
 * having to probe the filesystem inside dry-run code paths.
 *
 * `null` = unknown, `true` = symlinks work, `false` = symlinks rejected.
 */
let symlinkSupported: boolean | null = null;

export function getSymlinkSupport(): boolean | null {
  return symlinkSupported;
}

/** Test-only hook to reset the cached probe result. */
export function resetSymlinkSupportCache(): void {
  symlinkSupported = null;
}

/**
 * Create a symlink from `linkPath` to `target`, using a relative link target
 * for portability. Falls back to a managed-content copy (text + marker) when
 * the platform refuses to create symlinks. The caller is responsible for
 * ensuring `linkPath` does not already exist.
 */
async function linkOrCopyManaged(
  target: string,
  linkPath: string,
): Promise<LinkOutcome> {
  await fse.ensureDir(path.dirname(linkPath));
  const stat = await fse.stat(target);
  const type = stat.isDirectory() ? "dir" : "file";
  const rel = path.relative(path.dirname(linkPath), target);
  try {
    await fse.symlink(rel, linkPath, type);
    symlinkSupported = true;
    return "symlink";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES" && code !== "ENOSYS") {
      throw err;
    }
    symlinkSupported = false;
    // Symlinks unavailable. Fall back to a managed copy so that the file is
    // still recognised as ours on the next sync (via the marker comment).
    if (stat.isDirectory()) {
      await fse.copy(target, linkPath, { overwrite: true, dereference: true });
    } else {
      const text = await fse.readFile(target, "utf8");
      const marked = withMarker(text);
      await fse.writeFile(linkPath, marked, "utf8");
    }
    return "copy";
  }
}

/**
 * Reflect `target` (a file under `.ai/`) into `linkPath` using a symlink when
 * possible, with conflict rules that mirror `safeWrite`:
 *   - missing target -> create (symlink, or copy+marker fallback);
 *   - existing symlink to `target` -> unchanged;
 *   - existing symlink to a different path -> repointed (updated);
 *   - existing managed copy (contains marker) -> replaced with symlink/copy
 *     (updated), so previously copy-mode files get upgraded once symlinks
 *     become available;
 *   - existing unmanaged file -> skipped-conflict, unless `force`.
 */
export async function safeLink(
  target: string,
  linkPath: string,
  options: SafeLinkOptions = {},
): Promise<WriteResult> {
  if (!(await pathExists(target))) {
    // Nothing to link to. Treat as a no-op so callers can stay simple.
    return { path: linkPath, outcome: "unchanged", reason: "source missing" };
  }

  const lstat = await tryLstat(linkPath);

  // Case A: nothing at the destination.
  if (!lstat) {
    if (options.dryRun) {
      return { path: linkPath, outcome: "skipped-dry-run" };
    }
    await linkOrCopyManaged(target, linkPath);
    return { path: linkPath, outcome: "written" };
  }

  // Case B: destination is itself a symlink.
  if (lstat.isSymbolicLink()) {
    if (await isSymlinkTo(linkPath, target)) {
      return { path: linkPath, outcome: "unchanged" };
    }
    if (options.dryRun) {
      return { path: linkPath, outcome: "skipped-dry-run" };
    }
    await fse.remove(linkPath);
    await linkOrCopyManaged(target, linkPath);
    return { path: linkPath, outcome: "updated" };
  }

  // Case C: destination is a regular file (typically a previous copy-mode
  // fallback, or a hand-written file).
  const existing = await safeReadText(linkPath);
  if (existing != null && isManaged(existing)) {
    // Managed copy from a previous sync. We want to upgrade to a real symlink
    // when the platform supports it; otherwise refresh the copy only when the
    // content actually differs so that repeated syncs stay idempotent.
    const expectedCopy = withMarker(await fse.readFile(target, "utf8"));

    if (options.dryRun) {
      // We avoid filesystem writes here, so rely on the cached probe result.
      // When the cache says symlinks work we will need to repoint -> updated;
      // when it says they don't we can compare contents for true idempotence;
      // when it is unknown we fall back to "needs work".
      if (symlinkSupported === true) {
        return { path: linkPath, outcome: "skipped-dry-run" };
      }
      if (symlinkSupported === false) {
        return existing === expectedCopy
          ? { path: linkPath, outcome: "unchanged" }
          : { path: linkPath, outcome: "skipped-dry-run" };
      }
      return { path: linkPath, outcome: "skipped-dry-run" };
    }

    await fse.remove(linkPath);
    const linkOutcome = await linkOrCopyManaged(target, linkPath);
    if (linkOutcome === "symlink") {
      // Upgraded copy -> real symlink.
      return { path: linkPath, outcome: "updated" };
    }
    // Stayed in copy mode. If the bytes round-trip identically, this run was
    // effectively a no-op; report unchanged so re-running sync is idempotent.
    return existing === expectedCopy
      ? { path: linkPath, outcome: "unchanged" }
      : { path: linkPath, outcome: "updated" };
  }

  // Unmanaged file -> conflict (or force).
  if (!options.force) {
    return {
      path: linkPath,
      outcome: "skipped-conflict",
      reason: "target exists and is not managed by agent-config-sync",
    };
  }
  if (options.dryRun) {
    return { path: linkPath, outcome: "skipped-dry-run" };
  }
  await fse.remove(linkPath);
  await linkOrCopyManaged(target, linkPath);
  return {
    path: linkPath,
    outcome: "forced",
    reason: "overwritten with --force",
  };
}

async function safeReadText(target: string): Promise<string | null> {
  try {
    return await fse.readFile(target, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") return null;
    throw err;
  }
}

/**
 * Outcome reported by `safeLinkDir`. `null` means we hit a permission /
 * support issue and the caller should fall back to a per-file strategy.
 */
export type SafeLinkDirOutcome =
  | { kind: "result"; result: WriteResult }
  | { kind: "fallback"; reason: string };

function isPermissionErr(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "EACCES" || code === "ENOSYS";
}

/**
 * Create a directory link from `linkPath` to `target`. On Windows we try a
 * junction first (no special privilege required), then a real directory
 * symlink (requires Developer Mode or admin). On other platforms we use a
 * regular directory symlink with a relative target.
 *
 * Caller must ensure `linkPath` does not yet exist.
 */
async function createDirLink(target: string, linkPath: string): Promise<void> {
  await fse.ensureDir(path.dirname(linkPath));
  if (process.platform === "win32") {
    try {
      // Junctions require an absolute target.
      await fse.symlink(path.resolve(target), linkPath, "junction");
      return;
    } catch (err) {
      if (!isPermissionErr(err)) throw err;
      // Some filesystems (network drives, exotic mounts) refuse junctions; try
      // a real symlink before giving up.
    }
  }
  const rel = path.relative(path.dirname(linkPath), target);
  await fse.symlink(rel, linkPath, "dir");
}

/**
 * True when every regular file under `dir` (recursively) carries the
 * agent-config-sync managed marker. Used to recognise a directory left over
 * from a previous file-level fallback sync, so we can safely upgrade it to a
 * directory link without throwing user content away.
 */
async function allFilesManaged(dir: string): Promise<boolean> {
  const files = await walkFiles(dir);
  if (files.length === 0) return true;
  for (const rel of files) {
    const text = await safeReadText(path.join(dir, rel));
    if (text == null || !isManaged(text)) return false;
  }
  return true;
}

/**
 * Reflect a directory `target` (e.g. `.ai/skills`) into `linkPath` (e.g.
 * `.cursor/skills`) as a single directory link. Conflict rules mirror
 * `safeLink`:
 *   - missing destination -> create the link;
 *   - existing link to `target` -> unchanged;
 *   - existing link to a different path -> repointed (updated);
 *   - existing empty directory -> consumed and turned into a link;
 *   - existing directory whose files are all managed -> upgraded (updated);
 *   - existing directory containing unmanaged files -> conflict (or forced);
 *   - existing regular file -> conflict (or forced).
 *
 * Returns `{ kind: "fallback" }` when the platform refuses to create the
 * link entirely; the caller should retry with a per-file strategy.
 */
export async function safeLinkDir(
  target: string,
  linkPath: string,
  options: SafeLinkOptions = {},
): Promise<SafeLinkDirOutcome> {
  if (!(await pathExists(target))) {
    return {
      kind: "result",
      result: { path: linkPath, outcome: "unchanged", reason: "source missing" },
    };
  }

  const lstat = await tryLstat(linkPath);

  // Case A: nothing at the destination.
  if (!lstat) {
    if (options.dryRun) {
      return {
        kind: "result",
        result: { path: linkPath, outcome: "skipped-dry-run" },
      };
    }
    try {
      await createDirLink(target, linkPath);
    } catch (err) {
      if (isPermissionErr(err)) {
        return { kind: "fallback", reason: (err as Error).message };
      }
      throw err;
    }
    return { kind: "result", result: { path: linkPath, outcome: "written" } };
  }

  // Case B: destination is already a symlink (or junction).
  if (lstat.isSymbolicLink()) {
    if (await isSymlinkTo(linkPath, target)) {
      return {
        kind: "result",
        result: { path: linkPath, outcome: "unchanged" },
      };
    }
    if (options.dryRun) {
      return {
        kind: "result",
        result: { path: linkPath, outcome: "skipped-dry-run" },
      };
    }
    await fse.remove(linkPath);
    try {
      await createDirLink(target, linkPath);
    } catch (err) {
      if (isPermissionErr(err)) {
        return { kind: "fallback", reason: (err as Error).message };
      }
      throw err;
    }
    return { kind: "result", result: { path: linkPath, outcome: "updated" } };
  }

  // Case C: destination is a regular directory.
  if (lstat.isDirectory()) {
    const entries = await listDir(linkPath);
    const isEmpty = entries.length === 0;
    const upgradable = isEmpty || (await allFilesManaged(linkPath));

    if (upgradable) {
      if (options.dryRun) {
        return {
          kind: "result",
          result: { path: linkPath, outcome: "skipped-dry-run" },
        };
      }
      await fse.remove(linkPath);
      try {
        await createDirLink(target, linkPath);
      } catch (err) {
        if (isPermissionErr(err)) {
          return { kind: "fallback", reason: (err as Error).message };
        }
        throw err;
      }
      return {
        kind: "result",
        result: {
          path: linkPath,
          outcome: isEmpty ? "written" : "updated",
        },
      };
    }

    // Non-empty directory with unmanaged files -> conflict / force.
    if (!options.force) {
      return {
        kind: "result",
        result: {
          path: linkPath,
          outcome: "skipped-conflict",
          reason:
            "directory contains files not managed by agent-config-sync",
        },
      };
    }
    if (options.dryRun) {
      return {
        kind: "result",
        result: { path: linkPath, outcome: "skipped-dry-run" },
      };
    }
    await fse.remove(linkPath);
    try {
      await createDirLink(target, linkPath);
    } catch (err) {
      if (isPermissionErr(err)) {
        return { kind: "fallback", reason: (err as Error).message };
      }
      throw err;
    }
    return {
      kind: "result",
      result: {
        path: linkPath,
        outcome: "forced",
        reason: "overwritten with --force",
      },
    };
  }

  // Case D: destination is a regular file (very unusual at a directory path).
  if (!options.force) {
    return {
      kind: "result",
      result: {
        path: linkPath,
        outcome: "skipped-conflict",
        reason: "target exists as a file, not a directory",
      },
    };
  }
  if (options.dryRun) {
    return {
      kind: "result",
      result: { path: linkPath, outcome: "skipped-dry-run" },
    };
  }
  await fse.remove(linkPath);
  try {
    await createDirLink(target, linkPath);
  } catch (err) {
    if (isPermissionErr(err)) {
      return { kind: "fallback", reason: (err as Error).message };
    }
    throw err;
  }
  return {
    kind: "result",
    result: {
      path: linkPath,
      outcome: "forced",
      reason: "overwritten with --force",
    },
  };
}
