import { lstatSync, realpathSync } from "node:fs";
import { win32 } from "node:path";

export class WindowsNativePrototypeError extends Error {
  constructor(readonly code: string) { super(code); this.name = "WindowsNativePrototypeError"; }
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
  function dll(name: "kernel32.dll" | "advapi32.dll" | "ntdll.dll") {
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
      const pointer: unknown = koffi.decode(bytes, "void *");
      return sid(pointer);
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
    requireFact(/^[A-Za-z]:\\/u.test(path) && path === win32.normalize(path) && !path.includes("\0")
      && !path.slice(2).includes(":"), "native-path-refused");
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
  return Object.freeze({ currentSid, acquire,
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
    get retainedResourceCount() { return retained.size + allocations.size; },
  });
}

let native: ReturnType<typeof loadNative> | undefined;
export function windowsNativePrototype(): ReturnType<typeof loadNative> {
  native ??= loadNative();
  return native;
}
