import { resolve } from "node:path";
import ts from "typescript";

const registry = ts.createDocumentRegistry();
const sources = new Map<string, ts.SourceFile>();

export function createGuardProgram(
  roots: readonly string[],
  options: ts.CompilerOptions,
  virtualSources: ReadonlyMap<string, string> = new Map(),
): ts.Program {
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  host.readFile = (file) => virtualSources.get(file) ?? readFile(file);
  const getSourceFile = host.getSourceFile.bind(host);
  const settings = registry.getKeyForCompilationSettings(options);
  host.getSourceFile = (file, parseOptions, onError, fresh) => {
    if (fresh) return getSourceFile(file, parseOptions, onError, fresh);
    const text = host.readFile(file);
    if (text === undefined) return undefined;
    // This host only receives TypeScript's module indicator, derived from these settings.
    const parse = typeof parseOptions === "number" ? { languageVersion: parseOptions } : parseOptions;
    const key = JSON.stringify([settings, host.getCanonicalFileName(resolve(file)), parse.languageVersion,
      parse.impliedNodeFormat, parse.jsDocParsingMode]);
    const cached = sources.get(key);
    if (cached?.text === text) return cached;
    const source = getSourceFile(file, parseOptions, onError, fresh);
    if (source !== undefined) sources.set(key, source);
    return source;
  };
  return ts.createProgram([...roots], options, host);
}
