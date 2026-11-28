# Dashboard design system

`ds/ui.tsx` is the public primitive barrel. `ds/theme/tokens.css` owns CSS values;
`ds/theme/tokens.ts` supplies named class strings. `kit.html` renders the real primitives through
`kit/kit-page.tsx`. Start it with `npm run web` at `http://localhost:5174/kit.html`.

Product mock workflows start with empty queues; the mock composition supplies the sample runs. Automatic backups and repairs stay invisible in the dashboard.

## Guarded rules

`tests/architecture/dashboard/dashboard-design-rules.test.ts` fails a change under `surfaces/` or `app/` that adds a font weight outside 400/500/600, a px font size off the type scale, a fractional px value, a raw hex colour outside `ds/theme`, a date formatted outside `lib/date-format.ts`, a `.btn`, `.hub-btn`, `.hub-modal` or `.hub-field` rule, a CSS class no `.ts`, `.tsx` or `.html` names, `font-mono` or `font-data` in Logs or the queue, or a click handler on a non-button in the Duo setup window. Each failure says what to use instead (a `dsText` step, a `--ds-*` token, `formatInstantDate`, the ds `Button`, `Dialog` or `Input`). A kept exception sits in that file with its reason: the mark's SVG offsets and the standalone icon colours.

## Tokens

The neutral palette resolves through `--ui-canvas`, `--ui-panel`, `--ui-table`, `--ui-hover`,
`--ui-primary`, `--ui-secondary`, `--ui-muted`, `--ui-stroke`, and `--ui-stroke-control`.
The `--ds-*` aliases serve the shell, body, Settings, and overlays. Theme state uses
`data-demo-theme`; `useDemoTheme` consumes the current person’s canonical ordinary settings. Signed-out and preview defaults are neutral; browser storage is never adopted.

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
`section` 16px, `display` 20px, and `pageTitle` 20px. `caps` is for short group labels,
`nums` uses tabular figures in the body face, and `flush` removes extra line-box height beside a taller control.
`DsBodyScope` overrides type, spacing, row, control, and radius values for product content.
Use the scoped primitives rather than copying shell measurements into a body page.

## Primitives

PDF starts use the existing PDF picker and selected-file list. All attachments belong to one run;
confirmation names each original file. I-9's public parent and preview share `i9-check-start`, while
the `i9-check` person workflow remains a child. Its production source stays mock until activation.

| Family | Public components |
| --- | --- |
| Commands and short facts | `Button`, `BareButton`, `ButtonLink`, `IconButton`, `Badge`, `CountBadge`, `Chip`, `Kbd`, `Spinner`, `Skeleton`, `Separator`, `VisuallyHidden` |
| Status | `StatusPill`, `StatusDot`, `StatusIcon`, `DS_STATUS`, `DS_STATUS_ORDER` |
| Frames | `Panel`, `PanelHeader`, `PanelToolbar`, `PanelBody`, `PanelFooter`, `Card`, `CardHeader`, `CardBody`, `CardBase`, `CardFooter`, `CompareGrid`, `CompareCard`, `TakeoverFrame`, `FloatingSurface` |
| Product bodies | `DsBodyScope`, `PageHeading`, `PageHeader`, `PageBreadcrumbs`, `BodySection`, `TableList`, `TableToolbar`, `FormGroup`, `ResultRow`, `SectionLabel` |
| State and disclosure | `Banner`, `Refusal`, `EmptyState`, `Disclosure`, `Well`, `MetaLine`, `ChipRow`, `BulletList`, `Collapsible`, `Tabs`, `TabList`, `Tab`, `TabPanel` |
| Forms | `Field`, `Input`, `PathControl`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `SearchInput`, `UnitField`, `SecretField`, `ValueField`, `LockedValue`, `Dropzone` |
| Dates and choices | `Calendar`, `DateInput`, `DatePicker`, `DateRangeInput`, `RangeCalendar`, `ChoicePicker`, `SegmentedChoice`, `ToggleGroup` |
| Overlays | `Dialog`, `Drawer`, `Popover`, `ContextMenu`, `Tooltip`, their companion components, `TooltipProvider`, `ToastProvider`, `useToasts`, `Notice` |
| Data | `Table`, `THead`, `TBody`, `TR`, `TH`, `TD`, `ProgressBar`, `TimelineSteps`, `KeyValueList`, `RankedList` |

`PathControl` shows the current path in small monospace, middle-truncated past 30 characters (`/Users/julian…uments/Codex`), then a `Change` button; Settings title and description sit on the left. The full path is never added to a title or label, and nothing new leaves the machine.
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
| `cancelled` | Tinted neutral | Deliberate stop |
| `verifiedDone` | Solid green Done | Finished and read back |

A queue row marks a dry run with a "dry run" chip (the rehearsal chip, caps) before the status label; the Logs header and the identity bar keep the FlaskConical icon and "Dry run" in meta text.

`DS_ATTENTION_STATUSES` contains `waiting` and `failed`. A displayed status does not confer command
permission. Served actions and exact write authority decide which controls are available.

## Layout

Failed OCR children use the existing Retry icon button in their log-panel header when the server
serves that action. Member lines keep their existing navigation behavior.

