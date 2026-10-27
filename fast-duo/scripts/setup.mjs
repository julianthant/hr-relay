import { readFile, writeFile } from 'node:fs/promises';
const target = new URL('../bootstrap.json',import.meta.url);
try {
  await writeFile(target,await readFile(new URL('../bootstrap.example.json',import.meta.url)),{flag:'wx',mode:0o600});
  console.log('Created a clean bootstrap. Load this folder in Chrome to enroll your own accounts.');
} catch(error) {
  if(error.code !== 'EEXIST')throw error;
  console.log('Existing bootstrap preserved.');
}
