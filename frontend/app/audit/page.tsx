"use client";
import { useEffect,useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";

type AuditRow={timestamp:string;event_type:string;actor:string;detail:string;correlation_id?:string|null;payload?:Record<string,unknown>|null};

export default function Audit(){
  const [rows,setRows]=useState<AuditRow[]>([]); const [expanded,setExpanded]=useState<number|null>(null); const [error,setError]=useState(""); const [loading,setLoading]=useState(true);
  useEffect(()=>{const f=()=>api<AuditRow[]>('/sites/northbridge/audit?limit=250').then(r=>{setRows(r);setError("")}).catch(e=>setError(e instanceof Error?e.message:String(e))).finally(()=>setLoading(false));f();const t=setInterval(f,2500);return()=>clearInterval(t)},[]);
  return <AppShell><div className="page"><PageHeader title="Audit trail" description="A chronological explanation of the evidence path: readings, reconciliation outcomes, incidents, repairs and verification events."/>
    {error&&<div className="card error-banner">{error}</div>}
    <div className="card table-wrap">{loading?<div className="empty-state">Loading audit events…</div>:rows.length===0?<div className="empty-state">No audit events yet. Run a replay or ingest readings to populate the evidence trail.</div>:<table className="table"><thead><tr><th>Time</th><th>Event</th><th>Actor</th><th>Detail</th><th>Correlation</th></tr></thead><tbody>{rows.map((r,i)=><AuditItem key={`${r.timestamp}-${r.event_type}-${i}`} row={r} open={expanded===i} toggle={()=>setExpanded(expanded===i?null:i)}/>)}</tbody></table>}</div>
  </div></AppShell>;
}
function AuditItem({row,open,toggle}:{row:AuditRow;open:boolean;toggle:()=>void}){return <><tr onClick={toggle} style={{cursor:'pointer'}} title="Click to inspect event payload"><td style={{whiteSpace:'nowrap'}}>{new Date(row.timestamp).toLocaleString()}</td><td><strong>{row.event_type}</strong></td><td>{row.actor||'system'}</td><td>{row.detail}</td><td className="muted" style={{fontSize:11}}>{row.correlation_id||'—'}</td></tr>{open&&<tr><td colSpan={5} style={{background:'#08120f'}}><div className="kicker">Event payload</div><pre className="audit-payload">{JSON.stringify({timestamp:row.timestamp,event_type:row.event_type,actor:row.actor,detail:row.detail,correlation_id:row.correlation_id,payload:row.payload||{}},null,2)}</pre></td></tr>}</>}
