import { useState, useEffect, useRef } from "react";

const PROXY = process.env.REACT_APP_PROXY_URL || "https://serp-proxy-true.onrender.com/serp";

// ─── FILTER 1: Generic words that should never be standalone candidates ───
const GENERIC = new Set([
  "services","solutions","tools","software","platform","company","agency","provider",
  "system","guide","best","top","list","review","free","online","how","what","why",
  "learn","read","find","get","use","using","tips","tricks","examples","tutorial",
  "introduction","overview","complete","ultimate","comprehensive","full","new",
  "vs","versus","compared","comparison","alternative","alternatives","vs.",
  "2024","2025","2026","year","today","now","here","there","like","just",
]);

const STOPWORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
  "from","is","are","was","were","be","been","being","have","has","had","do",
  "does","did","will","would","could","should","may","might","can","it","its",
  "this","that","these","those","we","you","i","they","he","she","us","them",
  "not","so","if","as","up","out","about","into","than","then","there","more",
  "most","also","just","all","any","each","both","per","via","after","before",
]);

// ─── FILTER 4: Position weights ───
const ZONE_WEIGHTS = {
  url_slug: 8, meta_title: 9, h1: 10, h2: 7, h3: 4, h4: 3,
  meta_description: 5, paragraph: 2,
};

// ─── Utility functions ───
function cleanWord(w) {
  return w.toLowerCase().replace(/[^a-z0-9\-]/g, "").trim();
}

function tokenize(text) {
  return text.toLowerCase().split(/\s+/).map(cleanWord).filter(w => w.length > 2);
}

function extractNgrams(text, min, max) {
  const words = tokenize(text);
  const grams = [];
  for (let n = min; n <= max; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const gram = words.slice(i, i + n).join(" ");
      const meaningful = words.slice(i, i + n).filter(w => !STOPWORDS.has(w) && !GENERIC.has(w));
      if (meaningful.length >= 1) grams.push(gram);
    }
  }
  return grams;
}

function getUrlSlug(url) {
  try {
    const path = new URL(url).pathname;
    return path.replace(/[\/\-_]/g, " ").replace(/\s+/g, " ").trim();
  } catch { return ""; }
}

// ─── FILTER 2: Extract anchor entity + intent from keyword ───
function parseKeywordContext(keyword) {
  const words = tokenize(keyword);
  const meaningful = words.filter(w => !STOPWORDS.has(w));
  // Proper nouns / brands tend to be title-cased in original — approximate with length + position
  const entity = meaningful[0] || keyword; // first meaningful word = likely anchor
  const intent = meaningful.slice(1).filter(w => !GENERIC.has(w));
  return { entity, intent, meaningful };
}

// ─── FILTER 1+2: Build candidate list from page data ───
function buildCandidates(pageData, keyword) {
  const { meta_title, meta_description, h1, h2, h3, h4, paragraphs, url } = pageData;
  const { entity, meaningful: kwWords } = parseKeywordContext(keyword);
  const candidateMap = {}; // phrase → { weight, zones }

  const addCandidate = (phrase, zone) => {
    const words = phrase.split(" ");
    // Filter 1: must have at least one non-generic, non-stopword word
    const content = words.filter(w => !STOPWORDS.has(w) && !GENERIC.has(w));
    if (content.length === 0) return;
    // Must contain the anchor entity OR share 50%+ words with keyword
    const overlap = words.filter(w => kwWords.includes(w)).length;
    const hasEntity = phrase.includes(entity);
    if (!hasEntity && overlap < Math.ceil(kwWords.length * 0.4)) return;
    const weight = ZONE_WEIGHTS[zone] || 1;
    if (!candidateMap[phrase]) candidateMap[phrase] = { weight: 0, zones: [] };
    candidateMap[phrase].weight += weight;
    if (!candidateMap[phrase].zones.includes(zone)) candidateMap[phrase].zones.push(zone);
  };

  // Extract from each zone
  const zones = [
    { text: getUrlSlug(url || ""), zone: "url_slug" },
    { text: meta_title || "", zone: "meta_title" },
    { text: (h1 || []).filter(v => v !== "—").join(" "), zone: "h1" },
    { text: (h2 || []).filter(v => v !== "—").join(" "), zone: "h2" },
    { text: (h3 || []).filter(v => v !== "—").join(" "), zone: "h3" },
    { text: (h4 || []).filter(v => v !== "—").join(" "), zone: "h4" },
    { text: meta_description || "", zone: "meta_description" },
  ];

  (paragraphs || []).slice(0, 5).forEach(p => zones.push({ text: p, zone: "paragraph" }));

  zones.forEach(({ text, zone }) => {
    if (!text) return;
    extractNgrams(text, 1, 4).forEach(gram => addCandidate(gram, zone));
  });

  // Sort by weight descending
  return Object.entries(candidateMap)
    .sort((a, b) => b[1].weight - a[1].weight)
    .map(([phrase, meta]) => ({ phrase, ...meta }));
}

