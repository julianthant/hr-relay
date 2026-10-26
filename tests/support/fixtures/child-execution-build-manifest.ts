import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { collectSourceClosure, fingerprintSourceSet } from "../../../scripts/build/workflow-build-manifest.js";
import { parseBuildManifest } from "../../../src/models/workflow/build-manifest.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
const require = createRequire(import.meta.url);
const version = (name: string) => z.object({ version: z.string().min(1) })
  .parse(JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8"))).version;
const toolchain = { typescript: version("typescript"), zod: version("zod") };
const entry = (id: string, owner: string) => {
  const sources = collectSourceClosure(repoRoot, join(repoRoot, owner));
  return { id, sources, fingerprint: fingerprintSourceSet(toolchain, id, sources) };
};

export const childExecutionBuildManifest = parseBuildManifest({ kind: "hrauto-rebuild-build-manifest", manifestVersion: 1, toolchain,
  workflows: [
    ...["fixture-plan1-leaf", "fixture-plan1-child", "fixture-plan1-parent"]
      .map(id => entry(id, "tests/support/fixtures/plan1-operation-workflows.ts")),
    ...["fixture-child-runtime-nested", "fixture-child-runtime-root", "fixture-child-policy-cascade", "fixture-child-policy-independent",
      "fixture-child-unawaited-independent"]
      .map(id => entry(id, "tests/support/fixtures/child-execution-workflows.ts")),
    ...["fixture-child-crash-write", "fixture-child-crash-write-root", "fixture-child-prerequisites-root"]
      .map(id => entry(id, "tests/support/fixtures/child-execution-write-workflow.ts")),
  ],
  tasks: [entry("ocr/extract-form-page", "tests/support/fixtures/plan1-operation-workflows.ts"),
    ...["ucpath/read-write-fixture-probe", "ucpath/fill-write-fixture", "ucpath/submit-write-fixture"]
      .map(id => entry(id, "tests/support/fixtures/write-sequencer-fixtures.ts"))],
});
