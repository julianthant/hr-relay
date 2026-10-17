import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RuntimeAdmission } from "../admission/admission.js";
import type { AuthorityDatabase } from "../sqlite/authority-database.js";
import { requireWorkerPoolRoster, retireWorkerVerification } from "../sqlite/worker-slots.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";

export function retireOrphanVerification(admission: RuntimeAdmission, database: AuthorityDatabase,
  input: Readonly<{ acquisitionId: string; plan: boolean }>, clock: Clock = systemClock) {
  admission.assertExclusive();
  const acquisitionId = z.uuid().parse(input.acquisitionId);
  return database.withAuthorityTransaction(repositories => {
    const now = clock.now().toISOString();
    const { hold, proof, poolVersion } = repositories.workerSlots.planOrphanRetirement({ acquisitionId, now });
    requireWorkerPoolRoster(repositories, hold.slot.workflow);
    const request = { commandId: randomUUID(), grantCommandId: hold.command.commandId, workerId: hold.slot.workerId,
      expectedRevision: hold.slot.membershipRevision, expectedPoolVersion: poolVersion, now,
      cleanup: { acquisitionId, mode: "offline", evidence: "orphan-retired", proof } };
    if (input.plan) repositories.workerSlots.requireOrphanRetirement(request);
    else retireWorkerVerification(repositories, request, randomUUID());
    return { state: input.plan ? "planned" : "retired", acquisitionId, workerId: hold.slot.workerId, profileRoots: proof.profileRoots, checkedAt: proof.checkedAt };
  });
}
