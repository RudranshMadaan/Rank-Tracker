import { useState, useCallback, useRef } from "react";

const PROXY = process.env.REACT_APP_PROXY_URL || "https://serp-proxy-true.onrender.com/serp";

// ─── In-Browser Vector Store ───────────────────────────────────────────────
class VectorStore {
  constructor() { this.items = []; }

  add(phrase, vector, meta = {}) {
    this.items.push({ phrase, vector: new Float32Array(vector), meta });
  }

  cosine(a, b) {
    let dot = 0, mA = 0, mB = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; mA += a[i]*a[i]; mB += b[i]*b[i]; }
    return dot / (Math.sqrt(mA) * Math.sqrt(mB) || 1);
  }

  query(queryVector, topK = 8, threshold = 0.45) {
    return this.items
      .map(item => ({ ...item, similarity: this.cosine(queryVector, item.vector) }))
      .filter(item => item.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  // Deduplicate: remove items too similar to each other
  deduplicate(threshold = 0.92) {
    const kept = [];
    for (const item of this.items) {
      const isDupe = kept.some(k => this.cosine(k.vector, item.vector) >= threshold);
      if (!isDupe) kept.push(item);
    }
    this.items = kept;
  }

  clear() { this.items = []; }
  get size() { return this.items.length; }
}

// ─── Filter constants ───────────────────────────────────────────────────────
const GENERIC = new Set([
  "services","solutions","tools","software","platform","company","agency",
  "provider","system","guide","best","top","list","review","free","online",
  "how","what","why","learn","find","get","use","tips","tutorial","overview",
  "complete","ultimate","full","new","vs","2024","2025","2026","today","here",
]);
const STOPWORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
  "from","is","are","was","were","be","been","have","has","had","do","does",
  "did","will","would","could","should","may","might","can","it","its","this",
  "that","we","you","i","they","not","so","if","as","up","out","about","into",
  "than","then","there","more","most","also","just","all","any","each","both",
]);
const ZONE_WEIGHTS = {
  url_slug:8, meta_title:9, h1:10, h2:7, h3:4, h4:3, meta_description:5, paragraph:2
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(w => w.length > 2);
}

function extractNgrams(text, min, max) {
  const words = tokenize(text);
  const grams = [];
  for (let n = min; n <= max; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const slice = words.slice(i, i + n);
      const meaningful = slice.filter(w => !STOPWORDS.has(w) && !GENERIC.has(w));
      if (meaningful.length >= 1) grams.push(slice.join(" "));
    }
  }
  return grams;
}

function getSlug(url) {
  try { return new URL(url).pathname.replace(/[\/\-_]/g," ").trim(); } catch { return ""; }
}

function parseKeyword(kw) {
  const words = tokenize(kw);
  const meaningful = words.filter(w => !STOPWORDS.has(w));
  return { entity: meaningful[0] || kw, intent: meaningful.slice(1).filter(w => !GENERIC.has(w)), all: meaningful };
}

// ─── F1+F2: Build weighted candidates from page data ───────────────────────
function buildCandidates(pageData, keyword) {
  const { meta_title="", meta_description="", h1=[], h2=[], h3=[], h4=[], paragraphs=[], url="" } = pageData;
  const { entity, all: kwWords } = parseKeyword(keyword);
  const map = {};

  const add = (phrase, zone) => {
    const words = phrase.split(" ");
    const content = words.filter(w => !STOPWORDS.has(w) && !GENERIC.has(w));
    if (!content.length) return;
    const overlap = words.filter(w => kwWords.includes(w)).length;
    const hasEntity = phrase.includes(entity);
    if (!hasEntity && overlap < Math.ceil(kwWords.length * 0.35)) return;
    const w = ZONE_WEIGHTS[zone] || 1;
    if (!map[phrase]) map[phrase] = { weight:0, zones:[] };
    map[phrase].weight += w;
    if (!map[phrase].zones.includes(zone)) map[phrase].zones.push(zone);
  };

  const zones = [
    { text: getSlug(url), zone:"url_slug" },
    { text: meta_title, zone:"meta_title" },
    { text: (h1||[]).filter(v=>v!=="—").join(" "), zone:"h1" },
    { text: (h2||[]).filter(v=>v!=="—").join(" "), zone:"h2" },
    { text: (h3||[]).filter(v=>v!=="—").join(" "), zone:"h3" },
    { text: (h4||[]).filter(v=>v!=="—").join(" "), zone:"h4" },
    { text: meta_description, zone:"meta_description" },
  ];
  (paragraphs||[]).slice(0,5).forEach(p => zones.push({ text:p, zone:"paragraph" }));

  zones.forEach(({ text, zone }) => {
    if (!text) return;
    extractNgrams(text, 1, 4).forEach(gram => add(gram, zone));
  });

  return Object.entries(map)
    .sort((a,b) => b[1].weight - a[1].weight)
    .map(([phrase, meta]) => ({ phrase, ...meta }))
    .slice(0, 25);
}

