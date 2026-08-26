import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { parseFrontmatter, extractKeys } from "../src/frontmatter.js"
import { parseArgs, outputPathFor, urlPathFor, run } from "../src/cli.js"

let dir: string, contentDir: string, outDir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "sts-cli-"))
  contentDir = path.join(dir, "content")
  outDir = path.join(dir, "public")
  await fs.mkdir(contentDir, { recursive: true })
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function write(rel: string, body: string): Promise<void> {
  const p = path.join(contentDir, rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, body, "utf-8")
}
async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(outDir, rel), "utf-8")
}
async function exists(rel: string): Promise<boolean> {
  try {
    await fs.access(path.join(outDir, rel))
    return true
  } catch {
    return false
  }
}
const opts = (over: Partial<Parameters<typeof run>[0]> = {}) => ({
  contentDir,
  outDir,
  layout: "directory" as const,
  allowlist: ["title", "description", "date", "tags"],
  dryRun: false,
  ...over,
})

// ---------------------------------------------------------------------------
describe("frontmatter: two fence styles", () => {
  it("parses YAML fences", () => {
    const r = parseFrontmatter("---\ntitle: T\n---\n\nbody\n")
    expect(r.format).toBe("yaml")
    expect(r.body).toBe("body\n")
  })

  it("🪤 parses TOML fences, which Zola and Hugo use", () => {
    // A tool that only knew --- would leave this entire block in the body.
    const r = parseFrontmatter('+++\ntitle = "T"\nsecret = "leak"\n+++\n\nbody\n')
    expect(r.format).toBe("toml")
    expect(r.body).toBe("body\n")
    expect(r.body).not.toContain("secret")
  })

  it("handles a BOM before either fence", () => {
    expect(parseFrontmatter("﻿---\npassword: x\n---\n\nbody\n").body).toBe("body\n")
    expect(parseFrontmatter('﻿+++\npassword = "x"\n+++\n\nbody\n').body).toBe("body\n")
  })

  it("leaves a document with no frontmatter alone", () => {
    const r = parseFrontmatter("# H\n\nbody\n")
    expect(r.format).toBe("none")
    expect(r.body).toBe("# H\n\nbody\n")
  })

  it("🪤 does not mistake a horizontal rule for a fence", () => {
    const doc = "# T\n\nintro\n\n---\n\nafter\n"
    expect(parseFrontmatter(doc).body).toBe(doc)
  })
})

describe("extractKeys: safe by construction", () => {
  it("🚨 never reads a key it was not asked for", () => {
    const raw = 'title = "Fine"\npassword = "hunter2"\napi_key = "sk-live-42"'
    const got = extractKeys(raw, ["title"])
    expect(got).toEqual({ title: "Fine" })
    expect(JSON.stringify(got)).not.toContain("hunter2")
    expect(JSON.stringify(got)).not.toContain("sk-live-42")
  })

  it("reads both TOML = and YAML : separators", () => {
    expect(extractKeys('title = "A"', ["title"])).toEqual({ title: "A" })
    expect(extractKeys("title: A", ["title"])).toEqual({ title: "A" })
  })

  it("🪤 stops at a TOML table header", () => {
    // Keys under [extra] belong to that table. Treating them as root keys
    // would attribute a nested value to the page itself.
    const raw = 'title = "Root"\n[extra]\ntitle = "Nested"\nlead = "x"'
    expect(extractKeys(raw, ["title", "lead"])).toEqual({ title: "Root" })
  })

  it("strips one layer of quotes and ignores comments", () => {
    expect(extractKeys('# a comment\ntitle = "Quoted"', ["title"])).toEqual({ title: "Quoted" })
    expect(extractKeys("title: 'single'", ["title"])).toEqual({ title: "single" })
  })
})

