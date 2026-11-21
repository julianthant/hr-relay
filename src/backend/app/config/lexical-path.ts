import { isAbsolute, relative, sep } from "node:path";

/** Lexical containment: `child` is `parent` or lies beneath it. Callers add their own same-root rule, realpath and authority checks. */
export function lexicallyWithin(parent: string, child: string): boolean {
  const part = relative(parent, child);
  return part === "" || (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}
