# Dashboard theme tokens

This guide records the reusable Tailwind v4 palette and type scale introduced with Logs. The
canonical values and Tailwind theme mappings live in `dashboard-theme.css`; use those definitions
when changing tokens.

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
| `text-page` | 20px / 28px | semibold | Page titles |
| `text-workflow` | 27px / 32px | 650 | Explorer title |

`w-log-time` and `w-log-label` use the named spacing tokens; `max-w-log-capture` uses the named
capture container token. `lib/utils.ts` extends `cn()`'s Tailwind merge groups with all seven text
utilities, so conditional size classes resolve by precedence instead of leaving both classes.

## Incremental adoption

The dashboard stylesheet imports this theme. Put `.ui-theme-scope` on the migrated surface root,
then use the `ui-*`, typography, and `font-*` utilities. Explorer scopes shared controls to the
`ui-*` palette, while other DS consumers outside that scope keep their current styling. Adding
these global custom properties does not reskin them. Migrate surface by surface as later dashboard
work adopts the palette.

For Logs, use one opaque gray `ui-table` fill for each table's header and body. Leave tables open,
keep 16px between a heading and its table, and put timestamps before action icons. Balance displayed
values while keeping identifiers unsplit. Filled values use plain blue text without an input-like
border. Logs shows visible reads, fills, and clicks; internal computations are omitted. Screenshots
appear at the end of their associated step.
