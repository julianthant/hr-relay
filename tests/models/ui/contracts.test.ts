import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,it } from "vitest";
import { UiVerificationEvidenceManifestSchema } from "../../../src/models/ui/contracts.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

describe("semantic UI registry", () => {

  it("keeps both fixture and live evidence sanitized and write-free", () => {
    for (const path of [
      "tests/support/fixtures/ui/ucpath/person-org.fixture.json",
      "tests/support/fixtures/ui/ucpath/person-org.live.json",
    ]) {
      const manifest = UiVerificationEvidenceManifestSchema.parse(
        JSON.parse(readFileSync(resolve(REPO_ROOT, path), "utf8")),
      );
      assert.equal(manifest.externalWriteAttempted, false);
      assert.equal(manifest.sanitized, true);
      assert.equal(manifest.assertions.every(({ capturedValue }) => capturedValue === false), true);
      if (manifest.evidenceKind === "live-read-only") {
        assert.deepEqual(manifest.rejectedCandidates?.map(({ legacyKey, matchedCount }) => ({
          legacyKey,
          matchedCount,
        })), [
          { legacyKey: "personOrgSummary.emplIdInput()", matchedCount: 0 },
          { legacyKey: "personOrgSummary.nameInput()", matchedCount: 0 },
        ]);
        assert.deepEqual(manifest.paginationProofs?.map((proof) => ({
          context: proof.context,
          initialState: proof.initialState,
          finalState: proof.finalState,
          renderedBefore: proof.renderedBefore,
          renderedAfter: proof.renderedAfter,
        })), [
          {
            context: "search-results",
            initialState: "enabled-view-all",
            finalState: "view-n",
            renderedBefore: 100,
            renderedAfter: 300,
          },
          {
            context: "search-results",
            initialState: "disabled-view-all",
            finalState: "disabled-view-all",
            renderedBefore: 27,
            renderedAfter: 27,
          },
          {
            context: "employment-instances",
            initialState: "enabled-view-all",
            finalState: "view-n",
            renderedBefore: 1,
            renderedAfter: 10,
          },
        ]);
      }
    }
  });
});
