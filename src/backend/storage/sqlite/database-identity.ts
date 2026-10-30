import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { AUTHORITY_APPLICATION_ID } from "./migrations.js";

export function authoritySourceDatabaseIdentity(path: string): string {
  return createHash("sha256").update(`${String(AUTHORITY_APPLICATION_ID)}:${resolve(z.string().min(1).parse(path))}`).digest("hex");
}
