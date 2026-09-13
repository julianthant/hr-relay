import { useEffect,useMemo,useState } from "react";
import { z } from "zod";
import { systemClock } from "../../domain/clock.js";
import type { CommandResult } from "../../domain/commands.js";
import {
deriveSettingsPatchFingerprint,
SettingsPatchSchema,
type SettingsPatch,
} from "../../domain/config/settings.js";
import type {
EditableSettingsLeafWire,
EditableSettingsPath,
EditableSettingsWire,
} from "../../domain/dashboard/settings-editor.js";
import { useSettingsClient as useDashboardClient } from "../state/settings-client.js";
import { useSettingsPreflight } from "./settings-preflight-model.js";


export type EditableSettingsState =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly message: string }
  | { readonly state: "loaded"; readonly document: EditableSettingsWire };


export type SettingsSaveState =
  | { readonly state: "idle" }
  | { readonly state: "saving" }
  | { readonly state: "applied"; readonly replayed: boolean }
  | { readonly state: "refused"; readonly message: string };


type DraftValues = Partial<Record<EditableSettingsPath, string | number>>;

type DraftErrors = Partial<Record<EditableSettingsPath, string>>;


function currentDraft(document: EditableSettingsWire): DraftValues {
  return Object.fromEntries(document.sections.flatMap((section) => section.leaves.map((leaf) => [leaf.path, leaf.effectiveValue])));
}


function leafFor(document: EditableSettingsWire, path: EditableSettingsPath): EditableSettingsLeafWire {
  const leaf = document.sections.flatMap((section) => section.leaves).find((candidate) => candidate.path === path);
  if (leaf === undefined) throw new Error(`settings editor did not serve leaf ${path}`);
  return leaf;
}


function patchFromDraft(document: EditableSettingsWire, draft: DraftValues): SettingsPatch {
  const patch: Record<string, { readonly set: unknown } | { readonly clear: true }> = {};
  const leaves = document.sections.flatMap((section) => section.leaves);
  const dirty = leaves.filter((leaf) => leaf.editable && draft[leaf.path] !== leaf.effectiveValue);
  const displayDirty = dirty.some((leaf) => leaf.path.startsWith("display."));
  const displayLeaves = leaves.filter((leaf) => leaf.path.startsWith("display."));
  const clearDisplay = displayDirty && displayLeaves.every((leaf) => (
    draft[leaf.path] === leaf.defaultValue && leaf.settingsValue !== undefined
  ));
  for (const leaf of leaves) {
    if (!dirty.includes(leaf) && !(displayDirty && leaf.path.startsWith("display."))) continue;
    const value = draft[leaf.path];
    if (value === undefined) throw new Error(`settings editor draft omitted ${leaf.path}`);
    patch[leaf.path] = clearDisplay && leaf.path.startsWith("display.")
      ? { clear: true }
      : value === leaf.defaultValue && leaf.settingsValue !== undefined && !leaf.path.startsWith("display.")
      ? { clear: true }
      : { set: value };
  }
  return SettingsPatchSchema.parse(patch);
}


function commandRefusal(result: CommandResult): string | undefined {
  switch (result.state) {
    case "applied":
    case "already-applied": return undefined;
    case "conflict": return `${result.message} The server is now at revision ${String(result.currentVersion)}; reload before saving.`;
    case "rejected": return result.message;
  }
}


/** The DCC3 page controller: one document, one N-leaf draft, one atomic patch. */
export function useEditableSettings(input: Readonly<{
  actorId: string;
  descriptorFingerprint: string;
}>) {
  const client = useDashboardClient();
  const [editor, setEditor] = useState<EditableSettingsState>({ state: "loading" });
  const [draft, setDraft] = useState<DraftValues>({});
  const [errors, setErrors] = useState<DraftErrors>({});
  const [save, setSave] = useState<SettingsSaveState>({ state: "idle" });
  const { preflight, rerunPreflight } = useSettingsPreflight(editor, input);

  const load = (): void => {
    setEditor({ state: "loading" });
    client.editableSettings().then(
      (document) => {
        setEditor({ state: "loaded", document });
        setDraft(currentDraft(document));
        setErrors({});
      },
      (caught: unknown) => setEditor({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) }),
    );
  };

  useEffect(() => { load(); }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirtyCount = useMemo(() => {
    const leaves = editor.state === "loaded" ? editor.document.sections.flatMap((section) => section.leaves) : [];
    return leaves.filter((leaf) => draft[leaf.path] !== leaf.effectiveValue).length;
  }, [draft, editor]);

  const update = (path: EditableSettingsPath, raw: string): void => {
    if (editor.state !== "loaded") return;
    const leaf = leafFor(editor.document, path);
    if (!leaf.editable) return;
    if (leaf.input === "text") {
      setDraft((previous) => ({ ...previous, [path]: raw }));
      setErrors((previous) => ({ ...previous, [path]: raw.trim().length === 0 ? "Enter a value." : undefined }));
      return;
    }
    const canonical = /^(?:0|[1-9]\d*)$/u.test(raw);
    const value = canonical ? Number(raw) : undefined;
    const error = value === undefined || value < leaf.minimum
      ? `Enter a whole number of at least ${String(leaf.minimum)}.`
      : undefined;
    // Keep malformed text in the draft so clearing a zero-allowed field can
    // never become a quiet numeric zero before the visible refusal is fixed.
    setDraft((previous) => ({ ...previous, [path]: value ?? raw }));
    setErrors((previous) => ({ ...previous, [path]: error }));
  };

  const reset = (path: EditableSettingsPath): void => {
    if (editor.state !== "loaded") return;
    const leaf = leafFor(editor.document, path);
    setDraft((previous) => ({ ...previous, [path]: leaf.effectiveValue }));
    setErrors((previous) => ({ ...previous, [path]: undefined }));
  };

  const discard = (): void => {
    if (editor.state !== "loaded") return;
    setDraft(currentDraft(editor.document));
    setErrors({});
    setSave({ state: "idle" });
  };

  const submit = (): void => {
    if (editor.state !== "loaded" || Object.values(errors).some((error) => error !== undefined)) return;
    let patch: SettingsPatch;
    try {
      patch = patchFromDraft(editor.document, draft);
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      const invalidPaths = new Set(error.issues.map((issue) => issue.path.join(".")));
      const validationErrors: DraftErrors = Object.fromEntries(
        editor.document.sections.flatMap((section) => section.leaves)
          .filter((leaf) => invalidPaths.has(leaf.path))
          .map((leaf) => [leaf.path, "Enter a valid value."]),
      );
      setErrors(validationErrors);
      setSave({ state: "refused", message: "Check the highlighted settings values." });
      return;
    }
    if (Object.keys(patch).length === 0) return;
    setSave({ state: "saving" });
    client.applySettings({
      commandId: crypto.randomUUID(),
      requestedAt: systemClock.now().toISOString(),
      requestedBy: input.actorId,
      source: "settings-surface",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: editor.document.revision },
      payload: {
        settingsSchemaHash: editor.document.settingsSchemaHash,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    }).then(
      (result) => {
        const refusal = commandRefusal(result);
        if (refusal !== undefined) {
          setSave({ state: "refused", message: refusal });
          return;
        }
        setSave({ state: "applied", replayed: result.state === "already-applied" });
        load();
      },
      (caught: unknown) => setSave({ state: "refused", message: caught instanceof Error ? caught.message : String(caught) }),
    );
  };

  return Object.freeze({ editor, draft, errors, save, preflight, dirtyCount, update, reset, discard, submit, reload: load, rerunPreflight });
}

export type { PreflightRerunState } from "./settings-preflight-model.js";
