import { createMirrorAdapter } from "./factory.js";

export const codexAdapter = createMirrorAdapter({
  id: "codex",
  configFormat: "toml",
});
