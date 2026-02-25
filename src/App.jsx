import { useState, useCallback } from "react";

const PROXY = process.env.REACT_APP_PROXY_URL || "https://serp-proxy.onrender.com/serp";

export default function SerpScraper() {
  const [keyword, setKeyword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCache, setPageCache] = useState({});
  const [searched, setSearched] = useState(false);
  const [activeKeyword, setActiveKeyword] = useState("");
  const [totalResults, setTotalResults] = useState(null);
  const [copyMsg, setCopyMsg] = useState("");

  const fetchPage = useCallback(async (kw, page, key) => {
    if (pageCache[page]) {
      setResults(pageCache[page]);
      setCurrentPage(page);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const start = (page - 1) * 10;
      const url = `${PROXY}?q=${encodeURIComponent(kw)}&api_key=${encodeURIComponent(key)}&start=${start}&num=10&hl=en&gl=us`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const organic = data.organic_results || [];
      if (organic.length === 0) throw new Error("No organic results found for this keyword.");
      if (data.search_information?.total_results && page === 1)
        setTotalResults(data.search_information.total_results);
      const mapped = organic.map((item, i) => {
        const link = item.link || "";
        let domain = "";
        try { domain = new URL(link).hostname.replace("www.", ""); } catch {}
        const snippet = item.snippet || "";
        const kwL = kw.toLowerCase();
        const sentences = snippet.split(/(?<=[.!?])\s+/);
        const ctx = sentences.find(s => s.toLowerCase().includes(kwL)) || snippet;
        return {
          rank: start + i + 1,
          h1: item.title || "—",
          site_name: item.source || domain,
          domain: domain || "—",
          context_sentence: ctx || "—",
          url: link,
          date: item.date || null,
        };
      });
      setPageCache(prev => ({ ...prev, [page]: mapped }));
      setResults(mapped);
      setCurrentPage(page);
    } catch (e) {
      if (e.message?.includes("Invalid API key"))
        setError("❌ Invalid SerpAPI key. Please check and try again.");
      else if (e.message?.includes("Monthly Searches Exceeded"))
        setError("❌ Your SerpAPI monthly search limit has been exceeded.");
      else if (e.message?.includes("Failed to fetch"))
        setError("❌ Cannot reach proxy server. Please try again.");
      else
        setError("❌ " + e.message);
    } finally {
      setLoading(false);
    }
  }, [pageCache]);

  const handleSearch = () => {
    if (!keyword.trim()) return setError("Please enter a keyword.");
    if (!apiKey.trim()) return setError("Please enter your SerpAPI key.");
    setPageCache({});
    setResults([]);
    setCurrentPage(1);
    setSearched(true);
    setTotalResults(null);
    setActiveKeyword(keyword.trim());
    setError("");
    fetchPage(keyword.trim(), 1, apiKey.trim());
  };

  const handlePageChange = (page) => {
    if (page === currentPage || loading) return;
    fetchPage(activeKeyword, page, apiKey.trim());
  };

  const highlight = (text, kw) => {
    if (!kw || !text) return text;
    try {
      const regex = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
      return text.split(regex).map((p, i) =>
        regex.test(p)
          ? <mark key={i} style={{ background: "#facc15", color: "#111", borderRadius: 3, padding: "1px 3px", fontWeight: 600 }}>{p}</mark>
          : p
      );
    } catch { return text; }
  };

  const exportCSV = () => {
    if (!results.length) return;
    const headers = ["Rank", "H1", "Site Name", "Domain", "Context Sentence", "URL"];
    const rows = results.map(r =>
      [r.rank, r.h1, r.site_name, r.domain, r.context_sentence, r.url]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    navigator.clipboard.writeText([headers.join(","), ...rows].join("\n"));
    setCopyMsg("✅ Copied!");
    setTimeout(() => setCopyMsg(""), 2000);
  };

  const rankBg = (n) => {
    if (n <= 3) return "linear-gradient(135deg, #6366f1, #8b5cf6)";
    if (n <= 6) return "linear-gradient(135deg, #0ea5e9, #2563eb)";
    return "#1e293b";
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", color: "#e2e8f0", fontFamily: "'Inter', sans-serif", padding: "36px 16px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#1e293b", border: "1px solid #22c55e40", borderRadius: 50, padding: "5px 16px", marginBottom: 16 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block", boxShadow: "0 0 6px #22c55e" }} />
            <span style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.05em" }}>SERPAPI · LIVE GOOGLE DATA</span>
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.5px" }}>
            🔍 SERP H1 Scraper
          </h1>
          <p style={{ color: "#64748b", marginTop: 8, fontSize: 14 }}>
            Real Google rankings · Exact order · H1 · Domain · Keyword Context
          </p>
        </div>

        {/* API Key Row */}
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "14px 20px", marginBottom: 12, display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 18 }}>🔑</span>
          <span style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>SerpAPI Key</span>
          <input
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            type={showKey ? "text" : "password"}
            placeholder="Paste your SerpAPI key here..."
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#e2e8f0", fontSize: 13, fontFamily: "monospace", letterSpacing: showKey ? "normal" : "0.1em" }}
          />
          <button
            onClick={() => setShowKey(p => !p)}
            style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 7, padding: "6px 14px", color: "#94a3b8", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
            {showKey ? "🙈 Hide" : "👁 Show"}
          </button>
        </div>

        {/* Search Bar */}
        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          <input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="e.g. D2C Shopify Platforms"
            style={{ flex: 1, padding: "15px 20px", borderRadius: 12, border: "1.5px solid #334155", background: "#1e293b", color: "#e2e8f0", fontSize: 15, outline: "none", transition: "border-color 0.2s" }}
            onFocus={e => e.target.style.borderColor = "#6366f1"}
            onBlur={e => e.target.style.borderColor = "#334155"}
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            style={{ padding: "15px 36px", borderRadius: 12, border: "none", background: loading ? "#1e293b" : "linear-gradient(135deg, #6366f1, #8b5cf6)", color: loading ? "#64748b" : "#fff", fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", whiteSpace: "nowrap", border: loading ? "1px solid #334155" : "none", transition: "opacity 0.2s", letterSpacing: "0.02em" }}>
            {loading ? "⏳ Fetching..." : "Search →"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: "#450a0a", border: "1px solid #dc2626", borderRadius: 10, padding: "13px 18px", marginBottom: 20, color: "#fca5a5", fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>⚠️</span> {error}
          </div>
        )}

        {/* Loading Skeleton */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[...Array(8)].map((_, i) => (
              <div key={i} style={{ background: "#1e293b", borderRadius: 12, padding: "16px 20px", opacity: 1 - i * 0.09, border: "1px solid #1e293b" }}>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: "#334155", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 13, background: "#334155", borderRadius: 4, width: `${50 + (i % 3) * 14}%`, marginBottom: 9 }} />
                    <div style={{ height: 11, background: "#243044", borderRadius: 4, width: `${28 + (i % 4) * 9}%` }} />
                  </div>
                  <div style={{ width: 90, height: 24, background: "#243044", borderRadius: 6 }} />
                </div>
              </div>
            ))}
            <div style={{ textAlign: "center", fontSize: 12, color: "#475569", marginTop: 8, letterSpacing: "0.03em" }}>
              ⚡ Fetching real Google results via SerpAPI...
            </div>
          </div>
        )}

        {/* Results */}
        {!loading && results.length > 0 && (
          <>
            {/* Meta Bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: "#64748b" }}>
                Page <span style={{ color: "#a5b4fc", fontWeight: 700 }}>{currentPage}</span>
                {" · "}
                <span style={{ color: "#fff", fontWeight: 600 }}>"{activeKeyword}"</span>
                {totalResults && (
                  <span style={{ color: "#334155" }}> · ~{Number(totalResults).toLocaleString()} Google results</span>
                )}
              </div>
              <button
                onClick={exportCSV}
                style={{ background: copyMsg ? "#0f2318" : "#1e293b", border: `1px solid ${copyMsg ? "#22c55e" : "#334155"}`, borderRadius: 9, padding: "8px 18px", color: copyMsg ? "#22c55e" : "#94a3b8", fontSize: 12, cursor: "pointer", fontWeight: 500, transition: "all 0.2s" }}>
                {copyMsg || "📋 Export CSV"}
              </button>
            </div>

            {/* Table */}
            <div style={{ background: "#1e293b", borderRadius: 14, overflow: "hidden", border: "1px solid #1e293b", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
              {/* Table Header */}
              <div style={{ display: "grid", gridTemplateColumns: "60px 2fr 1fr 150px 2fr", background: "#080e1a", padding: "13px 22px", gap: 16, borderBottom: "1px solid #1e2d45", fontSize: 10, fontWeight: 800, color: "#3b5068", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                <span>Rank</span>
                <span>H1 Title</span>
                <span>Site Name</span>
                <span>Domain</span>
                <span>Keyword Context</span>
              </div>

              {results.map((r, i) => (
                <div
                  key={i}
                  style={{ display: "grid", gridTemplateColumns: "60px 2fr 1fr 150px 2fr", padding: "16px 22px", gap: 16, borderBottom: i < results.length - 1 ? "1px solid #111927" : "none", background: i % 2 === 0 ? "#1e293b" : "#18223a", fontSize: 13, alignItems: "start", transition: "background 0.15s, box-shadow 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#1e3155"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? "#1e293b" : "#18223a"; }}>

                  {/* Rank Badge */}
                  <div style={{ width: 38, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: rankBg(r.rank), border: r.rank > 6 ? "1px solid #334155" : "none", fontWeight: 800, fontSize: 14, color: "#fff", flexShrink: 0, boxShadow: r.rank <= 3 ? "0 2px 10px rgba(99,102,241,0.4)" : "none" }}>
                    {r.rank}
                  </div>

                  {/* H1 Title */}
                  <div>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#a5b4fc", fontWeight: 600, textDecoration: "none", lineHeight: 1.55, fontSize: 13, display: "block" }}
                      onMouseEnter={e => e.target.style.color = "#c7d2fe"}
                      onMouseLeave={e => e.target.style.color = "#a5b4fc"}>
                      {r.h1}
                    </a>
                    {r.date && (
                      <div style={{ fontSize: 11, color: "#3b5068", marginTop: 4 }}>📅 {r.date}</div>
                    )}
                  </div>

                  {/* Site Name */}
                  <div style={{ color: "#cbd5e1", fontWeight: 500, fontSize: 13, paddingTop: 2 }}>{r.site_name}</div>

                  {/* Domain */}
                  <div style={{ paddingTop: 2 }}>
                    <span style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 7, padding: "4px 10px", fontSize: 11, color: "#7dd3fc", fontFamily: "monospace", display: "inline-block" }}>
                      {r.domain}
                    </span>
                  </div>

                  {/* Context Sentence */}
                  <div style={{ color: "#8899aa", lineHeight: 1.7, fontSize: 12, paddingTop: 2 }}>
                    {highlight(r.context_sentence, activeKeyword)}
                  </div>
                </div>
              ))}
            </div>

            {/* Page Navigator */}
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 28, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#3b5068", marginRight: 6, fontWeight: 500 }}>Page:</span>
              {[1, 2, 3, 4, 5].map(p => (
                <button
                  key={p}
                  onClick={() => handlePageChange(p)}
                  disabled={loading}
                  style={{ width: 46, height: 46, borderRadius: 11, border: "1.5px solid", borderColor: p === currentPage ? "#6366f1" : pageCache[p] ? "#22c55e" : "#1e293b", background: p === currentPage ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : pageCache[p] ? "#0a1f12" : "#1e293b", color: p === currentPage ? "#fff" : pageCache[p] ? "#22c55e" : "#475569", fontWeight: 700, fontSize: 14, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", boxShadow: p === currentPage ? "0 2px 12px rgba(99,102,241,0.35)" : "none" }}>
                  {p}
                </button>
              ))}
              <div style={{ marginLeft: 10, display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#3b5068" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "#22c55e", display: "inline-block" }} />
                Cached
              </div>
            </div>
          </>
        )}

        {/* Empty State */}
        {!loading && searched && results.length === 0 && !error && (
          <div style={{ textAlign: "center", padding: "70px 20px", color: "#475569" }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🔍</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>No results found</div>
            <div style={{ fontSize: 13, marginTop: 6, color: "#334155" }}>Try a different keyword or check your API key</div>
          </div>
        )}

        {/* Initial State */}
        {!searched && !error && (
          <div style={{ textAlign: "center", padding: "70px 20px" }}>
            <div style={{ fontSize: 60, marginBottom: 18 }}>📋</div>
            <div style={{ fontSize: 16, color: "#475569", marginBottom: 8, fontWeight: 500 }}>
              Paste your SerpAPI key + enter a keyword → hit Search
            </div>
            <div style={{ fontSize: 12, color: "#2d3f55", marginBottom: 24 }}>
              Rank · H1 Title · Site Name · Domain · Keyword Context · 5 Pages
            </div>
            <div style={{ display: "inline-flex", gap: 24, background: "#1e293b", border: "1px solid #1e3a5f", borderRadius: 12, padding: "14px 28px" }}>
              {[["⚡", "Real Rankings"], ["🎯", "Exact Order"], ["📄", "5 Pages"], ["📋", "CSV Export"]].map(([icon, label]) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
                  <div style={{ fontSize: 11, color: "#475569", fontWeight: 500 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0f1117; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        ::selection { background: #6366f1; color: #fff; }
      `}</style>
    </div>
  );
}