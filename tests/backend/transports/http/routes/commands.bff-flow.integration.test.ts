import { EditableSettingsWireSchema } from "../../../../../src/models/dashboard/settings-editor.js";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach,describe,expect,it,vi } from "vitest";
import { deriveBulkChildCommandId } from "../../../../../src/backend/runs/commands/command-service.js";
import { readSettings } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../../src/models/config/protected-settings.js";
import { SETTINGS_SCHEMA_HASH,deriveSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { UUID_4 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../../../../support/helpers/phase1f-executor-harness.js";

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  it("refuses a foreign-origin settings command before any authority effect", async () => {
    const h = await harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b79";
    const patch = { "browser.headless": { set: false } } as const;
    const command = {
      commandId,
      requestedAt: "2020-01-01T00:00:00.000Z",
      requestedBy: "forged-actor",
      source: "hostile-page",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    };
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: {
        host: "localhost",
        origin: "https://hostile.example",
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    });

    assert.equal(response.status, 403);
    assert.equal((await json(response)).code, "OPERATOR_MUTATION_ORIGIN_REFUSED");
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it.each([
    ["missing Origin", { host: "localhost", "content-type": "application/json" }, 403, "OPERATOR_MUTATION_ORIGIN_REFUSED"],
    ["foreign Origin", { ...OPERATOR_JSON_HEADERS, origin: "https://hostile.example" }, 403, "OPERATOR_MUTATION_ORIGIN_REFUSED"],
    ["text/plain", { ...OPERATOR_JSON_HEADERS, "content-type": "text/plain" }, 415, "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED"],
  ] as const)("refuses %s without consuming either command body or changing authority", async (_label, headers, status, code) => {
    const h = await harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b74";
    const bulkCommandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b73";
    const patch = { "browser.headless": { set: false } } as const;
    h.database.authority.runs.enqueue(personLookupQueuedRun({ runId: RUN_ID }));
    const snapshot = () => ({
      settings: settingsAuthoritySnapshot(h, commandId),
      run: h.database.authority.runs.get(RUN_ID),
      parent: h.database.authority.commands.getBulk(bulkCommandId),
      child: settingsAuthoritySnapshot(h, deriveBulkChildCommandId(bulkCommandId, RUN_ID)),
    });
    const before = snapshot();
    for (const [path, body] of [
      ["/api/v1/commands", {
        commandId, family: "settings", type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
      }],
      ["/api/v1/commands/bulk", {
        commandId, bulkCommandId, family: "run", type: "cancel", mode: "best-effort",
        targets: [{ runId: RUN_ID, expectedVersion: 1 }],
      }],
    ] as const) {
      // Pass this exact Request to Hono: spies wrap the real raw-body methods,
      // and valid JSON makes early consumption observable even if refusal still wins.
      const request = new Request(`http://localhost${path}`, {
        method: "POST", headers, body: JSON.stringify(body),
      });
      const reads = (["json", "text", "arrayBuffer", "blob", "formData"] as const)
        .map((method) => vi.spyOn(request, method));

      const response = await h.app.request(request);

      assert.equal(response.status, status, path);
      assert.equal((await json(response)).code, code, path);
      for (const read of reads) expect(read).not.toHaveBeenCalled();
      assert.equal(request.bodyUsed, false, path);
      assert.deepEqual(snapshot(), before, `${path} has zero authority effects`);
    }
  });

  it.each([
    ["unknown envelope field", { extra: true }, { extra: true }],
    ["unknown target field", { target: { expectedRevision: 1, extra: true } }, { targets: [{ runId: RUN_ID, expectedVersion: 1, extra: true }] }],
    ["wrong target type", { target: { expectedRevision: "1" } }, { targets: [{ runId: RUN_ID, expectedVersion: "1" }] }],
    ["wrong action", { type: "cancel" }, { type: "apply-settings" }],
    ["wrong command id", { commandId: "invalid" }, { bulkCommandId: "invalid" }],
    ["unknown payload field", { payload: {
      settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      patchFingerprint: "a".repeat(64),
      patch: { "browser.headless": { set: false } },
      extra: true,
    } }, { targets: [] }],
  ] as const)("refuses %s through strict command ingress with zero effects", async (_label, singleChange, bulkChange) => {
    const h = await harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b72";
    const bulkCommandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b71";
    const patch = { "browser.headless": { set: false } } as const;
    h.database.authority.runs.enqueue(personLookupQueuedRun({ runId: RUN_ID }));
    const snapshot = () => ({
      settings: settingsAuthoritySnapshot(h, commandId),
      run: h.database.authority.runs.get(RUN_ID),
      parent: h.database.authority.commands.getBulk(bulkCommandId),
      child: settingsAuthoritySnapshot(h, deriveBulkChildCommandId(bulkCommandId, RUN_ID)),
    });
    const before = snapshot();
    const beforeFault = faultAuthoritySnapshot(h);
    const single = {
      commandId, family: "settings", type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
    };
    const bulk = {
      commandId, bulkCommandId, family: "run", type: "cancel", mode: "best-effort",
      targets: [{ runId: RUN_ID, expectedVersion: 1 }],
    };
    for (const [path, body, status, code] of [
      ["/api/v1/commands", { ...single, ...singleChange }, 400, "SCHEMA_INVALID"],
      ["/api/v1/commands/bulk", { ...bulk, ...bulkChange }, 422, "schema-mismatch"],
    ] as const) {
      const response = await h.app.request(path, {
        method: "POST", headers: OPERATOR_JSON_HEADERS, body: JSON.stringify(body),
      });
      assert.equal(response.status, status, path);
      assert.equal((await json(response)).code, code, path);
      const after = snapshot();
      assert.deepEqual({ ...after, settings: { ...after.settings, authorityGeneration: before.settings.authorityGeneration },
        child: { ...after.child, authorityGeneration: before.child.authorityGeneration } }, before, `${path} has zero command effects`);
      assertHttpFaultOnly(h, beforeFault, 1);
    }
  });

  it("returns not-editable for a protected key submitted through ordinary settings before authority access", async () => {
    let journalReads = 0;
    const h = await harness({
      commandJournal: (real) => ({
        get(commandId) {
          journalReads += 1;
          return real.get(commandId);
        },
      }),
    });
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b69";
    const patch = { ucpathPassword: { set: "never-return-this-value" } };
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId,
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: rawSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });

    assert.equal(response.status, 422);
    assert.deepEqual(await json(response), {
      state: "rejected",
      commandId,
      code: "not-editable",
      message: "not-editable { key: ucpathPassword }",
    });
    assert.equal(journalReads, 0);
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it.each([
    ["unknown ordinary", { "unknown.setting": { clear: true } }, "unknown.setting", "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b6a"],
    ["deployment-owned ordinary", { "paths.stateRoot": { set: "/tmp/foreign-root" } }, "paths.stateRoot", "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b6b"],
  ] as const)("returns not-editable for %s before authority access", async (_label, patch, key, commandId) => {
    let journalReads = 0;
    const h = await harness({
      commandJournal: (real) => ({
        get(commandId) {
          journalReads += 1;
          return real.get(commandId);
        },
      }),
    });
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId,
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: rawSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });

    assert.equal(response.status, 422);
    assert.deepEqual(await json(response), {
      state: "rejected", commandId, code: "not-editable", message: `not-editable { key: ${key} }`,
    });
    assert.equal(journalReads, 0);
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it.each([
    { label: "partial display set", seed: {}, patch: { "display.screenWidth": { set: 1600 } }, missing: ["display.screenHeight"] },
    { label: "partial display clear", seed: { "display.screenWidth": { set: 1600 }, "display.screenHeight": { set: 900 } }, patch: { "display.screenHeight": { clear: true } }, missing: ["display.screenHeight"] },
    { label: "partial annual dates clear", seed: { "annualDates.FY2027.jobEndDate": { set: "06/30/2027" }, "annualDates.FY2027.kronosDefaultEndDate": { set: "06/30/2027" }, "annualDates.FY2027.kronosDefaultStartDate": { set: "07/01/2026" } }, patch: { "annualDates.FY2027.jobEndDate": { clear: true } }, missing: ["annualDates.FY2027.jobEndDate"] },
  ])("returns cross-field-invalid for $label without durable effects", async ({ seed, patch, missing }) => {
    const h = await harness();
    const send = (commandId: string, expectedRevision: number, changes: unknown) => h.app.request("/api/v1/commands", {
      method: "POST", headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ commandId, family: "settings", type: "apply-settings", target: { expectedRevision },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: rawSettingsPatchFingerprint(changes), patch: changes } }),
    });
    const seeded = Object.keys(seed).length > 0;
    if (seeded) assert.equal((await send("00000000-0000-4000-8000-000000000901", 1, seed)).status, 200);
    const commandId = "00000000-0000-4000-8000-000000000902";
    const before = settingsAuthoritySnapshot(h, commandId);
    const response = await send(commandId, seeded ? 2 : 1, patch);
    assert.equal(response.status, 422);
    assert.deepEqual(await json(response), { state: "rejected", commandId, code: "cross-field-invalid",
      message: `cross-field-invalid { keys: ${missing.join(", ")} }` });
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it("accepts a current-year job-end date without Kronos fields", async () => {
    const h = await harness();
    const path = `annualDates.FY${String(h.clock.fiscalYear())}.jobEndDate`;
    const patch = { [path]: { set: "06/30/2027" } };
    const response = await h.app.request("/api/v1/commands", {
      method: "POST", headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ commandId: "00000000-0000-4000-8000-000000000903", family: "settings", type: "apply-settings",
        target: { expectedRevision: 1 }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: rawSettingsPatchFingerprint(patch), patch } }),
    });
    assert.equal(response.status, 200);
    const record = h.database.withAuthorityTransaction(repositories => readSettings(repositories));
    assert.equal(record.settingsSchemaHash, SETTINGS_SCHEMA_HASH);
    assert.deepEqual(record.settings.annualDates, { [`FY${String(h.clock.fiscalYear())}`]: { jobEndDate: "06/30/2027" } });
  });

  it("refuses invalid or unauthorized requests before protected retry identity and journal reads", async () => {
    let reads = 0;
    const forbiddenRead = () => { reads += 1; throw new Error("forbidden request-only authority read"); };
    const h = await harness({ protectedCommandAcceptedAt: forbiddenRead, commandJournal: () => ({ get: forbiddenRead }) });
    const commandId = "00000000-0000-4000-8000-000000000907";
    const request = { commandId, family: "settings", type: "apply-protected-settings", target: { expectedRevision: 1 },
      payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: "00000000-0000-4000-8000-000000000908", entries: { ucpathPassword: { set: "synthetic-validation-only" } } } };
    const before = settingsAuthoritySnapshot(h, commandId);
    for (const { body, headers, status } of [
      { body: { ...request, payload: { ...request.payload, protectedSchemaHash: "0".repeat(64) } }, headers: OPERATOR_JSON_HEADERS, status: 422 },
      { body: { ...request, payload: { ...request.payload, entries: { ucpathPassword: { set: 42 } } } }, headers: OPERATOR_JSON_HEADERS, status: 422 },
      { body: request, headers: { ...OPERATOR_JSON_HEADERS, origin: "https://foreign.invalid" }, status: 403 },
    ]) {
      const response = await h.app.request("/api/v1/commands", { method: "POST", headers, body: JSON.stringify(body) });
      assert.equal(response.status, status);
    }
    assert.equal(reads, 0);
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it.each(["set", "clear"] as const)("settles an uncertain credential %s audit through HTTP after the server clock advances", async (operation) => {
    const h = await harness();
    const current = EditableSettingsWireSchema.parse(await json(await h.app.request("/api/v1/settings/editable"))).protectedSettings;
    assert.equal(current.state, "available");
    if (current.state !== "available") throw new Error("protected-settings-unavailable");
    const revision = current.readback.revision;
    const commandId = "00000000-0000-4000-8000-000000000903";
    const request = { commandId, family: "settings", type: "apply-protected-settings", target: { expectedRevision: revision + (operation === "clear" ? 1 : 0) },
      payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: "00000000-0000-4000-8000-000000000904",
        entries: { ucpathPassword: operation === "clear" ? { clear: true } : { set: "synthetic-http-retry-private" } } } };
    const send = (body: unknown = request) => h.app.request("/api/v1/commands", { method: "POST", headers: OPERATOR_JSON_HEADERS, body: JSON.stringify(body) });
    if (operation === "clear") {
      const seed = { ...request, commandId: "00000000-0000-4000-8000-000000000905", target: { expectedRevision: revision },
        payload: { ...request.payload, writeId: "00000000-0000-4000-8000-000000000906", entries: { ucpathPassword: { set: "synthetic-http-retry-private" } } } };
      assert.equal((await send(seed)).status, 200);
      h.clock.advanceWall(1000);
    }
    const acceptedAt = h.clock.now().toISOString();
    const transaction = h.database.withAuthorityTransaction.bind(h.database);
    vi.spyOn(h.database, "withAuthorityTransaction").mockImplementationOnce((work) => transaction((repositories) => {
      work(repositories);
      throw new Error("injected-http-audit-failure");
    }));
    assert.equal((await send()).status, 500);
    const privatePath = join(h.stateRoot, "credentials", "protected.json");
    const bytes = readFileSync(privatePath);
    assert.equal(h.database.authority.commands.get(commandId), undefined);
    const beforeForeign = settingsAuthoritySnapshot(h, commandId);
    const foreign = await send({ commandId, family: "run", type: "cancel", target: { runId: UUID_4, expectedVersion: 1 } });
    assert.equal(foreign.status, 422);
    assert.equal((await json(foreign)).code, "command-divergent");
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), beforeForeign);
    h.clock.advanceWall(1000);
    const divergent = { ...request, payload: { ...request.payload, entries: { ucpathPassword: { set: "synthetic-http-retry-divergent" } } } };
    const denied = await json(await send(divergent));
    assert.equal(denied.code, "command-divergent");
    h.clock.advanceWall(1000);
    const retry = await send();
    assert.equal(retry.status, 200);
    assert.equal((await json(retry)).state, "applied");
    assert.equal((await json(await send())).state, "already-applied");
    assert.deepEqual(readFileSync(privatePath), bytes);
    const audit = h.database.authority.commandAudits.findByCommand(commandId); assert.ok(audit);
    assert.equal(audit.request.requestedAt, acceptedAt);
    assert.equal(JSON.stringify(audit).includes("synthetic-http-retry-private"), false);
  });

  it("returns invalid-value for an ordinary settings leaf before authority access", async () => {
    let journalReads = 0;
    const h = await harness({
      commandJournal: (real) => ({
        get(commandId) {
          journalReads += 1;
          return real.get(commandId);
        },
      }),
    });
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b66";
    const patch = { "browser.headless": { set: "not-a-boolean" } };
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId,
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: rawSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });

    assert.equal(response.status, 422);
    assert.deepEqual(await json(response), {
      state: "rejected",
      commandId,
      code: "invalid-value",
      message: "invalid-value { key: browser.headless }",
    });
    assert.equal(journalReads, 0);
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it("returns invalid-value for a protected settings leaf before authority access", async () => {
    let journalReads = 0;
    const h = await harness({
      commandJournal: (real) => ({
        get(commandId) {
          journalReads += 1;
          return real.get(commandId);
        },
      }),
    });
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b68";
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId,
        family: "settings",
        type: "apply-protected-settings",
        target: { expectedRevision: 1 },
        payload: {
          protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
          writeId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b67",
          entries: { sharepointOnboardingRosterUrl: { set: "protected-canary-not-a-url" } },
        },
      }),
    });

    assert.equal(response.status, 422);
    assert.deepEqual(await json(response), {
      state: "rejected",
      commandId,
      code: "invalid-value",
      message: "invalid-value { key: sharepointOnboardingRosterUrl }",
    });
    assert.equal(journalReads, 0);
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it.each([
    [
      "ordinary schema mismatch before an invalid leaf",
      "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b61",
      {
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: "0".repeat(64),
          patchFingerprint: rawSettingsPatchFingerprint({ "browser.headless": { set: "not-a-boolean" } }),
          patch: { "browser.headless": { set: "not-a-boolean" } },
        },
      },
      "schema-mismatch",
      "settings.json schema-mismatch",
    ],
    [
      "ordinary patch fingerprint mismatch before an invalid leaf",
      "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b62",
      {
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: "0".repeat(64),
          patch: { "browser.headless": { set: "not-a-boolean" } },
        },
      },
      "patch-fingerprint-mismatch",
      "patch-fingerprint-mismatch: settings patch fingerprint does not match its canonical value",
    ],
    [
      "protected schema mismatch before an invalid leaf",
      "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b63",
      {
        family: "settings",
        type: "apply-protected-settings",
        target: { expectedRevision: 1 },
        payload: {
          protectedSchemaHash: "0".repeat(64),
          writeId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b60",
          entries: { sharepointOnboardingRosterUrl: { set: "protected-canary-not-a-url" } },
        },
      },
      "schema-mismatch",
      "protected.json schema-mismatch",
    ],
  ] as const)("preserves %s at mixed-failure ingress", async (_label, commandId, request, code, message) => {
    let journalReads = 0;
    const h = await harness({
      commandJournal: (real) => ({
        get(commandId) {
          journalReads += 1;
          return real.get(commandId);
        },
      }),
    });
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ commandId, ...request }),
    });

    assert.equal(response.status, 422);
    assert.deepEqual(await json(response), {
      state: "rejected",
      commandId,
      code,
      message,
    });
    assert.equal(journalReads, 0);
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it("returns not-editable for an unknown protected settings key before authority access", async () => {
    let journalReads = 0;
    const h = await harness({
      commandJournal: (real) => ({
        get(commandId) {
          journalReads += 1;
          return real.get(commandId);
        },
      }),
    });
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b65";
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId,
        family: "settings",
        type: "apply-protected-settings",
        target: { expectedRevision: 1 },
        payload: {
          protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
          writeId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b64",
          entries: { unknownProtectedName: { clear: true } },
        },
      }),
    });

    assert.equal(response.status, 422);
    assert.deepEqual(await json(response), {
      state: "rejected",
      commandId,
      code: "not-editable",
      message: "not-editable { key: unknownProtectedName }",
    });
    assert.equal(journalReads, 0);
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it.each([[null], [[]], ["command"], [1]])("refuses a non-object command body (%j) without authority effects", async (body) => {
    const h = await harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b70";
    const before = settingsAuthoritySnapshot(h, commandId);
    const beforeFault = faultAuthoritySnapshot(h);
    for (const [path, status, code] of [
      ["/api/v1/commands", 400, "SCHEMA_INVALID"],
      ["/api/v1/commands/bulk", 422, "schema-mismatch"],
    ] as const) {
      const response = await h.app.request(path, {
        method: "POST", headers: OPERATOR_JSON_HEADERS, body: JSON.stringify(body),
      });
      assert.equal(response.status, status, path);
      assert.equal((await json(response)).code, code, path);
      assert.deepEqual({ ...settingsAuthoritySnapshot(h, commandId), authorityGeneration: before.authorityGeneration }, before, path);
      assertHttpFaultOnly(h, beforeFault, 1);
    }
  });

  it("stamps accepted command provenance from the server-owned operator session", async () => {
    const h = await harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b78";
    const patch = { "browser.headless": { set: false } } as const;
    const acceptedAt = h.clock.now().toISOString();

    const response = await h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: {
        host: "localhost",
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        commandId,
        requestedAt: "2020-01-01T00:00:00.000Z",
        requestedBy: "local-operator",
        source: "hostile-page",
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: deriveSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal((await json(response)).state, "applied");
    const expectedCommand = {
      commandId,
      requestedAt: acceptedAt,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    };
    assert.deepEqual(h.database.authority.commands.get(commandId), expectedCommand);
    assert.deepEqual(h.database.authority.commandAudits.findByCommand(commandId)?.request, expectedCommand);
    assert.equal(
      h.database.authority.settingsCurrent.get()?.commandFingerprint,
      createHash("sha256")
        .update("hrauto:settings-command:v1\0")
        .update(canonicalJsonStringify(expectedCommand))
        .digest("hex"),
    );
  });

  it("replays the first server-accepted canonical command after the clock advances", async () => {
    const h = await harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b77";
    const acceptedAt = h.clock.now().toISOString();
    const patch = { "browser.headless": { set: false } } as const;
    const command = {
      commandId,
      requestedAt: "2020-01-01T00:00:00.000Z",
      requestedBy: "local-operator",
      source: "hostile-page",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    };
    const request = () => h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: {
        host: "localhost",
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    });
    assert.equal((await json(await request())).state, "applied");
    h.clock.advanceWall(1_000);

    const replay = await request();

    assert.equal(replay.status, 200);
    assert.equal((await json(replay)).state, "already-applied");
    assert.equal(h.database.authority.commands.get(commandId)?.requestedAt, acceptedAt);

    const accepted = h.database.authority.commands.get(commandId);
    const beforeMismatch = faultAuthoritySnapshot(h);
    const mismatchedReplay = await h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ ...command, requestedBy: "other-operator" }),
    });
    assert.equal(mismatchedReplay.status, 403);
    assert.equal((await json(mismatchedReplay)).code, "REQUEST_IDENTITY_REFUSED");
    assert.deepEqual(h.database.authority.commands.get(commandId), accepted);
    assertHttpFaultOnly(h, beforeMismatch, 1);
  });


});

import { OPERATOR_JSON_HEADERS,assertHttpFaultOnly,disposeHttpRouteHarness,faultAuthoritySnapshot,harness,json,rawSettingsPatchFingerprint,settingsAuthoritySnapshot } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);
