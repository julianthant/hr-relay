import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { z } from "zod";
import { BodySection, Button, Dialog, DialogBody, DialogContent, DialogFooter, Field, FormGroup, IconButton, Input, PageHeading, ResultRow, SecretField, Skeleton, dsIcon, useToasts } from "../../../ds/ui.js";
import { operatorFailureSentence, type ErrorCatalogCode } from "../../../../models/failures/error-catalog.js";
import { isRelayUsername, RELAY_SIGN_IN_FIELD_MAX, type ProfileDetailsChangeRequestSchema, type ProfileDetailsChangeResultSchema, type ProfileLoginChangeResultSchema } from "../../../../models/profiles/public-profile.js";
import { formatDayTime, formatInstantDate } from "../../../lib/date-format.js";
import { readBack } from "../../../app/commands/command-readback.js";
import { DuoKeyNameSchema, type DuoKeyChange } from "../../../../models/config/duo-credential-store.js";
import { DUO_SECURITY_TARGET } from "../preflight/preflight-remedy-model.js";
import type { DuoKeyChangeResult, DuoKeysSnapshot } from "../../../../models/profiles/public-profile.js";

export interface AccountValues {
  /** The stored UCPath sign-in email, separate from the Relay username. */
  readonly ucpathUsername?: string;
  readonly name: string;
  readonly initials: string;
  readonly timekeeper: string;
  readonly timekeeperInitials: string;
  readonly lastSignedInAt: string;
  /** Absent until the next sign-in rewrites a stale registry email. */
  readonly username?: string | undefined;
}
export interface AccountPage { readonly values: AccountValues; readonly duoKeys?: DuoKeysPort; /** Opens the served Duo re-enrolment; resolves to the backend's failure sentence when it could not open. */ readonly onDuoSetup?: () => Promise<string | undefined>; readonly details: (request: ProfileDetailsChangeRequest) => Promise<ProfileDetailsChangeResult>; /** The served account now, read back after a details change whose reply was lost. */ readonly readAccount?: () => Promise<AccountValues | undefined>; readonly login: Omit<RelayLogin, "username"> }

/** Whether the served account shows every value the change asked for. */
function showsChange(request: ProfileDetailsChangeRequest, account: AccountValues | undefined): account is AccountValues {
  return account !== undefined && (request.name === undefined || account.name === `${request.name.firstName} ${request.name.lastName}`)
    && (request.initials === undefined || account.initials === request.initials)
    && (request.timekeeperName === undefined || account.timekeeper === request.timekeeperName)
    && (request.timekeeperInitials === undefined || account.timekeeperInitials === request.timekeeperInitials);
}

function Group({ label, description, notice, children }: { label: string; description?: string; notice?: ReactNode; children: ReactNode }) {
  return <BodySection title={label} description={description}>{notice !== undefined && <div className="my-[var(--ds-space-section)]">{notice}</div>}<FormGroup label={label}>{children}</FormGroup></BodySection>;
}

