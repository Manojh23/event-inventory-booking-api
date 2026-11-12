import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { connectPostgres } from './postgres.js';
import { source } from './fixtures.js';

export class Problem extends Error {
  constructor(status, message) { super(message); this.status=status; }
}
export async function createDb(location='memory://') {
  const external=Boolean(process.env.DATABASE_URL || process.env.PGHOST);
  const db = external ? await connectPostgres() : await PGlite.create(location);
  const schema=await readFile(new URL('./schema.sql',import.meta.url),'utf8');
  const inventory=await readFile(new URL('./inventory.sql',import.meta.url),'utf8');
  await db.transaction(async tx=>{
    if(external)await tx.query('SELECT pg_advisory_xact_lock(17074126)');
    await tx.exec(schema);
    await tx.query(`INSERT INTO sources(id,name,terms_reference,permitted_use,review_by)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,Object.values(source));
    await tx.exec(inventory);
  });
  return db;
}
const required=['external_id','company','segment','city','region','budget','note'];
const segments=new Set(['corporate','wedding','marine','community']);
const fields=(value,max)=>typeof value==='string' && value.trim().length>0 && value.trim().length<=max;
function normalize(row) {
  for(const field of ['external_id','company','city','note']) if(!fields(row[field],field==='note'?600:100)) throw Error('Invalid '+field);
  const segment=row.segment.toLowerCase(); const region=row.region.toUpperCase();
  if(!segments.has(segment)||!/^([A-Z]{2})$/.test(region)) throw Error('Invalid segment or region');
  if(row.budget && (!/^\d+$/.test(row.budget)||Number(row.budget)>10000000)) throw Error('Invalid budget');
  return [row.external_id,row.company,segment,row.city,region,row.budget?Number(row.budget):null,row.note];
}
export async function ingest(db,sourceId,csv) {
  if(typeof csv!=='string'||!csv.trim()) throw new Problem(422,'A CSV string is required.');
  let records;
  try {
    records=parse(csv,{bom:true,trim:true,skip_empty_lines:true,columns:header=>{
      if(header.length!==required.length||new Set(header).size!==required.length||required.some(k=>!header.includes(k))) throw Error('Expected columns: '+required.join(', '));
      return header;
    }});
  } catch(e) {throw new Problem(422,e.message);}
  if(!records.length||records.length>1000) throw new Problem(422,'An import must contain 1 to 1,000 records.');
  const digest=createHash('sha256').update(csv).digest('hex');
  return db.transaction(async tx=>{
    const policy=(await tx.query(`SELECT id FROM sources WHERE id=$1 AND enabled AND review_by>=CURRENT_DATE AND permitted_use='internal_qualification' FOR UPDATE`,[sourceId])).rows[0];
    if(!policy) throw new Problem(403,'This source is not approved for lead qualification.');
    const prior=(await tx.query('SELECT * FROM imports WHERE source_id=$1 AND digest=$2',[sourceId,digest])).rows[0];
    if(prior)return {...prior,errors:(await tx.query('SELECT record_number,reason FROM rejects WHERE import_id=$1 ORDER BY record_number',[prior.id])).rows,replay:true};
    const id=randomUUID();
    await tx.query('INSERT INTO imports(id,source_id,digest,received) VALUES ($1,$2,$3,$4)',[id,sourceId,digest,records.length]);
    let accepted=0; const seen=new Set(); const errors=[];
    for(const [i,row] of records.entries()) {
      let values;
      try {
        values=normalize(row);
        if(seen.has(values[0])) throw Error('Duplicate external ID in batch');
        seen.add(values[0]);
      } catch(e) {
        errors.push({record_number:i+1,reason:e.message});
        await tx.query('INSERT INTO rejects VALUES ($1,$2,$3)',[id,i+1,e.message]); continue;
      }
      await tx.query(`INSERT INTO leads(id,source_id,external_id,company,segment,city,region,budget,note)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(source_id,external_id) DO UPDATE SET company=excluded.company,segment=excluded.segment,
        city=excluded.city,region=excluded.region,budget=excluded.budget,note=excluded.note,
        version=leads.version+1,updated_at=now()`,[randomUUID(),sourceId,...values]);
      accepted++;
    }
    await tx.query('UPDATE imports SET accepted=$2,rejected=$3 WHERE id=$1',[id,accepted,errors.length]);
    return {id,received:records.length,accepted,rejected:errors.length,errors,replay:false};
  });
}
export const eligible = "s.enabled AND s.review_by>=CURRENT_DATE AND s.permitted_use='internal_qualification'";
