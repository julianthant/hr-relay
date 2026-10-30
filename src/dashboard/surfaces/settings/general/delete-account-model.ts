export type DeleteAccountPresentation =
  | { state: "unavailable" }
  | { state: "ready"; personName: string; onConfirm: () => void }
  | { state: "deleting"; personName: string }
  | { state: "blocked"; personName: string; reason: "unresolved-write" | "closure-unproved" };
