import path from "node:path";
import { checkbox, confirm } from "@inquirer/prompts";
import {
  EDITORS,
  EDITOR_DIRS,
  EDITOR_LABELS,
  EditorId,
} from "../types.js";
import { detectProject } from "../core/detect.js";
import { updateVcsIgnore } from "../core/ignore.js";
import { ensureDir, fse, pathExists } from "../utils/fs.js";
import { logger } from "../utils/logger.js";
import { runSync } from "./sync.js";

export interface InitOptions {
  cwd?: string;
  /** Pre-selected editors. When provided, skip interactive prompts. */
  editors?: EditorId[];
  /** Skip the prompt asking to delete editor directories that were unselected. */
  yes?: boolean;
  /** When true, do not run an initial sync after creating editor directories. */
  skipSync?: boolean;
}

const AI_SUBDIRS = ["rules", "skills", "agents", "commands", "hooks"] as const;

export async function runInit(options: InitOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const project = await detectProject(cwd);
  const root = project.root;

  await ensureAiSkeleton(root);

  const selection =
    options.editors ??
    (await checkbox<EditorId>({
      message: "Which editors should agent-config-sync manage in this project?",
      choices: EDITORS.map((id) => ({
        name: EDITOR_LABELS[id],
        value: id,
        checked: project.editors.includes(id),
      })),
    }));

  const toCreate = selection.filter((id) => !project.editors.includes(id));
  const toRemove = project.editors.filter((id) => !selection.includes(id));

  for (const id of toCreate) {
    const dir = path.join(root, EDITOR_DIRS[id]);
    await ensureDir(dir);
    logger.success(`Created ${path.relative(root, dir) || dir}/`);
  }

  for (const id of toRemove) {
    const dir = path.join(root, EDITOR_DIRS[id]);
    const ok =
      options.yes ||
      (await confirm({
        message: `Remove ${path.relative(root, dir) || dir}/ ?`,
        default: false,
      }));
    if (ok) {
      await fse.remove(dir);
      logger.success(`Removed ${path.relative(root, dir) || dir}/`);
    } else {
      logger.dim(`Kept ${path.relative(root, dir) || dir}/`);
    }
  }

  const ignoreUpdates = await updateVcsIgnore(root);
  for (const update of ignoreUpdates) {
    if (update.changed) {
      logger.success(
        `${update.created ? "Created" : "Updated"} ${path.relative(root, update.ignoreFile) || update.ignoreFile}`,
      );
    } else {
      logger.dim(
        `Ignore file already up to date: ${path.relative(root, update.ignoreFile) || update.ignoreFile}`,
      );
    }
  }

  if (selection.length === 0) {
    logger.warn("No editor selected; nothing to sync.");
    return 0;
  }

  if (!options.skipSync) {
    logger.info("");
    logger.info("Running initial sync...");
    const result = await runSync({ cwd: root });
    return result.exitCode;
  }

  return 0;
}

async function ensureAiSkeleton(root: string): Promise<void> {
  const aiDir = path.join(root, ".ai");
  await ensureDir(aiDir);
  for (const sub of AI_SUBDIRS) {
    await ensureDir(path.join(aiDir, sub));
  }
  const mcpJson = path.join(aiDir, "mcp.json");
  if (!(await pathExists(mcpJson))) {
    await fse.writeFile(
      mcpJson,
      JSON.stringify({ mcpServers: {} }, null, 2) + "\n",
      "utf8",
    );
  }
  const hooksJson = path.join(aiDir, "hooks.json");
  if (!(await pathExists(hooksJson))) {
    await fse.writeFile(
      hooksJson,
      JSON.stringify({ hooks: [] }, null, 2) + "\n",
      "utf8",
    );
  }
}
