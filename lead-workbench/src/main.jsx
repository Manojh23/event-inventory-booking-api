import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import ProposalBuilder,{tomorrow} from './ProposalBuilder.jsx';

const dollars=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const title=value=>value.replaceAll('_',' ');
async function api(path,options={}) {
  const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  const body=await response.json();
  if(!response.ok)throw Error(body.error??'Request failed.');
  return body;
}
function Stat({label,value}) {return <div className="stat"><span>{label}</span><strong>{value}</strong></div>}
function App(){
  const [view,setView]=useState('Lead queue');
  const [search,setSearch]=useState('');
  const [stage,setStage]=useState('');
  const [page,setPage]=useState(1);
  const [revision,refresh]=useState(0);
  const [data,setData]=useState({leads:[],total:0});
  const [summary,setSummary]=useState([]);
  const [inventory,setInventory]=useState([]);
  const [inventoryDay,setInventoryDay]=useState(tomorrow);
  const [sources,setSources]=useState([]);
  const [selectedId,select]=useState(null);
  const [result,setResult]=useState(null);
  const [audit,setAudit]=useState([]);
  const [importResult,setImport]=useState(null);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const selected=data.leads.find(x=>x.id===selectedId);
  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams({q:search,stage,page});
    const timer=setTimeout(()=>{
      setLoading(true);
      Promise.all([api('/leads?'+params,{signal:controller.signal}),api('/summary',{signal:controller.signal})])
        .then(([rows,counts])=>{setData(rows);setSummary(counts)})
        .catch(e=>{if(e.name!=='AbortError')setError(e.message)})
        .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    },120);
    return()=>{clearTimeout(timer);controller.abort()};
  },[search,stage,page,revision]);
  useEffect(()=>{
    if(view==='Lead queue')return;
    const c=new AbortController();
    const path=view==='Inventory'?'/inventory?day='+encodeURIComponent(inventoryDay):'/sources';
    api(path,{signal:c.signal}).then(view==='Inventory'?setInventory:setSources).catch(e=>{if(e.name!=='AbortError')setError(e.message)});
    return()=>c.abort();
  },[view,revision,inventoryDay]);
  useEffect(()=>{
    if(!selectedId)return;
    const c=new AbortController();
    api('/leads/'+selectedId+'/audit',{signal:c.signal}).then(setAudit).catch(e=>{if(e.name!=='AbortError')setError(e.message)});
    return()=>c.abort();
  },[selectedId,revision]);
  function choose(id){select(id);setResult(null);setAudit([]);}
  async function run(fn) {
    setBusy(true);setError('');
    try{await fn();refresh(x=>x+1)}
    catch(e){setError(e.message)}
    finally{setBusy(false)}
  }
  async function importDemo(){await run(async()=>setImport(await api('/imports/demo',{method:'POST'})))}
  async function upload(event){
    const file=event.target.files?.[0]; if(!file)return;
    event.target.value='';
    if(file.size>200000){setError('Choose a synthetic CSV smaller than 200 KB.');return;}
    await run(async()=>setImport(await api('/imports',{method:'POST',body:JSON.stringify({source_id:'demo-events',csv:await file.text()})})));
  }
  const tabs=['Lead queue','Inventory','Data sources'];
  return <>
    <header><div className="brand"><span className="logo" aria-hidden="true">S</span><div><strong>VenueFlow</strong><small>Event sales studio</small></div></div><div className="pill"><span/> Synthetic demo</div></header>
    <main>
      <div className="hero"><div><div className="eyebrow">BUSINESS DEVELOPMENT</div><h1>VenueFlow Sales Studio</h1><p>Turn inquiries into comparable quotes, temporary holds, and approved bookings.</p></div>
      <button className="primary" disabled={busy} onClick={importDemo}>Import sample leads</button></div>
      <nav aria-label="Workbench sections">{tabs.map(x=><button key={x} className={view===x?'current':''} aria-pressed={view===x} onClick={()=>{setError('');setView(x)}}>{x}</button>)}</nav>
      {error&&<div role="alert" className="alert">{error} <button onClick={()=>setError('')}>Dismiss</button></div>}
      {importResult&&<div role="status" className="notice">{importResult.replay?'Import already processed.':'Import complete.'} {importResult.accepted} accepted · {importResult.rejected} rejected. <button onClick={()=>setView('Data sources')}>View details</button></div>}
      {view==='Lead queue'&&<>
        <div className="stats">{['new','shortlisted','review','archived'].map(s=><Stat key={s} label={title(s)} value={summary.find(x=>x.stage===s)?.count??0}/>)}</div>
        <div className="grid">
          <section className="card">
            <div className="section-top"><div><h2>Lead queue</h2><p>{loading?'Loading…':data.total+' matching leads'}</p></div></div>
            <div className="filters"><label>Search<input value={search} placeholder="Company or city" onChange={e=>{setSearch(e.target.value);setPage(1)}}/></label><label>Stage<select value={stage} onChange={e=>{setStage(e.target.value);setPage(1)}}><option value="">All stages</option>{['new','shortlisted','review','archived'].map(x=><option key={x}>{x}</option>)}</select></label></div>
            <div className="table-scroll"><table><thead><tr><th>Company</th><th>Market</th><th>Budget</th><th>Stage</th></tr></thead><tbody>{data.leads.map(lead=><tr key={lead.id} className={lead.id===selectedId?'selected':''}>
              <td><button className="text-link" disabled={busy} onClick={()=>choose(lead.id)}>{lead.company}</button><small>{lead.segment}</small></td>
              <td>{lead.city}, {lead.region}</td><td>{lead.budget==null?'—':dollars.format(lead.budget)}</td><td><span className="tag">{lead.stage}</span></td>
            </tr>)}</tbody></table></div>
            {!loading&&!data.leads.length&&<p className="empty">No leads here. Import samples or change the filters.</p>}
            <div className="paging"><button disabled={page===1} onClick={()=>setPage(x=>x-1)}>Previous</button><span>Page {page}</span><button disabled={data.total<=page*20} onClick={()=>setPage(x=>x+1)}>Next</button></div>
          </section>
          <section className="card detail" aria-label="Lead detail">
            <h2>{selected?.company??'Lead detail'}</h2>
            {!selected?<p className="empty">Select a lead to see its inquiry, qualification, and activity.</p>:<>
              <p>{selected.segment} · {selected.city}, {selected.region}</p>
              <blockquote>{selected.note}</blockquote>
              <button className="primary" disabled={busy} onClick={()=>run(async()=>setResult(await api('/leads/'+selected.id+'/qualify',{method:'POST'})))}>{busy?'Working…':'Run qualification'}</button>
              {result&&<div className="result" aria-live="polite"><div className="eyebrow">{title(result.decision)}</div><p>{result.reason}</p>
                {result.quote&&<blockquote>“{result.quote}”</blockquote>}
                <small>{title(result.route)} · {result.latency_ms.toFixed(1)} ms · {result.attempted} model call(s)</small>
                <small>{result.path.map(title).join(' → ')}</small>
                <small>Tokens: {result.usage.input} in / {result.usage.output} out ({title(result.usage.source)})</small>
                {result.estimated_usd!==null&&<small>Estimated model cost: ${result.estimated_usd.toFixed(6)}</small>}
              </div>}
              <label className="stage">Review stage<select value={selected.stage} disabled={busy} onChange={e=>run(()=>api('/leads/'+selected.id,{method:'PATCH',body:JSON.stringify({stage:e.target.value,version:selected.version})}))}>{['new','shortlisted','review','archived'].map(x=><option key={x}>{x}</option>)}</select></label>
              <h3>Activity</h3><ul className="activity">{audit.map((event,i)=><li key={i}>{title(event.action)}<small>{new Date(event.created_at).toLocaleString()}</small></li>)}</ul>
              {!audit.length&&<p className="empty">No activity yet.</p>}
            </>}
          </section>
        </div>
        {selected&&<ProposalBuilder key={selected.id} lead={selected} api={api} run={run} busy={busy} revision={revision} onError={setError}/>}
      </>}
      {view==='Inventory'&&<section className="card"><h2>Venue availability</h2><p>Check venue capacity and date availability before planning an event.</p>
        <label className="day-filter">Availability date<input type="date" value={inventoryDay} onChange={e=>{if(e.target.value)setInventoryDay(e.target.value)}}/></label>
        <div className="table-scroll"><table><thead><tr><th>Venue</th><th>Market</th><th>Capacity</th><th>Amenities</th><th>Base rental</th><th>Availability</th></tr></thead>
        <tbody>{inventory.map(row=><tr key={row.id}><td>{row.name}</td><td>{row.city}, {row.region}</td><td>{row.capacity}</td><td>{row.amenities.join(', ')}</td>
        <td>{dollars.format(row.base_cents/100)}</td><td><span className={'tag '+(row.available?'available':'')}>{row.available?'Available':'Unavailable'}</span></td></tr>)}</tbody></table></div></section>}
      {view==='Data sources'&&<section className="card"><h2>Sources and imports</h2><p>Use the bundled synthetic source for this work sample. Source permissions are checked at intake and qualification.</p>
        <div className="table-scroll"><table><thead><tr><th>Source</th><th>Permitted use</th><th>Review by</th><th>Terms reference</th></tr></thead><tbody>{sources.map(s=><tr key={s.id}><td>{s.name}</td><td>{title(s.permitted_use)}</td><td>{String(s.review_by).slice(0,10)}</td><td>{s.terms_reference}</td></tr>)}</tbody></table></div>
        <label className="file">Import a synthetic CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={upload}/></label>
        {importResult&&<div className="result"><strong>Latest import</strong><p>{importResult.received} rows · {importResult.accepted} accepted · {importResult.rejected} rejected</p><ul>{importResult.errors?.map(x=><li key={x.record_number}>Record {x.record_number}: {x.reason}</li>)}</ul></div>}
      </section>}
      <footer>Independent portfolio project · Synthetic leads, venues, and bookings</footer>
    </main>
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);
