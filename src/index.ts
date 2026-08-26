import path from "node:path"
import fs from "node:fs/promises"
import { parseFrontmatter } from "./frontmatter.js"

/**
 * serve-the-source — emit the Markdown source beside every rendered page.
 *
 * A static site generator turns Markdown into HTML. An agent then asks for the
 * HTML and receives roughly twenty times more bytes than the document holds,
 * nearly all of it presentation it will discard. The source it actually wanted
 * was on disk the whole time.
 *
 * This emitter writes `<slug>.md` next to every `<slug>.html`, so the source
 * can be served directly. Nothing is converted and nothing is inferred: the
 * Markdown IS the document, and the HTML is the derived artifact.
 *
 * Measured on the site this was written for (cracktun.es, Quartz v5):
 *
 *     avatars.html   20,615 bytes  ->  avatars.md   1,009 bytes   20.4x
 *     index.html     23,379 bytes  ->  index.md     1,141 bytes   20.4x
 *     whole build     1.40 MB      ->               184 KB         7.6x
 *
 * Of avatars.html, `<head>` alone is 5,193 bytes -- a quarter of the page
 * before any content. The rest is component stylesheet links, OG meta, font
 * preloads and client-side scaffolding. What an agent needs -- headings,
 * lists, links, emphasis, code -- survives Markdown intact.
 *
 * ZERO RUNTIME DEPENDENCIES. The interfaces below are structural, so this
 * drops into Quartz without importing its types. Compatibility with the real
 * `QuartzEmitterPlugin` is proven at build time by test/conformance.ts, which
 * is not shipped.
 */

/**
 * Branded path types, declared to match Quartz's exactly.
 *
 * 🪤 THE BRAND IS NOT DECORATION. Quartz types a path as
 * `string & { _brand: "FilePath" }`, so a plain `string[]` return is NOT
 * assignable to its emitter contract and a strict consumer gets a type error —
 * even though the code runs correctly, because brands are erased at runtime.
 * That mismatch is invisible until someone type-checks against the real
 * interface, which is exactly what test/conformance.ts does, and exactly what
 * it caught on its first run.
 *
 * These are declared here rather than imported so the module keeps zero
 * dependencies. TypeScript compares them structurally, so a locally-declared
 * `{ _brand: "FilePath" }` and Quartz's own are mutually assignable.
 */
export type FilePath = string & { _brand: "FilePath" }
export type FullSlug = string & { _brand: "FullSlug" }

/** The subset of a build context this emitter needs. */
export interface SourceEmitterCtx {
  argv: { directory: string; output: string }
  cfg?: { configuration?: { baseUrl?: string } }
}

/** The subset of a page's parsed data this emitter reads. */
export interface SourceEmitterFileData {
  /** Output slug, without extension. `avatars`, `notes/deep-dive`. */
  slug?: string
  /** Source path relative to the content directory. */
  relativePath?: string
  /** Set by an encryption plugin. See the security note below. */
  encrypted?: boolean
  /** Parsed frontmatter. Never copied wholesale — see `frontmatterAllowlist`. */
  frontmatter?: Record<string, unknown>
  /** Set when a page is published but deliberately unlinked. */
  unlisted?: boolean
}

export interface SourceEmitterFile {
  data?: SourceEmitterFileData
}

/** Generators hand emitters `[tree, vfile]` pairs; the tree is unused here. */
export type SourceEmitterContent = readonly [unknown, SourceEmitterFile]

/** A watch-mode change event, matching Quartz's `ChangeEvent`. */
export interface SourceChangeEvent {
  type: "add" | "change" | "delete"
  path: string
  file?: SourceEmitterFile
}

export interface ServeTheSourceOptions {
  /**
   * Frontmatter keys copied onto emitted files.
   *
   * 🚨 AN ALLOWLIST, NEVER A DENYLIST, and this is the single most important
   * option here. Frontmatter routinely carries things that must not be
   * published — an encryption plugin's `password` field is the obvious one,
   * but private URLs, internal IDs and review notes all live there too.
   * Copying a source file verbatim publishes every one of them.
   *
   * Setting this REPLACES the default; it does not extend it.
   *
   * Default: `["title", "tags", "date", "description", "aliases"]`
   */
  frontmatterAllowlist?: readonly string[]

  /**
   * Emit sources for pages marked `unlisted`.
   *
   * An unlisted page is published but unlinked — reachable only if you know
   * the URL. Its HTML is already served, so emitting the Markdown exposes
   * nothing new, which is why the default is `true`. Set `false` if unlisted
   * means "should not be trivially harvestable" in your setup.
   *
   * Default: `true`
   */
  includeUnlisted?: boolean

  /**
   * Emit a `source:` field pointing at the canonical URL of the page.
   *
   * Default: `true`
   */
  includeSourceUrl?: boolean
}

const DEFAULT_ALLOWLIST: readonly string[] = ["title", "tags", "date", "description", "aliases"]

/**
 * Remove a leading frontmatter block, whichever fence style it uses.
 *
 * Delegates to the shared parser so the emitter and the CLI cannot diverge on
 * BOM handling or on TOML (`+++`) versus YAML (`---`) fences — a divergence
 * would mean one path leaks a frontmatter block the other strips.
 */
export function stripFrontmatter(raw: string): string {
  return parseFrontmatter(raw).body
}

/**
 * Normalise a configured base URL to a bare host.
 *
 * 🪤 Quartz's convention is a bare host (`baseUrl: cracktun.es`) and its own
 * CNAME plugin assumes it too -- but operators write the scheme in constantly,
 * and `https://${baseUrl}` then produces `https://https://host/slug`. Cheap to
 * absorb, silently wrong if not.
 */
export function normaliseBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "")
}

