import { personLookupDescriptor } from "../../registered-workflows.js";
import type * as ComposeTypes from "../../../../../src/backend/app/registries/workflow-registry.js";


export function createFixtureIdentitySetup({ descriptorHash }: {
descriptorHash: (CONTRACT_FINGERPRINT: string) => ReturnType<typeof ComposeTypes.descriptorSetHash>;
}) {
  function uuidOf(seed: number): string {
    const digits = String(seed).padStart(12, "0");
    return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-4000-8000-${digits}`;
  }

  function traceOf(seed: number): string {
    const tick = String(seed % 60).padStart(2, "0");
    return `pl-09${tick}${tick}-${String(seed % 10000).padStart(4, "0")}`;
  }

  const FIXTURE_DAY = "2026-08-03";

  const FIXTURE_NOW = "2026-08-03T10:05:00.000-07:00";

  const FIXTURE_APP_VERSION = "0.1.0";

  const CONTRACT_FINGERPRINT = personLookupDescriptor.contractFingerprint;

  const FIXTURE_DESCRIPTOR_HASH = descriptorHash(CONTRACT_FINGERPRINT);

  const CONFIG_FINGERPRINT = "b".repeat(64);

  const WORKFLOW_ID = personLookupDescriptor.id;

  const at = (minute: number, second = 0): string =>
    `2026-08-03T09:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000-07:00`;

  return { uuidOf, traceOf, FIXTURE_DAY, FIXTURE_NOW, FIXTURE_APP_VERSION, CONTRACT_FINGERPRINT, FIXTURE_DESCRIPTOR_HASH, CONFIG_FINGERPRINT, WORKFLOW_ID, at };
}
