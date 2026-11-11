import { randomUUID } from 'node:crypto';
import { errors } from '@strapi/utils';
import { authorizeWireframeProject } from './wireframe-scope';
import { buildStitchFlowPrompt } from './wireframe-prompt';
import { createStitchProvider, validatedPngDataUrl } from './stitch-provider';
import tenantAccess from '../../../policies/tenant-access';
export const WIREFRAME_UID = 'api::stitch-wireframe.stitch-wireframe';
export type WireframeVersion = {id:string;status:'generating'|'completed'|'partial'|'error'|'uncertain';createdAt:string;stitchUrl?:string;message?:string;flowSummary?:string;screens:Array<{id:string;title:string;imageDataUrl?:string}>};
type Options = {strapi:any;authorize?:typeof tenantAccess;configured?:()=>boolean;schedule?:(job:()=>Promise<void>)=>void;provider?:any};
function proposedFlowSummary(brief:string):string {
  const section=brief.match(/^##\s+Flujo recomendado entre escenas\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  return (section?.[1]?.trim() || brief.trim()).slice(0,4000);
}
export function createWireframesService(options: Options) {
  const {strapi,authorize=tenantAccess,configured=()=>Boolean(process.env.STITCH_API_KEY?.trim()),schedule=(job)=>queueMicrotask(()=>{void job();})}=options;
  const instance=randomUUID();
  const running=new Set<string>();
  const tails=new Map<string,Promise<void>>();
  const repository=()=>strapi.db.query(WIREFRAME_UID);
  const rowsFor=(project:any)=>repository().findMany({where:{projectKey:project.documentId,organizationKey:project.organization.documentId},orderBy:{startedAt:'desc'}});
  const dto=(row:any):WireframeVersion=>{
    const projectName=typeof row.metadata?.projectName==='string' && /^projects\/[A-Za-z0-9_-]{1,128}$/.test(row.metadata.projectName)?row.metadata.projectName:null;
    const source=Array.isArray(row.metadata?.screens)?row.metadata.screens.slice(0,12):[{screenName:row.metadata?.screenName,title:row.metadata?.title,imageDataUrl:row.imageDataUrl}];
    const seen=new Set<string>();
    const screens:WireframeVersion['screens']=[];
    for(const item of source) {
      const name=item?.screenName;
      if(typeof name!=='string' || !projectName || !name.startsWith(`${projectName}/screens/`) || !/^projects\/[A-Za-z0-9_-]{1,128}\/screens\/[A-Za-z0-9_-]{1,128}$/.test(name) || seen.has(name))continue;
      seen.add(name);
      let imageDataUrl:string|undefined;
      if(typeof item.imageDataUrl==='string' && item.imageDataUrl.startsWith('data:image/png;base64,')) {
        try {imageDataUrl=validatedPngDataUrl(item.imageDataUrl.slice(22));}catch{/* Never expose invalid stored artifacts. */}
      }
      screens.push({id:name,title:typeof item.title==='string'?item.title.slice(0,300):'Wireframe lo-fi',...(imageDataUrl?{imageDataUrl}:{})});
    }
    return {id:row.requestKey,status:row.status==='generating' && (row.ownerRun!==instance || !running.has(row.projectKey))?'uncertain':row.status,createdAt:row.startedAt,
      ...(projectName?{stitchUrl:`https://stitch.withgoogle.com/projects/${projectName.split('/')[1]}`} : {}),
      ...(typeof row.metadata?.flowSummary==='string'?{flowSummary:row.metadata.flowSummary.slice(0,4000)}:{}),screens};
  };
  async function save(row:any,data:any) {
    await repository().update({where:{id:row.id},data});
    const actual=await repository().findOne({where:{id:row.id}});
    if (!actual || Object.entries(data).some(([key,value])=>JSON.stringify(actual[key])!==JSON.stringify(value))) throw new Error('Private wireframe save could not be verified.');
    Object.assign(row,actual);
  }
  async function work(userId:number,project:any,row:any) {
    try {
      const result=await (options.provider || createStitchProvider)().generate({title:`${project.name} — lo-fi`,prompt:buildStitchFlowPrompt(project.aiWireframeBrief),
        onProject:async(projectName:string)=>save(row,{metadata:{...row.metadata,projectName,screens:[]}}),
        onScreen:async(screen:any)=>{
          const previous=Array.isArray(row.metadata?.screens)?row.metadata.screens:[];
          const index=previous.findIndex((item:any)=>item.screenName===screen.screenName);
          const screens=previous.map((item:any)=>({...item}));
          const imageDataUrl=screen.imageDataUrl===undefined?undefined:validatedPngDataUrl(screen.imageDataUrl.slice(22));
          const item={screenName:screen.screenName,title:screen.title,...(imageDataUrl?{imageDataUrl}:{})};
          if(index<0)screens.push(item);else screens[index]={...screens[index],...item};
          await save(row,{metadata:{...row.metadata,screens}});
        }});
      if(!Array.isArray(result.screens) || result.screens.length<2 || result.screens.length>12 || dto(row).screens.length!==result.screens.length || dto(row).screens.some(screen=>!screen.imageDataUrl))throw Error('STITCH_INCOMPLETE_FLOW');
      await save(row,{metadata:{...row.metadata,accountingStatus:'pending'}});
      await strapi.service('api::plan-access.plan-access').consumeAiUsage(userId,project.documentId,1);
      await save(row,{status:'completed',activeKey:null,metadata:{...row.metadata,accountingStatus:'completed'}});
    } catch {
      // Provider or accounting failures may have committed remotely. Retain the claim for manual reconciliation; never replay.
      try { if(row.status!=='completed')await save(row,{status:(row.metadata?.screens?.length || row.metadata?.screenName)?'partial':'uncertain',...(row.metadata?.accountingStatus==='pending'?{metadata:{...row.metadata,accountingStatus:'uncertain'}}:{})}); } catch { /* Read projection reports orphaned pending as uncertain. */ }
    } finally {running.delete(project.documentId);}
  }
  return {
    async list(userId:number,projectId:string) {
      const project=await authorizeWireframeProject(strapi,userId,projectId,false,authorize);
      const rows=await rowsFor(project);
      return {configured:configured(),versions:rows.map(dto)};
    },
    async generate(userId:number,input:any):Promise<WireframeVersion> {
      const project=await authorizeWireframeProject(strapi,userId,input?.projectId,true,authorize);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key=>!['projectId','confirmedExternalSend','requestId'].includes(key)) || input.confirmedExternalSend !== true || typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) throw new errors.ValidationError('Invalid wireframe request or missing external-send confirmation.');
      const previous=tails.get(project.documentId)||Promise.resolve();
      let release!:()=>void;
      const next=new Promise<void>(resolve=>{release=resolve;});
      tails.set(project.documentId,next);
      await previous;
      try {
        const rows=await rowsFor(project);
        const existing=rows.find((row:any)=>row.requestKey===input.requestId);
        if(existing)return dto(existing);
        if(rows.some((row:any)=>['generating','uncertain','partial'].includes(dto(row).status)))throw new errors.ApplicationError('A wireframe is pending or uncertain. Reconcile before generating again.');
        if(!configured())throw new errors.ApplicationError('Stitch is not configured.');
        if(typeof project.aiWireframeBrief!=='string' || !project.aiWireframeBrief.trim() || project.aiWireframeBrief.length>30000)throw new errors.ValidationError('Save a nonempty wireframe brief (maximum 30000 characters) first.');
        await strapi.service('api::plan-access.plan-access').authorizeAi(userId,project.documentId);
        const data={documentId:randomUUID().replace(/-/g,''),projectKey:project.documentId,organizationKey:project.organization.documentId,requestKey:input.requestId,startedAt:new Date().toISOString(),ownerRun:instance,activeKey:`${project.organization.documentId}:${project.documentId}`,status:'generating',metadata:{flowSummary:proposedFlowSummary(project.aiWireframeBrief)}};
        const row=await repository().create({data});
        const actual=await repository().findOne({where:{id:row.id}});
        if(!actual || actual.requestKey!==input.requestId || actual.status!=='generating' || actual.activeKey!==data.activeKey || actual.ownerRun!==instance || actual.projectKey!==data.projectKey || actual.organizationKey!==data.organizationKey)throw new errors.ApplicationError('Pending wireframe save could not be verified.');
        running.add(project.documentId);
        schedule(()=>work(userId,project,actual));
        return dto(actual);
      } finally {release();if(tails.get(project.documentId)===next)tails.delete(project.documentId);}
    },
  };
}
export default ({strapi})=>createWireframesService({strapi});
