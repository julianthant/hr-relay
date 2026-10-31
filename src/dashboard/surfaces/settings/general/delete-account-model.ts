export type DeleteAccountPresentation =
  | { state: "unavailable" }
  | { state: "ready"; personName: string; onConfirm: () => void }
  | { state: "deleting"; personName: string };
