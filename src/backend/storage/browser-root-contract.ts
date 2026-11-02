import { isAbsolute } from "node:path";
import { z } from "zod";
import { BrowserSystemIdSchema, WorkerIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";

const Integer = z.number().int().safe().nonnegative();
const Generation = Integer.positive();
const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
const RelativePath = z.string().min(1).max(4096).refine(value => !isAbsolute(value)
  && !value.includes("\\") && value.split("/").every(part => part !== "" && part !== "." && part !== ".."));
const WorkerOwner = z.strictObject({ kind: z.literal("worker"), workerId: WorkerIdSchema, workflowId: WorkflowIdSchema,
  ordinal: Generation, membershipRevision: Generation, leaseGeneration: Generation });
const SignupOwner = z.strictObject({ kind: z.literal("signup"), operationId: z.uuid(), accountId: z.uuid(), providerGeneration: Generation });
export const BrowserRootOwnerSchema = z.discriminatedUnion("kind", [WorkerOwner, SignupOwner]);
const Launch = z.strictObject({ launchId: z.uuid(), generation: Generation,
  state: z.enum(["launching", "open", "closing", "closed", "unknown"]) });
const NativeAction = z.strictObject({ operationId: z.uuid(), launchId: z.uuid(), generation: Generation,
  source: z.strictObject({ device: Integer, inode: Integer }), priorLaunchDigest: Digest, phase: z.enum(["probing", "observed", "deleting"]) });
export const BrowserRootSchema = z.strictObject({ profileId: z.uuid(), profileRoot: RelativePath, directory: RelativePath,
  owner: BrowserRootOwnerSchema, sessionGeneration: Integer, credentialFingerprint: Digest.nullable(), launch: Launch,
  native: NativeAction.optional() }).superRefine((row, context) => {
  const prefix = `profiles/${row.profileId}/`;
  const valid = row.owner.kind === "worker" ? row.profileRoot.startsWith(prefix)
    && row.directory.startsWith(`${row.profileRoot}/w${row.owner.ordinal}/`)
    && BrowserSystemIdSchema.safeParse(row.directory.slice(`${row.profileRoot}/w${row.owner.ordinal}/`.length)).success
    && row.owner.workerId === `${row.owner.workflowId}-worker-${row.owner.ordinal}`
    : row.profileRoot === "browsers/onboarding" && row.directory === `${row.profileRoot}/onboarding-${row.owner.operationId}-${row.profileId}-${row.owner.accountId}-g${row.owner.providerGeneration}`;
  if (!valid) {
    context.addIssue({ code: "custom", message: "browser root escapes its person" });
  }
});
export const BrowserRootsSchema = z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(), revision: Integer,
  nextGeneration: Generation, roots: z.array(BrowserRootSchema).max(64) }).superRefine((document, context) => {
  const paths = document.roots.map(row => row.directory), generations = document.roots.flatMap(row => [row.launch.generation,
    ...(row.native === undefined ? [] : [row.native.generation])]);
  const launches = document.roots.flatMap(row => [row.launch.launchId, ...(row.native === undefined ? [] : [row.native.launchId])]);
  if (new Set(paths).size !== paths.length || new Set(launches).size !== launches.length
    || new Set(generations).size !== generations.length || generations.some(generation => generation >= document.nextGeneration)
    || paths.some(path => paths.some(other => other !== path && path.startsWith(`${other}/`)))) {
    context.addIssue({ code: "custom", message: "browser root membership diverges" });
  }
});
export type BrowserRootsDocument = z.infer<typeof BrowserRootsSchema>;
export type BrowserRoot = z.infer<typeof BrowserRootSchema>;
export type BrowserRootOwner = z.infer<typeof BrowserRootOwnerSchema>;
