import { z } from "zod";

export const FileIdentityValueSchema = z.union([
  z.number().int().safe().nonnegative(),
  z.string().regex(/^(?:0|[1-9][0-9]*)$/u),
]);

export const FileIdentitySchema = z.strictObject({ device: FileIdentityValueSchema, inode: FileIdentityValueSchema });
