import type { Page } from "@playwright/test";
import { ProfileLoginRequestSchema, PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { FIXTURE_ACTIVE_PROFILE_STATE } from "../profiles/fixture-profile-setup.js";

export const FIXTURE_LOGIN = { email: "relay-smoke@ucsd.edu", password: "synthetic-password" };

/** Overlays the seeded server's profile routes in this browser only, without opening a real sign-in session. */
export async function startSignedOut(page: Page, ready: Promise<void>): Promise<void> {
  const signedOut = PublicProfileStateSchema.parse({ state: "signed-out" });
  let current = signedOut;
  await page.route("**/api/v1/profile/state", route => route.fulfill({ json: current }));
  await page.route("**/api/v1/profile/sign-in", async route => {
    const request = ProfileLoginRequestSchema.parse(route.request().postDataJSON());
    if (request.email !== FIXTURE_LOGIN.email || request.password !== FIXTURE_LOGIN.password) {
      await route.fulfill({ json: PublicProfileStateSchema.parse({ state: "refused", code: "PROFILE_SIGN_IN_REFUSED" }) });
      return;
    }
    await ready;
    current = FIXTURE_ACTIVE_PROFILE_STATE;
    await route.fulfill({ json: current, headers: { "x-relay-session": "fixture-session", "x-relay-resume": "fixture-resume" } });
  });
}
