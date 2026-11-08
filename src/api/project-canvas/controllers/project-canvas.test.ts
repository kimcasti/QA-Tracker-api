import test from 'node:test';
import assert from 'node:assert/strict';


const state = () => ({ version: 1, nodes: {}, notes: [], newElementColor: 'default' });
async function implementation() {
  const module = await import('./project-canvas').catch(() => null);
  assert.ok(module?.createCanvasController, 'Canvas controller must exist');
  return module.createCanvasController;
}

test('GET returns revision zero without materializing a visual state row', async () => {
  const create = await implementation();
  let writes = 0;
  const strapi: any = {
    documents: () => ({ findOne: async () => ({ id: 1, documentId: 'project1', organization: { id: 2, documentId: 'org1' } }) }),
    db: { query: () => ({ findOne: async () => null, create: () => { writes++; } }) },
  };
  const ctx: any = { state: { user: { id: 1 } }, params: { documentId: 'project1' }, request: {} };
  await create({ strapi, authorize: async () => true }).find(ctx);
  assert.deepEqual(ctx.body, { data: { projectDocumentId: 'project1', revision: 0, state: state() } });
  assert.equal(writes, 0);
});

test('state rejects malformed, oversized, duplicate or prototype-bearing visual payloads', async () => {
  const normalize = await normalizer();
  const invalid = [null, [], { ...state(), secret: 'private' }, { ...state(), version: 2 },
    { ...state(), newElementColor: 'red' }, { ...state(), notes: {} },
    { ...state(), notes: [{id:'same',html:''},{id:'same',html:''}] },
    { ...state(), notes: [{id:'n',html:'x', name:'private'}] },
    { ...state(), notes: [{id:'n',html:'x'.repeat(20001)}] },
    { ...state(), notes: Array.from({length:201},(_,i)=>({id:`n${i}`,html:''})) },
    { ...state(), notes: [{id:'n',html:'x',anchorId:'note:n'}] },
    { ...state(), notes: [{id:'n',html:'x',anchorId:'module:bad/id'}] },
    { ...state(), nodes: {'case:c':{x:0,y:0}} },
    { ...state(), nodes: {'module:m':{x:Infinity,y:0}} },
    { ...state(), nodes: {'module:m':{x:100001,y:0}} },
    { ...state(), nodes: {'module:m':{x:0,y:0,expanded:'yes'}} },
    { ...state(), nodes: {'module:m':{x:0,y:0,secret:'private'}} },
    { ...state(), nodes: {'note:missing':{x:0,y:0}} },
    { ...state(), nodes: JSON.parse('{"__proto__":{"x":0,"y":0}}') },
    Object.assign(Object.create({inherited:'private'}), state()),
  ];
  for (const payload of invalid) assert.throws(() => normalize(payload), /Invalid Canvas/);
  const valid = normalize({ ...state(), nodes: {'module:m':{x:1,y:-2,color:'blue',expanded:false},'note:n':{x:0,y:0}}, notes: [{id:'n',html:'<b>ok</b>'}] });
  assert.equal(valid.nodes['module:m'].expanded, false);
});

function persistenceFixture() {
  let row: any = null;
  let lockTail = Promise.resolve();
  const effects: any[] = [];
  const project = {id:1,documentId:'project1',organization:{id:2,documentId:'org1'}};
  const strapi: any = {
    documents: () => ({findOne: async () => project}),
    db: {
      metadata: {get: () => ({tableName:'projects'})},
      transaction: async (callback) => {
        let unlock: () => void;
        const trx = () => ({where: () => ({forUpdate: () => ({first: async () => {
          const previous = lockTail;
          lockTail = new Promise<void>(resolve => {unlock=resolve;});
          await previous;
          effects.push('lock');
          return project;
        }})})});
        try { return await callback({trx}); } finally { unlock?.(); }
      },
      query: (uid) => {
        assert.equal(uid, 'api::project-canvas.project-canvas', 'visual PUT must not write QA entities');
        return {
          findOne: async () => row && {...structuredClone(row),project:{id:row.project},organization:{id:row.organization}},
          create: async ({data}) => { assert.ok(effects.includes('lock')); effects.push('create'); row={id:3,...data}; return row; },
          updateMany: async ({where,data}) => { if (row?.revision !== where.revision) return {count:0}; effects.push('update');Object.assign(row,data);return {count:1}; },
        };
      },
    },
  };
  const ctx = (revision=0, visual=state()): any => ({state:{user:{id:1}},params:{documentId:'project1'},request:{method:'PUT',body:{data:{revision,state:visual}}}});
  return {strapi,effects,ctx,get row(){return row;}};
}

