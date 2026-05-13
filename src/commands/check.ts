import path from "node:path";
import chalk from "chalk";
import { detectProject } from "../core/detect.js";
import { listDir, pathExists, readTextIfExists } from "../utils/fs.js";
import { parseJson } from "../utils/json.js";
import { parseFrontmatter } from "../core/converter.js";
import { logger } from "../utils/logger.js";

export interface CheckOptions {
  cwd?: string;
  json?: boolean;
}

export interface CheckReport {
  errors: string[];
  warnings: string[];
}

export interface CheckResult {
  code: number;
  report: CheckReport;
}

export async function runCheck(options: CheckOptions = {}): Promise<CheckResult> {
  const cwd = options.cwd ?? process.cwd();
  const project = await detectProject(cwd);
  const report: CheckReport = { errors: [], warnings: [] };
  const aiDir = path.join(project.root, ".ai");

  if (!project.hasAi) {
    report.errors.push(".ai/ directory is missing");
  } else {
    await checkRules(path.join(aiDir, "rules"), report);
    await checkJson(path.join(aiDir, "mcp.json"), report);
    await checkJson(path.join(aiDir, "hooks.json"), report);
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    for (const err of report.errors) logger.error(err);
    for (const warn of report.warnings) logger.warn(warn);
    if (report.errors.length === 0 && report.warnings.length === 0) {
      logger.success("All checks passed.");
    } else {
      logger.info(
        `${chalk.red(`${report.errors.length} error(s)`)}, ${chalk.yellow(`${report.warnings.length} warning(s)`)}`,
      );
    }
  }

  return { code: report.errors.length > 0 ? 1 : 0, report };
}

async function checkRules(dir: string, report: CheckReport): Promise<void> {
  if (!(await pathExists(dir))) return;
  for (const name of await listDir(dir)) {
    if (!/\.mdx?$/i.test(name)) continue;
    const file = path.join(dir, name);
    const text = await readTextIfExists(file);
    if (text == null) continue;
    try {
      parseFrontmatter(text);
    } catch (err) {
      report.errors.push(
        `Invalid frontmatter in ${file}: ${(err as Error).message}`,
      );
    }
  }
}

async function checkJson(file: string, report: CheckReport): Promise<void> {
  if (!(await pathExists(file))) return;
  const text = await readTextIfExists(file);
  if (text == null) return;
  try {
    parseJson(text);
  } catch (err) {
    report.errors.push(`Invalid JSON in ${file}: ${(err as Error).message}`);
  }
}
