import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
buildEntryValidationFailureRecord,
buildNodeFailureRecord,
} from "../../../src/backend/runtime/execution/run-failure.js";
import { ConfigSchema } from "../../../src/models/config/schema.js";
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";
import {
CURRENT_DIAGNOSTIC_SAFETY_VERSION,
FailureRecordSchema,
SIGN_IN_CHECKS,
SIGN_IN_PAGE_ORIGINS,
SIGN_IN_PAGE_PATHS,
SignInRefusalSchema,
projectFailureForOperator,
signInPage,
} from "../../../src/models/trust/failure.js";
import { NodeIdSchema,TaskIdSchema } from "../../../src/rules/identity/ids.js";
import { deriveWriteAuthorityReason } from "../../../src/rules/write-safety/write-safety.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";

const RAW = "ucpath:termination|10812345|2026-08-29";
const UNREGISTERED = "This failure code is not in the current catalog. Review the recorded local evidence.";
const NODE_ID = NodeIdSchema.parse("searching");
const TASK_ID = TaskIdSchema.parse("ucpath/search-person-org");

function failure(diagnosticSafetyVersion?: 1) {
  return FailureRecordSchema.parse({
    failureId: "10000000-0000-4000-8000-000000000001",
    fingerprint: "a".repeat(64),
    runId: "10000000-0000-4000-8000-000000000002",
    traceId: "pl-010101-1000",
    attempt: 1,
    workflowId: "person-lookup",
    code: "UNHANDLED",
    summary: diagnosticSafetyVersion === undefined ? RAW : "registered source could not be read",
    transient: false,
    writeState: "not-attempted",
    causeChain: [{
      code: "UNHANDLED",
      summary: diagnosticSafetyVersion === undefined ? `primary ${RAW}` : "registered source unavailable",
      role: "primary",
      transient: false,
    }],
    remediation: [{
      kind: "operator-action",
      message: diagnosticSafetyVersion === undefined ? `repair ${RAW}` : "repair the registered source",
    }],
    occurredAt: "2026-08-29T08:00:00.000Z",
    ...(diagnosticSafetyVersion === undefined ? {} : { diagnosticSafetyVersion }),
  });
}

