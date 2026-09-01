# Joined DCA Receipt parity — UI review

- Native role: `sup_terra_receipt_parity_ui_review`
- Agent: `01a05891-b759-7db3-ac95-2e53b15bbb23`
- Mode: read-only `/ui`, high reasoning
- Reviewed checkout: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`
- Stack: React 19, Tailwind 4, TypeScript; no shadcn
- Live WIG source read by reviewer: `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`

## Findings and closure

The first review found missing rendered evidence, an incomplete theme/viewport matrix,
class-string-only failure framing, painted-box-only touch proof and incomplete stable-metadata
geometry. Parent added ordinary screenshot and accessibility attachments without minting references;
Paper Ink and Graphite Warm evidence at desktop and phone; resolved danger-token border proof;
dense 44px hit ownership/document-wide non-overlap; full preview and facts rectangles; and
focus-visible ring/restoration assertions.

Follow-up review caught that the translucent danger border was being measured as raw RGB. Parent
now composites all ancestor background layers to an opaque painted backdrop, composites the actual
border alpha over it, and requires the painted border to retain 3:1 contrast while resolving exactly
to `--ds-danger-border` and differing from `--ds-border`. The final accessibility follow-up requires
an exact trimmed root line (`region "Run captures"` or `dialog "Run capture"`), not a name substring.

The final native return was `STATUS: PASS` with no remaining finding in the requested seam.

## Limits

No browser or heavy command was run by the reviewer. The attachments are deliberately non-golden
evidence under the brief; they require direct inspection after the scoped browser run.
