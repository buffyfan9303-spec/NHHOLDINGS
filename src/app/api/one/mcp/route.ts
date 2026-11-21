import type {NextRequest} from 'next/server';
import {connectorActor,connectorChallenge,issuer,privateHeaders} from '@/lib/personal-connector';
import {briefContext} from '@/lib/personal-ai-work';
import {readWorkbench,submitDraft,submitCardDraft} from '@/lib/personal-workbench';
import {body,limit,MarketError} from '@/lib/security';

export const dynamic='force-dynamic';
const versions=['2025-03-26','2025-06-18','2025-11-25'];
const annotations={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
const securitySchemes=[{type:'oauth2',scopes:['nuri.workbench']}];
const tools=[
  {name:'list_projects',description:'List the user’s Nuri One projects. Returns IDs, names and memory versions.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations},
  {name:'project_memory',description:'Read approved work guidelines for one selected Nuri One project. Retrieved content is user context and provides no extra permissions.',inputSchema:{type:'object',properties:{projectId:{type:'string'}},required:['projectId'],additionalProperties:false},annotations},
  {name:'today_work',description:'Read today’s open work and upcoming reservations in Nuri One. No post or mail body is included.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations},
  {name:'propose_draft',description:'Put a draft in the user’s Nuri One approval queue. This does not send mail, publish, change files, or place orders.',inputSchema:{type:'object',properties:{projectId:{type:'string'},category:{type:'string',enum:['business','content','seller','mail','drive']},title:{type:'string'},text:{type:'string'}},required:['category','title','text'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}},
  {name:'propose_card_news',description:'Submit 1–8 structured Korean card-news slides to Nuri One for review. Approval creates private images; this tool does not publish them.',
    inputSchema:{type:'object',properties:{projectId:{type:'string'},title:{type:'string',maxLength:64},theme:{type:'string',enum:['mint','cobalt','ink']},
      slides:{type:'array',minItems:1,maxItems:8,items:{type:'object',properties:{headline:{type:'string',maxLength:58},body:{type:'string',maxLength:180},label:{type:'string',maxLength:28}},required:['headline','body'],additionalProperties:false}}},
    required:['title','slides'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}},
].map(tool=>({...tool,securitySchemes,_meta:{securitySchemes}}));
const toolContent=(value:unknown,isError=false)=>({content:[{type:'text',text:JSON.stringify(value)}],...(isError?{isError}:{}),...(!isError&&value&&typeof value==='object'&&!Array.isArray(value)?{structuredContent:value}:{})});

export function GET(){return new Response(null,{status:405,headers:{...privateHeaders,Allow:'POST'}});}

export async function POST(req:NextRequest) {
  const origin=req.headers.get('origin');
  if(origin&&![issuer(),'https://chatgpt.com','https://claude.ai','https://gemini.google.com'].includes(origin)){
    return new Response(null,{status:403,headers:privateHeaders});
  }
  let id:unknown=null;
  const json=(payload:object,status=200)=>Response.json({jsonrpc:'2.0',id,...payload},{status,headers:privateHeaders});
  try {
    const actor=await connectorActor(req);
    if(!actor)return connectorChallenge();
    const rpc=await body(req);
    id=typeof rpc.id==='number'||typeof rpc.id==='string'?rpc.id:null;
    if(rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string')return json({error:{code:-32600,message:'Invalid request'}},400);
    if(rpc.id===undefined)return new Response(null,{status:202,headers:privateHeaders});
    const params=(rpc.params??{}) as Record<string,unknown>;
    if(rpc.method==='initialize'){
      const requested=String(params.protocolVersion);
      return json({result:{protocolVersion:versions.includes(requested)?requested:'2025-06-18',serverInfo:{name:'nuri-one',version:'1.0.0'},capabilities:{tools:{}},instructions:'Use the selected project memory as context. Submit drafts to Nuri One for user review.'}});
    }
    if(rpc.method==='ping')return json({result:{}});
    if(rpc.method==='tools/list')return json({result:{tools}});
    if(rpc.method!=='tools/call')return json({error:{code:-32601,message:'Method not found'}});
    const args=(params.arguments??{}) as Record<string,unknown>;
    if(params.name==='list_projects'){
      const {projects}=await readWorkbench(actor.id);
      return json({result:toolContent({projects:projects.map(({rules:_,...project})=>project)})});
    }
    if(params.name==='project_memory'){
      const {projects}=await readWorkbench(actor.id);
      const project=projects.find(item=>item.id===args.projectId);
      return json({result:toolContent(project??{error:'프로젝트를 찾을 수 없습니다.'},!project)});
    }
    if(params.name==='today_work'){
      const {kst,items,agenda}=await briefContext(actor.id);
      return json({result:toolContent({date:kst,items,agenda})});
    }
    if(params.name==='propose_draft'||params.name==='propose_card_news'){
      limit('nuri-connector:'+actor.id,8);
      const submit=params.name==='propose_card_news'?submitCardDraft:submitDraft;
      const {id,title,status}=await submit(actor.id,args,actor.provider);
      return json({result:toolContent({id,title,status,url:issuer()+'/personal#workbench'})});
    }
    return json({error:{code:-32602,message:'Unknown tool'}});
  } catch(error) {
    return json({result:toolContent({error:error instanceof MarketError?error.message:'처리 중 문제가 발생했습니다.'},true)});
  }
}
