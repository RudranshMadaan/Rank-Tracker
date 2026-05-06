import { useState, useEffect, useRef } from "react";

const STOPWORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by","from",
  "is","are","was","were","be","been","being","have","has","had","do","does","did",
  "will","would","could","should","may","might","can","what","how","why","when",
  "where","who","which","that","this","these","those","it","its","their","your",
  "our","my","his","her","we","you","i","they","he","she","us","them","not","no",
  "so","if","as","up","out","about","into","than","then","there","here","more",
  "most","also","just","get","use","using","used","make","all","any","each","both",
  "new","top","best","via","per","whether","while","after","before","between","vs",
  "one","two","three","four","five","six","seven","eight","nine","ten",
  "like","see","know","need","want","help","take","give","work","way","time",
  "year","years","day","days","first","last","next","many","much","well","back",
  "right","even","still","never","every","same","over","such","own","than","off",
  "go","going","comes","come","let","say","says","said","able","find",
]);

const NAV_WORDS = new Set(["menu","nav","navigation","footer","header","sidebar","cookie","login","signup","sign","register","subscribe","newsletter","search","home","contact","about","blog","privacy","terms","policy"]);

function clean(t) {
  return t.toLowerCase().replace(/[^a-z0-9\s\-]/g," ").replace(/\s+/g," ").trim();
}

function isClean(phrase) {
  const words = phrase.split(/\s+/);
  const hasNav = words.some(w => NAV_WORDS.has(w));
  const allStop = words.every(w => STOPWORDS.has(w) || w.length <= 2);
  return !hasNav && !allStop && phrase.length > 3 && phrase.length < 80;
}

