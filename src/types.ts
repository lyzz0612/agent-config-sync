/**
 * Public types shared across commands, adapters and core modules.
 */

export const EDITORS = ["cursor", "claude", "codex", "qoder"] as const;
export type EditorId = (typeof EDITORS)[number];

export const EDITOR_LABELS: Record<EditorId, string> = {
  cursor: "Cursor",
  claude: "Claude Code",
  codex: "Codex",
  qoder: "Qoder",
};

export const EDITOR_DIRS: Record<EditorId, string> = {
  cursor: ".cursor",
  claude: ".claude",
  codex: ".codex",
  qoder: ".qoder",
};

export const CONFIG_TYPES = [
  "rules",
  "mcp",
  "skills",
  "agents",
  "commands",
  "hooks",
] as const;
export type ConfigType = (typeof CONFIG_TYPES)[number];

export const MANAGED_MARK = "managed by agent-config-sync";

export interface DetectedProject {
  /** Absolute path to the project root (directory that contains `.ai/`). */
  root: string;
  /** Editors whose dedicated directory currently exists under the project root. */
  editors: EditorId[];
  /** Whether `.ai/` exists under the project root. */
  hasAi: boolean;
  /** Configuration types currently present under `.ai/`. */
  configTypes: ConfigType[];
}

export type WriteOutcome =
  | "written"
  | "updated"
  | "unchanged"
  | "skipped-conflict"
  | "skipped-dry-run"
  | "forced";

export interface WriteResult {
  /** Absolute path of the affected file. */
  path: string;
  /** Outcome of the write attempt. */
  outcome: WriteOutcome;
  /** Optional human-readable reason (mostly for conflicts). */
  reason?: string;
}

export interface SyncSummary {
  editor: EditorId;
  results: WriteResult[];
}

export interface SyncOptions {
  /** Restrict to a single editor. */
  editor?: EditorId;
  /** Show planned actions but do not touch the filesystem. */
  dryRun?: boolean;
  /** Overwrite even when a target file is not managed by this tool. */
  force?: boolean;
}

export interface ImportStrategyMap {
  rules?: ImportStrategy;
  mcp?: ImportStrategy;
  skills?: ImportStrategy;
  agents?: ImportStrategy;
  commands?: ImportStrategy;
  hooks?: ImportStrategy;
}

export type ImportStrategy = "merge" | "overwrite" | "skip";
