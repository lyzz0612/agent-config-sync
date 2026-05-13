import TOML from "@iarna/toml";

export function jsonToToml(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("jsonToToml expects a plain object at the top level");
  }
  return TOML.stringify(value as TOML.JsonMap);
}

export function tomlToJson(text: string): Record<string, unknown> {
  return TOML.parse(text) as Record<string, unknown>;
}
