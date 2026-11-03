import { lstatSync, realpathSync } from "node:fs";
import { win32 } from "node:path";

export class WindowsNativePrototypeError extends Error {
  constructor(readonly code: string, options?: ErrorOptions) { super(code, options); this.name = "WindowsNativePrototypeError"; }
}
function refuse(code: string): never { throw new WindowsNativePrototypeError(code); }
function requireFact(value: unknown, code: string): asserts value { if (!value) refuse(code); }
function nativeBool(value: unknown): boolean {
  requireFact(typeof value === "number" && Number.isInteger(value), "native-bool-malformed");
  return value !== 0;
}

export interface NativeAce { readonly type: number; readonly flags: number; readonly mask: number; readonly sid: string }
export interface NativeFacts {
  readonly volume: bigint;
  readonly fileId: string;
  readonly links: number;
  readonly reparseTag: number;
  readonly directory: boolean;
  readonly size: bigint;
  readonly ownerSid: string;
  readonly protectedDacl: boolean;
  readonly dacl: readonly NativeAce[];
  readonly streams: readonly { readonly name: string; readonly size: bigint }[];
}

export function parsePrototypeSid(bytes: Buffer): string {
  requireFact(bytes.length >= 8 && bytes[0] === 1 && bytes[1] <= 15, "native-sid-malformed");
  requireFact(bytes.length === 8 + bytes[1] * 4, "native-sid-length");
  const authority = bytes.readUIntBE(2, 6);
  const parts = Array.from({ length: bytes[1] }, (_, i) => bytes.readUInt32LE(8 + i * 4));
  return `S-1-${authority}${parts.map((part) => `-${part}`).join("")}`;
}
export function parsePrototypeTokenUser(bytes: Buffer, base: bigint, returnedLength: number): string {
  requireFact(Number.isInteger(returnedLength) && returnedLength >= 16 && returnedLength <= bytes.length,
    "native-token-query-size");
  const end = base + BigInt(returnedLength);
  requireFact(base > 0n && end <= 0x10000000000000000n, "native-token-buffer-address");
  const pointer = bytes.readBigUInt64LE(0);
  requireFact(pointer >= base + 16n && pointer % 4n === 0n && pointer + 8n <= end,
    "native-token-sid-pointer");
  const offset = Number(pointer - base);
  const length = 8 + bytes[offset + 1] * 4;
  requireFact(offset + length <= returnedLength, "native-token-sid-truncated");
  return parsePrototypeSid(bytes.subarray(offset, offset + length));
}
export function parsePrototypeAcl(bytes: Buffer): NativeAce[] {
  requireFact(bytes.length >= 8 && [2, 4].includes(bytes[0]) && bytes.readUInt16LE(2) === bytes.length,
    "native-acl-malformed");
  const entries: NativeAce[] = [];
  let offset = 8;
  for (let i = 0; i < bytes.readUInt16LE(4); i++) {
    requireFact(offset + 8 <= bytes.length, "native-ace-truncated");
    const size = bytes.readUInt16LE(offset + 2);
    requireFact(size >= 16 && size % 4 === 0 && offset + size <= bytes.length, "native-ace-size");
    requireFact(bytes[offset] === 0 || bytes[offset] === 1, "native-ace-unsupported");
    entries.push({ type: bytes[offset], flags: bytes[offset + 1], mask: bytes.readUInt32LE(offset + 4),
      sid: parsePrototypeSid(bytes.subarray(offset + 8, offset + size)) });
    offset += size;
  }
  requireFact(offset <= bytes.length, "native-acl-overflow");
  return entries;
}
export function parsePrototypeStreams(bytes: Buffer): { name: string; size: bigint }[] {
  const entries: { name: string; size: bigint }[] = [];
  let offset = 0;
  while (true) {
    requireFact(offset + 24 <= bytes.length, "native-stream-truncated");
    const next = bytes.readUInt32LE(offset), length = bytes.readUInt32LE(offset + 4);
    const size = bytes.readBigInt64LE(offset + 8), allocated = bytes.readBigInt64LE(offset + 16);
    requireFact(length % 2 === 0 && offset + 24 + length <= bytes.length && size >= 0n && allocated >= 0n,
      "native-stream-malformed");
    const name = bytes.toString("utf16le", offset + 24, offset + 24 + length);
    requireFact(!name.includes("\0") && !entries.some((entry) => entry.name === name), "native-stream-name");
    entries.push({ name, size });
    if (next === 0) {
      requireFact(bytes.length - offset - 24 - length < 8, "native-stream-trailing-data");
      break;
    }
    requireFact(next % 8 === 0 && next >= 24 + length && offset + next < bytes.length, "native-stream-offset");
    offset += next;
  }
  return entries;
}

