import { Pencil } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import type { z } from "zod";
import { BodySection, Button, Dialog, DialogBody, DialogContent, DialogFooter, Field, FormGroup, IconButton, Input, PageHeading, ResultRow, SecretField, dsIcon, useToasts } from "../../../ds/ui.js";
import { operatorFailureSentence } from "../../../../models/failures/error-catalog.js";
import { isRelayUsername, RELAY_SIGN_IN_FIELD_MAX, type ProfileDetailsChangeRequestSchema, type ProfileDetailsChangeResultSchema, type ProfileLoginChangeResultSchema } from "../../../../models/profiles/public-profile.js";

export interface AccountValues {
  readonly name: string;
  readonly initials: string;
  readonly timekeeper: string;
  readonly timekeeperInitials: string;
  readonly lastSignedInAt: string;
}
export interface AccountPage { readonly values: AccountValues; readonly duo: "ready" | "setup"; readonly onSignOut: () => void; /** Opens the served Duo re-enrolment; resolves to the backend's failure sentence when it could not open. */ readonly onDuoSetup?: () => Promise<string | undefined>; readonly details: (request: ProfileDetailsChangeRequest) => Promise<ProfileDetailsChangeResult>; readonly login: Omit<RelayLogin, "username"> }

function Group({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <BodySection title={label} description={description}><FormGroup label={label}>{children}</FormGroup></BodySection>;
}

/** Account page: read-only profile facts, the changeable Relay username and password, the editable UCPath sign-in, Duo status with Sign out, and Delete account. */
export function AccountSettings({ page, username, ucpath, deleteAccount }: { page: AccountPage; username: string | undefined; ucpath: ReactNode; deleteAccount: ReactNode }) {
  const { duo, onSignOut, onDuoSetup, login } = page;
  const [saved, setSaved] = useState<{ readonly base: string; readonly values: AccountValues } | undefined>();
  const base = JSON.stringify(page.values);
  // A saved result overrides the served values only until the served account itself changes.
  const values = saved?.base === base ? saved.values : page.values;
  const { toast } = useToasts();
  const save = async (request: ProfileDetailsChangeRequest, title: string): Promise<boolean> => {
    let result: ProfileDetailsChangeResult;
    try { result = await page.details(request); } catch { result = { state: "refused", code: "PROFILE_LOGIN_CHANGE_UNKNOWN" }; }
    if (result.state === "changed") { setSaved({ base, values: { ...values, ...result.account } }); return true; }
    toast({ tone: "danger", title: `${title} not changed`, description: operatorFailureSentence(result.code) });
    return false;
  };
  const details = (label: string, shown: string, request: (next: string) => ProfileDetailsChangeRequest) => {
    const thing = label.toLowerCase();
    return <PencilRow label={label} shown={shown} pencilLabel={`Edit ${thing}`} title={`Edit ${thing}`}
      dialog={close => <EditTextDialog label={label} value={shown} close={close} onSave={next => save(request(next), label)} />} />;
  };
  return <section className="settings-compact-page settings-account-page">
    <PageHeading title="Account" />
    <Group label="Relay account" description="How you sign in to Relay.">
      {details("Name", values.name, next => { const [firstName = "", ...rest] = next.split(/\s+/u); return { name: { firstName, lastName: rest.join(" ") } }; })}
      <RelayLoginRows login={{ ...login, username }} />
      {details("Initials", values.initials, initials => ({ initials }))}
      <ResultRow label="Last signed in" value={new Date(values.lastSignedInAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} />
    </Group>
    {ucpath}
    <Group label="Workflow configuration">
      {details("Timekeeper name", values.timekeeper, timekeeperName => ({ timekeeperName }))}
      {details("Timekeeper initials", values.timekeeperInitials, timekeeperInitials => ({ timekeeperInitials }))}
    </Group>
    <Group label="Security">
      <ResultRow label="Duo" className="!min-h-[52px]" value={<span className="inline-flex items-center justify-end gap-3"><span>{duo === "ready" ? "Ready" : "Needs setup"}</span>{onDuoSetup && <Button variant="secondary" onClick={() => { void onDuoSetup().then(failure => { if (failure !== undefined) toast({ tone: "danger", title: "Duo setup not opened", description: failure }); }); }}>Set up again</Button>}</span>} />
      <ResultRow label="Sign out" className="!min-h-[52px]" value={<Button variant="secondary" onClick={onSignOut}>Sign out</Button>} />
    </Group>
    {deleteAccount}
  </section>;
}

export type ProfileDetailsChangeRequest = z.infer<typeof ProfileDetailsChangeRequestSchema>;
export type ProfileDetailsChangeResult = z.infer<typeof ProfileDetailsChangeResultSchema>;

/** A value row whose pencil opens a dialog; Cancel and Escape close it and return focus to the pencil. */
export function PencilRow({ label, shown, pencilLabel, title, disabled, dialog }: {
  label: string; shown: string; pencilLabel: string; title: string; disabled?: boolean;
  dialog: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  const close = (): void => setOpen(false);
  return <>
    <ResultRow label={label} value={<span className="inline-flex items-center justify-end gap-3 -mr-0.5">
      <span className="text-ui-muted">{shown}</span>
      <IconButton ref={pencil} type="button" label={pencilLabel} variant="ghost" size="sm" disabled={disabled === true} icon={<Pencil aria-hidden className={dsIcon.sm} />} onClick={() => setOpen(true)} />
    </span>} />
    {open && <Dialog open onOpenChange={next => { if (!next) close(); }}>
      <DialogContent size="sm" hideClose title={title} onCloseAutoFocus={event => { event.preventDefault(); pencil.current?.focus({ preventScroll: true }); }}>
        {dialog(close)}
      </DialogContent>
    </Dialog>}
  </>;
}

/** One text field in a dialog: Save stays off while it is empty and writes only a changed value. */
function EditTextDialog({ label, value, close, onSave }: { label: string; value: string; close: () => void; onSave: (next: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(value);
  const next = draft.trim();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    close();
    if (next !== value) void onSave(next);
  };
  return <form onSubmit={submit} className="flex min-h-0 flex-col">
    <DialogBody><Input autoFocus aria-label={label} autoComplete="off" spellCheck={false} value={draft} onChange={event => setDraft(event.target.value)} /></DialogBody>
    <DialogFooter>
      <Button type="button" variant="muted" onClick={close}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={next === ""}>Save</Button>
    </DialogFooter>
  </form>;
}

export type ProfileLoginChangeResult = z.infer<typeof ProfileLoginChangeResultSchema>;
export interface RelayLogin {
  /** The current Relay username, or undefined while it cannot be read. */
  readonly username: string | undefined;
  readonly changePassword: (request: { currentPassword: string; newPassword: string }) => Promise<ProfileLoginChangeResult>;
  readonly changeUsername: (request: { currentPassword: string; newUsername: string }) => Promise<ProfileLoginChangeResult>;
}

type Kind = "username" | "password";
const LABEL: Record<Kind, string> = { username: "Relay username", password: "Relay password" };

/** Username and Password rows of the Relay account; each pencil opens a dialog that proves the current password. Typed values live only in the open dialog. */
export function RelayLoginRows({ login }: { login: RelayLogin }) {
  const { toast } = useToasts();
  const [changedUsername, setChangedUsername] = useState<string | undefined>();
  const username = changedUsername ?? login.username;
  const apply = async (kind: Kind, currentPassword: string, next: string): Promise<void> => {
    let result: ProfileLoginChangeResult;
    try {
      result = kind === "password" ? await login.changePassword({ currentPassword, newPassword: next }) : await login.changeUsername({ currentPassword, newUsername: next });
    } catch { result = { state: "unknown", code: "PROFILE_LOGIN_CHANGE_UNKNOWN" }; }
    if (result.state === "changed") {
      if (kind === "username") setChangedUsername(next);
      toast({ tone: "success", title: `${LABEL[kind]} changed`, duration: 3000 });
    } else toast({ tone: result.state === "unknown" ? "warning" : "danger", title: `${LABEL[kind]} not changed`, description: operatorFailureSentence(result.code) });
  };
  return <>
    <PencilRow label="Username" shown={username ?? "Not set"} pencilLabel="Edit username" title="Edit username" disabled={username === undefined}
      dialog={close => <UsernameDialog close={close} onSave={(current, next) => apply("username", current, next)} />} />
    <PencilRow label="Password" shown="••••••••" pencilLabel="Change Relay password" title="Change password"
      dialog={close => <PasswordDialog close={close} onSave={(current, next) => apply("password", current, next)} />} />
  </>;
}

function UsernameDialog({ close, onSave }: { close: () => void; onSave: (currentPassword: string, next: string) => Promise<void> }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!isRelayUsername(next)) { setProblem("Use one @ucsd.edu email with no spaces."); return; }
    close();
    void onSave(current, next);
  };
  return <form autoComplete="off" onSubmit={submit} className="flex min-h-0 flex-col">
    <DialogBody className="flex flex-col gap-3">
      <Field label="Current password" orientation="horizontal"><SecretField label="Current password" name="currentPassword" autoFocus required maxLength={1024} autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} /></Field>
      <Field label="New username" orientation="horizontal" error={problem}><Input type="text" name="newUsername" required maxLength={RELAY_SIGN_IN_FIELD_MAX} spellCheck={false} autoComplete="username" value={next} onChange={event => setNext(event.target.value)} /></Field>
    </DialogBody>
    <DialogFooter>
      <Button type="button" variant="muted" onClick={close}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={current === "" || next.trim() === ""}>Save</Button>
    </DialogFooter>
  </form>;
}

/** The Relay password asks for the current one, then the new one twice; Save stays off until all three are filled and the new ones match. */
function PasswordDialog({ close, onSave }: { close: () => void; onSave: (currentPassword: string, next: string) => Promise<void> }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const mismatch = again !== "" && again !== next;
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    close();
    void onSave(current, next);
  };
  return <form autoComplete="off" onSubmit={submit} className="flex min-h-0 flex-col">
    <DialogBody className="flex flex-col gap-3">
      <SecretField label="Current password" name="currentPassword" autoFocus placeholder="Current password" maxLength={1024} autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} />
      <SecretField label="New password" name="newPassword" placeholder="New password" maxLength={RELAY_SIGN_IN_FIELD_MAX} autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)} />
      <SecretField label="Confirm new password" name="confirmPassword" placeholder="Confirm new password" maxLength={RELAY_SIGN_IN_FIELD_MAX} autoComplete="new-password" aria-invalid={mismatch || undefined} value={again} onChange={event => setAgain(event.target.value)} />
      {mismatch && <p role="status" className="m-0 text-[12px] leading-4 text-ui-muted">The passwords don’t match.</p>}
    </DialogBody>
    <DialogFooter>
      <Button type="button" variant="muted" onClick={close}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={current === "" || next === "" || next !== again}>Save</Button>
    </DialogFooter>
  </form>;
}
