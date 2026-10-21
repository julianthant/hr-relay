/** The dashboard's design system, in one import.
 * import { Button, Panel, StatusPill, … } from "../ds/ui.js" */

import "./theme/tokens.css";

export { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./primitives/shadcn-collapsible.js";
export { PageBreadcrumbs } from "./primitives/page-breadcrumbs.js";

export {
  dsText,
  dsSurface,
  /** The one truncation vocabulary — `dsClip.token` on a single-line token's
 * shell, `dsClip.text` on the child that may be too long. Reach for the PAIR */
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
} from "./theme/tokens.js";

export { useDemoTheme, DEMO_THEME_ATTR, DEMO_THEME_LABEL } from "./theme/theme.js";
export type { DemoTheme } from "./theme/theme.js";

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
} from "./primitives/primitives-core.js";
export type {
  DsButtonProps,
  DsButtonLinkProps,
  DsButtonVariant,
  DsIconButtonProps,
  DsBadgeProps,
  DsChipProps,
} from "./primitives/primitives-core.js";

export {
  DS_STATUS,
  DS_STATUS_ORDER,
  DS_ATTENTION_STATUSES,
  dsStatusText,
  dsStatusAccessibleName,
  StatusPill,
  StatusDot,
  StatusIcon,
} from "./primitives/primitives-status.js";
export type {
  DsStatus,
  DsStatusSpec,
  DsStatusTier,
  DsStatusPillSize,
} from "./primitives/primitives-status.js";

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
  /** The bottom edge of a card. */
  CardBase,
  /** Cards read ACROSS rather than down — two identity candidates, a pair of compared readings.
 * `CardBase` pins the bottom edge only */
  CompareGrid,
  CompareCard,
  CardFooter,
  SectionLabel,
  PageHeader,
  DsBodyScope,
  PageHeading,
  TableList,
  TableToolbar,
  FormGroup,
  BodySection,
  ResultRow,
  /** The root a full-page takeover wears: full-bleed under the top bar, and the
 * one place the shared arrival lives. Never wrap it in a `Panel` — the card */
  TakeoverFrame,
  Banner,
  Disclosure,
  MetaLine,
  /** A wrapping row of PEER facts. */
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
  /** Make a surface that has just MOUNTED arrive instead of appear. */
  useDsEnterTransition,
} from "./primitives/primitives-layout.js";
export type { DsBannerTone } from "./primitives/primitives-layout.js";

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
  /** The correctable/locked value pair. */
  ValueField,
  LockedValue,
  /** The one place bytes enter this system. A real `<input type="file">` inside
 * a `<label>`, so the drop target and the browse control are one control */
  Dropzone,
} from "./primitives/primitives-form.js";
export type { UnitFieldProps, SecretFieldProps } from "./primitives/primitives-form.js";

export { Calendar, DateInput, DateInput as DatePicker, DateRangeInput, RangeCalendar } from "./primitives/primitives-date.js";
export { ChoicePicker, SegmentedChoice } from "./primitives/primitives-choice.js";
export { ToggleGroup, ToggleGroupItem } from "./primitives/base-toggle-group.js";

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
  /** An object's own commands, on the object. */
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
} from "./primitives/primitives-overlay.js";
export type {
  DsDialogSize,
  DsDrawerSide,
  DsPopoverSide,
  DsPopoverWidth,
  DsToast,
  DsToastTone,
} from "./primitives/primitives-overlay.js";

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
} from "./primitives/primitives-data.js";
export type { DsRankedItem, DsSortDirection, DsStep, DsStepState } from "./primitives/primitives-data.js";

export { InputGroup, InputGroupTextarea, InputGroupAddon, InputGroupButton } from './primitives/input-group.js';
export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel,
  DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator } from './primitives/dropdown-menu.js';
