import {getStore,getDeployStore} from '@netlify/blobs';
import type {Context,Config} from '@netlify/functions';
import {saveSession,FocusError} from '../../lib/service.mjs';
import {notionClient} from '../../lib/notion.mjs';

export default async (req:Request,context:Context)=>{
 const json=(v:unknown,status=200)=>Response.json(v,{
  status,
  headers:{
   'Cache-Control':'private, no-store',
   'Vary':'Authorization',
   'X-Content-Type-Options':'nosniff'
  }
 });

 try{
  const env=(key:string)=>Netlify.env.get(key);

  if(![
   'NOTION_TOKEN',
   'NOTION_FOCUS_SOURCE',
   'NOTION_DAILY_SOURCE',
   'NOTION_PROJECT_SOURCE',
   'NOTION_ACTION_SOURCE',
   'FOCUS_ACCESS_KEY'
  ].every(env)){
   return json({
    message:'Auto-save is not enabled yet. Complete the Notion connection and personal account configuration. Records can remain in this browser for now.'
   },503);
  }

  const auth=req.headers.get('authorization')||'';
  if(auth!==`Bearer ${env('FOCUS_ACCESS_KEY')}`){
   return json({message:'Enter the authorized access key first.'},401);
  }

  const part=new URL(req.url).pathname.split('/').pop();
  const notion=notionClient(env);

  if(req.method==='GET'&&part==='bootstrap'){
   return json(await notion.bootstrap());
  }

  if(req.method==='POST'&&part==='sessions'){
   if(req.headers.get('origin')!==new URL(req.url).origin){
    return json({message:'Request origin mismatch. Use the timer page directly.'},403);
   }

   if(!req.headers.get('content-type')?.startsWith('application/json')){
    return json({message:'Invalid request format.'},415);
   }

   const body=await req.text();
   if(body.length>4096){
    return json({message:'Record payload is too large.'},413);
   }

   if(context.deploy.context!=='production'){
    return json({message:'Preview deployments do not write to the production Notion workspace.'},403);
   }

   const receipts=context.deploy.context==='production'
    ?getStore({name:'focus-receipts-v1',consistency:'strong'})
    :getDeployStore({name:'focus-receipts-v1',consistency:'strong'});

   return json(await saveSession(JSON.parse(body),{notion,receipts}));
  }

  return json({message:'Unknown operation.'},405);

 }catch(e){
  if(e instanceof FocusError)return json({message:e.message},e.status);
  return json({message:'The save service is temporarily unavailable. Records remain saved locally.'},503);
 }
};

export const config:Config={path:'/api/focus/:operation'};