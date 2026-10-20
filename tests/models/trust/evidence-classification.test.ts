
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import type { AnyTaskContract } from "../../../src/models/task/task-contract.js";
import { admitOcrExtraction } from "../../../src/models/ocr/extraction.js";
import { OCR_FORM_TYPES, fieldOnPageKind, ocrForm } from "../../../src/models/ocr/form-registry.js";
import { ExtractFormPage } from "../../../src/models/processing/ocr/extract-form-page.js";
import {
classifyEvidenceLeaf,
evidenceLeaves,
EvidenceFieldClassificationSchema,
} from "../../../src/models/trust/evidence-classification.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import {
WriteFixtureCommit,
WriteFixtureSaveCommit,
} from "../../support/fixtures/write-sequencer-fixtures.js";

/* ── the write-proof redaction table is total over every commit contract ─── */

interface CommitLike {
  readonly contract: AnyTaskContract & {
    readonly writeSafety: {
      readonly completion: {
        readonly proofSchema: { parse: (value: unknown) => unknown };
        readonly proofFromOutput: (output: unknown) => unknown;
      };
    };
    readonly output: { parse: (value: unknown) => unknown };
    readonly example: unknown;
  };
}

function registeredCommitContracts(): readonly CommitLike["contract"][] {
  const contracts = new Map<string, CommitLike["contract"]>();
  for (const descriptor of WORKFLOW_DESCRIPTORS) {
    for (const node of descriptorRuntimeNodes(descriptor)) {
      if (node.kind !== "transaction") continue;
      const commit = node.commit.uses as CommitLike["contract"];
      contracts.set(String(commit.id), commit);
    }
  }
  return [...contracts.values()];
}

describe("the write-proof redaction table (declared, never guessed)", () => {

  for (const contract of registeredCommitContracts()) {
    it(`declares every leaf of ${String(contract.id)}'s example completion proof`, () => {
      const output = contract.output.parse(contract.example);
      const proof = contract.writeSafety.completion.proofSchema.parse(
        contract.writeSafety.completion.proofFromOutput(output),
      );
      const scope = { kind: "write-proof", taskId: contract.id } as const;
      for (const leaf of evidenceLeaves(proof)) {
        const declared = classifyEvidenceLeaf(scope, leaf.path);
        assert.ok(declared.classification.length > 0, `undeclared leaf ${leaf.path}`);
      }
    });
  }

  for (const fixture of [WriteFixtureCommit, WriteFixtureSaveCommit]) {
    it(`declares the sealed fixture contract ${String(fixture.id)}'s proof leaves`, () => {
      const proof = fixture.writeSafety.completion.proofSchema.parse(
        fixture.writeSafety.completion.proofFromOutput(fixture.output.parse(fixture.example)),
      );
      const scope = { kind: "write-proof", taskId: fixture.id } as const;
      for (const leaf of evidenceLeaves(proof)) {
        classifyEvidenceLeaf(scope, leaf.path);
      }
    });
  }

  it("negative control: an undeclared write-proof leaf is refused BY NAME, never dropped", () => {
    assert.throws(
      () => classifyEvidenceLeaf(
        { kind: "write-proof", taskId: "kuali/save-separation-finalization" } as never,
        "inventedLeaf",
      ),
      /no declared evidence classification for write-proof:kuali\/save-separation-finalization/u,
    );
  });
});

describe("OCR task evidence declarations", () => {
  const scope = { kind: "task-output", taskId: ExtractFormPage.id } as const;
  const metadataPaths = ["formType", "pageFingerprint", "pageKind", "readAt",
    "source.kind", "source.modelId", "source.providerId", "sourcePage", "sourceSha256"];

  for (const formType of OCR_FORM_TYPES) {
    const form = ocrForm(formType);
    for (const pageKind of [...form.pageKinds, "boilerplate", "unrelated", "blank"] as const) {
      it(`classifies every admitted ${formType}/${pageKind} leaf and recorded point`, () => {
        const dataBearing = form.pageKinds.includes(pageKind);
        const admission = admitOcrExtraction({
          formType, pageKind,
          source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "fixture" },
          readAt: "2026-08-06T09:00:00.000Z", sourcePage: 1, sourceSha256: "a".repeat(64),
          record: dataBearing ? { answers: Object.fromEntries(form.fields.map((field) => [field.path,
            { state: "absent", reason: fieldOnPageKind(field, pageKind) ? "blank" : "not-on-form" },
          ])) } : null,
        });
        assert.equal(admission.admitted, true);
        if (!admission.admitted) throw new Error("fixture extraction must be admitted");
        const leaves = evidenceLeaves(admission.extraction);
        assert.deepEqual(leaves.map(({ path }) => path), [...metadataPaths, ...(dataBearing
          ? ["record.answers", "record.answersFingerprint", "record.blockingPaths"] : ["record"])].sort());
        for (const leaf of leaves) classifyEvidenceLeaf(scope, leaf.path);
        for (const path of ["formType", "sourcePage", "pageKind", "pageFingerprint", "readAt", "sourceSha256"]) {
          assert.equal(classifyEvidenceLeaf(scope, path).classification, "safe-diagnostic");
        }
      });
    }
  }

  it("refuses undeclared OCR leaves and does not lend declarations to other tasks", () => {
    for (const path of ["unexpected", "record.unexpected", "record.answers.raw", "source.actorId"]) {
      assert.throws(() => classifyEvidenceLeaf(scope, path), /no declared evidence classification/u);
    }
    assert.throws(() => classifyEvidenceLeaf({ kind: "task-output", taskId: WriteFixtureCommit.id }, "formType"),
      /no declared evidence classification/u);
  });

  it("keeps captured answers and free provider metadata under restrictive transforms", () => {
    assert.equal(classifyEvidenceLeaf(scope, "hasRecord").classification, "safe-diagnostic");
    for (const path of ["record.answers", "source.modelId"]) {
      const declaration = classifyEvidenceLeaf(scope, path);
      assert.equal(declaration.classification, "sensitive-hr");
      assert.equal(declaration.transform, "drop");
      assert.equal(EvidenceFieldClassificationSchema.safeParse({ ...declaration, transform: "allow" }).success, false);
    }
    assert.equal(classifyEvidenceLeaf(scope, "record.blockingPaths").transform, "count");
  });
});
