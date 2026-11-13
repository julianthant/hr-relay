import { UcpathPayPathReadSchema, UcpathPayPathRefusedError, type UcpathPayPathDriver, type UcpathPayPathRead, type UcpathPayPathRefusalCode } from "../../../../models/ui/ucpath-paypath.js";

export function refusePayPathOperations(): UcpathPayPathDriver {
  return { readPayPathPosition: async () => { throw new Error("This UCPath fixture has no PayPath surface"); } };
}

/** Deterministic PayPath read: returns the given read for its own Empl ID, or refuses with the given code. */
export function deterministicPayPathOperations(options: Readonly<{ read?: UcpathPayPathRead; refusal?: UcpathPayPathRefusalCode; alertText?: string }>) {
  const events: string[] = [];
  const operations: UcpathPayPathDriver = {
    async readPayPathPosition(input) {
      events.push(`read:paypath:${input.emplId}`);
      if (options.refusal !== undefined) throw new UcpathPayPathRefusedError(options.refusal, options.alertText);
      if (options.read === undefined) throw new Error("PayPath fixture requires an explicit read or refusal");
      return UcpathPayPathReadSchema.parse(options.read);
    },
  };
  return Object.assign(operations, { events });
}
