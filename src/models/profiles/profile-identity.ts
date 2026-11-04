import { z } from "zod";

export const ProfileDisplayNameSchema = z.string().min(1).max(129);

export function profileInitials(displayName: string): string {
  const initials = displayName.split(/\s+/u).filter(Boolean).map(word => Array.from(word).slice(0, 1).join("").toUpperCase()).join("");
  if (initials.length === 0) throw new Error("profile-display-name-invalid");
  return initials;
}

export const ProfileIdentitySchema = z.strictObject({
  profileId: z.uuid(),
  sessionEpoch: z.number().int().safe().positive(),
  displayName: ProfileDisplayNameSchema,
  initials: z.string().min(1),
}).superRefine((identity, context) => {
  if (identity.initials !== profileInitials(identity.displayName)) context.addIssue({ code: "custom", message: "profile-initials-mismatch" });
});
export type ProfileIdentity = z.infer<typeof ProfileIdentitySchema>;
