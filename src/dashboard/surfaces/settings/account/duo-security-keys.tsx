import { useEffect, useRef, useState, type FormEvent } from "react";
import { DuoKeyNameSchema, type DuoKeyChange } from "../../../../models/config/duo-credential-store.js";
import { operatorFailureSentence } from "../../../../models/failures/error-catalog.js";
import type { DuoKeyChangeResult, DuoKeysSnapshot } from "../../../../models/profiles/public-profile.js";
import { readBack } from "../../../app/commands/command-readback.js";
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, Field, Input, ResultRow, Skeleton, useToasts } from "../../../ds/ui.js";
import { formatInstantDate } from "../../../lib/date-format.js";

export interface DuoKeysPort {
  read(): Promise<DuoKeysSnapshot>;
  change(change: DuoKeyChange): Promise<DuoKeyChangeResult>;
}

type SecurityKey = DuoKeysSnapshot["keys"][number];
type KeyDialog = { readonly owner: DuoKeysPort; readonly kind: DuoKeyChange["kind"]; readonly key: SecurityKey; readonly trigger: HTMLButtonElement };
type KeyList = { readonly owner: DuoKeysPort; readonly state: "ready"; readonly snapshot: DuoKeysSnapshot }
  | { readonly owner: DuoKeysPort; readonly state: "failed" };

export function DuoSecurityKeys({ port, onSetup }: { port?: DuoKeysPort; onSetup?: () => Promise<string | undefined> }) {
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
      if (currentOwner.current !== owner) return undefined;
      if (served === undefined) refresh();
      else setList({ owner, state: "ready", snapshot: served });
      if (served === undefined || !settled(served)) toast({ tone: "danger", title: "Duo key change could not be confirmed" });
    }
    return undefined;
  };

  return <>
    <ResultRow label="Duo" value={
      <span className="inline-flex items-center justify-end gap-3">
        {snapshot !== undefined ? <span className="text-ui-primary">{ready ? "Ready" : "Not set up"}</span>
          : state?.state === "failed" || port === undefined ? <span>Duo keys unavailable</span>
          : <span role="status" aria-label="Loading Duo security keys"><Skeleton className="h-3 w-16" /></span>}
        {snapshot !== undefined && onSetup !== undefined && <Button ref={setup} variant="secondary" onClick={() => {
          void onSetup().then(failure => { if (failure !== undefined) toast({ tone: "danger", title: "Duo setup not opened", description: failure }); });
        }}>{ready ? "Set up again" : "Set up"}</Button>}
        {state?.state === "failed" && <Button variant="secondary" onClick={refresh}>Retry</Button>}
      </span>} />
    {port !== undefined && snapshot?.keys.map(key => {
      const name = key.name ?? `Key ${key.shortId}`;
      const dates = `Added ${formatInstantDate(key.addedAt)} · ${key.lastUsedAt === undefined ? "Last used unknown" : `Last used ${formatInstantDate(key.lastUsedAt)}`}`;
      return <ResultRow key={key.id} label={<span className="break-words">{name}</span>}
        description={key.name === undefined ? `Duo name unrecorded · ${dates}` : dates}
        value={<span className="inline-flex items-center gap-2">
          <Button variant="secondary" aria-label={`Rename ${name}`} onClick={event => select({ owner: port, kind: "rename", key, trigger: event.currentTarget })}>Rename</Button>
          <Button variant="secondary" aria-label={`Remove ${name}`} onClick={event => select({ owner: port, kind: "remove", key, trigger: event.currentTarget })}>Remove</Button>
        </span>} />;
    })}
    {dialog !== undefined && snapshot !== undefined && <DuoKeyDialog active={dialog} close={() => select(current => current === dialog ? undefined : current)}
      focusFallback={() => setup.current?.focus({ preventScroll: true })} submit={name => change(dialog, snapshot.revision, name)} />}
  </>;
}

function DuoKeyDialog({ active, close, focusFallback, submit }: { active: KeyDialog; close(): void; focusFallback(): void;
  submit(name: string): Promise<string | undefined> }) {
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
      className={rename ? "[&_header_h2]:text-section [&_header_h2]:font-medium [&_label]:font-normal [&_input]:h-10 [&_footer_button]:min-w-[88px] [&_footer_button]:h-9" : undefined}
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
