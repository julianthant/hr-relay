import { isAbsolute } from "node:path";
import { z } from "zod";
import { BrowserSystemIdSchema, WorkerIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";

export const PROFILE_ONBOARDING_BROWSER_DIRECTORY = "onboarding";

const Integer = z.number().int().safe().nonnegative();
const Generation = Integer.positive();
export const BrowserRootHandleSchema = Generation;
const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
const RelativePath = z.string().min(1).max(4096).refine(value => !isAbsolute(value)
  && !value.includes("\\") && value.split("/").every(part => part !== "" && part !== "." && part !== ".."));
const WorkerOwner = z.strictObject({ kind: z.literal("worker"), workerId: WorkerIdSchema, workflowId: WorkflowIdSchema,
  ordinal: Generation, membershipRevision: Generation, leaseGeneration: Generation });
const SignupOwner = z.strictObject({ kind: z.literal("signup"), operationId: z.uuid(), accountId: z.uuid(), providerGeneration: Generation });
const CommandOwner = z.strictObject({ kind: z.literal('command'), commandId: z.uuid(), requestDigest: Digest, system: z.literal('sharepoint') });
export const BrowserRootOwnerSchema = z.discriminatedUnion("kind", [WorkerOwner, SignupOwner, CommandOwner]);
const Launch = z.strictObject({ launchId: z.uuid(), generation: Generation,
  state: z.enum(["launching", "open", "closing", "closed", "unknown"]) });
const NativeAction = z.strictObject({ operationId: z.uuid(), launchId: z.uuid(), generation: Generation,
  source: z.strictObject({ device: z.union([Integer, z.string().regex(/^(0|[1-9][0-9]*)$/u)]), inode: z.union([Integer, z.string().regex(/^(0|[1-9][0-9]*)$/u)]) }), priorLaunchDigest: Digest, phase: z.enum(["probing", "observed", "deleting"]) });
export const BrowserRootSchema = z.strictObject({ handle: BrowserRootHandleSchema, profileId: z.uuid(), profileRoot: RelativePath, directory: RelativePath,
  owner: BrowserRootOwnerSchema, sessionGeneration: Integer, credentialFingerprint: Digest.nullable(), launch: Launch,
  native: NativeAction.optional() }).superRefine((row, context) => {
  const prefix = `profiles/${row.profileId}/`;
  const valid = row.owner.kind === "worker" ? row.profileRoot.startsWith(prefix)
    && row.directory.startsWith(`${row.profileRoot}/w${row.owner.ordinal}/`)
    && BrowserSystemIdSchema.safeParse(row.directory.slice(`${row.profileRoot}/w${row.owner.ordinal}/`.length)).success
    && row.owner.workerId === `${row.owner.workflowId}-worker-${row.owner.ordinal}`
    : row.owner.kind === 'signup' ? row.profileRoot === `browsers/${PROFILE_ONBOARDING_BROWSER_DIRECTORY}` && row.directory === `${row.profileRoot}/r${row.handle.toString(36)}`
    : row.profileRoot.startsWith(prefix) && row.directory === `${row.profileRoot}/commands/sharepoint`;
  if (!valid) {
    context.addIssue({ code: "custom", message: "browser root escapes its person" });
  }
});
export const BrowserRootsSchema = z.strictObject({ schemaVersion: z.literal(2), installationId: z.uuid(), revision: Integer,
  nextHandle: BrowserRootHandleSchema, nextGeneration: Generation, roots: z.array(BrowserRootSchema).max(64) }).superRefine((document, context) => {
  const paths = document.roots.map(row => row.directory), generations = document.roots.flatMap(row => [row.launch.generation,
    ...(row.native === undefined ? [] : [row.native.generation])]);
  const launches = document.roots.flatMap(row => [row.launch.launchId, ...(row.native === undefined ? [] : [row.native.launchId])]);
  const handles = document.roots.map(row => row.handle);
  const signupOwners = document.roots.filter(row => row.owner.kind === "signup")
    .map(row => JSON.stringify([row.profileId, row.profileRoot, row.owner]));
  if (new Set(paths).size !== paths.length || new Set(launches).size !== launches.length
    || new Set(handles).size !== handles.length || handles.some(handle => handle >= document.nextHandle)
    || new Set(signupOwners).size !== signupOwners.length
    || new Set(generations).size !== generations.length || generations.some(generation => generation >= document.nextGeneration)
    || paths.some(path => paths.some(other => other !== path && path.startsWith(`${other}/`)))) {
    context.addIssue({ code: "custom", message: "browser root membership diverges" });
  }
});
export type BrowserRootsDocument = z.infer<typeof BrowserRootsSchema>;
export type BrowserRoot = z.infer<typeof BrowserRootSchema>;
export type BrowserRootOwner = z.infer<typeof BrowserRootOwnerSchema>;

const PriorRoot = z.strictObject({ profileId: BrowserRootSchema.shape.profileId, profileRoot: BrowserRootSchema.shape.profileRoot,
  directory: BrowserRootSchema.shape.directory, owner: BrowserRootSchema.shape.owner, sessionGeneration: BrowserRootSchema.shape.sessionGeneration,
  credentialFingerprint: BrowserRootSchema.shape.credentialFingerprint, launch: BrowserRootSchema.shape.launch,
  native: BrowserRootSchema.shape.native }).superRefine((row, context) => {
  const valid = row.owner.kind === "signup"
    ? row.profileRoot === "browsers/onboarding" && row.directory === `${row.profileRoot}/onboarding-${row.owner.operationId}-${row.profileId}-${row.owner.accountId}-g${row.owner.providerGeneration}`
    : BrowserRootSchema.safeParse({ ...row, handle: 1 }).success;
  if (!valid) context.addIssue({ code: "custom", message: "prior browser root binding is invalid" });
});
export const StoppedBrowserRootsV1Schema = z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(), revision: Integer,
  nextGeneration: Integer.positive(), roots: z.array(PriorRoot).max(64) }).superRefine((document, context) => {
  const paths = document.roots.map(row => row.directory);
  const generations = document.roots.flatMap(row => [row.launch.generation, ...(row.native === undefined ? [] : [row.native.generation])]);
  const launches = document.roots.flatMap(row => [row.launch.launchId, ...(row.native === undefined ? [] : [row.native.launchId])]);
  if (new Set(paths).size !== paths.length || new Set(generations).size !== generations.length || new Set(launches).size !== launches.length
    || generations.some(generation => generation >= document.nextGeneration)
    || paths.some(path => paths.some(other => path !== other && path.startsWith(`${other}/`)))) {
    context.addIssue({ code: "custom", message: "prior browser root membership diverges" });
  }
});

export function parseStoppedBrowserRootUpgradeSource(value: unknown) {
  return z.union([StoppedBrowserRootsV1Schema, BrowserRootsSchema]).parse(value);
}
