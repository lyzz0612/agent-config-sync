import os from "node:os";
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
const PROJECT_FILE_MARKERS = new Set([
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Gemfile",
]);
const PROJECT_FILE_SUFFIXES = [".uproject", ".sln"] as const;

async function hasAgentProjectMarkers(dir: string): Promise<boolean> {
  if (await pathExists(path.join(dir, ".ai"))) return true;
  for (const editor of EDITORS) {
    if (await pathExists(path.join(dir, EDITOR_DIRS[editor]))) return true;
  }
  return false;
}

async function hasGenericProjectMarkers(dir: string): Promise<boolean> {
  const entries = await listDir(dir);
  return entries.some(
    (name) =>
      PROJECT_FILE_MARKERS.has(name) ||
      PROJECT_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix)),
  );
}

/**
 * Walk upwards from `start` looking for the nearest directory that resembles a
 * real project root (`.ai/`, editor dirs, or common project manifest files).
 * If none is found, fall back to the nearest VCS root. Otherwise return
 * `start` itself so that the tool still works in plain directories.
 */
export async function findProjectRoot(start: string): Promise<string> {
  const resolvedStart = path.resolve(start);
  const homeDir = path.resolve(os.homedir());
  let current = resolvedStart;
  const visited = new Set<string>();
  let nearestGenericProjectRoot: string | null = null;
  while (!visited.has(current)) {
    visited.add(current);
    if (current === homeDir && current !== resolvedStart) break;
    if (await hasAgentProjectMarkers(current)) {
      return current;
    }
    if (await hasGenericProjectMarkers(current)) {
      nearestGenericProjectRoot ??= current;
    }
    for (const marker of VCS_MARKERS) {
      if (await pathExists(path.join(current, marker))) {
        return nearestGenericProjectRoot ?? current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return nearestGenericProjectRoot === resolvedStart
    ? nearestGenericProjectRoot
    : resolvedStart;
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
