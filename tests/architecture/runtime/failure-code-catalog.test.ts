import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { READABLE_WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { ErrorCatalogCodeSchema, failureCodeFromTaskCode } from "../../../src/models/failures/error-catalog.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { REPO_ROOT, repoRelative, walkFiles } from "../support/helpers/guard-files.js";

type CodeOwner = Readonly<{ owner: string; code: string }>;
type DeclaredContract = Readonly<{ id: string; errorCodes: readonly string[] }>;

function uncatalogued(owners: readonly CodeOwner[]): readonly string[] {
  return owners.filter(({ code }) => !ErrorCatalogCodeSchema.safeParse(failureCodeFromTaskCode(code)).success)
    .map(({ owner, code }) => `${owner}: ${code}`);
}

function declaredCodes(contracts: readonly DeclaredContract[]): readonly CodeOwner[] {
  return contracts.flatMap(contract => contract.errorCodes.map(code => ({ owner: contract.id, code })));
}

function constructedCodes(owner: string, source: string): readonly CodeOwner[] {
  return [...source.matchAll(/new TaskError\(\s*[^,]+,\s*"([^"]+)"/gu)].map(match => ({ owner, code: match[1] ?? "" }));
}

function declared(contract: DeclaredContract): DeclaredContract {
  return { id: contract.id, errorCodes: contract.errorCodes };
}

function registeredContracts(): readonly DeclaredContract[] {
  return READABLE_WORKFLOW_MODULES.flatMap(({ descriptor }) => descriptorRuntimeNodes(descriptor).flatMap((node): DeclaredContract[] =>
    node.kind === "task" ? [declared(node.uses)]
      : node.kind === "transaction" ? [declared(node.prepare.uses), declared(node.commit.uses)] : []));
}

describe("runtime failure code catalog", () => {
  it("catalogues every task error code a registered workflow declares", () => {
    const codes = declaredCodes(registeredContracts());
    assert.ok(codes.length > 0, "the registry declares no task error codes");
    assert.deepEqual(uncatalogued(codes), []);
  });

  it("catalogues every literal task error code the runtime constructs", () => {
    const files = walkFiles(resolve(REPO_ROOT, "src/backend/runtime"));
    const constructed = files.flatMap(file => constructedCodes(repoRelative(file), readFileSync(file, "utf8")));
    assert.ok(constructed.some(({ code }) => code === "BROWSER_SCREENSHOT_CAPTURE_FAILED"), "the runtime scan resolved no TaskError codes");
    assert.deepEqual(uncatalogued(constructed), []);
  });

  it("rejects a declared or constructed code the catalog does not hold and admits a catalogued one", () => {
    assert.deepEqual(uncatalogued(declaredCodes([{ id: "fixture/read", errorCodes: ["subject-mismatch", "fixture-uncatalogued"] }])),
      ["fixture/read: fixture-uncatalogued"]);
    const source = `throw new TaskError(contract.id, "capability-unavailable", "m");
      throw new TaskError(
        contract.id,
        "fixture-uncatalogued",
        "m",
      );`;
    assert.deepEqual(constructedCodes("fixture.ts", source).map(({ code }) => code), ["capability-unavailable", "fixture-uncatalogued"]);
    assert.deepEqual(uncatalogued(constructedCodes("fixture.ts", source)), ["fixture.ts: fixture-uncatalogued"]);
  });
});
