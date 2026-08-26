# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-08-26

First release. Extracted from [cracktun.es](https://cracktun.es), where it has
been serving Markdown to agents in production since 2026-08-25.

### Added

- Quartz emitter writing `<slug>.md` beside every `<slug>.html`, with zero
  runtime dependencies.
- CLI (`npx serve-the-source`) for generators without a plugin API — Zola,
  Hugo, and hand-rolled static sites. Supports `directory` and `flat` output
  layouts.
- YAML (`---`) and TOML (`+++`) frontmatter fences.
- `partialEmit` for watch mode, including removal of orphaned `.md` files when
  a page is deleted.
- Options: `frontmatterAllowlist`, `includeUnlisted`, `includeSourceUrl`.
- Compile-time conformance against `@quartz-community/types`, which is a
  dev-dependency only and never shipped.

### Security

- **Encrypted pages are never emitted.** An encrypted page's source is its
  plaintext; publishing the Markdown beside its ciphertext would defeat the
  encryption entirely. Checked first, and not configurable.
- **Frontmatter passes through an allowlist, never a denylist.** Passwords,
  private URLs, internal IDs and review notes all live in frontmatter. A key
  nobody has thought of yet defaults to unpublished.
- **Drafts are skipped by the CLI.** A page that is not published must not have
  its source published either.
- **BOM-safe frontmatter stripping.** A UTF-8 BOM pushes the opening fence off
  index 0, so an anchored match silently fails and leaves the *entire*
  frontmatter block — password field included — in the emitted body. Windows
  editors write BOMs by default.

### Notes

- `dist/` is committed deliberately. Quartz installs plugins from a git ref and
  prefers a pre-built `dist/`; relying on the consumer having dev dependencies
  at build time is how this first failed on Cloudflare Pages, where
  `NODE_ENV=production` makes `npm ci` skip them and the plugin is skipped with
  a *warning, not an error*.
- Emission is sequential by measurement, not by oversight: 10,000 pages in
  1,008 ms, which is 4.2 ms on a real 38-page site — 0.07% of that build.

[Unreleased]: https://github.com/cycle-five/serve-the-source/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/cycle-five/serve-the-source/releases/tag/v0.1.0
