import { CHECK_COPY } from "../../surfaces/settings/preflight/preflight-check-copy.js";

const DATA_STORE_CHECK = "authority.health";

export interface PreflightAttentionToast {
  readonly tone: "warning";
  readonly title: string;
  readonly sticky: true;
  readonly action: "Open readiness";
}

/** Fail rows other than data-store readiness, named from the readiness copy. Nothing when that is the only failure. */
export function preflightAttentionToast(report: {
  readonly results: readonly { readonly check: string; readonly status: string }[];
}): PreflightAttentionToast | undefined {
  const names = report.results.flatMap(row => {
    const name = row.status === "fail" && row.check !== DATA_STORE_CHECK ? CHECK_COPY[row.check]?.name : undefined;
    return name === undefined ? [] : [name];
  });
  if (names.length === 0) return undefined;
  return { tone: "warning", sticky: true, action: "Open readiness", title: `Relay started, but these need attention: ${names.join(", ")}.` };
}
