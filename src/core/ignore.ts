import path from "node:path";
import { pathExists, readTextIfExists, writeText } from "../utils/fs.js";

export const IGNORE_BEGIN = "# >>> agent-config-sync (managed) >>>";
export const IGNORE_END = "# <<< agent-config-sync (managed) <<<";

export const DEFAULT_IGNORE_LINES: readonly string[] = [
  "# AI editor configs (managed by agent-config-sync)",
  ".cursor/",
  ".claude/",
  ".codex/",
  ".qoder/",
  ".mcp.json",
];

interface VcsTarget {
  /** Directory that holds the VCS metadata (and therefore the ignore file). */
  root: string;
  /** Absolute path to the ignore file we should update. */
  ignoreFile: string;
}

const VCS_LAYOUTS: Array<{ marker: string; ignoreFile: string }> = [
  { marker: ".git", ignoreFile: ".gitignore" },
  { marker: ".svn", ignoreFile: ".svnignore" },
  { marker: ".p4config", ignoreFile: ".p4ignore" },
];

/**
 * Walk upwards from `start` collecting every VCS root we encounter. We update
 * each one so that a project nested inside a monorepo still has its ignore
 * rules applied at the repository level the user actually commits to.
 */
export async function findVcsTargets(start: string): Promise<VcsTarget[]> {
  const out: VcsTarget[] = [];
  let current = path.resolve(start);
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    for (const layout of VCS_LAYOUTS) {
      if (await pathExists(path.join(current, layout.marker))) {
        out.push({
          root: current,
          ignoreFile: path.join(current, layout.ignoreFile),
        });
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return out;
}

export interface UpdateIgnoreOptions {
  /** Lines that go inside the managed block (without the markers). */
  lines?: readonly string[];
  /** When true, only return the planned change without writing to disk. */
  dryRun?: boolean;
}

export interface IgnoreUpdate {
  ignoreFile: string;
  changed: boolean;
  created: boolean;
}

export function buildManagedBlock(lines: readonly string[]): string {
  return [IGNORE_BEGIN, ...lines, IGNORE_END].join("\n");
}

export function applyManagedBlock(
  existing: string | null,
  block: string,
): { next: string; changed: boolean; created: boolean } {
  if (existing == null) {
    return { next: `${block}\n`, changed: true, created: true };
  }
  const beginIdx = existing.indexOf(IGNORE_BEGIN);
  const endIdx = existing.indexOf(IGNORE_END);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx).replace(/[\r\n]+$/, "");
    const afterStart = endIdx + IGNORE_END.length;
    const after = existing.slice(afterStart).replace(/^[\r\n]+/, "");
    const parts = [before, block, after].filter((segment) => segment.length);
    const next = parts.join("\n") + "\n";
    return { next, changed: next !== existing, created: false };
  }
  const trimmed = existing.replace(/[\r\n]+$/, "");
  const sep = trimmed.length ? "\n" : "";
  const next = `${trimmed}${sep}${block}\n`;
  return { next, changed: next !== existing, created: false };
}

export async function updateVcsIgnore(
  start: string,
  options: UpdateIgnoreOptions = {},
): Promise<IgnoreUpdate[]> {
  const lines = options.lines ?? DEFAULT_IGNORE_LINES;
  const block = buildManagedBlock(lines);
  const targets = await findVcsTargets(start);
  const results: IgnoreUpdate[] = [];
  for (const target of targets) {
    const existing = await readTextIfExists(target.ignoreFile);
    const { next, changed, created } = applyManagedBlock(existing, block);
    if (changed && !options.dryRun) {
      await writeText(target.ignoreFile, next);
    }
    results.push({ ignoreFile: target.ignoreFile, changed, created });
  }
  return results;
}