// ---------------------------------------------------------------------------
describe("path mapping", () => {
  it("🪤 directory layout matches how Zola renders pages", () => {
    // content/about.md -> public/about/index.html, so the source belongs at
    // public/about/index.md. Getting this wrong puts every file where nothing
    // will look for it.
    expect(outputPathFor("about.md", "directory")).toBe(path.join("about", "index.md"))
    expect(outputPathFor("blog/post.md", "directory")).toBe(path.join("blog", "post", "index.md"))
  })

  it("flat layout mirrors alongside", () => {
    expect(outputPathFor("about.md", "flat")).toBe("about.md")
    expect(outputPathFor("blog/post.md", "flat")).toBe(path.join("blog", "post.md"))
  })

  it("section indexes map to their directory in both layouts", () => {
    expect(outputPathFor("blog/_index.md", "directory")).toBe(path.join("blog", "index.md"))
    expect(outputPathFor("_index.md", "flat")).toBe("index.md")
  })

  it("derives canonical URL paths", () => {
    expect(urlPathFor("about.md")).toBe("/about")
    expect(urlPathFor("blog/post.md")).toBe("/blog/post")
    expect(urlPathFor("_index.md")).toBe("/")
    expect(urlPathFor("blog/_index.md")).toBe("/blog")
  })
})

describe("argument parsing", () => {
  it("defaults to the Zola-shaped layout", () => {
    const o = parseArgs([])
    expect("error" in o).toBe(false)
    if (!("error" in o)) expect(o.layout).toBe("directory")
  })

  it("rejects an unknown layout rather than guessing", () => {
    expect(parseArgs(["--layout", "sideways"])).toHaveProperty("error")
  })

  it("rejects unknown arguments", () => {
    expect(parseArgs(["--wat"])).toHaveProperty("error")
  })

  it("rejects a flag with no value", () => {
    expect(parseArgs(["--content"])).toHaveProperty("error")
  })
})

// ---------------------------------------------------------------------------
describe("run", () => {
  it("mirrors a Zola-shaped site", async () => {
    await write("about.md", '+++\ntitle = "About"\n+++\n\n# About us\n')
    await write("blog/post.md", '+++\ntitle = "Post"\n+++\n\n# A post\n')
    const res = await run(opts({ baseUrl: "example.com" }))
    expect(res.written).toBe(2)
    expect(await read(path.join("about", "index.md"))).toContain("# About us")
    expect(await read(path.join("blog", "post", "index.md"))).toContain("# A post")
  })

  it("records a normalised canonical source URL", async () => {
    await write("about.md", '+++\ntitle = "About"\n+++\n\nbody\n')
    await run(opts({ baseUrl: "https://example.com/" }))
    const out = await read(path.join("about", "index.md"))
    expect(out).toContain("source: https://example.com/about")
    expect(out).not.toContain("https://https://")
  })

  it("🚨 skips drafts — an unpublished page must not have a published source", async () => {
    await write("draft.md", '+++\ntitle = "WIP"\ndraft = true\n+++\n\nSECRET-DRAFT-BODY\n')
    await write("live.md", '+++\ntitle = "Live"\n+++\n\npublished\n')
    const res = await run(opts())
    expect(res.written).toBe(1)
    expect(res.skipped).toBe(1)
    expect(await exists(path.join("draft", "index.md"))).toBe(false)
  })

  it("skips YAML-style drafts too", async () => {
    await write("d.md", "---\ndraft: true\n---\n\nbody\n")
    expect((await run(opts())).written).toBe(0)
  })

  it("🚨 carries over only allowlisted frontmatter", async () => {
    await write("p.md", '+++\ntitle = "Fine"\npassword = "hunter2"\n+++\n\nbody\n')
    await run(opts())
    const out = await read(path.join("p", "index.md"))
    expect(out).toContain("title: Fine")
    expect(out).not.toContain("hunter2")
  })

  it("skips empty documents", async () => {
    await write("e.md", "+++\ntitle = \"E\"\n+++\n\n   \n")
    expect((await run(opts())).written).toBe(0)
  })

  it("writes nothing on --dry-run", async () => {
    await write("p.md", "+++\ntitle = \"P\"\n+++\n\nbody\n")
    const res = await run(opts({ dryRun: true }))
    expect(res.written).toBe(1)
    expect(await exists(path.join("p", "index.md"))).toBe(false)
  })

  it("ignores dotfile directories", async () => {
    await write(".obsidian/config.md", "junk\n")
    await write("real.md", "+++\ntitle = \"R\"\n+++\n\nbody\n")
    expect((await run(opts())).written).toBe(1)
  })

  it("a missing content directory is not a crash", async () => {
    const res = await run(opts({ contentDir: path.join(dir, "nope") }))
    expect(res).toEqual({ written: 0, skipped: 0 })
  })
})
