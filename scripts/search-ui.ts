import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { UiCatalogSchema } from "../src/domain/ui/contracts.js";

const query = process.argv.slice(2).join(" ").trim().toLowerCase();
if (query.length === 0) throw new Error("usage: npm run selector:search -- \"<intent>\"");

const catalogPath = resolve(import.meta.dirname, "../generated/ui-catalog.json");
const catalog = UiCatalogSchema.parse(JSON.parse(await readFile(catalogPath, "utf8")));
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
