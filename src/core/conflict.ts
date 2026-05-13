import { MANAGED_MARK, WriteResult } from "../types.js";
import { pathExists, readTextIfExists, writeText } from "../utils/fs.js";

export interface ManagedFileOptions {
  /**
   * Comment syntax around the management marker. Defaults to markdown / HTML
   * style comments so the same marker works in `.md`, `.mdc`, `.json`, etc.
   * For TOML / YAML you may pass `prefix: "# "` instead.
   */
  prefix?: string;
  suffix?: string;
}

const DEFAULT_PREFIX = "<!-- ";
const DEFAULT_SUFFIX = " -->";

export function buildMarker(options: ManagedFileOptions = {}): string {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const suffix = options.suffix ?? DEFAULT_SUFFIX;
  return `${prefix}${MANAGED_MARK}${suffix}`;
}

/**
 * Wrap content with a managed marker. The marker is always placed on the first
 * non-empty line so the resulting file is still parseable: e.g. markdown can
 * keep its frontmatter when the marker is an HTML comment, TOML / YAML / JSON
 * can keep their syntax when the marker is a leading line comment.
 */
export function withMarker(
  content: string,
  options: ManagedFileOptions = {},
): string {
  const marker = buildMarker(options);
  const stripped = content.replace(/^\uFEFF/, "");
  if (stripped.startsWith("---")) {
    const lines = stripped.split(/\r?\n/);
    let endIdx = -1;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === "---") {
        endIdx = i;
        break;
      }
    }
    if (endIdx !== -1) {
      const head = lines.slice(0, endIdx + 1).join("\n");
      const tail = lines.slice(endIdx + 1).join("\n");
      return `${head}\n${marker}\n${tail.replace(/^\n/, "")}`;
    }
  }
  return `${marker}\n${stripped}`;
}

export function isManaged(content: string): boolean {
  return content.includes(MANAGED_MARK);
}

export interface SafeWriteOptions extends ManagedFileOptions {
  /** Skip the actual disk write, only report the planned outcome. */
  dryRun?: boolean;
  /** Overwrite even when the existing file is not managed by this tool. */
  force?: boolean;
  /**
   * Skip adding a marker. Useful when a target file format cannot tolerate any
   * extra comment line (none today, but kept as an escape hatch).
   */
  skipMarker?: boolean;
}

/**
 * Write `content` to `target`, observing the conflict rules:
 *  - if the file does not exist, write it (with marker) and return `written`;
 *  - if the file exists and is managed by us, write only when content differs;
 *  - if the file exists and is **not** managed, return `skipped-conflict`
 *    unless `force` is true.
 */
export async function safeWrite(
  target: string,
  content: string,
  options: SafeWriteOptions = {},
): Promise<WriteResult> {
  const finalContent = options.skipMarker
    ? content
    : withMarker(content, options);
  const exists = await pathExists(target);
  if (!exists) {
    if (options.dryRun) {
      return { path: target, outcome: "skipped-dry-run" };
    }
    await writeText(target, finalContent);
    return { path: target, outcome: "written" };
  }

  const existing = (await readTextIfExists(target)) ?? "";
  if (isManaged(existing)) {
    if (existing === finalContent) {
      return { path: target, outcome: "unchanged" };
    }
    if (options.dryRun) {
      return { path: target, outcome: "skipped-dry-run" };
    }
    await writeText(target, finalContent);
    return { path: target, outcome: "updated" };
  }

  if (!options.force) {
    return {
      path: target,
      outcome: "skipped-conflict",
      reason: "target exists and is not managed by agent-config-sync",
    };
  }

  if (options.dryRun) {
    return { path: target, outcome: "skipped-dry-run" };
  }
  await writeText(target, finalContent);
  return {
    path: target,
    outcome: "forced",
    reason: "overwritten with --force",
  };
}
