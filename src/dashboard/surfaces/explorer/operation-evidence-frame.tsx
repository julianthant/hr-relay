import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils.js";
import { dsText } from "../../ds/ui.js";
import "./operation-structure.css";

export function OperationEvidenceFrame({ heading, children, footer, className, ...props }: Omit<ComponentProps<"div">, "children"> & { heading: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return <div {...props} className={cn("operation-form operation-evidence-frame", className)}>
    <div className={cn("operation-form-header", dsText.ui)}>{heading}</div>
    <div className="operation-evidence-body">{children}</div>
    {footer !== undefined && <div className="operation-read-footer">{footer}</div>}
  </div>;
}
