/**
 * D294 — mobile document capture is retired.
 *
 * This guard is deliberately narrower than a search for “capture”: diagnostic
 * bundle screenshots, run-detail captures, and Archive resources remain
 * supported evidence surfaces. It rejects only the retired phone product's
 * page, routes, commands, configuration, session authority, and repositories.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, it } from "vitest";
import { REPO_ROOT, walkFiles } from "./helpers/guard-files.js";

const RETIRED_PATHS = [
  "src/dashboard/capture.html",
  "src/dashboard/phone",
  "src/dashboard/state/use-capture-session.ts",
  "src/dashboard/surfaces/capture-session-model.ts",
  "src/dashboard/surfaces/capture-session.tsx",
  "src/dashboard/surfaces/capture-start.tsx",
  "src/core/capture-intake-handoff.ts",
  "src/domain/capture-intake.ts",
  "src/domain/capture-operator.ts",
  "src/domain/capture-surface.ts",
  "src/domain/capture.ts",
  "src/domain/qr-code.ts",
  "src/infra/capture",
  "src/server/capture",
  "src/server/dashboard/commands/capture-service.ts",
] as const;

const RETIRED_TOKENS: readonly Readonly<{ readonly description: string; readonly pattern: RegExp }>[] = [
  { description: "phone capture route", pattern: /\/api\/v1\/capture(?:\/|["'`])/u },
  { description: "phone capture page", pattern: /capture\.html/u },
  { description: "phone capture command or wire", pattern: /\b(?:CAPTURE_(?:PHONE|TOKEN|INTAKE)|Capture(?:Session|Service|Intake|Operator)|capture(?:Phone|Session|Intake|Operator|Token))\b/u },
  { description: "phone capture repository", pattern: /\b(?:captureSessions|captureFinalizationOutboxes|capturePhotoOrder)\b/u },
  { description: "phone capture configuration", pattern: /\bcapture(?:Ingress|Public|Ttl|Token|Session)/u },
];

/** Config files may spell the retired surface as an environment key. */
const RETIRED_CONFIG_TOKENS: readonly Readonly<{ readonly description: string; readonly pattern: RegExp }>[] = [
  ...RETIRED_TOKENS,
  { description: "phone capture configuration", pattern: /\bCAPTURE_(?:PHONE|TOKEN|INTAKE)_[A-Z0-9_]*\b/u },
];

function sourceFiles(root: string): readonly string[] {
  return walkFiles(join(root, "src"));
}

export function phoneCaptureRetirementViolations(root: string): readonly string[] {
  const violations: string[] = [];
  for (const path of RETIRED_PATHS) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) continue;
    if (statSync(absolute).isDirectory() && readdirSync(absolute).length === 0) continue;
    violations.push(`${path}: retired phone-capture path still exists`);
  }
  for (const file of sourceFiles(root)) {
    const source = readFileSync(file, "utf8");
    for (const token of RETIRED_TOKENS) {
      if (token.pattern.test(source)) {
        violations.push(`${relative(root, file).replaceAll("\\", "/")}: contains ${token.description}`);
      }
    }
  }
  for (const path of [".env.example", "vite.dashboard.config.ts", "vitest.config.ts"]) {
    const file = join(root, path);
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const token of RETIRED_CONFIG_TOKENS) {
      if (token.pattern.test(source)) violations.push(`${path}: contains ${token.description}`);
    }
  }
  return violations;
}

function writeFixture(root: string, path: string, content: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

describe("D294 phone capture retirement", () => {
  it("keeps mobile document capture absent while diagnostic and Archive captures remain", () => {
    assert.deepEqual(phoneCaptureRetirementViolations(REPO_ROOT), []);
    assert.ok(existsSync(join(REPO_ROOT, "src/dashboard/surfaces/run-captures.tsx")));
    assert.ok(existsSync(join(REPO_ROOT, "src/backend/runs/dashboard/queries/archive.ts")));
  });

  it("fails on a returning page, route, command, config, or repository", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-phone-capture-retirement-"));
    try {
      writeFixture(root, "src/dashboard/capture.html", "<main>phone</main>");
      writeFixture(root, "src/server/routes.ts", 'app.get("/api/v1/capture/phone/session", handler);');
      writeFixture(root, "src/domain/commands.ts", "const family = captureSession;");
      writeFixture(root, "src/infra/sqlite/repositories.ts", "const sessions = authority.captureSessions;");
      writeFixture(root, ".env.example", "CAPTURE_PHONE_HOST=phone.example");
      const violations = phoneCaptureRetirementViolations(root).join("\n");
      assert.match(violations, /capture\.html/u);
      assert.match(violations, /phone capture route/u);
      assert.match(violations, /phone capture command or wire/u);
      assert.match(violations, /phone capture repository/u);
      assert.match(violations, /phone capture configuration/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
