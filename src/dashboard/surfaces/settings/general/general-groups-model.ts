export interface GeneralChoice { readonly value: string; readonly label: string }
/** `note` replaces the served description; `null` drops one that only repeats the label. */
export interface GeneralGroupRow { readonly path: string; readonly choices?: readonly GeneralChoice[]; readonly note?: string | null }
export interface GeneralGroup { readonly title: string; readonly rows: readonly GeneralGroupRow[] }

/** The Runs and Notifications groups of Settings > General, in the approved mock's order; choices are the served enums. */
export const GENERAL_RUN_GROUPS: readonly GeneralGroup[] = [
  { title: "Runs", rows: [
    { path: "preferences.preventSleepWhileRunning" },
    { path: "preferences.confirmCloseDuringRun", choices: [{ value: "active-run", label: "While a run is active" }, { value: "always", label: "Always" }, { value: "never", label: "Never" }] },
  ] },
  { title: "Notifications", rows: [
    { path: "preferences.notifications.runFinished", note: "Alert when a run finishes.", choices: [{ value: "always", label: "Always" }, { value: "unfocused", label: "Only when unfocused" }, { value: "never", label: "Never" }] },
    { path: "preferences.notifications.needsYou", note: null },
    { path: "preferences.notifications.failures", note: null },
    { path: "preferences.notifications.sound", choices: [{ value: "default", label: "Default" }, { value: "none", label: "None" }] },
  ] },
];

export const GENERAL_RUN_PATHS: ReadonlySet<string> = new Set(GENERAL_RUN_GROUPS.flatMap(group => group.rows.map(row => row.path)));
