import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  watch,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  PARITY_JSON_REPORT,
  PARITY_PLAYWRIGHT_ARGS,
  PARITY_PLAYWRIGHT_COMMAND,
  PARITY_REPORT_LIMITS,
  assertParityJsonOutputIsFixed,
  captureParityReportIdentity,
  parityCommandLockPath,
  prepareParityReportLifecycle,
  runParityAndVerify,
  verifyParityJsonReport,
} from "../../../scripts/verify-parity-json.js";

const RUN_STARTED_AT = Date.parse("2026-08-31T19:00:00.000Z");
const REPORT_STARTED_AT = "2026-08-31T19:00:01.000Z";
const REQUIRED_A11Y_ANNOTATION = "required-a11y-evidence";

function reportFor(snapshot: string) {
  const name = "receipt.a11y.yml";
  const digest = createHash("sha256").update(snapshot).digest("hex");
  const annotations = [{ type: `a11y-attachment-sha256:${name}`, description: digest }];
  return {
    config: {},
    suites: [{
      title: "run-captures.spec.ts",
      file: "tests/parity/run-captures.spec.ts",
      column: 0,
      line: 0,
      specs: [{
        title: "captures receipt evidence",
        ok: true,
        tags: [],
        tests: [{
          timeout: 120000,
          annotations: [{ type: REQUIRED_A11Y_ANNOTATION, description: name }],
          expectedStatus: "passed",
          projectId: "",
          projectName: "",
          results: [{
            workerIndex: 0,
            parallelIndex: 0,
            status: "passed",
            duration: 12,
            errors: [],
            stdout: [],
            stderr: [],
            retry: 0,
            startTime: REPORT_STARTED_AT,
            annotations,
            attachments: [{
              name,
              contentType: "text/yaml",
              body: Buffer.from(snapshot).toString("base64") as string | undefined,
              path: undefined as string | undefined,
            }],
          }],
          status: "expected",
        }],
        id: "receipt-id",
        file: "tests/parity/run-captures.spec.ts",
        line: 1,
        column: 1,
      }],
    }],
    errors: [],
    stats: {
      startTime: REPORT_STARTED_AT,
      duration: 12,
      expected: 1,
      skipped: 0,
      unexpected: 0,
      flaky: 0,
    },
  };
}

function temporaryRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-parity-json-"));
  mkdirSync(join(root, "tests/parity"), { recursive: true, mode: 0o700 });
  return root;
}

type ReportFixture = ReturnType<typeof reportFor>;

type FixtureSpec = ReportFixture["suites"][number]["specs"][number];
type FixtureTest = FixtureSpec["tests"][number];
type FixtureResult = FixtureTest["results"][number];

function fixtureTest(report: ReportFixture): FixtureTest {
  const test = report.suites[0]?.specs[0]?.tests[0];
  if (test === undefined) throw new Error("test fixture carries no test");
  return test;
}

function fixtureResult(report: ReportFixture) {
  const result = report.suites[0]?.specs[0]?.tests[0]?.results[0];
  if (result === undefined) throw new Error("test fixture carries no result");
  return result;
}

function evidenceFreeResult(report: ReportFixture): FixtureResult {
  const result = structuredClone(fixtureResult(report));
  result.annotations = [];
  result.attachments = [];
  return result;
}

function evidenceFreeTest(report: ReportFixture): FixtureTest {
  const test = structuredClone(fixtureTest(report));
  test.annotations = [];
  test.results = [];
  return test;
}

function evidenceFreeSpec(report: ReportFixture): FixtureSpec {
  const spec = structuredClone(report.suites[0]?.specs[0]);
  if (spec === undefined) throw new Error("test fixture carries no spec");
  spec.tests = [];
  return spec;
}

function writeReport(root: string, report: ReportFixture): string {
  const path = join(root, PARITY_JSON_REPORT);
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(report), { mode: 0o600 });
  return path;
}