export function requirePrototypePrivateFile(facts: NativeFacts, currentSid: string): void {
  requireFact(!facts.directory && facts.reparseTag === 0, "native-regular-file-required");
  requireFact(facts.links === 1, "native-extra-hard-link");
  requireFact(facts.streams.length === 1 && facts.streams[0].name === "::$DATA", "native-named-stream");
  requireFact(facts.ownerSid === currentSid, "native-owner-refused");
  requireFact(facts.protectedDacl && facts.dacl.length > 0, "native-dacl-unprotected");
  const trusted = new Set([currentSid, "S-1-5-18", "S-1-5-32-544"]);
  requireFact(facts.dacl.every((ace) => ace.type === 0 && (ace.flags & 0x18) === 0 && trusted.has(ace.sid)),
    "native-dacl-principal-refused");
  requireFact(facts.dacl.some((ace) => ace.sid === currentSid && (ace.mask & 0x120089) === 0x120089),
    "native-dacl-owner-read-required");
}

export interface PrototypeDiagnosticSnapshot {
  readonly completeness: "complete";
  readonly authority: "diagnostic-only";
  readonly rebootReasons: number;
  readonly holders: readonly PrototypeDiagnosticHolder[];
}
export interface PrototypeDiagnosticHolder {
  readonly pid: number;
  readonly birthFileTime: bigint;
  readonly name: string;
  readonly serviceName: string;
  readonly applicationType: number;
  readonly appStatus: number;
  readonly terminalSessionId: number;
  readonly restartable: boolean;
}
const RM_LAYOUT = { size: 668, appName: 12, serviceName: 524, applicationType: 652,
  appStatus: 656, terminalSessionId: 660, restartable: 664 };
