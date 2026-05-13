import path from "node:path";
import {
  ConfigType,
  EDITOR_DIRS,
  EditorId,
  WriteResult,
} from "../types.js";
import { EditorAdapter, ImportContext, SyncContext } from "./base.js";
import {
  AI_PATHS,
  aiFileExists,
  aiPath,
  applyImport,
  importDirectory,
  readJson,
  stripJsonMarker,
  syncDirectory,
  writeJsonManaged,
} from "./shared.js";
import {
  ensureDir,
  fse,
  listDir,
  pathExists,
  readTextIfExists,
} from "../utils/fs.js";
import { safeWrite } from "../core/conflict.js";

const EDITOR: EditorId = "cursor";
const DIR = EDITOR_DIRS[EDITOR];

function editorPath(root: string, ...rest: string[]): string {
  return path.join(root, DIR, ...rest);
}

async function syncRules(ctx: SyncContext): Promise<WriteResult[]> {
  const srcDir = aiPath(ctx.root, AI_PATHS.rules);
  const destDir = editorPath(ctx.root, "rules");
  if (!(await pathExists(srcDir))) return [];
  const results: WriteResult[] = [];
  await ensureDir(destDir);
  const entries = await listDir(srcDir);
  for (const name of entries) {
    const stat = await fse.stat(path.join(srcDir, name));
    if (!stat.isFile()) continue;
    const text = await fse.readFile(path.join(srcDir, name), "utf8");
    const destName = name.replace(/\.md$/i, ".mdc");
    const dest = path.join(destDir, destName);
    results.push(
      await safeWrite(dest, text, {
        dryRun: ctx.options.dryRun,
        force: ctx.options.force,
      }),
    );
  }
  return results;
}

async function syncMcp(ctx: SyncContext): Promise<WriteResult[]> {
  const data = await readJson<Record<string, unknown>>(
    aiPath(ctx.root, AI_PATHS.mcp),
  );
  if (!data) return [];
  const result = await writeJsonManaged(
    editorPath(ctx.root, "mcp.json"),
    data,
    ctx.options,
  );
  return [result];
}

const ADDITIONAL_TYPES: ConfigType[] = ["skills", "agents", "commands"];

async function syncAdditional(
  type: ConfigType,
  ctx: SyncContext,
): Promise<WriteResult[]> {
  const srcDir = aiPath(ctx.root, type);
  const destDir = editorPath(ctx.root, type);
  return syncDirectory(srcDir, destDir, ctx.options);
}

async function syncHooks(ctx: SyncContext): Promise<WriteResult[]> {
  const results: WriteResult[] = [];
  const hooksJson = aiPath(ctx.root, AI_PATHS.hooksJson);
  if (await pathExists(hooksJson)) {
    const data = await readJson<Record<string, unknown>>(hooksJson);
    if (data) {
      results.push(
        await writeJsonManaged(
          editorPath(ctx.root, "hooks.json"),
          data,
          ctx.options,
        ),
      );
    }
  }
  const hooksDir = aiPath(ctx.root, AI_PATHS.hooksDir);
  const dest = editorPath(ctx.root, "hooks");
  const dirResults = await syncDirectory(hooksDir, dest, ctx.options);
  results.push(...dirResults);
  return results;
}

async function importType(ctx: ImportContext): Promise<WriteResult[]> {
  const { root, type, strategy, dryRun } = ctx;
  switch (type) {
    case "rules": {
      const src = editorPath(root, "rules");
      const dest = aiPath(root, AI_PATHS.rules);
      if (!(await pathExists(src))) return [];
      await ensureDir(dest);
      const results: WriteResult[] = [];
      for (const name of await listDir(src)) {
        const text = (await readTextIfExists(path.join(src, name))) ?? "";
        const destName = name.replace(/\.mdc$/i, ".md");
        results.push(
          await applyImport(path.join(dest, destName), text, {
            strategy,
            dryRun,
          }),
        );
      }
      return results;
    }
    case "mcp": {
      const text = await readTextIfExists(editorPath(root, "mcp.json"));
      if (text == null) return [];
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const stripped = stripJsonMarker(parsed);
      const next = JSON.stringify(stripped, null, 2) + "\n";
      return [
        await applyImport(aiPath(root, AI_PATHS.mcp), next, {
          strategy,
          dryRun,
        }),
      ];
    }
    case "skills":
    case "agents":
    case "commands":
      return importDirectory(
        editorPath(root, type),
        aiPath(root, type),
        { strategy, dryRun },
      );
    case "hooks": {
      const results: WriteResult[] = [];
      const hooksFile = editorPath(root, "hooks.json");
      const hooksText = await readTextIfExists(hooksFile);
      if (hooksText != null) {
        const parsed = JSON.parse(hooksText) as Record<string, unknown>;
        const stripped = stripJsonMarker(parsed);
        results.push(
          await applyImport(
            aiPath(root, AI_PATHS.hooksJson),
            JSON.stringify(stripped, null, 2) + "\n",
            { strategy, dryRun },
          ),
        );
      }
      results.push(
        ...(await importDirectory(
          editorPath(root, "hooks"),
          aiPath(root, AI_PATHS.hooksDir),
          { strategy, dryRun },
        )),
      );
      return results;
    }
  }
}

async function availableTypes(root: string): Promise<ConfigType[]> {
  const out: ConfigType[] = [];
  if (
    (await pathExists(editorPath(root, "rules"))) &&
    (await listDir(editorPath(root, "rules"))).length > 0
  ) {
    out.push("rules");
  }
  if (await pathExists(editorPath(root, "mcp.json"))) out.push("mcp");
  for (const t of ADDITIONAL_TYPES) {
    if (
      (await pathExists(editorPath(root, t))) &&
      (await listDir(editorPath(root, t))).length > 0
    ) {
      out.push(t);
    }
  }
  if (
    (await pathExists(editorPath(root, "hooks.json"))) ||
    ((await pathExists(editorPath(root, "hooks"))) &&
      (await listDir(editorPath(root, "hooks"))).length > 0)
  ) {
    out.push("hooks");
  }
  return out;
}

export const cursorAdapter: EditorAdapter = {
  id: EDITOR,
  async sync(type, ctx) {
    if (!(await aiFileExists(ctx.root, type))) return [];
    switch (type) {
      case "rules":
        return syncRules(ctx);
      case "mcp":
        return syncMcp(ctx);
      case "skills":
      case "agents":
      case "commands":
        return syncAdditional(type, ctx);
      case "hooks":
        return syncHooks(ctx);
    }
  },
  import: importType,
  availableTypes,
};