// ─── FILTER 3: TF.js cosine similarity clustering ───
async function embedAndCluster(candidates, keyword, useModel) {
  if (!useModel) return candidates.slice(0, 10);
  try {
    const phrases = [keyword, ...candidates.map(c => c.phrase)];
    const embeddings = await useModel.embed(phrases);
    const vectors = await embeddings.array();
    embeddings.dispose();

    const kwVec = vectors[0];
    const cosine = (a, b) => {
      const dot = a.reduce((s, v, i) => s + v * b[i], 0);
      const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
      const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
      return dot / (magA * magB);
    };

    // Score each candidate by cosine similarity to keyword
    const scored = candidates.map((c, i) => ({
      ...c,
      similarity: cosine(kwVec, vectors[i + 1]),
    })).filter(c => c.similarity > 0.5)
      .sort((a, b) => (b.similarity * b.weight) - (a.similarity * a.weight));

    // Filter 3: cluster — remove if >0.92 similar to a higher-ranked candidate
    const clustered = [];
    for (const c of scored) {
      const isDupe = clustered.some(kept => {
        const kVec = vectors[candidates.findIndex(x => x.phrase === kept.phrase) + 1];
        const cVec = vectors[candidates.findIndex(x => x.phrase === c.phrase) + 1];
        return cosine(kVec, cVec) > 0.92;
      });
      if (!isDupe) clustered.push(c);
      if (clustered.length >= 8) break;
    }

    return clustered;
  } catch {
    return candidates.slice(0, 8);
  }
}

// ─── FILTER 5: Cross-page pre-confirmation (free) ───
function crossPageConfirm(results) {
  const phrasePageCount = {};
  results.forEach(r => {
    const seen = new Set();
    (r.candidates || []).forEach(c => {
      if (!seen.has(c.phrase)) {
        phrasePageCount[c.phrase] = (phrasePageCount[c.phrase] || 0) + 1;
        seen.add(c.phrase);
      }
    });
  });
  // Phrases appearing in 3+ pages' top candidates = pre-confirmed, no SerpAPI needed
  return Object.entries(phrasePageCount)
    .filter(([, count]) => count >= 3)
    .map(([phrase]) => phrase);
}

