import { redactedEvidenceId } from "../../../../rules/redaction/redaction.js";
import { AbsentEvidenceSchema } from "../../../../rules/write-safety/write-safety-primitives.js";
import { IsoInstantSchema, FingerprintSchema, EvidenceRefSchema } from "../../../../rules/identity/ids.js";
import type { Page } from "playwright";
import { assertMintedMutationCapability } from "../../../../workflow-kit/mutation-capability.js";
import { I9_PROFILE_STAGED, I9_REMOTE_STAGED, I9_PROFILE_SUBJECT, I9_SEARCH_RESULTS, I9_SEARCH_READ, I9ProfileProofSchema, I9RemoteProofSchema,
  I9ProfileTargetSchema, I9RemoteTargetSchema, i9ProfileKey, i9RemoteKey,
  type I9CreationDriver, type I9ProfileTarget, type I9RemoteTarget } from "../../../../models/ui/i9-creation.js";
import type { I9Driver } from "../../../../models/ui/i9.js";
import { deriveIdempotencyKeyDigest } from "../../../../rules/write-safety/write-safety.js";
import { containsDryRunSample } from "../../../../models/workflow/dry-run.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import { I9_APP_ORIGIN, I9_CREATION_UI as ui } from "./ui-registry.js";

const CONTROL_MS = 15_000;
const normalize = (value: string) => value.trim().replace(/\s+/gu, " ").toLowerCase();
const usDate = (value: string) => `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`;

