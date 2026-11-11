import test from 'node:test';
import assert from 'node:assert/strict';
import { createTenantAccessPolicy } from '../../../policies/tenant-access';
const requestId = '00000000-0000-4000-8000-000000000001';
function fixture() {
  const f = { role: 'owner', organization: 'org1', assigned: true, writes: 0, outbound: 0, charges: 0, failCreate: false, rows: [] as any[], jobs: [] as (() => Promise<void>)[], project: {id:1,documentId:'project1',name:'Reservas',aiWireframeBrief:'Una reserva con aprobación',organization:{id:2,documentId:'org1'}} };
  const authorize = createTenantAccessPolicy({
    getUserMemberships: async () => [{organization:{documentId:f.organization},organizationRole:{code:f.role}}],
    getAllowedOrganizationDocumentIds: () => [f.organization], getAllowedAccessRoleCodes: () => [f.role],
    getUserMembershipAccessError: async () => 'denied',
    getUserProjectAccessScope: async () => ({ restrictedOrganizationDocumentIds:['org1'],unrestrictedOrganizationDocumentIds:[],allowedProjectDocumentIds:f.assigned?['project1']:[] }),
    getOrganizationDocumentIdFromEntity: async () => 'org1', getProjectDocumentIdFromEntity: async () => 'project1',
    getOrganizationDocumentIdFromPayload: async () => null, getProjectDocumentIdFromPayload: async () => null,
  } as any);
  const match = (row, where) => Object.entries(where || {}).every(([k,v]) => row[k] === v);
  const repository = {
    findMany: async ({where}) => structuredClone(f.rows.filter(row=>match(row,where))),
    findOne: async ({where}) => structuredClone(f.rows.find(row=>match(row,where)) || null),
    create: async ({data}) => {f.writes++;if(f.failCreate)throw Error('save failed');if(data.activeKey && f.rows.some(row=>row.activeKey===data.activeKey))throw Error('unique active claim');if(f.rows.some(row=>row.requestKey===data.requestKey&&row.projectKey===data.projectKey&&row.organizationKey===data.organizationKey))throw Error('unique request');const row={id:f.rows.length+1,...structuredClone(data)};f.rows.push(row);return structuredClone(row);},
    update: async ({where,data}) => {f.writes++;const row=f.rows.find(row=>match(row,where));Object.assign(row,structuredClone(data));return structuredClone(row);},
  };
  const strapi:any = {documents:()=>({findOne:async()=>structuredClone(f.project)}),db:{query:()=>repository},service:()=>({authorizeAi:async()=>true,consumeAiUsage:async()=>{f.charges++;}})};
  return {f,strapi,authorize,options:{strapi,authorize,configured:()=>true,schedule:(job)=>{f.jobs.push(job);},provider:()=>({generate:async(input:any)=>{f.outbound++;await input.onProject('projects/123');const screens=[{screenName:'projects/123/screens/abc',title:'Reserva',imageDataUrl:png},{screenName:'projects/123/screens/done',title:'Confirmación',imageDataUrl:png}];for(const screen of screens)await input.onScreen(screen);return {projectName:'projects/123',screens};}})}};
}
const png='data:image/png;base64,iVBORw0KGgo=';

