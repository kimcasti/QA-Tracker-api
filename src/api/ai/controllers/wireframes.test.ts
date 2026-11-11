import test from 'node:test';
import assert from 'node:assert/strict';
import controller from './ai';
import routes from '../routes/ai';
import { EXPOSED_ACTIONS } from '../../../utils/access';
import { readFileSync, existsSync } from 'node:fs';

test('authenticated gallery routes invoke real controller and expose only guarded actions, not artifact CRUD', async () => {
  const calls:any[]=[];
  (globalThis as any).strapi={service:(uid:string)=>{assert.equal(uid,'api::ai.wireframes');return {list:async(...args:any[])=>{calls.push(args);return {configured:false,versions:[]};},generate:async(...args:any[])=>{calls.push(args);return {id:'one'};}};}};
  for(const [method,action] of [['GET','listProjectWireframes'],['POST','generateProjectWireframe']] as const){
    const route=routes.routes.find(r=>r.method===method&&r.path==='/ai/project/wireframes');
    assert.ok(route,method);assert.equal(route.handler,`ai.${action}`);assert.deepEqual(route.config.policies,['global::has-active-membership']);assert.deepEqual(route.config.auth,{});
    assert.ok((EXPOSED_ACTIONS as readonly string[]).includes(`api::ai.ai.${action}`));
    const ctx:any={state:{user:{id:7}},query:{projectId:'project1'},request:{body:{data:{projectId:'project1',requestId:'r',confirmedExternalSend:true}}}};
    await (controller as any)[action](ctx);assert.deepEqual(ctx.body,{data:method==='GET'?{configured:false,versions:[]}:{id:'one'}});
    await assert.rejects((controller as any)[action]({...ctx,state:{}}),/Authentication/);
  }
  assert.deepEqual(calls,[[7,'project1'],[7,{projectId:'project1',requestId:'r',confirmedExternalSend:true}]]);
  const path=new URL('../../stitch-wireframe/content-types/stitch-wireframe/schema.json',import.meta.url);
  assert.ok(existsSync(path),'private persistence schema required');
  const schema=JSON.parse(readFileSync(path,'utf8'));
  for(const attr of Object.values(schema.attributes) as any[])assert.equal(attr.private,true);
  assert.ok(schema.indexes.some((i:any)=>i.type==='unique'&&i.columns.includes('request_key')));
  assert.equal((EXPOSED_ACTIONS as readonly string[]).some(a=>a.startsWith('api::stitch-wireframe.')),false);
});

test('existing bootstrap grants gallery actions only to Authenticated via EXPOSED_ACTIONS',async()=>{
  const {bootstrapAccessControl}=await import('../../../utils/bootstrap');
  const old=process.env.JIRA_QA_USER_ID;delete process.env.JIRA_QA_USER_ID;
  let updated:any;
  try {
    await bootstrapAccessControl({db:{query:()=>({findOne:async()=>({id:1,type:'authenticated'})})},service:()=>({find:async()=>[{id:1,type:'authenticated'},{id:2,type:'public'}],findOne:async()=>({name:'Authenticated',description:'Fixture',permissions:{}}),updateRole:async(id:any,value:any)=>{assert.equal(id,1);updated=value;}})} as any);
    for(const action of ['listProjectWireframes','generateProjectWireframe'])assert.equal(updated.permissions['api::ai'].controllers.ai[action].enabled,true);
    assert.equal(updated.permissions['api::stitch-wireframe'],undefined);
  }finally{if(old!==undefined)process.env.JIRA_QA_USER_ID=old;}
});
