import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { type AuthenticatedApplicationEvidence, type SystemLoginContext } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { type BrowserSystemId } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { fakeLoginPage, type FakePageScript } from "../browser/fake-login-page.js";
import { fixtureDuoCeremonyGate } from "../duo-ceremony-fixtures.js";





export function createSystemSessionTestWorld() {
  const CONFIG = resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(new Date("2026-08-03T09:00:00.000Z"))).config;

  const CREDENTIALS = Object.freeze({ userId: "fixture-user", password: "fixture-value" });

  const SSO = "https://a5.ucsd.edu/idp/profile/SAML2/Redirect/SSO";

  const NO_SIGN_IN_FORMS = {
    "campus-link": { count: 0 },
    "sso-submit": { count: 0 },
    "peoplesoft-signon": { count: 0 },
    "communities-login": { count: 0 },
  } as const;

  async function contextFor(
    script: FakePageScript,
    signal = new AbortController().signal,
    system: BrowserSystemId = "ucpath",
  ): Promise<{
    context: SystemLoginContext;
    harness: ReturnType<typeof fakeLoginPage>;
    evidence: () => readonly AuthenticatedApplicationEvidence[];
  }> {
    const harness = fakeLoginPage(script);
    const recorded: AuthenticatedApplicationEvidence[] = [];
    let ceremony: ReturnType<typeof fixtureDuoCeremonyGate> | undefined;
    return {
      harness,
      evidence: () => Object.freeze([...recorded]),
      context: {
        page: harness.page,
        config: CONFIG,
        instance: "prod",
        label: "worker person-lookup-worker-1 session",
        signal,
        credentials: CREDENTIALS,
        assertCurrent: () => undefined,
        recordEvidence: (evidence) => recorded.push(evidence),

        duoCeremony: {
          async withCeremony(run) {
            const gate = await (ceremony ??= fixtureDuoCeremonyGate(system));
            return gate.withCeremony(run);
          },
        },
      },
    };
  }
  return { CONFIG, SSO, NO_SIGN_IN_FORMS, contextFor, CREDENTIALS };
}
