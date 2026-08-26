#!/usr/bin/env node
export interface CliOptions {
    contentDir: string;
    outDir: string;
    baseUrl?: string;
    layout: "directory" | "flat";
    allowlist: readonly string[];
    dryRun: boolean;
}
export declare function parseArgs(argv: readonly string[]): CliOptions | {
    error: string;
};
/** Map a content-relative Markdown path to its output path. */
export declare function outputPathFor(rel: string, layout: "directory" | "flat"): string;
/** The canonical URL path a content file corresponds to. */
export declare function urlPathFor(rel: string): string;
export declare function run(o: CliOptions): Promise<{
    written: number;
    skipped: number;
}>;
export declare function main(argv: readonly string[]): Promise<number>;