/** Account page: read-only profile facts, the changeable Relay username and password, the editable UCPath sign-in, Duo status, and Delete account. */
export function AccountSettings({ page, username, ucpath, credentialsNotice, deleteAccount }: { page: AccountPage; username: string | undefined; ucpath: ReactNode; credentialsNotice?: ReactNode; deleteAccount: ReactNode }) {
  const { duoKeys, onDuoSetup, login } = page;
  const [saved, setSaved] = useState<{ readonly base: string; readonly values: AccountValues } | undefined>();
  const base = JSON.stringify(page.values);
  // A saved result overrides the served values only until the served account itself changes.
  const values = saved?.base === base ? saved.values : page.values;
  const { toast } = useToasts();
  // The session's account is read at sign-in, so a username changed earlier shows again only once re-read here; a read account with no username shows none.
  const [read, setRead] = useState<AccountValues | undefined>();
  const readAccount = useRef(page.readAccount);
  useEffect(() => {
    let live = true;
    void readAccount.current?.().then(account => { if (live) setRead(account); }, () => undefined);
    return () => { live = false; };
  }, []);
  /** Resolves to the refusal sentence to show in the open dialog, or undefined once the dialog may close. */
  const save = async (request: ProfileDetailsChangeRequest, title: string): Promise<string | undefined> => {
    let result: ProfileDetailsChangeResult;
    try { result = await page.details(request); } catch { result = { state: "refused", code: "PROFILE_DETAILS_CHANGE_UNKNOWN" }; }
    if (result.state === "changed") { setSaved({ base, values: { ...values, ...result.account } }); return undefined; }
    if (result.code !== "PROFILE_DETAILS_CHANGE_UNKNOWN") return operatorFailureSentence(result.code);
    // A lost reply is read back: the served value shows silently, or one failure toast.
    const read = page.readAccount;
    const served = read === undefined ? undefined : await readBack(read, account => showsChange(request, account));
    if (showsChange(request, served)) { setSaved({ base, values: { ...values, ...served } }); return undefined; }
    toast({ key: `account-details-${title}`, tone: "danger", title: `${title} not saved` });
    return undefined;
  };
  const details = (label: string, shown: string, request: (next: string) => ProfileDetailsChangeRequest, settingsPath?: string) => {
    const thing = label.toLowerCase();
    const row = <PencilRow label={label} shown={shown} pencilLabel={`Edit ${thing}`} title={`Edit ${thing}`}
      dialog={close => <EditTextDialog label={label} value={shown} close={close} onSave={next => save(request(next), label)} />} />;
    return settingsPath === undefined ? row : <div data-settings-path={settingsPath}>{row}</div>;
  };
  return <section className="settings-compact-page settings-account-page">
    <PageHeading title="Account" description="Sign-in details and protected workflow configuration." />
    <Group label="Relay account" description="How you sign in to Relay.">
      {details("Name", values.name, next => { const [firstName = "", ...rest] = next.split(/\s+/u); return { name: { firstName, lastName: rest.join(" ") } }; })}
      <RelayLoginRows login={{ ...login, username: read === undefined ? username : read.username }} />
      {details("Initials", values.initials, initials => ({ initials }))}
      <ResultRow label="Last signed in" value={<span className="inline-flex items-center justify-end gap-3"><span className="text-ui-primary">{formatDayTime(values.lastSignedInAt)}</span><span aria-hidden className="size-[var(--ds-h-sm)]" /></span>} />
    </Group>
    {ucpath}
    <Group label="Workflow configuration" description="Names workflows put on the forms they file." notice={credentialsNotice}>
      {details("Timekeeper name", values.timekeeper, timekeeperName => ({ timekeeperName }), "profile.displayName")}
      {details("Timekeeper initials", values.timekeeperInitials, timekeeperInitials => ({ timekeeperInitials }), "profile.initials")}
    </Group>
    <Group label="Security" description="Duo security keys for signing in.">
      <DuoSecurityKeys port={duoKeys} onSetup={onDuoSetup} />
    </Group>
    {deleteAccount}
  </section>;
}

export type ProfileDetailsChangeRequest = z.infer<typeof ProfileDetailsChangeRequestSchema>;
export type ProfileDetailsChangeResult = z.infer<typeof ProfileDetailsChangeResultSchema>;

/** A value row whose pencil opens a dialog; Cancel and Escape close it and return focus to the pencil. */
export function PencilRow({ label, description, shown, pencilLabel, title, dialog }: {
  label: string; description?: string; shown: string; pencilLabel: string; title: string;
  dialog: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  const close = (): void => setOpen(false);
  return <>
    <ResultRow label={label} description={description} value={<span className="inline-flex items-center justify-end gap-3">
      <span className="text-ui-primary">{shown}</span>
      <IconButton ref={pencil} type="button" label={pencilLabel} variant="ghost" size="sm" icon={<Pencil aria-hidden className={dsIcon.sm} />} onClick={() => setOpen(true)} />
    </span>} />
    {open && <Dialog open onOpenChange={next => { if (!next) close(); }}>
      <DialogContent size="sm" className="settings-edit-dialog" title={title} onCloseAutoFocus={event => { event.preventDefault(); pencil.current?.focus({ preventScroll: true }); }}>
        {dialog(close)}
      </DialogContent>
    </Dialog>}
  </>;
}

/** One text field in a dialog: Save stays off until the value is non-empty and changed; a refusal stays under the field with the typed value, and the dialog closes only once the change is saved. */
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
      <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={next === "" || next === value || saving}>Save</Button>
    </DialogFooter>
  </form>;
}

