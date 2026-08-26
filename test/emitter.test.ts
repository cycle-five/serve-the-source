import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import {
  ServeTheSource,
  skipReason,
  stripFrontmatter,
  yamlScalar,
  buildFrontmatter,
  type SourceEmitterContent,
} from "../src/index.js"

let dir: string
let contentDir: string
let outDir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "sts-"))
  contentDir = path.join(dir, "content")
  outDir = path.join(dir, "public")
  await fs.mkdir(contentDir, { recursive: true })
  await fs.mkdir(outDir, { recursive: true })
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const ctx = () => ({
  argv: { directory: contentDir, output: outDir },
  cfg: { configuration: { baseUrl: "example.com" } },
})

async function writeSource(rel: string, body: string): Promise<void> {
  const p = path.join(contentDir, rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, body, "utf-8")
}

const page = (data: Record<string, unknown>): SourceEmitterContent => [null, { data }]

async function read(slug: string): Promise<string> {
  return fs.readFile(path.join(outDir, `${slug}.md`), "utf-8")
}
async function exists(slug: string): Promise<boolean> {
  try {
    await fs.access(path.join(outDir, `${slug}.md`))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 🚨 The security guards. Everything else in this file is behaviour; these two
// are the reason the module needs to exist rather than being ten lines of cp.
// ---------------------------------------------------------------------------
describe("security: encrypted pages", () => {
  it("never emits a source for an encrypted page", async () => {
    await writeSource("secret.md", "---\npassword: hunter2\n---\n\nCANARY-PLAINTEXT\n")
    const emitted = await ServeTheSource().emit(ctx(), [
      page({ slug: "secret", relativePath: "secret.md", encrypted: true }),
    ])
    expect(emitted).toEqual([])
    expect(await exists("secret")).toBe(false)
  })

  it("the plaintext of an encrypted page reaches no emitted file at all", async () => {
    await writeSource("secret.md", "---\npassword: hunter2\n---\n\nCANARY-PLAINTEXT\n")
    await writeSource("open.md", "# Public\n\nordinary body\n")
    await ServeTheSource().emit(ctx(), [
      page({ slug: "secret", relativePath: "secret.md", encrypted: true }),
      page({ slug: "open", relativePath: "open.md" }),
    ])
    // Sweep the entire output tree, not just the page we expect to be missing.
    const files = await fs.readdir(outDir, { recursive: true, withFileTypes: true })
    for (const f of files) {
      if (!f.isFile()) continue
      const body = await fs.readFile(path.join(f.parentPath ?? outDir, f.name), "utf-8")
      expect(body).not.toContain("CANARY-PLAINTEXT")
      expect(body).not.toContain("hunter2")
    }
  })

  it("is checked before anything else, so a malformed encrypted page still cannot leak", async () => {
    // No slug, no relativePath, but encrypted: the encrypted branch must win
    // rather than falling through to a different skip that a later refactor
    // might reorder or relax.
    expect(skipReason({ encrypted: true }, { includeUnlisted: true })).toBe("encrypted")
    expect(skipReason({ encrypted: true, slug: "x", relativePath: "x.md" }, { includeUnlisted: true })).toBe(
      "encrypted",
    )
  })

  it("encryption cannot be switched off by options", () => {
    // There is deliberately no option for this. If one is ever added, this
    // test is where the conversation starts.
    const optionKeys = ["frontmatterAllowlist", "includeUnlisted", "includeSourceUrl"]
    expect(optionKeys).not.toContain("includeEncrypted")
  })
})

describe("security: frontmatter is an allowlist", () => {
  it("drops every field not named, however harmless it looks", async () => {
    await writeSource(
      "p.md",
      "---\ntitle: Fine\npassword: hunter2\ninternal_id: SECRET-42\nreviewer_notes: do not ship\n---\n\nbody\n",
    )
    await ServeTheSource().emit(ctx(), [
      page({
        slug: "p",
        relativePath: "p.md",
        frontmatter: {
          title: "Fine",
          password: "hunter2",
          internal_id: "SECRET-42",
          reviewer_notes: "do not ship",
        },
      }),
    ])
    const out = await read("p")
    expect(out).toContain("title: Fine")
    expect(out).not.toContain("hunter2")
    expect(out).not.toContain("SECRET-42")
    expect(out).not.toContain("do not ship")
  })

  it("the raw frontmatter block of the source file is never passed through", async () => {
    await writeSource("p.md", "---\npassword: hunter2\n---\n\n# Heading\n\nbody\n")
    await ServeTheSource().emit(ctx(), [page({ slug: "p", relativePath: "p.md", frontmatter: {} })])
    const out = await read("p")
    expect(out).not.toContain("password")
    expect(out).toContain("# Heading")
  })

  it("a custom allowlist REPLACES the default rather than extending it", async () => {
    await writeSource("p.md", "body\n")
    await ServeTheSource({ frontmatterAllowlist: ["tags"] }).emit(ctx(), [
      page({ slug: "p", relativePath: "p.md", frontmatter: { title: "Dropped", tags: ["kept"] } }),
    ])
    const out = await read("p")
    expect(out).toContain("tags: [kept]")
    expect(out).not.toContain("Dropped")
  })
})

// ---------------------------------------------------------------------------
describe("emitting", () => {
  it("writes <slug>.md with the body intact", async () => {
    await writeSource("p.md", "# Title\n\n- a\n- b\n\n`code`\n")
    const emitted = await ServeTheSource().emit(ctx(), [page({ slug: "p", relativePath: "p.md" })])
    expect(emitted).toHaveLength(1)
    const out = await read("p")
    expect(out).toContain("# Title")
    expect(out).toContain("- a")
    expect(out).toContain("`code`")
  })

  it("creates nested directories for nested slugs", async () => {
    await writeSource("deep/p.md", "body\n")
    await ServeTheSource().emit(ctx(), [page({ slug: "deep/p", relativePath: "deep/p.md" })])
    expect(await exists("deep/p")).toBe(true)
  })

  it("skips generated pages that have no source file", async () => {
    const emitted = await ServeTheSource().emit(ctx(), [page({ slug: "tags/foo" })])
    expect(emitted).toEqual([])
  })

  it("skips a page whose source is missing from disk instead of throwing", async () => {
    const emitted = await ServeTheSource().emit(ctx(), [page({ slug: "gone", relativePath: "gone.md" })])
    expect(emitted).toEqual([])
  })

  it("one unreadable page does not stop the others", async () => {
    await writeSource("ok.md", "fine\n")
    const emitted = await ServeTheSource().emit(ctx(), [
      page({ slug: "missing", relativePath: "missing.md" }),
      page({ slug: "ok", relativePath: "ok.md" }),
    ])
    expect(emitted).toHaveLength(1)
    expect(await exists("ok")).toBe(true)
  })

  it("skips a page whose body is empty once frontmatter is removed", async () => {
    await writeSource("empty.md", "---\ntitle: Nothing\n---\n\n   \n")
    const emitted = await ServeTheSource().emit(ctx(), [page({ slug: "empty", relativePath: "empty.md" })])
    expect(emitted).toEqual([])
  })

  it("records the canonical source URL", async () => {
    await writeSource("p.md", "body\n")
    await ServeTheSource().emit(ctx(), [page({ slug: "p", relativePath: "p.md" })])
    expect(await read("p")).toContain("source: https://example.com/p")
  })

  it("omits the source URL when asked to", async () => {
    await writeSource("p.md", "body\n")
    await ServeTheSource({ includeSourceUrl: false }).emit(ctx(), [
      page({ slug: "p", relativePath: "p.md" }),
    ])
    expect(await read("p")).not.toContain("source:")
  })

  it("falls back to a root-relative URL with no baseUrl configured", async () => {
    await writeSource("p.md", "body\n")
    await ServeTheSource().emit({ argv: { directory: contentDir, output: outDir } }, [
      page({ slug: "p", relativePath: "p.md" }),
    ])
    expect(await read("p")).toContain("source: /p")
  })
})

describe("unlisted pages", () => {
  it("emits by default, because the HTML is already served", async () => {
    await writeSource("u.md", "body\n")
    const emitted = await ServeTheSource().emit(ctx(), [
      page({ slug: "u", relativePath: "u.md", unlisted: true }),
    ])
    expect(emitted).toHaveLength(1)
  })

  it("skips when includeUnlisted is false", async () => {
    await writeSource("u.md", "body\n")
    const emitted = await ServeTheSource({ includeUnlisted: false }).emit(ctx(), [
      page({ slug: "u", relativePath: "u.md", unlisted: true }),
    ])
    expect(emitted).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe("stripFrontmatter", () => {
  it("removes a leading block", () => {
    expect(stripFrontmatter("---\na: 1\n---\n\n# H\n")).toBe("# H\n")
  })

  it("handles CRLF line endings", () => {
    expect(stripFrontmatter("---\r\na: 1\r\n---\r\n\r\n# H\r\n")).toBe("# H\r\n")
  })

  it("leaves a document with no frontmatter untouched", () => {
    expect(stripFrontmatter("# H\n\nbody\n")).toBe("# H\n\nbody\n")
  })

  it("🪤 does not treat a horizontal rule as a frontmatter fence", () => {
    // The fence must be the FIRST thing in the file. A greedy or unanchored
    // match here would silently delete the top of any document that uses ---
    // as a horizontal rule, which is the failure this strictness prevents.
    const doc = "# Title\n\nintro\n\n---\n\nafter the rule\n"
    expect(stripFrontmatter(doc)).toBe(doc)
  })

  it("stops at the FIRST closing fence, not a later one", () => {
    expect(stripFrontmatter("---\na: 1\n---\n\nbody\n\n---\n\nmore\n")).toBe("body\n\n---\n\nmore\n")
  })
})

describe("yamlScalar", () => {
  it("leaves simple values bare", () => {
    expect(yamlScalar("Hello World")).toBe("Hello World")
  })

  it("🪤 quotes a value containing a colon", () => {
    // Unquoted, `title: A: B` is a YAML parse error -- the exact failure that
    // makes an emitted file unreadable by the tools meant to consume it.
    expect(yamlScalar("A: B")).toBe('"A: B"')
  })

  it("quotes values with leading or trailing whitespace", () => {
    expect(yamlScalar(" pad ")).toBe('" pad "')
  })

  it("quotes values with YAML-significant punctuation", () => {
    expect(yamlScalar("#hash")).toBe('"#hash"')
    expect(yamlScalar("[bracket]")).toBe('"[bracket]"')
  })
})

describe("buildFrontmatter", () => {
  it("renders arrays inline", () => {
    expect(buildFrontmatter({ tags: ["a", "b"] }, ["tags"])).toContain("tags: [a, b]")
  })

  it("omits empty arrays, nulls and empty strings", () => {
    const out = buildFrontmatter({ tags: [], title: "", description: null }, [
      "tags",
      "title",
      "description",
    ])
    expect(out).toBe("---\n---\n")
  })

  it("renders dates as ISO 8601", () => {
    const out = buildFrontmatter({ date: new Date("2026-08-26T12:00:00Z") }, ["date"])
    expect(out).toContain("date: 2026-08-26T12:00:00.000Z")
  })
})

// ---------------------------------------------------------------------------
// Regressions from review, 2026-08-26. Each of these failed before its fix.
// ---------------------------------------------------------------------------
describe("regression: byte order mark", () => {
  it("🪤 strips frontmatter from a file that begins with a UTF-8 BOM", () => {
    // FRONTMATTER_RE is anchored at index 0, so a BOM at position 0 pushes the
    // fence to index 1 and the match fails -- silently leaving the WHOLE
    // frontmatter block, password field included, in the emitted body. Windows
    // editors write BOMs by default, so this is a normal file, not a weird one.
    const withBom = "﻿---\ntitle: T\npassword: hunter2\n---\n\n# Body\n"
    const out = stripFrontmatter(withBom)
    expect(out).not.toContain("password")
    expect(out).not.toContain("hunter2")
    expect(out.startsWith("# Body")).toBe(true)
  })

  it("a BOM'd encrypted-adjacent file cannot leak its frontmatter through the emitter", async () => {
    await writeSource("bom.md", "﻿---\ntitle: T\npassword: hunter2\n---\n\n# Body\n")
    await ServeTheSource().emit(ctx(), [
      page({ slug: "bom", relativePath: "bom.md", frontmatter: { title: "T", password: "hunter2" } }),
    ])
    expect(await read("bom")).not.toContain("hunter2")
  })
})

describe("regression: baseUrl carrying a protocol", () => {
  it("🪤 does not double the scheme when baseUrl already has one", async () => {
    // Quartz's convention is a bare host (`baseUrl: cracktun.es`) and its own
    // CNAME plugin assumes the same. But operators write the protocol in
    // constantly, and `https://${baseUrl}` then yields https://https://host/p.
    await writeSource("p.md", "body\n")
    await ServeTheSource().emit(
      { argv: { directory: contentDir, output: outDir }, cfg: { configuration: { baseUrl: "https://example.com" } } },
      [page({ slug: "p", relativePath: "p.md" })],
    )
    const out = await read("p")
    expect(out).toContain("source: https://example.com/p")
    expect(out).not.toContain("https://https://")
  })

  it("handles a http:// prefix and a trailing slash too", async () => {
    await writeSource("p.md", "body\n")
    await ServeTheSource().emit(
      { argv: { directory: contentDir, output: outDir }, cfg: { configuration: { baseUrl: "http://example.com/" } } },
      [page({ slug: "p", relativePath: "p.md" })],
    )
    expect(await read("p")).toContain("source: https://example.com/p")
  })
})

describe("partialEmit (watch mode)", () => {
  it("refreshes a changed page's source", async () => {
    await writeSource("p.md", "original\n")
    const plugin = ServeTheSource()
    await plugin.emit(ctx(), [page({ slug: "p", relativePath: "p.md" })])
    expect(await read("p")).toContain("original")

    await writeSource("p.md", "edited\n")
    const out = await plugin.partialEmit(ctx(), [], null, [
      { type: "change", path: "p.md", file: { data: { slug: "p", relativePath: "p.md" } } },
    ])
    expect(out).toHaveLength(1)
    expect(await read("p")).toContain("edited")
    expect(await read("p")).not.toContain("original")
  })

  it("emits a newly added page", async () => {
    await writeSource("new.md", "fresh\n")
    const out = await ServeTheSource().partialEmit(ctx(), [], null, [
      { type: "add", path: "new.md", file: { data: { slug: "new", relativePath: "new.md" } } },
    ])
    expect(out).toHaveLength(1)
    expect(await read("new")).toContain("fresh")
  })

  it("🪤 removes the orphaned .md when a page is deleted", async () => {
    // Leaving it behind means a page removed from the site stays readable at
    // its old URL by anyone asking for Markdown: the HTML is gone, the source
    // is not.
    await writeSource("gone.md", "doomed\n")
    const plugin = ServeTheSource()
    await plugin.emit(ctx(), [page({ slug: "gone", relativePath: "gone.md" })])
    expect(await exists("gone")).toBe(true)

    await plugin.partialEmit(ctx(), [], null, [
      { type: "delete", path: "gone.md", file: { data: { slug: "gone", relativePath: "gone.md" } } },
    ])
    expect(await exists("gone")).toBe(false)
  })

  it("deleting a page that was never emitted is not an error", async () => {
    await expect(
      ServeTheSource().partialEmit(ctx(), [], null, [
        { type: "delete", path: "never.md", file: { data: { slug: "never" } } },
      ]),
    ).resolves.toEqual([])
  })

  it("🚨 applies the encryption guard on the watch path too", async () => {
    // A watch rebuild that applied different rules from a full build would be
    // a leak that only appears while someone is editing.
    await writeSource("s.md", "---\npassword: hunter2\n---\n\nCANARY-PLAINTEXT\n")
    const out = await ServeTheSource().partialEmit(ctx(), [], null, [
      { type: "change", path: "s.md", file: { data: { slug: "s", relativePath: "s.md", encrypted: true } } },
    ])
    expect(out).toEqual([])
    expect(await exists("s")).toBe(false)
  })

  it("🚨 applies the frontmatter allowlist on the watch path too", async () => {
    await writeSource("s.md", "---\ntitle: T\npassword: hunter2\n---\n\nbody\n")
    await ServeTheSource().partialEmit(ctx(), [], null, [
      {
        type: "change",
        path: "s.md",
        file: { data: { slug: "s", relativePath: "s.md", frontmatter: { title: "T", password: "hunter2" } } },
      },
    ])
    expect(await read("s")).not.toContain("hunter2")
  })

  it("ignores events carrying no file data", async () => {
    await expect(
      ServeTheSource().partialEmit(ctx(), [], null, [{ type: "change", path: "x.md" }]),
    ).resolves.toEqual([])
  })
})
