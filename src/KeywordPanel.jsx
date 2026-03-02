import { useState, useEffect, useRef } from "react";

const STOPWORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by","from",
  "is","are","was","were","be","been","being","have","has","had","do","does","did",
  "will","would","could","should","may","might","can","what","how","why","when",
  "where","who","which","that","this","these","those","it","its","their","your",
  "our","my","his","her","we","you","i","they","he","she","us","them","not","no",
  "so","if","as","up","out","about","into","than","then","there","here","more",
  "most","also","just","get","use","using","used","make","all","any","each","both",
  "new","top","best","via","per","whether","while","after","before","between","vs"
]);

function clean(t) { return t.replace(/[^a-zA-Z0-9\s\-]/g," ").replace(/\s+/g," ").trim(); }
function wc(s) { return s.trim().split(/\s+/).filter(Boolean).length; }
function isContent(p) {
  const words = p.toLowerCase().split(/\s+/);
  const meaningful = words.filter(w=>!STOPWORDS.has(w)&&w.length>2);
  return meaningful.length>=1&&p.length>3&&p.length<120;
}
function dedup(arr) {
  const seen=new Set();
  return arr.filter(item=>{ const k=item.toLowerCase().trim(); if(seen.has(k))return false; seen.add(k); return true; });
}

export default function KeywordPanel({ keyword, country, results, serpData, searched, loading, rawOrganic = [] }) {
  const [keywords, setKeywords] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");
  const prevKeyword = useRef("");

  useEffect(() => {
    if (!keyword || keyword === prevKeyword.current) return;
    prevKeyword.current = keyword;
    if (!results?.length && !serpData) return;
    processKeywords();
  }, [keyword, results, serpData]);

  const processKeywords = async () => {
    setProcessing(true);
    setKeywords(null);

    const allHeadings = (results||[]).flatMap(r =>
      ["h1","h2","h3","h4","h5","h6"].flatMap(hk =>
        Array.isArray(r[hk]) ? r[hk].filter(h=>h&&h!=="—"&&h!=="...") : []
      )
    ).map(clean).filter(Boolean);

    // Also extract phrases from SerpAPI snippets — works even for JS-rendered sites
    const snippetPhrases = rawOrganic
      .map(r => r.snippet || "")
      .flatMap(s => s.split(/[.!?]+/).map(p => clean(p.trim())))
      .filter(p => p.length > 4 && p.length < 120 && isContent(p));

    const secondary = dedup(
      ((serpData?.related_searches)||[]).map(r=>r.query||"").filter(q=>q&&q.toLowerCase()!==keyword.toLowerCase())
    ).slice(0,12);

    const paaLongTail = ((serpData?.related_questions)||[]).map(q=>q.question||"").filter(Boolean);
    const headingLongTail = allHeadings.filter(h=>wc(h)>=5&&isContent(h));
    const longTail = dedup([...paaLongTail,...headingLongTail]).slice(0,20);

    const freq = (phrase) => (results||[]).filter(r =>
      ["h1","h2","h3","h4","h5","h6"].some(hk =>
        Array.isArray(r[hk])&&r[hk].some(t=>t?.toLowerCase().includes(phrase.toLowerCase()))
      )
    ).length;

    const shortTail = dedup(
      allHeadings
        .filter(h=>{ const n=wc(h); return n>=1&&n<=3&&isContent(h); })
        .sort((a,b)=>freq(b)-freq(a))
    ).slice(0,15);

    let related=[], synonyms=[];
    try {
      const [r1,r2] = await Promise.all([
        fetch(`https://api.datamuse.com/words?ml=${encodeURIComponent(keyword)}&max=20`).then(r=>r.json()),
        fetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(keyword.split(" ")[0])}&max=12`).then(r=>r.json()),
      ]);
      related = r1.map(w=>w.word).filter(w=>!STOPWORDS.has(w));
      synonyms = r2.map(w=>w.word).filter(w=>!STOPWORDS.has(w));
    } catch {}

    setKeywords({ primary:keyword, secondary, longTail, shortTail, related, synonyms });
    setProcessing(false);
  };

  const getFreq = (phrase) => (results||[]).filter(r =>
    ["h1","h2","h3","h4","h5","h6"].some(hk =>
      Array.isArray(r[hk])&&r[hk].some(t=>t?.toLowerCase().includes(phrase.toLowerCase()))
    )
  ).length;

  const getCSV = () => {
    if (!keywords) return "";
    const rows = [
      ["Category","Keyword","Source","Frequency"],
      ["Primary",keywords.primary,"User Search","—"],
      ...keywords.secondary.map(k=>["Secondary",k,"Google Related Searches","—"]),
      ...keywords.longTail.map(k=>["Long Tail",k,"PAA / Headings",getFreq(k)]),
      ...keywords.shortTail.map(k=>["Short Tail",k,"Page Headings",getFreq(k)]),
      ...keywords.related.map(k=>["Related",k,"Datamuse API","—"]),
      ...keywords.synonyms.map(k=>["Synonym",k,"Datamuse API","—"]),
    ].map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    return rows;
  };

  const downloadCSV = () => {
    const blob = new Blob([getCSV()],{type:"text/csv;charset=utf-8;"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `keywords-${(keywords?.primary||"").replace(/\s+/g,"-")}.csv`;
    a.click();
  };

  const copyCSV = () => {
    navigator.clipboard.writeText(getCSV());
    setCopyMsg("Copied!"); setTimeout(()=>setCopyMsg(""),2000);
  };

  const sections = keywords ? [
    { label:"Primary Keyword", key:"primary", color:"#8b5cf6", border:"#6366f1", isString:true, desc:"The keyword you searched" },
    { label:"Secondary Keywords", key:"secondary", color:"#0ea5e9", border:"#2563eb", desc:"From Google related searches" },
    { label:"Long Tail Keywords", key:"longTail", color:"#22c55e", border:"#16a34a", desc:"4+ word phrases from PAA and headings" },
    { label:"Short Tail Keywords", key:"shortTail", color:"#f59e0b", border:"#d97706", desc:"1–3 word phrases from page headings" },
    { label:"Related Keywords", key:"related", color:"#ec4899", border:"#db2777", desc:"Semantically related via Datamuse" },
    { label:"Synonyms", key:"synonyms", color:"#14b8a6", border:"#0d9488", desc:"Alternate terms via Datamuse" },
  ] : [];

  const tag = (color,border) => ({
    display:"inline-flex", alignItems:"center", gap:6,
    background:`${color}15`, border:`1px solid ${border}40`,
    borderRadius:7, padding:"5px 12px", fontSize:12,
    color, fontWeight:500, margin:"4px",
  });

  // Not searched yet
  if (!searched && !loading) return (
    <div style={{ textAlign:"center", padding:"70px 20px" }}>
      <div style={{ fontSize:15, color:"#475569", fontWeight:500, marginBottom:8 }}>Search a keyword first to see keyword analysis</div>
      <div style={{ fontSize:12, color:"#2d3f55" }}>Results will automatically appear here after searching on SERP Scraper tab</div>
    </div>
  );

  // Loading serp results
  if (loading || processing) return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      {[...Array(6)].map((_,i)=>(
        <div key={i} style={{ background:"#1e293b", borderRadius:12, padding:"20px 24px", opacity:1-i*0.1, border:"1px solid #1e293b" }}>
          <div style={{ height:13, background:"#334155", borderRadius:4, width:"22%", marginBottom:14 }} />
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {[...Array(5)].map((_,j)=><div key={j} style={{ height:30, width:`${55+j*18}px`, background:"#243044", borderRadius:7 }} />)}
          </div>
        </div>
      ))}
      <div style={{ textAlign:"center", fontSize:12, color:"#475569", marginTop:4 }}>
        {loading?"Fetching SERP results...":"Analyzing keywords from SERP data + Datamuse API..."}
      </div>
    </div>
  );

  return (
    <div>
      {/* Meta bar */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div style={{ fontSize:13, color:"#64748b", display:"flex", alignItems:"center", gap:10 }}>
          <span>Keywords for <span style={{ color:"#fff", fontWeight:600 }}>"{keyword}"</span></span>
          <span style={{ background:country?.gl==="us"?"#1e3a5f":"#1a2e1a", border:`1px solid ${country?.gl==="us"?"#2563eb":"#22c55e"}`, borderRadius:6, padding:"2px 10px", fontSize:11, color:country?.gl==="us"?"#7dd3fc":"#86efac", fontWeight:600 }}>
            {country?.label}
          </span>
        </div>
        {keywords && (
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={downloadCSV} style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:9, padding:"7px 16px", color:"#94a3b8", fontSize:12, cursor:"pointer", fontWeight:600 }}>Download CSV</button>
            <button onClick={copyCSV} style={{ background:copyMsg?"#0f2318":"#1e293b", border:`1px solid ${copyMsg?"#22c55e":"#334155"}`, borderRadius:9, padding:"7px 16px", color:copyMsg?"#22c55e":"#94a3b8", fontSize:12, cursor:"pointer", fontWeight:600, transition:"all 0.2s" }}>
              {copyMsg||"Copy Sheet"}
            </button>
          </div>
        )}
      </div>

      {/* Sections */}
      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {sections.map(({label,key,color,border,isString,desc})=>{
          const items = isString?[keywords[key]]:keywords[key];
          return (
            <div key={key} style={{ background:"#1e293b", border:`1px solid ${border}25`, borderRadius:14, padding:"18px 22px", boxShadow:"0 4px 20px rgba(0,0,0,0.2)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:9, height:9, borderRadius:"50%", background:color, boxShadow:`0 0 7px ${color}` }} />
                    <span style={{ fontSize:13, fontWeight:700, color:"#e2e8f0" }}>{label}</span>
                    <span style={{ background:`${color}20`, border:`1px solid ${color}40`, borderRadius:50, padding:"2px 9px", fontSize:11, color, fontWeight:600 }}>{items.length}</span>
                  </div>
                  <div style={{ fontSize:11, color:"#475569", marginTop:3, marginLeft:19 }}>{desc}</div>
                </div>
              </div>
              <div style={{ display:"flex", flexWrap:"wrap" }}>
                {!items.length
                  ?<span style={{ color:"#334155", fontSize:12, fontStyle:"italic" }}>No data found</span>
                  :items.map((item,idx)=>{
                    const fr = !isString&&(key==="longTail"||key==="shortTail")?getFreq(item):null;
                    return (
                      <span key={idx} style={tag(color,border)}>
                        {item}
                        {fr!==null&&fr>0&&<span style={{ background:`${color}25`, borderRadius:4, padding:"1px 6px", fontSize:10, fontWeight:700 }}>{fr}/12</span>}
                      </span>
                    );
                  })
                }
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10, marginTop:16 }}>
        {[["Secondary",keywords?.secondary?.length||0,"#0ea5e9"],["Long Tail",keywords?.longTail?.length||0,"#22c55e"],["Short Tail",keywords?.shortTail?.length||0,"#f59e0b"],["Related",keywords?.related?.length||0,"#ec4899"],["Synonyms",keywords?.synonyms?.length||0,"#14b8a6"]].map(([l,c,col])=>(
          <div key={l} style={{ background:"#1e293b", border:"1px solid #1e293b", borderRadius:12, padding:"14px", textAlign:"center" }}>
            <div style={{ fontSize:24, fontWeight:800, color:col }}>{c}</div>
            <div style={{ fontSize:11, color:"#475569", marginTop:3, fontWeight:500 }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