The Start run subtitle is the workflow name alone, and browser choices read Visible and Hidden everywhere. A workflow that is not served yet stays in the rail and every list, and its Start run dialog opens for viewing; its final button is off with the line "This workflow is not available yet.", and nothing starts, toasts or joins the queue. The Steps stage is headed "Steps" with "N of M included" and the line "Turn off a step done by hand. Reads take manual values."; systems are spelled "UCPath". Run Options omit the policy/version footer, and the Run and Rerun dialog has two stages and no Confirm step (Run: Input, Start; Rerun: Steps, Start). The header is a 20 px title with the workflow and person as plain secondary text under it and the plain X of the small dialogs; the footer is the "workflow · N of M steps · priority" summary on the left and one 32 px button on the right (Next, then Start run), with no Back or Cancel and no key hint: the Input, Steps and Start tabs go back and the X cancels. While checks are read the button shows a spinner; with a failed check the summary reads "1 check failed". Start holds Options, Steps when customizing and Checks, and its button plans and, when the plan is clean, submits at once; a plan that stops shows its refusals, omission mismatch or expiry note and a second Start submits it. A write workflow that already wrote shows its repeat warning when Start is pressed, and the Steps tab or the X leaves it. The checks section reads the selected workflow's readiness when the dialog opens and lists only the checks that are not ready, problems first: title and description left; right, an amber triangle and Warning, a red ! and Failed, or a danger button named for the fix (Add password, Set location). While checks are read it shows only a spinner beside the "Checks" title, with no rows or skeleton. When every check is ready it shows one line, "Ready to start". Check copy tells staff what is wrong and what to do, with no runtime, dependency or configuration wording and never a check id. A failed check keeps Start off; warnings do not. A fixable failure's button opens its Settings section over the dialog, which stays mounted and hidden so everything typed, every picked spreadsheet and the stage survive; Settings closes with the X, focus moves into Settings on open and, once the checks are read again on return, back to that check's row. A check with no Settings fix shows Failed and no button. Parsed identifier entries use two columns with a total count and named remove buttons. Leaving the textbox normalizes delimited entries; Match tuples retain raw identifiers in the editor and mask the preview.
Start run and Rerun Steps stage rows come only from the rows the backend serves (key, label, system, kind, lock reason, fields); no workflow, step or field name is written in the dashboard. Every row shows its label and system. A switch row turns off to open its typed fields under the row; turning it on closes them and the dialog keeps what was typed while it stays open. A locked row keeps a disabled switch, no lock icon, and its reason ("Form action · required", "Approval required", or the served reason); where the backend offers it, "Enter manually" opens the fields. The first failing field is the only alert, tied to its field for assistive technology, and keeps Start off; more than one person typed is refused with one plain sentence. The heading's "N of M included" right-aligns with the row switches and leaves off switch rows out; at least one step stays included. A form action a skipped step's output feeds stays on with "Needs <step>. Turn off if done by hand." and holds Start until the operator turns it off; it is never switched off for them. Dates read and type MM/DD/YYYY. Rerun takes the person and input from the original run, so it has no Input stage. Its Steps stage shows each row's source badge (Completed, Skipped, Failed, Cancelled for a step the cancelled run began, Not started) and starts from the first step that did not complete, with earlier completed rows and skipped rows off; switching off a step that completed fills its fields with that run's values marked "From the earlier run" until edited; an unedited copy is sent as copied, an edited one as typed. A finished run with nothing failed reruns in one click: Rerun queues it with a short toast, and opens Start with the warning instead when the repeat warning fires. A dry run reruns as a dry run, and a protected original input or an unsupported dry run points to Start run. The large dialog's 20 px padding is the `[data-size="lg"]` rule in `ds/theme/tokens.css`.

Every search field (Settings sidebar and Shortcuts, Logs, tag and spreadsheet pickers, Activity, the sheet grid) is the one `SearchInput`, which takes no look variant: the Settings sidebar search, a 32 px full-radius pill outlined by a thin border on a near-empty fill, 14 px magnifier, 13 px grey placeholder. A caller sets only its width, which is its container's. The look lives in `ds-search-field` rules in `tokens.css`; no surface restyles it. Single-field Settings edit dialogs are small dialogs (see Dialogs) with no helper line; the Delete account row sits under a `Delete Account` section title. Every input section of the Run and Rerun dialog is one pattern: a 14 px medium title with a one-line description left, one button right (Add PDFs, Add spreadsheet), and a card of picked items under it. PDF documents ("One run for all files.") shows a dashed "Drop PDFs here" area with Choose PDFs while empty; References ("Optional.", or "Needs <fields>.") says "None added". A spreadsheet row reads its name, a worksheet chip whose menu searches that workbook's worksheets newest (last tab) first, and its version as quiet "v<n> · <Mon D>" text that is a menu. Add spreadsheet lists spreadsheets only, and a new one lands on its newest worksheet. Every runnable workflow's Run and Rerun dialog shows the per-spreadsheet Reference rows below its input; the OnBase Document type row sits above the PDF documents section, and Report start and Report end sit under a `Report period` title.

The app has a 1024×720 CSS-pixel minimum canvas. Queue remains beside Logs. Below the floor, the
page scrolls rather than switching to a phone layout. Workspace/workflow rails, the top bar, and
Sessions are shell chrome; Settings and intake replace the main region through `TakeoverFrame`.
Settings owns its sidebar, whose header control is a guarded back arrow, and holds General, Account and Keyboard only. Spreadsheets, Explorer and Analytics open in the main region with the rail, the Sessions console and the assistant in place.

