import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import tenantAccess from '../../../policies/tenant-access';
import { EXPOSED_ACTIONS, MANAGE_ROLES, READ_ROLES } from '../../../utils/access';
import { createCanvasController } from '../controllers/project-canvas';

async function routes() {
  const module=await import('./project-canvas').catch(()=>null);
  assert.ok(module?.default,'Canvas custom routes must exist');
  return module.default.routes;
}

test('Canvas exposes only authenticated project GET/PUT with target-project tenant policies and registered actions',async()=>{
  const definitions=await routes();
  assert.deepEqual(definitions.map(route=>[route.method,route.path,route.handler]),[
    ['GET','/projects/:documentId/canvas','project-canvas.find'],
    ['PUT','/projects/:documentId/canvas','project-canvas.update'],
  ]);
  for(const route of definitions){
    assert.notEqual(route.config.auth,false);
    assert.deepEqual(route.config.policies,[{name:'global::tenant-access',config:{contentTypeUid:'api::project.project',allowedRoles:route.method==='GET'?READ_ROLES:MANAGE_ROLES}}]);
    assert.ok((EXPOSED_ACTIONS as readonly string[]).includes(`api::project-canvas.${route.handler}`));
  }
  assert.deepEqual(readdirSync(resolve('src/api/project-canvas/routes')).filter(name=>!name.endsWith('.test.ts')),['project-canvas.ts']);
});

test('Canvas schema is a separate metadata-only row with a unique project key and no draft variants',()=>{
  const path=resolve('src/api/project-canvas/content-types/project-canvas/schema.json');
  let schema:any;try{schema=JSON.parse(readFileSync(path,'utf8'));}catch{}
  assert.ok(schema,'Canvas persistence schema must exist');
  assert.equal(schema.options.draftAndPublish,false);
  assert.deepEqual(Object.keys(schema.attributes).sort(),['organization','project','projectKey','revision','state']);
  assert.equal(schema.attributes.projectKey.unique,true);
  assert.equal(schema.attributes.projectKey.required,true);
  assert.equal(schema.attributes.state.type,'json');
  assert.equal(schema.attributes.project.target,'api::project.project');
  assert.equal(schema.attributes.organization.target,'api::organization.organization');
  const manifest=JSON.parse(readFileSync(resolve('package.json'),'utf8'));
  assert.equal(manifest.dependencies['sanitize-html'],'2.13.0','Parser sanitizer must be a direct, lockfile-pinned production dependency');
});

// Real configured route + real policy + real controller; only persistence boundaries are faked.
test('Canvas route pipeline binds roles to target tenant and applies assigned-project restrictions with zero denied effects',async()=>{
  const definitions=await routes();
  for(const method of ['GET','PUT'])for(const scenario of ['owner','viewer','otherTenantOwner','crossTenant','restricted','assigned','anonymous']){
    const writes:any[]=[];
    const project={id:1,documentId:'project1',organization:{id:2,documentId:'org1'}};
    const role=scenario==='viewer'||scenario==='otherTenantOwner'?'viewer':scenario==='restricted'||scenario==='assigned'?'manager':'owner';
    const memberships=[{documentId:'member1',organization:scenario==='crossTenant'?{id:99,documentId:'org2'}:project.organization,organizationRole:{code:role}},
      ...(scenario==='otherTenantOwner'?[{documentId:'member2',organization:{documentId:'org2'},organizationRole:{code:'owner'}}]:[])];
    const strapi:any={documents:(uid)=>{
      if(uid==='api::organization-membership.organization-membership')return{findMany:async()=>memberships};
      if(uid==='api::organization-invitation.organization-invitation')return{findMany:async()=>[{organization:project.organization,workspaceProjectDocumentIds:scenario==='restricted'?['other']:['project1'],restrictProjectAccess:true}]};
      if(uid==='api::project.project')return{findOne:async()=>project};
      throw Error(`Unexpected documents ${uid}`);
    },db:{metadata:{get:()=>({tableName:'projects'})},transaction:async(callback)=>callback({trx:()=>({where:()=>({forUpdate:()=>({first:async()=>project})})})}),query:(uid:string)=>uid==='plugin::users-permissions.user'?({findOne:async()=>({email:'canvas@example.invalid'})}):({findOne:async()=>null,create:async({data}:any)=>{writes.push(data);return data;}})}};
    const ctx:any={state:scenario==='anonymous'?{}:{user:{id:1}},params:{documentId:'project1'},request:{method,body:{data:{revision:0,state:{version:1,nodes:{},notes:[],newElementColor:'default'}}}}};
    const route=definitions.find(route=>route.method===method)!;
    const invoke=async()=>{
      await tenantAccess(ctx,route.config.policies[0].config,{strapi});
      await createCanvasController({strapi})[method==='GET'?'find':'update'](ctx);
    };
    const denied=scenario==='anonymous'||scenario==='restricted'||scenario==='crossTenant'||method==='PUT'&&['viewer','otherTenantOwner'].includes(scenario);
    if(denied){await assert.rejects(invoke,/Authentication|role|assigned|Cross/);assert.equal(writes.length,0);assert.equal(ctx.body,undefined);}
    else{await invoke();assert.equal(ctx.body.data.projectDocumentId,'project1');assert.equal(writes.length,method==='PUT'?1:0);}
  }
});
