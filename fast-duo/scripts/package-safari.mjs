import { mkdir, copyFile, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--personal')) throw new Error('Usage: npm run package:safari [-- --personal]');
const personal = args.includes('--personal');
const output = join(root, 'dist', personal ? 'safari-personal' : 'safari-share');
const resources = join(output, 'extension');
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer' };
function run(command, parameters, options = {}) {
  return execFileSync(command, parameters, { cwd: root, env, stdio: 'inherit', ...options });
}
// Check the toolchain before removing this script's previous generated output.
run('/usr/bin/xcrun', ['--find', 'safari-web-extension-packager']);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true, mode: personal ? 0o700 : 0o755 });
run(process.execPath, [join(root, 'scripts/package.mjs'), resources]);
const manifest = JSON.parse(await readFile(join(resources, 'manifest.json'), 'utf8'));
delete manifest.minimum_chrome_version;
await writeFile(join(resources, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
if (personal) {
  const bootstrap = JSON.parse(await readFile(join(root, 'bootstrap.json'), 'utf8'));
  if (bootstrap.credentialFile !== 'credentials/duo-webauthn.json') throw new Error('Personal build requires the known local credential file.');
  await mkdir(join(resources, 'credentials'), { mode: 0o700 });
  await copyFile(join(root, bootstrap.credentialFile), join(resources, bootstrap.credentialFile));
  await chmod(join(resources, bootstrap.credentialFile), 0o600);
  await writeFile(join(resources, 'bootstrap.json'), JSON.stringify(bootstrap, null, 2) + '\n', { mode: 0o600 });
}
run('/usr/bin/xcrun', ['safari-web-extension-packager', resources, '--project-location', join(output, 'project'), '--app-name', 'Duo Autopilot', '--bundle-identifier', 'local.duoautopilot', '--swift', '--macos-only', '--copy-resources', '--no-open', '--no-prompt']);
const project = join(output, 'project/Duo Autopilot/Duo Autopilot.xcodeproj');
const projectFile = join(project, 'project.pbxproj');
let config = await readFile(projectFile, 'utf8');
// Xcode's packager sometimes derives the host ID from the display name rather
// than the requested identifier. Explicitly keep host and extension IDs paired.
config = config.replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g, line => line.includes('.Extension') ? 'PRODUCT_BUNDLE_IDENTIFIER = local.duoautopilot.Extension;' : 'PRODUCT_BUNDLE_IDENTIFIER = local.duoautopilot;');
await writeFile(projectFile, config);
run('/usr/bin/xcodebuild', ['-project', project, '-scheme', 'Duo Autopilot', '-configuration', 'Release', '-derivedDataPath', join(output, 'build'), 'CODE_SIGN_IDENTITY=-', 'CODE_SIGN_STYLE=Manual', 'DEVELOPMENT_TEAM=', 'MACOSX_DEPLOYMENT_TARGET=13.0', 'ARCHS=arm64 x86_64', 'ONLY_ACTIVE_ARCH=NO', 'build'], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 });
const app = join(output, 'Duo Autopilot.app');
run('/usr/bin/ditto', [join(output, 'build/Build/Products/Release/Duo Autopilot.app'), app]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
const bundled = join(app, 'Contents/PlugIns/Duo Autopilot Extension.appex/Contents/Resources');
const bundledBootstrap = JSON.parse(await readFile(join(bundled, 'bootstrap.json'), 'utf8'));
if (!personal && (bundledBootstrap.credentialFile || bundledBootstrap.accounts.length)) throw new Error('Share app contains personal bootstrap data.');
if (personal && bundledBootstrap.credentialFile !== 'credentials/duo-webauthn.json') throw new Error('Personal app is missing bootstrap configuration.');
await copyFile(join(root, 'SAFARI.md'), join(output, 'INSTALL.md'));
if (!personal) {
  const archive = join(root, 'dist/duo-autopilot-safari-share.zip');
  await rm(archive, { force: true });
  run('/usr/bin/zip', ['-qr', archive, 'Duo Autopilot.app', 'INSTALL.md'], { cwd: output });
  console.log(`Credential-free Safari archive: ${archive}`);
}
console.log(`${personal ? 'PRIVATE — contains your existing keys; do not share' : 'Clean setup — each person enrolls their own keys'}\n${app}\nLocal development signature. Enable unsigned extensions in Safari; public distribution requires Apple signing.`);
