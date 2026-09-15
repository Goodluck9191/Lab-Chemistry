import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Path separator, built from a char code so this file contains no backslash
 * escape sequences that a generator could mangle. */
const PATH_SEPARATOR = String.fromCharCode(92);

/** Recursively list files under `dir`, skipping dotfiles and node_modules. */
export function listFiles(dir: string, filter: (path: string) => boolean): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...listFiles(full, filter));
    } else if (filter(full)) {
      results.push(full);
    }
  }

  return results;
}

export function read(path: string): string {
  return readFileSync(path, "utf8");
}

export function typeScriptFiles(dir: string): string[] {
  return listFiles(dir, (path) => path.endsWith(".ts") || path.endsWith(".tsx"));
}

export function sqlFiles(dir: string): string[] {
  return listFiles(dir, (path) => path.endsWith(".sql"));
}

/** Repo-relative, forward-slash path, so assertions are platform independent. */
export function projectPath(path: string): string {
  return relative(process.cwd(), path).split(PATH_SEPARATOR).join("/");
}
