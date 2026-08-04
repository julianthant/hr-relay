import { z } from "zod";
import { BrowserSystemIdSchema, ElementIdSchema, PageStateIdSchema } from "../ids.js";
import type {
  BrowserSystemId,
  ElementId,
  ObservationId,
  PageStateId,
  ScreenId,
} from "../ids.js";
import type { Fingerprint, PositiveInt } from "../ids.js";

declare const mutationCapabilityBrand: unique symbol;

/**
 * Created only by the fenced write sequencer (Phase 1f). The brand symbol is
 * declare-only, so the TYPE cannot make a token unforgeable — the runtime
 * registry in `src/base/mutation-capability.ts` does, through a module-private
 * WeakSet. That registry lives outside `domain` for two reasons: minting needs
 * a type assertion, which no domain boundary source may contain, and the
 * VERIFIER has to be callable from a `stores/**` driver before its click,
 * which the layer matrix forbids reaching into `core` for.
 */
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

/** Phase 1f may implement this only after runtime-minted token validation exists. */
export interface CommitCapableSystemDriver<Commits extends ElementId = never> {
  commit(id: Commits, capability: MutationCapability): Promise<UiActionProof>;
}
