/**
 * THE SERVER'S REFUSAL, ARRIVING — one notice, both ceremonies (D273 item 10).
 *
 * This is the one moment in a resolution flow the operator is watching hardest:
 * they pressed a verb that settles a real HR write and this is the answer. An
 * element that simply exists on the next frame reads as a render fault, so it
 * comes from somewhere — the house `enter` pair, which is a TRANSITION off a
 * mounted state rather than a key-frame, so it is interruptible and so
 * `prefers-reduced-motion` removes it by zeroing both tokens at once: the clock
 * AND the travel. No reduced-motion branch, on purpose: zeroing only the clock
 * would still slide it 8px in one frame, which is a jump.
 *
 * Draw it as the LAST element in the dialog body, under a standing `min-h`, so
 * a refusal does not shove the footer out from under a pointer already
 * travelling toward it and the body does not jump by a line.
 *
 * TWO ARMS, split on whether the server named a CODE — the demo's
 * `hasRefusalCode` branch (`DemoParkResolve.tsx:170-184`), and the split is
 * exact here rather than approximate: `CommandResultSchema` gives `rejected` a
 * required `code` and gives `conflict` none (`src/domain/commands.ts:323-324`).
 * The code is what an operator quotes into a bug report, so a coded refusal
 * prints the SERVED one and an uncoded one says in as many words that there is
 * nothing to quote, rather than inventing a code to fill the slot.
 *
 * NO NESTED `role="alert"`. `Banner tone="danger"` — which `Refusal` is built
 * on — already carries one (`primitives-layout.tsx`'s `BANNER_TONE.danger.live`).
 * The park copy of this component wrapped its children in a second one, so a
 * screen reader announced the same sentence twice and every
 * `getByRole("alert")` on that surface was ambiguous. Merging the two copies
 * settles it on the gate copy's reading, which was already right.
 */
import { cn } from "../lib/utils.js";
import { Banner, Refusal, dsMotion, useDsEnterTransition } from "../ds/ui.js";
import {
  REFUSED_NOTICE_TITLE,
  refusedNoticeCopy,
  type Refused,
  type RefusedCeremony,
} from "./refused-notice-model.js";

export function RefusedNotice({
  refusal,
  ceremony,
}: {
  refusal: Refused;
  /** which ceremony was refused — it decides the one clause that differs */
  ceremony: RefusedCeremony;
}) {
  const entering = useDsEnterTransition();
  const enterClass = cn(
    dsMotion.enter,
    "data-[demo-enter=from]:translate-y-[var(--ds-travel-md)] data-[demo-enter=from]:opacity-0",
  );
  const copy = refusedNoticeCopy(ceremony);
  if (refusal.code === undefined) {
    return (
      <Banner tone="danger" title={REFUSED_NOTICE_TITLE} className={enterClass} {...entering}>
        {refusal.message} {copy.uncoded}
      </Banner>
    );
  }
  return (
    <Refusal
      title={REFUSED_NOTICE_TITLE}
      code={refusal.code}
      outcome={copy.outcome}
      className={enterClass}
      {...entering}
    >
      {refusal.message}
    </Refusal>
  );
}
