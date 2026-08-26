# serve-the-source

Emit the Markdown source beside every rendered page, and serve it to agents
that ask for it.

A static site generator turns Markdown into HTML. An agent then asks for the
HTML and receives roughly twenty times more bytes than the document holds,
nearly all of it presentation it will discard. The source it actually wanted
was on disk the whole time.

**Zero runtime dependencies.**

## The measurement

From the site this was written for — [cracktun.es](https://cracktun.es), Quartz v5:

| page | HTML | Markdown | |
|---|---|---|---|
| `avatars` | 20,615 | 1,009 | **20.4×** |
| `index` | 23,379 | 1,141 | **20.4×** |
| whole build | 1.40 MB | 184 KB | **7.6×** |

Of `avatars.html`, `<head>` alone is 5,193 bytes — a quarter of the page before
any content. The rest is component stylesheet links, OG meta, font preloads and
client-side scaffolding.

What a reader of any kind actually needs — headings, lists, links, emphasis,
code — survives Markdown intact. What is dropped is presentation. This is not a
lossy shortcut: **the Markdown is the document and the HTML is the derived
artifact.**

## Install

```shell
npm install serve-the-source
```

Quartz, in `quartz.config.yaml`:

```yaml
plugins:
  - source: serve-the-source
    enabled: true
    options: {}
```

Or from a local checkout, `- source: ./plugins/serve-the-source`.

## Serving it

The emitter writes the files; serving them is one line of edge config. On
Cloudflare Pages, `functions/_middleware.js`:

```js
export async function onRequest({ request, next, env }) {
  const url = new URL(request.url)
  const wantsMd = /(^|,)\s*text\/(x-)?markdown\b/.test(request.headers.get("Accept") ?? "")
  const isPage = !/\.[a-z0-9]+$/i.test(url.pathname)

  if (isPage && wantsMd) {
    const md = new URL(url)
    md.pathname = `${url.pathname.replace(/\/+$/, "") || "/index"}.md`
    const hit = await env.ASSETS.fetch(new Request(md, request))
    if (hit.ok) {
      const out = new Response(hit.body, hit)
      out.headers.set("Content-Type", "text/markdown; charset=utf-8")
      out.headers.append("Vary", "Accept")
      return out
    }
  }
  const res = await next()
  const out = new Response(res.body, res)
  out.headers.append("Vary", "Accept")
  return out
}
```

Two things that are easy to get wrong there:

🪤 **`Vary: Accept` on *both* branches.** Two different bodies are served from
one URL. Without it the first cached response is handed to everyone — one
agent's Markdown served to browsers, or a browser's HTML to every agent.

🪤 **Never match `*/*`.** Browsers send `Accept` headers ending in `*/*`, so a
substring or wildcard-tolerant test hands Markdown to every browser. Only an
explicit `text/markdown` counts.

## Options

| option | default | |
|---|---|---|
| `frontmatterAllowlist` | `["title", "tags", "date", "description", "aliases"]` | Frontmatter keys copied onto emitted files. **Replaces** the default; does not extend it. |
| `includeUnlisted` | `true` | Emit sources for `unlisted` pages. Their HTML is already served, so this exposes nothing new — set `false` if unlisted means "not trivially harvestable" in your setup. |
| `includeSourceUrl` | `true` | Add a `source:` field with the page's canonical URL. |

`baseUrl` is normalised, so `example.com`, `https://example.com` and
`https://example.com/` all produce the same result. Quartz's convention is a
bare host, but the scheme gets written in often enough that
`https://${baseUrl}` would otherwise yield `https://https://host/slug`.

## Watch mode

`partialEmit` refreshes only what changed, and **removes the `.md` when a page
is deleted** — an orphan there means a page removed from the site stays
readable at its old URL by anyone asking for Markdown, since the HTML is gone
but the source is not.

Both emit paths share one write function, so the security guards apply
identically in watch mode. A rebuild that relaxed the encryption check would be
a leak that only appears while someone is editing.

## 🚨 Two ways a naive version of this leaks

This is the part worth reading, and the reason the module exists rather than
being a `cp` in a build script.

**1. An encrypted page's source is its plaintext.** Encryption plugins ship
ciphertext in the HTML and decrypt client-side behind a password. Emitting that
page's Markdown publishes the plaintext right beside it and defeats the
mechanism completely.

Pages with `data.encrypted === true` are skipped, that check runs first, and
there is deliberately **no option to disable it**.

**2. The password is in the frontmatter.** Quartz's `encrypted-pages` reads it
from a `password` field. Copying a source file verbatim publishes it.

So frontmatter is never passed through. A small **allowlist** is rebuilt from
known-safe fields — an allowlist, not a denylist, because a frontmatter key
nobody has thought of yet must default to unpublished. Private URLs, internal
IDs and review notes all live in frontmatter too.

Both are covered by tests that sweep the entire output tree for a canary
string, not just the file expected to be absent.

🪤 **Ordering against the encryption plugin does not matter**, which is worth
knowing rather than guessing at. It may well run *after* this emitter — it is
order 900 on cracktun.es against 246 here — and the guard still holds, because
`data.encrypted` is set by that plugin's **transformer** during the parse
phase, which completes before any emitter runs at all.

## Compatibility

The exported interfaces are structural, so installing this pulls in nothing.
Compatibility with the real `QuartzEmitterPlugin` is proven at build time by
`test/conformance.ts`, which imports `@quartz-community/types` as a
dev-dependency and is never shipped.

That file earned itself on its first run. Quartz types a path as
`string & { _brand: "FilePath" }`, so returning a plain `string[]` — which runs
perfectly, because brands are erased at runtime — is **not** assignable to its
emitter contract, and a strict consumer would get a type error. The brands are
now declared locally to match.

## Performance

Emission is sequential, deliberately. Measured on this machine:

| pages | time | per page |
|---|---|---|
| 2,000 | 227 ms | 0.11 ms |
| 10,000 | 1,008 ms | 0.10 ms |

Linear, and on a real 38-page site that is **4.2 ms — 0.07% of a 6-second
build**. A concurrency pool would buy under a second on a site nobody has,
while adding a file-descriptor exhaustion mode nobody would hit in testing.
If someone turns up with a genuinely enormous site, the measurement above is
the thing to redo before changing this.

## Development

```shell
npm run typecheck   # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
npm test            # 30 cases; the security guards are the first two blocks
npm run build       # dist/index.js + dist/index.d.ts
npm run check       # all three
```

`dist/` is committed on purpose. Quartz installs plugins straight from a git
ref and its loader prefers a pre-built `dist/`. A repo without one relies on
the consumer having dev dependencies at build time — which is exactly how this
first failed on Cloudflare Pages, where `NODE_ENV=production` makes `npm ci`
skip them and the plugin is skipped with a **warning, not an error**. Green
build, missing feature.

## License

MIT
