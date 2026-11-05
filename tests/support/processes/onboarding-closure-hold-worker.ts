import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Entry } from "@napi-rs/keyring";
import { FakeKeyringEntry } from "../helpers/credential-keychain-fake.js";
import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createBrowserRoots } from "../../../src/backend/storage/browser-roots.js";
import { hasUnprovedSourceClosure } from "../../../src/backend/storage/source-closure.js";
import { composeProfileRuntime } from "../../../src/backend/app/composition/storage-compose.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { ProfileSessionRefusedError } from "../../../src/backend/profiles/profile-errors.js";

const actualEntry: unknown = Entry;
if (actualEntry !== FakeKeyringEntry || !process.env.RELAY_TEST_KEYCHAIN || !process.connected || !process.send) throw new Error("closure-hold-fixture-required");
const [workspace, portText] = process.argv.slice(2), port = Number(portText);
if (!workspace || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("closure-hold-fixture-arguments");
const lifetime = await RuntimeLifetimeLock.acquire(port);
const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
const profile = composeProfileRuntime({ admission: machine, hostFacts: { primaryDisplay: null }, clock: systemClock,
  onboardingDuo: {
    async showBrowser(owner) {
      owner.assertCurrent();
      const profileRoot = join(machine.stateRoot, "browsers", "onboarding"); mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
      const launch = createBrowserRoots(machine).beginSignupLaunch({ profileId: owner.profileId, profileRoot, credentialFingerprint: null,
        owner: { kind: "signup", operationId: owner.operationId, accountId: owner.accountId, providerGeneration: owner.generation } });
      mkdirSync(launch.input.profileDirectory, { mode: 0o700 }); launch.opened();
      launch.uncertain(new Error("synthetic browser gone, closure unproved"));
    },
    async closeBrowser() { return { state: "uncertain" }; },
    async openPortal() { throw new Error("unexpected portal"); },
    async start() { throw new Error("unexpected enrollment"); },
    async cancel() { return { state: "uncertain" }; },
  } });
const draft = profile.session.signUp({ firstName: "Closure", lastName: "Fixture", email: "closure-fixture@ucsd.edu", password: "disposable-closure-fixture", createdAt: systemClock.now().toISOString() });
if (draft.state !== "onboarding") throw new Error("closure-hold-fixture-draft");
await assert.rejects(profile.session.showOnboardingBrowser(draft.token, draft.operationId), hasUnprovedSourceClosure);
assert.equal(profile.session.readOnboarding(draft.token, draft.operationId).operationId, draft.operationId);
await assert.rejects(profile.session.cancelOnboarding(draft.token, draft.operationId), error => error instanceof ProfileSessionRefusedError && error.code === "BROWSER_CLOSURE_UNPROVED");
process.on("message", (message: unknown) => { if (message === "stop") process.exit(97); });
process.send({ type: "held", profileId: draft.profileId, operationId: draft.operationId, keychain: FakeKeyringEntry.snapshot() });
