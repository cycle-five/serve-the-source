import path from "node:path"
import fs from "node:fs/promises"

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
 * Frontmatter is fenced by `---` at the very start of the file. Strict on
 * purpose: the fence must be the first thing in the file, so a horizontal rule
 * further down is never mistaken for one and used to lop off the document.
 */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

export function stripFrontmatter(raw: string): string {
  return raw.replace(FRONTMATTER_RE, "").replace(/^\s+/, "")
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

export const ServeTheSource = (opts?: ServeTheSourceOptions) => ({
  name: "ServeTheSource",
  async emit(ctx: SourceEmitterCtx, content: readonly SourceEmitterContent[]): Promise<FilePath[]> {
    const allowlist = opts?.frontmatterAllowlist ?? DEFAULT_ALLOWLIST
    const includeUnlisted = opts?.includeUnlisted ?? true
    const includeSourceUrl = opts?.includeSourceUrl ?? true
    const baseUrl = ctx.cfg?.configuration?.baseUrl
    const emitted: FilePath[] = []

    for (const [, file] of content) {
      const data = file?.data ?? {}
      if (skipReason(data, { includeUnlisted }) !== null) continue

      // skipReason has already established both are present.
      const slug = data.slug as string
      const relativePath = data.relativePath as string

      let raw: string
      try {
        raw = await fs.readFile(path.join(ctx.argv.directory, relativePath), "utf-8")
      } catch {
        // A page whose source cannot be read is skipped, not fatal. One
        // unreadable file must not take a whole site build down with it.
        continue
      }

      const body = stripFrontmatter(raw)
      if (body.trim() === "") continue

      const sourceUrl =
        includeSourceUrl && baseUrl ? `https://${baseUrl}/${slug}` : includeSourceUrl ? `/${slug}` : undefined
      const out = path.join(ctx.argv.output, `${slug}.md`)
      await fs.mkdir(path.dirname(out), { recursive: true })
      await fs.writeFile(out, buildFrontmatter(data.frontmatter ?? {}, allowlist, sourceUrl) + body, "utf-8")
      emitted.push(out as FilePath)
    }
    return emitted
  },
  async *partialEmit(): AsyncGenerator<FilePath> {},
})

export default ServeTheSource
