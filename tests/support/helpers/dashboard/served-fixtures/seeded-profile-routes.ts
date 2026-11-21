import { z } from "zod";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { operatorMutationIngressGuard } from "../../../../../src/backend/transports/http/routes/operator-mutation-ingress.js";
import { profileDetailsPatch } from "../../../../../src/models/profiles/profile.js";
import { DeleteProfileAccountRequestSchema, ProfileDetailsChangeRequestSchema, ProfileDetailsChangeResultSchema, PublicProfileStateSchema, type PublicProfileState } from "../../../../../src/models/profiles/public-profile.js";
import { FIXTURE_ACTIVE_PROFILE_STATE } from "../profiles/fixture-profile-setup.js";

export function registerSeededProfileRoutes(app: DashboardApp): void {
  let state: PublicProfileState = FIXTURE_ACTIVE_PROFILE_STATE;
  const signedOut = (signUpRequired: boolean) => PublicProfileStateSchema.parse({ state: "signed-out", signUpRequired });
  const stale = PublicProfileStateSchema.parse({ state: "refused", code: "PROFILE_SESSION_STALE" });

  app.get("/api/v1/profile/state", c => c.json(state));
  app.post("/api/v1/profile/account/details", operatorMutationIngressGuard, async c => {
    const request = ProfileDetailsChangeRequestSchema.parse(await c.req.json());
    if (state.state !== "active") return c.json(stale, 401);
    const change = profileDetailsPatch(request);
    if ("refused" in change) return c.json(ProfileDetailsChangeResultSchema.parse({ state: "refused", code: change.refused }));
    const { firstName, lastName, initials, timekeeperName, timekeeperInitials } = change.patch;
    const account = {
      ...state.account,
      ...(firstName === undefined || lastName === undefined ? {} : { name: `${firstName} ${lastName}` }),
      ...(initials === undefined ? {} : { initials }),
      ...(timekeeperName === undefined ? {} : { timekeeper: timekeeperName }),
      ...(timekeeperInitials === undefined ? {} : { timekeeperInitials }),
    };
    const result = ProfileDetailsChangeResultSchema.parse({ state: "changed", account });
    state = PublicProfileStateSchema.parse({ ...state, account });
    return c.json(result);
  });
  app.post("/api/v1/profile/logout", operatorMutationIngressGuard, async c => {
    z.strictObject({}).parse(await c.req.json());
    if (state.state !== "active") return c.json(stale, 401);
    state = signedOut(false);
    return c.json(state);
  });
  app.post("/api/v1/profile/delete-account", operatorMutationIngressGuard, async c => {
    const request = DeleteProfileAccountRequestSchema.parse(await c.req.json());
    if (state.state !== "active" || request.expectedProfileId !== state.profileId || request.expectedEpoch !== state.epoch) {
      return c.json(stale, 401);
    }
    state = signedOut(true);
    return c.json(state);
  });
}
