// src/index.ts
import path from "node:path";
import fs from "node:fs/promises";
var DEFAULT_ALLOWLIST = ["title", "tags", "date", "description", "aliases"];
var FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
function stripFrontmatter(raw) {
  return raw.replace(/^﻿/, "").replace(FRONTMATTER_RE, "").replace(/^\s+/, "");
}
function normaliseBaseUrl(baseUrl) {
  return baseUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "");
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
function resolve(opts, ctx) {
  const raw = ctx.cfg?.configuration?.baseUrl;
  return {
    allowlist: opts?.frontmatterAllowlist ?? DEFAULT_ALLOWLIST,
    includeUnlisted: opts?.includeUnlisted ?? true,
    includeSourceUrl: opts?.includeSourceUrl ?? true,
    baseUrl: raw ? normaliseBaseUrl(raw) : void 0,
    contentDir: ctx.argv.directory,
    outDir: ctx.argv.output
  };
}
async function emitOne(r, data) {
  if (skipReason(data, { includeUnlisted: r.includeUnlisted }) !== null) return null;
  const slug = data.slug;
  const relativePath = data.relativePath;
  let raw;
  try {
    raw = await fs.readFile(path.join(r.contentDir, relativePath), "utf-8");
  } catch {
    return null;
  }
  const body = stripFrontmatter(raw);
  if (body.trim() === "") return null;
  const sourceUrl = !r.includeSourceUrl ? void 0 : r.baseUrl ? `https://${r.baseUrl}/${slug}` : `/${slug}`;
  const out = path.join(r.outDir, `${slug}.md`);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, buildFrontmatter(data.frontmatter ?? {}, r.allowlist, sourceUrl) + body, "utf-8");
  return out;
}
var ServeTheSource = (opts) => ({
  name: "ServeTheSource",
  async emit(ctx, content) {
    const r = resolve(opts, ctx);
    const emitted = [];
    for (const [, file] of content) {
      const out = await emitOne(r, file?.data ?? {});
      if (out !== null) emitted.push(out);
    }
    return emitted;
  },
  /**
   * Watch/serve mode: refresh only what changed.
   *
   * 🪤 WITHOUT THIS, EDITS GO STALE. A no-op partialEmit means the .md mirrors
   * keep whatever content they had when the dev server started, so a watch
   * session serves a document that no longer matches the page beside it.
   *
   * Deletes are handled too, and matter more than they look: leaving an
   * orphaned .md behind means a page removed from the site is still readable
   * at its old URL by anyone asking for Markdown -- the HTML is gone, the
   * source is not.
   */
  async partialEmit(ctx, _content, _resources, changeEvents) {
    const r = resolve(opts, ctx);
    const emitted = [];
    for (const ev of changeEvents) {
      const data = ev.file?.data;
      if (ev.type === "delete") {
        if (!data?.slug) continue;
        await fs.rm(path.join(r.outDir, `${data.slug}.md`), { force: true });
        continue;
      }
      if (!data) continue;
      const out = await emitOne(r, data);
      if (out !== null) emitted.push(out);
    }
    return emitted;
  }
});
var index_default = ServeTheSource;
export {
  ServeTheSource,
  buildFrontmatter,
  index_default as default,
  normaliseBaseUrl,
  skipReason,
  stripFrontmatter,
  yamlScalar
};
