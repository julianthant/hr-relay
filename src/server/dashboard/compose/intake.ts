import type { AuthorityDatabase } from "../../../infra/sqlite/authority-database.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../domain/ids.js";
import { createIntakeService } from "../commands/intake-service.js";
export function composeIntake(input: Omit<Parameters<typeof createIntakeService>[0], "authority" | "authorityRead" | "actorId"> & { database: AuthorityDatabase }) {
  const { database } = input;
  return createIntakeService({ ...input, actorId: LOCAL_OPERATOR_ACTOR_ID,
    authority: { withAuthorityTransaction: work => database.withAuthorityTransaction(work) },
    authorityRead: { getIntakeSession: id => database.authority.intakeSessions.get(id),
      getIntakeManifest: id => database.authority.intakeManifests.get(id),
      findIntakeManifestsBySource: digest => database.authority.intakeManifests.findBySource(digest) } });
}