// ─── SerpAPI verification ───
async function verifyCandidates(candidates, pageUrl, apiKey, country, preConfirmed) {
  const verified = [];
  const domain = (() => { try { return new URL(pageUrl).hostname.replace("www.", ""); } catch { return ""; } })();

  for (const candidate of candidates) {
    // Filter 5: pre-confirmed across pages — skip API call
    if (preConfirmed.includes(candidate.phrase)) {
      verified.push({ ...candidate, status: "pre_confirmed", searched: false });
      continue;
    }

    try {
      const params = new URLSearchParams({
        q: candidate.phrase, api_key: apiKey,
        num: 10, hl: country.hl, gl: country.gl,
      });
      const res = await fetch(`${PROXY}?${params}`);
      const data = await res.json();
      const organic = data.organic_results || [];
      const ranks = organic
        .map((r, i) => ({ rank: i + 1, url: r.link || "" }))
        .filter(r => r.url.includes(domain));

      if (ranks.length > 0) {
        verified.push({ ...candidate, status: "verified", rank: ranks[0].rank, searched: true });
        // If we found a high-confidence match (rank 1-3), stop early
        if (ranks[0].rank <= 3 && (candidate.similarity || 0) > 0.7) break;
      } else {
        verified.push({ ...candidate, status: "not_ranking", searched: true });
      }
    } catch {
      verified.push({ ...candidate, status: "error", searched: true });
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  return verified;
}

export default function RankIntelligence({ results, serpData, keyword, apiKey, country, searched, loading, theme: T, dark }) {
  const [analysis, setAnalysis] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [stage, setStage] = useState("");
  const [useModel, setUseModel] = useState(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [started, setStarted] = useState(false);
  const prevKeyword = useRef("");

  // Load TF.js Universal Sentence Encoder lazily
  const loadModel = async () => {
    if (useModel || modelLoading) return;
    setModelLoading(true);
    setStage("Loading semantic model (one-time ~5s)...");
    try {
      const tf = await import("@tensorflow/tfjs");
      await tf.ready();
      const use = await import("@tensorflow-models/universal-sentence-encoder");
      const model = await use.load();
      setUseModel(model);
      setModelReady(true);
      setStage("");
    } catch {
      setModelReady(false);
      setStage("");
    }
    setModelLoading(false);
  };

  const runAnalysis = async () => {
    if (!results?.length || !keyword || !apiKey) return;
    setStarted(true);
    setProcessing(true);
    setAnalysis([]);
    prevKeyword.current = keyword;

    // Load model if not ready
    if (!useModel) await loadModel();

    // Analyze top 5 pages only for verification (pages 6-12 get candidates only)
    const TOP_N_VERIFY = 5;
    const pageResults = [];

    // Phase 1: Build candidates for all pages
    setStage("Phase 1 — Extracting candidates from all pages...");
    for (const r of results) {
      const candidates = buildCandidates(r, keyword);
      pageResults.push({ ...r, candidates: candidates.slice(0, 20), verified: [] });
    }

    // Filter 5: Cross-page pre-confirmation (free)
    setStage("Phase 2 — Cross-page confirmation check...");
    const preConfirmed = crossPageConfirm(pageResults);

    // Phase 2: TF.js clustering for top 5
    setStage("Phase 3 — Semantic clustering with TF.js...");
    for (let i = 0; i < Math.min(TOP_N_VERIFY, pageResults.length); i++) {
      pageResults[i].candidates = await embedAndCluster(
        pageResults[i].candidates, keyword, useModel
      );
    }

    // Phase 3: SerpAPI verification for top 5 only
    let totalSearches = 0;
    for (let i = 0; i < Math.min(TOP_N_VERIFY, pageResults.length); i++) {
      const r = pageResults[i];
      setStage(`Phase 4 — Verifying keywords for rank ${r.rank} (${r.domain})... [${totalSearches} searches used]`);
      // Only verify candidates not already pre-confirmed
      const toVerify = r.candidates.filter(c => !preConfirmed.includes(c.phrase)).slice(0, 6);
      const verified = await verifyCandidates(toVerify, r.url, apiKey, country, preConfirmed);
      pageResults[i].verified = verified;
      totalSearches += verified.filter(v => v.searched).length;
      setAnalysis([...pageResults]);
    }

    // Pages 6-12: just show candidates, no verification
    for (let i = TOP_N_VERIFY; i < pageResults.length; i++) {
      pageResults[i].verified = pageResults[i].candidates.slice(0, 6).map(c => ({
        ...c, status: "unverified"
      }));
    }

    setAnalysis([...pageResults]);
    setStage(`Complete — ${totalSearches} SerpAPI searches used`);
    setProcessing(false);
  };

  const surface = T?.surface || "#1d1a2e";
  const surface2 = T?.surface2 || "#252238";
  const surface3 = T?.surface3 || "#2c2844";
  const border = T?.border || "#2e2b42";
  const text = T?.text || "#ede8de";
  const textSub = T?.textSub || "#8a8499";
  const textMuted = T?.textMuted || "#4e4a60";
  const accent = T?.accent || "#c9a96e";
  const accentSub = T?.accentSub || "#9b8afb";
  const accentGreen = T?.accentGreen || "#5dcfaa";
  const shadow = T?.shadow || "rgba(0,0,0,0.3)";

  const statusColor = (s) => ({
    verified: accentGreen, pre_confirmed: accent,
    not_ranking: "#f87171", unverified: textMuted, error: "#f87171",
  }[s] || textMuted);

  const statusLabel = (s) => ({
    verified: "✅ Verified", pre_confirmed: "⚡ Pre-confirmed",
    not_ranking: "❌ Not ranking", unverified: "◦ Candidate", error: "⚠️ Error",
  }[s] || s);

  const card = {
    background: surface, border: `1px solid ${border}`,
    borderRadius: 20, boxShadow: `0 4px 20px ${shadow}`,
    padding: "20px 24px", marginBottom: 12,
  };

  if (!searched) return (
    <div style={{ ...card, textAlign: "center", padding: "60px" }}>
      <div style={{ fontSize: 15, color: textMuted, fontWeight: 500 }}>Search a keyword first to run Rank Intelligence</div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: text, marginBottom: 4 }}>Rank Intelligence</div>
          <div style={{ fontSize: 12, color: textMuted }}>
            Discovers why each page ranks for <span style={{ color: accent, fontWeight: 600 }}>"{keyword}"</span> using semantic filtering + SerpAPI verification
          </div>
        </div>
        {!processing && (
          <button onClick={runAnalysis} disabled={processing || loading}
            style={{ padding: "11px 28px", borderRadius: 14, border: "none", background: processing ? surface2 : `linear-gradient(135deg,${accentSub},#c084fc)`, color: "#fff", fontSize: 14, fontWeight: 700, cursor: processing ? "not-allowed" : "pointer", boxShadow: `0 4px 16px ${accentSub}40` }}>
            {started ? "Re-run Analysis" : "Run Analysis"}
          </button>
        )}
      </div>

      {/* Pipeline legend */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          ["F1", "Generic Filter", "#60a5fa"],
          ["F2", "Entity Extraction", "#a78bfa"],
          ["F3", "TF.js Clustering", "#34d399"],
          ["F4", "Zone Weighting", accent],
          ["F5", "Cross-page Check", accentGreen],
          ["V", "SerpAPI Verify", "#f472b6"],
        ].map(([code, label, color]) => (
          <div key={code} style={{ display: "flex", alignItems: "center", gap: 6, background: `${color}12`, border: `1px solid ${color}30`, borderRadius: 8, padding: "4px 12px" }}>
            <span style={{ fontSize: 10, fontWeight: 800, color, background: `${color}25`, borderRadius: 4, padding: "1px 5px" }}>{code}</span>
            <span style={{ fontSize: 11, color: textSub }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Stage indicator */}
      {(processing || stage) && (
        <div style={{ ...card, padding: "14px 20px", background: `${accentSub}10`, border: `1px solid ${accentSub}30`, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {processing && <div style={{ width: 8, height: 8, borderRadius: "50%", background: accentSub, animation: "pulse 1s infinite" }} />}
            <span style={{ fontSize: 13, color: accentSub, fontWeight: 600 }}>{stage}</span>
          </div>
        </div>
      )}

      {/* Results */}
      {analysis.map((r, i) => {
        const verifiedOnes = r.verified?.filter(v => v.status === "verified" || v.status === "pre_confirmed") || [];
        const isTopFive = i < 5;

        return (
          <div key={i} style={card}>
            {/* Page header */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: i < 3 ? `linear-gradient(135deg,${accentSub},#c084fc)` : surface2, fontWeight: 800, fontSize: 13, color: "#fff", flexShrink: 0 }}>{r.rank}</div>
              <div style={{ flex: 1 }}>
                <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: accentSub, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>{r.site_name}</a>
                <div style={{ fontSize: 11, color: textMuted, fontFamily: "monospace", marginTop: 2 }}>{r.domain}</div>
                {r.meta_title && r.meta_title !== "—" && (
                  <div style={{ fontSize: 12, color: textSub, marginTop: 4, fontStyle: "italic" }}>"{r.meta_title}"</div>
                )}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                {r.word_count > 0 && (
                  <div style={{ fontSize: 11, color: textMuted }}>{r.word_count.toLocaleString()} words</div>
                )}
                {!isTopFive && (
                  <div style={{ fontSize: 10, color: textMuted, background: surface2, borderRadius: 6, padding: "2px 8px", marginTop: 4 }}>Candidates only</div>
                )}
              </div>
            </div>

            {/* Meta description */}
            {r.meta_description && r.meta_description !== "—" && (
              <div style={{ background: surface2, border: `1px solid ${border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: textSub, lineHeight: 1.6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: textMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginRight: 8 }}>Meta</span>
                {r.meta_description}
              </div>
            )}

            {/* Verified keywords */}
            {verifiedOnes.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: accentGreen, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                  Ranking Keywords Found
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {verifiedOnes.map((v, j) => (
                    <div key={j} style={{ background: `${accentGreen}12`, border: `1px solid ${accentGreen}35`, borderRadius: 10, padding: "7px 14px" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: accentGreen }}>{v.phrase}</div>
                      <div style={{ fontSize: 10, color: textMuted, marginTop: 2 }}>
                        {v.status === "pre_confirmed" ? "⚡ Pre-confirmed" : `✅ Rank #${v.rank}`}
                        {v.similarity && <span> · {(v.similarity * 100).toFixed(0)}% match</span>}
                        {v.zones?.length > 0 && <span> · {v.zones.join(", ")}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All candidates table */}
            {r.verified?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: textMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>All Candidates</div>
                <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${border}` }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: dark ? "#0a0f1e" : surface3 }}>
                        {["Keyword Candidate", "Score", "Zones", "Similarity", "Status"].map(h => (
                          <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: textMuted, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.verified.map((v, j) => (
                        <tr key={j} style={{ borderBottom: j < r.verified.length - 1 ? `1px solid ${border}` : "none", background: j % 2 === 0 ? "transparent" : `${surface2}50` }}>
                          <td style={{ padding: "9px 12px", color: text, fontWeight: v.status === "verified" || v.status === "pre_confirmed" ? 700 : 400 }}>{v.phrase}</td>
                          <td style={{ padding: "9px 12px", color: accent }}>{v.weight || "—"}</td>
                          <td style={{ padding: "9px 12px", color: textSub, fontSize: 11 }}>{(v.zones || []).join(", ") || "—"}</td>
                          <td style={{ padding: "9px 12px", color: textSub }}>{v.similarity ? `${(v.similarity * 100).toFixed(0)}%` : "—"}</td>
                          <td style={{ padding: "9px 12px" }}>
                            <span style={{ color: statusColor(v.status), fontWeight: 600, fontSize: 11 }}>{statusLabel(v.status)}</span>
                            {v.rank && <span style={{ color: textMuted, fontSize: 10, marginLeft: 6 }}>#{v.rank}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}
