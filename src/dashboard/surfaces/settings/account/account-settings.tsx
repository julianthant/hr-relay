import { Pencil } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import type { z } from "zod";
import { BodySection, Button, Dialog, DialogBody, DialogContent, DialogFooter, Field, FormGroup, IconButton, Input, PageHeading, ResultRow, SecretField, dsIcon, useToasts } from "../../../ds/ui.js";
import { operatorFailureSentence, type ErrorCatalogCode } from "../../../../models/failures/error-catalog.js";
import { isRelayUsername, RELAY_SIGN_IN_FIELD_MAX, type ProfileDetailsChangeRequestSchema, type ProfileDetailsChangeResultSchema, type ProfileLoginChangeResultSchema } from "../../../../models/profiles/public-profile.js";
import { formatDayTime } from "../../../lib/date-format.js";

export interface AccountValues {
  readonly name: string;
  readonly initials: string;
  readonly timekeeper: string;
  readonly timekeeperInitials: string;
  readonly lastSignedInAt: string;
}
export interface AccountPage { readonly values: AccountValues; readonly onSignOut: () => void; /** Opens the served Duo re-enrolment; resolves to the backend's failure sentence when it could not open. */ readonly onDuoSetup?: () => Promise<string | undefined>; readonly details: (request: ProfileDetailsChangeRequest) => Promise<ProfileDetailsChangeResult>; readonly login: Omit<RelayLogin, "username"> }

