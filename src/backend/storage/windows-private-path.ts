import { lstatSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, win32 } from "node:path";
import { ERROR_CATALOG } from "../../models/failures/error-catalog.js";
import { retainAuthoritySourceClosure } from "./source-closure.js";
import type { PathStat, PrivacyRule } from "./private-path.js";

export class WindowsPrivatePathError extends Error {
  readonly code = "WINDOWS_PRIVATE_PATH_REFUSED";
  constructor(readonly reason: string) {
    super(ERROR_CATALOG.WINDOWS_PRIVATE_PATH_REFUSED.text);
    this.name = "WindowsPrivatePathError";
  }
}

function requireFact(value: unknown, reason: string): asserts value {
  if (!value) throw new WindowsPrivatePathError(reason);
}

export interface WindowsAce { readonly type: number; readonly flags: number; readonly mask: number; readonly sid: string }
export interface WindowsSecurity {
  readonly owner: string;
  readonly directory: boolean;
  readonly aces: readonly WindowsAce[];
}
const SYSTEM = "S-1-5-18", ADMINISTRATORS = "S-1-5-32-544";
const TRUSTED_INSTALLER = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
const FULL = 0x1f01ff, READ = 0x120089, WRITE = 0x120116, EXECUTE = 0x1200a0;

function accessMask(mask: number): number {
  let result = mask & 0x0fffffff;
  if (mask & 0x80000000) result |= READ;
  if (mask & 0x40000000) result |= WRITE;
  if (mask & 0x20000000) result |= EXECUTE;
  if (mask & 0x10000000) result |= FULL;
  requireFact((result & ~FULL) === 0, "unsupported-access-mask");
  return result;
}

export function windowsSecurityRejects(security: WindowsSecurity, current: string, rule: PrivacyRule, inheritance = false): boolean {
  if (rule === "directory-0700" && !security.directory
    || ["file-0600", "file-0400"].includes(rule) && security.directory) return true;
  const trusted = new Set([current, SYSTEM, ADMINISTRATORS]);
  const ancestors = new Set([...trusted, TRUSTED_INSTALLER]);
  if (rule === "ancestor" ? !ancestors.has(security.owner) : security.owner !== current) return true;
  let ownerAccess = 0;
  for (const ace of security.aces) {
    requireFact(ace.type === 0 && (ace.flags & ~0x1f) === 0, "unsupported-ace");
    const mask = accessMask(ace.mask);
    const effective = (ace.flags & 8) === 0;
    if (effective && ace.sid === current) ownerAccess |= mask;
    if (!effective && !inheritance) continue;
    if (inheritance && !effective && (ace.flags & 3) === 0) continue;
    if ((rule === "ancestor" ? ancestors : trusted).has(ace.sid)) continue;
    if (rule === "owner" && !inheritance) continue;
    const readable = rule === "ancestor" || rule === "group-write" || rule === "owner-write-only";
    // Creating a sibling directory cannot replace a protected existing descendant.
    const allowed = readable ? READ | EXECUTE | (rule === "ancestor" && security.directory ? 4 : 0) : 0;
    if ((mask & ~allowed) !== 0) return true;
  }
  if (security.aces.length === 0) return true;
  if (["file-0600", "directory-0700", "private-read-write"].includes(rule)) {
    const required = security.directory ? 0x27 : 3;
    if ((ownerAccess & required) !== required) return true;
  }
  if (rule === "file-0400" && ((ownerAccess & 1) === 0 || (ownerAccess & 0x116) !== 0)) return true;
  return rule === "owner-write-only" && (ownerAccess & 2) === 0;
}

export function parseWindowsSid(bytes: Buffer): string {
  requireFact(bytes.length >= 8 && bytes[0] === 1 && bytes[1] <= 15
    && bytes.length === 8 + bytes[1] * 4, "malformed-sid");
  return `S-1-${bytes.readUIntBE(2, 6)}${Array.from({ length: bytes[1] }, (_, i) => `-${bytes.readUInt32LE(8 + 4 * i)}`).join("")}`;
}