function extractNgrams(text, minN, maxN) {
  const words = clean(text).split(/\s+/).filter(w => w.length > 2);
  const ngrams = [];
  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const gram = words.slice(i, i+n).join(" ");
      // Must have at least one non-stopword
      if (words.slice(i,i+n).some(w => !STOPWORDS.has(w))) {
        ngrams.push(gram);
      }
    }
  }
  return ngrams;
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter(item => {
    const k = item.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function countAcrossPages(phrase, results) {
  const pl = phrase.toLowerCase();
  return results.filter(r =>
    ["h1","h2","h3","h4","h5","h6"].some(hk =>
      Array.isArray(r[hk]) && r[hk].some(t => t?.toLowerCase().includes(pl))
    )
  ).length;
}

export default function KeywordPanel({ keyword, country, results, serpData, searched, loading, rawOrganic=[], theme:T, dark }) {
  const [keywords, setKeywords] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");
  const prevKeyword = useRef("");

  useEffect(() => {
    if (!keyword || keyword === prevKeyword.current) return;
    prevKeyword.current = keyword;
    processKeywords();
  }, [keyword, results, serpData]);

  const processKeywords = async () => {
    setProcessing(true);
    setKeywords(null);

    // Collect all heading text from 12 pages
    const allHeadings = (results||[]).flatMap(r =>
      ["h1","h2","h3","h4","h5","h6"].flatMap(hk =>
        Array.isArray(r[hk]) ? r[hk].filter(h => h && h !== "—" && h !== "...") : []
      )
    );

    // Collect snippets from SerpAPI
    const snippets = rawOrganic.map(r => r.snippet||"").filter(Boolean);
    const allText = [...allHeadings, ...snippets];

    // --- SECONDARY KEYWORDS from Google related searches ---
    const secondary = dedup(
      ((serpData?.related_searches)||[])
        .map(r => r.query||"")
        .filter(q => q && q.toLowerCase() !== keyword.toLowerCase())
    ).slice(0, 12);

    // --- LONG TAIL from PAA + 5+ word heading phrases ---
    const paaLongTail = ((serpData?.related_questions)||[]).map(q=>q.question||"").filter(Boolean);
    const headingLongTail = allHeadings.filter(h => {
      const wc = h.trim().split(/\s+/).length;
      return wc >= 5 && isClean(clean(h));
    });
    const longTail = dedup([...paaLongTail, ...headingLongTail]).slice(0, 20);

    // --- SHORT TAIL: 2-3 word phrases from headings, frequency-ranked ---
    // Extract all 2-3 word n-grams from headings per page
    const phrasePageCount = {};
    (results||[]).forEach(r => {
      const pageHeadings = ["h1","h2","h3","h4","h5","h6"]
        .flatMap(hk => Array.isArray(r[hk]) ? r[hk].filter(h=>h&&h!=="—") : []);
      const seen = new Set();
      pageHeadings.forEach(h => {
        extractNgrams(h, 2, 3).forEach(gram => {
          if (!seen.has(gram) && isClean(gram)) {
            phrasePageCount[gram] = (phrasePageCount[gram]||0) + 1;
            seen.add(gram);
          }
        });
      });
    });
    // Only keep phrases appearing in 2+ pages, sorted by frequency
    const shortTail = dedup(
      Object.entries(phrasePageCount)
        .filter(([phrase, count]) => count >= 2 && isClean(phrase))
        .sort((a,b) => b[1]-a[1])
        .map(([phrase]) => phrase)
    ).slice(0, 15);

    // --- RELATED: 2-4 word phrases across all pages, NOT the primary keyword ---
    const relatedPageCount = {};
    const kwLower = keyword.toLowerCase();
    (results||[]).forEach(r => {
      const pageHeadings = ["h1","h2","h3","h4","h5","h6"]
        .flatMap(hk => Array.isArray(r[hk]) ? r[hk].filter(h=>h&&h!=="—") : []);
      const seen = new Set();
      pageHeadings.forEach(h => {
        extractNgrams(h, 2, 4).forEach(gram => {
          if (!seen.has(gram) && isClean(gram) && !gram.includes(kwLower) && !kwLower.includes(gram)) {
            relatedPageCount[gram] = (relatedPageCount[gram]||0) + 1;
            seen.add(gram);
          }
        });
      });
    });
    const related = dedup(
      Object.entries(relatedPageCount)
        .filter(([phrase, count]) => count >= 2)
        .sort((a,b) => b[1]-a[1])
        .map(([phrase]) => phrase)
    ).slice(0, 20);

    // --- SYNONYMS: Datamuse on the primary keyword only ---
    let synonyms = [];
    try {
      const r1 = await fetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(keyword)}&max=10`).then(r=>r.json());
      synonyms = r1
        .map(w=>w.word)
        .filter(w => !STOPWORDS.has(w) && w.length > 3 && !NAV_WORDS.has(w));
    } catch {}

    setKeywords({ primary:keyword, secondary, longTail, shortTail, related, synonyms });
    setProcessing(false);
  };

  const getFreq = (phrase) => countAcrossPages(phrase, results||[]);

  const getCSV = () => {
    if (!keywords) return "";
    return [
      ["Category","Keyword","Source","Frequency in 12 pages"],
      ["Primary", keywords.primary, "User Search", "—"],
      ...keywords.secondary.map(k => ["Secondary", k, "Google Related Searches", "—"]),
      ...keywords.longTail.map(k => ["Long Tail", k, "PAA / Page Headings", getFreq(k)]),
      ...keywords.shortTail.map(k => ["Short Tail", k, "Page Headings (2+ pages)", getFreq(k)]),
      ...keywords.related.map(k => ["Related", k, "Page Headings (2+ pages)", getFreq(k)]),
      ...keywords.synonyms.map(k => ["Synonym", k, "Datamuse API", "—"]),
    ].map(row => row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  };

  const downloadCSV = () => {
    const b = new Blob([getCSV()],{type:"text/csv;charset=utf-8;"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(b);
    a.download = `keywords-${(keywords?.primary||"").replace(/\s+/g,"-")}.csv`; a.click();
  };

  const copyCSV = () => {
    navigator.clipboard.writeText(getCSV());
    setCopyMsg("Copied!"); setTimeout(()=>setCopyMsg(""),2000);
  };

  const th = T || {};
  const surface = th.surface || "#1d1a2e";
  const surface2 = th.surface2 || "#252238";
  const surface3 = th.surface3 || "#2c2844";
  const border = th.border || "#2e2b42";
  const text = th.text || "#ede8de";
  const textSub = th.textSub || "#8a8499";
  const textMuted = th.textMuted || "#4e4a60";
  const accent = th.accent || "#c9a96e";
  const accentSub = th.accentSub || "#9b8afb";
  const accentGreen = th.accentGreen || "#5dcfaa";
  const accentBlue = th.accentBlue || "#60c4f8";
  const shadow = th.shadow || "rgba(0,0,0,0.3)";

  const sections = keywords ? [
    { label:"Primary Keyword", key:"primary", color:accentSub, isString:true, desc:"The keyword you searched" },
    { label:"Secondary Keywords", key:"secondary", color:accentBlue, desc:"From Google related searches" },
    { label:"Long Tail Keywords", key:"longTail", color:accentGreen, desc:"4+ word phrases from PAA and page headings" },
    { label:"Short Tail Keywords", key:"shortTail", color:accent, desc:"2–3 word phrases appearing in 2+ of the 12 pages" },
    { label:"Related Keywords", key:"related", color:"#f472b6", desc:"2–4 word topical phrases from page headings (2+ pages)" },
    { label:"Synonyms", key:"synonyms", color:"#34d399", desc:"Alternate terms for primary keyword via Datamuse" },
  ] : [];

  const tag = (color) => ({
    display:"inline-flex", alignItems:"center", gap:5,
    background:`${color}15`, border:`1px solid ${color}30`,
    borderRadius:8, padding:"5px 12px", fontSize:12,
    color, fontWeight:500, margin:"3px", cursor:"default",
    transition:"background 0.2s",
  });

  if (!searched && !loading) return (
    <div style={{ background:surface, border:`1px solid ${border}`, borderRadius:20, padding:"60px 32px", textAlign:"center" }}>
      <div style={{ fontSize:15, color:textMuted, fontWeight:500, marginBottom:8 }}>Search a keyword first to see keyword analysis</div>
      <div style={{ fontSize:12, color:textMuted }}>Results automatically appear here after searching</div>
    </div>
  );

  if (loading || processing) return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {[...Array(6)].map((_,i)=>(
        <div key={i} style={{ background:surface, border:`1px solid ${border}`, borderRadius:20, padding:"20px 24px", opacity:1-i*0.1 }}>
          <div style={{ height:13, background:surface2, borderRadius:6, width:"22%", marginBottom:14 }} />
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {[...Array(5)].map((_,j)=><div key={j} style={{ height:30, width:`${55+j*18}px`, background:surface3, borderRadius:8 }} />)}
          </div>
        </div>
      ))}
      <div style={{ textAlign:"center", fontSize:12, color:textMuted, marginTop:4 }}>
        {loading ? "Fetching SERP results..." : "Extracting keywords from heading structure..."}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div style={{ fontSize:13, color:textSub, display:"flex", alignItems:"center", gap:10 }}>
          <span>Keywords for <span style={{ color:text, fontWeight:700 }}>"{keyword}"</span></span>
          {T?.accentBlue && (
            <span style={{ background:T.gl==="us"?`${accentBlue}18`:`${accentGreen}18`, border:`1px solid ${T.gl==="us"?accentBlue:accentGreen}30`, borderRadius:8, padding:"2px 10px", fontSize:11, color:T.gl==="us"?accentBlue:accentGreen, fontWeight:600 }}>
              {country?.label}
            </span>
          )}
        </div>
        {keywords && (
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={downloadCSV} style={{ background:surface2, border:`1px solid ${border}`, borderRadius:10, padding:"7px 16px", color:textSub, fontSize:12, cursor:"pointer", fontWeight:600 }}>Download CSV</button>
            <button onClick={copyCSV} style={{ background:copyMsg?`${accentGreen}18`:surface2, border:`1px solid ${copyMsg?accentGreen:border}`, borderRadius:10, padding:"7px 16px", color:copyMsg?accentGreen:textSub, fontSize:12, cursor:"pointer", fontWeight:600, transition:"all 0.2s" }}>
              {copyMsg||"Copy Sheet"}
            </button>
          </div>
        )}
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {sections.map(({ label, key, color, isString, desc }) => {
          const items = isString ? [keywords[key]] : keywords[key];
          return (
            <div key={key} style={{ background:surface, border:`1px solid ${border}`, borderRadius:20, padding:"20px 24px", boxShadow:`0 4px 16px ${shadow}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                <div style={{ width:9, height:9, borderRadius:"50%", background:color, boxShadow:`0 0 8px ${color}` }} />
                <span style={{ fontSize:13, fontWeight:700, color:text }}>{label}</span>
                <span style={{ background:`${color}18`, border:`1px solid ${color}35`, borderRadius:50, padding:"2px 9px", fontSize:11, color, fontWeight:700 }}>{items.length}</span>
                <span style={{ fontSize:11, color:textMuted }}>{desc}</span>
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:2 }}>
                {!items.length
                  ? <span style={{ color:textMuted, fontSize:12, fontStyle:"italic" }}>No data found</span>
                  : items.map((item, idx) => {
                    const fr = !isString && (key==="shortTail"||key==="longTail"||key==="related") ? getFreq(item) : null;
                    return (
                      <span key={idx} style={tag(color)}
                        onMouseEnter={e=>e.currentTarget.style.background=`${color}28`}
                        onMouseLeave={e=>e.currentTarget.style.background=`${color}15`}>
                        {item}
                        {fr !== null && fr > 0 && (
                          <span style={{ background:`${color}28`, borderRadius:5, padding:"1px 6px", fontSize:10, fontWeight:800 }}>{fr}/12</span>
                        )}
                      </span>
                    );
                  })
                }
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10, marginTop:16 }}>
        {[["Secondary",keywords?.secondary?.length||0,accentBlue],["Long Tail",keywords?.longTail?.length||0,accentGreen],["Short Tail",keywords?.shortTail?.length||0,accent],["Related",keywords?.related?.length||0,"#f472b6"],["Synonyms",keywords?.synonyms?.length||0,"#34d399"]].map(([l,c,col])=>(
          <div key={l} style={{ background:surface, border:`1px solid ${border}`, borderRadius:16, padding:"16px", textAlign:"center" }}>
            <div style={{ fontSize:26, fontWeight:800, color:col, marginBottom:4 }}>{c}</div>
            <div style={{ fontSize:11, color:textMuted, fontWeight:500 }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