test('PUT persists independent visual state and returns conflict for stale revisions including concurrent first saves', async () => {
  const create = await implementation();
  const f = persistenceFixture();
  const controller = create({strapi:f.strapi,authorize:async () => true});
  assert.equal(typeof controller.update, 'function', 'Canvas PUT handler must exist');
  const first=f.ctx(), second=f.ctx();
  await Promise.all([controller.update(first),controller.update(second)]);
  assert.deepEqual([first.status ?? 200,second.status ?? 200].sort(), [200,409]);
  const success=first.status===409?second:first;
  assert.deepEqual(success.body.data,{projectDocumentId:'project1',revision:1,state:state()});
  assert.equal(f.effects.filter(e=>e==='create').length,1);
  const changed=f.ctx(1,{...state(),newElementColor:'pink'});
  await controller.update(changed);
  assert.equal(changed.body.data.revision,2);
  const stale=f.ctx(1); await controller.update(stale);
  assert.equal(stale.status,409);
  assert.match(stale.body.error.message,/Reload/);
  assert.equal(f.row.state.newElementColor,'pink');
});

test('PUT rejects malformed envelopes and revisions before any write or transaction', async () => {
  const create = await implementation();
  for (const body of [null, {}, {data:{}}, {data:{revision:-1,state:state()}}, {data:{revision:0.5,state:state()}},
    {data:{revision:Number.MAX_SAFE_INTEGER,state:state()}}, {data:{revision:'0',state:state()}},
    {data:{revision:0,state:state(),organization:'foreign'}}, {data:{revision:0,state:state()},extra:true}]) {
    const f=persistenceFixture();const ctx=f.ctx();ctx.request.body=body;
    await assert.rejects(() => create({strapi:f.strapi,authorize:async()=>true}).update(ctx), /Invalid Canvas/);
    assert.deepEqual(f.effects,[]);
  }
});

test('PUT rejects nodes or anchors outside the exact project and tenant without writes', async () => {
  const create=await implementation();
  for (const record of [null,{documentId:'foreign',project:{documentId:'other'},organization:{documentId:'org1'}},
    {documentId:'foreign',project:{documentId:'project1'},organization:{documentId:'org2'}}]) {
    for (const visual of [{...state(),nodes:{'module:foreign':{x:0,y:0}}},
      {...state(),notes:[{id:'n',html:'<b>ok</b>',anchorId:'case:foreign'}]}]) {
      const f=persistenceFixture();const find=f.strapi.documents;
      f.strapi.documents=(uid)=> uid==='api::project.project'?find(uid):({findOne:async()=>record});
      await assert.rejects(()=>create({strapi:f.strapi,authorize:async()=>true}).update(f.ctx(0,visual as any)),/Canvas reference/);
      assert.equal(f.effects.filter(e=>e==='create'||e==='update').length,0);
    }
  }
  const f=persistenceFixture();const find=f.strapi.documents;
  f.strapi.documents=(uid)=>uid==='api::project.project'?find(uid):({findOne:async({documentId})=>({documentId,project:{documentId:'project1'},organization:{documentId:'org1'}})});
  const ctx=f.ctx(0,{...state(),nodes:{'module:m':{x:0,y:0}},notes:[{id:'n',html:'x',anchorId:'case:c'}]} as any);
  await create({strapi:f.strapi,authorize:async()=>true}).update(ctx);
  assert.equal(ctx.body.data.revision,1);
});

test('GET rejects corrupted stored state and never returns unknown nested metadata', async () => {
  const create=await implementation();
  for (const row of [{revision:1,state:{...state(),secret:'private'}},
    {revision:-1,state:state()}, {revision:1,state:{...state(),notes:[{id:'n',html:'ok',secret:'private'}]}}]) {
    const f=persistenceFixture();f.strapi.db.query=()=>({findOne:async()=>({project:{id:1},organization:{id:2},...row})});
    const ctx=f.ctx();
    await assert.rejects(()=>create({strapi:f.strapi,authorize:async()=>true}).find(ctx), /Invalid Canvas/);
    assert.equal(ctx.body,undefined);
  }
  const f=persistenceFixture();f.strapi.db.query=()=>({findOne:async()=>({revision:1,project:{id:1},organization:{id:2},state:{...state(),notes:[{id:'n',html:'<p onclick=x>ok<script>x</script></p>'}]},secret:'private'})});
  const ctx=f.ctx();await create({strapi:f.strapi,authorize:async()=>true}).find(ctx);
  assert.equal(ctx.body.data.state.notes[0].html,'<p>ok</p>');
  assert.deepEqual(Object.keys(ctx.body.data).sort(),['projectDocumentId','revision','state']);
});

