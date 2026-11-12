import { randomUUID } from 'node:crypto';
import { Problem } from './db.js';

const dates=/^\d{4}-\d{2}-\d{2}$/;
const ids=/^[a-z][a-z0-9-]{1,49}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const prices={av:40000,catering:3500,parking:18000};
function date(value) {
  if(typeof value!=='string'||!dates.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)
    throw new Problem(422,'Choose a valid event date.');
  return value;
}
function spec(body) {
  const {day,guests,addons=[]}=body??{};
  if(!Number.isInteger(guests)||guests<1||guests>1000)throw new Problem(422,'Enter 1 to 1,000 guests.');
  if(!Array.isArray(addons)||addons.some(x=>typeof x!=='string'||!Object.hasOwn(prices,x)))throw new Problem(422,'Choose supported add-ons.');
  return {day:date(day),guests,addons:[...new Set(addons)].sort()};
}
function publicProposal(row) {
  return {...row,day:typeof row.day==='string'?row.day.slice(0,10):row.day.toISOString().slice(0,10)};
}
function price(venue,guests,addons) {
  const items=[{item:'Venue rental',cents:venue.base_cents}];
  for(const add of addons)items.push({item:add,cents:prices[add]*(add==='catering'?guests:1)});
  return {items,total_cents:items.reduce((total,x)=>total+x.cents,0)};
}
function fits(venue,lead,{guests,addons}) {
  return venue.region===lead.region && venue.segments.includes(lead.segment) && guests<=venue.capacity && addons.every(x=>venue.amenities.includes(x));
}
export function registerInventory(app,db,getLead,agentUrl) {
  app.param('proposalId',(_req,_res,next,id)=>uuid.test(id)?next():next(new Problem(400,'Invalid proposal ID.')));
  async function findLead(db,id,locked=false) {
    const lead=await getLead(db,id,locked?'FOR UPDATE OF l':'');
    if(!lead)throw new Problem(404,'Eligible lead not found.');
    return lead;
  }
  app.get('/api/inventory',async(req,res)=>{
    const {day}=req.query;
    const picked=date(day);
    res.json((await db.query(`SELECT v.id,v.name,v.city,v.region,v.capacity,v.amenities,v.base_cents,
      (d.day IS NOT NULL AND NOT EXISTS (SELECT 1 FROM proposals p WHERE p.venue_id=v.id AND p.day=d.day
        AND (p.status='booked' OR (p.status='held' AND p.expires_at>now())))) AS available
      FROM venues v LEFT JOIN venue_days d ON d.venue_id=v.id AND d.day=$1
      ORDER BY v.region,v.name`,[picked])).rows);
  });
  app.post('/api/leads/:leadId/plan',async(req,res)=>{
    const params=spec(req.body),lead=await findLead(db,req.params.leadId);
    const {rows}=await db.query(`SELECT v.id,v.name,v.city,v.region,v.capacity,v.segments,v.amenities,
      d.day::text AS day,v.base_cents
      FROM venue_days d JOIN venues v ON v.id=d.venue_id
      WHERE v.region=$1 AND d.day>=CURRENT_DATE
      AND d.day BETWEEN $2::date-3 AND $2::date+3
      AND NOT EXISTS (SELECT 1 FROM proposals p WHERE p.venue_id=d.venue_id AND p.day=d.day
        AND (p.status='booked' OR (p.status='held' AND p.expires_at>now())))
      ORDER BY d.day,v.id LIMIT 60`,[lead.region,params.day]);
    let plan;
    try {
      const response=await fetch(new URL('/plan',agentUrl),{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...params,lead:{id:lead.id,segment:lead.segment,region:lead.region,budget:lead.budget,note:lead.note},
          inventory:rows.map(v=>({...v,...price(v,params.guests,params.addons)}))}),signal:AbortSignal.timeout(7000)});
      if(!response.ok)throw Error('Planning failed');
      plan=await response.json();
    } catch {throw new Problem(503,'Planner unavailable. You can still review the inventory.');}
    await db.transaction(async tx=>{
      const current=await findLead(tx,lead.id,true);
      if(current.version!==lead.version)throw new Problem(409,'Lead changed during planning; rerun the plan.');
      await tx.query('INSERT INTO audit(lead_id,action,detail) VALUES ($1,$2,$3)',[lead.id,'proposal_planned',JSON.stringify({day:params.day,guests:params.guests,route:plan.route,options:plan.options.map(o=>o.id),usage:plan.usage})]);
    });
    res.json({...plan,lead_version:lead.version});
  });
  app.get('/api/leads/:leadId/proposals',async(req,res)=>{
    await findLead(db,req.params.leadId);
    const {rows}=await db.query(`SELECT p.*,v.name AS venue_name,
      CASE WHEN status='held' AND expires_at<=now() THEN 'expired' ELSE status END AS effective_status
      FROM proposals p JOIN venues v ON v.id=p.venue_id WHERE p.lead_id=$1 ORDER BY p.created_at DESC LIMIT 30`,[req.params.leadId]);
    res.json(rows.map(publicProposal));
  });
  app.post('/api/leads/:leadId/proposals',async(req,res)=>{
    const params=spec(req.body);
    const {venue_id,request_key,lead_version}=req.body;
    if(typeof venue_id!=='string'||!ids.test(venue_id)||typeof request_key!=='string'||!uuid.test(request_key)||!Number.isInteger(lead_version))throw new Problem(422,'Provide a venue, request key, and lead version.');
    const result=await db.transaction(async tx=>{
      const lead=await findLead(tx,req.params.leadId,true);
      const prior=(await tx.query('SELECT *,day::text AS day_text FROM proposals WHERE lead_id=$1 AND request_key=$2',[lead.id,request_key])).rows[0];
      if(prior) {
        if(prior.venue_id!==venue_id||prior.day_text!==params.day||prior.guests!==params.guests||JSON.stringify(prior.addons)!==JSON.stringify(params.addons)||prior.lead_version!==lead_version)
          throw new Problem(409,'Request key was already used for a different proposal.');
        return {proposal:publicProposal(prior),replay:true};
      }
      if(lead.version!==lead_version)throw new Problem(409,'Lead changed. Build a new plan.');
      const venue=(await tx.query(`SELECT v.* FROM venue_days d JOIN venues v ON v.id=d.venue_id
        WHERE v.id=$1 AND d.day=$2 AND d.day>=CURRENT_DATE FOR UPDATE OF d`,[venue_id,params.day])).rows[0];
      if(!venue||!fits(venue,lead,params))throw new Problem(422,'Venue or date does not fit the event requirements.');
      const {total_cents}=price(venue,params.guests,params.addons);
      if(lead.budget===null||total_cents>lead.budget*100)throw new Problem(422,'A confirmed budget covering the quote is required to hold a date.');
      await tx.query(`UPDATE proposals SET status='expired' WHERE venue_id=$1 AND day=$2 AND status='held' AND expires_at<=now()`,[venue_id,params.day]);
      const {rows}=await tx.query(`INSERT INTO proposals(id,lead_id,request_key,lead_version,venue_id,day,guests,addons,total_cents,status,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,'held',now()+interval '30 minutes')
        ON CONFLICT DO NOTHING RETURNING *`,[randomUUID(),lead.id,request_key,lead.version,venue_id,params.day,params.guests,params.addons,total_cents]);
      if(!rows[0])throw new Problem(409,'That date already has an active hold or booking.');
      await tx.query('INSERT INTO audit(lead_id,action,detail) VALUES ($1,$2,$3)',[lead.id,'inventory_held',JSON.stringify({proposal:rows[0].id,venue_id,day:params.day,total_cents})]);
      return {proposal:publicProposal(rows[0]),replay:false};
    });
    res.status(result.replay?200:201).json(result.proposal);
  });
  app.patch('/api/leads/:leadId/proposals/:proposalId',async(req,res)=>{
    const {action}=req.body??{};
    if(!['approve','release'].includes(action))throw new Problem(422,'Choose approve or release.');
    const result=await db.transaction(async tx=>{
      const lead=await findLead(tx,req.params.leadId,true);
      const to=action==='approve'?'booked':'released';
      const existing=(await tx.query('SELECT * FROM proposals WHERE id=$1 AND lead_id=$2',[req.params.proposalId,lead.id])).rows[0];
      if(!existing)throw new Problem(404,'Proposal not found.');
      if(existing.status===to)return publicProposal(existing);
      if(to==='booked'&&existing.lead_version!==lead.version)throw new Problem(409,'Lead changed after the hold; release and replan.');
      const {rows}=await tx.query(`UPDATE proposals SET status=$3 WHERE id=$1 AND lead_id=$2 AND status='held' AND expires_at>now() RETURNING *`,[existing.id,lead.id,to]);
      if(!rows[0])throw new Problem(409,'Only an active hold can be approved or released.');
      await tx.query('INSERT INTO audit(lead_id,action,detail) VALUES ($1,$2,$3)',[lead.id,'inventory_'+to,JSON.stringify({proposal:existing.id})]);
      return publicProposal(rows[0]);
    });
    res.json(result);
  });
}
