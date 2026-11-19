import { Button } from "../../../../src/dashboard/ds/ui.js";
import { formatInstantDate } from "../../../../src/dashboard/lib/date-format.js";

export function Clean({ when, onGo }: { when: string; onGo: () => void }) {
  return <section className="text-[13px] font-medium"><Button onClick={onGo}>Go</Button><button onClick={onGo}>Go</button><span>{formatInstantDate(when)}</span></section>;
}
