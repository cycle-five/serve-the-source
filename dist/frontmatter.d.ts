/**
 * Frontmatter handling shared by the Quartz emitter and the CLI.
 *
 * Two fence styles are supported because two ecosystems chose differently:
 * YAML between `---` (Quartz, Jekyll, Astro, Eleventy) and TOML between `+++`
 * (Zola, Hugo). A tool that only knew one would silently leave the other's
 * whole block sitting in the emitted body — including whatever secrets it
 * carries — which is the same failure class as the BOM bug.
 */
export interface ParsedFrontmatter {
    /** The document with its frontmatter removed. */
    body: string;
    /** Raw frontmatter text, fences excluded. Empty when there was none. */
    raw: string;
    format: "yaml" | "toml" | "none";
}
export declare function parseFrontmatter(input: string): ParsedFrontmatter;
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
export declare function extractKeys(raw: string, allowlist: readonly string[]): Record<string, string>;
