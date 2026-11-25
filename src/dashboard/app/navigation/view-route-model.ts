import { createContext, useCallback, useContext, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { z } from "zod";
import { QueueMemberSelectionSchema } from "../../../models/dashboard/projection.js";
import { RunIdSchema, FailureIdSchema } from "../../../rules/identity/ids.js";
import { RerunValuesRequestSchema } from "../../../models/dashboard/rerun-values.js";
import type { AppRouteState } from "./url-state.js";

const identity = z.string().max(200);
const stage = z.enum(["Input", "Steps", "Start"]);
const retiredViewKeys = ["bumpScope", "bumpSelection", "bumpReview", "preflightScope", "capabilitiesQuery"];
export const ViewRouteCoordinatesSchema = z.object({
  queueMember: QueueMemberSelectionSchema.optional(),
  logFailure: z.strictObject({ runId: RunIdSchema, failureId: FailureIdSchema }).optional(),
  workflow: identity.optional(), preview: identity.nullable().optional(), mockRun: identity.optional(), records: identity.optional(),
  launchRerun: RerunValuesRequestSchema.extend({ label: identity.optional(), traceId: identity.optional() }).optional(), launchServed: identity.optional(), launchWorkflow: identity.optional(), launchSource: identity.optional(), launchStage: stage.optional(), launchCustomize: z.boolean().optional(),
  reviewPages: z.record(identity, z.number().int().min(0).max(10000)).refine(value => Object.keys(value).length <= 200).optional(),
  queueOpen: z.array(identity).max(200).optional(),
  queueFilter: z.array(z.enum(["all", "needsYou", "queued", "running", "cancelling", "blocked", "awaiting-approval", "done", "failed", "cancelled", "partial"])).max(12).optional(), queueSort: z.enum(["attention", "newest", "oldest", "longest"]).optional(),

  workerWorkflow: identity.optional(), sessions: z.boolean().optional(), addWorkers: z.boolean().optional(),
  search: z.boolean().optional(), searchQuery: z.string().max(500).optional(), settingsQuery: z.string().max(500).optional(),
  spreadsheetImport: z.boolean().optional(), spreadsheetMapping: identity.optional(), spreadsheetImportView: z.enum(["mapping", "preview", "columns"]).optional(), spreadsheetType: identity.nullable().optional(),
  spreadsheetImportSheet: identity.optional(), spreadsheetImportColumnPage: z.number().int().min(0).max(100000).optional(),
  spreadsheetTab: z.enum(["registered", "types"]).optional(), spreadsheetQuery: z.string().max(500).optional(), spreadsheet: identity.nullable().optional(),
  spreadsheetSheet: identity.optional(), spreadsheetPage: z.number().int().min(0).max(100000).optional(), spreadsheetRowsQuery: z.string().max(500).optional(), spreadsheetColumnPage: z.number().int().min(0).max(100000).optional(),
  explorerSource: z.object({ field: identity, step: z.number().int().min(1).max(10000), form: identity.optional() }).optional(), explorerWorkflow: identity.optional(), explorerOpen: z.record(z.string().max(200), z.boolean()).refine(value => Object.keys(value).length <= 200).optional(),
  keyboardQuery: z.string().max(500).optional(),
  activityBrowse: z.object({ metric: z.enum(['completed', 'outstanding', 'failed', 'timed']), workflow: identity.optional(),
    page: z.number().int().min(0).max(100000), run: identity.optional(), query: z.string().max(500).optional(),
    sort: z.object({ column: z.enum(['name', 'duration']), direction: z.enum(['ascending', 'descending']) }).strict().optional() }).strict().nullable().optional(),
  activityPreview: z.enum(['normal', 'empty', 'incomplete', 'loading', 'unavailable']).optional(),
}).strict();
export type ViewRoute = z.infer<typeof ViewRouteCoordinatesSchema>;

export const ViewRouteSchema = z.preprocess(decoded => {
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)
    || !retiredViewKeys.some(key => Object.hasOwn(decoded, key))) return decoded;
  const coordinates = { ...decoded };
  for (const key of retiredViewKeys) Reflect.deleteProperty(coordinates, key);
  return coordinates;
}, ViewRouteCoordinatesSchema);

/** The patch that removes the Start run dialog's coordinates from the view when the dialog closes. */
export const LAUNCH_CLEARED: Readonly<Partial<ViewRoute>> = Object.freeze({
  launchRerun: undefined, launchServed: undefined, launchWorkflow: undefined, launchSource: undefined, launchStage: undefined, launchCustomize: undefined,
});
export type RouteSetter = (next: AppRouteState | ((current: AppRouteState) => AppRouteState), mode?: "push" | "replace") => void;
export interface ViewNavigation { readonly view: ViewRoute; readonly start: boolean; setStart(this: void, open: boolean): void; update(this: void, patch: Partial<ViewRoute>, mode?: "push" | "replace"): void }
export const ViewNavigationContext = createContext<ViewNavigation | undefined>(undefined);

export function parseViewRoute(value: string | null): ViewRoute | null {
  if (value === null) return {};
  if (value.length > 16000) return null;
  try { const result = ViewRouteSchema.safeParse(JSON.parse(value)); return result.success ? result.data : null; }
  catch { return null; }
}

/** Only navigation coordinates belong here. Private drafts, files and command outcomes stay in their owners. */
export function useViewState<K extends keyof ViewRoute>(key: K, initial: Exclude<ViewRoute[K], undefined> | (() => Exclude<ViewRoute[K], undefined>), mode?: "push" | "replace"): [Exclude<ViewRoute[K], undefined>, Dispatch<SetStateAction<Exclude<ViewRoute[K], undefined>>>];
export function useViewState<K extends keyof ViewRoute>(key: K, initial: ViewRoute[K] | (() => ViewRoute[K]), mode?: "push" | "replace"): [ViewRoute[K], Dispatch<SetStateAction<ViewRoute[K]>>];
export function useViewState<K extends keyof ViewRoute>(key: K, initial: ViewRoute[K] | (() => ViewRoute[K]), mode: "push" | "replace" = "push"): [ViewRoute[K], Dispatch<SetStateAction<ViewRoute[K]>>] {
  const navigation = useContext(ViewNavigationContext);
  const [local, setLocal] = useState(initial);
  const value = navigation === undefined ? local : navigation.view[key] === undefined ? local : navigation.view[key];
  const current = useRef({ navigation, value });
  current.current = { navigation, value };
  const set = useCallback<Dispatch<SetStateAction<ViewRoute[K]>>>(next => {
    const owner = current.current.navigation;
    if (owner === undefined) { setLocal(next); return; }
    const previous = current.current.value;
    const resolved = typeof next === "function" ? next(previous) : next;
    if (Object.is(resolved, previous)) return;
    current.current.value = resolved;
    owner.update({ [key]: resolved }, mode);
  }, [key, mode]);
  return [value, set];
}

export function useViewNavigation(): ViewNavigation | undefined { return useContext(ViewNavigationContext); }
