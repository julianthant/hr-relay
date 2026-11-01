# Dashboard design system

`ds/ui.tsx` is the public primitive barrel. `ds/theme/tokens.css` owns CSS values;
`ds/theme/tokens.ts` supplies named class strings. `kit.html` renders the real primitives through
`kit/kit-page.tsx`. Start it with `npm run web` at `http://localhost:5174/kit.html`.

## Tokens

The neutral palette resolves through `--ui-canvas`, `--ui-panel`, `--ui-table`, `--ui-hover`,
`--ui-primary`, `--ui-secondary`, `--ui-muted`, `--ui-stroke`, and `--ui-stroke-control`.
The `--ds-*` aliases serve the shell, body, Settings, and overlays. Theme state uses
`data-demo-theme`; `useDemoTheme` owns the browser preference.

| API | Use |
| --- | --- |
| `dsSurface` | `page`, `bodyPage`, `card`, `recess`, `raised`, `overlay`, `scrim`, `selected` |
| `dsFg` | Base, secondary, muted, faint, inverse, link, and danger text |
| `dsBorder` | Subtle, base, strong, and loud edges |
| `dsRadius` | `xs`, `sm`, `md`, `lg`, `xl`, and `pill` shapes |
| `dsElev` | Low card separation, mid floating surfaces, and high dialogs/drawers |
| `dsFocus`, `dsFocusWithin` | Keyboard focus and composite focus |
| `dsLayer` | Sticky, menu, drawer, modal, toast, skip-focus, and toast viewport/card stacking |
| `dsSize` | Control/row/bar heights, rail width, body width, and session pipeline band |
| `dsGap`, `dsPad` | Named internal, control, card, and section spacing |
| `dsClip.token`, `dsClip.text` | One-line token shell paired with a shrinking ellipsis child |
| `dsIcon` | `sm` 12px, `md` 14px, and `lg` 16px glyphs |

`dsText` provides `micro` 10px, `meta` 11px, `body` 12px, `ui` 13px, `title` 14px,
`section` 16px, `display` 20px, and `pageTitle` 27px. `caps` is for short group labels,
`nums` uses tabular monospace, and `flush` removes extra line-box height beside a taller control.
`DsBodyScope` overrides type, spacing, row, control, and radius values for product content.
Use the scoped primitives rather than copying shell measurements into a body page.

## Primitives

| Family | Public components |
| --- | --- |
| Commands and short facts | `Button`, `BareButton`, `ButtonLink`, `IconButton`, `Badge`, `CountBadge`, `Chip`, `Kbd`, `Spinner`, `Skeleton`, `Separator`, `VisuallyHidden` |
| Status | `StatusPill`, `StatusDot`, `StatusIcon`, `DS_STATUS`, `DS_STATUS_ORDER` |
| Frames | `Panel`, `PanelHeader`, `PanelToolbar`, `PanelBody`, `PanelFooter`, `Card`, `CardHeader`, `CardBody`, `CardBase`, `CardFooter`, `CompareGrid`, `CompareCard`, `TakeoverFrame`, `FloatingSurface` |
| Product bodies | `DsBodyScope`, `PageHeading`, `PageHeader`, `PageBreadcrumbs`, `BodySection`, `TableList`, `TableToolbar`, `FormGroup`, `ResultRow`, `SectionLabel` |
| State and disclosure | `Banner`, `Refusal`, `EmptyState`, `Disclosure`, `Well`, `MetaLine`, `ChipRow`, `BulletList`, `Collapsible`, `Tabs`, `TabList`, `Tab`, `TabPanel` |
| Forms | `Field`, `Input`, `PathControl`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `SearchInput`, `UnitField`, `SecretField`, `ValueField`, `LockedValue`, `Dropzone` |
| Dates and choices | `Calendar`, `DateInput`, `DatePicker`, `DateRangeInput`, `RangeCalendar`, `ChoicePicker`, `SegmentedChoice`, `ToggleGroup` |
| Overlays | `Dialog`, `Drawer`, `Popover`, `ContextMenu`, `Tooltip`, their companion components, `TooltipProvider`, `ToastProvider`, `useToasts` |
| Data | `Table`, `THead`, `TBody`, `TR`, `TH`, `TD`, `ProgressBar`, `TimelineSteps`, `KeyValueList`, `RankedList` |

The ContextMenu primitive remains available, but Queue rows do not mount row context menus.
`DatePicker` exports `DateInput` under another name. Date controls display `MM/DD/YYYY` while wire
values remain ISO dates. Partial segments remain editor state.

## Status vocabulary

`DS_STATUS_ORDER` is the reading order. Status uses wording and shape as well as color.

| Key | Presentation | Meaning |
| --- | --- | --- |
| `waiting` | Solid blue Review | A decision gate needs the operator |
| `failed` | Solid danger | Error requiring inspection |
| `parked` | Dashed warning | A write outcome is unknown and needs reconciliation |
| `doneWarnings` | Tinted Done with warning count | Finished with warnings; accessible name is Done with warnings |
| `running` | Tinted activity with spinner | Worker owns the run |
| `cancelling` | Tinted activity | Cancellation requested, not settled |
| `queued` | Outline | Accepted, not started |
| `cancelled` | Solid neutral | Deliberate stop |
| `verifiedDone` | Solid green Done | Finished and read back |

`DS_ATTENTION_STATUSES` contains `waiting` and `failed`. A displayed status does not confer command
permission. Served actions and exact write authority decide which controls are available.

## Layout