`PageBreadcrumbs` precedes a child heading. Available parents call the existing route callback;
the last item is passive text. Wizard Back changes stages, while dismissal closes the layer.
`DsBodyScope` supplies a shared content width and body rhythm. Tables hold dense records, grids
hold aligned peer facts, and short chips carry facts that tolerate truncation.
The workflow rail is a flat list: one row per served workflow, each with its own lucide icon and no category labels. Below the workflows a `Data` label (the queue group-label style) heads Spreadsheets, Explorer and Analytics. The rail and the Settings sidebar share one width (`--ds-sidebar-width`, 264px); the Queue keeps its width and the Logs panel takes the rest. Below 1200px window width the rail renders collapsed and its toggle still expands it; collapsed, each workflow shows its icon with a tooltip, never letters.
Each rail row shows one number, its runs running now, as a green pill with a live dot left of the name,
hidden at 0 and read out as the row's description ("2 running").
The Baton mark appears only in the sign-up and login title: the 24 px accent symbol, then "Relay" at 23 px medium. Larger sign-up headers scale that pair together. The sidebar header is the Relay wordmark alone, at 23 px medium, beside the notifications bell and search. `favicon.svg` and the desktop icon sources come from `shell/app-logo.ts`.

Waiting, parked and failed runs sit under Needs you.

Double-clicking a run title in its queue row renames it in place, and the Logs header shows the same name: Enter saves, Escape cancels, and an empty name restores the default name (the PDF or run name). Queue rows draw no subtitle; a group's count chip ("12/12") carries its size.
Queue group headings (Needs you, Active, Finished today) are an uppercase label, a count pill and a hairline rule; under Finished today a separate dashed "Today:" box holds the outcome breakdown. A run card draws its title on the left and truncating, and the labels (test, dry run, warning count, status, member count) on the same line at the right; a long title gives way before the labels wrap. A run with one member keeps the member table like any group or batch. The selected card keeps the card fill and takes the loud border only. The search palette's filters (All, Actions, Runs, Workflows, Spreadsheets) are one row at the bottom, after the results, under a top border. Every page title, Settings and Analytics alike, is the 20px `pageTitle` step with no per-page size. A day with no runs shows one title, "No runs on this day", and the Start run button.
The queue column is `--ds-w-queue-column` (360px, the smallest width where a running card's footer fits; 336px below 1100px window width, where the footer also drops the run id). A running card's footer has Pause beside Cancel; on a group or batch card they read `Pause all N` and `Stop all N` and act on every member still running. Queue footers stay on one line. They show time, `#attempt`, trace text, and duration. Context about
how a run was created belongs in its information disclosure. Clicking anywhere on a member line selects
that member. Its name remains a keyboard-accessible button without a hover underline. Logs group ordered action entries
under steps; read/fill observations use aligned label/value rows with shared facts at the heading. Timeline segments are
categorical and equal width. Duration text carries elapsed time separately from segment width.

Pause and Resume live in the real row footer. Pause all runs is the pause icon in the queue toolbar; with nothing running it is dimmed and its tooltip reads "No runs to pause"; the quit
confirmation has no run list. A recorded pause reuses the outline Queued pill with a Paused label.
At compact action widths, Start a run uses its existing icon and accessible name so every toolbar control stays visible.
Sign-up method chips stay on one line, and Cancel sign-up lives in the Duo step footer with confirmation. The setup screen uses the house Select for method choice, with the same Security key name as its card; Duo setup asks for the security key only.
Settings navigation uses the workflow rail's row height, spacing, padding, and hover/selected fills. General's Appearance group has a Light/Dark toggle and an Animations switch without row descriptions or person names; preference feedback sits below the rows. Delete account is in Account. Its confirmation belongs to the active profile/session epoch, checked atomically by the server before deletion effects; pending and uncertain deletion stay disabled with visible feedback. General opens with an Assistant group: the ChatGPT status line (label and detail on the left, Manage usage and Disconnect or Connect on the right; a failed check shows the one-button notice without the frame) and the Full access switch; Appearance and Storage follow. There is no Subscription page; `?settings=subscription` opens General.
General's Storage group Clear run history row uses the existing destructive dialog with Cancel focused first. Active runs disable it with a visible reason; uncertain results offer a result-only Check clear result for the original action. Not recorded requires a new destructive confirmation. The Run picker hides parent-only previews; Explorer keeps them available for inspection.
Assistant proposals use a card with a tinted title row: the workflow, one fact per served row in served order (a person as Person "Last, First  EID <eight digits>", or EID alone, or Name alone; a Document; a File for an attached PDF; or a Request), a Total when there is more than one row, the mode, then Cancel and Confirm. Plan ids, fingerprints and stop-point text stay in logs. Confirmed and cancelled proposals collapse to a resolved line naming the one row or the served count. When a run the assistant started cannot finish, the chat shows one plain line, "Couldn't finish this.", with no card and no buttons; Relay never retries it. A Spreadsheets library card shows its fixed facts instead (workbook, file, name or version changes, counts) and resolves to "Done" or "Not done". Confirm applies to runs and Spreadsheets library changes: small local changes (notification read, unread, snooze) happen at once with no card, and the reply says what changed.
The assistant panel is closed when the page loads and opens from the launcher or ⌘J. Open, it always floats over Logs, at every width: 480px wide, 16px corners, a shadow, 12px from the window's right edge, 70% of the window height up to 560px and never under 360px, 20px above the window's bottom; its top stays below the Logs card's top edge while that leaves 360px, so it does not cover the top toolbar. Its header has no fill or divider of its own (the body's fill, the same in Chat, History and Activity); History is a search field with a 28px Chats / Activity toggle beside it. It has no logo: no mark in the header and no avatar beside replies. Logs, the queue and the workflow rail never move or narrow for it. The panel is not draggable. ⌘J (Ctrl+J) toggles it from anywhere. The launcher is the first icon of the queue header: a 28px icon button, tooltip `Assistant ⌘J`, 14px between the header's icons. At rest it is a plain 15px target (the approved mock); any other state shows the Orbit mark, which carries it: amber needs-you (never an accent dot), thinking while a reply is pending, working while a decision confirms, then done or error for a moment; reduced motion shows it still. Sessions is a console docked under the queue and Logs, never under the workflow rail: flush to the window's right and bottom edges, square corners, a top border only; the queue and Logs shrink to make room. It opens and closes from the Sessions console icon at the right end of the rail footer (pressed while open; a green dot while workers only wait, blue while any runs), beside Add workers (dimmed with a tooltip that says why while it cannot act); Settings and Log out sit at the footer's left end, under the signed-in profile. Opening from the icon moves focus into the console, and closing it (the console's ×) returns focus to the icon. Its 42px header is a chevron that collapses the cards, the users icon, `Sessions`, a short vertical divider and `2 running · 1 starting · 1 idle` as muted text, with × at the right end. The console sizes to its cards up to its height (320px at first), resized by dragging the top border or with the Up and Down arrow keys on it (120px at least, leaving 160px above it). The Settings takeover hides the rail and the console and has its own back arrow; on every Settings page the floating assistant is hidden and ⌘J does nothing, and all return as they were on Back. Icon controls are 28px with an 8px corner (24px with 6px on cards); hover is a soft tint on the hovered control only, press is a darker tint, and nothing moves, scales or glows; colour transitions last at most 120 ms (ease-out) and stop with reduced motion. The assistant's menus use the shared menu surface (16px corner, 8px rows, 14px text, 12px muted labels), and the composer buttons are 28px with 13px regular text. Its header holds the title and 28px history, new chat and close buttons. Replies are flat and operator messages are filled bubbles with name-only attachment pills. The composer is a borderless filled box with 20px corners (text on top; below it `+` and the approval mode on the left, and on the right the model menu (the model, its effort in a quieter tone and a chevron), a Voice button that stays off until voice input exists, and a round filled Send), with a quiet status strip above it. The strip shows the served account reason with its action (Sign in or Open Settings) and never blocks the dashboard or the composer. The assistant is usable as soon as ChatGPT sign-in works; there is no assistant test. Replies show only the answer, with no sources or failure codes. The composer has no focus ring on the box. The model and effort are picked in the composer's model menu (Select model, then Thinking effort), from the signed-in account's models and the effort list (Light, Medium, High, xHigh, Max); a pick shows at once and saves the selected person's choice without a chat turn, and a refused or unknown save goes back and shows the normal command toast. Until the models are served, the model and effort are plain muted text. The approval menu offers `Ask before every action` and, only while Full access is on, `Full access` (shown in orange in the composer). Served model and effort labels use the selected person's preference; with no served model only "Model unavailable" shows and the effort is hidden. Restored chat text keeps its source revision and cannot restore confirmation or verification authority.
Browser captures stay inline as their own screenshot rows, with equal cards and captions below. Before- and after-submit captures each keep their boundary caption.