function Group({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <BodySection title={label} description={description}><FormGroup label={label}>{children}</FormGroup></BodySection>;
}

/** Account page: read-only profile facts, the changeable Relay username and password, the editable UCPath sign-in, Duo status with Sign out, and Delete account. */
export function AccountSettings({ page, username, ucpath, deleteAccount }: { page: AccountPage; username: string | undefined; ucpath: ReactNode; deleteAccount: ReactNode }) {
  const { onSignOut, onDuoSetup, login } = page;
  const [saved, setSaved] = useState<{ readonly base: string; readonly values: AccountValues } | undefined>();
  const base = JSON.stringify(page.values);
  // A saved result overrides the served values only until the served account itself changes.
  const values = saved?.base === base ? saved.values : page.values;
  const { toast } = useToasts();
  /** Resolves to the refusal sentence to show in the open dialog, or undefined once the dialog may close. */
  const save = async (request: ProfileDetailsChangeRequest, title: string): Promise<string | undefined> => {
    let result: ProfileDetailsChangeResult;
    try { result = await page.details(request); } catch { result = { state: "refused", code: "PROFILE_DETAILS_CHANGE_UNKNOWN" }; }
    if (result.state === "changed") { setSaved({ base, values: { ...values, ...result.account } }); return undefined; }
    if (result.code !== "PROFILE_DETAILS_CHANGE_UNKNOWN") return operatorFailureSentence(result.code);
    toast({ key: `account-details-${title}`, tone: "warning", title: `${title} not confirmed`, description: operatorFailureSentence(result.code) });
    return undefined;
  };
  const details = (label: string, shown: string, request: (next: string) => ProfileDetailsChangeRequest, settingsPath?: string) => {
    const thing = label.toLowerCase();
    const row = <PencilRow label={label} shown={shown} pencilLabel={`Edit ${thing}`} title={`Edit ${thing}`}
      dialog={close => <EditTextDialog label={label} value={shown} close={close} onSave={next => save(request(next), label)} />} />;
    return settingsPath === undefined ? row : <div data-settings-path={settingsPath}>{row}</div>;
  };
  return <section className="settings-compact-page settings-account-page">
    <PageHeading title="Account" />
    <Group label="Relay account" description="How you sign in to Relay.">
      {details("Name", values.name, next => { const [firstName = "", ...rest] = next.split(/\s+/u); return { name: { firstName, lastName: rest.join(" ") } }; })}
      <RelayLoginRows login={{ ...login, username }} />
      {details("Initials", values.initials, initials => ({ initials }))}
      <ResultRow label="Last signed in" value={formatDayTime(values.lastSignedInAt)} />
    </Group>
    {ucpath}
    <Group label="Workflow configuration">
      {details("Timekeeper name", values.timekeeper, timekeeperName => ({ timekeeperName }), "profile.displayName")}
      {details("Timekeeper initials", values.timekeeperInitials, timekeeperInitials => ({ timekeeperInitials }), "profile.initials")}
    </Group>
    <Group label="Security">
      <ResultRow label="Duo" className="!min-h-[52px]" value={<span className="inline-flex items-center justify-end gap-3"><span>Ready</span>{onDuoSetup && <Button variant="secondary" onClick={() => { void onDuoSetup().then(failure => { if (failure !== undefined) toast({ tone: "danger", title: "Duo setup not opened", description: failure }); }); }}>Set up again</Button>}</span>} />
      <ResultRow label="Sign out" className="!min-h-[52px]" value={<Button variant="secondary" onClick={onSignOut}>Sign out</Button>} />
    </Group>
    {deleteAccount}
  </section>;
}

export type ProfileDetailsChangeRequest = z.infer<typeof ProfileDetailsChangeRequestSchema>;
export type ProfileDetailsChangeResult = z.infer<typeof ProfileDetailsChangeResultSchema>;

/** A value row whose pencil opens a dialog; Cancel and Escape close it and return focus to the pencil. */
export function PencilRow({ label, description, shown, pencilLabel, title, disabled, dialog }: {
  label: string; description?: string; shown: string; pencilLabel: string; title: string; disabled?: boolean;
  dialog: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  const close = (): void => setOpen(false);
  return <>
    <ResultRow label={label} description={description} value={<span className="inline-flex items-center justify-end gap-3 -mr-0.5">
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

/** One text field in a dialog: Save stays off while it is empty and writes only a changed value; a refusal stays under the field with the typed value, and the dialog closes only once the change is saved. */
function EditTextDialog({ label, value, close, onSave }: { label: string; value: string; close: () => void; onSave: (next: string) => Promise<string | undefined> }) {
  const [draft, setDraft] = useState(value);
  const [problem, setProblem] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const next = draft.trim();
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (next === value) { close(); return; }
    setSaving(true);
    const refusal = await onSave(next);
    if (refusal === undefined) { close(); return; }
    setSaving(false);
    setProblem(refusal);
  };
  return <form onSubmit={event => { void submit(event); }} className="flex min-h-0 flex-col">
    <DialogBody><Field label={label} error={problem}><Input autoFocus aria-label={label} autoComplete="off" spellCheck={false} value={draft} onChange={event => { setDraft(event.target.value); setProblem(undefined); }} /></Field></DialogBody>
    <DialogFooter>
      <Button type="button" variant="muted" onClick={close}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={next === "" || saving}>Save</Button>
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
  /** Resolves to the refused code to show in the open dialog, or undefined once the dialog may close. */
  const apply = async (kind: Kind, currentPassword: string, next: string): Promise<ErrorCatalogCode | undefined> => {
    let result: ProfileLoginChangeResult;
    try {
      result = kind === "password" ? await login.changePassword({ currentPassword, newPassword: next }) : await login.changeUsername({ currentPassword, newUsername: next });
    } catch { result = { state: "unknown", code: "PROFILE_LOGIN_CHANGE_UNKNOWN" }; }
    const key = `account-${kind}`;
    if (result.state === "changed") {
      if (kind === "username") setChangedUsername(next);
      toast({ key, tone: "success", title: `${LABEL[kind]} changed`, duration: 3000 });
      return undefined;
    }
    if (result.state === "refused") return result.code;
    toast({ key, tone: "warning", title: `${LABEL[kind]} not changed`, description: operatorFailureSentence(result.code) });
    return undefined;
  };
  return <>
    <PencilRow label="Username" description={username === undefined ? "Not set yet. Relay uses your UCPath username, which you set under UCPath sign-in below. Workflows cannot run without a UCPath username and password." : undefined} shown={username ?? "Not set"} pencilLabel="Edit username" title="Edit username" disabled={username === undefined}
      dialog={close => <UsernameDialog close={close} onSave={(current, next) => apply("username", current, next)} />} />
    <PencilRow label="Password" shown="••••••••" pencilLabel="Change Relay password" title="Change password"
      dialog={close => <PasswordDialog close={close} onSave={(current, next) => apply("password", current, next)} />} />
  </>;
}

type Save = (currentPassword: string, next: string) => Promise<ErrorCatalogCode | undefined>;

/** Runs a save that keeps the dialog open on a refusal; the refused code lands under the current-password field or the new value. */
function useSavedDialog(close: () => void, onSave: Save) {
  const [refused, setRefused] = useState<ErrorCatalogCode | undefined>();
  const [saving, setSaving] = useState(false);
  const run = async (current: string, next: string): Promise<void> => {
    setSaving(true);
    const code = await onSave(current, next);
    if (code === undefined) { close(); return; }
    setSaving(false);
    setRefused(code);
  };
  const sentence = refused === undefined ? undefined : operatorFailureSentence(refused);
  return { run, saving, clear: () => setRefused(undefined), onCurrent: refused === "PROFILE_CURRENT_PASSWORD_REFUSED" ? sentence : undefined, onNew: refused === undefined || refused === "PROFILE_CURRENT_PASSWORD_REFUSED" ? undefined : sentence };
}

function UsernameDialog({ close, onSave }: { close: () => void; onSave: Save }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const saved = useSavedDialog(close, onSave);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!isRelayUsername(next)) { setProblem("Use one @ucsd.edu email with no spaces."); return; }
    void saved.run(current, next);
  };
  return <form autoComplete="off" onSubmit={submit} className="flex min-h-0 flex-col">
    <DialogBody className="flex flex-col gap-3">
      <Field label="Current password" orientation="horizontal" error={saved.onCurrent}><SecretField label="Current password" name="currentPassword" autoFocus required maxLength={1024} autoComplete="current-password" value={current} onChange={event => { setCurrent(event.target.value); saved.clear(); }} /></Field>
      <Field label="New username" orientation="horizontal" error={problem ?? saved.onNew}><Input type="text" name="newUsername" required maxLength={RELAY_SIGN_IN_FIELD_MAX} spellCheck={false} autoComplete="username" value={next} onChange={event => { setNext(event.target.value); setProblem(undefined); saved.clear(); }} /></Field>
    </DialogBody>
    <DialogFooter>
      <Button type="button" variant="muted" onClick={close}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={current === "" || next.trim() === "" || saved.saving}>Save</Button>
    </DialogFooter>
  </form>;
}

/** The Relay password asks for the current one, then the new one twice; Save stays off until all three are filled and the new ones match. */
function PasswordDialog({ close, onSave }: { close: () => void; onSave: Save }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const saved = useSavedDialog(close, onSave);
  const mismatch = again !== "" && again !== next;
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void saved.run(current, next);
  };
  return <form autoComplete="off" onSubmit={submit} className="flex min-h-0 flex-col">
    <DialogBody className="flex flex-col gap-3">
      <Field label="Current password" orientation="horizontal" error={saved.onCurrent}><SecretField label="Current password" name="currentPassword" autoFocus maxLength={1024} autoComplete="current-password" value={current} onChange={event => { setCurrent(event.target.value); saved.clear(); }} /></Field>
      <Field label="New password" orientation="horizontal" error={saved.onNew}><SecretField label="New password" name="newPassword" maxLength={RELAY_SIGN_IN_FIELD_MAX} autoComplete="new-password" value={next} onChange={event => { setNext(event.target.value); saved.clear(); }} /></Field>
      <Field label="Confirm new password" orientation="horizontal" error={mismatch ? "The passwords don’t match." : undefined}><SecretField label="Confirm new password" name="confirmPassword" maxLength={RELAY_SIGN_IN_FIELD_MAX} autoComplete="new-password" value={again} onChange={event => setAgain(event.target.value)} /></Field>
    </DialogBody>
    <DialogFooter>
      <Button type="button" variant="muted" onClick={close}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={current === "" || next === "" || next !== again || saved.saving}>Save</Button>
    </DialogFooter>
  </form>;
}
