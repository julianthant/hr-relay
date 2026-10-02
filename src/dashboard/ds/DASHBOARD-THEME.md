# Dashboard theme tokens

This guide records the shared Tailwind v4 palette and type scale used across the dashboard, including
the navbar, Activity, Explorer, Logs, Sessions, Settings and content-body primitives. Canonical semantic
colors and Tailwind mappings live in `dashboard-theme.css`; `tokens.css` maps DS, body, Settings and
shadcn neutral aliases to those values. Edit the canonical definitions when changing the palette.

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
| `ui-stroke-control` | Stronger control border | `#8b8b8b` | `#747474` |
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

The dashboard stylesheet imports this theme. Its neutral DS, content-body, Settings and shadcn aliases
resolve to the shared palette across the dashboard; `.ui-theme-scope` groups migrated presentation
utilities but does not gate those aliases. Activity, Explorer, Logs, Sessions, the navbar and
notifications use the `ui-*`, typography and `font-*` utilities. Presentation seams are `ActivityViewState`,
`ExplorerTimeline`, `LogPanel`/`LogFeed`, `SessionsViewState`, `NavbarData` into `NavbarView`, and
`NotificationsState` into `NotificationsView`. Current producers use local fixtures; approved backend
wiring must feed the same renderers and interactions.

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
The Session bar's Add workers action uses the outlined secondary button. An idle card without nodes
shows “Ready for the next run” above one full-width `ui-stroke-control` bar labeled “No run in progress.”
The Add workers dialog is 320px wide, with a 12px gap between fields and no fixed worker-count cap.

For Logs, hover/focus reveals named substeps and measured durations; unfinished steps disclose state
without a duration. Hover leaves the background unchanged; green bars darken to 90% brightness. Keep Completed
out of the header while retaining unfinished and failure states. The header, timeline and content use
`ui-panel`; table headers and rows use opaque `ui-table` fill. Leave tables open, keep 16px between a
heading and its table, and put timestamps before action icons. Balance displayed values while keeping
identifiers unsplit. Filled values use plain blue text without an input-like border. Logs shows reads,
fills, and clicks; internal computations are omitted. Screenshots appear at the end of their associated
step. Sessions uses canvas for its expanded well, panel fill for worker cards and table fill for system
tiles. The full bar toggles independently of Add workers; commands use accessible icons, and idle removal
returns focus to the bar without a worker-stopped strip.
