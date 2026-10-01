import {getUser,verifyRequestOrigin} from '@netlify/identity';
import {getStore,getDeployStore} from '@netlify/blobs';
import type {Context,Config} from '@netlify/functions';
import {saveSession,FocusError} from '../../lib/service.mjs';
import {notionClient} from '../../lib/notion.mjs';

export default async (req:Request,context:Context)=>{
 const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
 try{
  const env=(key:string)=>Netlify.env.get(key);
  if(!['NOTION_TOKEN','NOTION_FOCUS_SOURCE','NOTION_DAILY_SOURCE','NOTION_PROJECT_SOURCE','NOTION_ACTION_SOURCE','FOCUS_OWNER_ID'].every(env))return json({message:'自动保存尚未启用，需完成后台的 Notion 连接与个人账户配置。记录可先保留在此浏览器。'},503);
  const user=await getUser();
  if(!user||user.id!==env('FOCUS_OWNER_ID'))return json({message:'请先登录已授权的个人账户。'},401);
  const part=new URL(req.url).pathname.split('/').pop();
  const notion=notionClient(env);
  if(req.method==='GET'&&part==='bootstrap')return json(await notion.bootstrap());
  if(req.method==='POST'&&part==='sessions'){
   // Cookie authentication requires explicit same-origin protection.
   if(req.headers.get('origin')!==new URL(req.url).origin)return json({message:'请求来源不匹配，请在计时器页面操作。'},403);
   verifyRequestOrigin(req);
   if(!req.headers.get('content-type')?.startsWith('application/json'))return json({message:'请求格式不正确。'},415);
   const body=await req.text();if(body.length>4096)return json({message:'记录过大。'},413);
   // Preview deployments may read the same configured Notion; only production may write.
   if(context.deploy.context!=='production')return json({message:'预览环境不写入正式 Notion。'},403);
   const receipts=context.deploy.context==='production'?getStore({name:'focus-receipts-v1',consistency:'strong'}):getDeployStore({name:'focus-receipts-v1',consistency:'strong'});
   return json(await saveSession(JSON.parse(body),{notion,receipts}));
  }
  return json({message:'不存在这个操作。'},405);
 }catch(e){if(e instanceof FocusError)return json({message:e.message},e.status);return json({message:'保存服务暂时不可用，记录仍保留在本地。'},503);}
};
export const config:Config={path:'/api/focus/:operation'};
