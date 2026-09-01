# DCA4 caption — independent finding and repair review

## Baseline rendered/source review

Native `sup_terra_dca4_caption_diagnosis_review`, high,240k/220k,
`01a052fb-ba16-7803-82d7-1f7c41c361db`; read-only, now closed.
Frozen HEADeda17b27/UI2cae368f/specd158 matched. Both exact03 preserved PNGs directly viewed.

**Count1, worst medium.** `archive.tsx:2381`: readiness caption covers retained image content
without its intended background, reducing desktop legibility. Image2376 fills the preview frame;
caption2381 is independently bottom-positioned. `--ds-bg-inset` is referenced in emitted CSS but
not declared in source/emitted styles; `--ds-surface-2` is declared inset surface (`tokens.css:70`).
No numeric contrast or computed browser style claim. The phone image has the same overlapping
geometry but darker text. Parent separately re-viewed desktop and confirmed the overlap.

Recommendation: unchanged fixed outer frame; internal object-contain image viewport plus persistent
wrapping-capable caption lane, reserved before decode without hidden success text; declared tokens.
An opaque overlay alone would still conceal retained content. Preserve resource/refusal scrolling,
metadata geometry, lifecycle, exact bytes, footer and coarse44px controls.

Regression: actual rendered viewer separates layout regions, uses declared background, preserves
outer shell and absence of success before decode; original implementation must fail. Add actual
browser disjointness/complete image/caption containment proof in both happy themes/viewports while
retaining staged geometry and footer assertions. Computed legibility and final PNG inspection
remain future allocated browser proof, not static acceptance.

Parent proposed this exact bounded seam to coordinator after slot release. Same A3 sequential
writer owns `briefs/dca4-caption-repair.md`; no heavy/browser/build or reference work permitted.
The initial finding awaited implementation; current affected-delta receive follows below.

## Frozen repair — five independent affected axes

Same HEADeda17b2708286e36542e1e18e9f8ef6a06cf3187, UI28f06f9bebdc1bbc85ac7a62367281b0ad3e086ebd7eb92b6936bc95949434bf.
Exact four-file +159/−25 delta SHA256 `0fde7a729c6648d971821633ab0894984dca3b25612da94cd9220a86662c39e4`.
`dca4-a3-caption-repair.md` records complete before/after files; parent matched all four hashes,
both aggregates, HEAD, diffcheck and unchanged materializer/manifest before review.

| Axis / native reviewer | Count / worst | Evidence and disposition |
| --- | --- | --- |
| Correctness / sup_terra `01a052fb-ba16-7803-82d7-1f7c41c361db` | 0 / none | Image and persistent caption are separate siblings; async/ref/error/readiness ownership unchanged; refusal remains scrollable. Original medium finding structurally addressed. |
| UI/layout/performance / sup_terra `01a052ff-414f-79b3-bc5d-fa871c2457dd` | 0 / none | Shrinkable contained-image viewport, wrapping nonshrinking caption, declared surface token. No runtime measurements/listeners or new resource lifetime. Outer constraints and old assertions retained. |
| Tests / sup_luna `01a052ff-4062-7b32-b0ba-4c6d27bbec85` | 0 / none | Actual rendered regression catches original twice; same empty→success→empty caption. Browser geometry/color checks nonvacuous; opaque sRGB/WCAG conversion and independent4.5 floor fail loudly. Removing only additive helper/call in memory reproduces old spec exactly. |
| Standards / sup_luna `01a05310-bd69-7630-93b1-88c6c475c29e` | 0 / none | Local components-only boundary, declared tokens, no unchecked assertions/fallback/hidden success; helper is test-local; previous assertions unchanged. |
| Docs / sup_luna `01a05310-5a72-7203-9886-f28ea5cf757f` | 0 / none | Lesson/comments match code and distinguish structural checks from browser proof;03 receipt/PNGs unchanged and unaccepted. |

Each reviewer regenerated the isolated delta from exact originals, checked frozen identities
before/after, performed no edits/gates/browser and was closed after receipt. Native budgets/high
unchanged. Spec/security/silent-failure re-review skipped for this delta: no contract, authority,
data egress, async/error decision, or fallback changed; prior owning reviews remain intact.
Simplification not requested and not needed for this local layout repair.

**Accepted new spec restoration SHA256**:
`e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0`.
Never restore oldd158 over this additive geometry regression. Both approved404 controls are UNRUN.

Parent independently reran8files/**165tests**, exit0,13.63s,09:08:52PDT. Serial globally locked
typecheck and lint, regenerated clean manifest, roadmap freshness and diffcheck chain exit0.
`parent-caption-focused.txt` and `parent-caption-lights.txt` retain commands/results.

Structural finding closed; **rendered caption geometry/contrast/full image and stable metadata
are NOT yet accepted**. Original and03 artifacts remain unaccepted preserved evidence. No browser,
build/parity/refupdate/404/fullcoverage ran during repair/review. New explicit allocation required.