The global failure notice (`FailureNotice`) is one dark strip, the same surface and border as the assistant's ChatGPT-account strip, which renders through it: a small warning triangle, ONE short sentence on one line (it truncates with an ellipsis, the full text on hover), and at most one small secondary button on the right (Retry, Open Settings, Sign in). No red fill, no code, no technical text, no second "what still works" line. It is for surface-level failures (a list, page or panel that did not load) and keeps 8px above the assistant chat bar. A failure that belongs to one card or control shows inside that card instead: a small triangle and a short status in the card's own description, and the card's own Retry button in its button spot (the Settings ChatGPT card); no separate notice above or below it. Settings changes are optimistic: the new value shows at once, nothing greys out and no "Saving" text shows; a failure reverts the value and toasts.

A skeleton is for a read that is really slow, on the part that waits for it. `Skeleton` and `LoadingRegion` mount at once with the settled content's size and stay invisible for the first 300 ms, so a faster read renders its data with no placeholder frame and nothing moves when it arrives. A skeleton never covers the rail or the Sessions console for a day that is still loading.

Warnings and failures are toasts (`Notice`, or `useToasts`): a title and at most one short line, with no code, outcome or explanatory paragraph. A one-off result (an action failed or was refused) dismisses itself. A state the operator must act on (unavailable storage, unread settings, a pending check) is `sticky`, stays until closed, and shows again whenever its surface mounts while the state still holds. A toast only notifies: a title and at most one short line under it, wrapped so the whole sentence reads, never a button or an X; clicking it (or Enter) dismisses it. Toasts sit top centre, 12px from the top and 320px wide, newest in front, enter and leave upward, and may cover a page's toolbar or heading; the open Sessions panel's top always ends 8px below the stack (expanded or at rest), its cards scrolling in what is left; at most 3 show and older ones fold behind, and hovering the stack opens it. It names only a page or control that exists, in plain words ("Fix it under Checks in the Start run dialog."); the control lives on that surface. These stay inline: field validation beside its input, anything inside a dialog or drawer (toasts are inert while one is open; a terminal Run/Rerun Start refusal closes the dialog and shows one 6000 ms “Run not started” toast with its catalog sentence), confirmations that need two choices, empty states, and a failed step's decision in Logs.
A text field (the searches, a dialog input, a secret input) shows focus as the caret plus its thin border one step brighter; it has no second ring. A dialog's own surface is a script focus target (`tabindex="-1"`), not a Tab stop, and the focus rule does not count it as a control.
Required browser slots without an observed session read “Not opened”; observed health failures stay “Unavailable”.

