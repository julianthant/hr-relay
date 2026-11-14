import { Pencil } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { z } from "zod";
import { BodySection, Button, Dialog, DialogBody, DialogContent, DialogFooter, Field, FormGroup, IconButton, Input, PageHeading, ResultRow, SecretField, dsIcon, useToasts } from "../../../ds/ui.js";
import { operatorFailureSentence } from "../../../../models/failures/error-catalog.js";
import { profileInitials } from "../../../../models/profiles/profile-identity.js";
import { isRelayUsername, RELAY_SIGN_IN_FIELD_MAX, type ProfileDetailsChangeRequestSchema, type ProfileDetailsChangeResultSchema, type ProfileLoginChangeResultSchema } from "../../../../models/profiles/public-profile.js";

export interface AccountValues {
  readonly name: string;
  readonly initials: string;
  readonly timekeeper: string;
  readonly lastSignedInAt: string;
}
export interface AccountPage { readonly values: AccountValues; readonly duo: "ready" | "setup"; readonly onSignOut: () => void; readonly details: (request: ProfileDetailsChangeRequest) => Promise<ProfileDetailsChangeResult>; readonly login: Omit<RelayLogin, "username"> }

function Group({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <BodySection title={label} description={description}><FormGroup label={label}>{children}</FormGroup></BodySection>;
}

/** Account page: read-only profile facts, the changeable Relay username and password, the editable UCPath sign-in, Duo status with Sign out, and Delete account. */
export function AccountSettings({ page, username, ucpath, deleteAccount }: { page: AccountPage; username: string | undefined; ucpath: ReactNode; deleteAccount: ReactNode }) {
  const { duo, onSignOut, login } = page;
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
  const details = (label: string, shown: string, request: (next: string) => ProfileDetailsChangeRequest) =>
    <EditableRow label={label} value={shown} onSave={next => save(request(next), label)} />;
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
      <ResultRow label="Timekeeper initials" value={profileInitials(values.timekeeper)} />
    </Group>
    <Group label="Security">
      <ResultRow label="Duo" value={duo === "ready" ? "Ready" : "Needs setup"} />
      <ResultRow label="Sign out" className="!min-h-[52px]" value={<Button variant="secondary" onClick={onSignOut}>Sign out</Button>} />
    </Group>
    {deleteAccount}
  </section>;
}

export type ProfileDetailsChangeRequest = z.infer<typeof ProfileDetailsChangeRequestSchema>;
export type ProfileDetailsChangeResult = z.infer<typeof ProfileDetailsChangeResultSchema>;

/** A value row whose pencil swaps the value for an inline field: Enter saves, Escape cancels, and focus returns to the pencil. */
function EditableRow({ label, value, onSave }: { label: string; value: string; onSave: (next: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState<string | undefined>();
  const pencil = useRef<HTMLButtonElement>(null);
  const editing = draft !== undefined;
  const refocus = useRef(false);
  useEffect(() => { if (!editing && refocus.current) { refocus.current = false; pencil.current?.focus({ preventScroll: true }); } }, [editing]);
  const finish = async (save: boolean): Promise<void> => {
    const next = draft?.trim();
    refocus.current = true;
    setDraft(undefined);
    if (save && next !== undefined && next !== value) await onSave(next);
  };
  return <ResultRow label={label} value={editing
    ? <Input aria-label={label} value={draft} autoFocus spellCheck={false} onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); void finish(true); }
          else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void finish(false); }
        }} />
    : <span className="inline-flex items-center justify-end gap-3 -mr-0.5">
        <span className="text-ui-muted">{value}</span>
        <IconButton ref={pencil} type="button" label={`Edit ${label}`} variant="ghost" size="sm" icon={<Pencil aria-hidden className={dsIcon.sm} />} onClick={() => setDraft(value)} />
      </span>} />;
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

/** Username and Password rows of the Relay account; each pencil opens a dialog that proves the current password. Typed values live only in the dialog's uncontrolled inputs. */
export function RelayLoginRows({ login }: { login: RelayLogin }) {
  const { toast } = useToasts();
  const [open, setOpen] = useState<Kind | null>(null);
  const [changedUsername, setChangedUsername] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const username = changedUsername ?? login.username;
  const close = (): void => { setOpen(null); setProblem(undefined); };
  const submit = async (kind: Kind, event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string): string => { const value = data.get(name); return typeof value === "string" ? value : ""; };
    const currentPassword = text("currentPassword");
    const next = text(kind === "password" ? "newPassword" : "newUsername");
    if (kind === "username" && !isRelayUsername(next)) { setProblem("Use one @ucsd.edu email with no spaces."); return; }
    close();
    let result: ProfileLoginChangeResult;
    try {
      result = kind === "password" ? await login.changePassword({ currentPassword, newPassword: next }) : await login.changeUsername({ currentPassword, newUsername: next });
    } catch { result = { state: "unknown", code: "PROFILE_LOGIN_CHANGE_UNKNOWN" }; }
    if (result.state === "changed") {
      if (kind === "username") setChangedUsername(next);
      toast({ tone: "success", title: `${LABEL[kind]} changed`, duration: 3000 });
    } else toast({ tone: result.state === "unknown" ? "warning" : "danger", title: `${LABEL[kind]} not changed`, description: operatorFailureSentence(result.code) });
  };
  const row = (kind: Kind, shown: string) => <ResultRow label={kind === "username" ? "Username" : "Password"} value={<span className="inline-flex items-center justify-end gap-3 -mr-0.5">
    <span className="text-ui-muted">{shown}</span>
    <IconButton type="button" label={`Edit ${LABEL[kind]}`} variant="ghost" size="sm" disabled={kind === "username" && username === undefined}
      icon={<Pencil aria-hidden className={dsIcon.sm} />} onClick={() => setOpen(kind)} />
  </span>} />;
  return <>
    {row("username", username ?? "Not set")}
    {row("password", "••••••••")}
    {open !== null && <Dialog open onOpenChange={next => { if (!next) close(); }}>
      <DialogContent size="sm" title={LABEL[open]} description="Enter your current password to confirm.">
        <DialogBody><form id="relay-login-form" autoComplete="off" onSubmit={event => { void submit(open, event); }}>
          <Field label="Current password" orientation="horizontal"><SecretField label="Current password" name="currentPassword" required maxLength={1024} autoComplete="current-password" /></Field>
          {open === "password"
            ? <Field label="New password" orientation="horizontal"><SecretField label="New password" name="newPassword" required maxLength={RELAY_SIGN_IN_FIELD_MAX} autoComplete="new-password" /></Field>
            : <Field label="New username" orientation="horizontal" error={problem}><Input type="text" name="newUsername" required maxLength={RELAY_SIGN_IN_FIELD_MAX} spellCheck={false} autoComplete="username" /></Field>}
        </form></DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button type="submit" form="relay-login-form">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>}
  </>;
}
