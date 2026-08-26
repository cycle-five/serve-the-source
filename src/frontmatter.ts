/**
 * Frontmatter handling shared by the Quartz emitter and the CLI.
 *
 * Two fence styles are supported because two ecosystems chose differently:
 * YAML between `---` (Quartz, Jekyll, Astro, Eleventy) and TOML between `+++`
 * (Zola, Hugo). A tool that only knew one would silently leave the other's
 * whole block sitting in the emitted body — including whatever secrets it
 * carries — which is the same failure class as the BOM bug.
 */

/**
 * 🚨 THE BOM STRIP IS A SECURITY FIX, not tidiness. The fence regexes are
 * anchored at index 0, so a UTF-8 BOM pushes the opening fence to index 1 and
 * the match silently fails — leaving the ENTIRE frontmatter block in the body,
 * `password` field and all. Windows editors write BOMs by default.
 */
const BOM = /^﻿/

/**
 * Both fences must be the FIRST thing in the file. Strict on purpose: an
 * unanchored match would treat a `---` horizontal rule further down as a fence
 * and lop off the top of the document.
 */
const YAML_FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const TOML_FENCE = /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?/

export interface ParsedFrontmatter {
  /** The document with its frontmatter removed. */
  body: string
  /** Raw frontmatter text, fences excluded. Empty when there was none. */
  raw: string
  format: "yaml" | "toml" | "none"
}

export function parseFrontmatter(input: string): ParsedFrontmatter {
  const raw = input.replace(BOM, "")
  const yaml = YAML_FENCE.exec(raw)
  if (yaml) {
    return { body: raw.slice(yaml[0].length).replace(/^\s+/, ""), raw: yaml[1] ?? "", format: "yaml" }
  }
  const toml = TOML_FENCE.exec(raw)
  if (toml) {
    return { body: raw.slice(toml[0].length).replace(/^\s+/, ""), raw: toml[1] ?? "", format: "toml" }
  }
  return { body: raw.replace(/^\s+/, ""), raw: "", format: "none" }
}

/**
 * Pull a small set of named keys out of raw frontmatter, without a YAML or
 * TOML parser.
 *
 * 🚨 SAFE BY CONSTRUCTION, and this is the point: it only ever LOOKS FOR KEYS
 *    IT WAS ASKED FOR. A `password` field is not parsed-then-filtered — it is
 *    never read at all. Adding a parser here would invert that property, which
 *    is why there isn't one.
 *
 * 🪤 Deliberately shallow. Parsing stops at the first TOML table header
 *    (`[extra]`), because keys under it belong to that table rather than the
 *    document root — treating `[extra] title = ...` as a root `title` would
 *    attribute a nested value to the page. Nested structures are simply not
 *    supported; anything needing them should use the emitter API with a real
 *    parser.
 */
export function extractKeys(raw: string, allowlist: readonly string[]): Record<string, string> {
  const want = new Set(allowlist)
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    // A TOML table header ends the root scope. Everything after belongs to it.
    if (/^\[.+\]$/.test(trimmed)) break
    const m = /^([A-Za-z_][\w-]*)\s*[:=]\s*(.+)$/.exec(trimmed)
    if (!m) continue
    const key = m[1]
    if (key === undefined || !want.has(key)) continue
    let value = (m[2] ?? "").trim()
    // Strip one layer of matching quotes; leave arrays and bare scalars alone.
    const quoted = /^"([\s\S]*)"$|^'([\s\S]*)'$/.exec(value)
    if (quoted) value = quoted[1] ?? quoted[2] ?? ""
    if (value !== "") out[key] = value
  }
  return out
}
