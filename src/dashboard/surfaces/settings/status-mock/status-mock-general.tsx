import { useState, type ReactNode } from "react";
import { BodySection, Button, DateInput, FormGroup, PageHeading, ResultRow, SegmentedChoice, Select, Switch } from "../../../ds/ui.js";
import { middle } from "../general/settings-storage.js";

const DOWNLOADS = "/Users/jordan.lee/Documents/Relay downloads";


function Section({ title, children }: { title: string; children: ReactNode }) {
  return <BodySection title={title}><FormGroup label={title}>{children}</FormGroup></BodySection>;
}

function Toggle({ label, description, on, onChange }: { label: string; description?: string; on: boolean; onChange: (next: boolean) => void }) {
  return <Switch name={label} label={label} description={description} checked={on} onCheckedChange={onChange} />;
}

function Pick({ label, description, value, options, onChange }: { label: string; description: string; value: string; options: readonly string[]; onChange: (next: string) => void }) {
  return <ResultRow label={label} description={description} value={<Select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
    {options.map(option => <option key={option} value={option}>{option}</option>)}
  </Select>} />;
}

/** General on fixtures, organised like the Codex page: sections of shared rows. Rows with no served setting today are on the backend-gap list. */
export function StatusMockGeneral() {
  const [theme, setTheme] = useState("system");
  const [animations, setAnimations] = useState(true);
  const [jobEnd, setJobEnd] = useState("");
  const [browser, setBrowser] = useState("Hidden");
  const [sleep, setSleep] = useState(true);
  const [confirmClose, setConfirmClose] = useState("While a run is active");
  const [finished, setFinished] = useState("Only when unfocused");
  const [needsYou, setNeedsYou] = useState(true);
  const [failures, setFailures] = useState(true);
  const [sound, setSound] = useState("Default");
  const [send, setSend] = useState("Enter");
  return <section className="settings-compact-page">
    <PageHeading title="General" />
    <Section title="General">
      <ResultRow controlWidth="wide" label="Downloads" description="Onboarding documents, run downloads and exports."
        value={<span className="inline-flex items-center justify-end gap-3"><span title={DOWNLOADS} className="whitespace-nowrap font-mono text-[13px]">{middle(DOWNLOADS)}</span><Button variant="secondary">Change</Button></span>} />
      <ResultRow label="Job end date" description="Default end date for job records." value={<DateInput name="jobEndDate" label="Job end date" value={jobEnd} onChange={setJobEnd} valueFormat="us" hideLabel />} />
      <ResultRow label="Theme" description="Light, dark or follow this Mac." value={<SegmentedChoice hideLabel label="Theme" value={theme} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} onChange={setTheme} />} />
      <Toggle label="Animations" on={animations} onChange={setAnimations} />
      <Pick label="Browser window" description="Size of the browser Relay opens for workflows. Hidden keeps it out of sight." value={browser} options={["Hidden", "Small", "Medium", "Full screen"]} onChange={setBrowser} />
    </Section>
    <Section title="Runs">
      <Toggle label="Prevent sleep while running" description="Keep this Mac awake while a run is going." on={sleep} onChange={setSleep} />
      <Pick label="Confirm before closing during a run" description="Warn before Relay closes while a run is going." value={confirmClose} options={["While a run is active", "Always", "Never"]} onChange={setConfirmClose} />
    </Section>
    <Section title="Notifications">
      <Pick label="Run finished" description="Set when Relay alerts you that a run has finished." value={finished} options={["Always", "Only when unfocused", "Never"]} onChange={setFinished} />
      <Toggle label="Needs you" description="Alert when a run is waiting for you." on={needsYou} onChange={setNeedsYou} />
      <Toggle label="Failures" description="Alert when a run fails." on={failures} onChange={setFailures} />
      <Pick label="Notification sound" description="Sound for finished runs, failures and runs that need you." value={sound} options={["Default", "None"]} onChange={setSound} />
    </Section>
    <Section title="Assistant">
      <Pick label="Send shortcut" description="Choose which keys send a message in the assistant." value={send} options={["Enter", "⌘Enter"]} onChange={setSend} />
    </Section>
  </section>;
}
