import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { expect } from '@playwright/test';
import { test } from './helpers/matrix-fixtures.js';
import { createServer, type ViteDevServer } from 'vite';
import { captureA11yReference } from './helpers/capture.js';
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from './helpers/fixture-identity.js';

const states = ['library', 'library-registered', 'files-empty', 'files', 'files-preview', 'picker', 'editor', 'versions', 'type-create', 'type-edit', 'import'] as const;
let server: ViteDevServer, baseUrl: string, fixtureRoot: string;
test.beforeAll(async () => {
  const evidence = resolve('.work/HUB-WIRE-1C'); mkdirSync(evidence, { recursive: true });
  fixtureRoot = mkdtempSync(join(evidence, 'fixture-'));
  writeFileSync(join(fixtureRoot, 'entry.tsx'), `
import '@vitejs/plugin-react/preamble';
import React, {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SpreadsheetLibrary} from '/@fs/${resolve('src/dashboard/surfaces/spreadsheets/spreadsheet-library.tsx')}';
import {SpreadsheetTypeDialog} from '/@fs/${resolve('src/dashboard/surfaces/spreadsheets/spreadsheets.tsx')}';
import {SpreadsheetEditor} from '/@fs/${resolve('src/dashboard/surfaces/spreadsheets/spreadsheet-editor.tsx')}';
import {SpreadsheetVersions} from '/@fs/${resolve('src/dashboard/surfaces/spreadsheets/spreadsheet-versions.tsx')}';
import {SpreadsheetColumnImport} from '/@fs/${resolve('src/dashboard/surfaces/spreadsheets/spreadsheet-column-import.tsx')}';
import {prepareSpreadsheetColumns} from '/@fs/${resolve('src/dashboard/surfaces/spreadsheets/spreadsheet-column-import-model.ts')}';
import {ChatFiles} from '/@fs/${resolve('src/dashboard/surfaces/shell/chat-files.tsx')}';
import {exportSheetInWorker} from '/@fs/${resolve('src/dashboard/surfaces/spreadsheets/spreadsheet-import-client.ts')}';
import {ToastProvider} from '/@fs/${resolve('src/dashboard/ds/ui.tsx')}';
import '/@fs/${resolve('src/dashboard/app/index.css')}';
import '/@fs/${resolve('src/dashboard/ds/theme/hub-theme.css')}';
const params=new URLSearchParams(location.search),theme=params.get('theme')||'light';
let scene=params.get('scene')||'library';
for(const node of [document.documentElement,document.body]){node.dataset.demoTheme=theme;node.classList.toggle('dark',theme==='dark');}
document.documentElement.dataset.motion=params.get('motion')||'on';
const workbook={name:'Autumn onboarding.xlsx',libraryId:'fixture',themes:[],hasFormulas:false,sheets:[{id:'sheet',name:'People',width:3,hidden:[],headerRow:1,columnBindings:['firstName','lastName','eid'].map((fieldId,column)=>({id:'column-'+column,sourceColumn:column,sourceHeader:['First name','Last name','Employee ID'][column],fieldId,basis:'manual'})),rows:[['First name','Last name','Employee ID'],['Alex','Rivera','10000001'],['Morgan','Vega','10000002']].map((cells,index)=>({id:'row-'+index,cells:cells.map(value=>({value}))}))}]};
const types=[{id:'onboarding',name:'Onboarding roster',fields:['First name','Last name','Employee ID']},{id:'employment',name:'Employment records',fields:['First name','Last name','Employee ID']}];
const files=[{id:'one',name:'Autumn onboarding.xlsx',typeId:'onboarding',sheets:[],rowCount:17},{id:'two',name:'Employment check.xlsx',typeId:'employment',sheets:[],rowCount:24}];
const chatFiles=['Autumn onboarding.csv','Autumn onboarding-updated.csv','Onboarding results.csv'].map((name,index)=>({id:'file-'+index,name,kind:'workbook',reference:{libraryId:'file-'+index,version:index===1?2:1,name,status:['Attached','Updated','Generated'][index]}}));
const emptyFiles=[];
const port={subscribe:()=>()=>{},snapshot:()=>scene==='files-empty'?emptyFiles:chatFiles,open:async file=>({kind:'workbook',document:{...workbook,name:file.name,libraryId:file.reference.libraryId}}),download:async file=>({name:file.name,blob:new Blob([await exportSheetInWorker(workbook.sheets[0])],{type:'text/csv'})})};
const records=[1,2].map(version=>({libraryId:'fixture',version,createdAt:'2026-10-01T00:00:00Z',savedAt:'2026-10-01T00:00:00Z',workbook}));
const readVersions=async()=>records;
function App(){const [document,setDocument]=useState(workbook),[dirty,setDirty]=useState(false),[view,setView]=useState(scene),[attached,setAttached]=useState(''),[dates,setDates]=useState({start:'2026-10-01',end:'2026-10-31'});const trigger=useRef(null),typeTrigger=useRef(null);const chat=view.startsWith('files')||view==='picker';
return <ToastProvider><main className={chat?'fixture-chat':'fixture-library'} data-fixture-ready={scene} data-demo-theme={theme}>
{chat?<ChatFiles port={port} mode={view==='picker'?'attach':'browse'} onBackToChat={()=>setView('back')} onAttachFile={file=>setAttached(file.name)} onOpenWorkbook={file=>{setDocument({...workbook,name:file.name,libraryId:file.libraryId});setView('editor')}}/>:view==='back'?<p role="status">Back in chat</p>:view==='editor'||view==='versions'?<SpreadsheetEditor document={document} dirty={dirty} onDocument={(next,dirty)=>{if(next)setDocument(next);else setView('library');setDirty(dirty)}} onHistory={()=>setView('versions')} onSave={async next=>({state:'confirmed',version:3,readback:next})}/>:<SpreadsheetLibrary files={scene==='library-registered'?[...files,...chatFiles.map(file=>({id:file.id,name:file.name,typeId:'local',sheets:[],rowCount:2,version:file.reference.version,status:file.reference.status}))]:files} types={types} busy={false} loading={false} failed={false} pendingImport={false} importTrigger={trigger} onImport={()=>setView('import')} onCreateType={button=>{typeTrigger.current=button;setView('type-create')}} onEditType={(type,button)=>{typeTrigger.current=button;setView('type-edit')}} onOpen={()=>setView('editor')} reportDates={{...dates,onChange:(field,value)=>setDates(previous=>({...previous,[field]:value}))}}/>}
{attached&&<p role="status">Attached {attached}</p>}
<SpreadsheetTypeDialog key={view} open={view==='type-create'||view==='type-edit'} onOpenChange={()=>setView('library')} type={view==='type-edit'?types[0]:undefined} returnFocus={typeTrigger}/>
<SpreadsheetVersions libraryId={view==='versions'?'fixture':null} read={readVersions} onClose={()=>setView('editor')} onDownload={async()=>{}}/>
<SpreadsheetColumnImport open={view==='import'} document={prepareSpreadsheetColumns(document)} onOpenChange={()=>setView('library')} onChange={setDocument} onCancel={()=>setView('library')} onConfirm={()=>setView('editor')} returnFocus={trigger}/>
</main></ToastProvider>}
const root=createRoot(document.getElementById('root'));
function renderScene(){const params=new URLSearchParams(location.search);scene=params.get('scene')||'library';document.documentElement.dataset.motion=params.get('motion')||'on';root.render(<App key={scene}/>);window.scrollTo(0,0);}
addEventListener('popstate',renderScene);renderScene();
`);
  writeFileSync(join(fixtureRoot, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="UTF-8"><link rel="icon" href="data:,"><title>HUB sheets fixture</title><style>html,body{margin:0;background:var(--ui-canvas);min-width:1024px;min-height:720px}.fixture-library{width:828px;margin:32px auto}.fixture-chat{position:fixed;right:33px;top:221px;width:418px;height:526px;display:flex;background:var(--ui-panel)}.fixture-library:has(.spreadsheet-editor){width:calc(100% - 320px)}@media(max-height:880px){.fixture-chat{top:calc(53px + 48px);height:calc(100dvh - 354px)}}</style></head><body><div id="root"></div><script type="module" src="/@fs/${join(fixtureRoot, 'entry.tsx')}"></script></body></html>`);
  server = await createServer({ configFile: resolve('vite.dashboard.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, open: false, hmr: false, proxy: {} } });
  await server.listen(); const address = server.httpServer!.address();
  if (!address || typeof address === 'string') throw new Error('fixture address unavailable');
  baseUrl = `http://127.0.0.1:${address.port}/@fs/${join(fixtureRoot, 'index.html')}`;
  writeFileSync(join(evidence, `fixture-url-${process.pid}.txt`), baseUrl);
});
test.afterAll(async () => { await server?.close(); if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true }); });

