import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILD_MANIFEST_PATH } from "../../src/models/workflow/build-manifest.js";
import {
  auditBuildManifestBytes,
  computeBuildManifest,
  prepareBuildManifest,
} from "./workflow-build-manifest.js";

const repoRoot = resolve(import.meta.dirname, "../..");
const target = resolve(repoRoot, BUILD_MANIFEST_PATH);

if (process.argv.includes("--check")) {
  const violations = auditBuildManifestBytes(readFileSync(target, "utf8"), computeBuildManifest(repoRoot));
  if (violations.length > 0) {
    process.stderr.write(`${violations.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${BUILD_MANIFEST_PATH} is current.\n`);
} else {
  prepareBuildManifest(repoRoot);
  process.stdout.write(`Prepared ${BUILD_MANIFEST_PATH}.\n`);
}
