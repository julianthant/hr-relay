import { Contact, Folder, GraduationCap, IdCard, LogOut, Search, UserPlus, type LucideIcon } from "lucide-react";

/** One literal icon per served workflow; a workflow this map does not name shows the folder. */
const WORKFLOW_ICONS: Readonly<Record<string, LucideIcon>> = {
  "person-lookup": Search,
  separations: LogOut,
  "i9-check-start": IdCard,
  onboarding: UserPlus,
  "work-study": GraduationCap,
  "emergency-contact": Contact,
};

export function workflowIcon(workflowId: string): LucideIcon {
  return Object.hasOwn(WORKFLOW_ICONS, workflowId) ? WORKFLOW_ICONS[workflowId] : Folder;
}
