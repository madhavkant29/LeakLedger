"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, BadgeCheck, BookOpen, Boxes, Gauge, ListChecks, Menu, Network, Settings, TestTube2, UserRound, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { getUser, DemoUser } from "@/lib/user";

const links = [
  ["/overview", "Overview", Gauge],
  ["/ledger", "Water Ledger", BookOpen],
  ["/topology", "Topology", Network],
  ["/incidents", "Incidents", ListChecks],
  ["/replay", "Replay Lab", TestTube2],
  ["/validation", "Validation", BadgeCheck],
  ["/meters", "Meter Data", Activity],
  ["/audit", "Audit Trail", Boxes],
  ["/settings", "Settings", Settings],
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user,setUser] = useState<DemoUser | null>(null);
  const [open,setOpen] = useState(false);
  useEffect(()=>setUser(getUser()),[]);
  useEffect(()=>setOpen(false),[pathname]);
  return <div className="app-shell">
    <button className="mobile-nav-button" aria-label="Open navigation" onClick={()=>setOpen(v=>!v)}>{open?<X size={19}/>:<Menu size={19}/>}</button>
    {open&&<button className="mobile-backdrop" aria-label="Close navigation" onClick={()=>setOpen(false)}/>} 
    <aside className={`app-sidebar ${open?"app-sidebar-open":""}`}>
      <div style={{padding:"6px 8px 24px"}}><Logo /></div>
      <nav style={{display:"grid",gap:4}}>{links.map(([href,label,Icon])=>{
        const active = pathname===href;
        return <Link key={href} href={href} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 11px",borderRadius:8,color:active?"var(--text)":"var(--muted)",background:active?"#14231e":"transparent",border:active?"1px solid var(--line)":"1px solid transparent",fontWeight:active?750:600,fontSize:14}}><Icon size={17}/>{label}</Link>
      })}</nav>
      <div style={{marginTop:"auto",borderTop:"1px solid var(--line)",paddingTop:14}}>
        <button onClick={()=>router.push('/signin')} style={{width:"100%",textAlign:"left",background:"transparent",border:0,color:"inherit",padding:8,display:"flex",gap:10,alignItems:"center"}}>
          <span style={{width:34,height:34,borderRadius:9,border:"1px solid var(--line)",display:"grid",placeItems:"center",background:"var(--panel)"}}>{user?.initials || <UserRound size={16}/>}</span>
          <span style={{minWidth:0}}><strong style={{display:"block",fontSize:13}}>{user?.name || "Demo user"}</strong><span className="muted" style={{fontSize:11}}>{user?.role || "Switch user"}</span></span>
        </button>
      </div>
    </aside>
    <main className="app-main">{children}</main>
  </div>
}
