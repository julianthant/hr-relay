import { recordingInputSource } from "../../../support/helpers/test-target-registry-fixtures.js";
import assert from "node:assert/strict";
import { chmodSync,mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { createTestDataInputSource,testDataLocalPath } from "../../../../src/backend/app/registries/test-data.js";
import {
PERSON_LOOKUP_WORKFLOW,
resolvePersonLookupTestTarget,
TEST_TARGET_REGISTRY
} from "../../../../src/backend/app/registries/test-target-registry.js";
import type { TestDataInputSource } from "../../../../src/models/config/test-data.js";
import { testDataInputSource } from "../../../support/helpers/test-data/test-data-source.js";

/** A test-data input source whose every read is recorded by input name. */


/** A source whose private file is invalid: the loader already refused it by key, never by value. */
const privateRoots: string[] = [];
afterEach(() => { for (const root of privateRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A REAL private file (0600) carrying one configured value, read through the production loader. */
function privateFileSource(name: string, value: string): TestDataInputSource {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-test-target-private-"));
  privateRoots.push(root);
  mkdirSync(join(root, "config"));
  const path = testDataLocalPath(root);
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, inputs: {
    [name]: { valueId: "10000000-0000-4000-8000-00000000000a", value, updatedAt: "2026-09-07T00:00:00.000Z" },
  }, files: {} })}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return createTestDataInputSource(path);
}

describe("the person-lookup live-read resolver", () => {
  const PERSON_LOOKUP_LABEL = "person-lookup-canary";
  const EID_NAME = "personLookupCanaryEid";

  it("commits the canary's EID as a closed reference, never as a value", () => {
    const canary = TEST_TARGET_REGISTRY.targets.find(({ label }) => label === PERSON_LOOKUP_LABEL);
    assert.deepEqual(canary?.workflows[PERSON_LOOKUP_WORKFLOW]?.publicInput.subject, {
      state: "configured",
      reference: { name: EID_NAME },
    });
    assert.equal(canary?.availability.state, "available");
  });

  it("blocks by name when the EID is not configured and reads the store once", () => {
    const { source, read } = recordingInputSource({});
    const resolution = resolvePersonLookupTestTarget(TEST_TARGET_REGISTRY, PERSON_LOOKUP_LABEL, source);
    assert.deepEqual(resolution, {
      state: "blocked",
      label: PERSON_LOOKUP_LABEL,
      reason: `blocked: needs ${PERSON_LOOKUP_LABEL}; its UCPath employee id is not configured — set ${EID_NAME} in config/test-data.local.json`,
    });
    assert.deepEqual(read, ["personLookupCanaryEid"]);
  });

  it("resolves the configured EID through the person-lookup start box into the exact canonical input", () => {
    const resolution = resolvePersonLookupTestTarget(
      TEST_TARGET_REGISTRY,
      PERSON_LOOKUP_LABEL,
      testDataInputSource({ personLookupCanaryEid: "10800000" }),
    );
    assert.deepEqual(resolution, {
      state: "ready",
      label: PERSON_LOOKUP_LABEL,
      protectedBindings: [{ kind: "test-data-local", inputPath: "emplId",
        name: "personLookupCanaryEid", sourceId: "00000000-0000-4000-8000-000000000010" }],
      canonicalInput: { emplId: "10800000", keepNonHdh: false, includeCrmDates: false },
    });
  });

  it("names the reference and key, never the value, for a malformed EID", () => {
    assert.throws(
      () => resolvePersonLookupTestTarget(
        TEST_TARGET_REGISTRY,
        PERSON_LOOKUP_LABEL,
        privateFileSource("personLookupCanaryEid", "not-an-eid-99"),
      ),
      (error: unknown) => error instanceof Error
        && /employee-id reference personLookupCanaryEid is invalid in config\/test-data\.local\.json/u.test(error.message)
        && !error.message.includes("not-an-eid-99"),
    );
  });

  it("refuses a label that declares no person-lookup arm by name", () => {
    assert.throws(
      () => resolvePersonLookupTestTarget(TEST_TARGET_REGISTRY, "finalization-canary", testDataInputSource()),
      /test target finalization-canary declares no person-lookup arm; it declares separations, separations-kuali-finalization/u,
    );
  });
});
