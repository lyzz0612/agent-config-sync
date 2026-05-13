import { EditorId } from "../types.js";
import { EditorAdapter } from "./base.js";
import { claudeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import { cursorAdapter } from "./cursor.js";
import { qoderAdapter } from "./qoder.js";

export const adapters: Record<EditorId, EditorAdapter> = {
  cursor: cursorAdapter,
  claude: claudeAdapter,
  codex: codexAdapter,
  qoder: qoderAdapter,
};

export function getAdapter(id: EditorId): EditorAdapter {
  return adapters[id];
}