export type ProfileLoginChangeResult = z.infer<typeof ProfileLoginChangeResultSchema>;
export interface RelayLogin {
  /** The served Relay username, or undefined until the next sign-in. */
  readonly username: string | undefined;
  readonly changePassword: (request: { currentPassword: string; newPassword: string }) => Promise<ProfileLoginChangeResult>;
  readonly changeUsername: (request: { currentPassword: string; newUsername: string }) => Promise<ProfileLoginChangeResult>;
  /** The served Relay username now, read back after a username change whose reply was lost. */
  readonly readUsername?: () => Promise<string | undefined>;
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
    if (kind === "username" && login.readUsername !== undefined) {
      // A lost username reply is read back: the served username shows silently, or one failure toast.
      const read = login.readUsername;
      const served = await readBack(read, now => now === next);
      if (served === next) { setChangedUsername(next); return undefined; }
      // An absent served username means the change may have landed: it is not confirmed either way.
      toast({ key, tone: "danger", title: served === undefined ? `${LABEL[kind]} change not confirmed` : `${LABEL[kind]} not changed` });
      return undefined;
    }
    // A password can't be read back, so a lost reply ends in one short line and no instructions.
    toast({ key, tone: "danger", title: `${LABEL[kind]} change not confirmed` });
    return undefined;
  };
  return <>
    <PencilRow label="Username" shown={username ?? "Shown after your next sign-in"} pencilLabel="Edit username" title="Edit username"
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
      <Field label="Current password" error={saved.onCurrent}><SecretField label="Current password" name="currentPassword" autoFocus required maxLength={1024} autoComplete="current-password" value={current} onChange={event => { setCurrent(event.target.value); saved.clear(); }} /></Field>
      <Field label="New username" error={problem ?? saved.onNew}><Input type="text" name="newUsername" required maxLength={RELAY_SIGN_IN_FIELD_MAX} spellCheck={false} autoComplete="username" value={next} onChange={event => { setNext(event.target.value); setProblem(undefined); saved.clear(); }} /></Field>
    </DialogBody>
    <DialogFooter>
      <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
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
      <Field label="Current password" error={saved.onCurrent}><SecretField label="Current password" name="currentPassword" autoFocus maxLength={1024} autoComplete="current-password" value={current} onChange={event => { setCurrent(event.target.value); saved.clear(); }} /></Field>
      <Field label="New password" error={saved.onNew}><SecretField label="New password" name="newPassword" maxLength={RELAY_SIGN_IN_FIELD_MAX} autoComplete="new-password" value={next} onChange={event => { setNext(event.target.value); saved.clear(); }} /></Field>
      <Field label="Confirm new password" error={mismatch ? "The passwords don’t match." : undefined}><SecretField label="Confirm new password" name="confirmPassword" maxLength={RELAY_SIGN_IN_FIELD_MAX} autoComplete="new-password" value={again} onChange={event => setAgain(event.target.value)} /></Field>
    </DialogBody>
    <DialogFooter>
      <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={current === "" || next === "" || next !== again || saved.saving}>Save</Button>
    </DialogFooter>
  </form>;
}

interface DuoKeysPort {
  read(): Promise<DuoKeysSnapshot>;
  change(change: DuoKeyChange): Promise<DuoKeyChangeResult>;
}

type SecurityKey = DuoKeysSnapshot["keys"][number];
type KeyDialog = { readonly owner: DuoKeysPort; readonly kind: DuoKeyChange["kind"]; readonly key: SecurityKey; readonly trigger: HTMLButtonElement };
type KeyList = { readonly owner: DuoKeysPort; readonly state: "ready"; readonly snapshot: DuoKeysSnapshot }
  | { readonly owner: DuoKeysPort; readonly state: "failed" };

