/** The ONE client, handed to the tree once (ref frontend-backend-integration ).
 * Surfaces never construct a client, a transport, a `fetch`, or a stream */
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { DashboardClient } from "../client/index.js";
import { CommandExecutor, type CommandExecutionScope } from "../app/commands/command-executor.js";
import type { DashboardCommandBinding } from "../app/dashboard-app-model.js";

const DashboardClientContext = createContext<DashboardClient | undefined>(undefined);
interface CommandOwner {
  readonly executor: CommandExecutor;
  readonly activate: (scope: CommandExecutionScope) => () => void;
}
const CommandOwnerContext = createContext<CommandOwner | undefined>(undefined);
const CommandBindingContext = createContext<DashboardCommandBinding | undefined>(undefined);

export function DashboardClientProvider({
  client,
  children,
}: {
  client: DashboardClient;
  children: ReactNode;
}) {
  const clientRef = useRef(client);
  clientRef.current = client;
  const scopeRef = useRef<CommandExecutionScope | undefined>(undefined);
  const [owner] = useState<CommandOwner>(() => Object.freeze({
    executor: new CommandExecutor(() => scopeRef.current?.client === clientRef.current ? scopeRef.current : undefined),
    activate: (scope: CommandExecutionScope) => {
      scopeRef.current = scope;
      return () => { if (scopeRef.current === scope) scopeRef.current = undefined; };
    },
  }));
  return <DashboardClientContext.Provider value={client}><CommandOwnerContext.Provider value={owner}>{children}</CommandOwnerContext.Provider></DashboardClientContext.Provider>;
}

export function useDashboardCommandExecutor(): CommandExecutor {
  const owner = useContext(CommandOwnerContext);
  if (owner === undefined) throw new Error("command executor requires a DashboardClientProvider above it");
  return owner.executor;
}

export function DashboardCommandBindingProvider({ binding, children }: { binding: DashboardCommandBinding; children: ReactNode }) {
  const owner = useContext(CommandOwnerContext);
  if (owner === undefined) throw new Error("command binding requires a DashboardClientProvider above it");
  useLayoutEffect(() => owner.activate(binding.scope), [owner, binding.scope]);
  return <CommandBindingContext.Provider value={binding}>{children}</CommandBindingContext.Provider>;
}

export function useDashboardCommandBinding(): DashboardCommandBinding | undefined {
  return useContext(CommandBindingContext);
}

/** Fails loud when the tree was mounted without a provider. */
export function useDashboardClient(): DashboardClient {
  const client = useContext(DashboardClientContext);
  if (client === undefined) {
    throw new Error("useDashboardClient requires a DashboardClientProvider above it");
  }
  return client;
}
