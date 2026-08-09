/**
 * The capture token mint (D174).
 *
 * A capture token is the ONLY credential this system hands to a device it does
 * not control, so it is 32 bytes from the platform CSPRNG — not a UUID, whose
 * six fixed version/variant bits and common time-ordered implementations make
 * it the wrong shape for a bearer secret.
 *
 * base64url, because the value has to survive a QR code and a URL fragment
 * without escaping. It is minted here and lands in exactly one place — the
 * Start Capture response — before the durable row keeps only its digest.
 */
import { randomBytes } from "node:crypto";
import { CaptureTokenSchema } from "../../domain/capture-surface.js";

export function mintCaptureToken(): string {
  return CaptureTokenSchema.parse(randomBytes(32).toString("base64url"));
}
