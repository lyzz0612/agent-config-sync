import path from "node:path";
import {
  CONFIG_TYPES,
  EditorId,
  SyncOptions,
  SyncSummary,
  WriteResult,
} from "../types.js";
import { detectProject } from "../core/detect.js";
import { getAdapter } from "../adapters/index.js";
import { logger } from "../utils/logger.js";
import chalk from "chalk";

export interface SyncRunOptions extends SyncOptions {
  cwd?: string;
}

export async function runSync(options: SyncRunOptions = {}): Promise<{
  summaries: SyncSummary[];
  conflicts: WriteResult[];
  exitCode: number;
}> {
  const cwd = options.cwd ?? process.cwd();
  const project = await detectProject(cwd);
  if (!project.hasAi) {
    logger.warn(
      `No .ai/ directory found at ${project.root}. Run \`agentcs init\` first.`,
    );
    return { summaries: [], conflicts: [], exitCode: 1 };
  }

  const editors: EditorId[] = options.editor
    ? project.editors.includes(options.editor)
      ? [options.editor]
      : []
    : project.editors;

  if (editors.length === 0) {
    logger.warn(
      options.editor
        ? `Editor ${options.editor} is not enabled in this project (no ${options.editor}/ directory).`
        : "No editor directories detected. Run `agentcs init` to enable some.",
    );
    return { summaries: [], conflicts: [], exitCode: 1 };
  }

  const summaries: SyncSummary[] = [];
  const conflicts: WriteResult[] = [];

  for (const editor of editors) {
    const adapter = getAdapter(editor);
    const results: WriteResult[] = [];
    for (const type of CONFIG_TYPES) {
      const partial = await adapter.sync(type, {
        root: project.root,
        options,
      });
      results.push(...partial);
    }
    summaries.push({ editor, results });
    for (const result of results) {
      if (result.outcome === "skipped-conflict") conflicts.push(result);
    }
  }

  printSummary(project.root, summaries, options);

  if (conflicts.length > 0 && !options.force) {
    logger.warn(
      `${conflicts.length} file(s) skipped due to conflicts. Re-run with --force to overwrite.`,
    );
  }

  return {
    summaries,
    conflicts,
    exitCode: conflicts.length > 0 && !options.force ? 2 : 0,
  };
}

function printSummary(
  root: string,
  summaries: SyncSummary[],
  options: SyncOptions,
): void {
  const prefix = options.dryRun ? chalk.dim("[dry-run] ") : "";
  for (const summary of summaries) {
    logger.info(`${chalk.bold(summary.editor)}`);
    if (summary.results.length === 0) {
      logger.dim("  (no matching .ai/ content)");
      continue;
    }
    for (const result of summary.results) {
      const rel = path.relative(root, result.path) || result.path;
      const tag = formatOutcome(result.outcome);
      const suffix = result.reason ? chalk.dim(` (${result.reason})`) : "";
      logger.info(`  ${prefix}${tag} ${rel}${suffix}`);
    }
  }
}

function formatOutcome(outcome: WriteResult["outcome"]): string {
  switch (outcome) {
    case "written":
      return chalk.green("+");
    case "updated":
      return chalk.cyan("~");
    case "unchanged":
      return chalk.dim("=");
    case "skipped-conflict":
      return chalk.yellow("!");
    case "skipped-dry-run":
      return chalk.dim("·");
    case "forced":
      return chalk.magenta("*");
  }
}
