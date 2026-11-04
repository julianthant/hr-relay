import { execFile } from "node:child_process";
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep, win32 } from "node:path";
import type { NativePathField, NativePathPickerRequest, NativePathPickerResponse } from "../../../models/dashboard/native-path-picker.js";
import { windowsSystemRoot } from "../../../models/config/secrets.js";

const TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 8192;
const CANCELLED = "__HRAUTO_NATIVE_PICKER_CANCELLED__";
const FILE_FIELDS = new Set<NativePathField>(["paths.i9CheckTrackerPath"]);

const FOLDER_SCRIPT = `on run argv
  try
    if (count of argv) is 0 then
      set chosenItem to choose folder
    else
      set chosenItem to choose folder default location (POSIX file (item 1 of argv) as alias)
    end if
    return POSIX path of chosenItem
  on error errorMessage number errorNumber
    if errorNumber is -128 then return "${CANCELLED}"
    error errorMessage number errorNumber
  end try
end run`;
const FILE_SCRIPT = `on run argv
  try
    if (count of argv) is 0 then
      set chosenItem to choose file
    else
      set chosenItem to choose file default location (POSIX file (item 1 of argv) as alias)
    end if
    return POSIX path of chosenItem
  on error errorMessage number errorNumber
    if errorNumber is -128 then return "${CANCELLED}"
    error errorMessage number errorNumber
  end try
end run`;

