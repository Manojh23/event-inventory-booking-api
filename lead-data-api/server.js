import express from 'express';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createDb, ingest, eligible, Problem } from './db.js';
import { registerInventory } from './inventory.js';
import { sample } from './fixtures.js';

const stages=['new','shortlisted','review','archived'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createApp(db,agentUrl='http://127.0.0.1:8001') {
  const app=express();
  app.disable('x-powered-by');
  app.use(express.json({limit:'256kb'}));
  app.get('/api/health',async(_req,res)=>{await db.query('SELECT 1');res.json({ok:true});});
  app.get('/api/sources',async(_req,res)=>res.json((await db.query('SELECT * FROM sources ORDER BY id')).rows));
  app.post('/api/imports',async(req,res)=>res.status(201).json(await ingest(db,req.body?.source_id,req.body?.csv)));
  app.post('/api/imports/demo',async(_req,res)=>res.status(201).json(await ingest(db,'demo-events',sample)));
  app.get('/api/imports/:id',async(req,res)=>{
    if(!uuid.test(req.params.id)) throw new Problem(400,'Invalid import ID.');
    const batch=(await db.query('SELECT * FROM imports WHERE id=$1',[req.params.id])).rows[0];
    if(!batch)throw new Problem(404,'Import not found.');
    res.json({...batch,errors:(await db.query('SELECT record_number,reason FROM rejects WHERE import_id=$1 ORDER BY record_number',[batch.id])).rows});
  });
  app.get('/api/leads',async(req,res)=>{
    const {stage='',segment='',region='',q='',page='1'}=req.query;
    if([stage,segment,region,q,page].some(v=>typeof v!=='string')||!/^[1-9]\d{0,3}$/.test(page)||q.length>100) throw new Problem(400,'Invalid lead filters.');
    const result=await db.query(`SELECT l.*, count(*) OVER()::int AS total FROM leads l JOIN sources s ON s.id=l.source_id WHERE ${eligible}
      AND ($1='' OR stage=$1) AND ($2='' OR segment=$2) AND ($3='' OR region=$3)
      AND ($4='' OR position(lower($4) in lower(company||' '||city))>0)
      ORDER BY company,id LIMIT 20 OFFSET $5`,[stage,segment,region,q,(Number(page)-1)*20]);
    res.json({leads:result.rows,total:result.rows[0]?.total??0,page:Number(page)});
  });
  app.get('/api/summary',async(_req,res)=>res.json((await db.query(`SELECT stage,count(*)::int AS count FROM leads l JOIN sources s ON s.id=l.source_id WHERE ${eligible} GROUP BY stage`)).rows));
  app.param('leadId',(req,res,next,value)=>uuid.test(value)?next():next(new Problem(400,'Invalid lead ID.')));
  async function getLead(tx,id,lock='') {
    return (await tx.query(`SELECT l.*,s.terms_reference FROM leads l JOIN sources s ON s.id=l.source_id WHERE l.id=$1 AND ${eligible} ${lock}`,[id])).rows[0];
  }
  app.get('/api/leads/:leadId/audit',async(req,res)=>{
    if(!await getLead(db,req.params.leadId))throw new Problem(404,'Eligible lead not found.');
    res.json((await db.query('SELECT action,detail,created_at FROM audit WHERE lead_id=$1 ORDER BY id DESC LIMIT 30',[req.params.leadId])).rows);
  });
  app.patch('/api/leads/:leadId',async(req,res)=>{
    const {stage,version}=req.body??{};
    if(!stages.includes(stage)||!Number.isSafeInteger(version)||version<1)throw new Problem(422,'Provide a stage and current version.');
    const result=await db.transaction(async tx=>{
      const lead=await getLead(tx,req.params.leadId,'FOR UPDATE OF l');
      if(!lead)throw new Problem(404,'Eligible lead not found.');
      if(lead.version!==version)throw new Problem(409,'Lead changed. Refresh before saving.');
      const changed=(await tx.query('UPDATE leads SET stage=$2, version=version+1, updated_at=now() WHERE id=$1 RETURNING *',[lead.id,stage])).rows[0];
      await tx.query('INSERT INTO audit(lead_id,action,detail) VALUES ($1,$2,$3)',[lead.id,'stage_changed',JSON.stringify({from:lead.stage,to:stage})]);
      return changed;
    });
    res.json(result);
  });
  app.post('/api/leads/:leadId/qualify',async(req,res)=>{
    const lead=await getLead(db,req.params.leadId);
    if(!lead)throw new Problem(404,'Eligible lead not found.');
    let result;
    try {
      const response=await fetch(new URL('/qualify',agentUrl),{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:lead.id,segment:lead.segment,region:lead.region,budget:lead.budget,note:lead.note}),signal:AbortSignal.timeout(7000)});
      if(!response.ok)throw Error('Agent did not return a result');
      result=await response.json();
    } catch {throw new Problem(503,'Qualification service unavailable. Manual review is still available.');}
    await db.transaction(async tx=>{
      const current=await getLead(tx,lead.id,'FOR UPDATE OF l');
      if(!current||current.version!==lead.version)throw new Problem(409,'Lead or source changed during qualification. Refresh before retrying.');
      await tx.query('INSERT INTO audit(lead_id,action,detail) VALUES ($1,$2,$3)',[lead.id,'qualified',JSON.stringify(result)]);
    });
    res.json(result);
  });
  registerInventory(app,db,getLead,agentUrl);
  app.use('/api',(_req,res)=>res.status(404).json({error:'API route not found.'}));
  app.use(express.static(fileURLToPath(new URL('../lead-workbench/dist',import.meta.url))));
  app.use((err,_req,res,_next)=>{
    const status=Number.isInteger(err.status)&&err.status>=400&&err.status<=499?err.status:err.status===503?503:500;
    if(status===500)console.error(err);
    res.status(status).json({error:status===500?'Unexpected error.':err.message});
  });
  return app;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const db=await createDb(process.env.LEAD_DB??'.lead-data');
  const server=createApp(db,process.env.AGENT_URL).listen(Number(process.env.PORT??4173),process.env.HOST??'127.0.0.1',()=>console.log('Workbench: http://127.0.0.1:'+server.address().port));
}
