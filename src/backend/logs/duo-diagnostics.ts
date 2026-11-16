import { closeSync, constants, fstatSync, lstatSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ProfileOnboardingDuoEventSchema, type ProfileOnboardingDuoEvent } from "../../models/profiles/profile.js";
import { createPrivateDirectory, privatePathRejects } from "../storage/private-path.js";

const MAX_FILE_BYTES = 256 * 1024;
const FILE_COUNT = 4;
const RecordSchema = ProfileOnboardingDuoEventSchema.omit({ requestId: true }).extend({ at: z.iso.datetime() });

export class DuoDiagnosticLogError extends Error {
  readonly code = "ONBOARDING_DUO_DIAGNOSTIC_LOG_UNAVAILABLE";
  constructor() { super("Duo diagnostic log is unavailable."); this.name = "DuoDiagnosticLogError"; }
}

export function appendDuoDiagnostic(machineRoot: string, now: Date, event: ProfileOnboardingDuoEvent): void {
  try {
    const parsed = ProfileOnboardingDuoEventSchema.parse(event);
    const record = RecordSchema.parse({ at: now.toISOString(), stage: parsed.stage,
      ...(parsed.detail === undefined ? {} : { detail: parsed.detail }),
      ...(parsed.code === undefined ? {} : { code: parsed.code }),
      ...(parsed.exceptionType === undefined ? {} : { exceptionType: parsed.exceptionType }),
      ...(parsed.operation === undefined ? {} : { operation: parsed.operation }),
      ...(parsed.durationMs === undefined ? {} : { durationMs: parsed.durationMs }) });
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
    const directory = join(machineRoot, "logs");
    createPrivateDirectory(directory, { recursive: true, mode: 0o700 });
    const directoryStat = process.platform === "win32" ? lstatSync(directory, { bigint: true }) : lstatSync(directory);
    if (!directoryStat.isDirectory() || privatePathRejects(directory, directoryStat, "directory-0700")) throw new DuoDiagnosticLogError();
    const paths = Array.from({ length: FILE_COUNT }, (_, index) => join(directory, index === 0 ? "duo.jsonl" : `duo.${index}.jsonl`));
    const sizes = paths.map(path => {
      const stat = process.platform === "win32" ? lstatSync(path, { bigint: true, throwIfNoEntry: false }) : lstatSync(path, { throwIfNoEntry: false });
      if (stat === undefined) return 0;
      if (!stat.isFile() || BigInt(stat.nlink) !== 1n || privatePathRejects(path, stat, "file-0600") || stat.size > MAX_FILE_BYTES) throw new DuoDiagnosticLogError();
      return Number(stat.size);
    });
    const path = paths[0];
    if (sizes[0] + bytes.length > MAX_FILE_BYTES) {
      const last = paths[FILE_COUNT - 1];
      if (lstatSync(last, { throwIfNoEntry: false }) !== undefined) unlinkSync(last);
      for (let index = FILE_COUNT - 2; index >= 0; index--) {
        if (lstatSync(paths[index], { throwIfNoEntry: false }) !== undefined) renameSync(paths[index], paths[index + 1]);
      }
    }
    const descriptor = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const stat = process.platform === "win32" ? fstatSync(descriptor, { bigint: true }) : fstatSync(descriptor);
      if (!stat.isFile() || BigInt(stat.nlink) !== 1n || privatePathRejects(path, stat, "file-0600")) throw new DuoDiagnosticLogError();
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
        if (written === 0) throw new DuoDiagnosticLogError();
        offset += written;
      }
    } finally { closeSync(descriptor); }
  } catch {
    throw new DuoDiagnosticLogError();
  }
}
