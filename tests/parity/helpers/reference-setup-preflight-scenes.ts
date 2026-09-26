import type { SetupScene } from "../../fixtures/preflight/served-runtime.js";
export const SETUP_SCENES:readonly {id:SetupScene;selected:boolean;expected:string}[]=[
  {id:"healthy",selected:false,expected:"Runtime compatibility"},
  {id:"browser-missing",selected:true,expected:"Browser tools"},
  {id:"secret-missing",selected:true,expected:"UCPath sign-in"},
  {id:"optional-warning",selected:false,expected:"Unfinished processes"},
  {id:"unavailable",selected:true,expected:"Readiness unavailable"},
  {id:"stale",selected:false,expected:"Readiness unavailable"},
];
