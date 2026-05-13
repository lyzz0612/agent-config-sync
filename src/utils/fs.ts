import fse from "fs-extra";
import path from "node:path";

/** Resolve a path that must remain inside `root` to mitigate accidental escapes. */
export function safeJoin(root: string, ...segments: string[]): string {
  const resolved = path.resolve(root, ...segments);
  const normalisedRoot = path.resolve(root);
  if (
    resolved !== normalisedRoot &&
    !resolved.startsWith(normalisedRoot + path.sep)
  ) {
    throw new Error(
      `Refusing to operate outside project root: ${resolved} (root=${normalisedRoot})`,
    );
  }
  return resolved;
}

export async function pathExists(target: string): Promise<boolean> {
  return fse.pathExists(target);
}

export async function readTextIfExists(target: string): Promise<string | null> {
  try {
    return await fse.readFile(target, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Read a directory, returning [] when the directory is missing. */
export async function listDir(target: string): Promise<string[]> {
  try {
    return await fse.readdir(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function ensureDir(target: string): Promise<void> {
  await fse.ensureDir(target);
}

export async function writeText(target: string, content: string): Promise<void> {
  await fse.ensureDir(path.dirname(target));
  await fse.writeFile(target, content, "utf8");
}

/** Walk a directory recursively, returning relative file paths. */
export async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string, rel: string): Promise<void> {
    const entries = await listDir(dir);
    for (const name of entries) {
      const abs = path.join(dir, name);
      const relPath = rel ? path.posix.join(rel, name) : name;
      const stat = await fse.stat(abs);
      if (stat.isDirectory()) {
        await visit(abs, relPath);
      } else if (stat.isFile()) {
        out.push(relPath);
      }
    }
  }
  if (await pathExists(root)) {
    await visit(root, "");
  }
  return out;
}

export { fse };
