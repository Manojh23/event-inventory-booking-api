import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createDb } from '../lead-data-api/db.js';
import { createApp } from '../lead-data-api/server.js';
import { sample } from '../lead-data-api/fixtures.js';
let db,server,agent,base,agentCalls=0,importId,lead;
async function api(path,method='GET',body) {
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return [r.status,await r.json()];
}
before(async()=>{
  agent=createServer((req,res)=>{
    let raw='';req.on('data',s=>raw+=s);
    req.on('end',()=>{
      agentCalls++;
      const payload=JSON.parse(raw);
      assert.equal(typeof payload.note,'string');
      assert.equal(Object.hasOwn(payload,'company'),false);
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({decision:'review',route:'fixture',reason:'Verify budget',quote:'',latency_ms:0,attempted:1,path:[],usage:{source:'none',input:0,output:0},estimated_usd:null}));
    });
  }).listen(0,'127.0.0.1');
  await once(agent,'listening');
  db=await createDb();
  server=createApp(db,'http://127.0.0.1:'+agent.address().port).listen(0,'127.0.0.1');
  await once(server,'listening');
  base='http://127.0.0.1:'+server.address().port+'/api';
});
after(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(agent)await new Promise(resolve=>agent.close(resolve));
  if(db)await db.close();
});
test('CSV normalizes rows, quarantines invalid rows, and replays by digest',async()=>{
  const [status,batch]=await api('/imports/demo','POST');
  assert.equal(status,201);
  assert.deepEqual([batch.received,batch.accepted,batch.rejected],[11,10,1]);
  importId=batch.id;
  const [,again]=await api('/imports/demo','POST');
  assert.equal(again.replay,true);
  assert.equal(again.id,importId);
  const [,detail]=await api('/imports/'+importId);
  assert.deepEqual(detail.errors,[{record_number:11,reason:'Invalid company'}]);
});
test('parameterized search and optimistic version control',async()=>{
  const [,filtered]=await api('/leads?q=Beacon');
  lead=filtered.leads[0];
  assert.equal(lead.company,'Beacon Forum');
  const [,bad]=await api('/leads?q='+encodeURIComponent("x' OR 1=1 --"));
  assert.equal(bad.total,0);
  assert.equal((await api('/leads/'+lead.id,'PATCH',{stage:'shortlisted',version:lead.version}))[0],200);
  assert.equal((await api('/leads/'+lead.id,'PATCH',{stage:'archived',version:lead.version}))[0],409);
});
test('qualification sends only required fields and records result in audit',async()=>{
  assert.equal((await api('/leads/'+lead.id+'/qualify','POST'))[0],200);
  assert.equal(agentCalls,1);
  const [,log]=await api('/leads/'+lead.id+'/audit');
  assert.deepEqual(log.map(x=>x.action),['qualified','stage_changed']);
});
test('inventory holds are idempotent and exclusive, and approval persists',async()=>{
  const [,other]=await api('/leads?q=Riverstone');
  const second=other.leads[0];
  const [,current]=await api('/leads?q=Beacon');
  lead=current.leads[0];
  const day=(await db.query("SELECT (CURRENT_DATE+1)::text AS day")).rows[0].day;
  const params={day,guests:30,addons:['av'],venue_id:'cedar-loft'};
  const request={...params,request_key:randomUUID(),lead_version:lead.version};
  const endpoint='/leads/'+lead.id+'/proposals';
  const [created,hold]=await api(endpoint,'POST',request);
  assert.equal(created,201);
  assert.equal(hold.total_cents,360000);
  assert.equal((await api(endpoint,'POST',request))[1].id,hold.id);
  assert.equal((await api(endpoint,'POST',{...request,guests:31}))[0],409);
  assert.equal((await api('/leads/'+second.id+'/proposals','POST',{...params,request_key:randomUUID(),lead_version:second.version}))[0],409);
  assert.equal((await api(endpoint+'/'+hold.id,'PATCH',{action:'approve'}))[1].status,'booked');
  const [,inventory]=await api('/inventory?day='+day);
  assert.equal(inventory.find(v=>v.id==='cedar-loft').available,false);
});
test('expired holds release inventory and cannot be approved',async()=>{
  const day=(await db.query("SELECT (CURRENT_DATE+2)::text AS day")).rows[0].day;
  const endpoint='/leads/'+lead.id+'/proposals';
  const request={day,guests:30,addons:[],venue_id:'cedar-loft',request_key:randomUUID(),lead_version:lead.version};
  const [,hold]=await api(endpoint,'POST',request);
  await db.query("UPDATE proposals SET expires_at=now()-interval '1 minute' WHERE id=$1",[hold.id]);
  assert.equal((await api(endpoint+'/'+hold.id,'PATCH',{action:'approve'}))[0],409);
  assert.equal((await api(endpoint,'POST',{...request,request_key:randomUUID()}))[0],201);
});
test('unapproved source is blocked at import and qualification',async()=>{
  await db.query("UPDATE sources SET review_by='2000-01-01' WHERE id=$1",['demo-events']);
  assert.equal((await api('/imports','POST',{source_id:'demo-events',csv:sample}))[0],403);
  assert.equal((await api('/leads/'+lead.id+'/qualify','POST'))[0],404);
  assert.equal(agentCalls,1);
  assert.equal((await api('/leads'))[1].total,0);
});
