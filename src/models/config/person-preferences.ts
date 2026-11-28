import { z } from "zod";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";

const BindingSchema = z.array(z.string().min(1)).max(8);
export const ShortcutPreferencesSchema = z.strictObject({
  numberMode: z.enum(["runs", "workflows"]),
  bindings: z.strictObject({ search: BindingSchema, start: BindingSchema, next: BindingSchema, previous: BindingSchema, attention: BindingSchema }),
}).superRefine((value, context) => {
  const seen = new Set<string>();
  for (const [action, keys] of Object.entries(value.bindings)) for (const chord of keys) {
    if (chord === "Escape" || /^(Meta|Ctrl)\+[1-9]$/.test(chord)) context.addIssue({ code: "custom", path: ["bindings", action], message: "This shortcut is reserved." });
    if (seen.has(chord)) context.addIssue({ code: "custom", path: ["bindings", action], message: "This shortcut is already assigned to another action." });
    seen.add(chord);
  }
});
export type ShortcutPreferences = z.infer<typeof ShortcutPreferencesSchema>;
export const NotificationPreferencesSchema = z.strictObject({
  runFinished: z.enum(["always", "unfocused", "never"]),
  needsYou: z.boolean(),
  failures: z.boolean(),
  sound: z.enum(["default", "none"]),
});
export const PersonPreferencesSchema = z.strictObject({
  theme: z.enum(["dark", "light"]),
  animations: z.boolean(),
  selectedWorkflowId: z.string().max(120),
  shortcuts: ShortcutPreferencesSchema,
  preventSleepWhileRunning: z.boolean(),
  confirmCloseDuringRun: z.enum(["active-run", "always", "never"]),
  notifications: NotificationPreferencesSchema,
  sendShortcut: z.enum(["enter", "mod-enter"]),
  assistantFullAccess: z.boolean(),
});
export type PersonPreferences = z.infer<typeof PersonPreferencesSchema>;
export const NEUTRAL_PERSON_PREFERENCES = deepFreeze(PersonPreferencesSchema.parse({
  theme: "dark", animations: true, selectedWorkflowId: "",
  shortcuts: { numberMode: "runs", bindings: { search: ["/"], start: ["r"], next: ["j", "ArrowDown"], previous: ["k", "ArrowUp"], attention: ["n"] } },
  preventSleepWhileRunning: true, confirmCloseDuringRun: "active-run",
  notifications: { runFinished: "unfocused", needsYou: true, failures: true, sound: "default" },
  sendShortcut: "enter",
  assistantFullAccess: false,
}));
export function derivePersonPreferencesFingerprint(input: unknown): string {
  return sha256Hex(canonicalJsonStringify(PersonPreferencesSchema.parse(input)));
}
export function resolvePersonPreferences(input: z.input<typeof PersonPreferencesOverrideSchema> = {}): PersonPreferences {
  return PersonPreferencesSchema.parse({ ...NEUTRAL_PERSON_PREFERENCES, ...input,
    shortcuts: { ...NEUTRAL_PERSON_PREFERENCES.shortcuts, ...input.shortcuts,
      bindings: { ...NEUTRAL_PERSON_PREFERENCES.shortcuts.bindings, ...input.shortcuts?.bindings } },
    notifications: { ...NEUTRAL_PERSON_PREFERENCES.notifications, ...input.notifications } });
}
export const PersonPreferencesOverrideSchema = z.strictObject({ ...PersonPreferencesSchema.shape, shortcuts: z.strictObject({
  numberMode: ShortcutPreferencesSchema.shape.numberMode.optional(),
  bindings: ShortcutPreferencesSchema.shape.bindings.partial().optional(),
}).optional(), notifications: NotificationPreferencesSchema.partial().optional() }).partial();
