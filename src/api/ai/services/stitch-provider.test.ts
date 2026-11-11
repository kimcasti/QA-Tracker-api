import test from 'node:test';
import assert from 'node:assert/strict';
const file='https://stitch.googleapis.com/v1/projects/123/files/abcdef:download';
const png='iVBORw0KGgo=';
async function implementation(){const m=await import('./stitch-provider').catch(()=>null);assert.ok(m?.createStitchProvider,'bounded Stitch adapter must exist');return m;}
function transport(sse=false, mutate:(data:any,name:string)=>any=(data)=>data) {
  const calls:any[]=[];
  const fetcher=async(url:any,init:any)=>{
    calls.push({url,init});assert.equal(init.redirect,'error');assert.equal(init.headers['X-Goog-Api-Key'],'synthetic-test-key');
    if(url===file)return new Response(JSON.stringify({dataString:png}));
    assert.equal(url,'https://stitch.googleapis.com/mcp');
    const body=JSON.parse(init.body);if(body.method==='notifications/initialized')return new Response(null,{status:202});
    let result:any={protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'test',version:'1'}};
    if(body.method==='tools/call') {
      const name=body.params.name;
      const data:any=name==='create_project'||name==='get_project'?{name:'projects/123',visibility:'PRIVATE'}:
        name==='generate_screen_from_text'?{outputComponents:[{design:{screens:[{name:'projects/123/screens/abc',title:'Reserva',screenshot:{downloadUrl:file}},{name:'projects/123/screens/done',title:'Confirmación'}]}}]}:
        {name:body.params.arguments.name,title:'Reserva',screenshot:{downloadUrl:file}};
      result={content:[{type:'text',text:JSON.stringify(mutate(data,name))}]};
    }
    const response={jsonrpc:'2.0',id:body.id,result};
    return new Response(sse?`event: message\ndata: ${JSON.stringify(response)}\n\n`:JSON.stringify(response),{headers:{'Content-Type':sse?'text/event-stream':'application/json'}});
  };
  return {calls,fetcher};
}
test('MCP JSON and SSE initialize then generate exactly once, verify private project and screen, and download PNG only',async()=>{
  const {createStitchProvider}=await implementation();
  for(const sse of [false,true]) {
    const {calls,fetcher}=transport(sse);const checkpoints:string[]=[];
    const result=await createStitchProvider({apiKey:'synthetic-test-key',fetcher:fetcher as any}).generate({title:'Synthetic',prompt:'ONE screen grayscale',onProject:async name=>{checkpoints.push(name);},onScreen:async screen=>{checkpoints.push(screen.screenName);}});
    assert.equal(result.screens[0].imageDataUrl,`data:image/png;base64,${png}`);assert.deepEqual(checkpoints,['projects/123','projects/123/screens/abc','projects/123/screens/done','projects/123/screens/abc','projects/123/screens/done']);
    const tools=calls.filter(call=>call.init.body).map(call=>JSON.parse(call.init.body)).filter(body=>body.method==='tools/call');
    assert.deepEqual(tools.map(body=>body.params.name),['create_project','get_project','generate_screen_from_text','get_screen','get_screen']);
    assert.deepEqual(tools[2].params.arguments,{projectId:'123',prompt:'ONE screen grayscale',deviceType:'DESKTOP',modelId:'GEMINI_3_5_FLASH_LITE'});
    assert.equal(calls.filter(call=>call.url===file).length,2);
  }
});

