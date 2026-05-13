import { describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  stringifyFrontmatter,
} from "../../src/core/converter.js";

describe("core/converter", () => {
  it("round-trips a frontmatter document", () => {
    const text = "---\ndescription: hello\n---\nbody\n";
    const doc = parseFrontmatter(text);
    expect(doc.data).toEqual({ description: "hello" });
    expect(doc.content.trim()).toBe("body");
    const back = stringifyFrontmatter(doc);
    expect(back).toContain("description: hello");
    expect(back).toContain("body");
  });

  it("returns plain body when no frontmatter is present", () => {
    const doc = parseFrontmatter("just text\n");
    expect(doc.data).toEqual({});
    expect(doc.content).toBe("just text\n");
  });
});
