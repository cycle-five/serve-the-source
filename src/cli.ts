#!/usr/bin/env node
/**
 * serve-the-source CLI — for generators without a plugin API.
 *
 * The Quartz emitter gets slugs handed to it. Zola, Hugo and hand-rolled
 * static sites don't work that way, so this walks a content directory and
 * mirrors each Markdown file into the build output beside its rendered page.
 *
 *     npx serve-the-source --content content --out public --base cyclefive.xyz
 *
 * 🪤 LAYOUT IS NOT COSMETIC — get it wrong and every file lands somewhere
 *    nothing will look for it.
 *
 *      directory  content/about.md -> public/about/index.md      (Zola, Hugo)
 *      flat       content/about.md -> public/about.md            (Quartz-like)
 *
 *    Zola renders `content/about.md` to `public/about/index.html`, so the
 *    source belongs at `public/about/index.md`. Defaults to `directory`
 *    because that is what the generators needing this CLI actually do.
 *
 * Section indexes (`_index.md`, `index.md`) map to the directory itself:
 * `content/blog/_index.md` -> `public/blog/index.md`.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { parseFrontmatter, extractKeys } from "./frontmatter.js"

const DEFAULT_ALLOWLIST = ["title", "description", "date", "tags", "aliases"] as const

/** Frontmatter keys that mark a page as not-for-publication, in any generator. */
const DRAFT_KEYS = ["draft", "private", "unpublished"] as const

export interface CliOptions {
  contentDir: string
  outDir: string
  baseUrl?: string
  layout: "directory" | "flat"
  allowlist: readonly string[]
  dryRun: boolean
}

export function parseArgs(argv: readonly string[]): CliOptions | { error: string } {
  const o: CliOptions = {
    contentDir: "content",
    outDir: "public",
    layout: "directory",
    allowlist: DEFAULT_ALLOWLIST,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} needs a value`)
      return v
    }
    try {
      switch (a) {
        case "--content": o.contentDir = next(); break
        case "--out": o.outDir = next(); break
        case "--base": o.baseUrl = next(); break
        case "--layout": {
          const v = next()
          if (v !== "directory" && v !== "flat") return { error: `--layout must be 'directory' or 'flat', got '${v}'` }
          o.layout = v
          break
        }
        case "--allow": o.allowlist = next().split(",").map((s) => s.trim()).filter(Boolean); break
        case "--dry-run": o.dryRun = true; break
        case "-h":
        case "--help": return { error: "help" }
        default: return { error: `unknown argument: ${a}` }
      }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }
  return o
}

/** Map a content-relative Markdown path to its output path. */
export function outputPathFor(rel: string, layout: "directory" | "flat"): string {
  const dir = path.dirname(rel)
  const base = path.basename(rel, ".md")
  const isIndex = base === "index" || base === "_index"
  if (isIndex) return path.join(dir === "." ? "" : dir, "index.md")
  if (layout === "flat") return path.join(dir === "." ? "" : dir, `${base}.md`)
  return path.join(dir === "." ? "" : dir, base, "index.md")
}

/** The canonical URL path a content file corresponds to. */
export function urlPathFor(rel: string): string {
  const dir = path.dirname(rel)
  const base = path.basename(rel, ".md")
  const isIndex = base === "index" || base === "_index"
  const segments = (dir === "." ? "" : dir).split(path.sep).filter(Boolean)
  if (!isIndex) segments.push(base)
  return "/" + segments.join("/")
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name.startsWith(".")) continue
      out.push(...(await walk(full)))
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(full)
    }
  }
  return out
}

function normaliseBase(b: string): string {
  return b.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "")
}

export async function run(o: CliOptions): Promise<{ written: number; skipped: number }> {
  const files = await walk(o.contentDir)
  let written = 0
  let skipped = 0

  for (const abs of files) {
    const rel = path.relative(o.contentDir, abs)
    const raw = await fs.readFile(abs, "utf-8")
    const { body, raw: fmRaw } = parseFrontmatter(raw)

    // A draft is not published, so its source must not be either. Checked
    // against the raw text rather than a parsed document, so it works the same
    // for YAML and TOML.
    const isDraft = DRAFT_KEYS.some((k) =>
      new RegExp(`^\\s*${k}\\s*[:=]\\s*true\\s*$`, "mi").test(fmRaw),
    )
    if (isDraft || body.trim() === "") {
      skipped++
      continue
    }

    const fields = extractKeys(fmRaw, o.allowlist)
    const urlPath = urlPathFor(rel)
    const source = o.baseUrl ? `https://${normaliseBase(o.baseUrl)}${urlPath}` : urlPath

    const lines = ["---"]
    for (const k of o.allowlist) {
      const v = fields[k]
      if (v !== undefined) lines.push(`${k}: ${/[:#[\]]/.test(v) ? JSON.stringify(v) : v}`)
    }
    lines.push(`source: ${source}`, "---", "")

    const dest = path.join(o.outDir, outputPathFor(rel, o.layout))
    if (o.dryRun) {
      console.log(`  would write ${dest}`)
    } else {
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, lines.join("\n") + body, "utf-8")
    }
    written++
  }
  return { written, skipped }
}

const HELP = `serve-the-source — mirror Markdown sources into a built site

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
`

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv)
  if ("error" in parsed) {
    if (parsed.error === "help") {
      console.log(HELP)
      return 0
    }
    console.error(`serve-the-source: ${parsed.error}\n`)
    console.error(HELP)
    return 2
  }
  try {
    const { written, skipped } = await run(parsed)
    console.log(
      `serve-the-source: ${written} source(s) mirrored into ${parsed.outDir}` +
        (skipped ? `, ${skipped} skipped (draft or empty)` : ""),
    )
    return 0
  } catch (e) {
    console.error(`serve-the-source: ${(e as Error).message}`)
    return 1
  }
}