const input={title:'Synthetic',prompt:'ONE screen',onProject:async()=>{},onScreen:async()=>{}};
test('hostile download destinations, public/foreign resources, corrupt or oversized image data fail closed',async()=>{
  const {createStitchProvider}=await implementation();
  for(const variant of ['foreign-url','credentials','http','public','foreign-project','foreign-screen','many','bad-base64','html','oversize','redirect','stream-limit']) {
    const {calls,fetcher:base}=transport(false,(data,name)=>{
      if(variant==='public'&&name==='get_project')data.visibility='PUBLIC';
      if(variant==='foreign-project'&&name==='get_project')data.name='projects/999';
      if(variant==='foreign-screen'&&name==='get_screen')data.name='projects/999/screens/abc';
      if(variant==='many'&&name==='generate_screen_from_text')data.outputComponents[0].design.screens=Array.from({length:13},(_,i)=>({name:`projects/123/screens/s${i}`}));
      if(name==='get_screen') {
        if(variant==='foreign-url')data.screenshot.downloadUrl='https://evil.invalid/image';
        if(variant==='credentials')data.screenshot.downloadUrl='https://user:pass@stitch.googleapis.com/image';
        if(variant==='http')data.screenshot.downloadUrl='http://stitch.googleapis.com/image';
      }
      return data;
    });
    const fetcher=async(url:any,init:any)=>{
      if(url===file) {
        if(variant==='bad-base64')return new Response(JSON.stringify({dataString:'!!!'}));
        if(variant==='html')return new Response(JSON.stringify({dataString:Buffer.from('<html>bad</html>').toString('base64')}));
        if(variant==='oversize')return new Response(JSON.stringify({dataString:'A'.repeat(4_000_001)}));
        if(variant==='redirect')return new Response(null,{status:302,headers:{Location:'https://evil.invalid/image'}});
        if(variant==='stream-limit')return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(6_000_001));c.close();}}));
      }
      return base(url,init);
    };
    await assert.rejects(createStitchProvider({apiKey:'synthetic-test-key',fetcher:fetcher as any}).generate(input),()=>true,variant);
    assert.equal(calls.some(c=>new URL(c.url).hostname==='evil.invalid'),false,variant);
  }
});

test('a stalled download body is aborted by the single generation deadline without replay',async()=>{
  const {createStitchProvider}=await implementation();const {fetcher:base}=transport();let generations=0;
  const fetcher=async(url:any,init:any)=>{
    if(url===file)return new Response(new ReadableStream({start(){},cancel(){}}));
    if(init.body && JSON.parse(init.body).params?.name==='generate_screen_from_text')generations++;
    return base(url,init);
  };
  const started=Date.now();
  await assert.rejects(createStitchProvider({apiKey:'synthetic-test-key',fetcher:fetcher as any,timeoutMs:100}).generate(input),/TIMEOUT/);
  assert.ok(Date.now()-started<2000);assert.equal(generations,1);
});

test('all unique generated IDs are checkpointed before downloads; partial artifacts survive a later download failure',async()=>{
 const {createStitchProvider}=await implementation();const events:any[]=[];let downloads=0;
 const {calls,fetcher:base}=transport(false,(data,name)=>{if(name==='generate_screen_from_text')data.outputComponents.push(data.outputComponents[0]);return data;});
 const fetcher=async(url:any,init:any)=>{if(url===file){downloads++;assert.equal(events.filter(e=>!e.imageDataUrl).length,2);if(downloads===2)throw Error('download lost');}return base(url,init);};
 await assert.rejects(createStitchProvider({apiKey:'synthetic-test-key',fetcher:fetcher as any}).generate({...input,onScreen:async screen=>{events.push(screen);}}),/download lost/);
 assert.deepEqual(events.map(e=>[e.screenName,Boolean(e.imageDataUrl)]),[['projects/123/screens/abc',false],['projects/123/screens/done',false],['projects/123/screens/abc',true]]);
 assert.equal(calls.filter(c=>c.init.body&&JSON.parse(c.init.body).params?.name==='generate_screen_from_text').length,1);
});
test('a single screen is incomplete but its identifier and downloaded artifact remain available for reconciliation',async()=>{
 const {createStitchProvider}=await implementation();const events:any[]=[];
 const {fetcher}=transport(false,(data,name)=>{if(name==='generate_screen_from_text')data.outputComponents[0].design.screens.length=1;return data;});
 await assert.rejects(createStitchProvider({apiKey:'synthetic-test-key',fetcher:fetcher as any}).generate({...input,onScreen:async screen=>{events.push(screen);}}),/INCOMPLETE_FLOW/);
 assert.equal(events.length,2);assert.equal(events[1].imageDataUrl,`data:image/png;base64,${png}`);
});
test('a foreign generated ID is rejected before any artifact download or screen checkpoint',async()=>{
 const {createStitchProvider}=await implementation();let checkpoints=0;
 const {calls,fetcher}=transport(false,(data,name)=>{if(name==='generate_screen_from_text')data.outputComponents[0].design.screens[1].name='projects/999/screens/foreign';return data;});
 await assert.rejects(createStitchProvider({apiKey:'synthetic-test-key',fetcher:fetcher as any}).generate({...input,onScreen:async()=>{checkpoints++;}}),/INVALID_SCREEN/);
 assert.equal(checkpoints,0);assert.equal(calls.filter(c=>c.url===file).length,0);
});
