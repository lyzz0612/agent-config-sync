import path from "node:path";
import {
  CONFIG_TYPES,
  ConfigType,
  DetectedProject,
  EDITORS,
  EDITOR_DIRS,
  EditorId,
} from "../types.js";
import { listDir, pathExists } from "../utils/fs.js";

const VCS_MARKERS = [".git", ".svn", ".p4config"] as const;

/**
 * Walk upwards from `start` looking for a VCS marker. When found, return that
 * directory. Otherwise return `start` itself so that the tool still works in
 * directories without VCS metadata.
 */
export async function findProjectRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    for (const marker of VCS_MARKERS) {
      if (await pathExists(path.join(current, marker))) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(start);
}

export async function detectEditors(root: string): Promise<EditorId[]> {
  const found: EditorId[] = [];
  for (const editor of EDITORS) {
    const dir = path.join(root, EDITOR_DIRS[editor]);
    if (await pathExists(dir)) {
      found.push(editor);
    }
  }
  return found;
}

export async function detectConfigTypes(root: string): Promise<ConfigType[]> {
  const aiDir = path.join(root, ".ai");
  if (!(await pathExists(aiDir))) return [];

  const present: ConfigType[] = [];
  for (const type of CONFIG_TYPES) {
    if (type === "mcp") {
      if (await pathExists(path.join(aiDir, "mcp.json"))) present.push(type);
      continue;
    }
    if (type === "hooks") {
      const hasFile = await pathExists(path.join(aiDir, "hooks.json"));
      const hooksDir = path.join(aiDir, "hooks");
      const hasDir =
        (await pathExists(hooksDir)) && (await listDir(hooksDir)).length > 0;
      if (hasFile || hasDir) present.push(type);
      continue;
    }
    const dir = path.join(aiDir, type);
    if ((await pathExists(dir)) && (await listDir(dir)).length > 0) {
      present.push(type);
    }
  }
  return present;
}

export async function detectProject(cwd: string): Promise<DetectedProject> {
  const root = await findProjectRoot(cwd);
  const [editors, configTypes, hasAi] = await Promise.all([
    detectEditors(root),
    detectConfigTypes(root),
    pathExists(path.join(root, ".ai")),
  ]);
  return { root, editors, configTypes, hasAi };
}
