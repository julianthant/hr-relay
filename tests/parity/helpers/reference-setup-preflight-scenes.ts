import type { SetupScene } from "../../fixtures/preflight/served-runtime.js";
export const SETUP_SCENES:readonly {id:SetupScene;selected:boolean;expected:string}[]=[
  {id:"healthy",selected:false,expected:"runtime.compatibility"},
  {id:"browser-missing",selected:true,expected:"browser.assets"},
  {id:"secret-missing",selected:true,expected:"secrets.ucpath"},
  {id:"optional-warning",selected:false,expected:"process.orphans"},
  {id:"unavailable",selected:true,expected:"Readiness unavailable"},
  {id:"stale",selected:false,expected:"Readiness unavailable"},
];