The app has a 1024×720 CSS-pixel minimum canvas. Queue remains beside Logs. Below the floor, the
page scrolls rather than switching to a phone layout. Workspace/workflow rails, the top bar, and
Sessions are shell chrome; Settings and intake replace the main region through `TakeoverFrame`.
Settings owns its rail and guarded back arrow. Analytics and Explorer mount inside Settings.

`PageBreadcrumbs` precedes a child heading. Available parents call the existing route callback;
the last item is passive text. Wizard Back changes stages, while dismissal closes the layer.
`DsBodyScope` supplies a shared content width and body rhythm. Tables hold dense records, grids
hold aligned peer facts, and short chips carry facts that tolerate truncation.

Queue footers stay on one line. They show time, `#attempt`, trace text, and duration. Context about
how a run was created belongs in its information disclosure. Logs group ordered action entries
under steps; read/fill observations use aligned label/value rows with shared facts at the heading. Timeline segments are
categorical and equal width. Duration text carries elapsed time separately from segment width.

## Motion

`dsMotion.base` is a 140ms color/fill/edge transition. `fast` is a 90ms command hover/press,
`enter` a 150ms arrival, `exit` a 90ms departure, and `move` a 220ms spatial change.
`dsTravel.sm` and `dsTravel.md` represent 4px and 8px travel. Reduced-motion rules remove animation.
Use `useDsEnterTransition` for arrivals without a primitive-owned open state.

Keep reading content stationary: no animated log text, automatic focus jumps on live status
updates, or width animation on categorical timeline segments. Existing transition classes handle
status fill changes without changing the information's position.

## Composition rules

- Keep the specimen limited to `ds/**` and `lib/**`, with local fixture identities rather than workflow IDs.
- Read each attempt as a complete surface; do not invent an automatic cross-attempt comparison.
- Compose public primitives; change a shared variant at its owner instead of forking a component.
- Use defined tokens for color, size, radius, depth, and duration; verify any runtime custom property has an actual writer.
- Keep the theme root above Tooltip and Toast providers so their fragment siblings inherit tokens.
- Reserve the toast viewport's bottom inset for the Sessions bar; panel notices belong to their panel's coordinate space.
- Let a segmented frame own its height and make segments fill it; give free space to the control group rather than multiple `ml-auto` siblings.
- Use `CardBase` with a growing body for aligned card bottoms and `CompareGrid` for peer records that share row tracks.
- Put facts shared by every row on the group heading; show per-row departures next to the affected value.
- Print IDs, paths, trace values, permanence, and refusal sentences as wrapping text when truncation would hide their meaning.
- Keep a nested ID's full identity in state and search even when display drops a repeated parent prefix.
- Apply `break-all` to an unbroken value, not its whole label cell.
- Show served summaries, codes, and permanence in shared record heads so every consumer receives them.
- State both boolean outcomes when silence would mean missing authority; distinguish measured zero, missing duration, and unavailable counts.
- Put confidence beside the verdict it qualifies and keep independently derived facts visible until their agreement is proven.
- Preserve every distinct capture availability/provenance arm; dimensions come from verified bytes, never guessed geometry.
- Latch image selection and viewport through background refresh; image controls must not cover document text.
- Use one row pattern for fixed and editable Run Options, with a fixed value’s reason visible.
- Derive visible form-group membership and numbering together; a workflow that declares no flags shows no empty flags group.
- Offer spreadsheet intake from its declared capability and show only reachable launcher stages.
- Move labels and shared file-limit text with an upload control; intake routes always identify a real session.
- Use `TakeoverFrame` for a full-page replacement and keep nested Settings sections free of duplicate takeover chrome.
- Preserve arrival focus and restore the launching control or main region when a takeover closes.
- Represent a navigation state outside a switcher's choices explicitly instead of highlighting Dashboard under another page.
- Derive count badges and explanatory text from the same inputs, including pool excess and rollups.
- Keep operation, member, and linked-child distinctions; deletion admission follows actual parent authority, not visual row kind.
- Keep local validation/refusal feedback visible beside the dispatch; never present a local check as a server acknowledgment.
- Move a replaced control’s labels, limits, and reachable destination with its replacement.
- Keep approval controls, safe retry advice, write state, and remediation visible; disclose diagnosis without hiding safety facts.
- A status or field mark belongs beside the exact fact it qualifies and uses the complete run/step/field identity.
- Do not replace an explicit unavailable section with an empty table or an invented success value.
- Preserve the approved component's copy and shape; a backend fact requiring a UI change goes through operator approval.

## Accessibility

- Every control has a computed accessible name; a clickable label or `title` alone does not prove it.
- Use `aria-labelledby` for button-based Checkbox controls and a named role for labeled groups.
- Keep important explanations visible or behind keyboard-reachable controls; hover is not their only route.
- Give disclosure triggers real controls and preserve focusability when an action disappears.
- Keep timeline waits visible even when a step has no ordinary event slot.
- Distinguish task duration from execution duration with the exact label and source bound.
- Keep icon/text items together when wrapping; a warning icon on a line by itself loses its referent.
- Preserve complete accessible names, copy, search, and selection when clipping paint or deferring offscreen layout.
- Do not duplicate a visible reason in a tooltip that makes assistive technology announce it twice.
- Use live regions for changes, not every standing fact rendered on mount.
- Keep focus rings on interactive controls; programmatic takeover focus does not draw an extra default browser ring.

Read [PARITY.md](PARITY.md) before judging a visual difference and
[the wiring contract](../../docs/rebuild/reference/frontend-backend-integration.md) before replacing a producer.
