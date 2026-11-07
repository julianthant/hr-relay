import type { PreflightSelection, PreflightReadinessWire } from "../../../../models/preflight/preflight-contract.js";
import type { createPreflightAuthority } from "../../../../models/preflight/preflight.js";

export interface SettingsPreflightRouteDeps {
  readonly clock: import("../../../../rules/time/clock.js").Clock;
  readonly preflight: Pick<ReturnType<typeof createPreflightAuthority>, "execute"> & { read?: (selection?: PreflightSelection) => PreflightReadinessWire };
}
