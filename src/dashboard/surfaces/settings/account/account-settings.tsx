import type { ReactNode } from "react";
import { BodySection, Button, FormGroup, PageHeading, ResultRow } from "../../../ds/ui.js";

export interface AccountValues {
  readonly name: string;
  readonly initials: string;
  readonly timekeeper: string;
  readonly lastSignedInAt: string;
}
export interface AccountPage { readonly values: AccountValues; readonly duo: "ready" | "setup"; readonly onSignOut: () => void }

function Group({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <BodySection title={label} description={description}><FormGroup label={label}>{children}</FormGroup></BodySection>;
}

/** Account page: read-only profile facts, the editable UCPath sign-in, Duo status with Sign out, and Delete account. */
export function AccountSettings({ page, ucpath, deleteAccount }: { page: AccountPage; ucpath: ReactNode; deleteAccount: ReactNode }) {
  const { values, duo, onSignOut } = page;
  return <section className="settings-compact-page">
    <PageHeading title="Account" />
    <Group label="Relay account" description="How you sign in to Relay.">
      <ResultRow label="Name" value={values.name} />
      <ResultRow label="Initials" value={values.initials} />
      <ResultRow label="Last signed in" value={new Date(values.lastSignedInAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} />
    </Group>
    {ucpath}
    <Group label="Workflow configuration">
      <ResultRow label="Timekeeper name" value={values.timekeeper} />
      <ResultRow label="Timekeeper initials" value={values.initials} />
    </Group>
    <Group label="Security">
      <ResultRow label="Duo" value={duo === "ready" ? "Ready" : "Needs setup"} />
      <ResultRow label="Sign out" className="!min-h-[52px]" value={<Button variant="secondary" onClick={onSignOut}>Sign out</Button>} />
    </Group>
    {deleteAccount}
  </section>;
}
