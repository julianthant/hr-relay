/** The assistant mark directions; the launcher uses orbit. */
export const MARK_DIRECTIONS = ["relay", "nodes", "orbit"] as const;
export type MarkDirection = (typeof MARK_DIRECTIONS)[number];
export const MARK_STATES = ["idle", "thinking", "working", "done", "needs-you", "error"] as const;
export type MarkState = (typeof MARK_STATES)[number];