function assertFixtureRefused(
  mutate: (report: ReportFixture, root: string) => void,
  expected: RegExp,
): void {
  const root = temporaryRepo();
  try {
    const report = reportFor("tree");
    mutate(report, root);
    writeReport(root, report);
    assert.throws(
      () => verifyParityJsonReport({ cwd: root, runStartedAtMs: RUN_STARTED_AT, before: null }),
      expected,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("parity JSON evidence verifier", () => {
  it("traverses realistic nested suites and requires statically declared evidence", () => {
    const nestedRoot = temporaryRepo();
    try {
      const report = reportFor("nested tree");
      const top = report.suites[0];
      if (top === undefined) throw new Error("test fixture carries no suite");
      const specs = top.specs;
      top.specs = [];
      Object.assign(top, {
        suites: [{
          title: "narrow desktop Receipt",
          file: top.file,
          column: 1,
          line: 301,
          specs,
        }],
      });
      writeReport(nestedRoot, report);
      assert.deepEqual(
        verifyParityJsonReport({ cwd: nestedRoot, runStartedAtMs: RUN_STARTED_AT, before: null }),
        { attachmentCount: 1 },
      );
    } finally {
      rmSync(nestedRoot, { recursive: true, force: true });
    }

    assertFixtureRefused((report) => {
      fixtureResult(report).attachments = [];
      fixtureResult(report).annotations = [];
    }, /required a11y evidence .* is missing/u);
  });

  it("accepts one fresh body-backed a11y attachment with one exact digest annotation", () => {
    const root = temporaryRepo();
    try {
      writeReport(root, reportFor('- dialog "Receipt"'));

      assert.deepEqual(verifyParityJsonReport({ cwd: root, runStartedAtMs: RUN_STARTED_AT, before: null }), {
        attachmentCount: 1,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts two required names from one successful result and refuses either missing body", () => {
    const root = temporaryRepo();
    try {
      const report = reportFor("first tree");
      const secondName = "receipt-detail.a11y.yml";
      const secondBody = "second tree";
      fixtureTest(report).annotations.push({ type: REQUIRED_A11Y_ANNOTATION, description: secondName });
      fixtureResult(report).attachments.push({
        name: secondName,
        contentType: "text/yaml",
        body: Buffer.from(secondBody).toString("base64"),
        path: undefined,
      });
      fixtureResult(report).annotations.push({
        type: `a11y-attachment-sha256:${secondName}`,
        description: createHash("sha256").update(secondBody).digest("hex"),
      });
      writeReport(root, report);
      assert.deepEqual(
        verifyParityJsonReport({ cwd: root, runStartedAtMs: RUN_STARTED_AT, before: null }),
        { attachmentCount: 2 },
      );

      fixtureResult(report).attachments.pop();
      writeReport(root, report);
      assert.throws(
        () => verifyParityJsonReport({ cwd: root, runStartedAtMs: RUN_STARTED_AT, before: null }),
        /receipt-detail\.a11y\.yml is missing or duplicated; found 0 body attachments/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses absent, unreadable, malformed, stale, redirected, or incomplete report evidence", () => {
    const missing = temporaryRepo();
    try {
      assert.throws(
        () => verifyParityJsonReport({ cwd: missing, runStartedAtMs: RUN_STARTED_AT, before: null }),
        /missing, unsafe, or unreadable/u,
      );
    } finally {
      rmSync(missing, { recursive: true, force: true });
    }

    const unreadable = temporaryRepo();
    try {
      mkdirSync(join(unreadable, PARITY_JSON_REPORT), { recursive: true });
      assert.throws(
        () => verifyParityJsonReport({ cwd: unreadable, runStartedAtMs: RUN_STARTED_AT, before: null }),
        /missing, unsafe, or unreadable/u,
      );
    } finally {
      rmSync(unreadable, { recursive: true, force: true });
    }

    const malformed = temporaryRepo();
    try {
      const path = join(malformed, PARITY_JSON_REPORT);
      mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
      writeFileSync(path, "{", { mode: 0o600 });
      assert.throws(
        () => verifyParityJsonReport({ cwd: malformed, runStartedAtMs: RUN_STARTED_AT, before: null }),
        /report is malformed/u,
      );
    } finally {
      rmSync(malformed, { recursive: true, force: true });
    }

    const stale = temporaryRepo();
    try {
      writeReport(stale, reportFor("tree"));
      const before = captureParityReportIdentity(stale);
      assert.notEqual(before, null);
      assert.throws(
        () => verifyParityJsonReport({ cwd: stale, runStartedAtMs: RUN_STARTED_AT, before }),
        /report is stale/u,
      );
    } finally {
      rmSync(stale, { recursive: true, force: true });
    }

    const redirected = temporaryRepo();
    try {
      const target = join(redirected, "redirected.json");
      writeFileSync(target, JSON.stringify(reportFor("tree")));
      const path = join(redirected, PARITY_JSON_REPORT);
      mkdirSync(join(path, ".."), { recursive: true });
      symlinkSync(target, path);
      assert.throws(
        () => verifyParityJsonReport({ cwd: redirected, runStartedAtMs: RUN_STARTED_AT, before: null }),
        /missing, unsafe, or unreadable/u,
      );
    } finally {
      rmSync(redirected, { recursive: true, force: true });
    }

    assertFixtureRefused((report) => {
      fixtureResult(report).attachments = [];
      fixtureResult(report).annotations = [];
    }, /required a11y evidence .* found 0 body attachments/u);
  });

  it("refuses corrupt bodies, digest drift, path evidence, duplicates, prefixes, and both orphan directions", () => {
    assertFixtureRefused((report) => {
      const attachment = fixtureResult(report).attachments[0];
      if (attachment === undefined) throw new Error("fixture attachment missing");
      attachment.body = "%%%=";
    }, /malformed .*base64/u);

    assertFixtureRefused((report) => {
      const attachment = fixtureResult(report).attachments[0];
      if (attachment === undefined) throw new Error("fixture attachment missing");
      attachment.body = "AB==";
    }, /noncanonical.*base64/u);

    assertFixtureRefused((report) => {
      const annotation = fixtureResult(report).annotations[0];
      if (annotation === undefined) throw new Error("fixture annotation missing");
      annotation.description = "0".repeat(64);
    }, /does not match the exact attached body/u);

    assertFixtureRefused((report) => {
      const attachment = fixtureResult(report).attachments[0];
      if (attachment === undefined) throw new Error("fixture attachment missing");
      attachment.path = "/tmp/not-body.yml";
    }, /must be body-backed/u);

    assertFixtureRefused((report) => {
      const attachment = fixtureResult(report).attachments[0];
      if (attachment === undefined) throw new Error("fixture attachment missing");
      attachment.body = undefined;
      attachment.path = "/tmp/path-only.yml";
    }, /must be body-backed/u);

    assertFixtureRefused((report) => {
      const attachment = fixtureResult(report).attachments[0];
      if (attachment === undefined) throw new Error("fixture attachment missing");
      fixtureResult(report).attachments.push({ ...attachment });
    }, /missing or duplicated; found 2 body attachments/u);

    assertFixtureRefused((report) => {
      const annotation = fixtureResult(report).annotations[0];
      if (annotation === undefined) throw new Error("fixture annotation missing");
      fixtureResult(report).annotations.push({ ...annotation });
    }, /missing or duplicated; found 2 digest annotations/u);

    assertFixtureRefused((report) => {
      const annotation = fixtureResult(report).annotations[0];
      if (annotation === undefined) throw new Error("fixture annotation missing");
      fixtureResult(report).annotations.push({ ...annotation, type: `${annotation.type}:extra` });
    }, /undeclared a11y digest annotation/u);

    assertFixtureRefused((report) => {
      fixtureResult(report).annotations = [];
    }, /missing or duplicated; found 0 digest annotations/u);

    assertFixtureRefused((report) => {
      fixtureResult(report).attachments = [];
    }, /missing or duplicated; found 0 body attachments/u);
  });

  it("refuses undeclared, repeated, cross-result, and retried evidence instead of pooling attempts", () => {
    assertFixtureRefused((report) => {
      const test = report.suites[0]?.specs[0]?.tests[0];
      const declaration = test?.annotations[0];
      if (test === undefined || declaration === undefined) throw new Error("fixture declaration missing");
      test.annotations.push({ ...declaration });
    }, /repeats a required a11y evidence declaration/u);

    assertFixtureRefused((report) => {
      const attachment = fixtureResult(report).attachments[0];
      if (attachment === undefined) throw new Error("fixture attachment missing");
      fixtureResult(report).attachments.push({ ...attachment, name: "undeclared.a11y.yml" });
    }, /undeclared a11y attachment/u);

    assertFixtureRefused((report) => {
      const annotation = fixtureResult(report).annotations[0];
      if (annotation === undefined) throw new Error("fixture annotation missing");
      fixtureResult(report).annotations.push({ ...annotation, type: "a11y-attachment-sha256:undeclared.a11y.yml" });
    }, /undeclared a11y digest annotation/u);

    assertFixtureRefused((report) => {
      const spec = report.suites[0]?.specs[0];
      const test = spec?.tests[0];
      if (spec === undefined || test === undefined) throw new Error("fixture test missing");
      spec.tests.push(structuredClone(test));
    }, /repeats required a11y evidence name .* across results/u);

    assertFixtureRefused((report) => {
      const test = report.suites[0]?.specs[0]?.tests[0];
      const result = test?.results[0];
      if (test === undefined || result === undefined) throw new Error("fixture result missing");
      test.results.push({ ...structuredClone(result), retry: 1 });
    }, /exactly one retry-0 result/u);

    assertFixtureRefused((report) => {
      fixtureResult(report).retry = 1;
    }, /exactly one retry-0 result/u);
  });

  it.each([
    {
      name: "runtime-skipped producer",
      mutate: (report: ReportFixture) => {
        fixtureTest(report).status = "skipped";
        fixtureResult(report).status = "skipped";
      },
      expected: /outcome must be expected/u,
    },
    {
      name: "expected-failed producer",
      mutate: (report: ReportFixture) => {
        fixtureTest(report).expectedStatus = "failed";
        fixtureResult(report).status = "failed";
      },
      expected: /expectedStatus must be passed/u,
    },
    {
      name: "unexpected producer outcome",
      mutate: (report: ReportFixture) => { fixtureTest(report).status = "unexpected"; },
      expected: /outcome must be expected/u,
    },
    {
      name: "non-passing retry-zero result",
      mutate: (report: ReportFixture) => { fixtureResult(report).status = "failed"; },
      expected: /retry-0 result status must be passed/u,
    },
    {
      name: "result errors array",
      mutate: (report: ReportFixture) => { Object.assign(fixtureResult(report), { errors: [{ message: "failed" }] }); },
      expected: /retry-0 result must carry no errors/u,
    },
    {
      name: "singular result error",
      mutate: (report: ReportFixture) => { Object.assign(fixtureResult(report), { error: { message: "failed" } }); },
      expected: /retry-0 result must carry no errors/u,
    },
  ])("refuses $name as required evidence authority", ({ mutate, expected }) => {
    assertFixtureRefused(mutate, expected);
  });

  const aggregateCeilingControls: ReadonlyArray<{
    readonly name: string;
    readonly expected: RegExp;
    readonly mutate: (report: ReportFixture) => void;
  }> = [
    {
      name: "JSON depth",
      expected: /exceeds JSON depth/u,
      mutate: (report) => {
        let nested: unknown = "leaf";
        for (let depth = 0; depth <= PARITY_REPORT_LIMITS.jsonDepth; depth += 1) nested = { nested };
        Object.assign(report, { config: nested });
      },
    },
    {
      name: "JSON nodes",
      expected: /exceeds .* JSON values/u,
      mutate: (report) => {
        Object.assign(report, { config: Array.from({ length: PARITY_REPORT_LIMITS.jsonNodes + 1 }, () => null) });
      },
    },
    {
      name: "suite depth",
      expected: /exceeds suite depth/u,
      mutate: (report) => {
        const root = report.suites[0];
        if (root === undefined) throw new Error("fixture suite missing");
        const specs = root.specs;
        root.specs = [];
        let child: typeof root & { suites?: Array<typeof root> } = { ...root, title: "deepest", specs };
        for (let depth = 0; depth < PARITY_REPORT_LIMITS.suiteDepth; depth += 1) {
          child = { ...root, title: `depth-${String(depth)}`, specs: [], suites: [child] };
        }
        Object.assign(root, { suites: [child] });
      },
    },
    {
      name: "specs",
      expected: /aggregate specs ceiling/u,
      mutate: (report) => {
        const root = report.suites[0];
        if (root === undefined) throw new Error("fixture suite missing");
        const base = evidenceFreeSpec(report);
        root.specs = [];
        report.suites = Array.from(
          { length: Math.ceil((PARITY_REPORT_LIMITS.specs + 1) / PARITY_REPORT_LIMITS.localArray) },
          (_, suiteIndex) => ({
            ...root,
            title: `spec-suite-${String(suiteIndex)}`,
            specs: Array.from(
              { length: Math.min(PARITY_REPORT_LIMITS.localArray, PARITY_REPORT_LIMITS.specs + 1 - suiteIndex * PARITY_REPORT_LIMITS.localArray) },
              (_, specIndex) => ({ ...base, title: `spec-${String(suiteIndex)}-${String(specIndex)}` }),
            ),
          }),
        );
      },
    },
    {
      name: "tests",
      expected: /aggregate tests ceiling/u,
      mutate: (report) => {
        const suite = report.suites[0];
        if (suite === undefined) throw new Error("fixture suite missing");
        const baseSpec = evidenceFreeSpec(report);
        const baseTest = evidenceFreeTest(report);
        suite.specs = Array.from(
          { length: Math.ceil((PARITY_REPORT_LIMITS.tests + 1) / PARITY_REPORT_LIMITS.localArray) },
          (_, specIndex) => ({
            ...baseSpec,
            title: `test-spec-${String(specIndex)}`,
            tests: Array.from(
              { length: Math.min(PARITY_REPORT_LIMITS.localArray, PARITY_REPORT_LIMITS.tests + 1 - specIndex * PARITY_REPORT_LIMITS.localArray) },
              (_, testIndex) => ({ ...baseTest, projectId: `${String(specIndex)}-${String(testIndex)}` }),
            ),
          }),
        );
      },
    },
    {
      name: "results",
      expected: /aggregate results ceiling/u,
      mutate: (report) => {
        const spec = report.suites[0]?.specs[0];
        if (spec === undefined) throw new Error("fixture spec missing");
        const baseTest = evidenceFreeTest(report);
        const baseResult = evidenceFreeResult(report);
        spec.tests = Array.from(
          { length: Math.ceil((PARITY_REPORT_LIMITS.results + 1) / PARITY_REPORT_LIMITS.localArray) },
          (_, testIndex) => ({
            ...baseTest,
            projectId: `result-test-${String(testIndex)}`,
            results: Array.from(
              { length: Math.min(PARITY_REPORT_LIMITS.localArray, PARITY_REPORT_LIMITS.results + 1 - testIndex * PARITY_REPORT_LIMITS.localArray) },
              (_, resultIndex) => ({ ...baseResult, workerIndex: resultIndex }),
            ),
          }),
        );
      },
    },
    {
      name: "attachments",
      expected: /aggregate attachments ceiling/u,
      mutate: (report) => {
        const spec = report.suites[0]?.specs[0];
        if (spec === undefined) throw new Error("fixture spec missing");
        const baseTest = evidenceFreeTest(report);
        const baseResult = evidenceFreeResult(report);
        spec.tests = Array.from(
          { length: Math.ceil((PARITY_REPORT_LIMITS.attachments + 1) / PARITY_REPORT_LIMITS.localArray) },
          (_, testIndex) => ({
            ...baseTest,
            projectId: `attachment-test-${String(testIndex)}`,
            results: [{
              ...baseResult,
              attachments: Array.from(
                { length: Math.min(PARITY_REPORT_LIMITS.localArray, PARITY_REPORT_LIMITS.attachments + 1 - testIndex * PARITY_REPORT_LIMITS.localArray) },
                (_, attachmentIndex) => ({
                  name: `payload-${String(testIndex)}-${String(attachmentIndex)}.bin`,
                  contentType: "application/octet-stream",
                  body: undefined,
                  path: undefined,
                }),
              ),
            }],
          }),
        );
      },
    },
    {
      name: "annotations",
      expected: /aggregate annotations ceiling/u,
      mutate: (report) => {
        const spec = report.suites[0]?.specs[0];
        if (spec === undefined) throw new Error("fixture spec missing");
        const baseTest = evidenceFreeTest(report);
        const baseResult = evidenceFreeResult(report);
        spec.tests = Array.from(
          { length: Math.ceil((PARITY_REPORT_LIMITS.annotations + 1) / PARITY_REPORT_LIMITS.localArray) },
          (_, testIndex) => ({
            ...baseTest,
            projectId: `annotation-test-${String(testIndex)}`,
            results: [{
              ...baseResult,
              annotations: Array.from(
                { length: Math.min(PARITY_REPORT_LIMITS.localArray, PARITY_REPORT_LIMITS.annotations + 1 - testIndex * PARITY_REPORT_LIMITS.localArray) },
                (_, annotationIndex) => ({
                  type: `note-${String(testIndex)}-${String(annotationIndex)}`,
                  description: "aggregate ceiling control",
                }),
              ),
            }],
          }),
        );
      },
    },
  ];

  it.each(aggregateCeilingControls)("independently refuses the $name ceiling", ({ mutate, expected }) => {
    assertFixtureRefused(mutate, expected);
  });

  it("enforces recursive, aggregate, string, base64, decoded-byte, and report-byte ceilings", () => {
    assertFixtureRefused((report) => {
      const root = report.suites[0];
      if (root === undefined) throw new Error("fixture suite missing");
      const specs = root.specs;
      root.specs = [];
      let child = {
        title: "deepest",
        file: root.file,
        column: 1,
        line: 1,
        specs,
      };
      for (let depth = 0; depth < PARITY_REPORT_LIMITS.suiteDepth; depth += 1) {
        const parent = {
          title: `depth-${String(depth)}`,
          file: root.file,
          column: 1,
          line: 1,
          specs: [],
          suites: [child],
        };
        child = parent;
      }
      Object.assign(root, { suites: [child] });
    }, /exceeds suite depth/u);

    assertFixtureRefused((report) => {
      const root = report.suites[0];
      if (root === undefined) throw new Error("fixture suite missing");
      const emptySuites = (prefix: string) => Array.from({ length: 300 }, (_, index) => ({
        title: `${prefix}-${String(index)}`,
        file: root.file,
        column: 1,
        line: 1,
        specs: [],
      }));
      Object.assign(root, { suites: emptySuites("left") });
      const secondRoot = { ...root, title: "second-root", specs: [] };
      Object.assign(secondRoot, { suites: emptySuites("right") });
      report.suites.push(secondRoot);
    }, /aggregate suites ceiling/u);

    assertFixtureRefused((report) => {
      const spec = report.suites[0]?.specs[0];
      if (spec === undefined) throw new Error("fixture spec missing");
      spec.title = "x".repeat(PARITY_REPORT_LIMITS.stringChars + 1);
    }, /string longer|Too big/u);

    assertFixtureRefused((report) => {
      const attachment = fixtureResult(report).attachments[0];
      if (attachment === undefined) throw new Error("fixture attachment missing");
      attachment.body = Buffer.alloc(PARITY_REPORT_LIMITS.decodedBytes + 1, 65).toString("base64");
    }, /decoded evidence ceiling/u);

    assertFixtureRefused((report) => {
      const attachment = fixtureResult(report).attachments[0];
      if (attachment === undefined) throw new Error("fixture attachment missing");
      attachment.body = "AAAA".repeat(Math.floor(PARITY_REPORT_LIMITS.base64Chars / 4) + 1);
    }, /Too big|base64/u);

    assertFixtureRefused((report) => {
      const attachment = fixtureResult(report).attachments[0];
      if (attachment === undefined) throw new Error("fixture attachment missing");
      fixtureResult(report).attachments = Array.from(
        { length: PARITY_REPORT_LIMITS.localArray + 1 },
        () => ({ ...attachment }),
      );
    }, /Too big|malformed/u);

    assertFixtureRefused((report) => {
      const attachment = fixtureResult(report).attachments[0];
      if (attachment === undefined) throw new Error("fixture attachment missing");
      attachment.body = Buffer.from([0xff]).toString("base64");
    }, /invalid UTF-8/u);

    const oversized = temporaryRepo();
    try {
      const path = join(oversized, PARITY_JSON_REPORT);
      mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
      writeFileSync(path, Buffer.alloc(PARITY_REPORT_LIMITS.reportBytes + 1), { mode: 0o600 });
      assert.throws(
        () => verifyParityJsonReport({ cwd: oversized, runStartedAtMs: RUN_STARTED_AT, before: null }),
        /exceeds .* bytes/u,
      );
    } finally {
      rmSync(oversized, { recursive: true, force: true });
    }
  });

  it("refuses stale timestamps independently and detects descriptor/path changes after its one read", () => {
    const fileStale = temporaryRepo();
    try {
      const path = writeReport(fileStale, reportFor("tree"));
      const old = new Date(RUN_STARTED_AT - 1_000);
      utimesSync(path, old, old);
      assert.throws(
        () => verifyParityJsonReport({ cwd: fileStale, runStartedAtMs: RUN_STARTED_AT, before: null }),
        /file timestamp predates/u,
      );
    } finally {
      rmSync(fileStale, { recursive: true, force: true });
    }

    assertFixtureRefused((report) => {
      report.stats.startTime = new Date(RUN_STARTED_AT - 1_000).toISOString();
    }, /stats.startTime predates/u);

    assertFixtureRefused((report) => {
      fixtureResult(report).startTime = new Date(RUN_STARTED_AT - 1_000).toISOString();
    }, /result startTime that predates/u);

    const changed = temporaryRepo();
    try {
      writeReport(changed, reportFor("tree"));
      assert.throws(
        () => verifyParityJsonReport({
          cwd: changed,
          runStartedAtMs: RUN_STARTED_AT,
          before: null,
          afterReportRead: (path) => appendFileSync(path, " "),
        }),
        /changed while/u,
      );
    } finally {
      rmSync(changed, { recursive: true, force: true });
    }

    const replaced = temporaryRepo();
    try {
      writeReport(replaced, reportFor("tree"));
      assert.throws(
        () => verifyParityJsonReport({
          cwd: replaced,
          runStartedAtMs: RUN_STARTED_AT,
          before: null,
          afterReportRead: (path) => {
            renameSync(path, `${path}.old`);
            writeFileSync(path, JSON.stringify(reportFor("replacement")), { mode: 0o600 });
          },
        }),
        /changed while/u,
      );
    } finally {
      rmSync(replaced, { recursive: true, force: true });
    }
  });

  it("owns only a direct private report lifecycle and refuses link or owner substitution", () => {
    const normalized = temporaryRepo();
    try {
      const path = writeReport(normalized, reportFor("old"));
      const unrelated = join(path, "..", "unrelated-browser-artifact.txt");
      writeFileSync(unrelated, "preserve me", { mode: 0o600 });
      chmodSync(join(path, ".."), 0o755);
      chmodSync(path, 0o644);
      const before = prepareParityReportLifecycle(normalized);
      assert.equal(before.bytes, 0);
      assert.equal(lstatSync(join(path, "..")).mode & 0o777, 0o700);
      assert.equal(lstatSync(path).mode & 0o777, 0o600);
      assert.equal(readFileSync(unrelated, "utf8"), "preserve me");
    } finally {
      rmSync(normalized, { recursive: true, force: true });
    }

    const symlinkParent = temporaryRepo();
    const external = temporaryRepo();
    try {
      rmSync(join(symlinkParent, "tests/parity"), { recursive: true, force: true });
      symlinkSync(join(external, "tests/parity"), join(symlinkParent, "tests/parity"));
      assert.throws(() => prepareParityReportLifecycle(symlinkParent), /direct directory/u);
    } finally {
      rmSync(symlinkParent, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }

    const symlinkReport = temporaryRepo();
    try {
      const target = join(symlinkReport, "target.json");
      writeFileSync(target, "target", { mode: 0o600 });
      const reportPath = join(symlinkReport, PARITY_JSON_REPORT);
      mkdirSync(join(reportPath, ".."), { recursive: true, mode: 0o700 });
      symlinkSync(target, reportPath);
      assert.throws(() => prepareParityReportLifecycle(symlinkReport), /not one direct regular file/u);
    } finally {
      rmSync(symlinkReport, { recursive: true, force: true });
    }

    const hardLinked = temporaryRepo();
    try {
      const reportPath = writeReport(hardLinked, reportFor("tree"));
      linkSync(reportPath, `${reportPath}.second-link`);
      assert.throws(() => prepareParityReportLifecycle(hardLinked), /exactly one link/u);
      assert.equal(existsSync(reportPath), true, "a refused hard link must not be unlinked");
    } finally {
      rmSync(hardLinked, { recursive: true, force: true });
    }

    const wrongOwner = temporaryRepo();
    try {
      const uid = process.getuid?.();
      if (uid === undefined) throw new Error("owner control requires getuid");
      assert.throws(() => prepareParityReportLifecycle(wrongOwner, uid + 1), /not owned by the current user/u);
    } finally {
      rmSync(wrongOwner, { recursive: true, force: true });
    }
  });

  it("refuses every installed JSON output override and CLI reporter/config replacement", () => {
    for (const name of [
      "PLAYWRIGHT_JSON_OUTPUT_FILE",
      "PLAYWRIGHT_JSON_OUTPUT_DIR",
      "PLAYWRIGHT_JSON_OUTPUT_NAME",
    ]) {
      assert.throws(
        () => assertParityJsonOutputIsFixed("assert", { [name]: "" }, []),
        new RegExp(name),
      );
    }
    for (const args of [
      ["--reporter", "list"],
      ["--reporter=list"],
      ["--config", "other.ts"],
      ["--config=other.ts"],
      ["-c", "other.ts"],
      ["-cother.ts"],
      ["-u"],
      ["-u=all"],
      ["-uall"],
      ["-uchanged"],
      ["-umissing"],
      ["-unone"],
      ["--update-snapshots"],
      ["--update-snapshots=changed"],
      ["--update-source-method", "overwrite"],
      ["--update-source-method=patch"],
      ["--ignore-snapshots"],
      ["--retries", "2"],
      ["--retries=2"],
      ["--output", "tests/parity/references"],
      ["--output=tests/parity/references"],
      ["--output", process.cwd()],
      ["--output=/"],
      ["--output", tmpdir()],
    ]) {
      assert.throws(() => assertParityJsonOutputIsFixed("assert", {}, args), /may not/u);
    }
    assert.doesNotThrow(() => assertParityJsonOutputIsFixed("assert", {}, [
      "tests/parity/run-captures.spec.ts",
      "--grep",
      "receipt",
    ]));
    assert.throws(
      () => assertParityJsonOutputIsFixed("assert", { PARITY_UPDATE: "1" }, []),
      /PARITY_UPDATE/u,
    );
    assert.throws(
      () => assertParityJsonOutputIsFixed("update", { PARITY_UPDATE: "0" }, []),
      /PARITY_UPDATE/u,
    );
    assert.deepEqual(PARITY_PLAYWRIGHT_ARGS, [
      join(process.cwd(), "node_modules/playwright/cli.js"),
      "test",
      "--config",
      "playwright.parity.config.ts",
    ]);
    assert.equal(PARITY_PLAYWRIGHT_COMMAND, process.execPath);
    assert.equal(
      dirname(parityCommandLockPath(process.cwd())),
      join(realpathSync(process.cwd()), ".tracker/locks"),
      "the command lock must live under the canonical checkout-owned process-lock root",
    );
  });

  it("derives one environment-independent lock identity for lexical and symlink checkout aliases", () => {
    const root = temporaryRepo();
    const aliasParent = mkdtempSync(join(tmpdir(), "hrauto-parity-alias-"));
    const firstTmp = mkdtempSync(join(tmpdir(), "hrauto-parity-tmp-a-"));
    const secondTmp = mkdtempSync(join(tmpdir(), "hrauto-parity-tmp-b-"));
    const alias = join(aliasParent, "checkout-alias");
    const priorTmp = process.env.TMPDIR;
    try {
      symlinkSync(root, alias, "dir");
      process.env.TMPDIR = firstTmp;
      const canonicalPath = parityCommandLockPath(join(root, "."));
      process.env.TMPDIR = secondTmp;
      const aliasPath = parityCommandLockPath(alias);
      assert.equal(aliasPath, canonicalPath);
      assert.equal(dirname(aliasPath), join(realpathSync(root), ".tracker/locks"));
    } finally {
      if (priorTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = priorTmp;
      rmSync(aliasParent, { recursive: true, force: true });
      rmSync(firstTmp, { recursive: true, force: true });
      rmSync(secondTmp, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("forwards exact arguments through a child command and verifies its fresh report", async () => {
    const root = temporaryRepo();
    try {
      const child = join(root, "fake-parity.mjs");
      const argsPath = join(root, "observed-args.json");
      const modePath = join(root, "observed-mode.json");
      writeFileSync(child, `
        import { mkdirSync, writeFileSync } from "node:fs";
        import { dirname, join } from "node:path";
        const report = JSON.parse(Buffer.from(process.env.FAKE_REPORT_BASE64, "base64").toString("utf8"));
        const now = new Date().toISOString();
        report.stats.startTime = now;
        report.suites[0].specs[0].tests[0].results[0].startTime = now;
        const reportPath = join(process.cwd(), ${JSON.stringify(PARITY_JSON_REPORT)});
        mkdirSync(dirname(reportPath), { recursive: true });
        writeFileSync(reportPath, JSON.stringify(report));
        writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
        writeFileSync(${JSON.stringify(modePath)}, JSON.stringify(process.env.PARITY_UPDATE ?? null));
      `);
      const forwardedArgs = [
        "tests/parity/run-captures.spec.ts",
        "--grep",
        "receipt",
      ];

      const exit = await runParityAndVerify({
        cwd: root,
        env: {
          ...process.env,
          FAKE_REPORT_BASE64: Buffer.from(JSON.stringify(reportFor("tree"))).toString("base64"),
        },
        args: forwardedArgs,
        mode: "assert",
        command: process.execPath,
        commandArgs: [child],
        writeError: () => undefined,
      });

      assert.equal(exit, 0);
      assert.deepEqual(JSON.parse(readFileSync(argsPath, "utf8")), forwardedArgs);
      assert.equal(JSON.parse(readFileSync(modePath, "utf8")), null);

      const updateExit = await runParityAndVerify({
        cwd: root,
        env: {
          ...process.env,
          FAKE_REPORT_BASE64: Buffer.from(JSON.stringify(reportFor("tree"))).toString("base64"),
        },
        args: forwardedArgs,
        mode: "update",
        command: process.execPath,
        commandArgs: [child],
        writeError: () => undefined,
      });
      assert.equal(updateExit, 0);
      assert.equal(JSON.parse(readFileSync(modePath, "utf8")), "1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes the exact default Playwright launch tuple to the runner when no command override exists", async () => {
    const root = temporaryRepo();
    try {
      let observed: {
        readonly command: string;
        readonly args: readonly string[];
        readonly cwd: string;
        readonly parityUpdate: string | undefined;
      } | undefined;
      const forwarded = ["tests/parity/run-captures.spec.ts", "--grep", "Receipt"];
      const exit = await runParityAndVerify({
        cwd: root,
        env: process.env,
        args: forwarded,
        mode: "assert",
        writeError: () => undefined,
      }, {
        runChild: async (
          command: string,
          args: readonly string[],
          cwd: string,
          env: NodeJS.ProcessEnv,
        ) => {
          observed = { command, args, cwd, parityUpdate: env.PARITY_UPDATE };
          const report = reportFor("default launch");
          const now = new Date().toISOString();
          report.stats.startTime = now;
          fixtureResult(report).startTime = now;
          writeReport(cwd, report);
          return { code: 0, detail: "injected runner exit 0" };
        },
      });

      assert.equal(exit, 0);
      assert.deepEqual(observed, {
        command: PARITY_PLAYWRIGHT_COMMAND,
        args: [...PARITY_PLAYWRIGHT_ARGS, ...forwarded],
        cwd: root,
        parityUpdate: undefined,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs the wrapper entrypoint through a symlinked checkout path", () => {
    const aliasParent = mkdtempSync(join(tmpdir(), "hrauto-parity-entry-alias-"));
    const alias = join(aliasParent, "checkout");
    try {
      symlinkSync(process.cwd(), alias, "dir");
      const result = spawnSync(
        join(process.cwd(), "node_modules/.bin/tsx"),
        [join(alias, "scripts/verify-parity-json.ts"), "bogus"],
        { cwd: alias, encoding: "utf8" },
      );
      assert.notEqual(result.status, 0, "a symlinked entry path must not skip the wrapper's main function");
      assert.match(result.stderr, /requires explicit mode: assert or update/u);
    } finally {
      rmSync(aliasParent, { recursive: true, force: true });
    }
  });

  it("holds one checkout-scoped OS lock across report preparation, child execution, and verification", async () => {
    const unsafeLockRoot = temporaryRepo();
    const unsafeLockPath = parityCommandLockPath(unsafeLockRoot);
    try {
      const target = join(unsafeLockRoot, "lock-target");
      writeFileSync(target, "target", { mode: 0o600 });
      rmSync(unsafeLockPath, { force: true });
      mkdirSync(dirname(unsafeLockPath), { recursive: true, mode: 0o700 });
      symlinkSync(target, unsafeLockPath);
      await assert.rejects(
        runParityAndVerify({
          cwd: unsafeLockRoot,
          env: process.env,
          args: [],
          mode: "assert",
          command: process.execPath,
          commandArgs: ["-e", ""],
          writeError: () => undefined,
        }),
        /command lock path is not one direct private current-user file/u,
      );
    } finally {
      rmSync(unsafeLockPath, { force: true });
      rmSync(unsafeLockRoot, { recursive: true, force: true });
    }

    const root = temporaryRepo();
    try {
      const child = join(root, "blocking-parity.mjs");
      const started = join(root, "child-started");
      const proceed = join(root, "child-proceed");
      writeFileSync(child, `
        import { existsSync, writeFileSync } from "node:fs";
        import { join } from "node:path";
        writeFileSync(${JSON.stringify(started)}, "started");
        await new Promise((resolve) => {
          const timer = setInterval(() => {
            if (existsSync(${JSON.stringify(proceed)})) { clearInterval(timer); resolve(); }
          }, 5);
        });
        const report = JSON.parse(Buffer.from(process.env.FAKE_REPORT_BASE64, "base64").toString("utf8"));
        const now = new Date().toISOString();
        report.stats.startTime = now;
        report.suites[0].specs[0].tests[0].results[0].startTime = now;
        writeFileSync(join(process.cwd(), ${JSON.stringify(PARITY_JSON_REPORT)}), JSON.stringify(report));
      `);
      const options = {
        cwd: root,
        env: {
          ...process.env,
          FAKE_REPORT_BASE64: Buffer.from(JSON.stringify(reportFor("tree"))).toString("base64"),
        },
        args: [],
        mode: "assert" as const,
        command: process.execPath,
        commandArgs: [child],
        writeError: () => undefined,
      };
      const childStarted = new Promise<void>((resolveStarted) => {
        const watcher = watch(root, (_event, filename) => {
          if (filename === "child-started") {
            watcher.close();
            resolveStarted();
          }
        });
      });
      const first = runParityAndVerify(options);
      await Promise.race([
        childStarted,
        first.then(() => { throw new Error("the first parity command exited before its child held the lock"); }),
      ]);
      assert.equal(existsSync(started), true, "the first child must hold the command lock before the control");
      await assert.rejects(runParityAndVerify(options), /command lock is already held or unavailable/u);
      const aliasParent = mkdtempSync(join(tmpdir(), "hrauto-parity-contention-alias-"));
      const alternateTmp = mkdtempSync(join(tmpdir(), "hrauto-parity-contention-tmp-"));
      const alias = join(aliasParent, "checkout");
      const priorTmp = process.env.TMPDIR;
      try {
        symlinkSync(root, alias, "dir");
        process.env.TMPDIR = alternateTmp;
        const contender = spawnSync(
          "/usr/bin/lockf",
          ["-k", "-t", "0", parityCommandLockPath(alias), process.execPath, "-e", ""],
          { cwd: alias, env: { ...process.env, TMPDIR: alternateTmp } },
        );
        assert.notEqual(
          contender.status,
          0,
          "a symlink checkout alias under another TMPDIR must contend for the first wrapper's lock",
        );
      } finally {
        if (priorTmp === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = priorTmp;
        rmSync(aliasParent, { recursive: true, force: true });
        rmSync(alternateTmp, { recursive: true, force: true });
      }
      writeFileSync(proceed, "proceed");
      assert.equal(await first, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the command lock held after the child exits until the exact report verification finishes", async () => {
    const root = temporaryRepo();
    try {
      const child = join(root, "complete-parity.mjs");
      writeFileSync(child, `
        import { writeFileSync } from "node:fs";
        import { join } from "node:path";
        const report = JSON.parse(Buffer.from(process.env.FAKE_REPORT_BASE64, "base64").toString("utf8"));
        const now = new Date().toISOString();
        report.stats.startTime = now;
        report.suites[0].specs[0].tests[0].results[0].startTime = now;
        writeFileSync(join(process.cwd(), ${JSON.stringify(PARITY_JSON_REPORT)}), JSON.stringify(report));
      `);
      let verificationObserved = false;
      const options = {
        cwd: root,
        env: {
          ...process.env,
          FAKE_REPORT_BASE64: Buffer.from(JSON.stringify(reportFor("tree"))).toString("base64"),
        },
        args: [],
        mode: "assert" as const,
        command: process.execPath,
        commandArgs: [child],
        writeError: () => undefined,
        afterReportRead: () => {
          verificationObserved = true;
          const contender = spawnSync(
            "/usr/bin/lockf",
            ["-k", "-t", "0", parityCommandLockPath(root), process.execPath, "-e", ""],
            { cwd: root },
          );
          assert.notEqual(contender.status, 0, "a contender must fail while verification owns the command lock");
        },
      };
      assert.equal(await runParityAndVerify(options), 0);
      assert.equal(verificationObserved, true, "the contention probe must run after the child report is read");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed before overrides and after missing, unwritable, stale, or child-failed runs", async () => {
    const overrideRoot = temporaryRepo();
    try {
      const marker = join(overrideRoot, "child-ran");
      await assert.rejects(
        runParityAndVerify({
          cwd: overrideRoot,
          env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: "redirected.json" },
          args: [],
          mode: "assert",
          command: process.execPath,
          commandArgs: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`],
          writeError: () => undefined,
        }),
        /PLAYWRIGHT_JSON_OUTPUT_FILE/u,
      );
      assert.equal(existsSync(marker), false, "an output override must refuse before the child starts");
      let injectedChildRan = false;
      await assert.rejects(
        runParityAndVerify({
          cwd: overrideRoot,
          env: process.env,
          args: ["--output", "tests/parity/references"],
          mode: "assert",
          writeError: () => undefined,
        }, {
          runChild: async () => {
            injectedChildRan = true;
            return { code: 0, detail: "must not run" };
          },
        }),
        /--output may not redirect or delete/u,
      );
      assert.equal(injectedChildRan, false, "--output must refuse before the default child boundary is invoked");
    } finally {
      rmSync(overrideRoot, { recursive: true, force: true });
    }

    const missingRoot = temporaryRepo();
    try {
      const messages: string[] = [];
      const exit = await runParityAndVerify({
        cwd: missingRoot,
        env: process.env,
        args: [],
        mode: "assert",
        command: process.execPath,
        commandArgs: ["-e", ""],
        writeError: (message) => messages.push(message),
      });
      assert.equal(exit, 1);
      assert.match(messages.join(""), /verification failed:.*report is stale/u);
    } finally {
      rmSync(missingRoot, { recursive: true, force: true });
    }

    const unwritableRoot = temporaryRepo();
    try {
      const messages: string[] = [];
      const reportPath = join(unwritableRoot, PARITY_JSON_REPORT);
      const source = `
        const { mkdirSync, rmSync, writeFileSync } = require("node:fs");
        rmSync(${JSON.stringify(reportPath)});
        mkdirSync(${JSON.stringify(reportPath)}, { recursive: true });
        try { writeFileSync(${JSON.stringify(reportPath)}, "report"); } catch {}
      `;
      const exit = await runParityAndVerify({
        cwd: unwritableRoot,
        env: process.env,
        args: [],
        mode: "assert",
        command: process.execPath,
        commandArgs: ["-e", source],
        writeError: (message) => messages.push(message),
      });
      assert.equal(exit, 1);
      assert.match(messages.join(""), /verification failed:.*missing, unsafe, or unreadable/u);
    } finally {
      rmSync(unwritableRoot, { recursive: true, force: true });
    }

    const staleRoot = temporaryRepo();
    try {
      writeReport(staleRoot, reportFor("old tree"));
      const messages: string[] = [];
      const exit = await runParityAndVerify({
        cwd: staleRoot,
        env: process.env,
        args: [],
        mode: "assert",
        command: process.execPath,
        commandArgs: ["-e", ""],
        writeError: (message) => messages.push(message),
      });
      assert.equal(exit, 1);
      assert.match(messages.join(""), /verification failed:.*report is stale/u);
    } finally {
      rmSync(staleRoot, { recursive: true, force: true });
    }

    const failedRoot = temporaryRepo();
    try {
      const messages: string[] = [];
      const exit = await runParityAndVerify({
        cwd: failedRoot,
        env: process.env,
        args: [],
        mode: "assert",
        command: process.execPath,
        commandArgs: ["-e", "process.exit(7)"],
        writeError: (message) => messages.push(message),
      });
      assert.equal(exit, 7);
      assert.equal(messages.length, 2);
      assert.match(messages[0] ?? "", /Playwright parity command failed first \(exit 7\)/u);
      assert.match(messages[1] ?? "", /verification also failed:.*report is stale/u);
    } finally {
      rmSync(failedRoot, { recursive: true, force: true });
    }
  });

  it("names a strict-shape refusal as malformed JSON evidence", () => {
    const root = temporaryRepo();
    try {
      const path = join(root, PARITY_JSON_REPORT);
      mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
      writeFileSync(path, JSON.stringify({ ...reportFor("tree"), undeclared: true }), { mode: 0o600 });

      assert.throws(
        () => verifyParityJsonReport({ cwd: root, runStartedAtMs: RUN_STARTED_AT, before: null }),
        /parity JSON report is malformed/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});


it("fails a silent parity child without accepting its empty or stale JSON report", async () => {
  const root = temporaryRepo();
  const failures: string[] = [];
  try {
    const code = await runParityAndVerify({
      cwd: root, env: process.env, args: [], mode: "assert",
      command: process.execPath, commandArgs: ["-e", "setInterval(()=>{},1000)"],
      inactivityTimeoutMs: 200, writeError: (message) => { failures.push(message); },
    });
    assert.equal(code, 1);
    assert.match(failures.join("\n"), /no test output for 200ms/);
    assert.match(failures.join("\n"), /JSON evidence verification also failed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
