import {createRoot} from 'react-dom/client';
import './fixture.css';
import {AssistantPanel} from '../../../../src/dashboard/surfaces/shell/assistant-panel.js';
import {createAssistantMockProducer} from '../../../../src/dashboard/surfaces/shell/assistant-panel-model.js';
import {createDashboardClient} from '../../../../src/dashboard/client/index.js';
import {useAssistantController} from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import {ChatGptAccountContext,createServedChatGptAccountPort} from '../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js';
const params=new URLSearchParams(location.search);
document.documentElement.dataset.demoTheme=params.get('theme')||'dark';
document.documentElement.dataset.motion=params.get('motion')||'on';
const client=createDashboardClient({baseUrl:location.origin});
const noop=()=>{};
const scenes = ['new', 'conversation', 'ask-read', 'ask-write', 'permission-changed', 'auto', 'working', 'cancelling', 'done', 'failed', 'handoff', 'destructive', 'delete-working', 'resolved', 'declined'] as const;
const scene = scenes.find(scene => scene === (params.get('scene') || 'ask-write'));
if (!scene) throw new Error('Unknown assistant fixture scene');
const identity={chatId:'00000000-0000-4000-8000-000000000001',actionId:'00000000-0000-4000-8000-000000000002',revision:1};
const servedClient: Parameters<typeof useAssistantController>[0]={async assistantRespond(){if(params.get('respondLost')==='1')throw Error('synthetic lost automatic response');if(params.get('autoUnknown')==='1')return {state:'unknown',actionId:identity.actionId,action:{...identity,expiresAt:'2099-01-01T00:00:00Z',label:'Mark 25 current notifications read',targetLabel:'25 current notifications',subject:'none',effect:'local-write'}};return {state:'action-proposal',proposal:{...identity,expiresAt:'2099-01-01T00:00:00Z',label:'Mark a notification read',targetLabel:'Local notification',subject:'none',effect:'local-write'}};},async assistantDecide(input){document.body.dataset.decisions=String(Number(document.body.dataset.decisions||0)+1);if(params.get('lost')==='1')throw Error('synthetic lost response');return {state:'applied',actionId:input.actionId};}};
function Served(){const served=useAssistantController(servedClient,1,undefined,false);return <AssistantPanel producer={createAssistantMockProducer('new')} accountClient={client} served={served} title="Action proof"/>;}

const element = document.getElementById('fixture');
if (!element) throw new Error('Missing assistant fixture root');
const mount=createRoot(element);
if(params.get('served')==='1'){const preview=createServedChatGptAccountPort(client);void preview.refresh().then(()=>mount.render(<ChatGptAccountContext.Provider value={{...preview,mode:'live'}}><Served/></ChatGptAccountContext.Provider>));}
else mount.render(<AssistantPanel producer={createAssistantMockProducer(scene)} accountClient={client} onClose={noop} onRename={noop} onChats={noop} onOpenChatFile={async()=>null} initialText={params.get('text')||''} onRegisterSpreadsheet={async file=>{document.body.dataset.registered=file.name;}} onRunWorkflow={async request=>{if(request.dryRun!==true)throw Error('fixture-refuses-live');document.body.dataset.run=JSON.stringify(request);return {state:'complete',source:'mock',files:[{...request.file,id:'updated',name:'Updated.csv',status:'Updated'},{...request.file,id:'generated',name:'Results.csv',status:'Generated'}]};}}/>);
