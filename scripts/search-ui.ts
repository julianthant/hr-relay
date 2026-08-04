import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertSafeUiCatalogFresh } from "../src/stores/ucpath/driver/catalog.js";

const USAGE = "usage: npm run selector:search -- [--catalog <path>] \"<intent>\"";
const DEFAULT_CATALOG_PATH = resolve(import.meta.dirname, "../generated/ui-catalog.json");

/**
 * `--catalog` names the projection to search, defaulting to this checkout's
 * generated catalog. An explicit path lets a caller point at a catalog built
 * elsewhere — which is how the staleness fixture proves this CLI refuses a stale
 * projection without ever mutating the tracked artifact other guards read.
 */
function parseArguments(argv: readonly string[]): { catalogPath: string; query: string } {
  let catalogPath: string | undefined;
  let awaitingCatalogPath = false;
  const intent: string[] = [];
  for (const argument of argv) {
    if (awaitingCatalogPath) {
      catalogPath = argument;
      awaitingCatalogPath = false;
      continue;
    }
    if (argument === "--catalog") {
      if (catalogPath !== undefined) throw new Error(`${USAGE} (--catalog given more than once)`);
      awaitingCatalogPath = true;
      continue;
    }
    intent.push(argument);
  }
  if (awaitingCatalogPath) throw new Error(`${USAGE} (--catalog needs a path)`);
  const query = intent.join(" ").trim().toLowerCase();
  if (query.length === 0) throw new Error(USAGE);
  return {
    catalogPath: catalogPath === undefined ? DEFAULT_CATALOG_PATH : resolve(catalogPath),
    query,
  };
}

const { catalogPath, query } = parseArguments(process.argv.slice(2));
const catalog = assertSafeUiCatalogFresh(JSON.parse(await readFile(catalogPath, "utf8")));
const tokens = query.split(/\s+/u);
const ranked = catalog.entries
  .map((entry) => {
    const searchable = [entry.id, entry.label, ...entry.searchTerms].join(" ").toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (searchable.includes(token) ? 1 : 0), 0);
    return { entry, score };
  })
  .filter(({ score }) => score > 0)
  .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id));

if (ranked.length === 0) throw new Error(`no semantic UI facts matched intent: ${query}`);

for (const { entry, score } of ranked) {
  process.stdout.write(`${String(score)}\t${entry.kind}\t${entry.id}\t${entry.label}\n`);
}
