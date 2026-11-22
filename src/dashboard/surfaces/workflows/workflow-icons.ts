import { Building2, CalendarClock, ClipboardCheck, FileScan, FileText, Search, ShieldCheck, Upload, UserMinus, UserPlus, Users, type LucideIcon } from "lucide-react";
import type { IconName } from "../../../models/workflow/presentation.js";

/** The lucide component for each icon name a workflow definition may declare; a name added to `ICON_NAMES` without one fails to compile. */
const WORKFLOW_ICONS: Readonly<Record<IconName, LucideIcon>> = {
  Search, Users, UserMinus, UserPlus, FileScan, FileText, ClipboardCheck, Upload, CalendarClock, ShieldCheck, Building2,
};

export function workflowIcon(icon: IconName): LucideIcon {
  return WORKFLOW_ICONS[icon];
}
