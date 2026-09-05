/**
 * The strict provenance vocabulary crosses server-resolved config and browser
 * Settings wires. Resolver implementation stays server-only.
 */
import { z } from "zod";

export const ConfigProvenanceSchema = z.enum(["settings", "default"]);
export const ConfigLeafPathSchema = z.string().regex(/^[a-z][A-Za-z0-9]*(?:\.(?:[A-Za-z][A-Za-z0-9]*|\*))*$/);
export type ConfigProvenance = z.infer<typeof ConfigProvenanceSchema>;
export type ConfigLeafPath = z.infer<typeof ConfigLeafPathSchema>;
