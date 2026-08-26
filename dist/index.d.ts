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
export type FilePath = string & {
    _brand: "FilePath";
};
export type FullSlug = string & {
    _brand: "FullSlug";
};
/** The subset of a build context this emitter needs. */
export interface SourceEmitterCtx {
    argv: {
        directory: string;
        output: string;
    };
    cfg?: {
        configuration?: {
            baseUrl?: string;
        };
    };
}
/** The subset of a page's parsed data this emitter reads. */
export interface SourceEmitterFileData {
    /** Output slug, without extension. `avatars`, `notes/deep-dive`. */
    slug?: string;
    /** Source path relative to the content directory. */
    relativePath?: string;
    /** Set by an encryption plugin. See the security note below. */
    encrypted?: boolean;
    /** Parsed frontmatter. Never copied wholesale — see `frontmatterAllowlist`. */
    frontmatter?: Record<string, unknown>;
    /** Set when a page is published but deliberately unlinked. */
    unlisted?: boolean;
}
export interface SourceEmitterFile {
    data?: SourceEmitterFileData;
}
/** Generators hand emitters `[tree, vfile]` pairs; the tree is unused here. */
export type SourceEmitterContent = readonly [unknown, SourceEmitterFile];
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
    frontmatterAllowlist?: readonly string[];
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
    includeUnlisted?: boolean;
    /**
     * Emit a `source:` field pointing at the canonical URL of the page.
     *
     * Default: `true`
     */
    includeSourceUrl?: boolean;
}
export declare function stripFrontmatter(raw: string): string;
/**
 * Quote anything that could change the meaning of a YAML line. Conservative by
 * design — over-quoting a title costs nothing, while under-quoting one that
 * contains a colon produces a file that will not parse.
 */
export declare function yamlScalar(v: unknown): string;
export declare function buildFrontmatter(fm: Record<string, unknown>, allowlist: readonly string[], sourceUrl?: string): string;
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
export declare function skipReason(data: SourceEmitterFileData, opts: {
    includeUnlisted: boolean;
}): string | null;
export declare const ServeTheSource: (opts?: ServeTheSourceOptions) => {
    name: string;
    emit(ctx: SourceEmitterCtx, content: readonly SourceEmitterContent[]): Promise<FilePath[]>;
    partialEmit(): AsyncGenerator<FilePath>;
};
export default ServeTheSource;
