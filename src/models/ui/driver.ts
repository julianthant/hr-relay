import { z } from "zod";
import { BrowserSystemIdSchema, ElementIdSchema, PageStateIdSchema } from "../../rules/identity/ids.js";
import type {
  BrowserSystemId,
  ElementId,
  ObservationId,
  PageStateId,
  ScreenId,
} from "../../rules/identity/ids.js";
import type { Fingerprint, PositiveInt } from "../../rules/identity/ids.js";

declare const mutationCapabilityBrand: unique symbol;

/** Created only by the fenced write sequencer; the brand symbol is declare-only, so the runtime registry in `mutation-capability.ts` makes a token unforgeable through a module-private WeakSet. */
export type MutationCapability = Readonly<{
  intentGeneration: PositiveInt;
  bindingDigest: Fingerprint;
  [mutationCapabilityBrand]: true;
}>;

export const PageStateProofSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  stateId: PageStateIdSchema,
  matched: z.literal(true),
});
export const UiActionProofSchema = z.strictObject({
  elementId: ElementIdSchema,
  effect: z.enum(["navigate", "prepare", "external-commit"]),
  performed: z.literal(true),
});

export type PageStateProof = z.infer<typeof PageStateProofSchema>;
export type UiActionProof = z.infer<typeof UiActionProofSchema>;

export interface SystemDriver<
  S extends BrowserSystemId,
  Screens extends ScreenId,
  States extends PageStateId,
  Fields extends Readonly<Record<string, string>>,
  Observations extends Readonly<Record<string, string>>,
  Clicks extends ElementId = never,
> {
  readonly system: S;
  goto(screen: Screens): Promise<PageStateProof>;
  waitFor(state: States): Promise<PageStateProof>;
  fill<I extends keyof Fields & ElementId>(id: I, value: Fields[I]): Promise<UiActionProof>;
  read<I extends keyof Observations & ObservationId>(id: I): Promise<Observations[I]>;
  click(id: Clicks): Promise<UiActionProof>;
}

/** Implementable only after runtime-minted token validation exists. */
export interface CommitCapableSystemDriver<Commits extends ElementId = never> {
  commit(id: Commits, capability: MutationCapability): Promise<UiActionProof>;
}
