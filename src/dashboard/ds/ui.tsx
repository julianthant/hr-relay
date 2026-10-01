/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/demo-ui.tsx
 */
/**
 * The dashboard's design system, in one import.
 *
 *   import { Button, Panel, StatusPill, … } from "../ds/ui.js";
 *
 * READ `DESIGN.md` (same folder) BEFORE building a surface on top of this.
 * It is short and it is binding: token names, the status mapping, layout and
 * motion rules, the accessibility floor, and the list of things never to do.
 *
 * Rules of engagement for builder agents:
 *   1. Compose these primitives. Do not fork one to add a variant — add the
 *      variant here, so every surface gets it.
 *   2. Never write a raw colour, size, radius, shadow or duration in a
 *      component. If a value is missing, add a token in `ds/tokens.css`.
 *   3. Never render a status any way except `<StatusPill>` / `<StatusDot>`.
 *   4. Every interactive element is keyboard-reachable and shows the one
 *      focus ring. This demo is asserted through the accessibility tree, so a
 *      missing label is a broken build, not a polish item.
 */

import "./tokens.css";

export { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./shadcn-collapsible.js";

export {
  dsText,
  dsSurface,
  /**
   * The one truncation vocabulary — `dsClip.token` on a single-line token's
   * shell, `dsClip.text` on the child that may be too long. Reach for the PAIR:
   * either half on its own is the defect (overflow with no ellipsis, or a
   * `truncate` that can never shrink because its flex parent said `min-w:auto`).
   */
  dsClip,
  dsFg,
  dsBorder,
  dsRadius,
  dsElev,
  dsFocus,
  dsFocusWithin,
  dsMotion,
  dsLayer,
  dsSize,
  dsGap,
  dsPad,
  dsIcon,
} from "./tokens.js";

export { useDemoTheme, DEMO_THEME_ATTR, DEMO_THEME_LABEL } from "./theme.js";
export type { DemoTheme } from "./theme.js";

export {
  Button,
  BareButton,
  ButtonLink,
  IconButton,
  Badge,
  CountBadge,
  Chip,
  Kbd,
  Spinner,
  Skeleton,
  Separator,
  VisuallyHidden,
} from "./primitives-core.js";
export type {
  DsButtonProps,
  DsButtonLinkProps,
  DsButtonVariant,
  DsIconButtonProps,
  DsBadgeProps,
  DsChipProps,
} from "./primitives-core.js";

export {
  DS_STATUS,
  DS_STATUS_ORDER,
  DS_ATTENTION_STATUSES,
  dsStatusText,
  dsStatusAccessibleName,
  StatusPill,
  StatusDot,
  StatusIcon,
} from "./primitives-status.js";
export type {
  DsStatus,
  DsStatusSpec,
  DsStatusTier,
  DsStatusPillSize,
} from "./primitives-status.js";

export {
  ActionBar,
  ActionBarRow,
  Panel,
  PanelHeader,
  PanelToolbar,
  PanelBody,
  PanelFooter,
  Card,
  CardHeader,
  CardBody,
  /**
   * The bottom edge of a card. Reach for it whenever cards sit side by side and
   * something trailing — a button, a caveat, a pair of compared facts — has to
   * land on ONE line across the row instead of wherever each card's own content
   * happened to stop. Needs `<CardBody grow>` (or a flex-column card) above it.
   */
  CardBase,
  /**
   * Cards read ACROSS rather than down — two identity candidates, a pair of
   * compared readings. `CardBase` pins the bottom edge only; this shares the
   * ROW tracks, so name lines up with name and reason with reason however
   * differently they wrap. Supports any number of cards; three wrap into a
   * second band with its own tracks.
   */
  CompareGrid,
  CompareCard,
  CardFooter,
  SectionLabel,
  PageHeader,
  DsBodyScope,
  PageHeading,
  FormGroup,
  BodySection,
  ResultRow,
  /**
   * The root a full-page takeover wears: full-bleed under the top bar, and the
   * one place the shared arrival lives (D275 item 2). Never wrap it in a
   * `Panel` — the card frame is what makes a page read as a region.
   */
  TakeoverFrame,
  Banner,
  Disclosure,
  MetaLine,
  /**
   * A wrapping row of PEER facts. Reach for it instead of `flex flex-wrap`
   * whenever a set of chips can wrap — it is what gives every line the same
   * ending edge, so a four-fact row never reads as three plus an orphan.
   */
  ChipRow,
  Refusal,
  BulletList,
  EmptyState,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  Well,
  FloatingSurface,
  /**
   * Make a surface that has just MOUNTED arrive instead of appear. Spread it
   * onto the element and describe where it comes from with
   * `data-[demo-enter=from]:` classes — the house mechanism for anything Radix
   * does not already give a `data-state` to.
   */
  useDsEnterTransition,
} from "./primitives-layout.js";
export type { DsBannerTone } from "./primitives-layout.js";

export {
  Field,
  useFieldControl,
  Input,
  PathControl,
  Textarea,
  Select,
  Checkbox,
  RadioGroup,
  Switch,
  SearchInput,
  UnitField,
  SecretField,
  /**
   * The correctable/locked value pair. Reach for these anywhere a surface shows
   * a value the run OBSERVED — never re-draw a bare `<input>` for one, or it
   * ends up invisible at rest the way the Data ledger and the OCR review both
   * did before they shared this.
   */
  ValueField,
  LockedValue,
  /**
   * The one place bytes enter this system. A real `<input type="file">` inside
   * a `<label>`, so the drop target and the browse control are one control —
   * and it never filters a dropped file itself, because the server is what
   * refuses a file by name.
   */
  Dropzone,
} from "./primitives-form.js";
export type { UnitFieldProps, SecretFieldProps } from "./primitives-form.js";

export { DateInput } from "./primitives-date.js";

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogBody,
  DialogFooter,
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  Popover,
  PopoverTrigger,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  /**
   * An object's own commands, on the object. Right-click (or the platform's
   * context-menu key, or the shortcut a shell binds through
   * `openContextMenuFor`) — never a `⋯` button, which is a control whose only
   * job is to admit there are more controls.
   */
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  openContextMenuFor,
  Tooltip,
  TooltipProvider,
  ToastProvider,
  useToasts,
  useDsModalPresence,
  useDsModalOpen,
} from "./primitives-overlay.js";
export type {
  DsDialogSize,
  DsDrawerSide,
  DsPopoverSide,
  DsPopoverWidth,
  DsToast,
  DsToastTone,
} from "./primitives-overlay.js";

export {
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  ProgressBar,
  TimelineSteps,
  KeyValueList,
  RankedList,
} from "./primitives-data.js";
export type { DsRankedItem, DsSortDirection, DsStep, DsStepState } from "./primitives-data.js";