## Run logs

Shared by every workflow's served Logs (`projectRunLogs`); display only, so evidence and Run data keep every observation.

- Show one operator-readable sentence or labelled row per fact; never an internal control, selector, task, node or field name.
- Name a step's system as UCPath, CRM, Kuali and the like; local work shows no system.
- Show declared operator fields as aligned rows (label, eye or pencil icon, time, value). A declared value that was not kept reads "Not retained" in its row, once. A value Relay failed to read reads "Couldn't read" in a muted danger tone.
- Hide browser gestures whose label comes only from the UI registry; a gesture appears only through a declared operator label or field.
- Hide task diagnostics: an info note with structured fields repeats the labelled rows. Warnings and errors still show.
- Leave stage state to the timeline strip: no Pending, In progress, Completed or Failed lines. Skipped keeps one line, "Skipped · Not needed for this run"; a wait or cancel keeps its line.
- Never write a "<step> completed" line for a step with no rows.
- Label a capture with its step's system and "Browser"; its caption is its label, else its capture time.
- A failed step follows the failure rule under Decisions: its failure title, the catalog sentence for its code, and the write outcome in operator words ("Nothing was written."). Never "Write state: …", a developer remark about the panel, or a failure code.
- Do not repeat a fact between the card, the row, and the timeline.

### Type levels in Logs and Explorer

Use one level per role, from the existing scale, and never two roles at one level in the same view.

| Role | Logs | Explorer |
| --- | --- | --- |
| Page title | Not used | `PageHeading` |
| Section title (run title, "Run options") | `text-section` | `text-section` |
| Step title | `text-heading` | `text-section` |
| Decision question | `text-heading` | Not used |
| Page card title | `text-control` semibold | `text-control` semibold |
| Field and column label | `text-body` medium; column headers `text-caption` muted | `text-body` medium, secondary |
| Meta (time, system, mode, counts) | `text-caption` muted | `text-caption` muted |

Times, durations, capture times and IDs use the body face with tabular figures, never the data face; Time gives the formats.

### Steps

- One time per step, in the left column. Rows inside the step have no time.
- A step reads in order: page cards, clicks, captures, then its outcome line, then any decision.
- A page card shows the page name and its mode (Fill, Read) on the right. Its values sit in rows under it, or in one table when the page lists records.
- A click is a plain line with the pointer icon: "Clicked Search". Never draw it as a button.
- Every finished step ends with one outcome line in Explorer's words, with a check icon.

### Decisions

Every manual choice or input is one `DecisionCard` (`run-detail/logs/decision-card.tsx`) in the step, under the evidence it reads.

