export function Status({value}:{value?:string|null}) { const v=value||"UNKNOWN"; return <span className={`status status-${v}`}>{v.replaceAll('_',' ')}</span>; }
