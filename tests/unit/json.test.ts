import { describe, expect, it } from "vitest";
import { parseJson, stripBom } from "../../src/utils/json.js";

describe("utils/json", () => {
  it("stripBom removes a leading UTF-8 BOM", () => {
    expect(stripBom("\uFEFF{}\n")).toBe("{}\n");
  });

  it("stripBom is a no-op without a BOM", () => {
    expect(stripBom("{}\n")).toBe("{}\n");
  });

  it("parseJson tolerates a BOM-prefixed payload", () => {
    const text = "\uFEFF" + JSON.stringify({ mcpServers: { x: {} } });
    expect(parseJson(text)).toEqual({ mcpServers: { x: {} } });
  });

  it("parseJson surfaces the source path on failure", () => {
    expect(() => parseJson("not json", "/tmp/foo.json")).toThrow(
      /\/tmp\/foo\.json/,
    );
  });
});
