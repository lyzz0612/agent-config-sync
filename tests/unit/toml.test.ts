import { describe, expect, it } from "vitest";
import { jsonToToml, tomlToJson } from "../../src/utils/toml.js";

describe("utils/toml", () => {
  it("round-trips a JSON object", () => {
    const data = {
      mcpServers: {
        demo: { command: "node", args: ["a.js"] },
      },
    };
    const text = jsonToToml(data);
    const back = tomlToJson(text);
    expect(back).toEqual(data);
  });

  it("rejects non-object inputs", () => {
    expect(() => jsonToToml(null)).toThrow();
    expect(() => jsonToToml([1, 2, 3])).toThrow();
  });

  it("throws on malformed TOML input", () => {
    expect(() => tomlToJson("not = valid = toml")).toThrow();
  });
});
