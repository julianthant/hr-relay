# Superseded — the shell's superseded panel widths (2026-07-27 → 2026-07-28)

**Superseded by** `reference/dashboard-surfaces.md` §9.9, which states the ONE resting width
(`--ds-w-side-panel`, 376px, shared by the queue and the context rail) and the container-query split
inside the detail region. This file keeps the measured reasoning behind the two-tier 400/470 widths
that 376 replaced, because it remains the record of what was tried and why — not because any of it is
still normative. Nothing here is implemented.

---

The superseded numbers, kept because they remain the record of what was tried and why:

> **1180–1479** queue **400px**; **≥ 1480** queue **470px**, both measured rather than chosen.
> 1480 = 470 queue + 348 rail + gaps + padding, leaving the centre ~590px — the width at which a
> six-segment equal-width timeline still prints readable labels. 400 was the largest queue that kept
> the review's page-beside-fields layout side by side below 1480: the review's floor is a **464px
> centre** (label + value + provenance chip + confidence on one line) and centre = 884 − queue at
> 1280, so 470 gave 414 and stacked it. The cost was stated rather than hidden: at 1280 no queue
> width satisfied both — a queue that renders `Oath_Packet_Summer.pdf` whole needs ~475px, which
> puts the centre back under the review's floor. **One shared 376px resolves that trade by refusing
> to spend the width on either side panel.**