function DuoSecurityKeys({ port, onSetup }: { port?: DuoKeysPort; onSetup?: () => Promise<string | undefined> }) {
  const [list, setList] = useState<KeyList>();
  const [readAttempt, retry] = useState(0);
  const [selected, select] = useState<KeyDialog>();
  const setup = useRef<HTMLButtonElement>(null);
  const currentOwner = useRef<DuoKeysPort | undefined>(undefined);
  const { toast } = useToasts();
  useEffect(() => {
    if (port === undefined) return;
    currentOwner.current = port;
    let cancelled = false;
    void port.read().then(snapshot => {
      if (!cancelled) setList({ owner: port, state: "ready", snapshot });
    }, () => {
      if (!cancelled) setList({ owner: port, state: "failed" });
    });
    return () => { cancelled = true; currentOwner.current = undefined; };
  }, [port, readAttempt]);
  const state = list?.owner === port ? list : undefined;
  const snapshot = state?.state === "ready" ? state.snapshot : undefined;
  const dialog = selected?.owner === port ? selected : undefined;
  const ready = snapshot !== undefined && snapshot.keys.length > 0;
  const refresh = () => { setList(undefined); retry(value => value + 1); };
  const change = async (active: KeyDialog, revision: number, name: string): Promise<string | undefined> => {
    const owner = active.owner;
    const target = { commandId: globalThis.crypto.randomUUID(), keyId: active.key.id, expectedRevision: revision };
    try {
      const result = await owner.change(active.kind === "rename" ? { ...target, kind: "rename", name } : { ...target, kind: "remove" });
      if (currentOwner.current !== owner) return undefined;
      if (result.state === "name-in-use") return "Another security key already uses this name.";
      if (result.state === "refused") {
        if (result.code === "DUO_CREDENTIAL_CONFLICT") {
          refresh();
          toast({ tone: "danger", title: operatorFailureSentence(result.code) });
          return undefined;
        }
        return operatorFailureSentence(result.code);
      }
      setList({ owner, state: "ready", snapshot: result.snapshot });
    } catch {
      const settled = (snapshot: DuoKeysSnapshot) => {
        const row = snapshot.keys.find(key => key.id === target.keyId);
        return snapshot.revision > revision && (active.kind === "remove" ? row === undefined : row?.name === name);
      };
      const served = await readBack(() => owner.read(), settled);
      if (currentOwner.current === owner) {
        if (served === undefined) refresh();
        else setList({ owner, state: "ready", snapshot: served });
        if (served === undefined || !settled(served)) toast({ tone: "danger", title: "Duo key change could not be confirmed" });
      }
    }
    return undefined;
  };

  return <>
    <div data-settings-path={DUO_SECURITY_TARGET}><ResultRow label="Duo" value={
      <span className="inline-flex items-center justify-end gap-3">
        {snapshot !== undefined ? <span className="text-ui-primary">{ready ? "Ready" : null}</span>
          : state?.state === "failed" || port === undefined ? <span>Duo keys unavailable</span>
          : <span role="status" aria-label="Loading Duo security keys"><Skeleton className="h-3 w-16" /></span>}
        {snapshot !== undefined && onSetup !== undefined && <Button ref={setup} variant="secondary" onClick={() => {
          void onSetup().then(failure => { if (failure !== undefined) toast({ tone: "danger", title: "Duo setup not opened", description: failure }); });
        }}>{ready ? "Set up again" : "Set up"}</Button>}
        {state?.state === "failed" && <Button variant="secondary" onClick={refresh}>Retry</Button>}
      </span>} /></div>
    {port !== undefined && snapshot?.keys.map(key => {
      const name = key.name ?? `Key ${key.shortId}`;
      const dates = `Added ${formatInstantDate(key.addedAt)} · ${key.lastUsedAt === undefined ? "Last used unknown" : `Last used ${formatInstantDate(key.lastUsedAt)}`}`;
      return <ResultRow key={key.id} label={<span className="break-words">{name}</span>}
        description={key.name === undefined ? `Duo name unrecorded · ${dates}` : dates}
        value={<span className="inline-flex items-center gap-2">
          <Button variant="secondary" icon={<Pencil aria-hidden className={dsIcon.md} />} aria-label={`Rename ${name}`} onClick={event => select({ owner: port, kind: "rename", key, trigger: event.currentTarget })}>Rename</Button>
          <Button variant="secondary" icon={<Trash2 aria-hidden className={dsIcon.md} />} aria-label={`Remove ${name}`} onClick={event => select({ owner: port, kind: "remove", key, trigger: event.currentTarget })}>Remove</Button>
        </span>} />;
    })}
    {dialog !== undefined && snapshot !== undefined && <DuoKeyDialog active={dialog} close={() => select(current => current === dialog ? undefined : current)}
      focusFallback={() => setup.current?.focus({ preventScroll: true })} submit={name => change(dialog, snapshot.revision, name)} />}
  </>;
}

function DuoKeyDialog({ active, close, focusFallback, submit }: { active: KeyDialog; close: () => void; focusFallback: () => void;
  submit: (name: string) => Promise<string | undefined> }) {
  const [draft, setDraft] = useState(active.key.name ?? "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  const rename = active.kind === "rename";
  const name = draft.trim();
  const valid = !rename || name !== active.key.name && DuoKeyNameSchema.safeParse(name).success;
  const keyLabel = active.key.name ?? `Key ${active.key.shortId}`;
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (saving || !valid) return;
    setSaving(true);
    const failure = await submit(name);
    if (failure === undefined) close();
    else { setProblem(failure); setSaving(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !saving) close(); }}>
    <DialogContent size="sm" title={rename ? "Rename security key" : "Remove security key?"}
      description={rename ? "Rename this key in Relay to match Duo." : undefined}
      onOpenAutoFocus={rename ? undefined : event => { event.preventDefault(); cancel.current?.focus(); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (active.trigger.isConnected) active.trigger.focus({ preventScroll: true }); else focusFallback(); }}>
      <form onSubmit={event => { void confirm(event); }} className="flex min-h-0 flex-col">
        <DialogBody>{rename ? <Field label="Name" error={problem}><Input autoFocus aria-label="Name" autoComplete="off" spellCheck={false}
          value={draft} maxLength={160} required disabled={saving} onChange={event => { setDraft(event.target.value); setProblem(undefined); }} /></Field>
          : <><p className="break-words"><strong>{keyLabel}</strong> stays registered in Duo. To remove it there, open Manage Devices in Duo and remove the matching security key.</p>
          {problem !== undefined && <p role="alert" className="text-danger">{problem}</p>}</>}</DialogBody>
        <DialogFooter>
          <Button ref={cancel} type="button" variant="secondary" onClick={close} disabled={saving}>Cancel</Button>
          <Button type="submit" variant={rename ? "primary" : "danger"} disabled={saving || !valid}>
            {rename ? saving ? "Saving…" : "Save" : saving ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
