import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildSafeUiCatalog,
  renderSystemUiCatalogMarkdown,
} from "../src/stores/ucpath/driver/catalog.js";

const repoRoot = resolve(import.meta.dirname, "..");
const catalog = buildSafeUiCatalog();

await mkdir(resolve(repoRoot, "generated"), { recursive: true });
await writeFile(
  resolve(repoRoot, "generated/ui-catalog.json"),
  `${JSON.stringify(catalog, null, 2)}\n`,
  "utf8",
);
await writeFile(
  resolve(repoRoot, "src/stores/ucpath/UI-CATALOG.md"),
  renderSystemUiCatalogMarkdown(catalog, "ucpath"),
  "utf8",
);
await writeFile(
  resolve(repoRoot, "src/stores/crm/UI-CATALOG.md"),
  renderSystemUiCatalogMarkdown(catalog, "crm"),
  "utf8",
);

process.stdout.write(`Generated ${String(catalog.entries.length)} semantic UI catalog entries.\n`);
