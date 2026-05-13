#!/usr/bin/env node
import { Command } from "commander";
import { EDITORS, EditorId } from "./types.js";
import { runInit } from "./commands/init.js";
import { runSync } from "./commands/sync.js";
import { runImport } from "./commands/import.js";
import { runStatus } from "./commands/status.js";
import { runCheck } from "./commands/check.js";
import { logger, setVerbose } from "./utils/logger.js";

const VERSION = "0.1.0";

const program = new Command();

program
  .name("agentcs")
  .description("Sync a single source of AI editor configuration to Cursor / Claude Code / Codex / Qoder.")
  .version(VERSION)
  .option("-v, --verbose", "verbose logging")
  .hook("preAction", (cmd) => {
    if (cmd.opts().verbose) setVerbose(true);
  });

program
  .command("init")
  .description("Initialise .ai/, pick managed editors and update VCS ignore (idempotent).")
  .option("--skip-sync", "do not run an initial sync after init")
  .option("-y, --yes", "skip confirmation prompts when removing editor directories")
  .action(async (opts) => {
    const code = await runInit({ yes: opts.yes, skipSync: opts.skipSync });
    process.exit(code);
  });

program
  .command("sync")
  .description("Apply .ai/ content to every detected editor directory.")
  .option(
    "-e, --editor <name>",
    `restrict to a single editor (one of: ${EDITORS.join(", ")})`,
  )
  .option("--dry-run", "show planned actions but do not write")
  .option("--force", "overwrite files that are not managed by agentcs")
  .action(async (opts) => {
    const editor = opts.editor as EditorId | undefined;
    if (editor && !EDITORS.includes(editor)) {
      logger.error(`Unknown editor: ${editor}. Expected one of: ${EDITORS.join(", ")}`);
      process.exit(1);
    }
    const result = await runSync({
      editor,
      dryRun: opts.dryRun,
      force: opts.force,
    });
    process.exit(result.exitCode);
  });

program
  .command("import")
  .description("Reverse: read an editor directory and merge / overwrite .ai/.")
  .option("--dry-run", "show planned actions but do not write")
  .action(async (opts) => {
    const code = await runImport({ dryRun: opts.dryRun });
    process.exit(code);
  });

program
  .command("status")
  .description("Show enabled editors, pending writes and .ai/ content counts.")
  .option("--json", "machine-readable JSON output")
  .action(async (opts) => {
    const { code } = await runStatus({ json: opts.json });
    process.exit(code);
  });

program
  .command("check")
  .description("Validate .ai/ structure, frontmatter and JSON.")
  .option("--json", "machine-readable JSON output")
  .action(async (opts) => {
    const { code } = await runCheck({ json: opts.json });
    process.exit(code);
  });

program.parseAsync(process.argv).catch((err) => {
  logger.error((err as Error).message);
  process.exit(1);
});
