import { DateRangeInput } from "../../ds/ui.js";
import type { ActivityDateRange } from "./activity-model.js";

export function ActivityRange({ range, onApply, onEdit }: { range: ActivityDateRange; onApply: (range: ActivityDateRange) => void; onEdit: () => void }) {
  return <DateRangeInput className="w-fit max-w-full" label="Select report dates" groupLabel="Report date range" value={range} onChange={onApply} onEdit={onEdit} variant="toolbar" hideEndpointLabels />;
}
