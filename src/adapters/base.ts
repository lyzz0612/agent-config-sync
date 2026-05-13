import {
  ConfigType,
  EditorId,
  ImportStrategy,
  SyncOptions,
  WriteResult,
} from "../types.js";

export interface SyncContext {
  root: string;
  options: SyncOptions;
}

export interface ImportContext {
  root: string;
  strategy: ImportStrategy;
  type: ConfigType;
  dryRun?: boolean;
}

export interface EditorAdapter {
  id: EditorId;
  /** Sync a single config type from `.ai/` into this editor's directory. */
  sync(type: ConfigType, ctx: SyncContext): Promise<WriteResult[]>;
  /** Reverse path: read this editor's files and merge / overwrite `.ai/`. */
  import(ctx: ImportContext): Promise<WriteResult[]>;
  /**
   * Optional: list the config types this editor currently has content for.
   * Used by `import` to display per-type strategy prompts.
   */
  availableTypes(root: string): Promise<ConfigType[]>;
}
