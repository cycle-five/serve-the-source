/**
 * Compile-time proof that this module satisfies Quartz's real plugin contract
 * — without shipping a dependency on it.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `src/index.ts` declares its own structural interfaces so that installing this
 * module pulls in nothing at all. That freedom has an obvious failure mode: the
 * interfaces are hand-written, so they can drift from the real ones and nobody
 * would notice until a build somewhere broke.
 *
 * So the real types are a devDependency, imported HERE and nowhere else. This
 * file is type-checked in CI and never bundled, never published, never
 * imported by `src/`. If Quartz changes `QuartzEmitterPlugin`, `tsc` fails
 * here — loudly, at build time, in this repo — rather than silently in
 * somebody's site build.
 *
 * There is no runtime assertion to make: `QuartzEmitterPlugin` is a type, so
 * this whole file compiles to nothing.
 */
import type { QuartzEmitterPlugin } from "@quartz-community/types"
import { ServeTheSource, type ServeTheSourceOptions } from "../src/index.js"

/**
 * The assignment IS the assertion. If ServeTheSource stops being a valid
 * QuartzEmitterPlugin — wrong shape, wrong argument types, a renamed hook —
 * this line stops compiling.
 */
const _conformsToQuartz: QuartzEmitterPlugin<Partial<ServeTheSourceOptions>> = ServeTheSource

/**
 * And the instance satisfies the instance contract: `name` plus the emit
 * hooks Quartz calls. Checked separately because a factory can have the right
 * signature while returning the wrong object.
 */
const _instance = _conformsToQuartz({})
const _name: string = _instance.name

// Referenced so `noUnusedLocals` cannot object to the assertions above.
export type __Conformance = [typeof _conformsToQuartz, typeof _instance, typeof _name]
