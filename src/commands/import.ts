import path from "node:path";
import { checkbox, confirm, select } from "@inquirer/prompts";
import {
  CONFIG_TYPES,
  ConfigType,
  EDITOR_LABELS,
  EditorId,
  ImportStrategy,
  WriteResult,
} from "../types.js";
import { detectProject } from "../core/detect.js";
import { getAdapter } from "../adapters/index.js";
import { logger } from "../utils/logger.js";
import { runSync } from "./sync.js";
import chalk from "chalk";

export interface ImportRunOptions {
  cwd?: string;
  /** Predefined choices, used by tests / scripted invocations. */
  source?: EditorId;
  strategies?: Partial<Record<ConfigType, ImportStrategy>>;
  /** Auto-confirm follow-up sync prompt. */
  syncAfter?: boolean;
  dryRun?: boolean;
}

export async function runImport(options: ImportRunOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const project = await detectProject(cwd);
  if (project.editors.length === 0) {
    logger.warn(
      "No editor directories detected; nothing to import from. Run `agentcs init` first.",
    );
    return 1;
  }

  const source =
    options.source ??
    (await select<EditorId>({
      message: "Import from which editor?",
      choices: project.editors.map((id) => ({
        name: EDITOR_LABELS[id],
        value: id,
      })),
    }));

  if (!project.editors.includes(source)) {
    logger.error(`Editor ${source} is not enabled in this project.`);
    return 1;
  }

  const adapter = getAdapter(source);
  const available = await adapter.availableTypes(project.root);
  if (available.length === 0) {
    logger.warn(`No importable content under ${EDITOR_LABELS[source]}.`);
    return 0;
  }

  const selectedTypes =
    options.strategies != null
      ? (Object.keys(options.strategies) as ConfigType[]).filter((t) =>
          available.includes(t),
        )
      : await checkbox<ConfigType>({
          message: `Which config types to import from ${EDITOR_LABELS[source]}?`,
          choices: available.map((t) => ({ name: t, value: t, checked: true })),
        });

  const strategies: Record<ConfigType, ImportStrategy> = {} as Record<
    ConfigType,
    ImportStrategy
  >;
  for (const type of selectedTypes) {
    const fixed = options.strategies?.[type];
    strategies[type] =
      fixed ??
      (await select<ImportStrategy>({
        message: `Strategy for ${chalk.bold(type)}:`,
        choices: [
          { name: "merge (only fill missing files)", value: "merge" },
          { name: "overwrite (replace .ai/ content)", value: "overwrite" },
          { name: "skip", value: "skip" },
        ],
      }));
  }

  const allResults: WriteResult[] = [];
  for (const type of CONFIG_TYPES) {
    if (!selectedTypes.includes(type)) continue;
    const strategy = strategies[type];
    if (!strategy || strategy === "skip") continue;
    const results = await adapter.import({
      root: project.root,
      type,
      strategy,
      dryRun: options.dryRun,
    });
    allResults.push(...results);
  }

  printImportSummary(project.root, allResults, options.dryRun ?? false);

  const shouldSync =
    options.syncAfter ??
    (await confirm({
      message: "Sync the imported content to other editors now?",
      default: true,
    }));

  if (shouldSync) {
    const result = await runSync({ cwd: project.root, dryRun: options.dryRun });
    return result.exitCode;
  }
  return 0;
}

function printImportSummary(
  root: string,
  results: WriteResult[],
  dryRun: boolean,
): void {
  const prefix = dryRun ? chalk.dim("[dry-run] ") : "";
  if (results.length === 0) {
    logger.info("No changes.");
    return;
  }
  for (const result of results) {
    const rel = path.relative(root, result.path) || result.path;
    const tag = result.outcome === "skipped-conflict"
      ? chalk.dim("·")
      : result.outcome === "unchanged"
        ? chalk.dim("=")
        : chalk.green("+");
    logger.info(`  ${prefix}${tag} ${rel}`);
  }
}