// ─── F5: Cross-page pre-confirmation ───────────────────────────────────────
function crossPageConfirm(pages) {
  const counts = {};
  pages.forEach(p => {
    const seen = new Set();
    (p.candidates||[]).forEach(c => {
      if (!seen.has(c.phrase)) { counts[c.phrase] = (counts[c.phrase]||0)+1; seen.add(c.phrase); }
    });
  });
  return new Set(Object.entries(counts).filter(([,v]) => v >= 3).map(([k]) => k));
}

// ─── SerpAPI verification ───────────────────────────────────────────────────
async function verifyCandidates(candidates, pageUrl, apiKey, country, preConfirmed) {
  const domain = (() => { try { return new URL(pageUrl).hostname.replace("www.",""); } catch { return ""; } })();
  const verified = [];

  for (const c of candidates) {
    if (preConfirmed.has(c.phrase)) {
      verified.push({ ...c, status:"pre_confirmed", searched:false });
      continue;
    }
    try {
      const params = new URLSearchParams({ q:c.phrase, api_key:apiKey, num:10, hl:country.hl, gl:country.gl });
      const res = await fetch(`${PROXY}?${params}`);
      const data = await res.json();
      const organic = data.organic_results || [];
      const match = organic.findIndex(r => (r.link||"").includes(domain));
      if (match !== -1) {
        verified.push({ ...c, status:"verified", rank:match+1, searched:true });
        if (match <= 2 && (c.similarity||0) > 0.65) break; // early stop
      } else {
        verified.push({ ...c, status:"not_ranking", searched:true });
      }
    } catch {
      verified.push({ ...c, status:"error", searched:true });
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return verified;
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function RankIntelligence({ results=[], keyword="", apiKey="", country, searched, loading, theme:T, dark }) {
  const [analysis, setAnalysis] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [stages, setStages] = useState([]);
  const [searchCount, setSearchCount] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const storeRef = useRef(new VectorStore());
  const modelRef = useRef(null);

  const log = (msg, type="info") => setStages(s => [...s, { msg, type, time: new Date().toLocaleTimeString() }]);

  const loadModel = async () => {
    if (modelRef.current) return modelRef.current;
    setModelLoading(true);
    log("Loading TF.js Universal Sentence Encoder...", "info");
    try {
      const tf = await import("@tensorflow/tfjs");
      await tf.ready();
      const use = await import("@tensorflow-models/universal-sentence-encoder");
      const model = await use.load();
      modelRef.current = model;
      setModelReady(true);
      log("Model ready ✓", "success");
      return model;
    } catch(e) {
      log("TF.js failed to load — using weight-only ranking", "warn");
      return null;
    } finally {
      setModelLoading(false);
    }
  };

  const runAnalysis = useCallback(async () => {
    if (!results.length || !keyword || !apiKey) return;
    setProcessing(true);
    setAnalysis([]);
    setStages([]);
    setSearchCount(0);
    storeRef.current.clear();

    const TOP_VERIFY = 5;

    // Phase 1: Build candidates
    log("Phase 1 — Building candidates from all 12 pages...", "info");
    const pages = results.map(r => ({ ...r, candidates: buildCandidates(r, keyword), shortlisted:[], verified:[] }));

    // Phase 2: Cross-page pre-confirmation (free)
    log("Phase 2 — Cross-page confirmation (free)...", "info");
    const preConfirmed = crossPageConfirm(pages);
    log(`Pre-confirmed ${preConfirmed.size} keywords across 3+ pages`, "success");

    // Phase 3: TF.js embedding + vector store
    log("Phase 3 — Embedding candidates into vector store...", "info");
    const model = await loadModel();

    if (model) {
      try {
        // Collect all unique phrases across all pages
        const allPhrases = [...new Set(pages.flatMap(p => p.candidates.map(c => c.phrase)))];
        const toEmbed = [keyword, ...allPhrases];

        log(`Embedding ${toEmbed.length} phrases...`, "info");
        const embeddings = await model.embed(toEmbed);
        const vectors = await embeddings.array();
        embeddings.dispose();

        const kwVector = new Float32Array(vectors[0]);

        // Populate vector store
        allPhrases.forEach((phrase, i) => {
          const pagesMeta = pages
            .filter(p => p.candidates.some(c => c.phrase === phrase))
            .map(p => ({ rank: p.rank, weight: p.candidates.find(c => c.phrase === phrase)?.weight || 0, zones: p.candidates.find(c => c.phrase === phrase)?.zones || [] }));
          storeRef.current.add(phrase, vectors[i + 1], { pagesMeta });
        });

        storeRef.current.deduplicate(0.92);
        log(`Vector store built: ${storeRef.current.size} unique vectors`, "success");

        // F3: Per-page shortlisting via vector store query
        for (const page of pages) {
          const topK = storeRef.current.query(kwVector, 8, 0.45)
            .filter(r => page.candidates.some(c => c.phrase === r.phrase))
            .map(r => {
              const cand = page.candidates.find(c => c.phrase === r.phrase);
              return { ...cand, similarity: r.similarity, score: r.similarity * (cand?.weight || 1) };
            })
            .sort((a,b) => b.score - a.score)
            .slice(0, 7);
          page.shortlisted = topK;
        }
        log("F3 — Semantic shortlisting complete", "success");
      } catch(e) {
        log("Embedding failed — falling back to weight ranking", "warn");
        pages.forEach(p => { p.shortlisted = p.candidates.slice(0, 7); });
      }
    } else {
      // Fallback: weight-only ranking
      pages.forEach(p => { p.shortlisted = p.candidates.slice(0, 7); });
    }

    // Phase 4: SerpAPI verification (top 5 only)
    let totalSearches = 0;
    for (let i = 0; i < Math.min(TOP_VERIFY, pages.length); i++) {
      const p = pages[i];
      log(`Phase 4 — Verifying rank ${p.rank} (${p.domain})...`, "info");
      const toVerify = p.shortlisted.filter(c => !preConfirmed.has(c.phrase)).slice(0, 6);
      const verified = await verifyCandidates(toVerify, p.url, apiKey, country, preConfirmed);
      pages[i].verified = verified;
      totalSearches += verified.filter(v => v.searched).length;
      setSearchCount(totalSearches);
      setAnalysis([...pages]);
    }

    // Pages 6-12: candidates only, no verification
    for (let i = TOP_VERIFY; i < pages.length; i++) {
      pages[i].verified = pages[i].shortlisted.map(c => ({ ...c, status:"unverified" }));
    }

    setAnalysis([...pages]);
    log(`Done — ${totalSearches} SerpAPI searches used`, "success");
    setProcessing(false);
  }, [results, keyword, apiKey, country]);

  // ─── Theme ────────────────────────────────────────────────────────────────
  const th = T || {};
  const surface  = th.surface  || "#1d1a2e";
  const surface2 = th.surface2 || "#252238";
  const surface3 = th.surface3 || "#2c2844";
  const border   = th.border   || "#2e2b42";
  const text     = th.text     || "#ede8de";
  const textSub  = th.textSub  || "#8a8499";
  const textMuted= th.textMuted|| "#4e4a60";
  const accent   = th.accent   || "#c9a96e";
  const accentSub= th.accentSub|| "#9b8afb";
  const accentGreen = th.accentGreen || "#5dcfaa";
  const shadow   = th.shadow   || "rgba(0,0,0,0.3)";

  const card = { background:surface, border:`1px solid ${border}`, borderRadius:20, padding:"20px 24px", marginBottom:12, boxShadow:`0 4px 20px ${shadow}` };

  const statusStyle = s => ({
    verified:     { color:accentGreen, label:"✅ Verified" },
    pre_confirmed:{ color:accent,      label:"⚡ Pre-confirmed" },
    not_ranking:  { color:"#f87171",   label:"❌ Not ranking" },
    unverified:   { color:textMuted,   label:"◦ Candidate" },
    error:        { color:"#f87171",   label:"⚠️ Error" },
  }[s] || { color:textMuted, label:s });

  if (!searched) return (
    <div style={{ ...card, textAlign:"center", padding:"60px" }}>
      <div style={{ fontSize:15, color:textMuted, fontWeight:500 }}>Search a keyword first to run Rank Intelligence</div>
      <div style={{ fontSize:12, color:textMuted, marginTop:6 }}>Discovers ranking keywords using semantic filtering + SerpAPI verification</div>
    </div>
  );

  return (
    <div>
      {/* Header row */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
        <div>
          <div style={{ fontSize:16, fontWeight:800, color:text, marginBottom:4 }}>Rank Intelligence</div>
          <div style={{ fontSize:12, color:textMuted }}>
            Semantic filtering + vector store + SerpAPI verification for <span style={{ color:accent, fontWeight:600 }}>"{keyword}"</span>
          </div>
          {searchCount > 0 && <div style={{ fontSize:11, color:textMuted, marginTop:4 }}>SerpAPI searches used: <span style={{ color:accentGreen, fontWeight:700 }}>{searchCount}</span></div>}
        </div>
        <button onClick={runAnalysis} disabled={processing||loading}
          style={{ padding:"11px 28px", borderRadius:14, border:"none", background:processing?surface2:`linear-gradient(135deg,${accentSub},#c084fc)`, color:processing?textMuted:"#fff", fontSize:14, fontWeight:700, cursor:processing?"not-allowed":"pointer", boxShadow:processing?"none":`0 4px 16px ${accentSub}40`, transition:"all 0.25s" }}>
          {processing ? "Running..." : analysis.length ? "Re-run" : "Run Analysis"}
        </button>
      </div>

      {/* Pipeline badges */}
      <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap" }}>
        {[["F1","Generic Filter","#60a5fa"],["F2","Entity Anchor","#a78bfa"],["F3","Vector Store","#34d399"],["F4","Zone Weight",accent],["F5","Cross-page",accentGreen],["V","SerpAPI","#f472b6"]].map(([code,label,color])=>(
          <div key={code} style={{ display:"flex", alignItems:"center", gap:5, background:`${color}12`, border:`1px solid ${color}30`, borderRadius:8, padding:"3px 10px" }}>
            <span style={{ fontSize:9, fontWeight:800, color, background:`${color}22`, borderRadius:3, padding:"1px 4px" }}>{code}</span>
            <span style={{ fontSize:11, color:textSub }}>{label}</span>
          </div>
        ))}
        <div style={{ display:"flex", alignItems:"center", gap:5, background:`${accentSub}12`, border:`1px solid ${accentSub}30`, borderRadius:8, padding:"3px 10px" }}>
          <span style={{ fontSize:10, fontWeight:700, color:accentSub }}>{storeRef.current.size} vectors</span>
          <span style={{ fontSize:11, color:textSub }}>in store</span>
        </div>
      </div>

      {/* Stage log */}
      {stages.length > 0 && (
        <div style={{ ...card, padding:"14px 18px", marginBottom:16, background:`${surface2}`, maxHeight:160, overflowY:"auto" }}>
          {stages.map((s,i) => (
            <div key={i} style={{ display:"flex", gap:10, alignItems:"baseline", marginBottom:4 }}>
              <span style={{ fontSize:10, color:textMuted, flexShrink:0 }}>{s.time}</span>
              <span style={{ fontSize:12, color: s.type==="success"?accentGreen : s.type==="warn"?accent : s.type==="error"?"#f87171" : textSub }}>{s.msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* Results per page */}
      {analysis.map((r, i) => {
        const confirmed = (r.verified||[]).filter(v => v.status==="verified"||v.status==="pre_confirmed");
        return (
          <div key={i} style={card}>
            {/* Page header */}
            <div style={{ display:"flex", gap:14, alignItems:"flex-start", marginBottom:14 }}>
              <div style={{ width:36, height:36, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", background: i<3?`linear-gradient(135deg,${accentSub},#c084fc)`:surface2, fontWeight:800, fontSize:13, color:"#fff", flexShrink:0 }}>{r.rank}</div>
              <div style={{ flex:1 }}>
                <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color:accentSub, fontWeight:700, fontSize:14, textDecoration:"none" }}>{r.site_name}</a>
                <div style={{ fontSize:11, color:textMuted, fontFamily:"monospace", marginTop:2 }}>{r.domain}</div>
                {r.meta_title&&r.meta_title!=="—"&&<div style={{ fontSize:11, color:textSub, marginTop:3, fontStyle:"italic" }}>"{r.meta_title}"</div>}
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                {r.word_count>0&&<div style={{ fontSize:11, color:textMuted }}>{r.word_count?.toLocaleString()} words</div>}
                {i>=5&&<div style={{ fontSize:10, color:textMuted, background:surface2, borderRadius:6, padding:"2px 8px", marginTop:4 }}>Candidates only</div>}
              </div>
            </div>

            {/* Meta description */}
            {r.meta_description&&r.meta_description!=="—"&&(
              <div style={{ background:surface2, border:`1px solid ${border}`, borderRadius:10, padding:"9px 14px", marginBottom:12, fontSize:12, color:textSub, lineHeight:1.6 }}>
                <span style={{ fontSize:9, fontWeight:800, color:textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginRight:8 }}>Meta</span>
                {r.meta_description}
              </div>
            )}

            {/* Confirmed keywords */}
            {confirmed.length>0&&(
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:10, fontWeight:700, color:accentGreen, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Ranking Keywords Found</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                  {confirmed.map((v,j)=>(
                    <div key={j} style={{ background:`${accentGreen}12`, border:`1px solid ${accentGreen}35`, borderRadius:10, padding:"8px 14px" }}>
                      <div style={{ fontSize:13, fontWeight:700, color:accentGreen }}>{v.phrase}</div>
                      <div style={{ fontSize:10, color:textMuted, marginTop:2, display:"flex", gap:8 }}>
                        <span>{v.status==="pre_confirmed"?"⚡ Pre-confirmed":`✅ Rank #${v.rank}`}</span>
                        {v.similarity&&<span>{(v.similarity*100).toFixed(0)}% match</span>}
                        {v.zones?.length>0&&<span>{v.zones.slice(0,2).join(", ")}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Candidates table */}
            {(r.verified||[]).length>0&&(
              <div style={{ overflowX:"auto", borderRadius:10, border:`1px solid ${border}` }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                  <thead>
                    <tr style={{ background: dark?"#0a0f1e":surface3 }}>
                      {["Candidate","Zone Weight","Similarity","Zones","Status"].map(h=>(
                        <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:10, fontWeight:700, color:textMuted, textTransform:"uppercase", letterSpacing:"0.06em", borderBottom:`1px solid ${border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(r.verified||[]).map((v,j)=>{
                      const st = statusStyle(v.status);
                      return (
                        <tr key={j} style={{ borderBottom:j<r.verified.length-1?`1px solid ${border}`:"none", background:j%2===0?"transparent":`${surface2}50` }}>
                          <td style={{ padding:"9px 12px", color:text, fontWeight:confirmed.some(c => c.phrase === v.phrase)?700:400 }}>{v.phrase}</td>
                          <td style={{ padding:"9px 12px", color:accent }}>{v.weight||"—"}</td>
                          <td style={{ padding:"9px 12px", color:textSub }}>{v.similarity?`${(v.similarity*100).toFixed(0)}%`:"—"}</td>
                          <td style={{ padding:"9px 12px", color:textSub, fontSize:11 }}>{(v.zones||[]).slice(0,2).join(", ")||"—"}</td>
                          <td style={{ padding:"9px 12px" }}>
                            <span style={{ color:st.color, fontWeight:600, fontSize:11 }}>{st.label}</span>
                            {v.rank&&<span style={{ color:textMuted, fontSize:10, marginLeft:6 }}>#{v.rank}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}
