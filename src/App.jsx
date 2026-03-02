import { useState, useCallback } from "react";
import KeywordPanel from "./KeywordPanel";

const PROXY = process.env.REACT_APP_PROXY_URL || "https://serp-proxy-true.onrender.com/serp";
const SCRAPER = process.env.REACT_APP_SCRAPER_URL || "https://serp-proxy-true.onrender.com/scrape-headings";

const COUNTRIES = [
  { label: "USA", gl: "us", hl: "en" },
  { label: "India", gl: "in", hl: "en" },
];

async function fetchHeadings(url, serpTitle) {
  const h1Fallback = serpTitle ? [serpTitle] : ["—"];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 25s timeout
    const res = await fetch(`${SCRAPER}?url=${encodeURIComponent(url)}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { h1: h1Fallback, h2:["—"],h3:["—"],h4:["—"],h5:["—"],h6:["—"] };
    const data = await res.json();
    return {
      h1: Array.isArray(data.h1) && data.h1.length && data.h1[0] !== "—" ? data.h1 : h1Fallback,
      h2: Array.isArray(data.h2) && data.h2.length && data.h2[0] !== "—" ? data.h2 : ["—"],
      h3: Array.isArray(data.h3) && data.h3.length && data.h3[0] !== "—" ? data.h3 : ["—"],
      h4: Array.isArray(data.h4) && data.h4.length && data.h4[0] !== "—" ? data.h4 : ["—"],
      h5: Array.isArray(data.h5) && data.h5.length && data.h5[0] !== "—" ? data.h5 : ["—"],
      h6: Array.isArray(data.h6) && data.h6.length && data.h6[0] !== "—" ? data.h6 : ["—"],
    };
  } catch {
    return { h1: h1Fallback, h2:["—"],h3:["—"],h4:["—"],h5:["—"],h6:["—"] };
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState("serp");
  const [keyword, setKeyword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingHeadings, setLoadingHeadings] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [activeKeyword, setActiveKeyword] = useState("");
  const [totalResults, setTotalResults] = useState(null);
  const [serpData, setSerpData] = useState(null);
  const [copyMsg, setCopyMsg] = useState("");

  const handleSearch = useCallback(async () => {
    if (!keyword.trim()) return setError("Please enter a keyword.");
    if (!apiKey.trim()) return setError("Please enter your SerpAPI key.");
    setError("");
    setSearched(true);
    setResults([]);
    setSerpData(null);
    setTotalResults(null);
    setActiveKeyword(keyword.trim());
    setLoading(true);
    setLoadingHeadings(false);

    try {
      const [res1, res2] = await Promise.all([
        fetch(`${PROXY}?q=${encodeURIComponent(keyword.trim())}&api_key=${encodeURIComponent(apiKey.trim())}&start=0&num=10&hl=${country.hl}&gl=${country.gl}`),
        fetch(`${PROXY}?q=${encodeURIComponent(keyword.trim())}&api_key=${encodeURIComponent(apiKey.trim())}&start=10&num=10&hl=${country.hl}&gl=${country.gl}`),
      ]);
      if (!res1.ok) throw new Error(`Server error: ${res1.status}`);
      const [data1, data2] = await Promise.all([res1.json(), res2.json()]);
      if (data1.error) throw new Error(data1.error);

      let organic = [...(data1.organic_results || []), ...(data2.organic_results || [])];
      if (organic.length < 12) {
        try {
          const res3 = await fetch(`${PROXY}?q=${encodeURIComponent(keyword.trim())}&api_key=${encodeURIComponent(apiKey.trim())}&start=20&num=10&hl=${country.hl}&gl=${country.gl}`);
          const data3 = await res3.json();
          organic.push(...(data3.organic_results || []));
        } catch {}
      }
      const finalOrganic = organic.slice(0, 12);
      if (!finalOrganic.length) throw new Error("No organic results found.");

      if (data1.search_information?.total_results) setTotalResults(data1.search_information.total_results);
      setSerpData({ related_searches: data1.related_searches || [], related_questions: data1.related_questions || [] });

      const mapped = finalOrganic.map((item, i) => {
        const link = item.link || "";
        let domain = "";
        try { domain = new URL(link).hostname.replace("www.", ""); } catch {}
        return {
          rank: i + 1,
          h1: item.title ? [item.title] : ["—"],
          h2:["—"],h3:["—"],h4:["—"],h5:["—"],h6:["—"],
          headingsLoaded: false,
          site_name: item.source || domain,
          domain: domain || "—",
          url: link,
          title: item.title || "",
          date: item.date || null,
          snippet: item.snippet || "",
        };
      });

      setResults(mapped);
      setLoading(false);
      setLoadingHeadings(true);

      // Wake up the scraper server first (Render free tier sleeps)
      try { await fetch(SCRAPER.replace("/scrape-headings", "/"), { signal: AbortSignal.timeout(30000) }); } catch {}

      // Fetch H2-H6 sequentially, H1 already set from SerpAPI
      const enriched = [...mapped];
      for (let i = 0; i < enriched.length; i++) {
        const headings = await fetchHeadings(enriched[i].url, enriched[i].title);
        enriched[i] = { ...enriched[i], ...headings, headingsLoaded: true };
        setResults([...enriched]);
      }
      setLoadingHeadings(false);
    } catch (e) {
      setLoading(false);
      setLoadingHeadings(false);
      if (e.message?.includes("Invalid API key")) setError("Invalid SerpAPI key.");
      else if (e.message?.includes("Monthly Searches Exceeded")) setError("SerpAPI monthly limit exceeded.");
      else if (e.message?.includes("Failed to fetch")) setError("Cannot reach proxy server.");
      else setError(e.message);
    }
  }, [keyword, apiKey, country]);

  const getCSVContent = () => {
    const headers = ["Rank","Site Name","Domain","H1","H2","H3","H4","H5","H6","URL"];
    const rows = results.map(r =>
      [r.rank, r.site_name, r.domain,
        (r.h1||[]).join(" | "),(r.h2||[]).join(" | "),(r.h3||[]).join(" | "),
        (r.h4||[]).join(" | "),(r.h5||[]).join(" | "),(r.h6||[]).join(" | "),r.url]
        .map(v => `"${String(v).replace(/"/g,'""')}"`)
        .join(",")
    );
    return [headers.join(","), ...rows].join("\n");
  };

  const downloadCSV = () => {
    if (!results.length) return;
    const blob = new Blob([getCSVContent()], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `serp-${activeKeyword.replace(/\s+/g,"-")}-${country.label}.csv`;
    a.click();
  };

  const copyCSV = () => {
    if (!results.length) return;
    navigator.clipboard.writeText(getCSVContent());
    setCopyMsg("Copied!"); setTimeout(() => setCopyMsg(""), 2000);
  };

  const rankBg = n => n <= 3 ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : n <= 6 ? "linear-gradient(135deg,#0ea5e9,#2563eb)" : "#1e293b";
  const cell = { padding:"10px 14px", fontSize:12, color:"#94a3b8", borderRight:"1px solid #1a2540", wordBreak:"break-word", lineHeight:1.5 };
  const head = { padding:"10px 14px", fontSize:10, fontWeight:800, color:"#3b5068", textTransform:"uppercase", letterSpacing:"0.08em", borderRight:"1px solid #1a2540", background:"#080e1a", textAlign:"left" };

  return (
    <div style={{ minHeight:"100vh", background:"#0f1117", color:"#e2e8f0", fontFamily:"'Inter',sans-serif", padding:"28px 16px" }}>
      <div style={{ maxWidth:1400, margin:"0 auto" }}>

        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:8, background:"#1e293b", border:"1px solid #22c55e40", borderRadius:50, padding:"5px 16px", marginBottom:12 }}>
            <span style={{ width:7, height:7, borderRadius:"50%", background:"#22c55e", display:"inline-block", boxShadow:"0 0 6px #22c55e" }} />
            <span style={{ fontSize:11, color:"#64748b", letterSpacing:"0.06em" }}>LIVE · SERPAPI · REAL GOOGLE DATA</span>
          </div>
          <h1 style={{ fontSize:28, fontWeight:800, color:"#fff", margin:0, letterSpacing:"-0.5px" }}>SERP Research Tool</h1>
          <p style={{ color:"#64748b", marginTop:6, fontSize:13 }}>Real Google rankings · H1–H6 extraction · Keyword analysis</p>
        </div>

        {/* API Key */}
        <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:"12px 20px", marginBottom:12, display:"flex", gap:12, alignItems:"center" }}>
          <span style={{ fontSize:11, color:"#64748b", whiteSpace:"nowrap", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em" }}>API Key</span>
          <input value={apiKey} onChange={e=>setApiKey(e.target.value)} type={showKey?"text":"password"} placeholder="Paste your SerpAPI key..."
            style={{ flex:1, background:"transparent", border:"none", outline:"none", color:"#e2e8f0", fontSize:13, fontFamily:"monospace" }} />
          <button onClick={()=>setShowKey(p=>!p)} style={{ background:"#0f172a", border:"1px solid #334155", borderRadius:7, padding:"5px 14px", color:"#94a3b8", fontSize:12, cursor:"pointer" }}>
            {showKey?"Hide":"Show"}
          </button>
        </div>

        {/* Search Row */}
        <div style={{ display:"flex", gap:12, marginBottom:20 }}>
          <div style={{ display:"flex", background:"#1e293b", border:"1px solid #334155", borderRadius:12, overflow:"hidden", flexShrink:0 }}>
            {COUNTRIES.map(ct => (
              <button key={ct.gl} onClick={()=>setCountry(ct)}
                style={{ padding:"0 20px", height:"100%", border:"none", background:country.gl===ct.gl?"linear-gradient(135deg,#6366f1,#8b5cf6)":"transparent", color:country.gl===ct.gl?"#fff":"#64748b", fontWeight:700, fontSize:13, cursor:"pointer", transition:"all 0.2s" }}>
                {ct.label}
              </button>
            ))}
          </div>
          <input value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSearch()}
            placeholder="Enter keyword e.g. D2C Shopify Platforms"
            style={{ flex:1, padding:"13px 20px", borderRadius:12, border:"1.5px solid #334155", background:"#1e293b", color:"#e2e8f0", fontSize:15, outline:"none", transition:"border-color 0.2s" }}
            onFocus={e=>e.target.style.borderColor="#6366f1"} onBlur={e=>e.target.style.borderColor="#334155"} />
          <button onClick={handleSearch} disabled={loading}
            style={{ padding:"13px 32px", borderRadius:12, border:loading?"1px solid #334155":"none", background:loading?"#1e293b":"linear-gradient(135deg,#6366f1,#8b5cf6)", color:loading?"#64748b":"#fff", fontSize:15, fontWeight:700, cursor:loading?"not-allowed":"pointer", whiteSpace:"nowrap" }}>
            {loading?"Fetching...":"Search"}
          </button>
        </div>

        {error && <div style={{ background:"#450a0a", border:"1px solid #dc2626", borderRadius:10, padding:"12px 18px", marginBottom:16, color:"#fca5a5", fontSize:13 }}>{error}</div>}

        {/* Tabs */}
        <div style={{ display:"flex", gap:4, marginBottom:20, background:"#1e293b", borderRadius:12, padding:5, border:"1px solid #334155", width:"fit-content" }}>
          {[["serp","SERP Scraper"],["keywords","Keyword Analysis"]].map(([tab, label]) => (
            <button key={tab} onClick={()=>setActiveTab(tab)}
              style={{ padding:"9px 24px", borderRadius:9, border:"none", background:activeTab===tab?"linear-gradient(135deg,#6366f1,#8b5cf6)":"transparent", color:activeTab===tab?"#fff":"#64748b", fontWeight:700, fontSize:13, cursor:"pointer", transition:"all 0.2s", letterSpacing:"0.02em" }}>
              {label}
              {tab==="keywords" && results.length>0 && (
                <span style={{ marginLeft:8, background:"#22c55e", borderRadius:50, padding:"1px 7px", fontSize:10, color:"#fff", fontWeight:800 }}>
                  {activeKeyword?serpData?.related_searches?.length||0:""}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* SERP Tab */}
        {activeTab==="serp" && (
          <>
            {loading && (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {[...Array(8)].map((_,i)=>(
                  <div key={i} style={{ background:"#1e293b", borderRadius:10, padding:"16px 20px", opacity:1-i*0.08 }}>
                    <div style={{ display:"flex", gap:16, alignItems:"center" }}>
                      <div style={{ width:36, height:36, borderRadius:9, background:"#334155", flexShrink:0 }} />
                      <div style={{ flex:1 }}>
                        <div style={{ height:13, background:"#334155", borderRadius:4, width:`${50+(i%3)*14}%`, marginBottom:9 }} />
                        <div style={{ height:11, background:"#243044", borderRadius:4, width:`${28+(i%4)*9}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
                <div style={{ textAlign:"center", fontSize:12, color:"#475569", marginTop:6 }}>Fetching results from Google via SerpAPI...</div>
              </div>
            )}

            {!loading && results.length>0 && (
              <>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                  <div style={{ fontSize:13, color:"#64748b", display:"flex", alignItems:"center", gap:10 }}>
                    <span>Top <span style={{ color:"#a5b4fc", fontWeight:700 }}>{results.length}</span> for <span style={{ color:"#fff", fontWeight:600 }}>"{activeKeyword}"</span></span>
                    <span style={{ background:country.gl==="us"?"#1e3a5f":"#1a2e1a", border:`1px solid ${country.gl==="us"?"#2563eb":"#22c55e"}`, borderRadius:6, padding:"2px 10px", fontSize:11, color:country.gl==="us"?"#7dd3fc":"#86efac", fontWeight:600 }}>
                      {country.label}
                    </span>
                    {loadingHeadings && <span style={{ fontSize:11, color:"#f59e0b", background:"#1c1a0a", border:"1px solid #f59e0b40", borderRadius:6, padding:"2px 10px" }}>Loading H1–H6...</span>}
                    {totalResults && <span style={{ color:"#334155", fontSize:12 }}>~{Number(totalResults).toLocaleString()} results</span>}
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={downloadCSV} style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:9, padding:"7px 16px", color:"#94a3b8", fontSize:12, cursor:"pointer", fontWeight:600 }}>Download CSV</button>
                    <button onClick={copyCSV} style={{ background:copyMsg?"#0f2318":"#1e293b", border:`1px solid ${copyMsg?"#22c55e":"#334155"}`, borderRadius:9, padding:"7px 16px", color:copyMsg?"#22c55e":"#94a3b8", fontSize:12, cursor:"pointer", fontWeight:600, transition:"all 0.2s" }}>
                      {copyMsg||"Copy Sheet"}
                    </button>
                  </div>
                </div>

                <div style={{ overflowX:"auto", borderRadius:14, border:"1px solid #1e293b", boxShadow:"0 8px 32px rgba(0,0,0,0.4)" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", minWidth:1100 }}>
                    <thead>
                      <tr>{["Rank","Site Name","Domain","H1","H2","H3","H4","H5","H6"].map(h=><th key={h} style={head}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {results.map((r,i)=>(
                        <tr key={i} style={{ background:i%2===0?"#1e293b":"#18223a", transition:"background 0.15s" }}
                          onMouseEnter={e=>e.currentTarget.style.background="#1e3155"}
                          onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"#1e293b":"#18223a"}>
                          <td style={{ ...cell, width:60, textAlign:"center" }}>
                            <div style={{ width:36, height:36, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", background:rankBg(r.rank), fontWeight:800, fontSize:14, color:"#fff", margin:"0 auto", boxShadow:r.rank<=3?"0 2px 10px rgba(99,102,241,0.4)":"none" }}>{r.rank}</div>
                          </td>
                          <td style={{ ...cell, fontWeight:600, color:"#cbd5e1", minWidth:120 }}>
                            <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color:"#cbd5e1", textDecoration:"none" }}
                              onMouseEnter={e=>e.target.style.color="#a5b4fc"} onMouseLeave={e=>e.target.style.color="#cbd5e1"}>{r.site_name}</a>
                            {r.date&&<div style={{ fontSize:10, color:"#3b5068", marginTop:3 }}>{r.date}</div>}
                          </td>
                          <td style={{ ...cell, minWidth:130 }}>
                            <span style={{ background:"#0a1628", border:"1px solid #1e3a5f", borderRadius:6, padding:"3px 9px", fontSize:11, color:"#7dd3fc", fontFamily:"monospace" }}>{r.domain}</span>
                          </td>
                          {["h1","h2","h3","h4","h5","h6"].map((hk,hi)=>(
                            <td key={hk} style={{ ...cell, minWidth:180, verticalAlign:"top" }}>
                              {!r.headingsLoaded
                                ?<span style={{ color:"#334155", fontStyle:"italic" }}>Loading...</span>
                                :(r[hk]||["—"]).every(v=>v==="—")
                                  ?<span style={{ color:"#334155" }}>—</span>
                                  :(r[hk]||[]).map((txt,idx)=>(
                                    <div key={idx} style={{ display:"flex", gap:6, marginBottom:idx<(r[hk]||[]).length-1?5:0 }}>
                                      {(r[hk]||[]).length>1&&<span style={{ color:"#334155", fontSize:10, fontWeight:700, minWidth:14, paddingTop:1 }}>{idx+1}.</span>}
                                      <span style={{ color:hi===0?"#e2e8f0":"#94a3b8", fontSize:12, lineHeight:1.5 }}>{txt}</span>
                                    </div>
                                  ))
                              }
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {!loading&&!searched&&(
              <div style={{ textAlign:"center", padding:"60px 20px" }}>
                <div style={{ fontSize:15, color:"#475569", marginBottom:8, fontWeight:500 }}>Enter your SerpAPI key and a keyword to begin</div>
                <div style={{ fontSize:12, color:"#2d3f55", marginBottom:24 }}>Scrapes top 12 Google results with H1 through H6 headings</div>
                <div style={{ display:"inline-flex", gap:28, background:"#1e293b", border:"1px solid #1e3a5f", borderRadius:14, padding:"16px 32px" }}>
                  {[["Real Rankings","Exact Google order"],["H1 to H6","All heading levels"],["USA & India","Country filter"],["CSV Export","One click export"]].map(([t,s])=>(
                    <div key={t} style={{ textAlign:"center" }}>
                      <div style={{ fontSize:13, fontWeight:700, color:"#e2e8f0", marginBottom:4 }}>{t}</div>
                      <div style={{ fontSize:11, color:"#475569" }}>{s}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Keyword Tab */}
        {activeTab==="keywords" && (
          <KeywordPanel
            keyword={activeKeyword}
            country={country}
            results={results}
            serpData={serpData}
            searched={searched}
            loading={loading}
            rawOrganic={results.map(r => ({ snippet: r.snippet, title: r.title }))}
          />
        )}

      </div>
      <style>{`*{box-sizing:border-box;}::-webkit-scrollbar{width:6px;height:6px;}::-webkit-scrollbar-track{background:#0f1117;}::-webkit-scrollbar-thumb{background:#334155;border-radius:3px;}::selection{background:#6366f1;color:#fff;}`}</style>
    </div>
  );
}
