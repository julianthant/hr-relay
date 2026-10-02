/** Pure value formatting for the component-only run-start presentation kit. */
import type { SurfaceField } from "../../models/workflow/ingress.js";

export function surfaceValueLabel(constant: SurfaceField): string {
  switch (constant.value.kind) {
    case "text":
      return constant.value.text;
    case "boolean":
      return constant.value.value ? "yes" : "no";
    case "count":
      return String(constant.value.value);
  }
}