test('one click durably saves pending before outbound; double clicks replay and one job completes one coherent screen set', async()=>{
  const create=await implementation();const {f,options}=fixture();const service=create(options);
  assert.equal(typeof service.generate,'function');
  const [first,replay]=await Promise.all([service.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId}),service.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId})]);
  assert.deepEqual(first,replay);assert.equal(first.status,'generating');assert.equal(f.rows.length,1);assert.equal(f.jobs.length,1);assert.equal(f.outbound,0);
  await f.jobs.shift()!();
  const result=await service.list(7,'project1');
  assert.equal(result.versions[0].status,'completed');assert.equal(result.versions[0].screens.length,2);
  assert.equal(result.versions[0].screens[0].imageDataUrl,png);assert.equal(result.versions[0].stitchUrl,'https://stitch.withgoogle.com/projects/123');
  assert.equal(f.outbound,1);assert.equal(f.charges,1);
  const completed=await service.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId});assert.equal(completed.status,'completed');assert.equal(f.jobs.length,0);
});
test('uncertain accounting retains the durable claim and artifact without replaying generation or charging again',async()=>{
  const create=await implementation();const {f,options,strapi}=fixture();const service=create(options);
  let failCharge!:(error:Error)=>void;let charging!:()=>void;
  const started=new Promise<void>(resolve=>{charging=resolve;});
  const charge=new Promise<void>((_,reject)=>{failCharge=reject;});
  strapi.service=()=>({authorizeAi:async()=>true,consumeAiUsage:async()=>{f.charges++;charging();await charge;}});
  await service.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId});
  const job=f.jobs.shift()!();await started;
  try {
    assert.equal(f.rows[0].activeKey,'org1:project1');
    assert.equal(f.rows[0].status,'generating');
    assert.equal(f.rows[0].metadata.accountingStatus,'pending');
    assert.equal(f.rows[0].metadata.screens[0].imageDataUrl,png);
    await assert.rejects(service.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId:'00000000-0000-4000-8000-000000000002'}),/pending|uncertain/i);
  } finally {failCharge(Error('unknown charge outcome'));await job;}
  assert.equal(f.rows[0].activeKey,'org1:project1');
  assert.equal(f.rows[0].status,'partial');
  assert.equal(f.rows[0].metadata.accountingStatus,'uncertain');
  assert.equal(f.rows[0].metadata.screens[0].imageDataUrl,png);
  for(const current of [service,create(options)]) {
    const version=(await current.list(7,'project1')).versions[0];
    assert.equal(version.status,'partial');assert.equal(version.screens[0].imageDataUrl,png);
    assert.doesNotMatch(JSON.stringify(version),/accountingStatus|metadata|unknown charge outcome/);
    assert.deepEqual(await current.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId}),version);
    await assert.rejects(current.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId:'00000000-0000-4000-8000-000000000002'}),/pending|uncertain/i);
  }
  assert.equal(f.outbound,1);assert.equal(f.charges,1);assert.equal(f.jobs.length,0);assert.equal(f.rows.length,1);
});
async function implementation(){const module=await import('./wireframes').catch(()=>null);assert.ok(module?.createWireframesService,'wireframe service must exist');return module.createWireframesService;}

test('generation rejects Viewer, foreign scope, missing consent, malformed UUID, empty brief and failed pending save with zero outbound', async()=>{
  const create=await implementation();
  for(const change of ['viewer','foreign','unassigned','consent','uuid','empty','oversize','save','unconfigured','plan']) {
    const {f,options,strapi}=fixture();const input:any={projectId:'project1',confirmedExternalSend:true,requestId};
    if(change==='viewer')f.role='viewer';if(change==='foreign')f.organization='foreign';if(change==='unassigned')f.assigned=false;
    if(change==='consent')input.confirmedExternalSend=false;if(change==='uuid')input.requestId='../bad';
    if(change==='empty')f.project.aiWireframeBrief=' ';if(change==='oversize')f.project.aiWireframeBrief='x'.repeat(30001);
    if(change==='save')f.failCreate=true;if(change==='unconfigured')options.configured=()=>false;
    if(change==='plan')strapi.service=()=>({authorizeAi:async()=>{throw Error('plan denied');}});
    await assert.rejects(create(options).generate(7,input),()=>true,change);
    assert.equal(f.jobs.length,0,change);assert.equal(f.outbound,0,change);assert.equal(f.charges,0,change);
    if(change!=='save')assert.equal(f.writes,0,change);
  }
});

test('pending and uncertain outcomes block new request IDs; restart never replays; provider failure preserves older versions',async()=>{
  const create=await implementation();const {f,options}=fixture();const service=create(options);
  await service.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId});
  await assert.rejects(service.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId:'00000000-0000-4000-8000-000000000002'}),/pending|uncertain/i);
  const restarted=create(options);const snapshot=await restarted.list(7,'project1');assert.equal(snapshot.versions[0].status,'uncertain');
  assert.equal((await restarted.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId})).status,'uncertain');assert.equal(f.jobs.length,1);
  const other=fixture();other.options.provider=()=>({generate:async()=>{throw Error('secret provider key');}}) as any;
  other.f.rows.push({id:10,requestKey:'older',projectKey:'project1',organizationKey:'org1',startedAt:'2026-01-01T00:00:00.000Z',status:'completed',metadata:{projectName:'projects/123',screenName:'projects/123/screens/old',title:'Old'},imageDataUrl:png});
  const failing=create(other.options);await failing.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId});await other.f.jobs.shift()!();
  const versions=(await failing.list(7,'project1')).versions;
  assert.equal(versions.find(row=>row.id===requestId)!.status,'uncertain');assert.equal(versions.find(row=>row.id==='older')!.screens[0].imageDataUrl,png);
  assert.doesNotMatch(JSON.stringify(versions),/secret provider key|ownerRun|metadata/);
});