describe("diagnostic evidence projection", () => {
  it("keeps an arbitrary Error message in authority without stamping it safe for projection", () => {
    const authority = buildNodeFailureRecord({ writes: [],
      run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000004",
      nodeId: NODE_ID,
      taskId: TASK_ID,
      error: new Error(RAW),
      occurredAt: "2026-08-29T08:00:00.000Z",
    });

    assert.equal(authority.summary, RAW, "authority retains the diagnostic detail for investigation");
    assert.equal(authority.diagnosticSafetyVersion, undefined);
    assert.equal(JSON.stringify(projectFailureForOperator(authority)).includes(RAW), true);
  });

  it("keeps caller-supplied entry-validation problems in authority without stamping them safe", () => {
    const authority = buildEntryValidationFailureRecord({
      run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000005",
      problems: [`the selected subject was ${RAW}`],
      occurredAt: "2026-08-29T08:00:00.000Z",
    });

    assert.equal(authority.summary.includes(RAW), true, "authority retains every named validation problem");
    assert.equal(authority.diagnosticSafetyVersion, undefined);
    assert.equal(projectFailureForOperator(authority).summary.includes(RAW), false);
    assert.equal(JSON.stringify(projectFailureForOperator(authority, true)).includes(RAW), false);
  });

  it("stamps the closed non-Error fallback sentence because no thrown value is copied into it", () => {
    const authority = buildNodeFailureRecord({ writes: [],
      run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000006",
      nodeId: NODE_ID,
      taskId: TASK_ID,
      error: { opaque: RAW },
      occurredAt: "2026-08-29T08:00:00.000Z",
    });

    assert.equal(authority.diagnosticSafetyVersion, CURRENT_DIAGNOSTIC_SAFETY_VERSION);
    assert.equal(authority.code, "TASK_UNHANDLED_FAILURE");
    assert.equal(authority.summary, "node searching threw a non-Error value");
    assert.equal(JSON.stringify(authority).includes(RAW), false);
    const projected = projectFailureForOperator(authority, false);
    assert.equal(projected.summary, ERROR_CATALOG.TASK_UNHANDLED_FAILURE.text);
    assert.equal(projected.summary.includes(RAW), false);
    assert.equal(JSON.stringify(projected).includes(RAW), false);
  });

  it("serves unstamped failure text without rewriting authority", () => {
    const authority = failure();
    const before = JSON.stringify(authority);
    const projected = projectFailureForOperator(authority);
    assert.equal(projected.summary, UNREGISTERED);
    assert.equal(JSON.stringify(authority), before);
  });

  it("keeps current, stamped failure diagnostics useful", () => {
    const authority = failure(CURRENT_DIAGNOSTIC_SAFETY_VERSION);
    assert.equal(authority.summary, "registered source could not be read");
    assert.equal(projectFailureForOperator(authority, false).summary, UNREGISTERED);
  });

  it("serves protected and unstamped text from every source", () => {
    const authority = FailureRecordSchema.parse({ ...failure(CURRENT_DIAGNOSTIC_SAFETY_VERSION),
      summary: RAW, causeChain: [{ code: "UNHANDLED", summary: RAW, role: "primary", transient: false }],
      remediation: [{ kind: "operator-action", message: RAW }] });
    const before = JSON.stringify(authority);
    assert.equal(JSON.stringify(projectFailureForOperator(authority, true)).includes(RAW), false);
    assert.equal(projectFailureForOperator(authority, undefined).summary, UNREGISTERED);
    assert.equal(projectFailureForOperator(failure(), false).summary, UNREGISTERED);
    assert.equal(JSON.stringify(authority), before);
  });

  it("serves current write-authority detail", () => {
    const reason = deriveWriteAuthorityReason(
      "preview-probe-exception",
      "exception",
      `Error: ${RAW}`,
    );
    const authority = FailureRecordSchema.parse({
      ...failure(CURRENT_DIAGNOSTIC_SAFETY_VERSION),
      summary: RAW,
      causeChain: [{ code: "UNHANDLED", summary: RAW, role: "primary", transient: false }],
      writeAuthorityReason: reason,
    });
    const before = JSON.stringify(authority);
    const projected = projectFailureForOperator(authority);
    const projectedBytes = JSON.stringify(projected);
    assert.equal(projectedBytes.includes(RAW), true);
    assert.equal(projectedBytes.includes(reason.code), true);
    assert.equal(projectedBytes.includes(reason.evidence.digest), true);
    assert.deepEqual(projected.writeAuthorityReason, reason);
    assert.equal(JSON.stringify(authority), before);
  });
});

