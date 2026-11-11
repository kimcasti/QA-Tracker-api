import test from 'node:test';
import assert from 'node:assert/strict';
import createAiService from './ai';
import controller from '../controllers/ai';

test('brief controller preserves explicit reviewed conclusions and rejects coercion',async()=>{
  let payload:any;
  (globalThis as any).strapi={service:()=>({generateProjectWireframeBrief:async(_user:any,value:any)=>{payload=value;return 'brief';}})};
  const ctx:any={state:{user:{id:7}},request:{body:{data:{projectId:'project1',name:'Reserva',confirmedConclusions:['Aprobación'],aiProjectInsights:'Unreviewed'}}}};
  await controller.generateProjectWireframeBrief(ctx);
  assert.deepEqual(payload.input.confirmedConclusions,['Aprobación']);
  assert.equal(payload.input.aiProjectInsights,'Unreviewed');
  ctx.request.body.data.confirmedConclusions=[7];
  await assert.rejects(controller.generateProjectWireframeBrief(ctx),/Invalid wireframe/);
});

test('real brief service uses persisted analysis as pending and tenant role/scope before outbound',async t=>{
  const keys=['GEMINI_API_KEY','VITE_GEMINI_API_KEY','GROQ_API_KEY','VITE_GROQ_API_KEY'];
  const old=keys.map(k=>process.env[k]);keys.forEach(k=>delete process.env[k]);process.env.GROQ_API_KEY='synthetic';
  t.after(()=>keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];}));
  let role='owner',org='org1',assigned=true,charges=0;
  const project={documentId:'project1',organization:{documentId:'org1'},aiProjectInsights:'Persisted hypothesis: payment provider'};
  (globalThis as any).strapi={
    documents:(uid:string)=>({findMany:async()=>uid.includes('membership')?[{documentId:'m',isActive:true,organization:{documentId:org},organizationRole:{code:role}}]:assigned?[{workspaceProjectDocumentIds:['project1']}]:[],findOne:async()=>project}),
    db:{query:()=>({findOne:async()=>({email:'fixture@example.invalid'})})},
    service:()=>({authorizeAi:async()=>{},consumeAiUsage:async()=>{charges++;}}),
  };
  const prompts:string[]=[];
  t.mock.method(globalThis,'fetch',async(_url:any,init:any)=>{prompts.push(JSON.parse(init.body).messages.map((m:any)=>m.content).join('\n'));return new Response(JSON.stringify({choices:[{message:{content:'brief'}}]}));});
  const service=createAiService();
  const input:any={projectId:'project1',input:{name:'Reserva',confirmedConclusions:['Approval explicitly reviewed'],aiProjectInsights:'Spoofed analysis'}};
  assert.equal(await service.generateProjectWireframeBrief(7,input),'brief');
  assert.match(prompts[0],/CONFIRMADAS[\s\S]*Approval explicitly reviewed/);
  assert.match(prompts[0],/NO CONFIRMADO[\s\S]*Persisted hypothesis/);
  assert.doesNotMatch(prompts[0],/Spoofed analysis/);assert.match(prompts[0],/LOFI OBLIGATORIO/);assert.equal(charges,1);
  for(const variant of ['viewer','foreign','unassigned']){
    role=variant==='viewer'?'viewer':variant==='unassigned'?'manager':'owner';org=variant==='foreign'?'foreign':'org1';assigned=variant!=='unassigned';
    await assert.rejects(service.generateProjectWireframeBrief(7,input),()=>true,variant);assert.equal(prompts.length,1);assert.equal(charges,1);
  }
});
