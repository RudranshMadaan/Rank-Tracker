import { useState, useCallback, useEffect } from "react";
import KeywordPanel from "./KeywordPanel";
import AdKeywords from "./AdKeywords";
import RankIntelligence from "./RankIntelligence";

const PROXY = process.env.REACT_APP_PROXY_URL || "https://serp-proxy-true.onrender.com/serp";
const SCRAPER = process.env.REACT_APP_SCRAPER_URL || "https://serp-proxy-true.onrender.com/scrape-headings";
const COUNTRIES = [{ label:"USA", gl:"us", hl:"en" }, { label:"India", gl:"in", hl:"en" }];

async function fetchHeadings(url, serpTitle) {
  const fallback = serpTitle ? [serpTitle] : ["—"];
  try {
    const res = await fetch(`${SCRAPER}?url=${encodeURIComponent(url)}`);
    if (!res.ok) return { h1:fallback, h2:["—"],h3:["—"],h4:["—"],h5:["—"],h6:["—"], ordered:[] };
    const d = await res.json();
    const pick = (arr, fb) => Array.isArray(arr) && arr.length && arr[0] !== "—" ? arr : fb;
    return {
      h1:pick(d.h1,fallback), h2:pick(d.h2,["—"]), h3:pick(d.h3,["—"]),
      h4:pick(d.h4,["—"]), h5:pick(d.h5,["—"]), h6:pick(d.h6,["—"]),
      ordered: Array.isArray(d.ordered) ? d.ordered : [],
    };
  } catch { return { h1:fallback, h2:["—"],h3:["—"],h4:["—"],h5:["—"],h6:["—"], ordered:[] }; }
}

const DARK = {
  bg:"#14111f", surface:"#1d1a2e", surface2:"#252238", surface3:"#2c2844",
  border:"#2e2b42", borderLight:"#3a3655",
  text:"#ede8de", textSub:"#8a8499", textMuted:"#4e4a60",
  accent:"#c9a96e", accentSub:"#9b8afb", accentGreen:"#5dcfaa",
  accentBlue:"#60c4f8", rankTop:"linear-gradient(135deg,#9b8afb,#c084fc)",
  rankMid:"linear-gradient(135deg,#60c4f8,#3b9fe0)", adGold:"linear-gradient(135deg,#c9a96e,#a07840)",
  shadow:"rgba(0,0,0,0.4)", shadowSm:"rgba(0,0,0,0.2)",
};
const LIGHT = {
  bg:"#f4efe6", surface:"#fffcf5", surface2:"#ede8dc", surface3:"#e4ddd0",
  border:"#d8d0be", borderLight:"#c8bfaa",
  text:"#1a1528", textSub:"#6b6278", textMuted:"#a09898",
  accent:"#8b6010", accentSub:"#5b4db0", accentGreen:"#1a7a58",
  accentBlue:"#1a6090", rankTop:"linear-gradient(135deg,#5b4db0,#7c3aed)",
  rankMid:"linear-gradient(135deg,#1a6090,#2563eb)", adGold:"linear-gradient(135deg,#8b6010,#a07840)",
  shadow:"rgba(0,0,0,0.1)", shadowSm:"rgba(0,0,0,0.05)",
};

