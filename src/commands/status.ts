import path from "node:path";
import chalk from "chalk";
import {
  CONFIG_TYPES,
  ConfigType,
  EDITOR_LABELS,
  EditorId,
} from "../types.js";
import { detectProject } from "../core/detect.js";
import { getAdapter } from "../adapters/index.js";
import { logger } from "../utils/logger.js";
import { listDir } from "../utils/fs.js";

export interface StatusOptions {
  cwd?: string;
  json?: boolean;
}

export interface EditorStatus {
  editor: EditorId;
  toWrite: number;
  toUpdate: number;
  conflicts: number;
  unchanged: number;
}

export interface StatusPayload {
  root: string;
  editors: EditorStatus[];
  aiCounts: Record<ConfigType, number>;
}

export interface StatusResult {
  code: number;
  payload: StatusPayload;
}

export async function runStatus(options: StatusOptions = {}): Promise<StatusResult> {
  const cwd = options.cwd ?? process.cwd();
  const project = await detectProject(cwd);

  const aiCounts: Record<ConfigType, number> = {
    rules: 0,
    mcp: 0,
    skills: 0,
    agents: 0,
    commands: 0,
    hooks: 0,
  };
  for (const type of project.configTypes) {
    aiCounts[type] = await countAi(project.root, type);
  }

  const editorStatuses: EditorStatus[] = [];
  for (const editor of project.editors) {
    const adapter = getAdapter(editor);
    const results = [] as Awaited<ReturnType<typeof adapter.sync>>;
    for (const type of CONFIG_TYPES) {
      const partial = await adapter.sync(type, {
        root: project.root,
        options: { dryRun: true },
      });
      results.push(...partial);
    }
    const status: EditorStatus = {
      editor,
      toWrite: 0,
      toUpdate: 0,
      conflicts: 0,
      unchanged: 0,
    };
    for (const r of results) {
      if (r.outcome === "skipped-dry-run") status.toWrite += 1;
      else if (r.outcome === "skipped-conflict") status.conflicts += 1;
      else if (r.outcome === "unchanged") status.unchanged += 1;
      else if (r.outcome === "updated") status.toUpdate += 1;
      else if (r.outcome === "written") status.toWrite += 1;
    }
    editorStatuses.push(status);
  }

  const payload: StatusPayload = {
    root: project.root,
    editors: editorStatuses,
    aiCounts,
  };
  const code = editorStatuses.some((s) => s.conflicts > 0) ? 2 : 0;

  if (options.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return { code, payload };
  }

  logger.info(chalk.bold(`Project root: ${project.root}`));
  logger.info(chalk.bold("Enabled editors:"));
  if (editorStatuses.length === 0) {
    logger.dim("  (none — run `agentcs init` to enable some)");
  }
  for (const s of editorStatuses) {
    logger.info(
      `  ${chalk.bold(EDITOR_LABELS[s.editor])}: ${chalk.green(`+${s.toWrite}`)} ${chalk.cyan(`~${s.toUpdate}`)} ${chalk.dim(`=${s.unchanged}`)} ${chalk.yellow(`!${s.conflicts}`)}`,
    );
  }

  logger.info(chalk.bold(".ai/ contents:"));
  if (!project.hasAi) {
    logger.dim("  (.ai/ missing — run `agentcs init`)");
  } else {
    for (const type of CONFIG_TYPES) {
      logger.info(`  ${type}: ${aiCounts[type]}`);
    }
  }

  return { code, payload };
}

async function countAi(root: string, type: ConfigType): Promise<number> {
  const aiDir = path.join(root, ".ai");
  if (type === "mcp") return 1;
  if (type === "hooks") {
    const entries = await listDir(path.join(aiDir, "hooks"));
    return entries.length + 1;
  }
  return (await listDir(path.join(aiDir, type))).length;
}
