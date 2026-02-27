import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const STOPWORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "by","from","is","are","was","were","be","been","being","have","has",
  "had","do","does","did","will","would","could","should","may","might",
  "can","what","how","why","when","where","who","which","that","this",
  "these","those","it","its","their","your","our","my","his","her","we",
  "you","i","they","he","she","us","them","not","no","so","if","as","up",
  "out","about","into","than","then","there","here","more","most","also",
  "just","get","use","using","used","make","all","any","each","both","vs",
  "new","top","best","via","per","vs","whether","while","after","before"
]);

function cleanText(t) {
  return t.replace(/[^a-zA-Z0-9\s\-]/g, " ").replace(/\s+/g, " ").trim();
}

function wordCount(str) {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

function isContentPhrase(phrase) {
  const words = phrase.toLowerCase().split(/\s+/);
  const meaningful = words.filter(w => !STOPWORDS.has(w) && w.length > 2);
  return meaningful.length >= 1 && phrase.length > 3 && phrase.length < 120;
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter(item => {
    const k = item.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export default function KeywordPage() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const [keywords, setKeywords] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copyMsg, setCopyMsg] = useState("");

  useEffect(() => {
    if (!state?.keyword) { navigate("/"); return; }
    processKeywords();
  }, []);

  const processKeywords = async () => {
    const { keyword, results = [], related_searches = [], related_questions = [] } = state;

    // Extract all headings from 12 results
    const allHeadings = results.flatMap(r =>
      ["h1","h2","h3","h4","h5","h6"].flatMap(hk =>
        Array.isArray(r[hk]) ? r[hk].filter(h => h && h !== "—" && h !== "...") : []
      )
    ).map(cleanText).filter(Boolean);

    // Secondary keywords — from Google related searches
    const secondary = dedup(
      (related_searches || [])
        .map(r => r.query || "")
        .filter(q => q && q.toLowerCase() !== keyword.toLowerCase())
    ).slice(0, 12);

    // Long tail — PAA questions + headings with 5+ words
    const paaLongTail = (related_questions || [])
      .map(q => q.question || "")
      .filter(Boolean);

    const headingLongTail = allHeadings
      .filter(h => wordCount(h) >= 5 && isContentPhrase(h));

    const longTail = dedup([...paaLongTail, ...headingLongTail]).slice(0, 20);

    // Short tail — 1-3 word content phrases from headings
    const shortTail = dedup(
      allHeadings
        .filter(h => {
          const wc = wordCount(h);
          return wc >= 1 && wc <= 3 && isContentPhrase(h);
        })
        .sort((a, b) => {
          // sort by frequency across results
          const freqA = results.filter(r =>
            ["h1","h2","h3","h4","h5","h6"].some(hk =>
              Array.isArray(r[hk]) && r[hk].some(t => t?.toLowerCase().includes(a.toLowerCase()))
            )
          ).length;
          const freqB = results.filter(r =>
            ["h1","h2","h3","h4","h5","h6"].some(hk =>
              Array.isArray(r[hk]) && r[hk].some(t => t?.toLowerCase().includes(b.toLowerCase()))
            )
          ).length;
          return freqB - freqA;
        })
    ).slice(0, 15);

    // Datamuse — related words (ml = means like)
    let related = [];
    let synonyms = [];
    try {
      const [relRes, synRes] = await Promise.all([
        fetch(`https://api.datamuse.com/words?ml=${encodeURIComponent(keyword)}&max=20`).then(r => r.json()),
        fetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(keyword.split(" ")[0])}&max=12`).then(r => r.json()),
      ]);
      related = relRes.map(w => w.word).filter(w => !STOPWORDS.has(w));
      synonyms = synRes.map(w => w.word).filter(w => !STOPWORDS.has(w));
    } catch {}

    setKeywords({
      primary: keyword,
      secondary,
      longTail,
      shortTail,
      related,
      synonyms,
    });
    setLoading(false);
  };

  const getFrequency = (phrase) => {
    if (!state?.results) return 0;
    return state.results.filter(r =>
      ["h1","h2","h3","h4","h5","h6"].some(hk =>
        Array.isArray(r[hk]) && r[hk].some(t =>
          t?.toLowerCase().includes(phrase.toLowerCase())
        )
      )
    ).length;
  };

  const exportCSV = (download = false) => {
    if (!keywords) return;
    const rows = [
      ["Category", "Keyword", "Source", "Frequency"],
      ["Primary", keywords.primary, "User Search", "—"],
      ...keywords.secondary.map(k => ["Secondary", k, "Google Related Searches", "—"]),
      ...keywords.longTail.map(k => ["Long Tail", k, "PAA / Headings", getFrequency(k)]),
      ...keywords.shortTail.map(k => ["Short Tail", k, "Page Headings", getFrequency(k)]),
      ...keywords.related.map(k => ["Related", k, "Datamuse API", "—"]),
      ...keywords.synonyms.map(k => ["Synonym", k, "Datamuse API", "—"]),
    ].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");

    if (download) {
      const blob = new Blob([rows], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `keywords-${keywords.primary.replace(/\s+/g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      navigator.clipboard.writeText(rows);
      setCopyMsg("Copied!");
      setTimeout(() => setCopyMsg(""), 2000);
    }
  };

  const sections = keywords ? [
    { label: "Primary Keyword", key: "primary", color: "#8b5cf6", border: "#6366f1", isString: true, desc: "The keyword you searched" },
    { label: "Secondary Keywords", key: "secondary", color: "#0ea5e9", border: "#2563eb", desc: "Google related searches for this keyword" },
    { label: "Long Tail Keywords", key: "longTail", color: "#22c55e", border: "#16a34a", desc: "4+ word phrases from PAA and page headings" },
    { label: "Short Tail Keywords", key: "shortTail", color: "#f59e0b", border: "#d97706", desc: "1–3 word phrases extracted from page headings" },
    { label: "Related Keywords", key: "related", color: "#ec4899", border: "#db2777", desc: "Semantically related terms via Datamuse API" },
    { label: "Synonyms", key: "synonyms", color: "#14b8a6", border: "#0d9488", desc: "Alternate terms for the primary keyword" },
  ] : [];

  const tagStyle = (color, border) => ({
    display: "inline-flex", alignItems: "center", gap: 6,
    background: `${color}15`, border: `1px solid ${border}40`,
    borderRadius: 7, padding: "5px 12px", fontSize: 12,
    color: color, fontWeight: 500, margin: "4px",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", color: "#e2e8f0", fontFamily: "'Inter', sans-serif", padding: "36px 16px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#1e293b", border: "1px solid #22c55e40", borderRadius: 50, padding: "5px 16px", marginBottom: 14 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block", boxShadow: "0 0 6px #22c55e" }} />
            <span style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.06em" }}>FREE · SERPAPI + DATAMUSE · NO AI COST</span>
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.5px" }}>Keyword Analysis</h1>
          {state?.keyword && (
            <p style={{ color: "#64748b", marginTop: 8, fontSize: 13 }}>
              Analyzing keywords for <span style={{ color: "#a5b4fc", fontWeight: 600 }}>"{state.keyword}"</span>
              {state?.country && (
                <span style={{ marginLeft: 8, background: "#1e3a5f", border: "1px solid #2563eb", borderRadius: 6, padding: "2px 10px", fontSize: 11, color: "#7dd3fc", fontWeight: 600 }}>
                  {state.country.label}
                </span>
              )}
            </p>
          )}
        </div>

        {/* Nav buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <button onClick={() => navigate("/")}
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 9, padding: "9px 20px", color: "#94a3b8", fontSize: 13, cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            ← Back to SERP Scraper
          </button>
          {keywords && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => exportCSV(true)}
                style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 9, padding: "9px 20px", color: "#94a3b8", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
                Download CSV
              </button>
              <button onClick={() => exportCSV(false)}
                style={{ background: copyMsg ? "#0f2318" : "#1e293b", border: `1px solid ${copyMsg ? "#22c55e" : "#334155"}`, borderRadius: 9, padding: "9px 20px", color: copyMsg ? "#22c55e" : "#94a3b8", fontSize: 13, cursor: "pointer", fontWeight: 600, transition: "all 0.2s" }}>
                {copyMsg || "Copy Sheet"}
              </button>
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} style={{ background: "#1e293b", borderRadius: 12, padding: "20px 24px", opacity: 1 - i * 0.1, border: "1px solid #1e293b" }}>
                <div style={{ height: 14, background: "#334155", borderRadius: 4, width: "25%", marginBottom: 14 }} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {[...Array(6)].map((_, j) => (
                    <div key={j} style={{ height: 30, width: `${60 + j * 20}px`, background: "#243044", borderRadius: 7 }} />
                  ))}
                </div>
              </div>
            ))}
            <div style={{ textAlign: "center", fontSize: 12, color: "#475569", marginTop: 4 }}>Analyzing keywords from SERP data + Datamuse API...</div>
          </div>
        )}

        {/* Keyword Sections */}
        {!loading && keywords && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {sections.map(({ label, key, color, border, isString, desc }) => {
              const items = isString ? [keywords[key]] : keywords[key];
              return (
                <div key={key} style={{ background: "#1e293b", border: `1px solid ${border}30`, borderRadius: 14, padding: "20px 24px", boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", letterSpacing: "0.02em" }}>{label}</span>
                        <span style={{ background: `${color}20`, border: `1px solid ${color}40`, borderRadius: 50, padding: "2px 10px", fontSize: 11, color, fontWeight: 600 }}>
                          {items.length}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "#475569", marginTop: 4, marginLeft: 20 }}>{desc}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap" }}>
                    {items.length === 0 ? (
                      <span style={{ color: "#334155", fontSize: 12, fontStyle: "italic" }}>No data found</span>
                    ) : items.map((item, idx) => {
                      const freq = !isString && (key === "longTail" || key === "shortTail") ? getFrequency(item) : null;
                      return (
                        <span key={idx} style={tagStyle(color, border)}>
                          {item}
                          {freq !== null && freq > 0 && (
                            <span style={{ background: `${color}25`, borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>
                              {freq}/12
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Summary stats */}
        {!loading && keywords && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginTop: 20 }}>
            {[
              ["Secondary", keywords.secondary.length, "#0ea5e9"],
              ["Long Tail", keywords.longTail.length, "#22c55e"],
              ["Short Tail", keywords.shortTail.length, "#f59e0b"],
              ["Related", keywords.related.length, "#ec4899"],
              ["Synonyms", keywords.synonyms.length, "#14b8a6"],
            ].map(([label, count, color]) => (
              <div key={label} style={{ background: "#1e293b", border: "1px solid #1e293b", borderRadius: 12, padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: 26, fontWeight: 800, color }}>{count}</div>
                <div style={{ fontSize: 11, color: "#475569", marginTop: 4, fontWeight: 500 }}>{label}</div>
              </div>
            ))}
          </div>
        )}

      </div>
      <style>{`* { box-sizing: border-box; } ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #0f1117; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; } ::selection { background: #6366f1; color: #fff; }`}</style>
    </div>
  );
}
