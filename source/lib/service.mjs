import {createHash,randomUUID} from 'node:crypto';
import {parisDay,ranges} from '../public/engine.mjs';
export class FocusError extends Error {constructor(message,status=409){super(message);this.status=status;}}
export const cleanId=id=>String(id||'').replaceAll('-','').toLowerCase();
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export function validate(input,now=Date.now()) {
 const {id,startedAt,endedAt,duration,projectId=null,taskId=null,noProject}=input||{};
 const start=Date.parse(startedAt),end=Date.parse(endedAt);
 if(!uuid(id)||!Number.isFinite(start)||!Number.isFinite(end)||end<start||end>now+60000||start>now+60000||!Number.isInteger(duration)||duration<1||duration>14400||duration*1000>end-start+1000)throw new FocusError('记录的时间或时长不合法；请保留备份后检查系统时钟。',400);
 if((projectId!==null&&!uuid(projectId))||(taskId!==null&&!uuid(taskId))||typeof noProject!=='boolean'||(noProject?projectId!==null:projectId===null)||(noProject&&taskId))throw new FocusError('请选择有效项目，或明确选择不关联项目。',400);
 return {id:id.toLowerCase(),startedAt:new Date(start).toISOString(),endedAt:new Date(end).toISOString(),duration,projectId,taskId,noProject,date:parisDay(start)};
}
const fingerprint=s=>createHash('sha256').update(JSON.stringify([s.id,new Date(s.startedAt).toISOString(),new Date(s.endedAt).toISOString(),s.duration,cleanId(s.projectId),cleanId(s.taskId),s.noProject])).digest('hex');
async function unique(rows,what){if(rows.length>1)throw new FocusError(`${what}存在重复条目，请先在 Notion 中确认保留哪一条；本次未新增记录。`);return rows[0];}
// Claims never expire automatically: a timeout can happen after Notion committed a page.
// Retry reconciles by stable ID; if absent, require inspection rather than blindly recreating.
async function dayFor(date,n,receipts){
 let found=await unique(await n.days(date),'当天日记录');if(found)return found.id;
 const key='day/'+date,claimToken=randomUUID(),result=await receipts.setJSON(key,{phase:'creating',claimToken},{onlyIfNew:true});
 if(!result.modified){found=await unique(await n.days(date),'当天日记录');if(found)return found.id;throw new FocusError('当天日记录的创建结果待核对。请稍后重试；若持续出现，请检查后台创建回执。');}
 // Verify persisted claim before crossing the external side-effect boundary.
 if((await receipts.get(key,{type:'json'}))?.claimToken!==claimToken)throw new FocusError('保存服务未能确认日记录创建锁；请稍后重试。',503);
 found=await unique(await n.days(date),'当天日记录');if(found)return found.id;
 try{const page=await n.createDay(date);await receipts.setJSON(key,{phase:'saved',pageId:page.id});await unique(await n.days(date),'当天日记录');return page.id;}catch(e){if(e instanceof FocusError)throw e;throw new FocusError('日记录保存结果尚未确认，已保留本地记录。稍后重试会先核对，避免重复创建。',503);}
}
export async function saveSession(input,{notion:n,receipts,now=Date.now()}){
 const s=validate(input,now),hash=fingerprint(s),key='session/'+s.id;
 const prior=await receipts.get(key,{type:'json'});
 if(prior&&prior.hash!==hash)throw new FocusError('相同记录编号的内容发生冲突，请保留备份后核对。');
 if(prior?.phase==='saved')return {saved:true,pageId:prior.pageId};
 await n.validateLinks(s);
 let found=await unique(await n.sessionsById(s.id),'专注记录');
 if(found){if(fingerprint({...s,...found.session})!==hash)throw new FocusError('Notion 中已有同编号但内容不同的记录，请核对。');await receipts.setJSON(key,{hash,phase:'saved',pageId:found.id});return {saved:true,pageId:found.id};}
 const dailyId=await dayFor(s.date,n,receipts);
 const claimToken=randomUUID(),claim=await receipts.setJSON(key,{hash,phase:'creating',claimToken},{onlyIfNew:true});
 if(!claim.modified)throw new FocusError('这条记录正在保存或结果待确认。请稍后重试；不会再创建同编号记录。');
 const persisted=await receipts.get(key,{type:'json'});
 if(persisted?.hash!==hash||persisted?.claimToken!==claimToken)throw new FocusError('保存回执未能确认，请稍后重试。',503);
 try{const page=await n.createSession(s,dailyId);await receipts.setJSON(key,{hash,phase:'saved',pageId:page.id});return {saved:true,pageId:page.id};}catch{throw new FocusError('Notion 保存结果尚未确认，记录保留在本地。重试将先查找原记录，避免重复累计。',503);}
}
export function earliestPeriod(now){return Object.values(ranges(now)).sort()[0];}
