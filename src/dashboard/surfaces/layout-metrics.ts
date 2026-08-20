/**
 * The JS halves of the surfaces' CSS metric pairs.
 *
 * Tailwind cannot see through an identifier, so every one of these numbers is
 * written twice — once here, once as a literal in a class string or a token in
 * `ds/tokens.css` — and `tests/unit/dashboard/detail-region-breakpoints.test.ts`
 * pins the halves to each other, because a threshold that drifts between them
 * is a region whose component choice and column arrangement disagree.
 *
 * They live in a plain module rather than beside the components that read them
 * because a module exporting a component may export nothing else if React Fast
 * Refresh is to treat it as a refresh boundary: one non-component export makes
 * every edit to that surface invalidate upward into `dashboard-app.tsx` and
 * remount the whole app instead of hot-swapping the component.
 */

/**
 * THE DETAIL REGION'S TWO BREAKPOINTS, IN COLUMN PIXELS (doc 03 §Shell).
 *
 * > "A consequence worth pinning: inside the detail region, a layout switch
 * > keys on the COLUMN, not the window."
 *
 * The region used to switch on `min-[1280px]:` / `min-[1480px]:`, which is the
 * WINDOW — and the window is the one measurement that does not describe this
 * box. The shell spends `--ds-w-side-panel` (376px) on the queue plus three
 * `--ds-shell-inset` gaps (12px each) before this column starts, and the
 * workflow panel takes 200px more whenever it is docked as a sidebar. So the
 * same 1280px window hands this region 868px with the panel floating and 668px
 * with it docked — and a viewport query fires at the wrong moment in both
 * directions. Measured, on the fixture corpus, before the change:
 *
 * | window | floating | sidebar | old centre, docked |
 * |---|---|---|---|
 * | 1280 | 868 | 668 | **280px** — three columns forced into a two-column box |
 * | 1480 | 1068 | 868 | shape split beside a 480px centre |
 *
 * Both numbers are the OLD window thresholds translated through that constant
 * 412px of shell, so the rendered arrangement at the default (floating) panel
 * mode is unchanged at every reference viewport: 1280 − 412 = 868, and
 * 1480 − 412 = 1068.
 *
 * These are the JS half of the split. The CSS half is the literal
 * `@min-[868px]/detail:` / `@min-[1068px]/detail:` in `log-panel.tsx`'s class
 * strings, because Tailwind cannot see through an identifier — and
 * `tests/unit/dashboard/detail-region-breakpoints.test.ts` pins the two halves
 * to each other, since a threshold that drifts between them is a region whose
 * component choice and column arrangement disagree.
 */
export const DETAIL_THREE_COLUMN_PX = 868;
export const DETAIL_SHAPE_BESIDE_PX = 1068;

/* ── the member well ─────────────────────────────────────────────────────── */

/**
 * The two well shapes, as LINE COUNTS. `--ds-h-member-well` /
 * `--ds-h-member-well-open` are these same two numbers as pixels. Labels stay
 * word-only ("Expand" / "Collapse") so the disclosure does not restate a count
 * the chrome already carries.
 */
export const MEMBER_WELL_LINES = 5;
export const MEMBER_WELL_OPEN_LINES = 20;
