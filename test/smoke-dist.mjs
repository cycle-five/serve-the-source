/**
 * Smoke test the SHIPPED artifact.
 *
 * 🪤 THE UNIT TESTS IMPORT src/, BUT THE TARBALL SHIPS dist/. They are
 *    different files, so a green suite proves nothing about what users get:
 *    a bundler misconfiguration, a bad `exports` map or a missing `bin` shim
 *    all pass the unit tests and break on install. This exercises dist/ the
 *    way a consumer would, and runs in CI after the build.
 */
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"

const { ServeTheSource, stripFrontmatter, normaliseBaseUrl } = await import("../dist/index.js")
const { outputPathFor, run } = await import("../dist/cli.js")

// 1. The emitter entry point exists and is a factory.
assert.equal(typeof ServeTheSource, "function", "ServeTheSource must be exported from dist")
const plugin = ServeTheSource()
assert.equal(plugin.name, "ServeTheSource")
assert.equal(typeof plugin.emit, "function")
assert.equal(typeof plugin.partialEmit, "function", "partialEmit must survive bundling")

// 2. The security-critical behaviour is present in the BUILT file, not just src.
assert.ok(!stripFrontmatter("﻿---\npassword: hunter2\n---\n\nbody\n").includes("hunter2"),
  "BOM fix missing from dist")
assert.ok(!stripFrontmatter('+++\npassword = "hunter2"\n+++\n\nbody\n').includes("hunter2"),
  "TOML fence handling missing from dist")
assert.equal(normaliseBaseUrl("https://example.com/"), "example.com")

// 3. The emitter refuses an encrypted page.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sts-smoke-"))
const contentDir = path.join(dir, "content"), outDir = path.join(dir, "public")
await fs.mkdir(contentDir, { recursive: true })
await fs.writeFile(path.join(contentDir, "s.md"), "---\npassword: hunter2\n---\n\nCANARY\n")
const emitted = await plugin.emit(
  { argv: { directory: contentDir, output: outDir }, cfg: { configuration: { baseUrl: "e.com" } } },
  [[null, { data: { slug: "s", relativePath: "s.md", encrypted: true } }]],
)
assert.deepEqual(emitted, [], "dist emitter leaked an encrypted page")

// 4. The CLI entry point works and maps paths correctly.
assert.equal(outputPathFor("about.md", "directory"), path.join("about", "index.md"))
await fs.writeFile(path.join(contentDir, "a.md"), '+++\ntitle = "A"\n+++\n\nbody\n')
const res = await run({
  contentDir, outDir, layout: "directory",
  allowlist: ["title"], dryRun: false, baseUrl: "e.com",
})
assert.ok(res.written >= 1, "dist CLI wrote nothing")
const written = await fs.readFile(path.join(outDir, "a", "index.md"), "utf-8")
assert.ok(written.includes("title: A") && written.includes("body"))
assert.ok(!written.includes("hunter2"))

// 5. 🚨 EXECUTE the bin THROUGH A SYMLINK, the way npm installs it.
//    This is not paranoia: the first version guarded self-execution with
//    `import.meta.url === file://${process.argv[1]}`, which is FALSE through
//    npm's bin symlink -- import.meta.url resolves the link, argv[1] does not.
//    The CLI exited 0 having written nothing. No error, no output, no files.
//    Importing run() directly, as the tests above do, cannot catch that.
{
  const { execFileSync, } = await import("node:child_process")
  const binDir = path.join(dir, "bin")
  await fs.mkdir(binDir, { recursive: true })
  const link = path.join(binDir, "serve-the-source")
  await fs.symlink(new URL("../dist/bin.js", import.meta.url).pathname, link)

  const c2 = path.join(dir, "c2"), o2 = path.join(dir, "o2")
  await fs.mkdir(c2, { recursive: true })
  await fs.writeFile(path.join(c2, "page.md"), '+++\ntitle = "P"\n+++\n\nreal body\n')

  const out = execFileSync(process.execPath, [link, "--content", c2, "--out", o2, "--base", "e.com"], {
    encoding: "utf-8",
  })
  assert.match(out, /mirrored into/, "bin produced no output when run through a symlink")
  const got = await fs.readFile(path.join(o2, "page", "index.md"), "utf-8")
  assert.ok(got.includes("real body"), "bin wrote no content through a symlink")
}

// 6. The bin shim declared in package.json actually exists.
const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf-8"))
for (const [name, rel] of Object.entries(pkg.bin ?? {})) {
  await fs.access(new URL(`../${rel}`, import.meta.url))
    .catch(() => { throw new Error(`bin "${name}" points at ${rel}, which does not exist in dist`) })
}

await fs.rm(dir, { recursive: true, force: true })
console.log("  smoke: dist/ exports, guards, CLI and bin shim all verified")
