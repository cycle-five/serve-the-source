#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter, extractKeys } from "./frontmatter.js";
const DEFAULT_ALLOWLIST = ["title", "description", "date", "tags", "aliases"];
const DRAFT_KEYS = ["draft", "private", "unpublished"];
function parseArgs(argv) {
  const o = {
    contentDir: "content",
    outDir: "public",
    layout: "directory",
    allowlist: DEFAULT_ALLOWLIST,
    dryRun: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === void 0) throw new Error(`${a} needs a value`);
      return v;
    };
    try {
      switch (a) {
        case "--content":
          o.contentDir = next();
          break;
        case "--out":
          o.outDir = next();
          break;
        case "--base":
          o.baseUrl = next();
          break;
        case "--layout": {
          const v = next();
          if (v !== "directory" && v !== "flat") return { error: `--layout must be 'directory' or 'flat', got '${v}'` };
          o.layout = v;
          break;
        }
        case "--allow":
          o.allowlist = next().split(",").map((s) => s.trim()).filter(Boolean);
          break;
        case "--dry-run":
          o.dryRun = true;
          break;
        case "-h":
        case "--help":
          return { error: "help" };
        default:
          return { error: `unknown argument: ${a}` };
      }
    } catch (e) {
      return { error: e.message };
    }
  }
  return o;
}
function outputPathFor(rel, layout) {
  const dir = path.dirname(rel);
  const base = path.basename(rel, ".md");
  const isIndex = base === "index" || base === "_index";
  if (isIndex) return path.join(dir === "." ? "" : dir, "index.md");
  if (layout === "flat") return path.join(dir === "." ? "" : dir, `${base}.md`);
  return path.join(dir === "." ? "" : dir, base, "index.md");
}
function urlPathFor(rel) {
  const dir = path.dirname(rel);
  const base = path.basename(rel, ".md");
  const isIndex = base === "index" || base === "_index";
  const segments = (dir === "." ? "" : dir).split(path.sep).filter(Boolean);
  if (!isIndex) segments.push(base);
  return "/" + segments.join("/");
}
async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith(".")) continue;
      out.push(...await walk(full));
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}
function normaliseBase(b) {
  return b.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "");
}
async function run(o) {
  const files = await walk(o.contentDir);
  let written = 0;
  let skipped = 0;
  for (const abs of files) {
    const rel = path.relative(o.contentDir, abs);
    const raw = await fs.readFile(abs, "utf-8");
    const { body, raw: fmRaw } = parseFrontmatter(raw);
    const isDraft = DRAFT_KEYS.some(
      (k) => new RegExp(`^\\s*${k}\\s*[:=]\\s*true\\s*$`, "mi").test(fmRaw)
    );
    if (isDraft || body.trim() === "") {
      skipped++;
      continue;
    }
    const fields = extractKeys(fmRaw, o.allowlist);
    const urlPath = urlPathFor(rel);
    const source = o.baseUrl ? `https://${normaliseBase(o.baseUrl)}${urlPath}` : urlPath;
    const lines = ["---"];
    for (const k of o.allowlist) {
      const v = fields[k];
      if (v !== void 0) lines.push(`${k}: ${/[:#[\]]/.test(v) ? JSON.stringify(v) : v}`);
    }
    lines.push(`source: ${source}`, "---", "");
    const dest = path.join(o.outDir, outputPathFor(rel, o.layout));
    if (o.dryRun) {
      console.log(`  would write ${dest}`);
    } else {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, lines.join("\n") + body, "utf-8");
    }
    written++;
  }
  return { written, skipped };
}
const HELP = `serve-the-source \u2014 mirror Markdown sources into a built site

  npx serve-the-source [options]

  --content <dir>   source directory            (default: content)
  --out <dir>       built site directory        (default: public)
  --base <host>     site host for the source: field, scheme optional
  --layout <mode>   directory | flat            (default: directory)
                      directory  content/a.md -> public/a/index.md   (Zola, Hugo)
                      flat       content/a.md -> public/a.md
  --allow <k,k>     frontmatter keys to carry over
                      (default: title,description,date,tags,aliases)
  --dry-run         print what would be written, write nothing

Drafts (draft/private/unpublished = true) are skipped: a page that is not
published must not have its source published either.
`;
async function main(argv) {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    if (parsed.error === "help") {
      console.log(HELP);
      return 0;
    }
    console.error(`serve-the-source: ${parsed.error}
`);
    console.error(HELP);
    return 2;
  }
  try {
    const { written, skipped } = await run(parsed);
    console.log(
      `serve-the-source: ${written} source(s) mirrored into ${parsed.outDir}` + (skipped ? `, ${skipped} skipped (draft or empty)` : "")
    );
    return 0;
  } catch (e) {
    console.error(`serve-the-source: ${e.message}`);
    return 1;
  }
}
export {
  main,
  outputPathFor,
  parseArgs,
  run,
  urlPathFor
};
