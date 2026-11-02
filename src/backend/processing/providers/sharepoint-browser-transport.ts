import type { SharePointBrowserTransferInput, SharePointBrowserTransferResult } from "../../../models/systems/sharepoint/workbook-download.js";

export async function sharePointBrowserTransport(input: SharePointBrowserTransferInput): Promise<SharePointBrowserTransferResult> {
  const chunks: string[] = [];
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let refusal: Readonly<{ state: "transfer-refused" }> | undefined;
  let tooLarge = false;
  const cleanupFailures: ("reader-cancel" | "reader-release")[] = [];
  try {
    if (location.origin !== input.origin || new URL(input.url).origin !== input.origin) throw new Error("scope");
    const response = await fetch(input.url, { credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store",
      headers: { Accept: input.kind === "json" ? "application/json;odata=nometadata" : "*/*" }, signal: input.controller.signal });
    reader = response.body?.getReader();
    if (reader === undefined || response.status !== 200 || response.redirected || new URL(response.url).origin !== input.origin
      || new URL(response.url).href !== new URL(input.url).href) throw new Error("response");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/u.test(length) || !Number.isSafeInteger(Number(length)))) throw new Error("length");
    if (length !== null && Number(length) > input.limit) { tooLarge = true; throw new Error("limit"); }
    const media = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    const allowed = input.kind === "json" ? ["application/json"] : input.kind === "xlsx"
      ? ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"]
      : ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"];
    if (!allowed.includes(media)) throw new Error("media");
    const pending = new Uint8Array(64 * 1024);
    let used = 0, total = 0, prefix = "";
    const emit = () => {
      let binary = "";
      for (let index = 0; index < used; index++) binary += String.fromCharCode(pending[index]);
      chunks.push(btoa(binary)); used = 0;
    };
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > input.limit) { tooLarge = true; throw new Error("limit"); }
      if (prefix.length < 512) prefix += new TextDecoder().decode(part.value.subarray(0, 512 - prefix.length));
      let offset = 0;
      while (offset < part.value.length) {
        const count = Math.min(pending.length - used, part.value.length - offset);
        pending.set(part.value.subarray(offset, offset + count), used); used += count; offset += count;
        if (used === pending.length) emit();
      }
    }
    if (total === 0 || /^\s*<(?:!doctype\s+html|html|form)(?:\s|>)/iu.test(prefix)) throw new Error("body");
    if (used > 0) emit();
  } catch { refusal = { state: "transfer-refused" }; }
  finally {
    if (reader !== undefined) {
      try { await reader.cancel(); } catch { cleanupFailures.push("reader-cancel"); }
      try { reader.releaseLock(); } catch { cleanupFailures.push("reader-release"); }
    }
  }
  return { chunks: refusal === undefined ? chunks : [], failed: refusal !== undefined, tooLarge, cleanupFailed: cleanupFailures.length !== 0 };
}
