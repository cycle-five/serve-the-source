#!/usr/bin/env node
/**
 * Executable entry point. Nothing but a call into the CLI.
 *
 * 🚨 THIS FILE EXISTS BECAUSE THE OBVIOUS ALTERNATIVE IS SILENTLY BROKEN.
 *    Guarding a self-executing module with
 *
 *        if (import.meta.url === `file://${process.argv[1]}`) main()
 *
 *    fails whenever the CLI is invoked through npm's bin symlink -- which is
 *    every real installation. `import.meta.url` resolves the symlink to the
 *    package's real path while `process.argv[1]` is the link in
 *    node_modules/.bin, so the comparison is false, main() never runs, and the
 *    process exits 0 having done nothing at all. No error, no output, no
 *    files. Caught by wiring the module into cyclefive.xyz, not by any test.
 *
 *    A separate bin entry has no condition to get wrong. cli.ts stays a plain
 *    importable module, which is what makes it testable.
 */
import { main } from "./cli.js"

main(process.argv.slice(2)).then((code) => process.exit(code))