test('Viewer reads private history without entitlement; foreign and unassigned callers cannot read storage', async()=>{
  const create=await implementation();const {f,options}=fixture();const service=create(options);
  f.role='viewer';
  assert.deepEqual(await service.list(7,'project1'),{configured:true,versions:[]});
  assert.equal(f.writes,0);assert.equal(f.outbound,0);
  f.organization='foreign';await assert.rejects(service.list(7,'project1'),/Cross-organization/);
  f.organization='org1';f.assigned=false;await assert.rejects(service.list(7,'project1'),/not assigned/);
});

test('separate workers race for a durable exclusive claim before any external mutation',async()=>{
  const create=await implementation();const {f,options}=fixture();
  const outcomes=await Promise.allSettled([create(options).generate(7,{projectId:'project1',confirmedExternalSend:true,requestId}),create(options).generate(7,{projectId:'project1',confirmedExternalSend:true,requestId:'00000000-0000-4000-8000-000000000002'})]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows.length,1);assert.equal(f.jobs.length,1);
  assert.equal(f.rows[0].activeKey,'org1:project1');
  await f.jobs[0]();assert.equal(f.rows[0].activeKey,null);assert.equal(f.rows[0].status,'completed');
});

test('untrusted stored metadata cannot expose foreign links, arbitrary URLs, HTML or oversized images',async()=>{
  const create=await implementation();const {f,options}=fixture();
  f.rows.push({id:1,requestKey:requestId,projectKey:'project1',organizationKey:'org1',status:'completed',startedAt:'2026-01-01',metadata:{projectName:'https://evil.invalid',screenName:'projects/foreign/screens/a',title:{private:'secret'}},imageDataUrl:'data:text/html,<script>bad</script>'});
  const versions=(await create(options).list(7,'project1')).versions;
  assert.equal(versions[0].stitchUrl,undefined);assert.deepEqual(versions[0].screens,[]);
});

test('default product provider actually attempts MCP once without requiring an injected provider',async t=>{
  const create=await implementation();const {f,options}=fixture();
  const key=process.env.STITCH_API_KEY;process.env.STITCH_API_KEY='synthetic-test-key';t.after(()=>{if(key===undefined)delete process.env.STITCH_API_KEY;else process.env.STITCH_API_KEY=key;});
  let calls=0;t.mock.method(globalThis,'fetch',async(url:any)=>{assert.equal(url,'https://stitch.googleapis.com/mcp');calls++;throw Error('offline unknown outcome');});
  const {provider,...realOptions}=options;
  const service=create(realOptions);await service.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId});await f.jobs[0]();
  assert.equal(calls,1);assert.equal((await service.list(7,'project1')).versions[0].status,'uncertain');assert.equal(f.charges,0);
});


