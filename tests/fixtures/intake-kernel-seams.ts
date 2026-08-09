/**
 * The kernel's D170 intake seams, for a kernel under test that issues no
 * intake command.
 *
 * Both fail loud rather than answering with a plausible empty parse or an
 * empty target set: a suite that accidentally reaches an intake arm must see
 * the reason, not a session mapped against nothing.
 */
import type { IntakeParser, IntakeProjectionResolver } from "../../src/core/command-kernel.js";
import { CommandRequestSchema } from "../../src/domain/commands.js";
import type { IntakeService } from "../../src/server/dashboard/commands/intake-service.js";

export const UNWIRED_INTAKE_PARSER: IntakeParser = Object.freeze({
  parse: (request: Readonly<{ artifact: { sha256: string }; sheet: string }>): never => {
    throw new Error(
      `this kernel wires no intake parser; nothing prepared artifact ${request.artifact.sha256} `
      + `sheet ${JSON.stringify(request.sheet)}`,
    );
  },
});

export const NO_INTAKE_PROJECTIONS: IntakeProjectionResolver = Object.freeze({
  resolve: () => undefined,
});

/**
 * A BFF harness that serves no intake surface. `prepare` runs on EVERY command
 * post, so it stays a no-op for every other family and refuses only when an
 * intake command it could not have prepared actually arrives.
 */
export const UNWIRED_INTAKE_SERVICE: IntakeService = Object.freeze({
  upload: (): never => {
    throw new Error("this dashboard wires no intake service");
  },
  read: (): never => {
    throw new Error("this dashboard wires no intake service");
  },
  prepare: async (command: unknown): Promise<void> => {
    const parsed = CommandRequestSchema.safeParse(command);
    if (parsed.success && parsed.data.family === "intake") {
      throw new Error("this dashboard wires no intake service; an intake command cannot be prepared");
    }
    await Promise.resolve();
  },
});
