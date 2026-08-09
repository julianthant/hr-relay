/**
 * Typed query surface: every response parses through its owning wire schema
 * before a caller sees it. A response outside the contract is a schema error
 * with the route named — never a cast.
 */
import { z } from "zod";
import { FrontendBootstrapWireSchema, type FrontendBootstrapWire } from "../../domain/dashboard/bootstrap.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../domain/dashboard/projection.js";
import {
  RunDetailSectionResponseSchema,
  RunDetailWireSchema,
  type RunDetailSectionResponse,
  type RunDetailWire,
} from "../../domain/dashboard/run-detail.js";
import { StorageDoctorWireSchema, type StorageDoctorWire } from "../../domain/dashboard/storage.js";
import { schemaError } from "./errors.js";
import type { DashboardTransport } from "./transport.js";

function parseOrThrow<Schema extends z.ZodType>(schema: Schema, context: string, body: unknown): z.output<Schema> {
  try {
    return schema.parse(body);
  } catch (error) {
    throw schemaError(context, error);
  }
}

export interface DashboardQueries {
  bootstrap(): Promise<FrontendBootstrapWire>;
  dashboardDay(day: string): Promise<DashboardDayWire>;
  runDetail(runId: string): Promise<RunDetailWire>;
  runSection(runId: string, section: string, cursor?: string): Promise<RunDetailSectionResponse>;
  /** Doc 03 §2.5's read-only doctor, run on demand from Settings (2i-D). */
  storageDoctor(): Promise<StorageDoctorWire>;
}

export function createDashboardQueries(transport: DashboardTransport): DashboardQueries {
  return Object.freeze({
    async bootstrap(): Promise<FrontendBootstrapWire> {
      return parseOrThrow(FrontendBootstrapWireSchema, "GET /api/v1/bootstrap", await transport.requestJson("/api/v1/bootstrap"));
    },
    async dashboardDay(day: string): Promise<DashboardDayWire> {
      const parsedDay = z.iso.date().parse(day);
      return parseOrThrow(
        DashboardDayWireSchema,
        "GET /api/v1/dashboard",
        await transport.requestJson(`/api/v1/dashboard?day=${parsedDay}`),
      );
    },
    async runDetail(runId: string): Promise<RunDetailWire> {
      return parseOrThrow(
        RunDetailWireSchema,
        `GET /api/v1/runs/${runId}`,
        await transport.requestJson(`/api/v1/runs/${encodeURIComponent(runId)}`),
      );
    },
    async runSection(runId: string, section: string, cursor?: string): Promise<RunDetailSectionResponse> {
      const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
      return parseOrThrow(
        RunDetailSectionResponseSchema,
        `GET /api/v1/runs/${runId}/${section}`,
        await transport.requestJson(`/api/v1/runs/${encodeURIComponent(runId)}/${encodeURIComponent(section)}${query}`),
      );
    },
    async storageDoctor(): Promise<StorageDoctorWire> {
      return parseOrThrow(
        StorageDoctorWireSchema,
        "GET /api/v1/storage/doctor",
        await transport.requestJson("/api/v1/storage/doctor"),
      );
    },
  });
}
