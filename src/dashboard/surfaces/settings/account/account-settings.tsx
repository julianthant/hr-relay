import { Pencil } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { BodySection, Button, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, FormGroup, IconButton, Input, PageHeading, ResultRow, dsIcon } from "../../../ds/ui.js";

export type AccountFieldId = "name" | "initials" | "timekeeper" | "ucpathUsername" | "ucpathPassword";

export interface AccountValues {
  readonly name: string;
  readonly initials: string;
  readonly timekeeper: string;
  readonly ucpathUsername: string;
  readonly lastSignedIn: string;
}

export type AccountChatGpt =
  | { readonly state: "connected"; readonly email: string }
  | { readonly state: "limit"; readonly email: string; readonly note: string }
  | { readonly state: "disconnected" };

const EDITABLE: Readonly<Record<AccountFieldId, { label: string; secret?: true }>> = {
  name: { label: "Name" },
  initials: { label: "Initials" },
  timekeeper: { label: "Timekeeper name" },
  ucpathUsername: { label: "Username" },
  ucpathPassword: { label: "Password", secret: true },
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

function Group({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  const group = <FormGroup label={label}>{children}</FormGroup>;
  return title === undefined ? group : <BodySection title={title}>{group}</BodySection>;
}

function EditDialog({ field, value, onClose, onSave }: { field: AccountFieldId; value: string; onClose: () => void; onSave: (value: string) => void }) {
  const { label, secret } = EDITABLE[field];
  const [draft, setDraft] = useState(secret ? "" : value);
  const submit = (event: FormEvent) => { event.preventDefault(); onSave(draft); };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent size="sm" hideClose title={`Edit ${label.toLowerCase()}`}>
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

/** Account page: profile, UCPath sign-in, security, connected accounts and delete, all on the shared rows. */
export function AccountSettings({ values, duo, chatgpt, initialEdit, initialConfirmDelete = false, onSave, onDuoSetup, onSignOut, onChatGptConnect, onChatGptDisconnect, onDelete }: {
  values: AccountValues;
  duo: "ready" | "setup";
  chatgpt: AccountChatGpt;
  initialEdit?: AccountFieldId;
  initialConfirmDelete?: boolean;
  onSave: (field: AccountFieldId, value: string) => void;
  onDuoSetup: () => void;
  onSignOut: () => void;
  onChatGptConnect: () => void;
  onChatGptDisconnect: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState<AccountFieldId | undefined>(initialEdit);
  const [confirmDelete, setConfirmDelete] = useState(initialConfirmDelete);
  const edit = (field: AccountFieldId) => <ValueRow key={field} label={EDITABLE[field].label} value={field === "ucpathPassword" ? MASK : values[field]} onEdit={() => setEditing(field)} />;
  return <section className="settings-compact-page">
    <PageHeading title="Account" />
    <Group label="Profile" title="Profile">
      {edit("name")}
      {edit("initials")}
      {edit("timekeeper")}
      <ValueRow label="Last signed in" value={values.lastSignedIn} />
    </Group>
    <Group label="UCPath sign-in" title="UCPath sign-in">
      {edit("ucpathUsername")}
      {edit("ucpathPassword")}
    </Group>
    <Group label="Security" title="Security">
      <ResultRow label="Duo" className={WITH_CONTROL} value={<span className="inline-flex items-center justify-end gap-3"><span>{duo === "ready" ? "Ready" : "Needs setup"}</span><Button variant="secondary" onClick={onDuoSetup}>Set up again</Button></span>} />
      <ResultRow label="Sign out" className={WITH_CONTROL} value={<Button variant="secondary" onClick={onSignOut}>Sign out</Button>} />
    </Group>
    <Group label="Connected accounts" title="Connected accounts">
      <ResultRow label="ChatGPT" className={WITH_CONTROL} description={chatgpt.state === "limit" ? chatgpt.note : undefined}
        value={chatgpt.state === "disconnected"
          ? <span className="inline-flex items-center justify-end gap-3"><span>Not connected</span><Button variant="secondary" onClick={onChatGptConnect}>Connect</Button></span>
          : <span className="inline-flex items-center justify-end gap-3"><span>{chatgpt.email}</span><Button variant="secondary" onClick={onChatGptDisconnect}>Disconnect</Button></span>} />
    </Group>
    <Group label="Delete account">
      <ResultRow label="Delete account" className={WITH_CONTROL} value={<Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>} />
    </Group>
    {editing !== undefined && <EditDialog field={editing} value={editing === "ucpathPassword" ? "" : values[editing]} onClose={() => setEditing(undefined)} onSave={value => { onSave(editing, value); setEditing(undefined); }} />}
    <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} destructive title={`Delete ${values.name}’s account?`}
      description="Your runs, history, settings, and credentials will be erased from this Mac. This can’t be undone."
      confirmLabel="Delete account" onConfirm={() => { setConfirmDelete(false); onDelete(); }} />
  </section>;
}
