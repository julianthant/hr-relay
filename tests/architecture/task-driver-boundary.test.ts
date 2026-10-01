import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, it } from "vitest";
import { auditTaskDriverBoundary } from "./helpers/ui-boundary-audit.js";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

describe("task to system-driver boundary", () => {
  it("keeps Playwright and raw locator operations inside driver/session owners", () => {
    assert.deepEqual(auditTaskDriverBoundary(REPO_ROOT), []);
  });

  it("rejects raw browser control from a backend transport", () => {
    const root = resolve(tmpdir(), `hrauto-backend-driver-${String(process.pid)}-${String(Date.now())}`);
    const path = resolve(root, "src/backend/transports/dashboard/routes/bad.ts");
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, 'import { chromium } from "playwright"; export async function bad(page: { newPage(): unknown }) { return [chromium, page.newPage()]; }\n');
      const issues = auditTaskDriverBoundary(root).join("\n");
      assert.match(issues, /Playwright import/u);
      assert.match(issues, /newPage/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("catches dynamic imports, newPage/$ bypasses, and an indirect private-driver import", () => {
    const root = resolve(tmpdir(), `hrauto-ui-boundary-${String(process.pid)}-${String(Date.now())}`);
    const path = resolve(root, "src/backend/systems/ucpath/tasks/bad.ts");
    const helper = resolve(root, "src/backend/systems/ucpath/helper.ts");
    const driver = resolve(root, "src/backend/systems/ucpath/driver/interpreter.ts");
    try {
      mkdirSync(dirname(path), { recursive: true });
      mkdirSync(dirname(driver), { recursive: true });
      writeFileSync(
        path,
        'import { helper } from "../helper.js";\nexport async function bad(context: { newPage(): Promise<{ $(value: string): unknown }> }) { const api = await import("playwright"); const page = await context["newPage"](); page.$("#raw"); return [api, helper]; }\n',
      );
      writeFileSync(helper, 'export { helper } from "./driver/interpreter.js";\n');
      writeFileSync(driver, "export const helper = true;\n");
      const issues = auditTaskDriverBoundary(root).join("\n");
      assert.match(issues, /dynamic Playwright import/);
      assert.match(issues, /newPage/);
      assert.match(issues, /\.\$/);
      assert.match(issues, /import graph reaches private raw-browser owner/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still fences tasks off from the session-factory raw-browser family", () => {
    // Widening the owner set to `src/backend/runtime/browser/**` must not make it
    // reachable: a task that imports the factory (directly or through a
    // helper) is the same ownership bypass as importing a private driver.
    const root = resolve(tmpdir(), `hrauto-ui-factory-${String(process.pid)}-${String(Date.now())}`);
    const task = resolve(root, "src/backend/systems/ucpath/tasks/bad.ts");
    const helper = resolve(root, "src/backend/systems/ucpath/helper.ts");
    const factory = resolve(root, "src/backend/runtime/browser/browser-session-factory.ts");
    const shared = resolve(root, "src/backend/systems/browser-shared/action-notes.ts");
    try {
      mkdirSync(dirname(task), { recursive: true });
      mkdirSync(dirname(factory), { recursive: true });
      writeFileSync(task, 'import { open } from "../helper.js";\nexport const bad = open;\n');
      writeFileSync(helper, 'export { open } from "../../backend/runtime/browser/browser-session-factory.js";\n');
      writeFileSync(factory, 'import { chromium } from "playwright";\nexport const open = chromium;\n');
      const issues = auditTaskDriverBoundary(root).join("\n");
      assert.match(issues, /import graph reaches private raw-browser owner src\/backend\/runtime\/browser/);
      assert.doesNotMatch(
        issues,
        /browser-session-factory\.ts: Playwright import/,
        "the factory itself is a sanctioned owner",
      );
      mkdirSync(dirname(shared), { recursive: true });
      writeFileSync(shared, 'import { type Page } from "playwright";\nexport const open = (page: Page) => page;\n');
      writeFileSync(helper, 'export { open } from "../../backend/systems/browser-shared/action-notes.js";\n');
      const sharedIssues = auditTaskDriverBoundary(root).join("\n");
      assert.match(sharedIssues, /import graph reaches private raw-browser owner src\/backend\/systems\/browser-shared/);
      assert.doesNotMatch(sharedIssues, /action-notes\.ts: Playwright import/, "shared browser adapter is a sanctioned owner");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("catches premature capability forgery and commit implementations", () => {
    const root = resolve(tmpdir(), `hrauto-ui-capability-${String(process.pid)}-${String(Date.now())}`);
    const path = resolve(root, "src/backend/systems/ucpath/driver/bad.ts");
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "const token = {} as MutationCapability;\nexport const driver = { commit: async () => token };\n");
      const issues = auditTaskDriverBoundary(root).join("\n");
      assert.match(issues, /cannot be minted by type assertion/);
      assert.match(issues, /a commit implementation must live in a store driver owner/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

it("parses JSX templates while retaining raw browser calls embedded in JSX", () => {
  const root = resolve(tmpdir(), `hrauto-ui-jsx-${String(process.pid)}-${String(Date.now())}`);
  const path = resolve(root, "src/dashboard/view.tsx");
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'export const View = ({ key }: { key: string }) => <section title={`providers.${key}`} />;');
    assert.deepEqual(auditTaskDriverBoundary(root), []);
    writeFileSync(path, 'export const View = ({ page }: { page: { $(selector: string): unknown } }) => <section>{page.$("#raw")}</section>;');
    assert.match(auditTaskDriverBoundary(root).join("\n"), /raw browser member \.\$/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("requires declared installation locator ownership and preserves raw aliases, computed methods and any refusals", () => {
  const root = resolve(tmpdir(), `hrauto-ui-locator-${String(process.pid)}-${String(Date.now())}`);
  const path = resolve(root, "src/core/reader.ts");
  const owner = resolve(root, "src/infra/runtime-control/installation.ts");
  try {
    mkdirSync(dirname(path), { recursive: true }); mkdirSync(dirname(owner), { recursive: true });
    writeFileSync(owner, 'export type RuntimeLocator = { installationId: string; generation: number; stateRoot: string; artifactRoot: string };');
    writeFileSync(path, 'import type { RuntimeLocator } from "../infra/runtime-control/installation.js"; export function read(input: { locator: RuntimeLocator }) { const locator = input.locator; const context = { locator }; return context.locator; }');
    assert.deepEqual(auditTaskDriverBoundary(root), []);
    writeFileSync(path, 'import type { RuntimeLocator as InstallationRecord } from "../infra/runtime-control/installation.js"; type InstallationLease = Readonly<{ locator: InstallationRecord }>; class RuntimeAdmission { constructor(private lease: InstallationLease) {} get locator(): InstallationRecord { return this.lease.locator; } readInstallationContext() { const locator = this.locator; return { locator }; } } export const read = (admission: RuntimeAdmission) => admission.readInstallationContext().locator;');
    assert.deepEqual(auditTaskDriverBoundary(root), []);
    writeFileSync(path, 'import type { RuntimeLocator } from "../infra/runtime-control/installation.js"; export function read(input: { locator: RuntimeLocator }) { const { locator } = input; return locator; }');
    assert.deepEqual(auditTaskDriverBoundary(root), []);
    for (const source of [
      'type RuntimeLocator = { installationId: string; generation: number; stateRoot: string; artifactRoot: string }; export const read = (input: { locator: RuntimeLocator }) => input.locator;',
      'export const read = (page: { locator(selector: string): unknown }) => page.locator;',
      'export function read(page: { locator(selector: string): unknown }) { const { locator: extracted } = page; return extracted("#raw"); }',
      'export const read = (page: { locator(selector: string): unknown }) => page["locator"]("#raw");',
      'export const read = (input: any) => input.locator;',
      'export const read = (input: unknown) => input.locator;',
      'export const read = () => missing.locator;',
      'export const read = (input: { locator: { installationId: string; generation: number; stateRoot: string; artifactRoot: string } }) => input.locator;',
      'import type { RuntimeLocator } from "../infra/runtime-control/installation.js"; export const read = (input: { locator: RuntimeLocator & (() => void) }) => input.locator;',
    ]) { writeFileSync(path, source); assert.match(auditTaskDriverBoundary(root).join("\n"), /raw browser member \.locator|computed raw browser member locator|extracted raw browser member locator/u); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("allows only the declared durable archive callback and rejects browser, any, and fake annotated commits", () => {
  const root = resolve(tmpdir(), `hrauto-ui-commit-${String(process.pid)}-${String(Date.now())}`);
  const path = resolve(root, "src/core/kernel.ts");
  try {
    mkdirSync(dirname(path), { recursive: true });
    mkdirSync(resolve(root, "src/backend/runs"), { recursive: true });
    writeFileSync(resolve(root, "src/backend/runs/command-application.ts"), 'export interface CommandApplication { commit?: () => void }');
    writeFileSync(resolve(root, "src/core/archive-terminal-runs.ts"), 'export function publishManualArchive(input: unknown): void { void input; }');
    const imports = 'import type { CommandApplication } from "../backend/runs/command-application.js"; import { publishManualArchive } from "./archive-terminal-runs.js";';
    writeFileSync(path, imports + 'export function prepare(): CommandApplication { return { commit: () => publishManualArchive("verified") }; }');
    assert.deepEqual(auditTaskDriverBoundary(root), []);
    for (const source of [
      imports + 'export function prepare(page: { click(): unknown }): CommandApplication { return { commit: () => publishManualArchive(page.click()) }; }',
      imports + 'export function prepare(input: { nested: { click(): unknown } }): CommandApplication { return { commit: () => publishManualArchive(input) }; }',
      imports + 'export function prepare(page: { locator(selector: string): unknown }): CommandApplication { return { commit: () => publishManualArchive(page) }; }',
      imports + 'export function prepare(page: { click(): unknown }): CommandApplication { return { commit: () => page.click() }; }',
      imports + 'export function prepare(): { commit?: () => void } { return { commit: () => publishManualArchive("unbound") }; }',
      imports + 'export function prepare(input: any): CommandApplication { return { commit: () => publishManualArchive(input) }; }',
      'interface CommandApplication { commit?: () => void } function publishManualArchive(input: string): void {} export function prepare(): CommandApplication { return { commit: () => publishManualArchive("fake") }; }',
    ]) { writeFileSync(path, source); assert.match(auditTaskDriverBoundary(root).join("\n"), /a commit implementation must live/u); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});


it("preserves capability-validating driver commits while rejecting raw methods in runtime-control", () => {
  const root = resolve(tmpdir(), `hrauto-ui-owner-${String(process.pid)}-${String(Date.now())}`);
  const driver = resolve(root, "src/backend/systems/ucpath/driver/commit.ts");
  const runtime = resolve(root, "src/infra/runtime-control/reader.ts");
  try {
    mkdirSync(dirname(driver), { recursive: true }); mkdirSync(dirname(runtime), { recursive: true });
    writeFileSync(driver, 'declare function assertMintedMutationCapability(input: unknown): void; export const driver = { commit(input: unknown) { assertMintedMutationCapability(input); } };');
    assert.deepEqual(auditTaskDriverBoundary(root), []);
    writeFileSync(runtime, 'export const read = (page: { locator(selector: string): unknown }) => page.locator("#raw");');
    assert.match(auditTaskDriverBoundary(root).join("\n"), /runtime-control\/reader\.ts: raw browser member \.locator/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
