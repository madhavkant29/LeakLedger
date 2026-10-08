"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Status } from "@/components/Status";
import { api, fmt } from "@/lib/api";
import { getUser } from "@/lib/user";

type Balance = {
  inflow_m3:number; measured_children_m3:number; known_unmetered_m3:number; storage_change_m3:number;
  residual_m3:number; residual_ratio:number; coverage:number; completeness:number; freshness_seconds:number; alignment_valid:boolean;
  evidence_quality:string; explanation:string;
};

type Incident = {
  id:string; status:string; deepest_trustworthy_node_id:string; boundary_explanation:string;
  residual_m3:number; residual_ratio:number; persistence_count:number; evidence_quality:string;
  verification_valid_intervals:number; verification_required_intervals:number;
  current_balance?:Balance|null;
  events:{timestamp:string;event_type:string;actor:string;detail:string;payload?:Record<string,unknown>}[];
  repair?:{actor:string;repair_type:string;location:string;notes:string;cost?:number|null;cause?:string|null}|null;
};

type Filter = "ACTIVE"|"VERIFYING"|"RESOLVED"|"EVIDENCE";

export default function Incidents(){
  const [rows,setRows]=useState<Incident[]>([]); const [selectedId,setSelectedId]=useState<string|null>(null);
  const [filter,setFilter]=useState<Filter>("ACTIVE"); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true); const [showRepair,setShowRepair]=useState(false);
  const [repair,setRepair]=useState({repair_type:"Pipe / valve repair",location:"Hostel B common distribution",notes:"Repair completed and line returned to service.",cause:"",cost:""});
  const load=()=>api<Incident[]>('/sites/northbridge/incidents').then(r=>{setRows(r);setSelectedId(prev=>prev&&r.some(x=>x.id===prev)?prev:(r[0]?.id||null));setError("")}).catch(e=>setError(e instanceof Error?e.message:String(e))).finally(()=>setLoading(false));
  useEffect(()=>{load();const t=setInterval(load,2200);return()=>clearInterval(t)},[]);
  const filtered=useMemo(()=>rows.filter(r=>{
    if(filter==="VERIFYING") return r.status==="VERIFYING"||r.status==="REPAIR_REPORTED";
    if(filter==="RESOLVED") return r.status==="RESOLVED"||r.status==="REPAIR_FAILED";
    if(filter==="EVIDENCE") return r.status==="EVIDENCE_INSUFFICIENT";
    return !["RESOLVED","REPAIR_FAILED"].includes(r.status);
  }),[rows,filter]);
  useEffect(()=>{if(filtered.length===0){setSelectedId(null)}else if(!selectedId||!filtered.some(x=>x.id===selectedId)){setSelectedId(filtered[0].id)}},[filter,rows,filtered,selectedId]);
  const selected=rows.find(x=>x.id===selectedId)||null;
  const act=async(action:string)=>{if(!selected)return;setBusy(true);setError("");try{await api(`/incidents/${selected.id}/${action}`,{method:'POST',body:JSON.stringify({actor:getUser().name})});await load()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
  const submitRepair=async()=>{if(!selected)return;setBusy(true);setError("");try{const u=getUser();await api(`/incidents/${selected.id}/repair`,{method:'POST',body:JSON.stringify({actor:u.name,repair_type:repair.repair_type,location:repair.location,notes:repair.notes,cause:repair.cause||null,cost:repair.cost?Number(repair.cost):null})});setShowRepair(false);await load()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
  return <AppShell><div className="page"><PageHeader title="Incidents" description="Evidence-backed operational cases. A repair report starts verification; it never closes the incident by itself."/>
    {error&&<div className="card error-banner">{error}</div>}
    <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>{([['ACTIVE','Active'],['VERIFYING','Verifying'],['RESOLVED','Resolved'],['EVIDENCE','Evidence issues']] as [Filter,string][]).map(([k,label])=><button key={k} className={`btn ${filter===k?'btn-primary':''}`} onClick={()=>setFilter(k)}>{label}</button>)}</div>
    <div className="incident-layout"><div className="card" style={{padding:10}}>{loading?<div className="empty-state">Loading incidents…</div>:filtered.length===0?<div className="empty-state">No incidents in this view.</div>:filtered.map(r=><button key={r.id} onClick={()=>setSelectedId(r.id)} style={{width:'100%',textAlign:'left',background:selected?.id===r.id?'#14231e':'transparent',border:selected?.id===r.id?'1px solid #315448':'1px solid transparent',borderRadius:8,padding:14,color:'inherit',marginBottom:6}}><div style={{display:'flex',justifyContent:'space-between',gap:10}}><strong>{r.id}</strong><Status value={r.status}/></div><div style={{fontSize:13,marginTop:8}}>{r.deepest_trustworthy_node_id}</div><div className="muted" style={{fontSize:12,marginTop:4}}>{fmt(r.residual_m3)} m³ unexplained</div></button>)}</div>
    <div className="card" style={{padding:22,minHeight:560}}>{selected?<><div style={{display:'flex',justifyContent:'space-between',gap:20,alignItems:'flex-start'}}><div><div className="kicker">{selected.id}</div><h2 style={{fontSize:30,margin:'8px 0 4px'}}>{selected.deepest_trustworthy_node_id}</h2><p className="muted" style={{maxWidth:760,lineHeight:1.6}}>{selected.boundary_explanation}</p></div><Status value={selected.status}/></div>
      <div className="grid-4" style={{marginTop:20}}><Box label="Unexplained" value={`${fmt(selected.residual_m3)} m³`}/><Box label="Residual ratio" value={`${(selected.residual_ratio*100).toFixed(1)}%`}/><Box label="Persistence" value={`${selected.persistence_count} intervals`}/><Box label="Evidence" value={selected.evidence_quality}/></div>
      <Evidence balance={selected.current_balance}/>
      <div style={{display:'flex',gap:8,marginTop:18,flexWrap:'wrap'}}><button className="btn" disabled={busy} onClick={()=>act('acknowledge')}>Acknowledge</button><button className="btn" disabled={busy} onClick={()=>act('investigate')}>Start investigation</button><button className="btn btn-primary" disabled={busy||["VERIFYING","RESOLVED","REPAIR_FAILED"].includes(selected.status)} onClick={()=>setShowRepair(v=>!v)}>Record repair</button></div>
      {showRepair&&<div className="card2 repair-form" style={{padding:18,marginTop:16}}><div><strong>Repair report</strong><div className="muted" style={{fontSize:12,marginTop:4}}>Submitting this moves the incident to VERIFYING. It does not resolve it.</div></div><div className="grid-2" style={{marginTop:14}}><Field label="Repair type" value={repair.repair_type} set={v=>setRepair({...repair,repair_type:v})}/><Field label="Location" value={repair.location} set={v=>setRepair({...repair,location:v})}/><Field label="Physical cause (optional)" value={repair.cause} set={v=>setRepair({...repair,cause:v})}/><Field label="Cost (optional)" type="number" value={repair.cost} set={v=>setRepair({...repair,cost:v})}/></div><label style={{display:'block',marginTop:12}}><span className="field-label">Notes</span><textarea className="input" rows={4} value={repair.notes} onChange={(e:ChangeEvent<HTMLTextAreaElement>)=>setRepair({...repair,notes:e.target.value})}/></label><div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:12}}><button className="btn" onClick={()=>setShowRepair(false)}>Cancel</button><button className="btn btn-primary" disabled={busy||!repair.repair_type.trim()||!repair.location.trim()||!repair.notes.trim()} onClick={submitRepair}>{busy?'Recording…':'Submit repair'}</button></div></div>}
      {selected.status==='VERIFYING'&&<div className="card2" style={{padding:16,marginTop:18}}><strong>Repair verification</strong><div className="muted" style={{marginTop:5}}>Healthy intervals: {selected.verification_valid_intervals}/{selected.verification_required_intervals}. New valid meter evidence must complete the entire streak.</div>{selected.repair&&<div style={{marginTop:10,fontSize:13}}><span className="muted">Reported by </span><strong>{selected.repair.actor}</strong><span className="muted"> · {selected.repair.repair_type}</span></div>}</div>}
      <div style={{marginTop:26}}><div className="kicker">Incident timeline</div><div style={{marginTop:10}}>{selected.events?.slice().reverse().map((e,i)=><div key={`${e.timestamp}-${i}`} className="incident-event"><span className="muted">{new Date(e.timestamp).toLocaleString()}</span><strong>{e.event_type}</strong><span>{e.detail}<span className="muted"> · {e.actor}</span></span></div>)}</div></div>
    </>:<div className="empty-state">Select an incident to inspect its evidence and lifecycle.</div>}</div></div>
  </div></AppShell>
}
function Evidence({balance}:{balance?:Balance|null}){if(!balance)return <div className="card2" style={{padding:16,marginTop:18}}><strong>Water balance evidence</strong><p className="muted" style={{marginBottom:0}}>No current valid balance is available for this incident boundary.</p></div>;return <div className="card2" style={{padding:18,marginTop:18}}><div className="kicker">Water balance evidence</div><div className="evidence-equation" style={{marginTop:12}}><span><small>Entered</small><strong>{fmt(balance.inflow_m3)} m³</strong></span><b>−</b><span><small>Measured downstream</small><strong>{fmt(balance.measured_children_m3)} m³</strong></span><b>−</b><span><small>Known unmetered</small><strong>{fmt(balance.known_unmetered_m3)} m³</strong></span><b>−</b><span><small>Storage Δ</small><strong>{fmt(balance.storage_change_m3)} m³</strong></span><b>=</b><span><small>Unexplained</small><strong style={{color:Math.abs(balance.residual_m3)>0.05?'var(--danger)':'var(--accent)'}}>{fmt(balance.residual_m3)} m³</strong></span></div><div className="grid-4" style={{marginTop:14}}><Box label="Coverage" value={`${Math.round(balance.coverage*100)}%`}/><Box label="Completeness" value={`${Math.round(balance.completeness*100)}%`}/><Box label="Reading freshness" value={`${Math.round(balance.freshness_seconds)} sec`}/><Box label="Clock alignment" value={balance.alignment_valid?'VALID':'INVALID'}/><Box label="Evidence quality" value={balance.evidence_quality}/></div><div className="muted" style={{fontSize:13,lineHeight:1.6,marginTop:14}}>{balance.explanation}</div></div>}
function Box({label,value}:{label:string,value:string}){return <div className="card2" style={{padding:14}}><div className="muted" style={{fontSize:12}}>{label}</div><strong style={{display:'block',marginTop:6,fontSize:19}}>{value}</strong></div>}
function Field({label,value,set,type='text'}:{label:string;value:string;set:(v:string)=>void;type?:string}){return <label><span className="field-label">{label}</span><input className="input" type={type} value={value} onChange={(e:ChangeEvent<HTMLInputElement>)=>set(e.target.value)}/></label>}