test('a later download failure retains ordered IDs and earlier images durably, including after restart, without another charge',async()=>{
 const create=await implementation();const {f,options}=fixture();let calls=0;
 f.project.aiWireframeBrief='## Objetivo del wireframe\nReservar\n## Flujo recomendado entre escenas\nInicio → Reserva → Confirmación\nVolver conserva el borrador.\n## Supuestos y preguntas pendientes\nNo confirmado';
 options.provider=()=>({generate:async(input:any)=>{
  calls++;await input.onProject('projects/123');
  await input.onScreen({screenName:'projects/123/screens/a',title:'Inicio'});
  await input.onScreen({screenName:'projects/123/screens/b',title:'Reserva'});
  await input.onScreen({screenName:'projects/123/screens/a',title:'Inicio',imageDataUrl:png});
  assert.equal(f.rows[0].metadata.screens.length,2);assert.equal(f.rows[0].metadata.screens[0].imageDataUrl,png);
  throw Error('second download failed');
 }}) as any;
 const service=create(options);await service.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId});await f.jobs.shift()!();
 const restarted=create(options);const version=(await restarted.list(7,'project1')).versions[0];
 assert.equal(version.status,'partial');assert.equal(version.flowSummary,'Inicio → Reserva → Confirmación\nVolver conserva el borrador.');
 assert.deepEqual(version.screens,[{id:'projects/123/screens/a',title:'Inicio',imageDataUrl:png},{id:'projects/123/screens/b',title:'Reserva'}]);
 assert.equal(f.rows[0].activeKey,'org1:project1');
 await restarted.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId});
 await assert.rejects(restarted.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId:'00000000-0000-4000-8000-000000000002'}),/pending|uncertain/i);
 assert.equal(calls,1);assert.equal(f.charges,0);assert.equal(f.jobs.length,0);
});
test('new nested DTOs allowlist every screen and keep legacy one-screen versions readable',async()=>{
 const create=await implementation();const {f,options}=fixture();
 const base={projectKey:'project1',organizationKey:'org1',status:'completed',startedAt:'2026-01-01',imageDataUrl:png};
 f.rows.push({...base,id:1,requestKey:'old',metadata:{projectName:'projects/123',screenName:'projects/123/screens/old',title:'Anterior'}});
 f.rows.push({...base,id:2,requestKey:'new',metadata:{projectName:'projects/123',flowSummary:'Inicio → Fin',secret:'hidden',screens:[{screenName:'projects/123/screens/a',title:'Inicio',imageDataUrl:png,secret:'hidden'},{screenName:'projects/999/screens/foreign',title:'Foreign',imageDataUrl:png},{screenName:'projects/123/screens/b',title:'Fin',imageDataUrl:'data:text/html,bad'},{screenName:'projects/123/screens/a',title:'Duplicate'},null]}});
 const versions=(await create(options).list(7,'project1')).versions;
 assert.deepEqual(versions[0].screens,[{id:'projects/123/screens/old',title:'Anterior',imageDataUrl:png}]);
 assert.equal(versions[1].flowSummary,'Inicio → Fin');assert.deepEqual(versions[1].screens,[{id:'projects/123/screens/a',title:'Inicio',imageDataUrl:png},{id:'projects/123/screens/b',title:'Fin'}]);
 assert.doesNotMatch(JSON.stringify(versions),/hidden|Foreign|data:text|Duplicate/);
});


test('real adapter checkpoints a three-screen set through service persistence when its second image fails',async()=>{
 const {createStitchProvider}=await import('./stitch-provider');const create=await implementation();const {f,options}=fixture();
 let generations=0,downloads=0;
 const names=['a','b','c'].map(id=>`projects/123/screens/${id}`);
 const fetcher=async(url:any,init:any)=>{
  if(url.startsWith('https://stitch.googleapis.com/download/')) {
   downloads++;assert.equal(f.rows[0].metadata.screens.length,3);
   if(downloads===2){assert.equal(f.rows[0].metadata.screens[0].imageDataUrl,png);throw Error('synthetic partial download');}
   return new Response(JSON.stringify({dataString:png.slice(22)}));
  }
  assert.equal(url,'https://stitch.googleapis.com/mcp');const body=JSON.parse(init.body);
  if(body.method==='notifications/initialized')return new Response(null,{status:202});
  let data:any={};const tool=body.params?.name;
  if(tool==='create_project'||tool==='get_project')data={name:'projects/123',visibility:'PRIVATE'};
  if(tool==='generate_screen_from_text') {
   generations++;assert.match(body.params.arguments.prompt,/ONE coherent end-to-end/);assert.match(body.params.arguments.prompt,/validación inline/);
   data={outputComponents:[{design:{screens:names.map((name,i)=>({name,title:`Paso ${i+1}`}))}}]};
  }
  if(tool==='get_screen')data={name:body.params.arguments.name,screenshot:{downloadUrl:`https://stitch.googleapis.com/download/${body.params.arguments.name.split('/').pop()}`}};
  return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{structuredContent:data}}));
 };
 options.provider=()=>createStitchProvider({apiKey:'synthetic-test-key',fetcher:fetcher as any}) as any;
 const service=create(options);await service.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId});await f.jobs.shift()!();
 const restarted=create(options);const version=(await restarted.list(7,'project1')).versions[0];
 assert.equal(version.status,'partial');assert.deepEqual(version.screens.map((s:any)=>s.id),names);
 assert.deepEqual(version.screens.map((s:any)=>Boolean(s.imageDataUrl)),[true,false,true]);
 await restarted.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId});
 await assert.rejects(restarted.generate(7,{projectId:'project1',confirmedExternalSend:true,requestId:'00000000-0000-4000-8000-000000000002'}),/pending|uncertain/i);
 assert.equal(generations,1);assert.equal(downloads,3);assert.equal(f.charges,0);assert.equal(f.rows[0].activeKey,'org1:project1');
});
