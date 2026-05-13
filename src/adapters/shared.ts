import path from "node:path";
import {
  ConfigType,
  ImportStrategy,
  MANAGED_MARK,
  SyncOptions,
  WriteResult,
} from "../types.js";
import { isManaged, safeWrite } from "../core/conflict.js";
import { safeLink, safeLinkDir } from "../core/symlink.js";
import {
  ensureDir,
  listDir,
  pathExists,
  readTextIfExists,
  walkFiles,
  writeText,
  fse,
} from "../utils/fs.js";
import { parseJson } from "../utils/json.js";

const MANAGED_FIELD = "_managedBy";
const MANAGED_VALUE = MANAGED_MARK;

export const AI_DIR = ".ai";
export const AI_PATHS = {
  rules: "rules",
  mcp: "mcp.json",
  skills: "skills",
  agents: "agents",
  commands: "commands",
  hooksDir: "hooks",
  hooksJson: "hooks.json",
} as const;

export function aiPath(root: string, ...rest: string[]): string {
  return path.join(root, AI_DIR, ...rest);
}

export async function aiFileExists(
  root: string,
  type: ConfigType,
): Promise<boolean> {
  switch (type) {
    case "rules":
    case "skills":
    case "agents":
    case "commands":
      return (
        (await pathExists(aiPath(root, type))) &&
        (await listDir(aiPath(root, type))).length > 0
      );
    case "mcp":
      return pathExists(aiPath(root, AI_PATHS.mcp));
    case "hooks":
      return (
        (await pathExists(aiPath(root, AI_PATHS.hooksJson))) ||
        ((await pathExists(aiPath(root, AI_PATHS.hooksDir))) &&
          (await listDir(aiPath(root, AI_PATHS.hooksDir))).length > 0)
      );
  }
}

/**
 * Reflect a content-passthrough directory (`skills`, `agents`, `commands`,
 * `hooks/` scripts, or rules that do not need a content transformation) from
 * `.ai/` into the editor's directory.
 *
 * The preferred shape is a single directory link at `destDir` pointing back
 * to `srcDir` (a junction on Windows, a directory symlink elsewhere) so that
 * any change to `.ai/` is immediately visible in the editor side without a
 * second sync. When that is not permitted we fall back to a per-file
 * link/copy so the contents are still mirrored.
 */
export async function linkDirectory(
  srcDir: string,
  destDir: string,
  options: SyncOptions,
): Promise<WriteResult[]> {
  if (!(await pathExists(srcDir))) return [];

  const dirOutcome = await safeLinkDir(srcDir, destDir, {
    dryRun: options.dryRun,
    force: options.force,
  });
  if (dirOutcome.kind === "result") {
    return [dirOutcome.result];
  }

  // Directory-level link refused by the platform; fall back to per-file mode.
  const results: WriteResult[] = [];
  const files = await walkFiles(srcDir);
  for (const rel of files) {
    const src = path.join(srcDir, rel);
    const dest = path.join(destDir, rel);
    await ensureDir(path.dirname(dest));
    const result = await safeLink(src, dest, {
      dryRun: options.dryRun,
      force: options.force,
    });
    results.push(result);
  }
  return results;
}

/** Read a JSON file, returning `null` if it does not exist. */
export async function readJson<T = unknown>(
  target: string,
): Promise<T | null> {
  const text = await readTextIfExists(target);
  if (text == null) return null;
  return parseJson<T>(text, target);
}

export function withJsonMarker<T extends Record<string, unknown>>(
  data: T,
): T & Record<string, string> {
  return { [MANAGED_FIELD]: MANAGED_VALUE, ...data } as T &
    Record<string, string>;
}

export function stripJsonMarker<T extends Record<string, unknown>>(
  data: T,
): Omit<T, typeof MANAGED_FIELD> {
  const { [MANAGED_FIELD]: _ignored, ...rest } = data as Record<
    string,
    unknown
  >;
  return rest as Omit<T, typeof MANAGED_FIELD>;
}

export function isManagedJson(text: string): boolean {
  return isManaged(text);
}

export async function writeJsonManaged(
  target: string,
  data: Record<string, unknown>,
  options: SyncOptions,
): Promise<WriteResult> {
  const wrapped = withJsonMarker(data);
  const text = JSON.stringify(wrapped, null, 2) + "\n";
  return safeWrite(target, text, {
    skipMarker: true,
    dryRun: options.dryRun,
    force: options.force,
  });
}

export interface ImportWriteOptions {
  /** Strategy from the user. */
  strategy: ImportStrategy;
  /** Optional dry-run flag. */
  dryRun?: boolean;
}

/**
 * Write reverse-imported content into `.ai/` according to the user-selected
 * strategy. Skipped writes are recorded but no disk change happens.
 */
export async function applyImport(
  target: string,
  content: string,
  { strategy, dryRun }: ImportWriteOptions,
): Promise<WriteResult> {
  if (strategy === "skip") {
    return { path: target, outcome: "skipped-conflict", reason: "skip" };
  }
  const exists = await pathExists(target);
  if (!exists) {
    if (dryRun) return { path: target, outcome: "skipped-dry-run" };
    await writeText(target, content);
    return { path: target, outcome: "written" };
  }
  // merge: keep existing files (only fill in missing ones)
  if (strategy === "merge") {
    return {
      path: target,
      outcome: "unchanged",
      reason: "merge: keeping existing file",
    };
  }
  // overwrite
  const existing = (await readTextIfExists(target)) ?? "";
  if (existing === content) {
    return { path: target, outcome: "unchanged" };
  }
  if (dryRun) return { path: target, outcome: "skipped-dry-run" };
  await writeText(target, content);
  return { path: target, outcome: "updated" };
}

export async function importDirectory(
  srcDir: string,
  destDir: string,
  { strategy, dryRun }: ImportWriteOptions,
): Promise<WriteResult[]> {
  const results: WriteResult[] = [];
  if (!(await pathExists(srcDir))) return results;
  await ensureDir(destDir);
  const files = await walkFiles(srcDir);
  for (const rel of files) {
    const src = path.join(srcDir, rel);
    const dest = path.join(destDir, rel);
    const content = await fse.readFile(src, "utf8");
    const result = await applyImport(dest, content, { strategy, dryRun });
    results.push(result);
  }
  return results;
}
