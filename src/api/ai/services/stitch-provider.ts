const MCP = 'https://stitch.googleapis.com/mcp';
export type StitchScreen = {screenName:string;title:string;imageDataUrl?:string};
export type StitchResult = {projectName:string;screens:StitchScreen[]};
type Generation = {title:string;prompt:string;onProject:(name:string)=>Promise<void>;onScreen:(screen:StitchScreen)=>Promise<void>};
export function createStitchProvider({apiKey=process.env.STITCH_API_KEY,fetcher=fetch,timeoutMs=300_000}:{apiKey?:string;fetcher?:typeof fetch;timeoutMs?:number}={}) {
  return {
    async generate(input:Generation):Promise<StitchResult> {
      if (!apiKey?.trim()) throw Error('STITCH_NOT_CONFIGURED');
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),Math.min(Math.max(timeoutMs,1),300_000));
      async function request(url:string,init:RequestInit):Promise<Response> {
        const parsed=new URL(url);
        if(parsed.origin!=='https://stitch.googleapis.com' || parsed.username || parsed.password || parsed.hash)throw Error('STITCH_UNSAFE_URL');
        const task=(async()=>{
          const response=await fetcher(url,{...init,redirect:'error',signal:controller.signal});
          if(!response.ok || response.status>=300)throw Error('STITCH_HTTP_ERROR');
          if(Number(response.headers.get('content-length'))>5_500_000)throw Error('STITCH_TOO_LARGE');
          if(!response.body)return new Response(null,{status:response.status,headers:response.headers});
          const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
          try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>5_500_000)throw Error('STITCH_TOO_LARGE');chunks.push(value);}}
          finally {await reader.cancel().catch(()=>{});}
          return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
        })();
        let abort!:()=>void;
        const expired=new Promise<never>((_,reject)=>{abort=()=>reject(Error('STITCH_TIMEOUT'));if(controller.signal.aborted)abort();else controller.signal.addEventListener('abort',abort,{once:true});});
        try{return await Promise.race([task,expired]);}finally{controller.signal.removeEventListener('abort',abort);}
      }
      let sequence=0;
      const headers:Record<string,string>={'Content-Type':'application/json',Accept:'application/json, text/event-stream','X-Goog-Api-Key':apiKey || ''};
      async function rpc(method:string,params:any,notification=false):Promise<any> {
        const id=++sequence;
        const response=await request(MCP,{method:'POST',headers,redirect:'error',body:JSON.stringify({jsonrpc:'2.0',...(!notification?{id}:{}),method,params})});
        if(notification)return;
        const text=await response.text();
        const envelopes=response.headers.get('content-type')?.includes('text/event-stream')?
          text.split(String.fromCharCode(13)).join('').split(/\n\n/).flatMap(event=>{const data=event.split(/\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');return data?[JSON.parse(data)]:[];}):[JSON.parse(text)];
        const envelope=envelopes.find(item=>item.id===id);
        if(!response.ok || !envelope || envelope.error)throw Error('STITCH_PROTOCOL_ERROR');
        return envelope.result;
      }
      async function tool(name:string,args:any):Promise<any> {
        const result=await rpc('tools/call',{name,arguments:args});
        if(result?.isError)throw Error('STITCH_TOOL_ERROR');
        return result.structuredContent || JSON.parse(result.content.find((item:any)=>item.type==='text').text);
      }
      try {
      await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'qa-tracker',version:'1.0.0'}});
      await rpc('notifications/initialized',{},true);
      const created=await tool('create_project',{title:input.title});
      const projectName=created.name;
      if(typeof projectName!=='string' || !/^projects\/[A-Za-z0-9_-]{1,128}$/.test(projectName))throw Error('STITCH_INVALID_PROJECT');
      await input.onProject(projectName);
      const project=await tool('get_project',{name:projectName});
      if(project.name!==projectName || project.visibility!=='PRIVATE')throw Error('STITCH_NOT_PRIVATE');
      const response=await tool('generate_screen_from_text',{projectId:projectName.split('/')[1],prompt:input.prompt,deviceType:'DESKTOP',modelId:'GEMINI_3_5_FLASH_LITE'});
      if(!Array.isArray(response?.outputComponents))throw Error('STITCH_INVALID_SCREEN_COUNT');
      const raw=response.outputComponents.flatMap((component:any)=>component?.design?.screens || []);
      if(!raw.length || raw.length>120)throw Error('STITCH_INVALID_SCREEN_COUNT');
      const unique=new Map<string,StitchScreen>();
      // Validate the complete returned set before checkpointing or downloading any screen.
      for(const screen of raw) {
        const screenName=screen?.name;
        if(typeof screenName!=='string' || !screenName.startsWith(`${projectName}/screens/`) || !/^projects\/[A-Za-z0-9_-]{1,128}\/screens\/[A-Za-z0-9_-]{1,128}$/.test(screenName))throw Error('STITCH_INVALID_SCREEN');
        if(!unique.has(screenName))unique.set(screenName,{screenName,title:typeof screen.title==='string'?screen.title.slice(0,300):'Wireframe lo-fi'});
      }
      const screens=[...unique.values()];
      if(screens.length>12)throw Error('STITCH_INVALID_SCREEN_COUNT');
      for(const screen of screens)await input.onScreen({...screen});
      const verified=[];
      for(const screen of screens) {
        const detail=await tool('get_screen',{name:screen.screenName});
        if(detail.name!==screen.screenName)throw Error('STITCH_FOREIGN_SCREEN');
        verified.push(detail);
      }
      let failure:unknown;
      for(let i=0;i<screens.length;i++) {
        let imageDataUrl:string;
        try {
          const download=await request(verified[i].screenshot.downloadUrl,{headers:{'X-Goog-Api-Key':apiKey || ''},redirect:'error'});
          const image:any=await download.json();
          imageDataUrl=validatedPngDataUrl(image.dataString);
        } catch(error) {failure ||= error;continue;}
        screens[i]={...screens[i],imageDataUrl};
        // A persistence failure stops work: never download past an unverified checkpoint.
        await input.onScreen({...screens[i]});
      }
      if(failure)throw failure;
      if(screens.length<2)throw Error('STITCH_INCOMPLETE_FLOW');
      return {projectName,screens};
      } finally {clearTimeout(timer);}
    },
  };
}

export function validatedPngDataUrl(value:unknown):string {
  if(typeof value!=='string' || value.length>3_999_978 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length%4!==0)throw Error('STITCH_INVALID_IMAGE');
  const bytes=Buffer.from(value,'base64');
  if(bytes.toString('base64')!==value || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('STITCH_INVALID_IMAGE');
  return `data:image/png;base64,${value}`;
}
