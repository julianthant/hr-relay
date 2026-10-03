import { DateRangeInput } from "../../ds/ui.js";
import type { ActivityDateRange } from "../activity-model.js";

export function ActivityRange({ range, onApply }: { range: ActivityDateRange; onApply: (range: ActivityDateRange) => void }) {
  return <DateRangeInput label="Select report dates" groupLabel="Custom report range" value={range} onChange={onApply} variant="toolbar" />;
}
