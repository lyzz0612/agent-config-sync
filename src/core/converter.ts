import matter from "gray-matter";

export interface RuleDoc {
  /** Parsed frontmatter, missing fields are `undefined`. */
  data: Record<string, unknown>;
  /** Markdown body without the frontmatter fence. */
  content: string;
}

export function parseFrontmatter(text: string): RuleDoc {
  const parsed = matter(text);
  return {
    data: { ...(parsed.data as Record<string, unknown>) },
    content: parsed.content.replace(/^\n/, ""),
  };
}

export function stringifyFrontmatter(doc: RuleDoc): string {
  const hasData = Object.keys(doc.data).length > 0;
  if (!hasData) {
    return doc.content.endsWith("\n") ? doc.content : `${doc.content}\n`;
  }
  return matter.stringify(doc.content, doc.data);
}

/** Return a shallow copy with only the listed keys preserved. */
export function pickKeys<T extends Record<string, unknown>>(
  data: T,
  keys: readonly string[],
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    if (key in data) {
      (out as Record<string, unknown>)[key] = data[key];
    }
  }
  return out;
}

/** Merge two frontmatter blocks; values from `override` take precedence. */
export function mergeData(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  return { ...base, ...override };
}
