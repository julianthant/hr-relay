import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";

export function setWindowsFixtureAcl(path: string, broad = false): void {
  const parts = relative(realpathSync(tmpdir()), path).split(sep);
  if (isAbsolute(parts.join(sep)) || !/^relay-native-private-[A-Za-z0-9]+$/u.test(parts[0] ?? "") || parts.includes("..")) {
    throw new Error("native-fixture-path-refused");
  }
  const input = Buffer.from(JSON.stringify({ path, broad })).toString("base64");
  const script = `
$inputData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${input}')) | ConvertFrom-Json
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$before = [System.IO.Directory]::GetAccessControl($inputData.path, [System.Security.AccessControl.AccessControlSections]::Owner)
if ($before.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'native-fixture-owner-refused' }
$security = New-Object System.Security.AccessControl.DirectorySecurity
$security.SetAccessRuleProtection($true, $false)
foreach ($principal in @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')) {
  $identity = New-Object System.Security.Principal.SecurityIdentifier($principal)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
  $security.AddAccessRule($rule)
}
if ($inputData.broad) {
  $identity = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'Modify', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
  $security.AddAccessRule($rule)
}
[System.IO.Directory]::SetAccessControl($inputData.path, $security)
$sections = [System.Security.AccessControl.AccessControlSections]::Access -bor [System.Security.AccessControl.AccessControlSections]::Owner
$after = [System.IO.Directory]::GetAccessControl($inputData.path, $sections)
if ($after.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or !$after.AreAccessRulesProtected) { throw 'native-fixture-acl-persistence-unproved' }
`;
  execFileSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { stdio: "pipe" });
}

export function createWindowsPrivateFixture() {
  const root = mkdtempSync(join(tmpdir(), "relay-native-private-"));
  setWindowsFixtureAcl(root);
  return { root, close: () => rmSync(root, { recursive: true }) };
}
