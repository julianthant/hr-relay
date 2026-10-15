import { formatCalendarDate } from "../../../lib/date-format.js";
import type { NotificationDestination } from "../../notifications/notifications-view-model.js";
import type { ShellView } from "../top-bar-model.js";

export const NAVBAR_VIEWS: readonly { id: ShellView; label: string }[] = [
  { id: "queue", label: "Dashboard" },
  { id: "explorer", label: "Explorer" }, { id: "activity", label: "Analytics" },
];
export type NavbarSearchResult = Readonly<{ id: string; subject: string; workflow: string; day: string; state: string; publicId?: string; destination?: NotificationDestination }>;
export type NavbarData = Readonly<{ today: string; counts: Readonly<Record<string, number>>; results: readonly NavbarSearchResult[]; totalMatches?: number; unavailable?: string }>;

function dateValue(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) throw new Error("navbar-day-invalid");
  const date = new Date(`${day}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error("navbar-day-invalid");
  return date;
}
export function navbarDayLabel(day: string): string {
  dateValue(day); return formatCalendarDate(day);
}
export function navbarShiftDay(day: string, amount: number): string {
  const date = dateValue(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function navbarShiftMonth(month: string, amount: number): string {
  const date = dateValue(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}
export function navbarMonthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(dateValue(`${month}-01`));
}
export function navbarCalendarKey(day: string, key: string): string | undefined {
  const date = dateValue(day);
  if (key === "ArrowLeft") return navbarShiftDay(day, -1);
  if (key === "ArrowRight") return navbarShiftDay(day, 1);
  if (key === "ArrowUp") return navbarShiftDay(day, -7);
  if (key === "ArrowDown") return navbarShiftDay(day, 7);
  if (key === "Home") return navbarShiftDay(day, -date.getUTCDay());
  if (key === "End") return navbarShiftDay(day, 6 - date.getUTCDay());
  if (key === "PageUp" || key === "PageDown") {
    const month = navbarShiftMonth(day.slice(0, 7), key === "PageUp" ? -1 : 1);
    const nextMonth = dateValue(`${navbarShiftMonth(month, 1)}-01`);
    nextMonth.setUTCDate(0);
    return `${month}-${String(Math.min(date.getUTCDate(), nextMonth.getUTCDate())).padStart(2, "0")}`;
  }
  return undefined;
}
export function navbarMonthCells(month: string, today: string): readonly { day: string; label: number; inMonth: boolean; available: boolean }[] {
  const first = dateValue(`${month}-01`);
  dateValue(today);
  const start = navbarShiftDay(`${month}-01`, -first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = navbarShiftDay(start, index);
    return { day, label: Number(day.slice(-2)), inMonth: day.startsWith(month), available: day <= today };
  });
}
export function navbarSearch(results: readonly NavbarSearchResult[], query: string): readonly NavbarSearchResult[] {
  const words = query.toLocaleLowerCase("en-US").trim().split(/\s+/u).filter(Boolean);
  return results.filter(result => words.every(word => `${result.subject} ${result.workflow} ${result.state} ${result.day} ${result.id} ${result.publicId ?? ""}`.toLocaleLowerCase("en-US").includes(word)));
}
