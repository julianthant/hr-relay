import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildSafeUiCatalog,
  renderSystemUiCatalogMarkdown,
} from "../src/stores/ucpath/driver/catalog.js";

const USAGE = "usage: npm run ui:catalog -- [--out-root <path>]";
const DEFAULT_OUT_ROOT = resolve(import.meta.dirname, "..");

/**
 * `--out-root` relocates the whole projection tree (`generated/ui-catalog.json`
 * plus both per-system `UI-CATALOG.md` files) under another root. It exists so a
 * behavioural fixture can exercise the real generator WITHOUT rewriting the
 * tracked artifacts that `semantic-ui-registry` and `ui-registry` read while the
 * suite runs in parallel; an unrecognised argument fails loud rather than being
 * silently ignored and writing over the checkout.
 */
function parseOutRoot(argv: readonly string[]): string {
  if (argv.length === 0) return DEFAULT_OUT_ROOT;
  if (argv.length !== 2 || argv[0] !== "--out-root" || argv[1].length === 0) throw new Error(USAGE);
  return resolve(argv[1]);
}

/**
 * Publish through a sibling staging file and an atomic rename. `writeFile`
 * truncates before it writes, so a concurrent reader of a tracked projection can
 * legitimately observe a zero-length file and fail on `JSON.parse("")`; a rename
 * within the same directory never exposes a partial artifact.
 */
async function publishArtifact(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const staging = `${path}.${String(process.pid)}.staging`;
  await writeFile(staging, content, "utf8");
  await rename(staging, path);
}

const outRoot = parseOutRoot(process.argv.slice(2));
const catalog = buildSafeUiCatalog();

await publishArtifact(
  resolve(outRoot, "generated/ui-catalog.json"),
  `${JSON.stringify(catalog, null, 2)}\n`,
);
await publishArtifact(
  resolve(outRoot, "src/stores/ucpath/UI-CATALOG.md"),
  renderSystemUiCatalogMarkdown(catalog, "ucpath"),
);
await publishArtifact(
  resolve(outRoot, "src/stores/crm/UI-CATALOG.md"),
  renderSystemUiCatalogMarkdown(catalog, "crm"),
);

process.stdout.write(`Generated ${String(catalog.entries.length)} semantic UI catalog entries.\n`);
