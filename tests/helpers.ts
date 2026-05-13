import os from "node:os";
import path from "node:path";
import fse from "fs-extra";

let symlinkCapability: boolean | null = null;

/**
 * Probe once whether the current process can create symbolic links. On
 * Windows this typically requires Developer Mode or admin rights; in that
 * case integration tests that depend on real symlinks are skipped.
 */
export async function canCreateSymlinks(): Promise<boolean> {
  if (symlinkCapability !== null) return symlinkCapability;
  const dir = await fse.mkdtemp(path.join(os.tmpdir(), "acs-linkprobe-"));
  try {
    const src = path.join(dir, "src");
    const lnk = path.join(dir, "lnk");
    await fse.writeFile(src, "x", "utf8");
    try {
      await fse.symlink(src, lnk, "file");
      symlinkCapability = true;
    } catch {
      symlinkCapability = false;
    }
  } finally {
    await fse.remove(dir);
  }
  return symlinkCapability;
}

/**
 * Create a temporary, isolated project directory. The directory is fully owned
 * by the test that requested it and is wiped via `dispose()`.
 */
export async function makeTempProject(prefix = "agentcs-test"): Promise<{
  root: string;
  dispose: () => Promise<void>;
}> {
  const root = await fse.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  return {
    root,
    dispose: async () => {
      await fse.remove(root);
    },
  };
}

export async function writeFile(
  root: string,
  rel: string,
  content: string,
): Promise<string> {
  const full = path.join(root, rel);
  await fse.ensureDir(path.dirname(full));
  await fse.writeFile(full, content, "utf8");
  return full;
}

export async function readFile(root: string, rel: string): Promise<string> {
  return fse.readFile(path.join(root, rel), "utf8");
}

export async function exists(root: string, rel: string): Promise<boolean> {
  return fse.pathExists(path.join(root, rel));
}

export async function ensureGitRoot(root: string): Promise<void> {
  await fse.ensureDir(path.join(root, ".git"));
  await fse.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
}

export async function scaffoldAi(root: string): Promise<void> {
  await fse.ensureDir(path.join(root, ".ai", "rules"));
  await fse.ensureDir(path.join(root, ".ai", "skills"));
  await fse.ensureDir(path.join(root, ".ai", "hooks"));
  await fse.writeFile(
    path.join(root, ".ai", "mcp.json"),
    JSON.stringify({ mcpServers: { demo: { command: "node" } } }, null, 2),
    "utf8",
  );
  await fse.writeFile(
    path.join(root, ".ai", "hooks.json"),
    JSON.stringify({ hooks: [{ event: "save", run: "echo hi" }] }, null, 2),
    "utf8",
  );
  await fse.writeFile(
    path.join(root, ".ai", "rules", "style.md"),
    "---\ndescription: Style rules\n---\n\n# Style\n\nUse semicolons.\n",
    "utf8",
  );
  await fse.writeFile(
    path.join(root, ".ai", "skills", "demo.md"),
    "# Demo skill\n",
    "utf8",
  );
}
