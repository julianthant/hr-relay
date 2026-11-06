import {createRoot} from 'react-dom/client';
import './fixture.css';
import {AssistantPanel} from '../../../../src/dashboard/surfaces/shell/assistant-panel.js';
import {createAssistantMockProducer} from '../../../../src/dashboard/surfaces/shell/assistant-panel-model.js';
import {createDashboardClient} from '../../../../src/dashboard/client/index.js';
import {useAssistantController} from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import {ChatGptAccountContext,createServedChatGptAccountPort} from '../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js';
import {DashboardClientProvider} from '../../../../src/dashboard/state/client-context.js';
import {lazy,Suspense} from 'react';
import {TooltipProvider,ToastProvider} from '../../../../src/dashboard/ds/ui.js';
import {ASSISTANT_START_PROPOSAL} from '../../../support/fixtures/dashboard/assistant-start.js';
const params=new URLSearchParams(location.search);
document.documentElement.dataset.demoTheme=params.get('theme')||'dark';
document.documentElement.dataset.motion=params.get('motion')||'on';
const client=createDashboardClient({baseUrl:location.origin});
const noop=()=>{};
const scenes = ['new', 'conversation', 'ask-read', 'ask-write', 'permission-changed', 'working', 'cancelling', 'done', 'failed', 'handoff', 'destructive', 'delete-working', 'resolved', 'declined'] as const;
const scene = scenes.find(scene => scene === (params.get('scene') || 'ask-write'));
if (!scene) throw new Error('Unknown assistant fixture scene');
const identity={chatId:'00000000-0000-4000-8000-000000000001',actionId:'00000000-0000-4000-8000-000000000002',revision:1};
const servedClient: Parameters<typeof useAssistantController>[0]={async assistantRespond(){if(params.get('respondLost')==='1')throw Error('synthetic lost automatic response');if(params.get('autoUnknown')==='1')return {kind:'result',result:{state:'unknown',actionId:ASSISTANT_START_PROPOSAL.actionId,action:ASSISTANT_START_PROPOSAL}};return {kind:'result',result:{state:'action-proposal',proposal:{...identity,expiresAt:'2099-01-01T00:00:00Z',label:'Mark a notification read',targetLabel:'Local notification',subject:'none',effect:'local-write'}}};},async assistantDecide(input){document.body.dataset.decisions=String(Number(document.body.dataset.decisions||0)+1);if(params.get('lost')==='1')throw Error('synthetic lost response');return {state:'applied',actionId:input.actionId};}};
function Served(){const served=useAssistantController(params.get('transport')==='1'?client:servedClient,1,undefined,false);return <AssistantPanel producer={createAssistantMockProducer('new')} accountClient={client} served={served} onOpenSettings={noop} title="Action proof"/>;}
const Shell=lazy(async()=>{const {HubShell}=await import('../../../../src/dashboard/surfaces/shell/hub-shell.js');return {default:function Shell(){return <DashboardClientProvider client={client}><TooltipProvider><ToastProvider><div className="dashboard-shell"><HubShell source="served" authority="synthetic-person" subjectRef="run_00010001-0001-4001-8001-000100010001_1" settingsOpen={false} onLogout={noop} onRunWorkflow={async()=>({state:'failed',message:'Workflow starts are outside this proof.'})}/></div></ToastProvider></TooltipProvider></DashboardClientProvider>;}};});

const element = document.getElementById('fixture');
if (!element) throw new Error('Missing assistant fixture root');
const mount=createRoot(element);
if(params.get('served')==='1'){const preview=createServedChatGptAccountPort(client);void preview.refresh().then(()=>mount.render(<ChatGptAccountContext.Provider value={{...preview,mode:'live'}}>{params.get('shell')==='1'?<Suspense fallback={<p>Loading synthetic assistant…</p>}><Shell/></Suspense>:<Served/>}</ChatGptAccountContext.Provider>));}
else mount.render(<AssistantPanel producer={createAssistantMockProducer(scene)} accountClient={client} onClose={noop} onRename={noop} onChats={noop} initialText={params.get('text')||''} onRegisterSpreadsheet={async file=>{document.body.dataset.registered=file.name;}} onRunWorkflow={async request=>{if(request.dryRun!==true)throw Error('fixture-refuses-live');document.body.dataset.run=JSON.stringify(request);return {state:'complete',source:'mock',files:[{...request.file,id:'updated',name:'Updated.csv',status:'Updated'},{...request.file,id:'generated',name:'Results.csv',status:'Generated'}]};}}/>);
