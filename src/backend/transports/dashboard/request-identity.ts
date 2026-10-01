import {
  LocalOperatorActorSchema,
  type ActorId,
} from "../../../domain/ids.js";
import { RequestIdentityRefusedError } from "../../../server/failures.js";

/** The one BFF admission seam that turns a request into server-owned actor authority. */
export interface RequestIdentityCheckpoint {
  identify(request: Request): ActorId;
}

/**
 * D75 solo mode has no caller credential and therefore no actor choice. The
 * configured actor is parsed once at composition and every request receives
 * that exact id; request headers, query parameters and bodies are not inputs.
 */
export function createSoloRequestIdentityCheckpoint(
  configuredActor: unknown,
): RequestIdentityCheckpoint {
  const actor = LocalOperatorActorSchema.parse(configuredActor);
  return Object.freeze({
    identify(_request: Request): ActorId {
      return actor.id;
    },
  });
}

/** A schema-valid caller claim may only repeat the actor derived at admission. */
export function assertRequestActor(derived: ActorId, requested: ActorId): void {
  if (derived !== requested) {
    throw new RequestIdentityRefusedError(
      "the request's requestedBy actor does not match the server-derived actor",
    );
  }
}