- Anatomy, in order: title (what happened, `text-heading`), one context line, the control, then Confirm (primary) and Cancel run (secondary, which cancels the run). Enter confirms; Escape only closes an open dropdown and never cancels.
- The control: a short choice list is a narrow dropdown (`w-80`, not full width) whose options each carry a one-line hint, with the recommended option preselected (read-back failed: Check again). A typed value is a labelled input. The primary reads Confirm when the control holds the answer; a card without a control names its action (Retry step, Resume, Approve match).
- Answered, the card stays in place with all its content (title, reason, While trying to, Last completed, value strip). Only the action row (buttons, Next step select) becomes one line: glyph, outcome in primary, then "<time> · <person>" in grey, the time in the Time format (or "assistant on behalf of <person>"). Outcomes: `Retried` (retry glyph) for Retry and other retry actions, `Run cancelled` (muted ban glyph) for Cancel run, `Match approved` (green check) or `Match rejected` (red X) for the identity review, `Resolved` for Resolve, and for a typed answer the confirmed value, `Transaction confirmed · T00000000` (green check). The identity strip label becomes `Approved` (green) or `Rejected` (red). No `Answered:` prefix, no option name, and no focus ring on an answered entry. Held and parked cards follow the same rule.
- The card never carries assistant suggestions or "use for all" choices. The recommended option is preselected, the assistant talks in its own panel, and a batch of the same fix goes through the assistant's Proposal card, which names each person.
- Picking one of several records has no card box. The step's own page card that lists them ("Search results") switches to mode Pick:
  - The icon column becomes the selection mark (an empty circle; a checked circle in the info colour when chosen), and the chosen row takes the selected surface.
  - Columns wrap; no value is cut off (operator decision on #795).
  - A status that needs attention (On leave) takes the warning colour.
  - Under the card comes the question as a step line, then Confirm (primary) and Cancel run, the same buttons as every decision. Confirm stays disabled until a row is chosen.
- The last row of every pick is a fill row for the operator's own value ("Enter employee ID", 8 digits; "Enter row number"), after any extra option such as "Add a new row". There is no "None of these" row: typing a value selects the fill row and clears any picked row, and picking a row clears the typed value. Confirm stays disabled until a typed value is valid. A typed employee ID is asked for only here, when Relay cannot find the person. A typed employee ID is never matched against the rows: Relay looks that ID up in a run that replaces this one, and the operator confirms the person it finds.
- A match to approve shows a Request and UCPath table. A different value is semibold in the warning colour and has a "differs" name for screen readers.
- A value to correct is the card's input, prefilled with what Relay read or typed.
- A failure uses the same anatomy. The question is the failure title in the danger colour (the card keeps the normal border; only the title is red), and the note is the catalog sentence plus the write outcome. The action is Retry step when nothing was written. There is no Add note action.
- When the site rejected a value Relay typed (phone, address, date, ID) and nothing was saved, the failure shows a labelled input prefilled with the rejected value and the primary "Retry with this <value>" ("Retry with this number"). It is never offered after a committed save.
- When a write saved but its read-back failed, the dropdown options are, in order: Check again (repeats only the read-back), "Checked by hand, continue", `Withdrawn in <system>, file again` and "Mark as failed" (ends this person's run as failed and files nothing). The file-again option names the written system (for example, "Withdrawn in UCPath, file again") and is available when Relay can read it again. "File again" first reads the system and proves the saved record is gone or withdrawn, then files once; if the record is still there, a toast refuses it. Relay never withdraws a submitted transaction itself.
- An unconfirmed write (parked, or uncertain after a restart) asks "Did the <record> save in <system>?". The note says what did not confirm and where to check. The dropdown offers "Saved in <system>" (preselected; with a number input when that system issues one) and "Not saved, <what Relay does next>".
- An Emergency Contact batch is one parent run for the PDF plus one member run per person, each with its own log. The queue row is titled with the PDF file name ("Scan_0412.pdf") and shows the standard member list with each person's status; there is no summary line. A failed member's own log shows the failure; Retry is the icon button in that log's header, and a rejected value adds the fix-and-retry input in the body. The parent log reads the document, records the approval and lists the records handed to members.
- A cancel in progress is one line with a loading icon. It has no actions.
- A refused command is a toast (title and one line). The transcript does not change.
- Buttons are standard size: Confirm, then Cancel run. Cancel run is secondary, never ghost text.
- No left rails, tinted bands, status pills inside the step, icon plus bold title plus grey subtitle, or helper paragraphs.

### Review records

Review records is a dialog, not a Logs view: every entry (Logs header Review, the queue card Review, the notification item, the Logs footer Records button) opens it over the dashboard and the Logs panel stays as it was behind the scrim.

- Size: the shared lg width (880px) by up to 800px tall, capped to the window with 24px margins.
- Header: `Review records` and the run name in grey; the standard 28px close. Escape and close keep the edits as a draft.
- Body keeps the record cards: page viewer left (page label, zoom out, zoom in, full screen as 28px icon buttons), record list and form right. Full screen makes the page viewer fill the dialog body (record column and footer hidden), the icon becomes Minimize with the tooltip "Exit full screen", and the page opens fit to the viewer. Escape leaves full screen first; a second Escape closes the dialog and keeps the draft.
- Footer: `N selected for approval` left; `Discard` and `Approve records` (primary) right. There is no Add record: new records come from running another session.
- Emergency Contact records show only what the workflow needs. Employee: Employee ID, Employee name, Date completed, Home address, Cell phone, Home phone. Emergency contact: Name, Relationship, Address, Cell phone, Home phone, Work phone.
- Built by `ReviewDialog` in `run-detail/review/review-dialog.tsx` over the ds `Dialog`; no ds change.

### Status signals

Each state keeps its own badge in the queue row and the run header, its own word in the step's time column, and its own timeline bar. Waiting uses one colour everywhere: the warning colour of the queue's Needs you band, the hatched timeline bar and the time column. Waiting, failed and parked runs sit under Needs you.

| State | Header and queue | Time column under the step time |
| --- | --- | --- |
| Waiting for you | Review (`waiting`), hatched warning timeline bar | "Waiting" and the wait time, warning colour |
| Write parked or uncertain submit | Write parked (`parked`, dashed), dashed warning outline timeline bar | "Parked" and the wait time, warning colour |
| Failed | Failed (`failed`) | "Failed", danger colour |
| Stalled | Failed with the label Stalled | "No progress" and the time, danger colour |
| Paused | Queued with the label Paused | "Paused", muted |
| Cancelling | Cancelling (`cancelling`), muted timeline bar | "Cancelling", muted |

## Explorer

Explorer is a generated review spec of what a workflow does. It never shows simulated runs or action buttons.

- Run options sit above the step list as a "Run options" section: a label above each select, in one row.
- Step 1 is "Open browser sessions", with a chip for each system the run signs in to. Logs never show this step.
- A step reads: title and system, one description line, check lines (outside page cards), page cards, clicks as plain lines ("Clicks Search").
- A decision point is a select under the evidence it reads, including terminal reads such as employment status (Active, Inactive, Not found). It lists only the outcomes the workflow declares there, with what happens next beside it; there is no "Anything else" entry. Changing it changes the steps below.
- The line for a failure the workflow does not list shows once, at the top, above the first step.
- The workflow picker in the heading lists child workflows indented under their parent.
- Explorer renders steps, page cards, field rows, click lines, pick tables and notes through the shared components in `surfaces/shared/steps/`, the same ones the Logs panel uses. It holds no copy of them; a change to their look is made there once.
- When an outcome stops the run, the steps after it are hidden and the run's end line states the stop in the danger colour, once.
- There is no "If" label. Fill values keep their source button. Sample values come from the definition's examples.

## Assistant

The assistant mark is **Orbit**: a core, a thin orbit and one satellite (`surfaces/shell/assistant-mark.tsx`). It is the message avatar, the panel header icon and the Logs "by the assistant" line, and it never uses a sparkle or another brand's shape. Its state shows in shape and colour; motion is CSS only, short, and stops with reduced motion or Animations off.

| State | Mark | Motion |
| --- | --- | --- |
| idle | Ring, core and the satellite; the launcher draws a plain target instead | None |
| thinking (the model is writing) | Hollow blue core, blue satellite | The satellite orbits slowly |
| working (a session or run is going) | Blue core, dashed blue orbit | The satellite orbits fast |
| done | Green core; the satellite docked at the top | One settle |
| needs you (a decision waits) | Amber core and a halo | A gentle halo pulse |
| error | Red core, broken orbit, no satellite | None |

The assistant operates the dashboard through the operator's own commands and checks; it never edits workflows or code. It writes like a person: the answer sentence comes first, and it never explains behaviour that Relay enforces.

### How the panel shows data

Everything in the panel is conversation: sentences and bullets. Links are blue (underlined on hover, with a pointer cursor), and they only open data: a person, a run, a log, or Show in Queue. A link never acts. Actions happen only when the operator asks, or replies yes to a question. The panel has no buttons, checkbox rows, cards, tables, tokens, tinted boxes or Undo controls. Red appears only on a failure word.

| Amount | Shape |
| --- | --- |
| One fact | One sentence; the value in medium weight. |
| A list (people, runs, values, options) | A sentence, then one bullet per item; names and run ids are blue links that open the run. |
| More than 8 items that are not an approval | One sentence with the count and a "Show in Queue" or "Save to library" link. |

- **Changed and new values** are blue, the same as Fill values in Logs. A changed value shows the old one struck through and muted, then the new one in blue. A source shared by every value is named once in the sentence ("From Kuali SIM-50112."). A value with its own source names it in brackets after the value ("(Scan_0412.pdf · page 2)"). Relay refuses a manual value with no source: a toast "Value needs a source", and a sentence saying what to provide.
- **Starting a run** (anything that leaves the machine: saves, submits, re-filing, gate answers, starting OCR) is a sentence and bullets with the exact values, then one line: "Reply yes to file it, or tell me what to change." A batch lists every person and says "Reply yes to save all 3, or tell me which to skip or change." A run is real unless the operator asks for a dry run; then the sentence starts "Dry run, saves nothing."
- **Approval is a typed yes that Relay recognises, never the model.** Relay treats the operator's next message as approval only when it is a short, explicit yes ("yes", "yes file it", "approve", "go ahead", "do it"). Anything else goes to the model as a change request, and it proposes again. The model can never approve. After a yes, a muted line under the operator's message records it ("You replied yes · 09:31"); whether each row was filed is shown by that row's own result.
- **Running** is the session chip, which sits in the assistant message column with the assistant avatar to its left, like any reply. It has a spinner aligned to the title line, what is happening ("Checking UCPath…"), a muted line naming the workflow and person, and a fully rounded Stop pill. Read-only sessions (Person Lookup, UCPath or Kuali checks) start without asking and appear in Queue and Logs, with the line "Started by the assistant for <person> · read only". Watching runs uses the same chip; it lasts while any run started today is active, and a decision that needs the operator raises a sticky toast with Open.
- **Edits** (spreadsheets, library, settings, run names, filters) apply at once: one sentence with the old value struck through and the new value in blue, plus a success toast with no action. To undo, the operator asks ("undo the tracker change"); the assistant finds the change in its Activity, reverts it, and states it the same way ("Changed Separations tracker row 65 back: 04/24/2031 → 04/23/2031.").
- **A stopped run** is the reason in one sentence (the failure word red), then a question ("Want me to retry from Read timecard?"); the operator replies yes.
- **A failure** is "Failed: <what>. Nothing was saved." followed by a question ("Want me to try again?"), never a link.
- **A choice** lists the options as bullets and asks for a reply ("Reply with its number."); ids may link to the record they name.
- **Refusals and blocks** are one sentence: what was not done, the real reason and one link ("Not started: T00042871 is already pending, filed today 09:33. Open log"). A message with no reply is a danger toast "No reply" with Retry; the message stays in the composer.
- **Several matches for a navigation** ("Open today's EC failures"): Relay filters the Queue to them and opens the first in Logs, and the chat lists each one as a bullet link.

### Decisions in Logs

- The Logs `DecisionCard` has no assistant suggestion. What the assistant thinks about a decision lives in its panel.
- The assistant answers a decision only when Relay confirms the evidence the decision declares. The check is its own step in that log ("Checked by the assistant for <person> · read only"), and the card keeps its content with the outcome line "<outcome> · <time> · assistant on behalf of <person>".

### History

The history icon opens History, with two tabs: Chats (the chat list) and Activity (today's reads, sessions, edits, approvals and refusals as rows, each opening its log).

## Time

One formatter draws every time, in the body face with tabular figures; the data face is not used for times, durations or ids, in Logs and in the queue footer. Time is "1:55 PM"; time with seconds in Logs "2:00:02 PM"; date "Nov 18, 2026"; date and time "Nov 18, 2:19 PM", with the year only when it is not the current year; duration "6m 47s".

## Dialogs

Dialogs use three widths: sm 520px, md 560px and lg 880px; Review records and the screenshot viewer use lg. Every dialog is one soft card: a 20px corner, no border, the `--ds-dialog-bg` fill, a 20px semibold title, a plain 16px close X with no box at rest, fields through `Field` in a `DialogBody`, and Cancel (secondary) then one primary confirm on the right; footer buttons are 32px tall with a 10px corner, sized to their label, 12px apart, and a confirm that is off is flat grey (`--ds-button-off-bg`), never a faded accent. A small dialog (single-field edits, renames, confirmations) has a 20px inset, the X centred 28px in from the top right corner, a 13px medium label over a 36px field with an 8px corner, and the field 20px above the footer. An edit's Save stays off (flat grey) until the value is valid and changed. The UCPath username and password are required, so no Settings row or dialog offers to remove them. A destructive confirmation is a question naming the thing ("Delete this run?"), one sentence saying what is lost, Cancel focused first and a red button naming the action ("Delete run"); it shows no ids or revisions. Add workers is one sm dialog with no description line and one row: the workflow select, each choice ending `· N now` (the workers that workflow already has), and one Workers stepper (a single bordered control: minus, count, plus, minimum 1); the confirm reads `Add N workers` (`Add 1 worker`).

## Sign-in

Log in, sign-up, Duo and ready share one 440px column whose left edge and title position never move; the stepper sits in the gutter left of the column. Fields carry no asterisk; an error is red text and a danger border; password reveal is the eye icon button everywhere. The Duo setup window is Relay's own (the Relay lockup and "Duo setup"), built from ds primitives, with one status per method (Not started, Waiting for Duo, Added) and one primary action per state. The Relay session actions are "Log in" and "Log out" everywhere.

## Data screens and notifications

- Spreadsheets: in the dark theme a workbook cell fill is drawn as an 18% tint with the normal text colour; the light theme draws it in full.
- Spreadsheets import: Import is a menu (From this computer, SharePoint link), never a dialog first. A picked file opens a draft page (name, tags, preview) with Discard and Add to library; the draft is not in the library until added, and Discard drops it.
- Spreadsheets tags and pins: + on the draft page and on every list row opens one tag menu: search the library's tags, check to add, type to create. A list row shows a pin where Download was, filled when pinned; Download lives in ⋯.
- Spreadsheets mapping: a Columns side panel sits beside the grid. Its top control lists the worksheets with "matched of total" and a search; a fully matched worksheet shows no note. Below it every field shows its column and sample values; picking one marks and scrolls its column. "Use for all N worksheets" copies this worksheet's mapping to worksheets with the same headers.
- Analytics: Runs is the one chart, stacked bars in the Done, Failed and Needs attention status colours, under five figures that double as its legend. Each Workflows row carries a thin result bar in the same colours; Messages and Proposed actions are small neutral lines. Counts and times in one row come from the same runs.
- Notifications: items of the same kind and subject fold into one with a count and the latest time. Every item names its workflow and run and shows a relative time.

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
- Panel notices belong to their panel's coordinate space; the toast viewport is top centre.
- The rail footer holds the only Sessions controls outside the console (the console icon and Add workers); the worker cards live in the docked console.
- Sessions: every worker is a card, an idle one included (workflow, Idle, "No run assigned", its browser chips, "Available" and Remove). While a request is pending the card shows it in place: a Remove reads Removing on the status word with its button off, and an add shows one pending card ("Starting") first in the strip; one hidden status line in the panel announces both to screen readers. The cards are one row of equal height that scrolls sideways, the next card peeking at the right edge; the strip takes keyboard focus and the arrow keys scroll it. The open console is as tall as one card (two-row chip grid) however many workers there are. A card has a header (workflow, status dot and word), a subject line (the person), browser sessions (the chip grid, two per row), one divider line and the footer (elapsed time left; Pause or Resume and Stop on live cards, a labelled secondary Retry on failed and stopped cards, 24px icon buttons with a 6px hover corner, in a 28px row; elapsed time 12px; 8px between the divider and the footer, 12px under it). There is no progress block: no step title, step count, segmented bar or note line. Card padding is 16px each side and 12px top and bottom; chips are 32px tall with caption text, a 12px icon, 8px side padding and 6px gaps, the system name left and its status right; a lone chip keeps half width. A settled card's reason (a recorded refusal's catalog text, "Worker stopped unexpectedly.", "This step failed.", a pending pause or stop) rides on the status word as its tooltip and screen-reader text. A browser row that needs sign-in reads "Needs Duo" or "Signed out" (amber); an unavailable row keeps its served reason in its tooltip. Starting cards use the same structure. A card Relay could not build keeps its place with the amber status "Unavailable" and the worker number, the reason in the browser area and no controls. A workflow has at most four systems, so browser sessions are always the chip grid, never a dot list; past four the card widens to three chips per row. A long system name gets a short nickname (SNow, SP) so a chip never wraps, with the full name (and an unavailable row's served reason) in the chip's text for screen readers and in a design-system tooltip a keyboard can reach.
- Every surface uses ds `Button`, `Dialog`, `Input`, `SearchInput`, `Chip`, `Kbd`, `Table` and `EmptyState`; no surface stylesheet defines its own button, field, dialog or chip.
- A `SegmentedChoice` has no track: options are muted text and the selected one is a 28px pill with an 8px corner, 10px side padding and a soft fill (`--ds-segment-thumb`), 2px apart; nothing slides. Give free space to the control group rather than multiple `ml-auto` siblings.
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
- Keyboard focus is a 2px ring (`--ds-focus-ring`, the info blue) on every control, in both themes, with no fill and no change to the control's text; pointer focus draws nothing, and programmatic takeover focus draws no extra default browser ring.

Compare against the approved mock before judging a visual difference, and read
[the wiring contract](../../docs/reference/frontend-backend-integration.md) before replacing a producer.

Account (nav id `credentials`) uses existing ResultRow components for the signed-in profile name and per-word initials. Both are read-only; their values come from bootstrap actor.label.
