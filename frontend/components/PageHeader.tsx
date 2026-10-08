export function PageHeader({eyebrow,title,description,actions}:{eyebrow?:string,title:string,description:string,actions?:React.ReactNode}){
  return <div style={{display:"flex",justifyContent:"space-between",gap:24,alignItems:"flex-start",marginBottom:24}}>
    <div><div className="kicker">{eyebrow || "Northbridge University Campus"}</div><h1 style={{fontSize:32,letterSpacing:"-.04em",margin:"8px 0 7px"}}>{title}</h1><p className="muted" style={{margin:0,maxWidth:760,lineHeight:1.6}}>{description}</p></div>
    {actions && <div style={{display:"flex",gap:8}}>{actions}</div>}
  </div>
}
