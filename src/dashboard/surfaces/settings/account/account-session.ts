import type { PublicProfileState } from "../../../../models/profiles/public-profile.js";
import type { AccountValues } from "./account-settings.js";

/** The served account from a profile read, only while it is still the profile and sign-in that made the change. */
export function sameSessionAccount(read: PublicProfileState, session: Readonly<{ profileId: string; epoch: number }>): AccountValues | undefined {
  return read.state === "active" && read.profileId === session.profileId && read.epoch === session.epoch ? read.account : undefined;
}
