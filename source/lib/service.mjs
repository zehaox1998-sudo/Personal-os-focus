import {createHash,randomUUID} from 'node:crypto';
import {parisDay,ranges} from '../public/engine.mjs';
export class FocusError extends Error {constructor(message,status=409){super(message);this.status=status;}}
export const cleanId=id=>String(id||'').replaceAll('-','').toLowerCase();
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export function validate(input,now=Date.now()) {
 const {id,startedAt,endedAt,duration,projectId=null,taskId=null,noProject}=input||{};
 const start=Date.parse(startedAt),end=Date.parse(endedAt);
 if(!uuid(id)||!Number.isFinite(start)||!Number.isFinite(end)||end<start||end>now+60000||start>now+60000||!Number.isInteger(duration)||duration<1||duration>14400||duration*1000>end-start+1000)throw new FocusError('The record time or duration is invalid. Keep a backup and check the system clock.',400);
 if((projectId!==null&&!uuid(projectId))||(taskId!==null&&!uuid(taskId))||typeof noProject!=='boolean'||(noProject?projectId!==null:projectId===null)||(noProject&&taskId))throw new FocusError('Select a valid Project or explicitly choose No project.',400);
 return {id:id.toLowerCase(),startedAt:new Date(start).toISOString(),endedAt:new Date(end).toISOString(),duration,projectId,taskId,noProject,date:parisDay(start)};
}
const fingerprint=s=>createHash('sha256').update(JSON.stringify([s.id,new Date(s.startedAt).toISOString(),new Date(s.endedAt).toISOString(),s.duration,cleanId(s.projectId),cleanId(s.taskId),s.noProject])).digest('hex');
async function unique(rows,what){if(rows.length>1)throw new FocusError(`${what} has duplicate entries. Confirm which one to keep in Notion; no new record was created.`);return rows[0];}
// Claims never expire automatically: a timeout can happen after Notion committed a page.
// Retry reconciles by stable ID; if absent, require inspection rather than blindly recreating.
async function dayFor(date,n,receipts){
 let found=await unique(await n.days(date),"today's daily record");if(found)return found.id;
 const key='day/'+date,claimToken=randomUUID(),result=await receipts.setJSON(key,{phase:'creating',claimToken},{onlyIfNew:true});
 if(!result.modified){found=await unique(await n.days(date),"today's daily record");if(found)return found.id;throw new FocusError("Today's daily record creation result needs verification. Try again later; if this continues, check the backend creation receipt.");}
 // Verify persisted claim before crossing the external side-effect boundary.
 if((await receipts.get(key,{type:'json'}))?.claimToken!==claimToken)throw new FocusError('The save service could not confirm the daily-record creation lock. Try again later.',503);
 found=await unique(await n.days(date),"today's daily record");if(found)return found.id;
 try{const page=await n.createDay(date);await receipts.setJSON(key,{phase:'saved',pageId:page.id});await unique(await n.days(date),"today's daily record");return page.id;}catch(e){if(e instanceof FocusError)throw e;throw new FocusError('The daily-record save result is not yet confirmed. The local record was kept; retrying later will verify first to avoid duplicates.',503);}
}
export async function saveSession(input,{notion:n,receipts,now=Date.now()}){
 const s=validate(input,now),hash=fingerprint(s),key='session/'+s.id;
 const prior=await receipts.get(key,{type:'json'});
 if(prior&&prior.hash!==hash)throw new FocusError('A record with the same ID has conflicting content. Keep a backup and verify it.');
 if(prior?.phase==='saved')return {saved:true,pageId:prior.pageId};
 await n.validateLinks(s);
 let found=await unique(await n.sessionsById(s.id),'focus record');
 if(found){if(fingerprint({...s,...found.session})!==hash)throw new FocusError('Notion already contains a record with the same ID but different content. Please verify it.');await receipts.setJSON(key,{hash,phase:'saved',pageId:found.id});return {saved:true,pageId:found.id};}
 const dailyId=await dayFor(s.date,n,receipts);
 const claimToken=randomUUID(),claim=await receipts.setJSON(key,{hash,phase:'creating',claimToken},{onlyIfNew:true});
 if(!claim.modified)throw new FocusError('This record is being saved or awaiting confirmation. Try again later; another record with the same ID will not be created.');
 const persisted=await receipts.get(key,{type:'json'});
 if(persisted?.hash!==hash||persisted?.claimToken!==claimToken)throw new FocusError('The save receipt could not be confirmed. Try again later.',503);
 try{const page=await n.createSession(s,dailyId);await receipts.setJSON(key,{hash,phase:'saved',pageId:page.id});return {saved:true,pageId:page.id};}catch{throw new FocusError('The Notion save result is not yet confirmed. The record remains local; retrying will look for the original first to avoid duplicate totals.',503);}
}
export function earliestPeriod(now){return Object.values(ranges(now)).sort()[0];}