for (const browserName of ['chromium', 'webkit'] as const) test.describe(browserName, () => {
  for (const width of [1440, 1920, 2560]) for (const theme of ['light', 'dark']) {
    const evidenceName = `hub-sheets-${browserName}-${width}-${theme}.a11y.yml`;
    test(`HUB sheets owned states ${browserName} ${width} ${theme}`, { annotation: [{ type: 'required-a11y-evidence', description: evidenceName }] }, async ({ browserFor }, info) => {
      const browser = await browserFor(browserName);
      const page = await browser.newPage();
      const errors: string[] = [];
      try {
      page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.setViewportSize({ width, height: 1000 });
      let loaded = false;
      const loadScene = async (scene: string, motion = 'on') => {
        const url = `${baseUrl}?scene=${scene}&theme=${theme}&motion=${motion}`;
        if (!loaded) { await page.goto(url); loaded = true; }
        else {
          // A fresh document starts in keyboard modality; restore it before remounting.
          await page.keyboard.press('Tab');
          await page.evaluate(url => { history.replaceState(null, '', url); dispatchEvent(new PopStateEvent('popstate')); }, url);
        }
        await expect(page.locator('[data-fixture-ready]')).toHaveAttribute('data-fixture-ready', scene);
      };
      for (const scene of states) {
        await loadScene(scene);
        await expect(page.locator('[data-fixture-ready]')).toBeVisible(); await page.evaluate(() => document.fonts.ready);
        if (scene === 'files-preview') { await page.getByRole('button', { name: 'Preview Autumn onboarding-updated.csv', exact: true }).click(); await expect(page.getByRole('table', { name: 'People preview', exact: true })).toBeVisible(); }
        const target = scene === 'files-preview' || scene === 'type-create' || scene === 'type-edit' || scene === 'versions' || scene === 'import' ? page.getByRole('dialog').first() : page.locator('.fixture-chat,.fixture-library');
        if (scene === 'versions') await expect(page.getByRole('table', { name: 'Saved spreadsheet versions' })).toBeVisible();
        const name = await captureA11yReference(page, resolve('tests/parity/references'), { stateId: `hub-sheets-${scene}`, viewport: `${width}x1000`, theme, adapter: 'fixture', fixtureId: 'hub-sheets-components', descriptorHash: FIXTURE_DESCRIPTOR_HASH, appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: browserName });
        await expect(target).toHaveScreenshot(`${name}.png`, { animations: 'disabled' });
      }
      await loadScene('files-empty'); await expect(page.getByRole('button', { name: 'Back to chat' })).toBeVisible();
      await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab'); await expect(page.getByRole('button', { name: 'Back to chat' })).toBeFocused();
      await page.keyboard.press('Enter'); await expect(page.getByRole('status')).toHaveText('Back in chat');
      await loadScene('picker'); await page.getByRole('button', { name: 'Attach Autumn onboarding-updated.csv', exact: true }).click(); await expect(page.getByRole('status')).toHaveText('Attached Autumn onboarding-updated.csv');
      await loadScene('files');
      const preview = page.getByRole('button', { name: 'Preview Autumn onboarding-updated.csv', exact: true });
      await expect(preview).toBeVisible(); const filesBefore = await page.locator('.fixture-chat').boundingBox();
      await preview.click(); await expect(page.getByRole('table', { name: 'People preview' })).toBeVisible();
      expect(await page.locator('.fixture-chat').boundingBox()).toEqual(filesBefore);
      await page.keyboard.press('Escape'); await expect(preview).toBeFocused();
      await expect(preview.locator('..')).toHaveCSS('background-color', theme === 'light' ? 'rgb(148, 148, 148)' : 'rgb(176, 176, 176)');
      await loadScene('library');
      const library = page.locator('.hub-sheets-library'), create = page.getByRole('button', { name: 'Create type', exact: true });
      await expect(create).toBeVisible(); const before = await library.boundingBox();
      await create.click(); await expect(page.getByRole('dialog')).toBeVisible();
      expect(await library.boundingBox()).toEqual(before);
      await expect(page.getByRole('textbox', { name: 'Type name', exact: true })).toHaveCSS('outline-style', 'none');
      await page.keyboard.press('Escape'); await expect(create).toBeFocused();
      await loadScene('files-empty', 'off');
      const back = page.getByRole('button', { name: 'Back to chat', exact: true }); await expect(back).toBeVisible();
      await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab'); await expect(back).toBeFocused();
      await expect(back).toHaveCSS('background-color', theme === 'light' ? 'rgb(148, 148, 148)' : 'rgb(176, 176, 176)');
      await expect(back).toHaveCSS('transition-duration', '0s');
      await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(back).toHaveCSS('animation-name', 'none');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await loadScene('files', 'off');
      await page.getByRole('button', { name: 'Preview Autumn onboarding-updated.csv', exact: true }).click();
      await expect(page.getByRole('table', { name: 'People preview' })).toBeVisible();
      const scrim = page.locator('body > div[data-state="open"]:has(+ .hub-chat-files-dialog)');
      await expect(scrim).toHaveCSS('transition-duration', '0s'); await expect(scrim).toHaveCSS('opacity', '1');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => { document.documentElement.dataset.motion = 'on'; });
      await expect(scrim).toHaveCSS('transition-duration', '0s');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const tree = await page.locator('body').ariaSnapshot(); info.annotations.push({ type: `a11y-attachment-sha256:${evidenceName}`, description: createHash('sha256').update(tree).digest('hex') }); await info.attach(evidenceName, { body: tree, contentType: 'text/yaml' });
      expect(errors).toEqual([]);
      } finally { await info.attach(evidenceName.replace('.a11y.yml', '.console.json'), { body: JSON.stringify(errors), contentType: 'application/json' }); await page.context().close(); }
    });
  }
});
