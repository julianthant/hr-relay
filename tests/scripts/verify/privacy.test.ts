import { testProcessImport } from "../../support/compiled-process.js";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { inspectTrackedFile, scanTrackedFiles } from "../../../scripts/verify/privacy.js";

const unknownEid = ["10", "823", "741"].join("");
const unknownSsn = ["783", "64", "9201"].join("-");
const text = (value: string) => Buffer.from(value);

describe("public repository privacy check", () => {
  it("refuses private documents, environment and credential files, even inside fixtures", () => {
    for (const path of ["roster.csv", "staff.xlsx", "packet.pdf", "tests/support/fixtures/new.pdf", "tests/roster.tsv"]) {
      assert.deepEqual(inspectTrackedFile(path, text("")), [{ path, rule: "private-document" }]);
    }
    for (const path of [".env", ".env.local", "nested/.env.example"]) {
      assert.deepEqual(inspectTrackedFile(path, text("")), [{ path, rule: "environment-file" }]);
    }
    for (const path of ["credentials.json", "config/secrets.json", ".netrc", ".git-credentials", "config/test-data.local.json", "keys/operator.pem", ".aws/config", "tests/credentials/token.txt"]) {
      assert.deepEqual(inspectTrackedFile(path, text("")), [{ path, rule: "credential-file" }]);
    }
    assert.deepEqual(inspectTrackedFile(".local-private/note.txt", text("")), [{ path: ".local-private/note.txt", rule: "private-directory" }]);
  });

  it("allows only named binary fixtures and the root environment example", () => {
    for (const path of ["tests/support/fixtures/documents/synthetic-sample.pdf", "tests/support/fixtures/spreadsheet/color-filtered-roster.xlsx", "tests/support/helpers/dashboard/color-filtered-roster.xlsx"]) {
      assert.deepEqual(inspectTrackedFile(path, readFileSync(new URL(`../../../${path}`, import.meta.url))), []);
      assert.deepEqual(inspectTrackedFile(path, Buffer.from([0, 1, 2])), [{ path, rule: "private-document" }]);
    }
    assert.deepEqual(inspectTrackedFile(".env.example", text("placeholder")), []);
  });

  it("recognizes current PNG and WebP assets by signature", () => {
    for (const path of ["docs/images/relay-dashboard.png", "src/dashboard/assets/ocr/detect-test-1.webp"]) {
      assert.deepEqual(inspectTrackedFile(path, readFileSync(new URL(`../../../${path}`, import.meta.url))), []);
    }
    assert.deepEqual(inspectTrackedFile("note.webp", Buffer.from([0xd2, 0xc9, 0xc6, 0xc6, 0, 0, 0, 0, 0xd7, 0xc5, 0xc2, 0xd0])), [{ path: "note.webp", rule: "unsupported-text-encoding" }]);
  });

  it("checks embedded text in real images and image signatures followed by sensitive values", () => {
    const labeledEid = ["92", "823", "741"].join("");
    const credential = ["ghp_", "c".repeat(36)].join("");
    const payload = text(`\n'eid': '${labeledEid}'\nSSN: ${unknownSsn}\n${credential}\0`);
    for (const path of ["docs/images/relay-dashboard.png", "src/dashboard/assets/ocr/detect-test-1.webp"]) {
      const asset = readFileSync(new URL(`../../../${path}`, import.meta.url));
      for (const prefix of [asset, asset.subarray(0, path.endsWith(".png") ? 8 : 12)]) {
        assert.deepEqual(inspectTrackedFile(path, Buffer.concat([prefix, payload])), [
          { path, rule: "credential-value" }, { path, rule: "eid" }, { path, rule: "ssn" },
        ]);
      }
    }
  });

  it("blocks standalone credential data files while admitting similarly named source modules", () => {
    for (const path of ["credentials.txt", ".credentials", "config/secrets.ini", "config/.tokens", "auth.cfg", ".secrets.json", "credentials.xml"]) {
      assert.deepEqual(inspectTrackedFile(path, text("")), [{ path, rule: "credential-file" }]);
    }
    for (const path of ["src/auth.ts", "src/secrets.ts", "src/credentials.ts", "docs/auth.md", "src/credential-store.ts"]) {
      assert.deepEqual(inspectTrackedFile(path, text("")), []);
    }
  });

  it("pins public npm configuration and rejects a replacement at the same path", () => {
    assert.deepEqual(inspectTrackedFile(".npmrc", readFileSync(new URL("../../../.npmrc", import.meta.url))), []);
    assert.deepEqual(inspectTrackedFile(".npmrc", text("changed")), [{ path: ".npmrc", rule: "credential-file" }]);
  });

  it("detects employee ID labels, bare UCPath IDs and both SSN forms", () => {
    for (const label of ["EID", "employeeId", "employee_id", "employee ID", "Empl ID", "emplid"]) {
      assert.deepEqual(inspectTrackedFile("note.txt", text(`${label}: '${unknownEid}'`)), [{ path: "note.txt", rule: "eid" }]);
    }
    assert.deepEqual(inspectTrackedFile("note.txt", text(unknownEid)), [{ path: "note.txt", rule: "eid" }]);
    for (const value of [unknownSsn, `ssn: "${unknownSsn.replaceAll("-", "")}"`, `Social Security Number: ${unknownSsn.replaceAll("-", "")}`]) {
      assert.deepEqual(inspectTrackedFile("note.txt", text(value)), [{ path: "note.txt", rule: "ssn" }]);
    }
  });

  it("detects quoted and adjacent HTML labels independently of the bare UCPath pattern", () => {
    const labeledEid = ["92", "823", "741"].join("");
    for (const label of ["EID", "employeeId", "employee_id", "employee ID", "Empl ID", "emplid"]) {
      for (const value of [`${label}: '${labeledEid}'`, `"${label}": "${labeledEid}"`, `'${label}': '${labeledEid}'`, `<td>${label}</td><td>${labeledEid}</td>`, `<th>${label}</th>\n<td class="value">${labeledEid}</td>`]) {
        assert.deepEqual(inspectTrackedFile("note.txt", text(value)), [{ path: "note.txt", rule: "eid" }]);
      }
    }
    assert.deepEqual(inspectTrackedFile("note.txt", text(labeledEid)), []);
    for (const value of [`'ssn': '${unknownSsn.replaceAll("-", "")}'`, `<td>SSN</td><td>${unknownSsn.replaceAll("-", "")}</td>`]) {
      assert.deepEqual(inspectTrackedFile("note.txt", text(value)), [{ path: "note.txt", rule: "ssn" }]);
    }
  });

  it("checks UTF-8 with NUL and UTF-16 in either byte order for identifiers and credentials", () => {
    const labeledEid = ["92", "823", "741"].join("");
    const credential = ["ghp_", "b".repeat(36)].join("");
    const note = `Employee ID: ${labeledEid}\nSSN: ${unknownSsn}\n${credential}\nRésumé`;
    const littleEndian = Buffer.from(note, "utf16le");
    const bigEndian = Buffer.from(littleEndian).swap16();
    for (const content of [
      text(note), text(`${note}\0`), text(note.replaceAll("", "\0")),
      littleEndian, bigEndian,
      Buffer.concat([Buffer.from([0xff, 0xfe]), littleEndian]),
      Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian]),
    ]) {
      for (const path of ["note.txt", "note.png", "note.webp"]) {
        assert.deepEqual(inspectTrackedFile(path, content), [
          { path, rule: "credential-value" }, { path, rule: "eid" }, { path, rule: "ssn" },
        ]);
      }
    }
    for (const content of [Buffer.from([0xff, 0x81, 0x80]), Buffer.from([0xff, 0xfe, 0x00])]) {
      assert.deepEqual(inspectTrackedFile("note.txt", content), [{ path: "note.txt", rule: "unsupported-text-encoding" }]);
    }
  });

  it("requires both an approved synthetic token and a synthetic location", () => {
    const knownSynthetic = ["1000", "0001"].join("");
    assert.deepEqual(inspectTrackedFile("tests/new.test.ts", text(knownSynthetic)), []);
    assert.deepEqual(inspectTrackedFile("src/models/systems/crm/read-onboarding-dates.ts", text(knownSynthetic)), []);
    assert.deepEqual(inspectTrackedFile("new-note.md", text(knownSynthetic)), [{ path: "new-note.md", rule: "eid" }]);
    for (const path of ["tests/new.test.ts", "src/models/systems/crm/read-onboarding-dates.ts", "tests/support/fixtures/documents/synthetic-sample.pdf"]) {
      assert.ok(inspectTrackedFile(path, text(`${unknownEid} ${unknownSsn}`)).some(({ rule }) => rule === "eid"));
      assert.ok(inspectTrackedFile(path, text(`${unknownEid} ${unknownSsn}`)).some(({ rule }) => rule === "ssn"));
    }
  });

  it("never lets synthetic allowances bypass credential detection", () => {
    const credential = ["ghp_", "a".repeat(36)].join("");
    for (const path of ["tests/new.test.ts", ".env.example", "src/models/systems/crm/read-onboarding-dates.ts"]) {
      assert.deepEqual(inspectTrackedFile(path, text(credential)), [{ path, rule: "credential-value" }]);
    }
    for (const path of ["tests/architecture/runs/evidence-receipt.test.ts", "tests/rules/redaction/redaction.test.ts"]) {
      const existing = readFileSync(new URL(`../../../${path}`, import.meta.url));
      assert.deepEqual(inspectTrackedFile(path, existing), []);
      assert.ok(inspectTrackedFile(path, Buffer.concat([existing, text(credential)])).some(({ rule }) => rule === "credential-value"));
    }
    const key = ["-----BEGIN PRIVATE", " KEY-----\nsecret\n-----END PRIVATE", " KEY-----"].join("");
    assert.deepEqual(inspectTrackedFile("key.txt", text(key)), [{ path: "key.txt", rule: "credential-value" }]);
  });

  it("fails closed without forwarding Git diagnostics when the index cannot be read", () => {
    const cwd = mkdtempSync(join(tmpdir(), "relay-privacy-unreadable-"));
    try {
      const result = spawnSync(process.execPath, ["--import", testProcessImport(), fileURLToPath(new URL("../../../scripts/verify/privacy.ts", import.meta.url))], { cwd, encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "Privacy check failed: scan-error.\n");
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it("reads staged blobs, ignores untracked files, and returns deterministic value-free CLI failures", () => {
    const cwd = mkdtempSync(join(tmpdir(), "relay-privacy-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd });
      for (const path of ["z.txt", "a/note.txt"]) {
        mkdirSync(dirname(join(cwd, path)), { recursive: true });
        writeFileSync(join(cwd, path), `${unknownEid}\n${unknownSsn}`);
      }
      execFileSync("git", ["add", "--", "."], { cwd });
      writeFileSync(join(cwd, "z.txt"), "clean worktree replacement");
      writeFileSync(join(cwd, "untracked.csv"), unknownEid);
      const findings = scanTrackedFiles(cwd);
      assert.deepEqual(findings, [
        { path: "a/note.txt", rule: "eid" }, { path: "a/note.txt", rule: "ssn" },
        { path: "z.txt", rule: "eid" }, { path: "z.txt", rule: "ssn" },
      ]);
      const result = spawnSync(process.execPath, ["--import", testProcessImport(), fileURLToPath(new URL("../../../scripts/verify/privacy.ts", import.meta.url))], { cwd, encoding: "utf8" });
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stderr, findings.map(({ path, rule }) => `${JSON.stringify(path)}: ${rule}\n`).join(""));
      assert.ok(!`${result.stdout}${result.stderr}`.includes(unknownEid));
      assert.ok(!`${result.stdout}${result.stderr}`.includes(unknownSsn));
      execFileSync("git", ["add", "--", "z.txt"], { cwd });
      assert.deepEqual(scanTrackedFiles(cwd), findings.slice(0, 2));
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
