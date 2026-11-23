import { LoginResultSchema, type LoginResult } from "../../../../src/models/sessions/session.js";
import type { BrowserSystemId } from "../../../../src/rules/identity/ids.js";
import { defineSessionProvider, type SessionProvider } from "../../../../src/workflow-kit/session.js";

interface DeterministicSessionHarness<S extends BrowserSystemId> {
  readonly provider: SessionProvider<S>;
  readonly calls: () => readonly Parameters<SessionProvider<S>["login"]>[1][];
}

export function createDeterministicSessionProvider<S extends BrowserSystemId>(
  system: S,
  results: readonly LoginResult[],
  options: Readonly<{ exclusive?: true }> = {},
): DeterministicSessionHarness<S> {
  const queue = results.map((result) => LoginResultSchema.parse(result));
  const calls: Parameters<SessionProvider<S>["login"]>[1][] = [];
  const provider = defineSessionProvider({
    system,
    ...options,
    async login(_handle, loginOptions) {
      calls.push(Object.freeze({ ...loginOptions }));
      const result = queue.shift();
      if (result === undefined) throw new Error(`${system} deterministic session has no queued login result`);
      return result;
    },
  });
  return Object.freeze({
    provider,
    calls: () => Object.freeze(calls.map((call) => Object.freeze({ ...call }))),
  });
}
