import { useCallback, useEffect, useMemo, useState } from "react";
import type { IntakeSessionWire } from "../../models/intake/wire.js";
import type { DashboardClient } from "../client/index.js";
import { intakeFailureMessage, useIntakeCommands, type IntakeRequest, type CommandProblem } from "../surfaces/intake/intake-command-model.js";
import { observeResource } from "./async-resource.js";

export type IntakeResource =
  | { readonly state: "loading" }
  | { readonly state: "loaded"; readonly session: IntakeSessionWire; readonly stale: boolean }
  | { readonly state: "failed"; readonly message: string; readonly cause: unknown; readonly retained?: IntakeSessionWire };
interface IntakeOwner { readonly client: DashboardClient; readonly sessionId: string; readonly commandView: object }

export function useIntakeWiringAdapter(client: DashboardClient, sessionId: string, onApplied: (command: IntakeRequest) => void) {
  const [snapshot, setSnapshot] = useState<{ owner?: IntakeOwner; resource: IntakeResource }>({ resource: { state: "loading" } });
  const adopt = useCallback((session: IntakeSessionWire, command: IntakeRequest) => {
    setSnapshot(current => ({ ...current, resource: { state: "loaded", session, stale: false } }));
    onApplied(command);
  }, [onApplied]);
  const commands = useIntakeCommands(client, sessionId, adopt);
  const owner = useMemo(() => ({ client, sessionId, commandView: commands.commandView }), [client, sessionId, commands.commandView]);
  const resource: IntakeResource = snapshot.owner === owner ? snapshot.resource
    : snapshot.owner?.client === client && snapshot.owner.sessionId === sessionId && snapshot.resource.state === "loaded"
      ? { ...snapshot.resource, stale: true } : { state: "loading" };

  useEffect(() => {
    setSnapshot(current => ({ owner, resource: current.owner?.client === client && current.owner.sessionId === sessionId && current.resource.state === "loaded"
      ? { ...current.resource, stale: true } : { state: "loading" } }));
    return observeResource(() => client.intakeSession(sessionId),
      session => setSnapshot({ owner, resource: { state: "loaded", session, stale: false } }),
      cause => setSnapshot(current => ({ owner, resource: { state: "failed", message: intakeFailureMessage(), cause,
        ...(current.resource.state === "loaded" ? { retained: current.resource.session } : {}) } })));
  }, [client, sessionId, owner]);

  const dispatch = commands.issue;
  const issue: typeof commands.issue = (session, command, pendingKey) => {
    if (resource.state === "loaded" && !resource.stale && resource.session === session) dispatch(session, command, pendingKey);
  };
  const problem: CommandProblem | null = commands.problem ?? (resource.state === "loaded" && resource.stale
    ? { kind: "transport", message: intakeFailureMessage() } : null);
  return { ...commands, issue, resource, problem, busy: commands.busy || resource.state !== "loaded" || resource.stale };
}