/**
 * Quote anything that could change the meaning of a YAML line. Conservative by
 * design — over-quoting a title costs nothing, while under-quoting one that
 * contains a colon produces a file that will not parse.
 */
export function yamlScalar(v: unknown): string {
  const s = String(v)
  return /^[\w .,'()/-]+$/.test(s) && !/^\s|\s$/.test(s) ? s : JSON.stringify(s)
}

export function buildFrontmatter(
  fm: Record<string, unknown>,
  allowlist: readonly string[],
  sourceUrl?: string,
): string {
  const lines: string[] = ["---"]
  for (const key of allowlist) {
    const v = fm[key]
    if (v === undefined || v === null || v === "") continue
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      lines.push(`${key}: [${v.map(yamlScalar).join(", ")}]`)
    } else if (v instanceof Date) {
      lines.push(`${key}: ${v.toISOString()}`)
    } else {
      lines.push(`${key}: ${yamlScalar(v)}`)
    }
  }
  if (sourceUrl) lines.push(`source: ${sourceUrl}`)
  lines.push("---", "")
  return lines.join("\n")
}

/**
 * Decide whether a page's source may be emitted, and say why not when it may
 * not. Exported so the reasoning is testable on its own, without a filesystem.
 *
 * 🚨 THE `encrypted` CHECK IS THE WHOLE BALLGAME. An encryption plugin ships
 *    ciphertext in the HTML and decrypts client-side behind a password.
 *    Emitting that page's Markdown publishes the plaintext right beside it and
 *    defeats the mechanism completely. It is checked first, and it is not
 *    configurable.
 */
export function skipReason(
  data: SourceEmitterFileData,
  opts: { includeUnlisted: boolean },
): string | null {
  if (data.encrypted === true) return "encrypted"
  if (!data.slug) return "no slug"
  if (!data.relativePath) return "no source file (generated page)"
  if (data.unlisted === true && !opts.includeUnlisted) return "unlisted"
  return null
}

/** Everything the two emit paths need, resolved once from options + ctx. */
interface Resolved {
  allowlist: readonly string[]
  includeUnlisted: boolean
  includeSourceUrl: boolean
  baseUrl: string | undefined
  contentDir: string
  outDir: string
}

function resolve(opts: ServeTheSourceOptions | undefined, ctx: SourceEmitterCtx): Resolved {
  const raw = ctx.cfg?.configuration?.baseUrl
  return {
    allowlist: opts?.frontmatterAllowlist ?? DEFAULT_ALLOWLIST,
    includeUnlisted: opts?.includeUnlisted ?? true,
    includeSourceUrl: opts?.includeSourceUrl ?? true,
    baseUrl: raw ? normaliseBaseUrl(raw) : undefined,
    contentDir: ctx.argv.directory,
    outDir: ctx.argv.output,
  }
}

/**
 * Write one page's source. Returns the path written, or null if the page was
 * skipped or unreadable.
 *
 * Shared by emit() and partialEmit() on purpose: a watch-mode rebuild that
 * applied different rules from a full build -- particularly the encryption
 * guard -- would be a leak that only appears while someone is editing.
 */
async function emitOne(r: Resolved, data: SourceEmitterFileData): Promise<FilePath | null> {
  if (skipReason(data, { includeUnlisted: r.includeUnlisted }) !== null) return null
  const slug = data.slug as string
  const relativePath = data.relativePath as string

  let raw: string
  try {
    raw = await fs.readFile(path.join(r.contentDir, relativePath), "utf-8")
  } catch {
    // A page whose source cannot be read is skipped, not fatal. One unreadable
    // file must not take a whole site build down with it.
    return null
  }

  const body = stripFrontmatter(raw)
  if (body.trim() === "") return null

  const sourceUrl = !r.includeSourceUrl
    ? undefined
    : r.baseUrl
      ? `https://${r.baseUrl}/${slug}`
      : `/${slug}`

  const out = path.join(r.outDir, `${slug}.md`)
  await fs.mkdir(path.dirname(out), { recursive: true })
  await fs.writeFile(out, buildFrontmatter(data.frontmatter ?? {}, r.allowlist, sourceUrl) + body, "utf-8")
  return out as FilePath
}

export const ServeTheSource = (opts?: ServeTheSourceOptions) => ({
  name: "ServeTheSource",

  async emit(ctx: SourceEmitterCtx, content: readonly SourceEmitterContent[]): Promise<FilePath[]> {
    const r = resolve(opts, ctx)
    const emitted: FilePath[] = []
    // Sequential on purpose. Measured at 0.10ms/page over 10,000 pages, which
    // is 4ms on a 38-page site -- 0.07% of that build. A concurrency pool
    // would buy under a second on a site nobody has, at the cost of a file
    // descriptor exhaustion mode nobody would hit in testing.
    for (const [, file] of content) {
      const out = await emitOne(r, file?.data ?? {})
      if (out !== null) emitted.push(out)
    }
    return emitted
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
  async partialEmit(
    ctx: SourceEmitterCtx,
    _content: readonly SourceEmitterContent[],
    _resources: unknown,
    changeEvents: readonly SourceChangeEvent[],
  ): Promise<FilePath[]> {
    const r = resolve(opts, ctx)
    const emitted: FilePath[] = []

    for (const ev of changeEvents) {
      const data = ev.file?.data
      if (ev.type === "delete") {
        // The slug is the only way to know which output to remove; without one
        // there is nothing to do.
        if (!data?.slug) continue
        await fs.rm(path.join(r.outDir, `${data.slug}.md`), { force: true })
        continue
      }
      if (!data) continue
      const out = await emitOne(r, data)
      if (out !== null) emitted.push(out)
    }
    return emitted
  },
})

export default ServeTheSource
