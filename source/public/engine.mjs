export const ZONE = 'Europe/Paris';
export function parisDay(time) {
  const p = new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time));
  return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');
}
export function ranges(now=Date.now()) {
  const day=parisDay(now), d=new Date(day+'T12:00:00Z');
  d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
  return {today:day,week:d.toISOString().slice(0,10),month:day.slice(0,7)+'-01',year:day.slice(0,4)+'-01-01'};
}
export function newSession({minutes,projectId,taskId=null}, now=Date.now(), id=crypto.randomUUID()) {
  if(!Number.isInteger(minutes)||minutes<1||minutes>240) throw Error('Duration must be an integer from 1 to 240 minutes.');
  if(!projectId) throw Error('Please select a Project or choose “No project”.');
  return {id,startedAt:now,checkpoint:now,elapsedMs:0,targetMs:minutes*60000,status:'running',projectId:projectId==='none'?null:projectId,taskId,noProject:projectId==='none'};
}
// While a session is running, elapsed real time always counts.
// Switching tabs, minimizing the browser, device sleep, or reopening the page
// must not pause the timer or require focus review.
export function tick(s, now=Date.now(), forceRecovery=false) {
  if (!s || s.status !== 'running') return s;

  const gap = Math.max(0, now - s.checkpoint);

  const elapsedMs = Math.min(
    s.targetMs,
    s.elapsedMs + gap
  );

  return {
    ...s,
    elapsedMs,
    checkpoint: now,
    status:
      elapsedMs >= s.targetMs
        ? 'complete'
        : 'running'
  };
}
export function resolveGap(s,include,now=Date.now()) {
  if(s.status!=='review') return s;
  const elapsedMs=Math.min(s.targetMs,s.elapsedMs+(include?s.gapMs:0));
  return {...s,elapsedMs,checkpoint:now,gapMs:0,status:elapsedMs>=s.targetMs?'complete':'paused'};
}
export function pause(s,now=Date.now()) {
  const next=tick(s,now);
  return next.status==='running'?{...next,status:'paused'}:next;
}
export function resume(s,now=Date.now()) {
  return s.status==='paused'?{...s,status:'running',checkpoint:now}:s;
}
export function finish(s,now=Date.now()) {
  const next=tick(s,now);
  if(next.status==='review') throw Error('Please confirm whether the gap should be included first.');
  const duration=Math.floor(next.elapsedMs/1000);
  if(duration<1) throw Error('There is no duration to save yet. Run the timer for at least 1 second.');
  return {id:next.id,startedAt:new Date(next.startedAt).toISOString(),endedAt:new Date(now).toISOString(),duration,projectId:next.projectId,taskId:next.taskId,noProject:next.noProject};
}
export function totals(rows,now=Date.now()) {
  const bounds=ranges(now),result={today:0,week:0,month:0,year:0},seen=new Set();
  for(const row of rows) {
    if(seen.has(row.id)||!Number.isFinite(row.duration)||row.duration<0) continue;
    seen.add(row.id);
    for(const key of Object.keys(result)) if(row.date>=bounds[key]&&row.date<=bounds.today) result[key]+=row.duration;
  }
  return result;
}
