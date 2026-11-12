import React,{useEffect,useState} from 'react';

const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const fmt=cents=>money.format(cents/100);
export function tomorrow(){
  return new Date(Date.now()+86400000).toISOString().slice(0,10);
}
const label=x=>x.replaceAll('_',' ');
const addons={av:'AV package',catering:'Catering',parking:'Parking'};
export default function ProposalBuilder({lead,api,run,busy,revision,onError}){
  const [day,setDay]=useState(tomorrow);
  const [guests,setGuests]=useState('60');
  const [extras,setExtras]=useState([]);
  const [plan,setPlan]=useState(null);
  const [proposals,setProposals]=useState([]);
  const [feedback,setFeedback]=useState('');
  const route='/leads/'+lead.id;
  useEffect(()=>{
    const c=new AbortController();
    api(route+'/proposals',{signal:c.signal}).then(setProposals).catch(e=>{if(e.name!=='AbortError')onError(e.message);});
    return()=>c.abort();
  },[route,revision]);
  function revise(fn){return value=>{fn(value);setPlan(null);setFeedback('');};}
  function planEvent(event){
    event.preventDefault();setFeedback('');
    run(async()=>{
      const result=await api(route+'/plan',{method:'POST',body:JSON.stringify({day,guests:Number(guests),addons:extras})});
      setPlan({...result,guests:Number(guests),addons:[...extras],options:result.options.map(x=>({...x,key:crypto.randomUUID()}))});
    });
  }
  function hold(option){
    run(async()=>{
      await api(route+'/proposals',{method:'POST',body:JSON.stringify({day:option.day,guests:plan.guests,addons:plan.addons,
        venue_id:option.id,request_key:option.key,lead_version:plan.lead_version})});
      setFeedback('Date held for 30 minutes. Review it below.');
      setPlan(null);
    });
  }
  function decide(id,action){
    run(async()=>{
      await api(route+'/proposals/'+id,{method:'PATCH',body:JSON.stringify({action})});
      setFeedback(action==='approve'?'Demo booking approved.':'Hold released.');
      setPlan(null);
    });
  }
  return <section className="card proposal-builder" aria-label="Event proposal builder">
    <div className="eyebrow">PROPOSAL STUDIO</div>
    <h2>Plan an event for {lead.company}</h2>
    <p>Compare available venues and itemized quotes before reserving a date.</p>
    <form className="brief" onSubmit={planEvent}>
      <label>Requested date<input required type="date" value={day} onChange={e=>revise(setDay)(e.target.value)}/></label>
      <label>Guest count<input required type="number" min="1" max="1000" value={guests} onChange={e=>revise(setGuests)(e.target.value)}/></label>
      <fieldset><legend>Requested add-ons</legend>{Object.entries(addons).map(([id,name])=><label className="check" key={id}>
        <input type="checkbox" checked={extras.includes(id)} onChange={e=>revise(setExtras)(e.target.checked?[...extras,id]:extras.filter(x=>x!==id))}/>{name}</label>)}</fieldset>
      <button className="primary" disabled={busy}>Compare venues</button>
    </form>
    {feedback&&<p role="status" className="notice">{feedback}</p>}
    {plan&&<div aria-live="polite" className="plan">
      <div className="result"><h3>Decision brief</h3><p>{plan.reason}</p>
        {plan.quote&&<blockquote>“{plan.quote}”</blockquote>}
        {plan.blockers.length>0&&<><strong>Review first</strong><ul>{plan.blockers.map(x=><li key={x}>{x}</li>)}</ul></>}
        {plan.actions.length>0&&<><strong>Next steps</strong><ul>{plan.actions.map(x=><li key={x}>{x}</li>)}</ul></>}
        <small>{plan.path.map(label).join(' → ')}</small>
      </div>
      {plan.options.length>0&&<div className="option-grid">{plan.options.map(option=><article className="quote-card" key={option.key}>
        <span className="tag">{option.date_offset?'Alternate date':'Requested date'}</span>
        <h3>{option.name}</h3><p>{option.city} · {option.day} · Up to {option.capacity} guests</p>
        <dl>{option.items.map(item=><div key={item.item}><dt>{addons[item.item]??item.item}</dt><dd>{fmt(item.cents)}</dd></div>)}
        <div className="quote-total"><dt>Total</dt><dd>{fmt(option.total_cents)}</dd></div></dl>
        <small>Budget: {option.budget_status==='within'?'within budget':option.budget_status==='over'?'over budget':'unconfirmed'}</small>
        <button disabled={busy||!option.hold_allowed} onClick={()=>hold(option)}>Hold for 30 minutes</button>
      </article>)}</div>}
    </div>}
    <h3>Holds and bookings</h3>
    {proposals.length===0?<p className="empty">No proposals have been held for this lead.</p>:<div className="table-scroll"><table><thead><tr><th>Venue</th><th>Date</th><th>Quote</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{proposals.map(p=><tr key={p.id}><td>{p.venue_name}</td><td>{p.day}</td><td>{fmt(p.total_cents)}</td><td>
        <span className="tag">{p.effective_status}</span>{p.effective_status==='held'&&<small>Until {new Date(p.expires_at).toLocaleTimeString()}</small>}</td>
        <td>{p.effective_status==='held'&&<div className="actions">
          <button className="primary" disabled={busy} onClick={()=>decide(p.id,'approve')}>Approve booking</button>
          <button disabled={busy} onClick={()=>decide(p.id,'release')}>Release</button>
        </div>}</td></tr>)}</tbody></table></div>}
  </section>;
}
