// src/index.ts
import path from "node:path";
import fs from "node:fs/promises";
var DEFAULT_ALLOWLIST = ["title", "tags", "date", "description", "aliases"];
var FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
function stripFrontmatter(raw) {
  return raw.replace(FRONTMATTER_RE, "").replace(/^\s+/, "");
}
function yamlScalar(v) {
  const s = String(v);
  return /^[\w .,'()/-]+$/.test(s) && !/^\s|\s$/.test(s) ? s : JSON.stringify(s);
}
function buildFrontmatter(fm, allowlist, sourceUrl) {
  const lines = ["---"];
  for (const key of allowlist) {
    const v = fm[key];
    if (v === void 0 || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${key}: [${v.map(yamlScalar).join(", ")}]`);
    } else if (v instanceof Date) {
      lines.push(`${key}: ${v.toISOString()}`);
    } else {
      lines.push(`${key}: ${yamlScalar(v)}`);
    }
  }
  if (sourceUrl) lines.push(`source: ${sourceUrl}`);
  lines.push("---", "");
  return lines.join("\n");
}
function skipReason(data, opts) {
  if (data.encrypted === true) return "encrypted";
  if (!data.slug) return "no slug";
  if (!data.relativePath) return "no source file (generated page)";
  if (data.unlisted === true && !opts.includeUnlisted) return "unlisted";
  return null;
}
var ServeTheSource = (opts) => ({
  name: "ServeTheSource",
  async emit(ctx, content) {
    const allowlist = opts?.frontmatterAllowlist ?? DEFAULT_ALLOWLIST;
    const includeUnlisted = opts?.includeUnlisted ?? true;
    const includeSourceUrl = opts?.includeSourceUrl ?? true;
    const baseUrl = ctx.cfg?.configuration?.baseUrl;
    const emitted = [];
    for (const [, file] of content) {
      const data = file?.data ?? {};
      if (skipReason(data, { includeUnlisted }) !== null) continue;
      const slug = data.slug;
      const relativePath = data.relativePath;
      let raw;
      try {
        raw = await fs.readFile(path.join(ctx.argv.directory, relativePath), "utf-8");
      } catch {
        continue;
      }
      const body = stripFrontmatter(raw);
      if (body.trim() === "") continue;
      const sourceUrl = includeSourceUrl && baseUrl ? `https://${baseUrl}/${slug}` : includeSourceUrl ? `/${slug}` : void 0;
      const out = path.join(ctx.argv.output, `${slug}.md`);
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, buildFrontmatter(data.frontmatter ?? {}, allowlist, sourceUrl) + body, "utf-8");
      emitted.push(out);
    }
    return emitted;
  },
  async *partialEmit() {
  }
});
var index_default = ServeTheSource;
export {
  ServeTheSource,
  buildFrontmatter,
  index_default as default,
  skipReason,
  stripFrontmatter,
  yamlScalar
};
