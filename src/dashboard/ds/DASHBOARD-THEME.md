# Dashboard theme tokens

This guide records the reusable Tailwind v4 palette and type scale used by the Activity, Explorer,
Logs, and Sessions presentations. The canonical values and Tailwind theme mappings live in
`dashboard-theme.css`; use those definitions when changing tokens.

## Palette

`data-demo-theme="light"` (also the root default) and `data-demo-theme="dark"` select these values.
The `ui-*` names are semantic Tailwind utilities, so surfaces can use `bg-ui-panel`,
`text-ui-secondary`, or `border-ui-stroke` without repeating raw colors.

| Token | Role | Light | Dark |
|---|---|---:|---:|
| `ui-canvas` | App background | `#fafafa` | `#181818` |
| `ui-panel` | Panels and cards | `#ffffff` | `#222222` |
| `ui-table` | Opaque table and row fill | `#f4f4f4` | `#2b2b2b` |
| `ui-field` | Input fill | `#ffffff` | `#2b2b2b` |
| `ui-hover` | Hover fill | `#ebebeb` | `#323232` |
| `ui-stroke` | General borders | `#dedede` | `#3b3b3b` |
| `ui-stroke-control` | Stronger control border | `#a0a0a0` | `#515151` |
| `ui-primary` | Main text | `#202020` | `#efefef` |
| `ui-secondary` | Supporting text | `#626262` | `#b2b2b2` |
| `ui-muted` | Labels, timestamps, metadata | `#6b6b6b` | `#a0a0a0` |
| `ui-info` | Informational and fill-action emphasis | `#245d9e` | `#9dc4ff` |
| `ui-positive` | Positive results | `#16764a` | `#63d9a2` |
| `ui-warning` | Warnings | `#865609` | `#f0bd61` |
| `ui-danger` | Errors | `#ab3232` | `#f18d8d` |

Use `font-ui` for interface text. It follows the platform UI sans family (San Francisco on macOS,
then the system fallbacks). Use `font-data` for fixed-width values such as timestamps. The named
text utilities are:

| Utility | Size / line height | Weight | Usage |
|---|---:|---|---|
| `text-caption` | 11px / 16px | inherited | Metadata and timestamps |
| `text-body` | 12px / 18px | inherited | Log rows and supporting copy |
| `text-control` | 13px / 18px | inherited | Buttons and form controls |
| `text-heading` | 14px / 20px | semibold | Step and panel titles |
| `text-section` | 16px / 22px | semibold | Settings and content groups |
| `text-page` | 20px / 28px | semibold | Page titles; compact Activity metrics at 1024px |
| `text-workflow` | 27px / 32px | 650 | Explorer title; wider Activity metrics |

`w-log-time` and `w-log-label` use the named spacing tokens; `max-w-log-capture` uses the named
capture container token. `lib/utils.ts` extends `cn()`'s Tailwind merge groups with all seven text
utilities, so conditional size classes resolve by precedence instead of leaving both classes.

## Current presentation seams

The dashboard stylesheet imports this theme. Activity, Explorer, Logs, and Sessions put
`.ui-theme-scope` on their presentation roots and use the `ui-*`, typography, and `font-*` utilities.
Consumers outside that scope keep their current styling; migrate other dashboard surfaces separately.
Activity's `ActivityReport` host supplies `activity-fixture.ts` through the typed `ActivityViewState`
seam. `WorkflowExplorer` supplies `explorer-fixture.ts` to `ExplorerTimeline`. The run panel's
`LogSample` uses fictional `log-fixture.ts` data with `LogPanel` and `LogFeed`. `SessionPanel` supplies
`sessions-fixture.ts` through `SessionsViewState` to `SessionsView`. These are local producers, not
authoritative records; approved backend wiring replaces the producers while retaining the renderers,
layouts, and interactions.

Queue, Activity, and Explorer share `ActionBar`/`ActionBarRow`. Activity keeps four metrics in one
row: `text-page` values at 1024px and `text-workflow` values at wider desktop widths. Use `text-body`
for labels, ordinary counts, and shared `RecordTable` values—including confirmed transactions,
evidence coverage, and Run performance (12px / 18px, weight 400); `text-caption` for notes and
metadata; and `text-section` for group headings. Keep metric values tabular; unavailable durations
and evidence remain explicit. The Activity chart uses opaque bars. Explorer uses `text-workflow` for
its title and `text-section` for major groups. Logs uses `text-heading` for step and panel titles,
`text-body` for rows and supporting copy, and `text-caption` for timestamps, timeline labels and
metadata. Its restored compact timeline uses equal-width 10px bars above the logs. Sessions uses
`text-heading` for its panel label, `text-control` for workflow titles, `text-body` for current actions,
and `text-caption` for state, subject, node count, system status and elapsed time.

For Logs tables, use one opaque gray `ui-table` fill for each header and body. Leave tables open,
keep 16px between a heading and its table, and put timestamps before action icons. Balance displayed
values while keeping identifiers unsplit. Filled values use plain blue text without an input-like
border. Logs shows reads, fills, and clicks; internal computations are omitted. Screenshots appear at
the end of their associated step.
