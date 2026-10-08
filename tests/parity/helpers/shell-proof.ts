import { createHash } from "node:crypto";
import type { Page,TestInfo } from "@playwright/test";

export async function attachShellA11y(page:Page,info:TestInfo,name:string):Promise<void>{
  const tree=await page.locator("body").ariaSnapshot();
  info.annotations.push({type:`a11y-attachment-sha256:${name}`,description:createHash("sha256").update(tree).digest("hex")});
  await info.attach(name,{body:tree,contentType:"text/yaml"});
}

/** Measures actual inherited foreground/background paints, including translucent surfaces. */
export async function shellTextContrast(page:Page){
  return page.evaluate(()=>{
    const rgba=(color:string):number[]=>{
      const values=color.match(/[\d.]+/g)?.map(Number);if(!values||values.length<3)throw Error(`Unsupported paint ${color}`);
      return [values[0],values[1],values[2],values[3]??1];
    };
    const composite=(front:number[],back:number[])=>front.slice(0,3).map((channel,index)=>channel*front[3]+back[index]*(1-front[3])).concat(1);
    const background=(node:Element):number[]=>{
      const own=rgba(getComputedStyle(node).backgroundColor);
      if(own[3]===1)return own;
      if(!node.parentElement)throw Error("Shell has no opaque background");
      return composite(own,background(node.parentElement));
    };
    const luminance=(paint:number[])=>paint.slice(0,3).reduce((sum,channel,index)=>{
      const value=channel/255;return sum+[0.2126,0.7152,0.0722][index]*(value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);
    },0);
    return [...document.querySelectorAll<HTMLElement>('.workflow-rail button:not(:disabled), .dashboard-action-panel button:not(:disabled)')]
      .filter(node=>node.textContent?.trim() && node.getBoundingClientRect().width>0)
      .map(node=>{const bg=background(node),fg=composite(rgba(getComputedStyle(node).color),bg);const a=luminance(fg),b=luminance(bg);
        return {name:node.getAttribute("aria-label")??node.textContent?.trim(),ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};});
  });
}
