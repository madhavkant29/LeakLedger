export function Logo({ compact=false }: { compact?: boolean }) {
  return <div style={{display:"flex",alignItems:"center",gap:10,fontWeight:850,letterSpacing:"-.03em"}}>
    <span style={{display:"grid",placeItems:"center",width:30,height:30,border:"1px solid #3f6c5d",borderRadius:7,color:"var(--accent)",fontSize:13}}>LL</span>
    {!compact && <span>LeakLedger</span>}
  </div>;
}