export function parseWindowsAcl(bytes: Buffer): WindowsAce[] {
  requireFact(bytes.length >= 8 && [2, 4].includes(bytes[0]) && bytes.readUInt16LE(2) === bytes.length, "malformed-dacl");
  const aces: WindowsAce[] = [];
  let offset = 8;
  for (let index = 0; index < bytes.readUInt16LE(4); index++) {
    requireFact(offset + 8 <= bytes.length, "truncated-ace");
    const size = bytes.readUInt16LE(offset + 2);
    requireFact(size >= 16 && size % 4 === 0 && offset + size <= bytes.length, "malformed-ace-size");
    requireFact(bytes[offset] === 0 && (bytes[offset + 1] & ~0x1f) === 0, "unsupported-ace");
    aces.push({ type: bytes[offset], flags: bytes[offset + 1], mask: bytes.readUInt32LE(offset + 4),
      sid: parseWindowsSid(bytes.subarray(offset + 8, offset + size)) });
    offset += size;
  }
  requireFact(offset <= bytes.length, "malformed-dacl-extent");
  return aces;
}

function exact(value: number | bigint): bigint {
  requireFact(typeof value === "bigint" || Number.isSafeInteger(value), "unsafe-numeric-identity");
  return BigInt(value);
}

type NativeKoffi = Pick<typeof import("koffi"), "version" | "load" | "decode" | "array" | "address">;
function isNativeKoffi(value: unknown): value is NativeKoffi {
  return typeof value === "object" && value !== null && Reflect.get(value, "version") === "3.3.6"
    && ["load", "decode", "array", "address"].every(name => typeof Reflect.get(value, name) === "function");
}