test('Canvas rejects malformed target IDs before querying and bounds revisions to SQL integer storage', async()=>{
  const create=await implementation();
  for(const documentId of [undefined,'','bad/id','a'.repeat(129),12])for(const handler of ['find','update']){
    const f=persistenceFixture();const ctx=f.ctx();ctx.params.documentId=documentId;
    await assert.rejects(()=>create({strapi:f.strapi,authorize:async()=>true})[handler](ctx),/Invalid Canvas/);
    assert.deepEqual(f.effects,[]);
  }
  const f=persistenceFixture();
  await assert.rejects(()=>create({strapi:f.strapi,authorize:async()=>true}).update(f.ctx(2147483647)),/Invalid Canvas/);
  assert.deepEqual(f.effects,[]);
});

test('PUT rechecks tenant and references after acquiring parent lock and aborts before writes on drift',async()=>{
  const create=await implementation();
  for(const drift of ['tenant','reference']){
    const f=persistenceFixture();let locked=false;
    const transaction=f.strapi.db.transaction;
    f.strapi.db.transaction=(callback:any)=>transaction(async({trx}:any)=>callback({trx:(table:string)=>{
      const builder=trx(table);return{where:(where:any)=>({forUpdate:()=>({first:async()=>{const row=await builder.where(where).forUpdate().first();locked=true;return row;}})})};
    }}));
    const documents=f.strapi.documents;
    f.strapi.documents=(uid:string)=>uid==='api::project.project'?{findOne:async()=>locked&&drift==='tenant'?null:documents(uid).findOne()}:({findOne:async({documentId}:any)=>({documentId,project:{documentId:locked&&drift==='reference'?'other':'project1'},organization:{documentId:'org1'}})});
    await assert.rejects(()=>create({strapi:f.strapi,authorize:async()=>true}).update(f.ctx(0,{...state(),nodes:{'module:m':{x:0,y:0}}} as any)),/Project|Canvas reference/);
    assert.equal(f.effects.filter(effect=>['create','update'].includes(effect)).length,0);
  }
});

test('GET refuses a corrupt cross-tenant persistence row despite its matching project key',async()=>{
  const create=await implementation();const f=persistenceFixture();
  f.strapi.db.query=()=>({findOne:async()=>({revision:1,project:{id:1},organization:{id:99},state:state()})});
  const ctx=f.ctx();await assert.rejects(()=>create({strapi:f.strapi,authorize:async()=>true}).find(ctx),/Invalid Canvas/);
  assert.equal(ctx.body,undefined);assert.deepEqual(f.effects,[]);
});

test('PUT rejects corrupt row scope and handles a failed revision CAS without claiming success',async()=>{
  const create=await implementation();
  for(const foreign of [true,false]){
    const f=persistenceFixture();let writes=0;
    f.strapi.db.query=()=>({findOne:async()=>({id:3,revision:1,project:{id:1},organization:{id:foreign?99:2},state:state()}),updateMany:async()=>{writes++;return{count:0};}});
    const ctx=f.ctx(1);
    if(foreign){await assert.rejects(()=>create({strapi:f.strapi,authorize:async()=>true}).update(ctx),/Invalid Canvas/);assert.equal(writes,0);}
    else{await create({strapi:f.strapi,authorize:async()=>true}).update(ctx);assert.equal(ctx.status,409);assert.equal(writes,1);}
  }
});

test('GET preserves syntactically valid stale visual references without hydrating QA data or deleting notes',async()=>{
  const create=await implementation();const f=persistenceFixture();
  const visual={...state(),nodes:{'module:deleted':{x:0,y:0}},notes:[{id:'n',html:'<strong>Keep annotation</strong>',anchorId:'case:deleted'}]};
  f.strapi.db.query=()=>({findOne:async()=>({revision:1,project:{id:1},organization:{id:2},state:visual})});
  const ctx=f.ctx();await create({strapi:f.strapi,authorize:async()=>true}).find(ctx);
  assert.deepEqual(ctx.body.data.state,visual);assert.deepEqual(f.effects,[]);
});

async function normalizer() {
  const m = await import('../services/canvas-state').catch(() => null);
  assert.ok(m?.normalizeCanvasState, 'Canvas state validator must exist');
  return m.normalizeCanvasState;
}
test('visual state preserves basic HTML but strips active markup and unsafe links', async () => {
  const normalize = await normalizer();
  const value = normalize({ ...state(), notes: [{id:'note1',html:'<p onclick=evil()><strong>Hi</strong><script>alert(1)</script><img src=https://evil.invalid><a href=javascript:evil()>bad</a><a href=https://example.invalid/path target=_blank>safe</a><a href=https://user:pass@example.invalid>credentials</a></p>'}] });
  assert.equal(value.notes[0].html, '<p><strong>Hi</strong><a>bad</a><a href="https://example.invalid/path" target="_blank" rel="noopener noreferrer">safe</a><a>credentials</a></p>');
  assert.deepEqual(Object.keys(value).sort(), ['newElementColor','nodes','notes','version']);
});