describe("sign-in refusal vocabulary", () => {
  it("rejects a copied reason or a path its origin does not list", () => {
    assert.equal(SignInRefusalSchema.safeParse({
      system: "ucpath", step: "verify-landing",
      reason: "employee 10456712",
      pageAddress: "https://example.test/people/10456712?subject=QUERY_CANARY",
    }).success, false);
    assert.equal(SignInRefusalSchema.safeParse({
      system: "ucpath", step: "verify-landing",
      pageOrigin: "https://a5.ucsd.edu",
      pagePath: "/hr/ONB_SearchOnboardings",
    }).success, false);
    assert.equal(SignInRefusalSchema.safeParse({
      system: "ucpath", step: "verify-landing",
      pageOrigin: "https://example.test/people/10456712",
    }).success, false);
    assert.equal(SignInRefusalSchema.safeParse({
      system: "ucpath", step: "verify-landing",
      check: "application-route",
      pageOrigin: "https://a5.ucsd.edu",
      pagePath: "/tritON/profile/SAML2/Redirect/SSO",
    }).success, true);
  });

  it("selects a registry origin and path by equality", () => {
    assert.deepEqual(signInPage(""), { pageOrigin: "not-read" });
    assert.deepEqual(signInPage("not a url"), { pageOrigin: "unreadable" });
    assert.deepEqual(signInPage("https://"), { pageOrigin: "unreadable" });
    assert.deepEqual(signInPage("data:text/plain,10456712"), { pageOrigin: "unlisted" });
    assert.deepEqual(signInPage("about:blank"), { pageOrigin: "unlisted" });
    assert.deepEqual(signInPage("https://example.test/read?token=QUERY_CANARY#FRAGMENT_CANARY"), { pageOrigin: "unlisted" });
    assert.deepEqual(
      signInPage("HTTPS://user:USERINFO_CANARY@a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO?token=QUERY_CANARY#FRAGMENT_CANARY"),
      { pageOrigin: "https://a5.ucsd.edu", pagePath: "/tritON/profile/SAML2/Redirect/SSO" },
    );
    assert.deepEqual(signInPage("https://a5.ucsd.edu/sso"), { pageOrigin: "https://a5.ucsd.edu" });
    assert.deepEqual(signInPage("https://10456712.duosecurity.com/frame?token=QUERY_CANARY"), { pageOrigin: "https://*.duosecurity.com" });
    assert.deepEqual(signInPage("https://a5.ucsd.edu:8443/tritON/profile/SAML2/Redirect/SSO"), { pageOrigin: "unlisted" });
    assert.deepEqual(signInPage("http://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO"), { pageOrigin: "unlisted" });
    assert.deepEqual(
      signInPage("https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/app;jsessionid=SESSION_CANARY?EMPLID=10456712"),
      { pageOrigin: "https://ucphrprdpub.universityofcalifornia.edu", pagePath: "/psc/ucphrprd/EMPLOYEE/HRMS/" },
    );
    assert.deepEqual(
      signInPage("https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/../SECRET_SEGMENT"),
      { pageOrigin: "https://ucphrprdpub.universityofcalifornia.edu" },
    );
    assert.deepEqual(signInPage("https://ucpath.universityofcalifornia.edu/?EMPLID=10456712"), {
      pageOrigin: "https://ucpath.universityofcalifornia.edu", pagePath: "/",
    });
    assert.deepEqual(signInPage("https://act-crm.my.site.com/login"), { pageOrigin: "https://act-crm.my.site.com" });
    assert.deepEqual(signInPage("https://samlproxy.ucop.edu/sso"), { pageOrigin: "https://samlproxy.ucop.edu" });
    assert.deepEqual(signInPage("https://ucpath-notifications.universityofcalifornia.edu/ucpath-maintenance.html?x=1"), {
      pageOrigin: "https://ucpath-notifications.universityofcalifornia.edu", pagePath: "/ucpath-maintenance.html",
    });
    for (const origin of SIGN_IN_PAGE_ORIGINS) assert.equal(signInPage(origin).pageOrigin === origin || origin === "unlisted" || origin === "not-read" || origin === "unreadable" || origin === "https://*.duosecurity.com", true);
  });

  it("keeps every fuzzed leaf inside the exported vocabulary", () => {
    let seed = 5268;
    const next = () => {
      seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
      return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
    };
    const alphabet = "10456712SECRET_CANARYQUERY_CANARY%20%0A%FF€/?#@";
    for (let index = 0; index < 2000; index += 1) {
      let observed = index % 5 === 0 ? "" : index % 5 === 1 ? "not a url" : "https://";
      const length = Math.floor(next() * 80);
      for (let character = 0; character < length; character += 1) observed += alphabet[Math.floor(next() * alphabet.length)] ?? "a";
      if (index % 7 === 0) observed = `https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO${observed}`;
      if (index % 11 === 0) observed = `https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/${observed}`;
      if (index % 13 === 0) observed = `https://${observed}.duosecurity.com/frame`;
      const page = signInPage(observed);
      assert.ok(SIGN_IN_PAGE_ORIGINS.some(origin => origin === page.pageOrigin), observed);
      if (page.pagePath !== undefined) assert.ok(SIGN_IN_PAGE_PATHS.some(path => path === page.pagePath), observed);
      const parsed = SignInRefusalSchema.safeParse({ system: "ucpath", step: "verify-landing", check: SIGN_IN_CHECKS[index % SIGN_IN_CHECKS.length], ...page });
      assert.equal(parsed.success, true, observed);
      const stored = JSON.stringify(page);
      for (const canary of ["SECRET_CANARY", "QUERY_CANARY", "10456712"]) {
        if (!SIGN_IN_PAGE_ORIGINS.some(origin => origin.includes(canary)) && !SIGN_IN_PAGE_PATHS.some(path => path.includes(canary))) {
          assert.equal(stored.includes(canary), false, `${canary} in ${stored}`);
        }
      }
    }
  });

  it("lists every default system entry origin", () => {
    const urls = ConfigSchema.shape.urls.parse(undefined);
    const found: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") found.push(value);
      else if (value !== null && typeof value === "object") for (const child of Object.values(value)) walk(child);
    };
    walk(urls);
    assert.ok(found.length > 0);
    for (const entry of found) {
      const origin = URL.parse(entry)?.origin;
      assert.equal(typeof origin === "string" && SIGN_IN_PAGE_ORIGINS.some(listed => listed === origin), true, entry);
    }
  });
});
