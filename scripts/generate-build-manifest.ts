import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILD_MANIFEST_PATH } from "../src/domain/workflow/build-manifest.js";
import {
  computeBuildManifest,
  renderBuildManifestModule,
} from "../src/infra/build/workflow-build-manifest.js";

const repoRoot = resolve(import.meta.dirname, "..");
const target = resolve(repoRoot, BUILD_MANIFEST_PATH);
const rendered = renderBuildManifestModule(computeBuildManifest(repoRoot));

if (process.argv.includes("--check")) {
  const current = readFileSync(target, "utf8");
  if (current !== rendered) {
    process.stderr.write(
      `${BUILD_MANIFEST_PATH} is stale. Run \`npm run build:manifest\` and commit the result.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`${BUILD_MANIFEST_PATH} is current.\n`);
} else {
  writeFileSync(target, rendered, "utf8");
  process.stdout.write(`Wrote ${BUILD_MANIFEST_PATH}.\n`);
}
