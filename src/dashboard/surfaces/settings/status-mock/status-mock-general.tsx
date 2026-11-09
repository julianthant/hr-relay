import { useState, type ReactNode } from "react";
import { BodySection, Button, DateInput, FormGroup, Input, PageHeading, ResultRow, Select, Switch } from "../../../ds/ui.js";
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
  const [defaultPermissions, setDefaultPermissions] = useState(true);
  const [fullAccess, setFullAccess] = useState(false);
  const [theme, setTheme] = useState("Dark");
  const [animations, setAnimations] = useState(true);
  const [jobEnd, setJobEnd] = useState("");
  const [headless, setHeadless] = useState(true);
  const [sleep, setSleep] = useState(true);
  const [confirmClose, setConfirmClose] = useState("While a run is active");
  const [finished, setFinished] = useState("Only when unfocused");
  const [needsYou, setNeedsYou] = useState(true);
  const [failures, setFailures] = useState(true);
  const [sound, setSound] = useState("Default");
  const [send, setSend] = useState("Enter");
  return <section className="settings-compact-page">
    <PageHeading title="General" />
    <Section title="ChatGPT permissions">
      <Toggle label="Default permissions" description="By default, the assistant can read runs and look people up. It asks before starting runs or saving anything." on={defaultPermissions} onChange={setDefaultPermissions} />
      <Toggle label="Full access" description="The assistant can start dry runs and answer run questions without asking. Live runs and saves always ask." on={fullAccess} onChange={setFullAccess} />
    </Section>
    <Section title="General">
      <ResultRow controlWidth="wide" label="Downloads" description="Onboarding documents, run downloads and exports."
        value={<span className="inline-flex items-center justify-end gap-3"><span title={DOWNLOADS} className="whitespace-nowrap font-mono text-[13px]">{middle(DOWNLOADS)}</span><Button variant="secondary">Change</Button></span>} />
      <Pick label="Theme" description="Light, dark or follow this Mac." value={theme} options={["Light", "Dark", "System"]} onChange={setTheme} />
      <Toggle label="Animations" on={animations} onChange={setAnimations} />
      <ResultRow label="Default job end date" description="Default end date for job records." value={<DateInput name="jobEndDate" label="Default job end date" value={jobEnd} onChange={setJobEnd} valueFormat="us" hideLabel />} />
    </Section>
    <Section title="Runs">
      <Toggle label="Run without a browser window" description="Use headless browser sessions." on={headless} onChange={setHeadless} />
      <ResultRow label="Browser window" description="Size used when Relay opens a browser." value={<span className="inline-flex items-center justify-end gap-2"><Input aria-label="Browser width" defaultValue="1440" className="w-[84px]" /><span>×</span><Input aria-label="Browser height" defaultValue="1000" className="w-[84px]" /></span>} />
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