const RM_MAX_HOLDERS = 1024;
function rmDword(value: unknown, code: string): number {
  requireFact(typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff, code);
  return value;
}
function rmSuccess(status: unknown, code: string): void { requireFact(rmDword(status, code) === 0, code); }
function rmInvoke<T>(operation: () => T, code: string): T {
  try { return operation(); }
  catch (error) { throw new WindowsNativePrototypeError(code, { cause: error }); }
}
function rmName(bytes: Buffer, offset: number, characters: number): string {
  let length = 0;
  while (length < characters && bytes.readUInt16LE(offset + length * 2) !== 0) length++;
  requireFact(length < characters, "native-rm-name-unterminated");
  const name = bytes.toString("utf16le", offset, offset + length * 2);
  requireFact(name.isWellFormed(), "native-rm-name-malformed");
  return name;
}
export function parsePrototypeRestartManagerHolders(bytes: Buffer, count: number): PrototypeDiagnosticHolder[] {
  requireFact(Number.isInteger(count) && count >= 0 && count <= RM_MAX_HOLDERS
    && bytes.length === count * RM_LAYOUT.size, "native-rm-record-size");
  const holders: PrototypeDiagnosticHolder[] = [];
  const identities = new Set<string>();
  for (let index = 0; index < count; index++) {
    const offset = index * RM_LAYOUT.size;
    const pid = bytes.readUInt32LE(offset);
    const birthFileTime = BigInt(bytes.readUInt32LE(offset + 4)) | (BigInt(bytes.readUInt32LE(offset + 8)) << 32n);
    requireFact(pid > 0 && pid !== 0xffffffff && birthFileTime > 0n, "native-rm-identity-unproved");
    const identity = `${pid}:${birthFileTime}`;
    requireFact(!identities.has(identity), "native-rm-duplicate-holder");
    identities.add(identity);
    const applicationType = bytes.readUInt32LE(offset + RM_LAYOUT.applicationType);
    const appStatus = bytes.readUInt32LE(offset + RM_LAYOUT.appStatus);
    requireFact([0, 1, 2, 3, 4, 5, 1000].includes(applicationType) && (appStatus & ~0xff) === 0,
      "native-rm-record-flags-unproved");
    holders.push({ pid, birthFileTime, name: rmName(bytes, offset + RM_LAYOUT.appName, 256),
      serviceName: rmName(bytes, offset + RM_LAYOUT.serviceName, 64), applicationType, appStatus,
      terminalSessionId: bytes.readUInt32LE(offset + RM_LAYOUT.terminalSessionId),
      restartable: bytes.readInt32LE(offset + RM_LAYOUT.restartable) !== 0 });
  }
  return holders;
}
interface RestartManagerReply {
  readonly status: unknown;
  readonly needed: unknown;
  readonly count: unknown;
  readonly rebootReasons: unknown;
  readonly bytes: Buffer;
}
interface RestartManagerPort {
  start(): { status: unknown; session: unknown };
  register(session: number, paths: readonly string[]): unknown;
  list(session: number, capacity: number): RestartManagerReply;
  end(session: number): unknown;
}
interface RestartManagerSession { readonly handle: number; state: "held" | "closing" | "closed" | "unproved" }
function requirePrototypeWindowsPath(path: string): void {
  requireFact(/^[A-Za-z]:\\/u.test(path) && path === win32.normalize(path) && !path.includes("\0")
    && !path.slice(2).includes(":"), "native-path-refused");
}
function restartManagerDiagnostics(port: RestartManagerPort, sessions: Set<RestartManagerSession>) {
  function query(session: RestartManagerSession): PrototypeDiagnosticSnapshot {
    let capacity = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      const reply = rmInvoke(() => port.list(session.handle, capacity), "native-rm-query-unproved");
      const status = rmDword(reply.status, "native-rm-query-unproved");
      requireFact(status === 0 || status === 234, "native-rm-query-unproved");
      const needed = rmDword(reply.needed, "native-rm-needed-unproved");
      const count = rmDword(reply.count, "native-rm-count-unproved");
      requireFact(needed <= RM_MAX_HOLDERS && count <= capacity
        && Buffer.isBuffer(reply.bytes) && reply.bytes.length === capacity * RM_LAYOUT.size, "native-rm-response-unproved");
      if (status === 234) {
        requireFact(needed > capacity, "native-rm-resize-unproved");
        capacity = Math.min(RM_MAX_HOLDERS, Math.max(needed, capacity * 2));
        continue;
      }
      const rebootReasons = rmDword(reply.rebootReasons, "native-rm-reboot-unproved");
      requireFact((rebootReasons & ~0x1f) === 0 && needed <= count, "native-rm-incomplete-success");
      return { completeness: "complete", authority: "diagnostic-only", rebootReasons,
        holders: parsePrototypeRestartManagerHolders(reply.bytes.subarray(0, count * RM_LAYOUT.size), count) };
    }
    return refuse("native-rm-query-bound");
  }
  function close(session: RestartManagerSession): void {
    requireFact(session.state === "held", "native-rm-session-state-unproved");
    session.state = "closing";
    try { rmSuccess(rmInvoke(() => port.end(session.handle), "native-rm-end-unproved"), "native-rm-end-unproved"); }
    catch (error) { session.state = "unproved"; throw error; }
    session.state = "closed";
    sessions.delete(session);
  }
  return (paths: readonly string[]): PrototypeDiagnosticSnapshot => {
    requireFact(paths.length > 0 && paths.length <= 64 && new Set(paths.map(path => path.toLowerCase())).size === paths.length,
      "native-rm-resource-count");
    for (const path of paths) {
      requirePrototypeWindowsPath(path);
      requireFact(path.length <= 32767, "native-rm-resource-path-bound");
    }
    const started = rmInvoke(() => port.start(), "native-rm-start-unproved");
    rmSuccess(started.status, "native-rm-start-unproved");
    const session: RestartManagerSession = { handle: rmDword(started.session, "native-rm-session-unproved"), state: "held" };
    sessions.add(session);
    let snapshot: PrototypeDiagnosticSnapshot | undefined;
    let primary: { error: unknown } | undefined;
    try {
      rmSuccess(rmInvoke(() => port.register(session.handle, paths), "native-rm-register-unproved"), "native-rm-register-unproved");
      snapshot = query(session);
    }
    catch (error) { primary = { error }; }
    try { close(session); }
    catch (error) {
      if (primary !== undefined) throw new AggregateError([primary.error, error], "native-rm-diagnostic-close-unproved", { cause: error });
      throw error;
    }
    if (primary !== undefined) throw primary.error;
    requireFact(snapshot !== undefined, "native-rm-snapshot-unproved");
    return snapshot;
  };
}
export interface PrototypeRestartManagerScenario {
  readonly startStatus: unknown;
  readonly registerStatus: unknown;
  readonly endStatus: unknown;
  readonly replies: readonly RestartManagerReply[];
}
export function runPrototypeRestartManagerScenario(script: PrototypeRestartManagerScenario) {
  const calls: { operation: "start" | "register" | "list" | "end"; capacity?: number }[] = [];
  const sessions = new Set<RestartManagerSession>();
  let index = 0;
  const diagnose = restartManagerDiagnostics({
    start: () => { calls.push({ operation: "start" }); return { status: script.startStatus, session: 17 }; },
    register: () => { calls.push({ operation: "register" }); return script.registerStatus; },
    list: (_session, capacity) => {
      calls.push({ operation: "list", capacity });
      requireFact(index < script.replies.length, "native-rm-script-exhausted");
      return script.replies[index++];
    },
    end: () => { calls.push({ operation: "end" }); return script.endStatus; },
  }, sessions);
  let outcome: { kind: "complete"; snapshot: PrototypeDiagnosticSnapshot } | { kind: "unproved"; error: Error };
  try { outcome = { kind: "complete", snapshot: diagnose(["C:\\fixture\\source"]) }; }
  catch (error) { requireFact(error instanceof Error, "native-rm-error-unproved"); outcome = { kind: "unproved", error }; }
  return { outcome, calls, outstandingResourceCount: sessions.size, retainedStates: [...sessions].map(session => session.state) };
}

