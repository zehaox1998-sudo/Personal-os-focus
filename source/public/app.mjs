import {newSession,tick,pause,resume,resolveGap,finish,totals} from './engine.mjs';
import {login,logout,getUser,handleAuthCallback,acceptInvite,updateUser} from '@netlify/identity';
const $=id=>document.getElementById(id), KEY='personal-os-focus-v1';
let data={session:null,pending:[],projects:[],tasks:[]}, owner=false,ready=false,syncing=false,audio=null,user=null,callback=null,lastStats=null;
const notify=m=>{$('notice').textContent=m;};
function persist(){try{localStorage.setItem(KEY,JSON.stringify(data));}catch{ready=false;notify('浏览器无法保存记录。请在独立窗口中打开并允许本地存储；计时已锁定。');}}
function read(){try{const raw=localStorage.getItem(KEY);if(raw){const p=JSON.parse(raw);if(!Array.isArray(p.pending)||!Array.isArray(p.projects)||!Array.isArray(p.tasks))throw Error();data=p;}}catch{ready=false;notify('无法读取本地记录，请先备份浏览器数据；本次没有覆盖原记录。');}}
const clock=ms=>`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
const duration=n=>n>=3600?`${Math.floor(n/3600)}h ${Math.floor(n%3600/60)}m`:n>0&&n<60?`${n}s`:`${Math.floor(n/60)}m`;
function render(){
 const s=data.session,active=!!s,minutes=Number($('minutes').value)||25;
 $('clock').textContent=clock(Math.max(0,s?s.targetMs-s.elapsedMs:minutes*60000));
 $('phase').textContent=s?{running:'正在专注',paused:'已暂停',complete:'本段专注已完成',review:'待确认离开时间'}[s.status]:'准备开始';
 $('elapsed').textContent=s?`已专注 ${clock(s.elapsedMs)}`:'专注于眼前这一件事';
 $('progress').style.strokeDashoffset=String(672.3*(1-(s?s.elapsedMs/s.targetMs:0)));
 $('start').hidden=active&&s.status!=='paused';$('start').textContent=active?'继续专注':'开始专注';
 $('pause').hidden=!active||s.status!=='running';$('finish').hidden=!active;$('finish').disabled=!ready||s?.status==='review';
 $('start').disabled=!ready;$('pause').disabled=!ready;$('discard').hidden=!active;$('discard').disabled=!ready;
 $('project').disabled=active||!ready;$('task').disabled=active||!ready;$('minutes').disabled=active||!ready;
 document.querySelectorAll('[data-minutes]').forEach(b=>{b.disabled=active||!ready;b.classList.toggle('selected',Number(b.dataset.minutes)===minutes);});
 $('recovery').hidden=s?.status!=='review';if(s?.status==='review')$('recovery-text').textContent=`页面曾中断或离开 ${duration(Math.floor(s.gapMs/1000))}。这段时间是否仍在专注？确认后保持暂停，由你决定何时继续。`;
 $('pending-box').hidden=data.pending.length===0;$('pending-text').textContent=`${data.pending.length} 条 · ${duration(data.pending.reduce((a,x)=>a+x.duration,0))} 待保存（尚未计入统计）`;
 $('retry').disabled=syncing||!owner;$('account').textContent=owner?'已连接 · 账户':'连接记录';
 document.title=s?.status==='running'?`${clock(s.targetMs-s.elapsedMs)} · 专注`:'专注 · Personal OS';
}
function options(el,rows,label,selected){el.replaceChildren(new Option(label,''));for(const r of rows)el.add(new Option(r.name,r.id));if(el===$('project'))el.add(new Option('不关联项目','none'));el.value=selected||'';}
function setOptions(){options($('project'),data.projects,'选择项目',data.session?(data.session.projectId||'none'):$('project').value);setTasks();}
function setTasks(){const id=$('project').value;options($('task'),data.tasks.filter(t=>t.projectId===id),'只关联项目',data.session?.taskId||$('task').value);}
function wakeAudio(){if(!$('sound').checked)return;try{audio ||= new(window.AudioContext||window.webkitAudioContext)();audio.resume();}catch{}}
function chime(){if(!$('sound').checked||!audio)return;try{for(let i=0;i<3;i++){const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime+i*.24;o.frequency.value=[523,659,784][i];g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.1,t+.02);g.gain.exponentialRampToValueAtTime(.001,t+.2);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+.22);}}catch{}}
async function api(path,body){const r=await fetch('/api/focus/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(55000)});let v;try{v=await r.json();}catch{throw Error('自动保存服务尚未连接。记录会保留在本浏览器，可导出备份。');}if(!r.ok)throw Error(v.message||'连接失败，记录仍保留在本地。');return v;}
async function refresh(){try{const r=await api('bootstrap');owner=true;data.projects=r.projects;data.tasks=r.tasks;persist();setOptions();lastStats=r;drawStats();notify('');}catch(e){owner=false;notify(e.message);}render();}
function drawStats(){if(!lastStats)return;for(const[k,v]of Object.entries(totals(lastStats.sessions)))$(k).textContent=duration(v);$('stat-status').textContent='Notion 已保存 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});}
async function sync(){if(syncing||!owner||!ready)return;syncing=true;render();try{for(const item of [...data.pending]){const r=await api('sessions',item);if(r.saved!==true)throw Error('保存结果待确认，请保留此记录。');data.pending=data.pending.filter(x=>x.id!==item.id);persist();}await refresh();notify('已保存到 Notion，并关联当天日记录。');}catch(e){notify(e.message);}finally{syncing=false;render();}}
$('start').onclick=()=>{try{wakeAudio();data.session=data.session?resume(data.session):newSession({minutes:Number($('minutes').value),projectId:$('project').value,taskId:$('task').value||null});persist();render();}catch(e){notify(e.message);}};
$('pause').onclick=()=>{data.session=pause(data.session);persist();render();};
$('discard').onclick=()=>{if(confirm('放弃本段计时？本段不会保存到 Notion。')){data.session=null;persist();render();}};
$('finish').onclick=()=>{try{const item=finish(data.session);if(!data.pending.some(x=>x.id===item.id))data.pending.push(item);data.session=null;persist();render();if(owner)sync();else notify('本段已保存在此浏览器，连接后可同步到 Notion。清理浏览器数据前请导出备份。');}catch(e){data.session=tick(data.session);persist();render();notify(e.message);}};
for(const [id,include]of[['include',true],['exclude',false]])$(id).onclick=()=>{data.session=resolveGap(data.session,include);persist();render();};
document.querySelectorAll('[data-minutes]').forEach(b=>b.onclick=()=>{$('minutes').value=b.dataset.minutes;render();});
$('minutes').oninput=render;$('project').onchange=setTasks;$('retry').onclick=sync;
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({format:'personal-os-focus-v1',exportedAt:new Date().toISOString(),pending:data.pending,active:data.session},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='focus-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('account').onclick=()=>{$('logout').hidden=!user;$('login-dialog').showModal();};$('close-login').onclick=()=>$('login-dialog').close();
$('login-form').onsubmit=async e=>{e.preventDefault();$('login-submit').disabled=true;try{if(callback?.type==='invite')user=await acceptInvite(callback.token,$('password').value);else if(callback?.type==='recovery')user=await updateUser({password:$('password').value});else user=await login($('email').value,$('password').value);callback=null;$('password').value='';$('login-dialog').close();await refresh();if(owner)await sync();}catch{$('login-error').textContent='登录未成功。请检查账户，或先完成服务配置。';}finally{$('login-submit').disabled=false;}};
$('logout').onclick=async()=>{await logout();user=null;owner=false;lastStats=null;for(const k of ['today','week','month','year'])$(k).textContent='—';$('stat-status').textContent='已退出，待保存记录仍保留在本浏览器';$('login-dialog').close();render();};
window.addEventListener('online',()=>{if(owner)sync();});
async function boot(){
 ready=true;read();if(!ready)return render();persist();if(data.session)$('minutes').value=data.session.targetMs/60000;if(data.session?.status==='running'){data.session=tick(data.session,Date.now(),true);persist();}setOptions();render();
 try{callback=await handleAuthCallback();user=await getUser();if(callback?.type==='invite'||callback?.type==='recovery'){$('email').required=false;$('email').disabled=true;$('login-error').textContent='请设置个人密码以完成连接。';$('login-dialog').showModal();}}catch{}
 if(user){await refresh();if(owner)sync();}else notify('当前为本地计时。连接个人账户后，可自动保存到 Notion。');
 setInterval(()=>{if(!ready)return;const before=data.session?.status;data.session=tick(data.session);if(data.session)persist();if(before==='running'&&data.session.status==='complete')chime();render();},1000);
}
if(navigator.locks){navigator.locks.request(KEY,{ifAvailable:true},async lock=>{if(!lock){notify('计时器已在另一个窗口打开。请在那个窗口继续，避免重复计时。');render();return;}await boot();await new Promise(()=>{});});}else{notify('此浏览器不支持安全恢复计时，请使用近期版本的 Chrome、Safari 或 Firefox。');render();}
