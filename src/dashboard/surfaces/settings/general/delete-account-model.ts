export type DeleteAccountPresentation =
  | { state: "unavailable" }
  | { state: "ready"; personName: string; onConfirm: () => void }
  | { state: "deleting"; personName: string }
  | { state: "refused" | "uncertain"; personName: string; message: string };
