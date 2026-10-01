import {FocusError,cleanId,earliestPeriod} from './service.mjs';
const text=value=>[{type:'text',text:{content:value}}];
const title=(p,name)=>(p.properties[name]?.title||[]).map(x=>x.plain_text||x.text?.content||'').join('');
const rich=(p,name)=>(p.properties[name]?.rich_text||[]).map(x=>x.plain_text||x.text?.content||'').join('');
const relation=(p,name)=>p.properties[name]?.relation?.[0]?.id||null;
export function notionClient(env,fetcher=fetch){
 const ids={focus:env('NOTION_FOCUS_SOURCE'),daily:env('NOTION_DAILY_SOURCE'),projects:env('NOTION_PROJECT_SOURCE'),actions:env('NOTION_ACTION_SOURCE')};
 const token=env('NOTION_TOKEN');
 async function request(path,body,read=false){
  for(let attempt=0;attempt<3;attempt++){
   const response=await fetcher('https://api.notion.com/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Notion-Version':'2025-09-03','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
   if(response.ok)return response.json();
   if(read&&(response.status===429||response.status>=500)&&attempt<2){await new Promise(r=>setTimeout(r,Math.min(3000,Number(response.headers.get('retry-after')||1)*1000)));continue;}
   throw new FocusError(response.status===401||response.status===403||response.status===404?'The Notion connection or database authorization is incomplete. Check the backend configuration.':'Notion cannot process the request right now. Records remain saved locally.',503);
  }
 }
 async function query(source,filter){let rows=[],cursor;do{const r=await request(`data_sources/${source}/query`,{filter,page_size:100,...(cursor?{start_cursor:cursor}:{})},true);rows.push(...r.results);cursor=r.has_more?r.next_cursor:null;if(rows.length>20000)throw new FocusError("The number of records exceeds this version's statistics limit. Read them in smaller ranges; some totals are currently omitted.",503);}while(cursor);return rows;}
 const eq=(property,kind,value)=>({property,[kind]:{equals:value}});
 const parseSession=p=>({id:p.id,session:{id:rich(p,'Session ID'),startedAt:p.properties['Start Time']?.date?.start,endedAt:p.properties['End Time']?.date?.start,duration:p.properties.Duration?.number,projectId:relation(p,'Project'),taskId:relation(p,'Action'),noProject:p.properties['No Project']?.checkbox}});
 async function validatePage(id,source){const p=await request('pages/'+id,undefined,true);if(p.archived||p.in_trash||cleanId(p.parent?.data_source_id)!==cleanId(source))throw new FocusError('The linked item is not in an allowed database or has been deleted.',400);return p;}
 return {
  async validateLinks(s){if(s.projectId)await validatePage(s.projectId,ids.projects);if(s.taskId){const p=await validatePage(s.taskId,ids.actions);if(!(p.properties.Project?.relation||[]).some(x=>cleanId(x.id)===cleanId(s.projectId)))throw new FocusError('The Action does not belong to the selected Project.',400);}},
  days:date=>query(ids.daily,{and:[eq('Type','select','Day'),eq('Date','date',date)]}),
  sessionsById:async id=>(await query(ids.focus,eq('Session ID','rich_text',id))).map(parseSession),
  createDay:date=>request('pages',{parent:{type:'data_source_id',data_source_id:ids.daily},properties:{'日期':{title:text(date)},Type:{select:{name:'Day'}},Date:{date:{start:date}},'日记':{checkbox:true},'周报':{checkbox:false}}}),
  createSession:(s,dailyId)=>request('pages',{parent:{type:'data_source_id',data_source_id:ids.focus},properties:{Session:{title:text(`${s.date} · ${Math.round(s.duration/60*10)/10} min`)},'Session ID':{rich_text:text(s.id)},Date:{date:{start:s.date}},'Start Time':{date:{start:s.startedAt}},'End Time':{date:{start:s.endedAt}},Duration:{number:s.duration},Project:{relation:s.projectId?[{id:s.projectId}]:[]},Daily:{relation:[{id:dailyId}]},Action:{relation:s.taskId?[{id:s.taskId}]:[]},'No Project':{checkbox:s.noProject}}}),
  async bootstrap(now=Date.now()){
   const projects=await query(ids.projects,eq('State','select','Active'));
   const tasks=await query(ids.actions,{or:['Next','Doing','Waiting'].map(v=>eq('Status','select',v))});
   const sessions=await query(ids.focus,{property:'Date',date:{on_or_after:earliestPeriod(now)}});
   return {projects:projects.map(p=>({id:p.id,name:title(p,'Project')})),tasks:tasks.map(p=>({id:p.id,name:title(p,'Action'),projectId:relation(p,'Project')})),sessions:sessions.map(p=>({id:rich(p,'Session ID')||p.id,date:p.properties.Date?.date?.start?.slice(0,10),duration:p.properties.Duration?.number||0}))};
  }
 };
}