export function createI9CreationOperations(assertCurrent: () => void, page: Page, clock: Clock,
  reads: Pick<I9Driver, "searchEmployees" | "readRecordSummary">): I9CreationDriver {
  let stagedProfile: I9ProfileTarget | undefined;
  let stagedRemote: I9RemoteTarget | undefined;
  const field = (key: "firstName" | "lastName" | "middleName" | "ssn" | "dob" | "email") => ui.field(page, key);
  const worksite = () => ui.worksite(page);
  const requireApp = () => {
    assertCurrent();
    const url = new URL(page.url());
    if (url.origin !== I9_APP_ORIGIN || /login|training/iu.test(url.pathname)) throw new Error("i9-write-page-refused");
    return url;
  };
  const step = async (operation: () => Promise<unknown>, capture: () => Promise<void>) => {
    requireApp(); await operation(); requireApp(); await capture(); assertCurrent();
  };
  const absent = (key: string) => {
    const observedAt = IsoInstantSchema.parse(clock.now().toISOString());
    return { state: "absent" as const, evidence: AbsentEvidenceSchema.parse({ idempotencyKeyDigest: deriveIdempotencyKeyDigest("i9", key),
      source: I9_SEARCH_RESULTS, sourceState: I9_SEARCH_READ, observedAt, queryDigest: sha256Hex(key),
      evidenceRef: `observation:${redactedEvidenceId("i9-absence", [key, observedAt])}` }) };
  };
  const unknown = (reason: string) => ({ state: "unknown" as const, reason, observedAt: IsoInstantSchema.parse(clock.now().toISOString()) });
  const displayedName = async () => `${(await field("firstName").inputValue()).trim()} ${(await field("lastName").inputValue()).trim()}`;
  const requireIdentity = async (input: I9ProfileTarget) => {
    const observed = { firstName: (await field("firstName").inputValue()).trim(), lastName: (await field("lastName").inputValue()).trim(),
      middleName: (await field("middleName").inputValue()).trim(),
      dob: (await field("dob").inputValue()).trim(), email: (await field("email").inputValue()).trim(),
      worksite: (await worksite().innerText()).trim() };
    assertCurrent();
    if (normalize(observed.firstName) !== normalize(input.firstName) || normalize(observed.lastName) !== normalize(input.lastName)
      || normalize(observed.middleName) !== normalize(input.middleName)
      || observed.dob !== usDate(input.dob) || observed.email.toLowerCase() !== input.email.toLowerCase()
      || !new RegExp(`^6-${input.departmentNumber}(?:\\s|$)`, "u").test(observed.worksite)) throw new Error("i9-write-identity-mismatch");
    if (input.ssn !== null) {
      const digits = (await field("ssn").inputValue()).replace(/\D/gu, "");
      if (digits !== input.ssn && digits !== input.ssn.slice(-4)) throw new Error("i9-write-identifier-mismatch");
    } else if (requireApp().pathname === "/employee/profile" && (await field("ssn").inputValue()).trim() !== "") {
      throw new Error("i9-new-profile-identifier-unexpected");
    }
    return observed;
  };
  const requireProfileRoute = (profileId: string) => {
    if (requireApp().pathname !== `/employee/profile/${profileId}`) throw new Error("i9-write-profile-route-mismatch");
  };
  const savedProfile = async (input: I9ProfileTarget) => {
    const url = requireApp();
    const match = /^\/employee\/profile\/([1-9]\d*)$/u.exec(url.pathname);
    if (match?.[1] === undefined) throw new Error("i9-saved-profile-route-unverified");
    const observed = await requireIdentity(input);
    return I9ProfileProofSchema.parse({ kind: "i9-profile", profileId: match[1], firstName: observed.firstName,
      lastName: observed.lastName, dob: input.dob, email: observed.email, departmentNumber: input.departmentNumber, source: "saved-profile-read" });
  };
  const operations: I9CreationDriver = {
    async read(id) {
      if (id !== I9_PROFILE_SUBJECT) throw new Error("i9-write-observation-refused");
      if (stagedProfile !== undefined) {
        if (requireApp().pathname !== "/employee/profile") throw new Error("i9-new-profile-route-mismatch");
      } else if (stagedRemote !== undefined) requireProfileRoute(stagedRemote.profileId);
      else throw new Error("i9-write-subject-not-staged");
      requireApp(); const name = await displayedName(); assertCurrent(); return name;
    },
    async probeProfile(raw) {
      const input = I9ProfileTargetSchema.parse(raw); requireApp(); stagedProfile = undefined; stagedRemote = undefined;
      const search = await reads.searchEmployees({ firstName: input.firstName, lastName: input.lastName,
        ...(input.ssn === null ? {} : { ssn: input.ssn }) });
      if (search.restricted) return unknown("profile-search-restricted");
      if (search.rows.length === 0) return absent(i9ProfileKey(input));
      if (search.rows.some(row => normalize(row.firstName) !== normalize(input.firstName) || normalize(row.lastName) !== normalize(input.lastName))) {
        return unknown("profile-search-identity-mismatch");
      }
      const ids = [...new Set(search.rows.map(row => row.profileId))];
      if (ids.length > 1) return { state: "ambiguous", matches: ids.length, observedAt: IsoInstantSchema.parse(clock.now().toISOString()),
        queryDigest: FingerprintSchema.parse(sha256Hex(i9ProfileKey(input))), evidence: ids.map(id => EvidenceRefSchema.parse(`observation:${redactedEvidenceId("i9-match", [id])}`)) };
      const id = ids[0]; if (id === undefined) throw new Error("i9-profile-search-inconsistent");
      await page.goto(`${I9_APP_ORIGIN}/employee/profile/${id}`, { waitUntil: "domcontentloaded", timeout: CONTROL_MS });
      requireProfileRoute(id);
      return { state: "present", proof: await savedProfile(input) };
    },
    async prepareProfile(raw, capture) {
      const input = I9ProfileTargetSchema.parse(raw); stagedProfile = undefined; stagedRemote = undefined;
      await step(() => page.goto(I9_APP_ORIGIN, { waitUntil: "domcontentloaded", timeout: CONTROL_MS }), capture);
      await step(() => ui.createProfile(page).click({ timeout: CONTROL_MS }), capture);
      await page.waitForURL(url => url.origin === I9_APP_ORIGIN && url.pathname === "/employee/profile", { timeout: CONTROL_MS });
      for (const key of ["firstName", "middleName", "lastName", "ssn", "dob", "email"] as const) {
        const value = key === "dob" ? usDate(input.dob) : key === "ssn" ? (input.ssn === null ? "" : input.ssn) : input[key];
        await step(() => field(key).fill(value, { timeout: CONTROL_MS }), capture);
        recordBrowserAction("typed", `i9.profile.${key}`);
      }
      if (await ui.datepicker(page).count() > 0) await step(() => ui.datepicker(page).evaluate(element => { element.style.display = "none"; }), capture);
      await step(() => worksite().click({ timeout: CONTROL_MS }), capture);
      const option = ui.worksiteOption(page, input.departmentNumber);
      await option.waitFor({ state: "visible", timeout: CONTROL_MS });
      if (await option.count() !== 1) throw new Error("i9-worksite-ambiguous");
      await step(() => option.click({ timeout: CONTROL_MS }), capture);
      await requireIdentity(input);
      if (!await ui.saveProfile(page).isEnabled()) throw new Error("i9-profile-submit-disabled");
      stagedProfile = input;
      return { stagedPageState: I9_PROFILE_STAGED, observedName: await displayedName() };
    },
    async saveProfile(capability) {
      assertMintedMutationCapability(capability); requireApp();
      const target = stagedProfile; if (target === undefined) throw new Error("i9-profile-not-staged");
      if (requireApp().pathname !== "/employee/profile") throw new Error("i9-new-profile-route-mismatch");
      stagedProfile = undefined;
      await requireIdentity(target);
      await ui.saveProfile(page).click({ timeout: CONTROL_MS });
      recordBrowserAction("clicked", "i9.profile.save");
      const ok = ui.ok(page);
      const duplicate = ui.duplicate(page);
      const error = ui.profileError(page);
      const route = (url: URL) => url.origin === I9_APP_ORIGIN && /^\/employee\/profile\/[1-9]\d*$/u.test(url.pathname);
      const outcome = await Promise.race([
        page.waitForURL(route, { timeout: CONTROL_MS }).then(() => "route"),
        ok.waitFor({ state: "visible", timeout: CONTROL_MS }).then(() => "ok"),
        duplicate.waitFor({ state: "visible", timeout: CONTROL_MS }).then(() => "duplicate"),
        error.waitFor({ state: "visible", timeout: CONTROL_MS }).then(() => "error"),
      ]);
      if (outcome === "duplicate" || outcome === "error" || await error.isVisible() || await duplicate.isVisible()) throw new Error("i9-profile-save-unverified");
      if (outcome === "ok") await ok.click({ timeout: CONTROL_MS });
      await page.waitForURL(route, { timeout: CONTROL_MS });
      return savedProfile(target);
    },
    async probeRemote(raw) {
      const input = I9RemoteTargetSchema.parse(raw); requireApp(); stagedProfile = undefined; stagedRemote = undefined;
      await page.goto(`${I9_APP_ORIGIN}/employee/profile/${input.profileId}`, { waitUntil: "domcontentloaded", timeout: CONTROL_MS });
      requireProfileRoute(input.profileId);
      const observed = await requireIdentity(input);
      const search = await reads.searchEmployees({ profileId: input.profileId });
      if (search.restricted || search.rows.some(row => row.profileId !== input.profileId
        || normalize(row.firstName) !== normalize(input.firstName) || normalize(row.lastName) !== normalize(input.lastName))) return unknown("record-search-unverified");
      const rows = search.rows.filter(row => row.i9Id !== "" && row.startDate === input.startDate);
      if (rows.length === 0) {
        if (search.rows.length > 1 || search.rows.some(row => row.i9Id !== "")) return unknown("record-list-absence-unverified");
        return absent(i9RemoteKey(input));
      }
      if (rows.length > 1) return { state: "ambiguous", matches: rows.length, observedAt: IsoInstantSchema.parse(clock.now().toISOString()),
        queryDigest: FingerprintSchema.parse(sha256Hex(i9RemoteKey(input))), evidence: rows.map(row => EvidenceRefSchema.parse(`observation:${redactedEvidenceId("i9-match", [row.i9Id])}`)) };
      const row = rows[0]; if (row === undefined) throw new Error("i9-record-search-inconsistent");
      const summary = await reads.readRecordSummary({ profileId: row.profileId, i9Id: row.i9Id });
      if (!("profileId" in summary) || summary.profileId !== input.profileId || summary.i9Id !== row.i9Id) return unknown("record-summary-unverified");
      return { state: "present", proof: I9RemoteProofSchema.parse({ kind: "i9-remote-record", profileId: row.profileId,
        i9Id: row.i9Id, startDate: row.startDate, email: observed.email, source: "i9-record-read" }) };
    },
    async prepareRemote(raw, capture) {
      const input = I9RemoteTargetSchema.parse(raw); stagedProfile = undefined; stagedRemote = undefined;
      await step(() => page.goto(`${I9_APP_ORIGIN}/employee/profile/${input.profileId}?saveAndContinue=true`,
        { waitUntil: "domcontentloaded", timeout: CONTROL_MS }), capture);
      requireProfileRoute(input.profileId);
      await requireIdentity(input);
      await step(() => ui.remoteSection1(page).check({ timeout: CONTROL_MS }), capture);
      const start = ui.startDate(page);
      await step(() => start.fill(input.startDate, { timeout: CONTROL_MS }), capture);
      if (await start.inputValue() !== input.startDate || !await ui.createRemote(page).isEnabled()) {
        throw new Error("i9-remote-form-unverified");
      }
      stagedRemote = input;
      return { stagedPageState: I9_REMOTE_STAGED, observedName: await displayedName() };
    },
    async createRemote(capability) {
      assertMintedMutationCapability(capability); requireApp();
      const target = stagedRemote; if (target === undefined) throw new Error("i9-remote-not-staged");
      if (containsDryRunSample(target)) throw new Error("i9-remote-preview-target-refused");
      requireProfileRoute(target.profileId);
      stagedRemote = undefined;
      await requireIdentity(target);
      if (await ui.startDate(page).inputValue() !== target.startDate) throw new Error("i9-remote-start-date-changed");
      await ui.createRemote(page).click({ timeout: CONTROL_MS });
      recordBrowserAction("clicked", "i9.remote.create");
      const success = ui.remoteSuccess(page);
      const error = ui.remoteError(page);
      await Promise.race([success.waitFor({ state: "visible", timeout: CONTROL_MS }), error.waitFor({ state: "visible", timeout: CONTROL_MS })]);
      if (await error.isVisible() || !await success.isVisible()) throw new Error("i9-remote-submit-unverified");
      await ui.ok(page).click({ timeout: CONTROL_MS });
      await page.waitForURL(url => url.origin === I9_APP_ORIGIN && url.pathname === `/employee/profile/${target.profileId}` && url.hash === ""
        && (url.search === "" || url.searchParams.size === 1 && url.searchParams.get("isNewProfileCreated") === "true"), { timeout: CONTROL_MS });
      const verdict = await operations.probeRemote(target);
      if (verdict.state !== "present") throw new Error("i9-remote-saved-record-unverified");
      return verdict.proof;
    },
  };
  return operations;
}
