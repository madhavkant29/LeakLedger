"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Logo } from "@/components/Logo";
import { USERS } from "@/lib/user";

export default function SignIn(){
  const router=useRouter();
  const choose=(id:string)=>{localStorage.setItem('leakledger-user',id);router.push('/overview')};
  return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24}}><div style={{width:"100%",maxWidth:920}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:34}}><Logo/><Link href="/" className="muted" style={{display:"flex",alignItems:"center",gap:7,fontSize:14}}><ArrowLeft size={15}/>Back to site</Link></div><div className="kicker">Demo identity selector</div><h1 style={{fontSize:42,letterSpacing:"-.045em",margin:"10px 0"}}>Choose who is operating LeakLedger.</h1><p className="muted" style={{maxWidth:700,lineHeight:1.6}}>This hackathon environment intentionally performs no authentication. Identity only changes the demo persona and records the actor in operational actions.</p><div className="card2" style={{padding:12,margin:"22px 0",color:"var(--warn)",fontSize:13}}>Demo environment — identities are simulated and no authentication or authorization is performed.</div><div className="persona-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14}}>{USERS.map(u=><button key={u.id} onClick={()=>choose(u.id)} className="card" style={{textAlign:"left",padding:22,color:"inherit",transition:'.15s ease'}}><div style={{width:48,height:48,borderRadius:11,display:"grid",placeItems:"center",background:"#152720",border:"1px solid #2f5246",color:"var(--accent)",fontWeight:850}}>{u.initials}</div><h2 style={{fontSize:20,margin:"20px 0 4px"}}>{u.name}</h2><div style={{color:"var(--accent)",fontSize:13,fontWeight:750}}>{u.role}</div><p className="muted" style={{minHeight:58,lineHeight:1.5,fontSize:13}}>{u.description}</p><div style={{display:"flex",alignItems:"center",gap:7,fontWeight:800,fontSize:13}}>Continue as {u.name.split(' ')[0]} <ArrowRight size={15}/></div></button>)}</div></div></main>
}