function loadNative() {
  requireFact(process.platform === "win32" && ["x64", "arm64"].includes(process.arch), "unsupported-platform");
  const loaded: unknown = createRequire(import.meta.url)("koffi");
  requireFact(isNativeKoffi(loaded), "native-version-or-interface-mismatch");
  const koffi = loaded;
  const system = "C:\\Windows\\System32";
  for (const path of ["C:\\", "C:\\Windows", system]) {
    requireFact(!lstatSync(path).isSymbolicLink() && realpathSync.native(path).toLowerCase() === path.toLowerCase(), "system-library-path-unproved");
  }
  const kernel = koffi.load(win32.join(system, "kernel32.dll"));
  const advapi = koffi.load(win32.join(system, "advapi32.dll"));
  const create = kernel.func("void * __stdcall CreateFileW(str16, uint32, uint32, void *, uint32, uint32, void *)");
  const close = kernel.func("int __stdcall CloseHandle(void *)");
  const information = kernel.func("int __stdcall GetFileInformationByHandle(void *, void *)");
  const informationEx = kernel.func("int __stdcall GetFileInformationByHandleEx(void *, int, void *, uint32)");
  const volume = kernel.func("int __stdcall GetVolumeInformationByHandleW(void *, void *, uint32, void *, void *, void *, void *, uint32)");
  const security = advapi.func("uint32 __stdcall GetSecurityInfo(void *, int, uint32, _Out_ void **, void *, _Out_ void **, void *, _Out_ void **)");
  const control = advapi.func("int __stdcall GetSecurityDescriptorControl(void *, _Out_ uint16 *, _Out_ uint32 *)");
  const free = kernel.func("void * __stdcall LocalFree(void *)");
  const processHandle = kernel.func("void * __stdcall GetCurrentProcess()");
  const openToken = advapi.func("int __stdcall OpenProcessToken(void *, uint32, _Out_ void **)");
  const tokenInformation = advapi.func("int __stdcall GetTokenInformation(void *, int, void *, uint32, _Out_ uint32 *)");
  const convert = advapi.func("int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(str16, uint32, _Out_ void **, void *)");
  const createDirectory = kernel.func("int __stdcall CreateDirectoryW(str16, void *)");
  const flush = kernel.func("int __stdcall FlushFileBuffers(void *)");
  interface Resource { readonly handle: bigint; readonly library: object; state: "held" | "unproved" | "closed" }
  const retained = new Set<Resource>();
  function resource(value: unknown): Resource {
    requireFact(typeof value === "bigint" && value !== 0n && value !== -1n && value !== 0xffffffffffffffffn, "native-open-failed");
    const item: Resource = { handle: value, library: kernel, state: "held" };
    retained.add(item); return item;
  }
  function release(item: Resource): void {
    item.state = "unproved";
    requireFact(close(item.handle) !== 0, "native-close-failed");
    item.state = "closed"; retained.delete(item);
  }
  function usingHandle<T>(item: Resource, operation: (handle: bigint) => T): T {
    let result: { value: T } | undefined, primary: { error: unknown } | undefined;
    try { result = { value: operation(item.handle) }; } catch (error) { primary = { error }; }
    try { release(item); }
    catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { nativeResource: item }); }
    if (primary !== undefined) throw primary.error;
    requireFact(result !== undefined, "native-result-missing"); return result.value;
  }
  function bytes(pointer: bigint, size: number): Buffer {
    const value: unknown = koffi.decode(pointer, koffi.array("uint8", size, "Buffer"));
    requireFact(Buffer.isBuffer(value) && value.length === size, "native-buffer-unproved");
    return Buffer.from(value);
  }
  function sid(pointer: unknown): string {
    requireFact(typeof pointer === "bigint" && pointer !== 0n, "native-sid-missing");
    const header = bytes(pointer, 8);
    requireFact(header[0] === 1 && header[1] <= 15, "malformed-sid");
    return parseWindowsSid(bytes(pointer, 8 + header[1] * 4));
  }
  function currentUser(): string {
    const output: unknown[] = [null];
    requireFact(openToken(processHandle(), 8, output) !== 0, "native-token-open-failed");
    return usingHandle(resource(output[0]), handle => {
      const buffer = Buffer.alloc(4096), length = [0];
      requireFact(tokenInformation(handle, 1, buffer, buffer.length, length) !== 0
        && length[0] >= 16 && length[0] <= buffer.length, "native-token-query-failed");
      const base = koffi.address(buffer), pointer = buffer.readBigUInt64LE();
      requireFact(pointer >= base + 16n && pointer + 8n <= base + BigInt(length[0]) && pointer % 4n === 0n, "native-token-pointer-unproved");
      const offset = Number(pointer - base), size = 8 + buffer[offset + 1] * 4;
      requireFact(offset + size <= length[0], "native-token-sid-truncated");
      return parseWindowsSid(buffer.subarray(offset, offset + size));
    });
  }
  function open(path: string, write = false): Resource {
    requireFact(win32.isAbsolute(path) && /^[a-z]:[\\/]/iu.test(path) && !path.includes("\0") && !path.slice(2).includes(":"), "native-path-refused");
    return resource(create(path, 0x20080 | (write ? 0x40000000 : 0), 7, null, 3, 0x02200000, null));
  }
  function facts(handle: bigint) {
    const standard = Buffer.alloc(52), id = Buffer.alloc(24), attributes = Buffer.alloc(8), fs = Buffer.alloc(64);
    requireFact(information(handle, standard) !== 0 && informationEx(handle, 18, id, id.length) !== 0
      && informationEx(handle, 9, attributes, attributes.length) !== 0, "native-identity-query-failed");
    requireFact(volume(handle, null, 0, null, null, null, fs, 32) !== 0
      && fs.toString("utf16le").split("\0")[0] === "NTFS", "native-ntfs-required");
    requireFact((attributes.readUInt32LE(0) & 0x400) === 0 && attributes.readUInt32LE(4) === 0, "native-reparse-refused");
    const device = BigInt(standard.readUInt32LE(28));
    const inode = BigInt(standard.readUInt32LE(44)) << 32n | BigInt(standard.readUInt32LE(48));
    requireFact(id.readBigUInt64LE(16) === 0n && id.readBigUInt64LE(8) === inode
      && (id.readBigUInt64LE(0) & 0xffffffffn) === device, "native-node-identity-mapping-unproved");
    const owner: unknown[] = [null], dacl: unknown[] = [null], descriptor: unknown[] = [null];
    requireFact(security(handle, 1, 5, owner, null, dacl, null, descriptor) === 0, "native-security-query-failed");
    requireFact(typeof descriptor[0] === "bigint" && descriptor[0] !== 0n, "native-security-descriptor-missing");
    const allocation = { pointer: descriptor[0], library: kernel };
    let observed: WindowsSecurity | undefined;
    let primary: { error: unknown } | undefined;
    try {
      requireFact(typeof dacl[0] === "bigint" && dacl[0] !== 0n, "native-null-dacl");
      const flags = [0], revision = [0];
      requireFact(control(descriptor[0], flags, revision) !== 0 && (flags[0] & 4) !== 0, "native-dacl-missing");
      const head = bytes(dacl[0], 8), size = head.readUInt16LE(2);
      requireFact(size >= 8, "malformed-dacl");
      observed = { owner: sid(owner[0]), directory: (attributes.readUInt32LE(0) & 0x10) !== 0,
        aces: parseWindowsAcl(bytes(dacl[0], size)) };
    } catch (error) { primary = { error }; }
    if (free(allocation.pointer) !== null) throw retainAuthoritySourceClosure(primary === undefined
      ? [new WindowsPrivatePathError("native-security-free-failed")]
      : [primary.error, new WindowsPrivatePathError("native-security-free-failed")], { nativeResource: allocation });
    if (primary !== undefined) throw primary.error;
    requireFact(observed !== undefined, "native-security-result-missing");
    return { device, inode, links: standard.readUInt32LE(40), security: observed };
  }
  function ancestry(path: string): void {
    const parent = win32.dirname(path), root = win32.parse(parent).root;
    let cursor = root;
    const components = [root, ...parent.slice(root.length).split(/[\\/]/u).filter(Boolean).map(part => {
      cursor = win32.join(cursor, part); return cursor;
    })];
    for (const component of components) usingHandle(open(component), handle => {
      const observed = facts(handle), live = lstatSync(component, { bigint: true });
      requireFact(observed.security.directory && observed.device === live.dev && observed.inode === live.ino
        && !windowsSecurityRejects(observed.security, currentUser(), "ancestor"), "native-ancestry-unsafe");
    });
  }
  function inspect(path: string, expected: PathStat, rule: PrivacyRule, inheritance = false): boolean {
    const device = exact(expected.dev), inode = exact(expected.ino);
    ancestry(path);
    return usingHandle(open(path), handle => {
      const observed = facts(handle), live = lstatSync(path, { bigint: true });
      requireFact(device === observed.device && inode === observed.inode && live.dev === device && live.ino === inode,
        "native-path-identity-changed");
      if (!observed.security.directory && observed.links !== 1) return true;
      return windowsSecurityRejects(observed.security, currentUser(), rule,
        inheritance || observed.security.directory && ["directory-0700", "private", "private-read-write"].includes(rule));
    });
  }
  return {
    inspect,
    rejectReparse(path: string): void { ancestry(path); usingHandle(open(path), handle => { facts(handle); }); },
    flush(path: string): void {
      ancestry(path);
      const before = lstatSync(path, { bigint: true });
      usingHandle(open(path, true), handle => {
        const observed = facts(handle);
        requireFact(observed.device === before.dev && observed.inode === before.ino, "native-flush-identity-changed");
        requireFact(flush(handle) !== 0, "native-flush-failed");
        const after = lstatSync(path, { bigint: true });
        requireFact(after.dev === observed.device && after.ino === observed.inode, "native-flush-identity-changed");
      });
    },
    createDirectory(path: string): void {
      const user = currentUser(), output: unknown[] = [null];
      const parent = dirname(path), parentStat = lstatSync(parent, { bigint: true });
      requireFact(!inspect(parent, parentStat, "ancestor"), "native-creation-parent-unsafe");
      requireFact(convert(`O:${user}D:P(A;OICI;FA;;;${user})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`, 1, output, null) !== 0
        && typeof output[0] === "bigint" && output[0] !== 0n, "native-creation-security-failed");
      const allocation = { pointer: output[0], library: kernel }, attributes = Buffer.alloc(24);
      attributes.writeUInt32LE(24); attributes.writeBigUInt64LE(allocation.pointer, 8);
      let primary: { error: unknown } | undefined;
      try { requireFact(createDirectory(path, attributes) !== 0, "native-directory-creation-failed"); }
      catch (error) { primary = { error }; }
      if (free(allocation.pointer) !== null) throw retainAuthoritySourceClosure(primary === undefined
        ? [new WindowsPrivatePathError("native-security-free-failed")]
        : [primary.error, new WindowsPrivatePathError("native-security-free-failed")], { nativeResource: allocation });
      if (primary !== undefined) throw primary.error;
      requireFact(!inspect(path, lstatSync(path, { bigint: true }), "directory-0700", true), "native-created-directory-unsafe");
    },
  };
}

let native: ReturnType<typeof loadNative> | undefined;
function bridge() { return native ??= loadNative(); }
export function windowsPrivatePathRejects(path: string, expected: PathStat, rule: PrivacyRule): boolean {
  if (expected.isSymbolicLink()) return true;
  return bridge().inspect(path, expected, rule);
}
export function assertWindowsPrivateParent(path: string): void {
  requireFact(!bridge().inspect(path, lstatSync(path, { bigint: true }), "directory-0700", true), "native-creation-parent-unsafe");
}
export function createWindowsPrivateDirectory(path: string): void { bridge().createDirectory(path); }
export function flushWindowsPath(path: string): void { bridge().flush(path); }
export function assertWindowsNoReparse(path: string): void { bridge().rejectReparse(path); }
