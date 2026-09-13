import type { createPreflightAuthority } from "../../../domain/preflight.js";

export interface SettingsPreflightRouteDeps {
  readonly clock: import("../../../domain/clock.js").Clock;
  readonly preflight: Pick<ReturnType<typeof createPreflightAuthority>, "execute">;
}
