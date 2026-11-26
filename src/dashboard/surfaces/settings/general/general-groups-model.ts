export interface GeneralChoice { readonly value: string; readonly label: string }
/** `note` is the one sentence a row needs; a row has none by default. */
export interface GeneralGroupRow { readonly path: string; readonly choices?: readonly GeneralChoice[]; readonly note?: string | null }
export interface GeneralGroup { readonly title: string; readonly description: string; readonly rows: readonly GeneralGroupRow[] }

/** The Runs and Notifications groups of Settings > General, in the approved mock's order; choices are the served enums. */
export const GENERAL_RUN_GROUPS: readonly GeneralGroup[] = [
  { title: "Runs", description: "Sleep and close behavior while a run is active.", rows: [
    { path: "preferences.preventSleepWhileRunning" },
    { path: "preferences.confirmCloseDuringRun", choices: [{ value: "active-run", label: "While a run is active" }, { value: "always", label: "Always" }, { value: "never", label: "Never" }] },
  ] },
  { title: "Notifications", description: "When Relay alerts you about runs.", rows: [
    { path: "preferences.notifications.runFinished", choices: [{ value: "always", label: "Always" }, { value: "unfocused", label: "Only when unfocused" }, { value: "never", label: "Never" }] },
    { path: "preferences.notifications.needsYou", note: null },
    { path: "preferences.notifications.failures", note: null },
    { path: "preferences.notifications.sound", choices: [{ value: "default", label: "Default" }, { value: "none", label: "None" }] },
  ] },
];

export const GENERAL_RUN_PATHS: ReadonlySet<string> = new Set(GENERAL_RUN_GROUPS.flatMap(group => group.rows.map(row => row.path)));