export default function App() {
  const [dark, setDark] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("serp");
  const [keyword, setKeyword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [results, setResults] = useState([]);
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingHeadings, setLoadingHeadings] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [activeKeyword, setActiveKeyword] = useState("");
  const [totalResults, setTotalResults] = useState(null);
  const [serpData, setSerpData] = useState(null);
  const [copyMsg, setCopyMsg] = useState("");

  const T = dark ? DARK : LIGHT;

  useEffect(() => {
    const handler = (e) => { if (settingsOpen && !e.target.closest("[data-settings]")) setSettingsOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [settingsOpen]);

  const handleSearch = useCallback(async () => {
    if (!keyword.trim()) return setError("Please enter a keyword.");
    if (!apiKey.trim()) return setError("Please enter your SerpAPI key.");
    setError(""); setSearched(true); setResults([]); setAds([]); setSerpData(null);
    setTotalResults(null); setActiveKeyword(keyword.trim()); setLoading(true); setLoadingHeadings(false);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${PROXY}?q=${encodeURIComponent(keyword.trim())}&api_key=${encodeURIComponent(apiKey.trim())}&start=0&num=10&hl=${country.hl}&gl=${country.gl}`),
        fetch(`${PROXY}?q=${encodeURIComponent(keyword.trim())}&api_key=${encodeURIComponent(apiKey.trim())}&start=10&num=10&hl=${country.hl}&gl=${country.gl}`),
      ]);
      if (!r1.ok) throw new Error(`Server error: ${r1.status}`);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      if (d1.error) throw new Error(d1.error);
      let organic = [...(d1.organic_results||[]), ...(d2.organic_results||[])];
      if (organic.length < 12) {
        try {
          const r3 = await fetch(`${PROXY}?q=${encodeURIComponent(keyword.trim())}&api_key=${encodeURIComponent(apiKey.trim())}&start=20&num=10&hl=${country.hl}&gl=${country.gl}`);
          const d3 = await r3.json();
          organic.push(...(d3.organic_results||[]));
        } catch {}
      }
      const finalOrganic = organic.slice(0,12);
      if (!finalOrganic.length) throw new Error("No organic results found.");
      if (d1.search_information?.total_results) setTotalResults(d1.search_information.total_results);
      setSerpData({ related_searches: d1.related_searches||[], related_questions: d1.related_questions||[] });
      setAds([...(d1.ads||[]), ...(d2.ads||[])].filter(a=>a.title&&a.link).map((a,i)=>({
        rank:i+1, title:a.title, displayed_url:a.displayed_link||a.link,
        domain:(()=>{ try { return new URL(a.link).hostname.replace("www.",""); } catch { return "—"; }})(),
        description:a.description||a.snippet||"—", url:a.link,
        sitelinks:(a.sitelinks||[]).map(s=>s.title||s.link).filter(Boolean),
      })));
      const mapped = finalOrganic.map((item,i) => {
        const link = item.link||""; let domain="";
        try { domain = new URL(link).hostname.replace("www.",""); } catch {}
        return { rank:i+1, h1:item.title?[item.title]:["—"], h2:["—"],h3:["—"],h4:["—"],h5:["—"],h6:["—"],
          ordered:[], headingsLoaded:false, site_name:item.source||domain, domain:domain||"—",
          url:link, title:item.title||"", date:item.date||null, snippet:item.snippet||"" };
      });
      setResults(mapped); setLoading(false); setLoadingHeadings(true);
      try { await fetch(`https://serp-proxy-true.onrender.com/`); } catch {}
      await new Promise(r=>setTimeout(r,2000));
      const enriched = [...mapped];
      for (let i=0; i<enriched.length; i++) {
        const h = await fetchHeadings(enriched[i].url, enriched[i].title);
        enriched[i] = { ...enriched[i], ...h, headingsLoaded:true };
        setResults([...enriched]);
      }
      setLoadingHeadings(false);
    } catch(e) {
      setLoading(false); setLoadingHeadings(false);
      if (e.message?.includes("Invalid API key")) setError("Invalid SerpAPI key.");
      else if (e.message?.includes("Monthly Searches Exceeded")) setError("SerpAPI monthly limit exceeded.");
      else if (e.message?.includes("Failed to fetch")) setError("Cannot reach proxy server.");
      else setError(e.message);
    }
  }, [keyword, apiKey, country]);

  const getCSV = () => {
    const h = ["Rank","Site Name","Domain","H1","H2","H3","H4","H5","H6","URL"];
    const rows = results.map(r =>
      [r.rank,r.site_name,r.domain,...["h1","h2","h3","h4","h5","h6"].map(k=>(r[k]||[]).filter(v=>v!=="—").join(" | ")),r.url]
        .map(v=>`"${String(v).replace(/"/g,'""')}"`)
        .join(",")
    );
    return [h.join(","),...rows].join("\n");
  };
  const downloadCSV = () => {
    const b = new Blob([getCSV()],{type:"text/csv;charset=utf-8;"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(b);
    a.download = `serp-${activeKeyword.replace(/\s+/g,"-")}.csv`; a.click();
  };
  const copyCSV = () => {
    navigator.clipboard.writeText(getCSV());
    setCopyMsg("Copied!"); setTimeout(()=>setCopyMsg(""),2000);
  };

  const hColors = { 1:dark?"#b8a9f8":"#5b4db0", 2:dark?"#67d8f0":"#1a6090", 3:dark?"#6ee8b4":"#1a7a58", 4:dark?"#f0d070":"#8b6010", 5:dark?"#f0a0c0":"#8b1a4a", 6:dark?"#c4b0f8":"#6b4db0" };

  const renderHeadings = (r) => {
    if (!r.headingsLoaded) return <span style={{ color:T.textMuted, fontStyle:"italic", fontSize:12 }}>Loading...</span>;

    // Use ordered document-sequence if available (Ahrefs-style tree)
    const ordered = r.ordered && r.ordered.length > 0 ? r.ordered : null;

    if (ordered) {
      return ordered.map((h, idx) => (
        <div key={idx} style={{ display:"flex", alignItems:"baseline", gap:7, marginBottom:5, paddingLeft:(h.level-1)*18 }}>
          <span style={{ fontSize:9, fontWeight:800, color:hColors[h.level], background:`${hColors[h.level]}18`, border:`1px solid ${hColors[h.level]}35`, borderRadius:4, padding:"1px 5px", flexShrink:0, letterSpacing:"0.06em" }}>H{h.level}</span>
          <span style={{ fontSize:12.5, color:T.text, lineHeight:1.55, opacity:h.level===1?1:0.9-h.level*0.05 }}>{h.text}</span>
        </div>
      ));
    }

    // Fallback: grouped display using h1 title only
    const h1 = (r.h1||[]).filter(v=>v&&v!=="—");
    if (!h1.length) return <span style={{ color:T.textMuted }}>—</span>;
    return h1.map((txt,idx)=>(
      <div key={idx} style={{ display:"flex", alignItems:"baseline", gap:7, marginBottom:5 }}>
        <span style={{ fontSize:9, fontWeight:800, color:hColors[1], background:`${hColors[1]}18`, border:`1px solid ${hColors[1]}35`, borderRadius:4, padding:"1px 5px", flexShrink:0 }}>H1</span>
        <span style={{ fontSize:12.5, color:T.text, lineHeight:1.55 }}>{txt}</span>
      </div>
    ));
  };

  const rankBg = n => n<=3 ? T.rankTop : n<=6 ? T.rankMid : T.surface3;

  const card = { background:T.surface, border:`1px solid ${T.border}`, borderRadius:20, boxShadow:`0 4px 24px ${T.shadow}`, transition:"all 0.3s ease" };
  const input = { background:T.surface2, border:`1px solid ${T.border}`, color:T.text, borderRadius:14, outline:"none", transition:"border-color 0.25s, box-shadow 0.25s", fontFamily:"inherit" };
  const btn = (active, variant="default") => ({
    border:"none", borderRadius:12, fontWeight:700, cursor:"pointer", transition:"all 0.25s ease",
    ...(variant==="primary" ? { background: active?"linear-gradient(135deg,#9b8afb,#c084fc)":T.surface2, color:active?"#fff":T.textSub, boxShadow:active?`0 4px 16px ${T.accentSub}40`:"none" }
      : variant==="ghost" ? { background:"transparent", color:active?T.accent:T.textSub, borderBottom:active?`2px solid ${T.accent}`:"2px solid transparent" }
      : { background:T.surface2, color:T.textSub, border:`1px solid ${T.border}` })
  });

  const thStyle = { padding:"11px 16px", fontSize:10, fontWeight:800, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.1em", background:T.surface, borderBottom:`2px solid ${T.border}`, textAlign:"left", whiteSpace:"nowrap" };
  const tdStyle = { padding:"13px 16px", fontSize:12.5, color:T.textSub, borderBottom:`1px solid ${T.border}`, verticalAlign:"top", lineHeight:1.5 };

  return (
    <div style={{ minHeight:"100vh", background:T.bg, color:T.text, fontFamily:"'Inter',system-ui,sans-serif", transition:"background 0.3s, color 0.3s" }}>

      {/* Navbar */}
      <nav style={{ position:"sticky", top:0, zIndex:100, background:dark?`${T.surface}ee`:`${T.surface}f0`, backdropFilter:"blur(20px)", borderBottom:`1px solid ${T.border}`, padding:"0 32px", display:"flex", alignItems:"center", justifyContent:"space-between", height:60 }}>
        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          <div style={{ width:30, height:30, borderRadius:10, background:"linear-gradient(135deg,#9b8afb,#c9a96e)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <span style={{ fontSize:15, fontWeight:800, color:T.text, letterSpacing:"-0.3px" }}>SERP Research</span>
        </div>

        {/* Center Tabs */}
        <div style={{ display:"flex", gap:2, background:T.surface2, borderRadius:14, padding:"4px", border:`1px solid ${T.border}` }}>
          {[["serp","SERP Scraper"],["sponsored","Sponsored"],["keywords","Keyword Analysis"],["adkeywords","Ad Keywords"],["intelligence","Rank Intelligence"]].map(([tab,label])=>(
            <button key={tab} onClick={()=>setActiveTab(tab)} style={{ ...btn(activeTab===tab,"primary"), padding:"7px 20px", fontSize:12.5, borderRadius:10, position:"relative" }}>
              {label}
              {tab==="sponsored"&&ads.length>0&&<span style={{ position:"absolute", top:-4, right:-4, background:T.accent, borderRadius:50, padding:"1px 6px", fontSize:9, color:"#fff", fontWeight:800 }}>{ads.length}</span>}
              {tab==="keywords"&&results.length>0&&<span style={{ position:"absolute", top:-4, right:-4, background:T.accentGreen, borderRadius:50, padding:"1px 6px", fontSize:9, color:"#fff", fontWeight:800 }}>{serpData?.related_searches?.length||0}</span>}
            </button>
          ))}
        </div>

        {/* Right — Settings */}
        <div style={{ position:"relative", flexShrink:0 }} data-settings>
          <button onClick={()=>setSettingsOpen(p=>!p)}
            style={{ ...btn(settingsOpen), width:38, height:38, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", background:settingsOpen?T.surface3:T.surface2 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textSub} strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>

          {/* Settings Panel */}
          {settingsOpen && (
            <div data-settings style={{ position:"absolute", top:48, right:0, background:T.surface, border:`1px solid ${T.border}`, borderRadius:18, padding:"20px", width:240, boxShadow:`0 16px 48px ${T.shadow}`, zIndex:200 }}>
              <div style={{ fontSize:12, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:16 }}>Settings</div>
              {/* Dark/Light Toggle */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 14px", background:T.surface2, borderRadius:12, border:`1px solid ${T.border}` }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:T.text }}>Appearance</div>
                  <div style={{ fontSize:11, color:T.textMuted, marginTop:2 }}>{dark?"Dark mode":"Light mode"}</div>
                </div>
                <button onClick={()=>setDark(p=>!p)}
                  style={{ width:48, height:26, borderRadius:50, border:"none", background:dark?"linear-gradient(135deg,#9b8afb,#c084fc)":T.border, cursor:"pointer", position:"relative", transition:"background 0.3s", padding:0 }}>
                  <div style={{ width:20, height:20, borderRadius:"50%", background:"#fff", position:"absolute", top:3, left:dark?25:3, transition:"left 0.25s ease", boxShadow:"0 2px 6px rgba(0,0,0,0.2)" }} />
                </button>
              </div>
              <div style={{ marginTop:12, padding:"10px 14px", background:T.surface2, borderRadius:12, border:`1px solid ${T.border}` }}>
                <div style={{ fontSize:11, color:T.textMuted, marginBottom:6 }}>Proxy Status</div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:6, height:6, borderRadius:"50%", background:T.accentGreen, boxShadow:`0 0 6px ${T.accentGreen}` }} />
                  <span style={{ fontSize:11, color:T.text, fontFamily:"monospace" }}>serp-proxy-true.onrender.com</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main style={{ maxWidth:1400, margin:"0 auto", padding:"32px 24px" }}>

        {/* Search Panel */}
        <div style={{ ...card, padding:"24px", marginBottom:24 }}>
          {/* API Key Row */}
          <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:16, padding:"12px 16px", background:T.surface2, borderRadius:14, border:`1px solid ${T.border}` }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            <span style={{ fontSize:11, color:T.accent, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", whiteSpace:"nowrap" }}>API Key</span>
            <input value={apiKey} onChange={e=>setApiKey(e.target.value)} type={showKey?"text":"password"}
              placeholder="Paste your SerpAPI key..."
              style={{ ...input, flex:1, background:"transparent", border:"none", fontSize:13, fontFamily:"monospace", padding:0, color:T.text }} />
            <button onClick={()=>setShowKey(p=>!p)} style={{ ...btn(false), padding:"5px 14px", fontSize:11, borderRadius:8, fontWeight:600 }}>
              {showKey?"Hide":"Show"}
            </button>
          </div>

          {/* Search Row */}
          <div style={{ display:"flex", gap:10 }}>
            {/* Country Toggle */}
            <div style={{ display:"flex", background:T.surface2, border:`1px solid ${T.border}`, borderRadius:14, overflow:"hidden", flexShrink:0 }}>
              {COUNTRIES.map(ct=>(
                <button key={ct.gl} onClick={()=>setCountry(ct)}
                  style={{ padding:"0 18px", height:50, border:"none", borderRadius:0, background:country.gl===ct.gl?"linear-gradient(135deg,#9b8afb,#c084fc)":"transparent", color:country.gl===ct.gl?"#fff":T.textSub, fontWeight:700, fontSize:13, cursor:"pointer", transition:"all 0.25s" }}>
                  {ct.label}
                </button>
              ))}
            </div>

            {/* Keyword Input */}
            <input value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSearch()}
              placeholder="Enter keyword e.g. D2C Shopify Platforms"
              style={{ ...input, flex:1, padding:"14px 20px", fontSize:15 }}
              onFocus={e=>{ e.target.style.borderColor=dark?"#9b8afb":"#5b4db0"; e.target.style.boxShadow=`0 0 0 3px ${dark?"#9b8afb":"#5b4db0"}18`; }}
              onBlur={e=>{ e.target.style.borderColor=T.border; e.target.style.boxShadow="none"; }} />

            {/* Search Button */}
            <button onClick={handleSearch} disabled={loading}
              style={{ padding:"14px 32px", borderRadius:14, border:"none", background:loading?T.surface2:"linear-gradient(135deg,#9b8afb,#c084fc)", color:loading?T.textMuted:"#fff", fontSize:15, fontWeight:700, cursor:loading?"not-allowed":"pointer", whiteSpace:"nowrap", boxShadow:loading?"none":"0 4px 20px #9b8afb40", transition:"all 0.25s" }}>
              {loading?"Fetching...":"Search"}
            </button>
          </div>

          {error && (
            <div style={{ marginTop:14, padding:"12px 16px", background:dark?"#2a0f0f":"#fff0f0", border:"1px solid #dc262640", borderRadius:12, color:"#f87171", fontSize:13 }}>
              {error}
            </div>
          )}
        </div>

        {/* SERP Tab */}
        {activeTab==="serp" && (
          <>
            {loading && (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {[...Array(8)].map((_,i)=>(
                  <div key={i} style={{ ...card, padding:"16px 20px", opacity:1-i*0.09 }}>
                    <div style={{ display:"flex", gap:14, alignItems:"center" }}>
                      <div style={{ width:36, height:36, borderRadius:10, background:T.surface2 }} />
                      <div style={{ flex:1 }}>
                        <div style={{ height:12, background:T.surface2, borderRadius:6, width:`${48+(i%3)*14}%`, marginBottom:8 }} />
                        <div style={{ height:10, background:T.surface3, borderRadius:6, width:`${26+(i%4)*10}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
                <div style={{ textAlign:"center", fontSize:12, color:T.textMuted, marginTop:4 }}>Fetching results from Google via SerpAPI...</div>
              </div>
            )}

            {!loading && results.length>0 && (
              <>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                    <span style={{ fontSize:13, color:T.textSub }}>
                      Top <span style={{ color:T.accentSub, fontWeight:700 }}>{results.length}</span> for
                      <span style={{ color:T.text, fontWeight:700 }}> "{activeKeyword}"</span>
                    </span>
                    <span style={{ background:country.gl==="us"?`${T.accentBlue}20`:`${T.accentGreen}20`, border:`1px solid ${country.gl==="us"?T.accentBlue:T.accentGreen}40`, borderRadius:8, padding:"3px 10px", fontSize:11, color:country.gl==="us"?T.accentBlue:T.accentGreen, fontWeight:600 }}>
                      {country.label}
                    </span>
                    {loadingHeadings && (
                      <span style={{ background:`${T.accent}18`, border:`1px solid ${T.accent}40`, borderRadius:8, padding:"3px 10px", fontSize:11, color:T.accent, fontWeight:600 }}>
                        Loading H1–H6...
                      </span>
                    )}
                    {totalResults && <span style={{ fontSize:12, color:T.textMuted }}>~{Number(totalResults).toLocaleString()} results</span>}
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={downloadCSV} style={{ ...btn(false), padding:"8px 16px", fontSize:12, borderRadius:10 }}>Download CSV</button>
                    <button onClick={copyCSV} style={{ ...btn(false), padding:"8px 16px", fontSize:12, borderRadius:10, background:copyMsg?`${T.accentGreen}20`:T.surface2, color:copyMsg?T.accentGreen:T.textSub, border:`1px solid ${copyMsg?T.accentGreen:T.border}` }}>
                      {copyMsg||"Copy Sheet"}
                    </button>
                  </div>
                </div>

                {/* Table */}
                <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:16, overflow:"hidden", boxShadow:`0 8px 32px ${T.shadow}` }}>
                  <div style={{ overflowX:"auto" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", minWidth:700 }}>
                      <thead>
                        <tr>
                          <th style={{ ...thStyle, width:60, textAlign:"center" }}>Rank</th>
                          <th style={{ ...thStyle, minWidth:140 }}>Site Name</th>
                          <th style={{ ...thStyle, minWidth:130 }}>Domain</th>
                          <th style={{ ...thStyle }}>Heading Structure</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.map((r,i)=>(
                          <tr key={i} style={{ background:i%2===0?T.surface:`${T.surface2}60`, transition:"background 0.2s" }}
                            onMouseEnter={e=>e.currentTarget.style.background=`${T.accentSub}12`}
                            onMouseLeave={e=>e.currentTarget.style.background=i%2===0?T.surface:`${T.surface2}60`}>
                            <td style={{ ...tdStyle, textAlign:"center", width:60 }}>
                              <div style={{ width:36, height:36, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", background:rankBg(r.rank), fontWeight:800, fontSize:13, color:"#fff", margin:"0 auto", boxShadow:r.rank<=3?`0 3px 12px ${T.accentSub}50`:"none" }}>{r.rank}</div>
                            </td>
                            <td style={{ ...tdStyle, minWidth:140 }}>
                              <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color:T.accentSub, fontWeight:600, textDecoration:"none", fontSize:13 }}
                                onMouseEnter={e=>e.target.style.color=T.accent} onMouseLeave={e=>e.target.style.color=T.accentSub}>
                                {r.site_name}
                              </a>
                              {r.date&&<div style={{ fontSize:10, color:T.textMuted, marginTop:3 }}>{r.date}</div>}
                            </td>
                            <td style={{ ...tdStyle, minWidth:130 }}>
                              <span style={{ background:`${T.accentBlue}15`, border:`1px solid ${T.accentBlue}30`, borderRadius:7, padding:"3px 10px", fontSize:11, color:T.accentBlue, fontFamily:"monospace" }}>{r.domain}</span>
                            </td>
                            <td style={{ ...tdStyle, minWidth:320 }}>
                              {renderHeadings(r)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {!loading&&!searched&&(
              <div style={{ ...card, padding:"60px 32px", textAlign:"center" }}>
                <div style={{ width:56, height:56, borderRadius:18, background:`linear-gradient(135deg,#9b8afb20,#c9a96e20)`, border:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 20px" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </div>
                <div style={{ fontSize:16, color:T.text, marginBottom:8, fontWeight:600 }}>Enter a keyword to begin</div>
                <div style={{ fontSize:13, color:T.textMuted, marginBottom:28 }}>Scrapes top 12 Google results with H1–H6 heading structure</div>
                <div style={{ display:"inline-flex", gap:32, padding:"16px 32px", background:T.surface2, border:`1px solid ${T.border}`, borderRadius:16 }}>
                  {[["Real Rankings","Exact Google order"],["H1 to H6","Ahrefs-style view"],["USA & India","Country filter"],["CSV Export","One click export"]].map(([t,s])=>(
                    <div key={t} style={{ textAlign:"center" }}>
                      <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:4 }}>{t}</div>
                      <div style={{ fontSize:11, color:T.textMuted }}>{s}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Sponsored Tab */}
        {activeTab==="sponsored" && (
          <div>
            {!searched&&<div style={{ ...card, padding:"60px", textAlign:"center" }}><div style={{ fontSize:15, color:T.textMuted }}>Search a keyword to see sponsored ads</div></div>}
            {searched&&ads.length===0&&!loading&&(
              <div style={{ ...card, padding:"60px", textAlign:"center" }}>
                <div style={{ fontSize:15, color:T.textMuted, fontWeight:500 }}>No sponsored ads found</div>
                <div style={{ fontSize:12, color:T.textMuted, marginTop:6 }}>Try a commercial keyword like "buy CRM software"</div>
              </div>
            )}
            {ads.length>0&&(
              <>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:18 }}>
                  <span style={{ fontSize:13, color:T.textSub }}><span style={{ color:T.accent, fontWeight:700 }}>{ads.length}</span> sponsored ads for <span style={{ color:T.text, fontWeight:700 }}>"{activeKeyword}"</span></span>
                  <span style={{ background:`${T.accent}18`, border:`1px solid ${T.accent}30`, borderRadius:8, padding:"2px 10px", fontSize:11, color:T.accent, fontWeight:600 }}>Pages 1 & 2</span>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {ads.map((ad,i)=>(
                    <div key={i} style={{ ...card, padding:"18px 22px" }}
                      onMouseEnter={e=>e.currentTarget.style.background=`${T.accentSub}10`}
                      onMouseLeave={e=>e.currentTarget.style.background=T.surface}>
                      <div style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
                        <div style={{ width:34, height:34, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", background:T.adGold, fontWeight:800, fontSize:13, color:"#fff", flexShrink:0 }}>{ad.rank}</div>
                        <div style={{ flex:1 }}>
                          <a href={ad.url} target="_blank" rel="noopener noreferrer" style={{ color:T.accentSub, fontWeight:700, fontSize:14, textDecoration:"none", display:"block", marginBottom:3 }}
                            onMouseEnter={e=>e.target.style.color=T.accent} onMouseLeave={e=>e.target.style.color=T.accentSub}>{ad.title}</a>
                          <div style={{ fontSize:11, color:T.accentGreen, fontFamily:"monospace", marginBottom:6 }}>{ad.displayed_url}</div>
                          <div style={{ fontSize:12, color:T.textSub, lineHeight:1.65 }}>{ad.description}</div>
                          {ad.sitelinks?.length>0&&(
                            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:10 }}>
                              {ad.sitelinks.map((s,j)=><span key={j} style={{ background:T.surface2, border:`1px solid ${T.border}`, borderRadius:8, padding:"3px 10px", fontSize:11, color:T.textMuted }}>{s}</span>)}
                            </div>
                          )}
                        </div>
                        <span style={{ background:`${T.accentBlue}15`, border:`1px solid ${T.accentBlue}30`, borderRadius:8, padding:"3px 10px", fontSize:11, color:T.accentBlue, fontFamily:"monospace", flexShrink:0 }}>{ad.domain}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Ad Keywords Tab */}
        {activeTab==="adkeywords"&&(
          <AdKeywords
            keyword={activeKeyword}
            ads={ads}
            searched={searched}
            loading={loading}
            theme={T}
            dark={dark}
          />
        )}

        {/* Rank Intelligence Tab */}
        {activeTab==="intelligence" && (
          <RankIntelligence
            results={results}
            serpData={serpData}
            keyword={activeKeyword}
            apiKey={apiKey}
            country={country}
            searched={searched}
            loading={loading}
            theme={T}
            dark={dark}
          />
        )}

        {/* Page Keywords Tab */}
        {activeTab==="keywords"&&(
          <KeywordPanel keyword={activeKeyword} country={country} results={results} serpData={serpData}
            searched={searched} loading={loading} rawOrganic={results.map(r=>({snippet:r.snippet,title:r.title}))} theme={T} dark={dark} />
        )}
      </main>

      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:6px;height:6px;}
        ::-webkit-scrollbar-track{background:${T.bg};}
        ::-webkit-scrollbar-thumb{background:${T.border};border-radius:4px;}
        ::selection{background:${T.accentSub};color:#fff;}
        body{background:${T.bg};transition:background 0.3s;}
      `}</style>
    </div>
  );
}
