import { Pencil } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { BodySection, Button, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, FormGroup, IconButton, Input, PageHeading, ResultRow, dsIcon } from "../../../ds/ui.js";

export type AccountFieldId = "name" | "username" | "initials" | "ucpathUsername" | "ucpathPassword" | "timekeeper" | "timekeeperInitials";
export type AccountDialogId = AccountFieldId | "relayPassword";

export interface AccountValues {
  readonly name: string;
  readonly username: string;
  readonly initials: string;
  readonly ucpathUsername: string;
  readonly timekeeper: string;
  readonly timekeeperInitials: string;
  readonly lastSignedIn: string;
}

/** `label` names the field in its dialog; `title` names the pencil and the dialog where two rows share a label. */
const EDITABLE: Readonly<Record<AccountFieldId, { label: string; title: string; secret?: true }>> = {
  name: { label: "Name", title: "name" },
  username: { label: "Username", title: "username" },
  initials: { label: "Initials", title: "initials" },
  ucpathUsername: { label: "Username", title: "UCPath username" },
  ucpathPassword: { label: "Password", title: "UCPath password", secret: true },
  timekeeper: { label: "Timekeeper name", title: "timekeeper name" },
  timekeeperInitials: { label: "Timekeeper initials", title: "timekeeper initials" },
};

const MASK = "••••••••";
/** Account rows that hold a control are 52px; read-only text rows stay one-line height. */
const WITH_CONTROL = "!min-h-[52px]";

/** A grey value on the right; an editable one is followed by a plain pencil. */
function ValueRow({ label, value, onEdit, editLabel }: { label: string; value: string; onEdit?: () => void; editLabel?: string }) {
  return <ResultRow label={label} className={onEdit ? WITH_CONTROL : undefined} value={<span className="inline-flex items-center justify-end gap-2.5">
    <span>{value}</span>
    {onEdit && <IconButton size="xs" label={editLabel ?? `Edit ${label}`} icon={<Pencil aria-hidden className={dsIcon.md} />} onClick={onEdit} className="mr-0.5" />}
  </span>} />;
}

function Group({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <BodySection title={label} description={description}><FormGroup label={label}>{children}</FormGroup></BodySection>;
}

function EditDialog({ field, value, onClose, onSave }: { field: AccountFieldId; value: string; onClose: () => void; onSave: (value: string) => void }) {
  const { label, title, secret } = EDITABLE[field];
  const [draft, setDraft] = useState(secret ? "" : value);
  const submit = (event: FormEvent) => { event.preventDefault(); onSave(draft); };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent size="sm" hideClose title={`Edit ${title}`}>
      <form onSubmit={submit} className="flex min-h-0 flex-col">
        <DialogBody><Input autoFocus aria-label={label} type={secret ? "password" : "text"} autoComplete="off" spellCheck={false} value={draft} onChange={event => setDraft(event.target.value)} /></DialogBody>
        <DialogFooter>
          <Button type="button" variant="muted" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={draft.trim() === ""}>Save</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

/** The Relay password asks for the current one, then the new one twice. */
function ChangePasswordDialog({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const mismatch = again !== "" && again !== next;
  const submit = (event: FormEvent) => { event.preventDefault(); onSave(); };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent size="sm" hideClose title="Change password">
      <form onSubmit={submit} className="flex min-h-0 flex-col">
        <DialogBody className="flex flex-col gap-3">
          <Input autoFocus aria-label="Current password" placeholder="Current password" type="password" autoComplete="off" value={current} onChange={event => setCurrent(event.target.value)} />
          <Input aria-label="New password" placeholder="New password" type="password" autoComplete="off" value={next} onChange={event => setNext(event.target.value)} />
          <Input aria-label="Confirm new password" placeholder="Confirm new password" type="password" autoComplete="off" aria-invalid={mismatch || undefined} value={again} onChange={event => setAgain(event.target.value)} />
          {mismatch && <p role="status" className="m-0 text-[12px] leading-4 text-ui-muted">The passwords don’t match.</p>}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="muted" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={current === "" || next === "" || next !== again}>Save</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

/** Account page: the Relay account, UCPath sign-in, workflow configuration, security and delete, all on the shared rows. */
export function AccountSettings({ values, duo, initialEdit, initialConfirmDelete = false, onSave, onPasswordChange, onDuoSetup, onSignOut, onDelete }: {
  values: AccountValues;
  duo: "ready" | "setup";
  initialEdit?: AccountDialogId;
  initialConfirmDelete?: boolean;
  onSave: (field: AccountFieldId, value: string) => void;
  onPasswordChange: () => void;
  onDuoSetup: () => void;
  onSignOut: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState<AccountDialogId | undefined>(initialEdit);
  const [confirmDelete, setConfirmDelete] = useState(initialConfirmDelete);
  const edit = (field: AccountFieldId) => {
    const { label, title } = EDITABLE[field];
    return <ValueRow key={field} label={label} value={field === "ucpathPassword" ? MASK : values[field]} editLabel={`Edit ${title}`} onEdit={() => setEditing(field)} />;
  };
  return <section className="settings-compact-page">
    <PageHeading title="Account" />
    <Group label="Relay account" description="How you sign in to Relay.">
      {edit("name")}
      {edit("username")}
      <ValueRow label="Password" value={MASK} editLabel="Change Relay password" onEdit={() => setEditing("relayPassword")} />
      {edit("initials")}
      <ValueRow label="Last signed in" value={values.lastSignedIn} />
    </Group>
    <Group label="UCPath sign-in" description="What workflows use to sign in to UCPath. Separate from your Relay account.">
      {edit("ucpathUsername")}
      {edit("ucpathPassword")}
    </Group>
    <Group label="Workflow configuration">
      {edit("timekeeper")}
      {edit("timekeeperInitials")}
    </Group>
    <Group label="Security">
      <ResultRow label="Duo" className={WITH_CONTROL} value={<span className="inline-flex items-center justify-end gap-3"><span>{duo === "ready" ? "Ready" : "Needs setup"}</span><Button variant="secondary" onClick={onDuoSetup}>Set up again</Button></span>} />
      <ResultRow label="Sign out" className={WITH_CONTROL} value={<Button variant="secondary" onClick={onSignOut}>Sign out</Button>} />
    </Group>
    <FormGroup label="Delete account">
      <ResultRow label="Delete account" className={WITH_CONTROL} value={<Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>} />
    </FormGroup>
    {editing === "relayPassword" && <ChangePasswordDialog onClose={() => setEditing(undefined)} onSave={() => { onPasswordChange(); setEditing(undefined); }} />}
    {editing !== undefined && editing !== "relayPassword" && <EditDialog field={editing} value={editing === "ucpathPassword" ? "" : values[editing]} onClose={() => setEditing(undefined)} onSave={value => { onSave(editing, value); setEditing(undefined); }} />}
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} destructive title={`Delete ${values.name}’s account?`}
      description="Your runs, history, settings, and credentials will be erased from this Mac. This can’t be undone."
      confirmLabel="Delete account" onConfirm={() => { setConfirmDelete(false); onDelete(); }} />
  </section>;
}
