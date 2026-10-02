import test from 'node:test';
import assert from 'node:assert/strict';
import {newSession,tick,pause,resume,resolveGap,finish,parisDay,ranges,totals} from '../public/engine.mjs';
const start=Date.parse('2026-09-30T21:59:50Z');
const fresh=()=>newSession({minutes:25,projectId:'none'},start,'test');
test('pause excludes time; early finish stores actual seconds',()=>{let s=fresh();s=pause(s,start+10000);s=resume(s,start+70000);s=tick(s,start+80000);assert.equal(finish(s,start+80000).duration,20);});
test('sleep and reload continue counting elapsed real time',()=>{
  let s=tick(fresh(),start+1000);

  const restored=tick(
    JSON.parse(JSON.stringify(s)),
    start+301000,
    true
  );

  assert.equal(restored.status,'running');
  assert.equal(restored.elapsedMs,301000);
});
test('countdown caps at target; waits for save, no auto task completion',()=>{let s=newSession({minutes:1,projectId:'none'},start,'test');for(let i=1;i<=61;i++)s=tick(s,start+i*1000);assert.equal(s.status,'complete');assert.equal(finish(s,start+120000).duration,60);});
test('Paris date handles midnight and both DST boundaries',()=>{assert.equal(parisDay('2026-09-30T22:00:00Z'),'2026-10-01');assert.equal(parisDay('2026-03-29T00:30:00Z'),'2026-03-29');assert.equal(parisDay('2026-10-25T01:30:00Z'),'2026-10-25');assert.equal(ranges(Date.parse('2027-01-01T12:00Z')).week,'2026-12-28');});
test('year-boundary week includes previous-year entries; duplicates and future dates excluded',()=>{const r=totals([{id:'a',date:'2026-12-29',duration:60},{id:'b',date:'2027-01-01',duration:120},{id:'b',date:'2027-01-01',duration:120},{id:'c',date:'2027-01-02',duration:100}],Date.parse('2027-01-01T12:00Z'));assert.deepEqual(r,{today:120,week:180,month:120,year:120});});
test('clock rollback never subtracts stored focus',()=>{
  const s=tick(fresh(),start-1000);

  assert.equal(s.status,'running');
  assert.equal(s.elapsedMs,0);
});
test('custom duration and explicit no-project validation',()=>{assert.throws(()=>newSession({minutes:25,projectId:''}));for(const minutes of [0,241,1.5,NaN])assert.throws(()=>newSession({minutes,projectId:'none'}));});
