/**
 * UTF-8 BOM character. Editors on Windows (Notepad, some PowerShell redirects)
 * often add it to JSON files even though it is not valid JSON.
 */
const BOM = "\uFEFF";

/** Strip a leading UTF-8 BOM from `text`, if any. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse JSON text, tolerating a leading UTF-8 BOM and producing an error
 * message that includes the source path (when supplied) for easier debugging.
 */
export function parseJson<T = unknown>(text: string, source?: string): T {
  try {
    return JSON.parse(stripBom(text)) as T;
  } catch (err) {
    const where = source ? ` at ${source}` : "";
    throw new Error(
      `Failed to parse JSON${where}: ${(err as Error).message}`,
    );
  }
}

export { BOM };
