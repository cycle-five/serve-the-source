const BOM = /^﻿/;
const YAML_FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const TOML_FENCE = /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?/;
function parseFrontmatter(input) {
  const raw = input.replace(BOM, "");
  const yaml = YAML_FENCE.exec(raw);
  if (yaml) {
    return { body: raw.slice(yaml[0].length).replace(/^\s+/, ""), raw: yaml[1] ?? "", format: "yaml" };
  }
  const toml = TOML_FENCE.exec(raw);
  if (toml) {
    return { body: raw.slice(toml[0].length).replace(/^\s+/, ""), raw: toml[1] ?? "", format: "toml" };
  }
  return { body: raw.replace(/^\s+/, ""), raw: "", format: "none" };
}
function extractKeys(raw, allowlist) {
  const want = new Set(allowlist);
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (/^\[.+\]$/.test(trimmed)) break;
    const m = /^([A-Za-z_][\w-]*)\s*[:=]\s*(.+)$/.exec(trimmed);
    if (!m) continue;
    const key = m[1];
    if (key === void 0 || !want.has(key)) continue;
    let value = (m[2] ?? "").trim();
    const quoted = /^"([\s\S]*)"$|^'([\s\S]*)'$/.exec(value);
    if (quoted) value = quoted[1] ?? quoted[2] ?? "";
    if (value !== "") out[key] = value;
  }
  return out;
}
export {
  extractKeys,
  parseFrontmatter
};