const WINDOWS_SCRIPT = `$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$dialog = $null
try {
  Add-Type -AssemblyName System.Windows.Forms
  $request = ConvertFrom-Json ([Console]::In.ReadToEnd())
  if ($request.kind -eq 'folder') {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.ShowNewFolderButton = $false
    if ($null -ne $request.hint) { $dialog.SelectedPath = $request.hint }
  } elseif ($request.kind -eq 'file') {
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Multiselect = $false
    $dialog.CheckFileExists = $true
    $dialog.DereferenceLinks = $false
    $dialog.RestoreDirectory = $true
    if ($null -ne $request.hint) { $dialog.InitialDirectory = $request.hint }
  } else { throw 'Invalid picker kind' }
  $result = $dialog.ShowDialog()
  if ($result -eq [System.Windows.Forms.DialogResult]::Cancel) {
    [Console]::WriteLine('${CANCELLED}')
  } elseif ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    if ($request.kind -eq 'folder') { [Console]::WriteLine($dialog.SelectedPath) }
    else { [Console]::WriteLine($dialog.FileName) }
  } else { throw 'Unexpected picker result' }
} catch { exit 1 }
finally { if ($null -ne $dialog) { $dialog.Dispose() } }
`;
const WINDOWS_ARGS = Object.freeze(["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand",
  Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64")]);

type PickerProcessResult = Readonly<
  | { state: "exited"; code: number; stdout: string }
  | { state: "timeout" | "aborted" | "failed" }
>;
export type NativePickerExecutor = (file: string, args: readonly string[], signal: AbortSignal, input?: string) => Promise<PickerProcessResult>;

const executeNativePicker: NativePickerExecutor = (file, args, signal, input) => new Promise(resolveResult => {
  let inputFailed = false;
  let result: PickerProcessResult | undefined;
  const child = execFile(file, [...args], { encoding: "utf8", timeout: TIMEOUT_MS, killSignal: "SIGKILL",
    maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, signal }, (error, stdout) => {
    signal.removeEventListener("abort", killOnAbort);
    if (signal.aborted) result = { state: "aborted" };
    else if (inputFailed || (error !== null && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")) result = { state: "failed" };
    else if (error !== null && "killed" in error && error.killed) result = { state: "timeout" };
    else if (error !== null) result = { state: "failed" };
    else result = { state: "exited", code: 0, stdout };
  });
  child.once("close", () => { resolveResult(result ?? { state: "failed" }); });
  child.stdin?.on("error", () => { inputFailed = true; });
  child.stdin?.end(input);
  const killOnAbort = () => { child.kill("SIGKILL"); };
  signal.addEventListener("abort", killOnAbort, { once: true });
  if (signal.aborted) killOnAbort();
});

export class InvalidNativePickerHintError extends Error {
  constructor() { super("Native path picker initial location is not a safe canonical absolute path"); }
}

function pathKind(field: NativePathField): "file" | "folder" { return FILE_FIELDS.has(field) ? "file" : "folder"; }
function checkedPath(path: string): string {
  if (!isAbsolute(path) || resolve(path) !== path || /[\0\r\n]/u.test(path)) throw new InvalidNativePickerHintError();
  return path;
}
function existingDirectoryHint(initialPath: string, kind: "file" | "folder"): string | undefined {
  const path = checkedPath(initialPath);
  let current = parse(path).root;
  for (const part of relative(current, path).split(sep).filter(Boolean)) {
    const next = join(current, part);
    let stat: ReturnType<typeof lstatSync>;
    try { stat = lstatSync(next); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return current === parse(path).root ? undefined : current;
      throw new InvalidNativePickerHintError();
    }
    if (stat.isSymbolicLink()) throw new InvalidNativePickerHintError();
    if (!stat.isDirectory() && !(kind === "file" && next === path && stat.isFile())) {
      throw new InvalidNativePickerHintError();
    }
    current = next;
  }
  return kind === "file" && lstatSync(path).isFile() ? dirname(path) : current;
}
function selectedPath(stdout: string, kind: "file" | "folder"): string | undefined {
  const printed = stdout.endsWith("\r\n") ? stdout.slice(0, -2)
    : stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  if (printed === CANCELLED) return undefined;
  try {
    const path = checkedPath(kind === "folder" && printed.endsWith("/") ? resolve(printed) : printed);
    existingDirectoryHint(path, kind);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !(kind === "folder" ? stat.isDirectory() : stat.isFile())) return undefined;
    return path;
  } catch { return undefined; }
}

export interface NativePathPicker {
  pick(request: NativePathPickerRequest, signal: AbortSignal): Promise<NativePathPickerResponse>;
}

export function createNativePathPicker(options: Readonly<{ platform?: NodeJS.Platform;
  execute?: NativePickerExecutor }> = {}): NativePathPicker {
  const platform = options.platform ?? process.platform;
  const execute = options.execute ?? executeNativePicker;
  let active = false;
  return Object.freeze({
    async pick(request: NativePathPickerRequest, signal: AbortSignal): Promise<NativePathPickerResponse> {
      const kind = pathKind(request.field);
      const hint = request.initialPath === undefined ? undefined : existingDirectoryHint(request.initialPath, kind);
      if (platform !== "darwin" && platform !== "win32") return { state: "unavailable", field: request.field, reason: "unsupported-platform" };
      if (active) return { state: "unavailable", field: request.field, reason: "busy" };
      if (signal.aborted) return { state: "unavailable", field: request.field, reason: "dialog-failed" };
      active = true;
      try {
        let result: PickerProcessResult;
        if (platform === "win32") {
          const systemRoot = windowsSystemRoot();
          if (systemRoot === undefined || !/^[a-z]:\\/iu.test(systemRoot) || win32.resolve(systemRoot) !== systemRoot
            || /[\0\r\n]/u.test(systemRoot)) return { state: "unavailable", field: request.field, reason: "dialog-failed" };
          result = await execute(win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
            WINDOWS_ARGS, signal, JSON.stringify({ kind, ...(hint === undefined ? {} : { hint }) }));
        } else {
          result = await execute("/usr/bin/osascript", ["-e", kind === "folder" ? FOLDER_SCRIPT : FILE_SCRIPT,
            ...(hint === undefined ? [] : [hint])], signal);
        }
        if (result.state !== "exited") return { state: "unavailable", field: request.field,
          reason: result.state === "timeout" ? "timeout" : "dialog-failed" };
        if (result.code !== 0) return { state: "unavailable", field: request.field, reason: "dialog-failed" };
        const printed = result.stdout.endsWith("\r\n") ? result.stdout.slice(0, -2)
          : result.stdout.endsWith("\n") ? result.stdout.slice(0, -1) : result.stdout;
        if (printed === CANCELLED) return { state: "cancelled", field: request.field };
        const path = selectedPath(result.stdout, kind);
        return path === undefined ? { state: "unavailable", field: request.field, reason: "dialog-failed" }
          : { state: "selected", field: request.field, path };
      } catch { return { state: "unavailable", field: request.field, reason: "dialog-failed" }; }
      finally { active = false; }
    },
  });
}
