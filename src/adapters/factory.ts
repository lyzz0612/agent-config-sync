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
import { safeWrite } from "../core/conflict.js";
import { jsonToToml, tomlToJson } from "../utils/toml.js";
import {
  ensureDir,
  fse,
  listDir,
  pathExists,
  readTextIfExists,
} from "../utils/fs.js";

export interface MirrorAdapterOptions {
  id: EditorId;
  /** When set to "toml", `mcp` and `hooks.json` are written as TOML files. */
  configFormat?: "json" | "toml";
  /** Rule file extension on the editor side (defaults to `.md`). */
  ruleExt?: string;
}

const DIR_TYPES: ConfigType[] = ["skills", "agents", "commands"];

function editorBase(root: string, id: EditorId, ...rest: string[]): string {
  return path.join(root, EDITOR_DIRS[id], ...rest);
}

export function createMirrorAdapter(
  options: MirrorAdapterOptions,
): EditorAdapter {
  const { id, configFormat = "json", ruleExt = ".md" } = options;
  const mcpName = configFormat === "toml" ? "config.toml" : "mcp.json";
  const hooksName = configFormat === "toml" ? "hooks.toml" : "hooks.json";

  async function syncRules(ctx: SyncContext): Promise<WriteResult[]> {
    const srcDir = aiPath(ctx.root, AI_PATHS.rules);
    const destDir = editorBase(ctx.root, id, "rules");
    if (!(await pathExists(srcDir))) return [];
    await ensureDir(destDir);
    const results: WriteResult[] = [];
    for (const name of await listDir(srcDir)) {
      const stat = await fse.stat(path.join(srcDir, name));
      if (!stat.isFile()) continue;
      const text = await fse.readFile(path.join(srcDir, name), "utf8");
      const base = name.replace(/\.md$/i, "");
      const destName = `${base}${ruleExt}`;
      results.push(
        await safeWrite(path.join(destDir, destName), text, {
          dryRun: ctx.options.dryRun,
          force: ctx.options.force,
        }),
      );
    }
    return results;
  }

  async function writeStructured(
    target: string,
    data: Record<string, unknown>,
    ctx: SyncContext,
  ): Promise<WriteResult> {
    if (configFormat === "toml") {
      const tomlBody = jsonToToml(data);
      const text = `# managed by agent-config-sync\n${tomlBody}`;
      return safeWrite(target, text, {
        skipMarker: true,
        dryRun: ctx.options.dryRun,
        force: ctx.options.force,
      });
    }
    return writeJsonManaged(target, data, ctx.options);
  }

  async function syncMcp(ctx: SyncContext): Promise<WriteResult[]> {
    const data = await readJson<Record<string, unknown>>(
      aiPath(ctx.root, AI_PATHS.mcp),
    );
    if (!data) return [];
    return [
      await writeStructured(editorBase(ctx.root, id, mcpName), data, ctx),
    ];
  }

  async function syncHooks(ctx: SyncContext): Promise<WriteResult[]> {
    const results: WriteResult[] = [];
    const hooksJson = aiPath(ctx.root, AI_PATHS.hooksJson);
    if (await pathExists(hooksJson)) {
      const data = await readJson<Record<string, unknown>>(hooksJson);
      if (data) {
        results.push(
          await writeStructured(editorBase(ctx.root, id, hooksName), data, ctx),
        );
      }
    }
    const hooksDir = aiPath(ctx.root, AI_PATHS.hooksDir);
    results.push(
      ...(await syncDirectory(
        hooksDir,
        editorBase(ctx.root, id, "hooks"),
        ctx.options,
      )),
    );
    return results;
  }

  async function importStructured(
    target: string,
    raw: string,
    ctx: ImportContext,
  ): Promise<WriteResult> {
    const parsed =
      configFormat === "toml" ? tomlToJson(raw) : (JSON.parse(raw) as Record<string, unknown>);
    const stripped = stripJsonMarker(parsed);
    const text = JSON.stringify(stripped, null, 2) + "\n";
    return applyImport(target, text, {
      strategy: ctx.strategy,
      dryRun: ctx.dryRun,
    });
  }

  async function importType(ctx: ImportContext): Promise<WriteResult[]> {
    const { root, type, strategy, dryRun } = ctx;
    switch (type) {
      case "rules": {
        const src = editorBase(root, id, "rules");
        const dest = aiPath(root, AI_PATHS.rules);
        if (!(await pathExists(src))) return [];
        await ensureDir(dest);
        const results: WriteResult[] = [];
        for (const name of await listDir(src)) {
          const text = (await readTextIfExists(path.join(src, name))) ?? "";
          const base = name.replace(new RegExp(`\\${ruleExt}$`, "i"), "");
          const destName = `${base}.md`;
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
        const file = editorBase(root, id, mcpName);
        const text = await readTextIfExists(file);
        if (text == null) return [];
        return [
          await importStructured(aiPath(root, AI_PATHS.mcp), text, ctx),
        ];
      }
      case "skills":
      case "agents":
      case "commands":
        return importDirectory(
          editorBase(root, id, type),
          aiPath(root, type),
          { strategy, dryRun },
        );
      case "hooks": {
        const results: WriteResult[] = [];
        const file = editorBase(root, id, hooksName);
        const text = await readTextIfExists(file);
        if (text != null) {
          results.push(
            await importStructured(
              aiPath(root, AI_PATHS.hooksJson),
              text,
              ctx,
            ),
          );
        }
        results.push(
          ...(await importDirectory(
            editorBase(root, id, "hooks"),
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
    const rulesDir = editorBase(root, id, "rules");
    if (
      (await pathExists(rulesDir)) &&
      (await listDir(rulesDir)).length > 0
    ) {
      out.push("rules");
    }
    if (await pathExists(editorBase(root, id, mcpName))) out.push("mcp");
    for (const t of DIR_TYPES) {
      const dir = editorBase(root, id, t);
      if ((await pathExists(dir)) && (await listDir(dir)).length > 0) {
        out.push(t);
      }
    }
    if (
      (await pathExists(editorBase(root, id, hooksName))) ||
      ((await pathExists(editorBase(root, id, "hooks"))) &&
        (await listDir(editorBase(root, id, "hooks"))).length > 0)
    ) {
      out.push("hooks");
    }
    return out;
  }

  return {
    id,
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
          return syncDirectory(
            aiPath(ctx.root, type),
            editorBase(ctx.root, id, type),
            ctx.options,
          );
        case "hooks":
          return syncHooks(ctx);
      }
    },
    import: importType,
    availableTypes,
  };
}
