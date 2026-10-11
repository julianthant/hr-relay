import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { runTestTargetDocumentNumberSmoke } from "../../../scripts/verify/test-target-document-number.js";
import { TestDataLocalConfigError } from "../../../src/models/config/test-data.js";
import { testDataInputSource } from "../../support/helpers/test-data/test-data-source.js";

describe("closed secret access", () => {

  it("admits the available committed canary without printing its document number", async () => {
    const privateValue = "8675309";
    const output: string[] = [];
    let reads = 0;
    const source = testDataInputSource({
      separationsKualiFinalizationCanaryDocumentNumber: privateValue,
    });
    const exitCode = await runTestTargetDocumentNumberSmoke({
      testInputs: source,
      readDocumentNumber: (reference, candidateSource) => {
        reads += 1;
        assert.equal(reference.name, "separationsKualiFinalizationCanaryDocumentNumber");
        assert.equal(candidateSource, source);
        return privateValue;
      },
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 0);
    assert.equal(reads, 1);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "source=test-data-local state=present",
      "workflow=separations label=finalization-canary resolution=ready",
    ]);
    assert.equal(output.some((line) => line.includes(privateValue)), false);
  });

  it("fails loud without rows when the committed document-number registry is unavailable", async () => {
    const privateCauseCanary = "CANARY_PRIVATE_COMMITTED_REGISTRY_FAILURE";
    const privateValueCanary = "4537";
    const output: string[] = [];

    await assert.rejects(
      runTestTargetDocumentNumberSmoke({
        testInputs: testDataInputSource({
          separationsKualiFinalizationCanaryDocumentNumber: privateValueCanary,
        }),
        loadCommittedReference: () => {
          throw new Error(privateCauseCanary);
        },
        writeLine: (line) => output.push(line),
      }),
      (error: unknown) => {
        const diagnostic = String(error);
        assert.match(diagnostic, /committed canary document-number registry unavailable/);
        assert.equal(diagnostic.includes(privateCauseCanary), false);
        assert.equal(diagnostic.includes(privateValueCanary), false);
        return true;
      },
    );
    assert.deepEqual(output, []);
  });

  it("refuses an unconfigured synthetic document number and never attempts the subject", async () => {
    const output: string[] = [];
    const exitCode = await runTestTargetDocumentNumberSmoke({
      testInputs: testDataInputSource(),
      resolveSubject: () => Promise.resolve("ready"),
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "source=test-data-local state=refused",
      "workflow=separations label=finalization-canary resolution=not-attempted",
    ]);
  });

  it("refuses a malformed configured document number without disclosing its value", async () => {
    const malformed = "CANARY_PRIVATE_DOCUMENT_NUMBER";
    const output: string[] = [];
    const exitCode = await runTestTargetDocumentNumberSmoke({
      testInputs: { read: () => { throw new TestDataLocalConfigError("config/test-data.local.json is invalid: inputs.separationsKualiFinalizationCanaryDocumentNumber.value"); } },
      resolveSubject: () => Promise.resolve("ready"),
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.equal(output.some((line) => line.includes(malformed)), false);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "source=test-data-local state=invalid",
      "workflow=separations label=finalization-canary resolution=not-attempted",
    ]);
  });

  it("propagates an unexpected document-number source failure", async () => {
    const cause = new Error("unexpected document-number reader failure");
    const output: string[] = [];

    await assert.rejects(
      runTestTargetDocumentNumberSmoke({
        testInputs: testDataInputSource(),
        resolveSubject: () => Promise.resolve("ready"),
        readDocumentNumber: () => {
          throw cause;
        },
        writeLine: (line) => output.push(line),
      }),
      (error: unknown) => error === cause,
    );
    assert.deepEqual(output, []);
  });

  it("records a known malformed document-number source as invalid", async () => {
    const output: string[] = [];
    const exitCode = await runTestTargetDocumentNumberSmoke({
      testInputs: testDataInputSource(),
      resolveSubject: () => Promise.resolve("ready"),
      readDocumentNumber: () => {
        throw new TestDataLocalConfigError("config/test-data.local.json is invalid: inputs.separationsKualiFinalizationCanaryDocumentNumber.value");
      },
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "source=test-data-local state=invalid",
      "workflow=separations label=finalization-canary resolution=not-attempted",
    ]);
  });

  it("propagates an unexpected subject resolver failure", async () => {
    const cause = new Error("unexpected subject resolver failure");
    const output: string[] = [];

    await assert.rejects(
      runTestTargetDocumentNumberSmoke({
        testInputs: testDataInputSource(),
        resolveSubject: () => Promise.reject(cause),
        writeLine: (line) => output.push(line),
      }),
      (error: unknown) => error === cause,
    );
    assert.deepEqual(output, []);
  });

  it("refuses a present number whose composed subject does not resolve ready", async () => {
    // Secret presence alone is insufficient; the composed subject must resolve before readiness passes.
    for (const resolution of ["blocked", "defect"] as const) {
      const output: string[] = [];
      const exitCode = await runTestTargetDocumentNumberSmoke({
        testInputs: testDataInputSource({
          separationsKualiFinalizationCanaryDocumentNumber: "4537",
        }),
        resolveSubject: () => Promise.resolve(resolution),
        writeLine: (line) => output.push(line),
      });
      assert.equal(exitCode, 1, resolution);
      assert.deepEqual(output[0], "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "source=test-data-local state=not-attempted");
      assert.deepEqual(output[1], `workflow=separations label=finalization-canary resolution=${resolution}`);
    }
  });
});