type Pointer = bigint;
interface Resource { readonly handle: Pointer; state: "held" | "unproved" | "closed" }
export interface PrototypeCustody {
  facts(): NativeFacts;
  read(): Buffer;
  close(): void;
  readonly state: "held" | "unproved" | "closed";
  readonly storageAuthorization: "refused-lifetime-fence-unproved";
}

async function loadNative() {
  requireFact(process.platform === "win32" && ["x64", "arm64"].includes(process.arch), "native-platform-required");
  const root = "C:\\Windows";
  requireFact(process.env.SystemRoot?.toLowerCase() === root.toLowerCase(), "native-system-root-unproved");
  const reportOptions = process.report;
  requireFact("excludeNetwork" in reportOptions && typeof reportOptions.excludeNetwork === "boolean",
    "native-report-options-unproved");
  const previousEnv = reportOptions.excludeEnv, previousNetwork = reportOptions.excludeNetwork;
  let report: object;
  try {
    reportOptions.excludeEnv = true;
    reportOptions.excludeNetwork = true;
    report = process.report.getReport();
  } finally {
    reportOptions.excludeEnv = previousEnv;
    reportOptions.excludeNetwork = previousNetwork;
  }
  requireFact("sharedObjects" in report && Array.isArray(report.sharedObjects)
    && report.sharedObjects.every((path: unknown) => typeof path === "string"), "native-loaded-libraries-unproved");
  const loaded = new Set<unknown>(report.sharedObjects.map((path: string) => path.toLowerCase()));
  for (const name of ["kernel32.dll", "ntdll.dll"]) {
    requireFact(loaded.has(win32.join(root, "System32", name).toLowerCase()), "native-os-root-unproved");
  }
  for (const path of ["C:\\", root, win32.join(root, "System32")]) {
    requireFact(!lstatSync(path).isSymbolicLink() && realpathSync.native(path).toLowerCase() === path.toLowerCase(),
      "native-system-directory-unproved");
  }
  const koffi = await import("koffi");
  requireFact(koffi.version === "3.3.6", "native-koffi-version");
  function dll(name: "kernel32.dll" | "advapi32.dll" | "ntdll.dll" | "Rstrtmgr.dll") {
    const path = win32.join(root, "System32", name);
    requireFact(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink()
      && realpathSync.native(path).toLowerCase() === path.toLowerCase(), "native-dll-path-unproved");
    const library = koffi.load(path);
    return { func(...args: [string] | [string, string, string | typeof handleType, (string | typeof handleType)[]]) {
      const fn = args.length === 1 ? library.func(args[0]) : library.func(args[0], args[1], args[2], args[3]);
      return (...values: unknown[]): unknown => fn(...values);
    } };
  }
  const kernel = dll("kernel32.dll"), security = dll("advapi32.dll"), nt = dll("ntdll.dll");
  const handleType = koffi.pointer(koffi.opaque());
  const create = kernel.func("__stdcall", "CreateFileW", handleType,
    ["str16", "uint32", "uint32", "void *", "uint32", "uint32", handleType]);
  const close = kernel.func("__stdcall", "CloseHandle", "int", [handleType]);
  const info = kernel.func("__stdcall", "GetFileInformationByHandleEx", "int", [handleType, "int", "void *", "uint32"]);
  const volume = kernel.func("int __stdcall GetVolumeInformationByHandleW(void *, void *, uint32, void *, void *, void *, void *, uint32)");
  const queryStreams = nt.func("int32 __stdcall NtQueryInformationFile(void *, void *, void *, uint32, int)");
  const getSecurity = security.func("uint32 __stdcall GetSecurityInfo(void *, int, uint32, _Out_ void **, void *, _Out_ void **, void *, _Out_ void **)");
  const control = security.func("int __stdcall GetSecurityDescriptorControl(void *, _Out_ uint16 *, _Out_ uint32 *)");
  const localFree = kernel.func("void * __stdcall LocalFree(void *)");
  const read = kernel.func("int __stdcall ReadFile(void *, void *, uint32, _Out_ uint32 *, void *)");
  const seek = kernel.func("int __stdcall SetFilePointerEx(void *, int64, void *, uint32)");
  const processHandle = kernel.func("void * __stdcall GetCurrentProcess()");
  const openToken = security.func("int __stdcall OpenProcessToken(void *, uint32, _Out_ void **)");
  const tokenInfo = security.func("int __stdcall GetTokenInformation(void *, int, void *, uint32, _Out_ uint32 *)");
  const retained = new Set<Resource>();
  const allocations = new Set<bigint>();
  const rmSessions = new Set<RestartManagerSession>();
  function nativeBytes(pointer: bigint, length: number): Buffer {
    const decoded: unknown = koffi.decode(pointer, koffi.array("uint8", length, "Buffer"));
    requireFact(Buffer.isBuffer(decoded) && decoded.length === length, "native-buffer-decode-unproved");
    return Buffer.from(decoded);
  }

  function resource(pointer: unknown): Resource {
    requireFact(typeof pointer === "bigint" && pointer !== 0n
      && pointer !== -1n && pointer !== 0xffffffffffffffffn, "native-open-unproved");
    const item: Resource = { handle: pointer, state: "held" };
    retained.add(item);
    return item;
  }
  function closeResource(item: Resource): void {
    requireFact(item.state === "held", "native-close-state-unproved");
    item.state = "unproved";
    requireFact(nativeBool(close(item.handle)), "native-close-unproved");
    item.state = "closed";
    retained.delete(item);
  }
  function sid(pointer: unknown): string {
    requireFact(typeof pointer === "bigint" && pointer !== 0n, "native-sid-missing");
    const head = nativeBytes(pointer, 8);
    requireFact(head[0] === 1 && head[1] <= 15, "native-sid-malformed");
    return parsePrototypeSid(nativeBytes(pointer, 8 + head[1] * 4));
  }
  function currentSid(): string {
    const output: unknown[] = [null];
    requireFact(nativeBool(openToken(processHandle(), 8, output)), "native-token-open-unproved");
    const token = resource(output[0]);
    try {
      const bytes = Buffer.alloc(4096), length = [0];
      requireFact(nativeBool(tokenInfo(token.handle, 1, bytes, bytes.length, length)) && length[0] >= 16
        && length[0] <= bytes.length, "native-token-query-unproved");
      return parsePrototypeTokenUser(bytes, koffi.address(bytes), length[0]);
    } finally { closeResource(token); }
  }
  function facts(item: Resource): NativeFacts {
    requireFact(item.state === "held", "native-custody-not-held");
    const id = Buffer.alloc(24), standard = Buffer.alloc(24), attributes = Buffer.alloc(8);
    requireFact(nativeBool(info(item.handle, 18, id, id.length)), "native-identity-unproved");
    requireFact(nativeBool(info(item.handle, 1, standard, standard.length)), "native-standard-info-unproved");
    requireFact(nativeBool(info(item.handle, 9, attributes, attributes.length)), "native-reparse-unproved");
    const fs = Buffer.alloc(64);
    requireFact(nativeBool(volume(item.handle, null, 0, null, null, null, fs, 32)), "native-volume-unproved");
    requireFact(fs.toString("utf16le").split("\0")[0] === "NTFS", "native-ntfs-required");
    const owner: unknown[] = [null], dacl: unknown[] = [null], descriptor: unknown[] = [null];
    const status: unknown = getSecurity(item.handle, 1, 5, owner, null, dacl, null, descriptor);
    requireFact(status === 0, "native-security-query-unproved");
    requireFact(typeof descriptor[0] === "bigint" && descriptor[0] !== 0n, "native-security-descriptor-missing");
    const descriptorPointer = descriptor[0];
    allocations.add(descriptorPointer);
    let ownerSid: string, protectedDacl: boolean, acl: NativeAce[];
    try {
      ownerSid = sid(owner[0]);
      requireFact(typeof dacl[0] === "bigint" && dacl[0] !== 0n, "native-null-dacl");
      const aclHead = nativeBytes(dacl[0], 8);
      const size = aclHead.readUInt16LE(2);
      requireFact(size >= 8, "native-acl-size");
      acl = parsePrototypeAcl(nativeBytes(dacl[0], size));
      const flags = [0], revision = [0];
      requireFact(nativeBool(control(descriptor[0], flags, revision)) && (flags[0] & 4) !== 0, "native-dacl-control-unproved");
      protectedDacl = (flags[0] & 0x1000) !== 0;
    } finally {
      requireFact(localFree(descriptorPointer) === null, "native-security-free-unproved");
      allocations.delete(descriptorPointer);
    }
    let streams: { name: string; size: bigint }[] | undefined;
    for (let length = 4096; length <= 1024 * 1024; length *= 2) {
      const bytes = Buffer.alloc(length), io = Buffer.alloc(16);
      const status: unknown = queryStreams(item.handle, io, bytes, bytes.length, 22);
      requireFact(typeof status === "number", "native-stream-status-unproved");
      const result = status >>> 0;
      if (result === 0x80000005 || result === 0xc0000023) continue;
      requireFact(result === 0 && io.readUInt32LE(0) === 0, "native-stream-query-unproved");
      const used = io.readBigUInt64LE(8);
      requireFact(used >= 24n && used <= BigInt(bytes.length), "native-stream-query-size");
      streams = parsePrototypeStreams(bytes.subarray(0, Number(used)));
      break;
    }
    requireFact(streams !== undefined, "native-stream-query-bound");
    const attr = attributes.readUInt32LE(0);
    requireFact((attr & 0x400) === 0 || attributes.readUInt32LE(4) !== 0, "native-reparse-tag-unproved");
    return { volume: id.readBigUInt64LE(0), fileId: id.subarray(8).toString("hex"),
      links: standard.readUInt32LE(16), size: standard.readBigInt64LE(8), directory: standard[21] !== 0,
      reparseTag: (attr & 0x400) === 0 ? 0 : attributes.readUInt32LE(4), ownerSid, protectedDacl, dacl: acl, streams };
  }
  function open(path: string, exclusive: boolean): Resource {
    requirePrototypeWindowsPath(path);
    return resource(create(path, exclusive ? 0x80020000 : 0x20080, exclusive ? 0 : 7,
      null, 3, 0x02200000, null));
  }
  function acquire(path: string): PrototypeCustody {
    const item = open(path, true);
    try { requirePrototypePrivateFile(facts(item), currentSid()); }
    catch (error) {
      try { closeResource(item); }
      catch (closeError) { throw new AggregateError([error, closeError], "native-partial-close-unproved", { cause: closeError }); }
      throw error;
    }
    return Object.freeze({
      get state() { return item.state; },
      storageAuthorization: "refused-lifetime-fence-unproved" as const,
      facts: () => facts(item),
      read: () => {
        const fresh = facts(item);
        requirePrototypePrivateFile(fresh, currentSid());
        requireFact(fresh.size >= 0n && fresh.size <= 1024n * 1024n, "native-read-bound");
        requireFact(nativeBool(seek(item.handle, 0n, null, 0)), "native-seek-unproved");
        const bytes = Buffer.alloc(Number(fresh.size)), count = [0];
        requireFact(nativeBool(read(item.handle, bytes, bytes.length, count, null)) && count[0] === bytes.length,
          "native-read-unproved");
        return bytes;
      },
      close: () => closeResource(item),
    });
  }
  let diagnose: ReturnType<typeof restartManagerDiagnostics> | undefined;
  function restartManagerPort(): RestartManagerPort {
    const filetime = koffi.struct({ low: "uint32", high: "uint32" });
    const uniqueProcess = koffi.struct({ pid: "uint32", birth: filetime });
    const processInfo = koffi.struct({ process: uniqueProcess, name: koffi.array("uint16", 256),
      service: koffi.array("uint16", 64), applicationType: "int32", appStatus: "uint32",
      terminalSessionId: "uint32", restartable: "int32" });
    requireFact(koffi.sizeof(filetime) === 8 && koffi.alignof(filetime) === 4
      && koffi.offsetof(filetime, "low") === 0 && koffi.offsetof(filetime, "high") === 4
      && koffi.sizeof(uniqueProcess) === 12 && koffi.alignof(uniqueProcess) === 4
      && koffi.offsetof(uniqueProcess, "pid") === 0 && koffi.offsetof(uniqueProcess, "birth") === 4,
    "native-rm-unique-process-abi-unproved");
    requireFact(koffi.sizeof(processInfo) === RM_LAYOUT.size && koffi.alignof(processInfo) === 4
      && koffi.offsetof(processInfo, "process") === 0
      && koffi.offsetof(processInfo, "name") === RM_LAYOUT.appName
      && koffi.offsetof(processInfo, "service") === RM_LAYOUT.serviceName
      && koffi.offsetof(processInfo, "applicationType") === RM_LAYOUT.applicationType
      && koffi.offsetof(processInfo, "appStatus") === RM_LAYOUT.appStatus
      && koffi.offsetof(processInfo, "terminalSessionId") === RM_LAYOUT.terminalSessionId
      && koffi.offsetof(processInfo, "restartable") === RM_LAYOUT.restartable,
    "native-rm-process-info-abi-unproved");
    const rm = dll("Rstrtmgr.dll");
    const start = rm.func("uint32 __stdcall RmStartSession(_Out_ uint32 *, uint32, void *)");
    const register = rm.func("uint32 __stdcall RmRegisterResources(uint32, uint32, const char16_t **, uint32, void *, uint32, void *)");
    const list = rm.func("uint32 __stdcall RmGetList(uint32, _Out_ uint32 *, _Inout_ uint32 *, void *, _Out_ uint32 *)");
    const end = rm.func("uint32 __stdcall RmEndSession(uint32)");
    return {
      start: () => {
        const session = [0xffffffff], key = Buffer.alloc(66);
        try { return { status: start(session, 0, key), session: session[0] }; }
        finally { key.fill(0); }
      },
      register: (session, paths) => register(session, paths.length, [...paths], 0, null, 0, null),
      list: (session, capacity) => {
        const needed = [0xffffffff], count = [capacity], rebootReasons = [0xffffffff];
        const bytes = Buffer.alloc(capacity * RM_LAYOUT.size);
        const status = list(session, needed, count, capacity === 0 ? null : bytes, rebootReasons);
        return { status, needed: needed[0], count: count[0], rebootReasons: rebootReasons[0], bytes };
      },
      end: session => end(session),
    };
  }
  return Object.freeze({ currentSid, acquire,
    diagnoseHolders(paths: readonly string[]): PrototypeDiagnosticSnapshot {
      diagnose ??= restartManagerDiagnostics(rmInvoke(restartManagerPort, "native-rm-bindings-unproved"), rmSessions);
      return diagnose(paths);
    },
    retainObservation(path: string) {
      const item = open(path, false);
      return Object.freeze({ facts: () => facts(item), close: () => closeResource(item),
        get state() { return item.state; } });
    },
    observeReparse(path: string): { attributes: number; tag: number } {
      const item = open(path, false);
      try {
        const bytes = Buffer.alloc(8);
        requireFact(nativeBool(info(item.handle, 9, bytes, bytes.length)), "native-reparse-unproved");
        return { attributes: bytes.readUInt32LE(0), tag: bytes.readUInt32LE(4) };
      } finally { closeResource(item); }
    },
    observe(path: string): NativeFacts {
      const item = open(path, false);
      try { return facts(item); } finally { closeResource(item); }
    },
    get retainedResourceCount() { return retained.size + allocations.size + rmSessions.size; },
  });
}

let native: ReturnType<typeof loadNative> | undefined;
export function windowsNativePrototype(): ReturnType<typeof loadNative> {
  native ??= loadNative();
  return native;
}
