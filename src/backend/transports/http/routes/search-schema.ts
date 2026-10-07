import { z } from "zod";
import { ActorIdSchema, ErrorCodeSchema } from "../../../../rules/identity/ids.js";
import {
  CrossDateSearchDryRunFacetSchema,
  CrossDateSearchQuerySchema,
  CrossDateSearchScopeSchema,
  CrossDateSearchShapeFacetSchema,
  CrossDateSearchStateFacetSchema,
  CrossDateSearchSystemFacetSchema,
  CrossDateSearchWorkflowFacetSchema,
  type CrossDateSearchQuery,
} from "../../../../models/dashboard/search.js";

const PositiveIntegerTextSchema = z.string().regex(/^[1-9]\d*$/).transform(Number);
const DryRunTextSchema = z.enum(["true", "false"]).transform(value => CrossDateSearchDryRunFacetSchema.parse(value === "true"));

const CrossDateSearchRouteQuerySchema = z.strictObject({
  q: z.string().max(160),
  scope: CrossDateSearchScopeSchema.optional(),
  workflow: CrossDateSearchWorkflowFacetSchema.optional(),
  day: z.iso.date().optional(),
  from:z.iso.date().optional(),to:z.iso.date().optional(),subject:z.string().trim().min(1).max(160).optional(),
  actor:ActorIdSchema.optional(),version:PositiveIntegerTextSchema.optional(),failure:ErrorCodeSchema.optional(),
  evidence:z.enum(["receipt","failure","diagnostic","none"]).optional(),
  state: CrossDateSearchStateFacetSchema.optional(),
  shape: CrossDateSearchShapeFacetSchema.optional(),
  dryRun: DryRunTextSchema.optional(),
  system: CrossDateSearchSystemFacetSchema.optional(),
  limit: PositiveIntegerTextSchema.optional(),
  cursor: z.string().min(1).max(2_048).optional(),
});

function rawQueryOf(searchParams: URLSearchParams): Readonly<Record<string, unknown>> {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of searchParams) {
    const previous = raw[key];
    if (previous === undefined) {
      raw[key] = value;
      continue;
    }
    const parsedPrevious = z.union([z.string(), z.array(z.string())]).parse(previous);
    raw[key] = typeof parsedPrevious === "string"
      ? [parsedPrevious, value]
      : [...parsedPrevious, value];
  }
  return Object.freeze(raw);
}

export function parseCrossDateSearchRouteQuery(requestUrl: string): CrossDateSearchQuery {
  const raw = CrossDateSearchRouteQuerySchema.parse(rawQueryOf(new URL(requestUrl).searchParams));
  const facets = {
    ...Object.fromEntries(["from","to","subject","actor","version","failure","evidence"].flatMap(key=>{const value=raw[key as keyof typeof raw];return value===undefined?[]:[[key,value]];})),
    ...(raw.workflow === undefined ? {} : { workflow: raw.workflow }),
    ...(raw.day === undefined ? {} : { day: raw.day }),
    ...(raw.state === undefined ? {} : { state: raw.state }),
    ...(raw.shape === undefined ? {} : { shape: raw.shape }),
    ...(raw.dryRun === undefined ? {} : { dryRun: raw.dryRun }),
    ...(raw.system === undefined ? {} : { system: raw.system }),
  };
  return CrossDateSearchQuerySchema.parse({
    q: raw.q,
    ...(raw.scope === undefined ? {} : { scope: raw.scope }),
    facets,
    ...(raw.limit === undefined ? {} : { limit: raw.limit }),
    ...(raw.cursor === undefined ? {} : { cursor: raw.cursor }),
  });
}
