import { useState, useEffect, useRef } from "react";

const STOPWORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
  "from","is","are","was","were","be","been","have","has","do","does","will",
  "would","could","should","may","can","it","its","this","that","we","you",
  "i","they","not","so","if","as","up","out","about","into","than","then",
  "more","most","also","just","all","any","each","our","your","their","us",
]);

// Commercial intent signals — these words in ad copy = high purchase intent
const COMMERCIAL_SIGNALS = new Set([
  "pricing","price","cost","costs","free","trial","demo","hire","buy","get",
  "quote","discount","offer","deal","affordable","cheap","premium","enterprise",
  "plan","plans","subscribe","consultation","contact","agency","expert",
  "professional","certified","guaranteed","trusted","award","rated","leading",
  "custom","dedicated","managed","outsource","offshore","onshore","nearshore",
  "solution","results","roi","savings","fast","quick","reliable","scalable",
]);

function clean(t) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text) {
  return clean(text).split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function extractNgrams(text, min, max) {
  const words = clean(text).split(/\s+/).filter(w => w.length > 1);
  const grams = [];
  for (let n = min; n <= max; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const slice = words.slice(i, i + n);
      const meaningful = slice.filter(w => !STOPWORDS.has(w) && w.length > 2);
      if (meaningful.length >= 1) grams.push(slice.join(" "));
    }
  }
  return grams;
}

function dedup(arr) {
  const seen = new Set();
  return arr.filter(item => {
    const k = item.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function freqInAds(phrase, ads, field) {
  const pl = phrase.toLowerCase();
  return ads.filter(a => {
    const src = field === "all"
      ? `${a.title} ${a.description} ${(a.sitelinks||[]).join(" ")}`
      : (a[field] || "");
    return src.toLowerCase().includes(pl);
  }).length;
}

export default function AdKeywords({ keyword, ads=[], searched, loading, theme:T, dark }) {
  const [keywords, setKeywords] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");
  const prevKeyword = useRef("");

  useEffect(() => {
    if (!keyword || !ads.length) return;
    if (keyword === prevKeyword.current && keywords) return;
    prevKeyword.current = keyword;
    processAdKeywords();
  }, [keyword, ads]);

  const processAdKeywords = () => {
    setProcessing(true);
    setKeywords(null);

    const n = ads.length;
    if (!n) { setProcessing(false); return; }

    // ── Bidding Terms: phrases from ad TITLES appearing in 2+ ads ──────────
    const titlePhraseCount = {};
    ads.forEach(ad => {
      const seen = new Set();
      extractNgrams(ad.title || "", 1, 4).forEach(gram => {
        if (!seen.has(gram)) {
          titlePhraseCount[gram] = (titlePhraseCount[gram] || 0) + 1;
          seen.add(gram);
        }
      });
    });
    const biddingTerms = dedup(
      Object.entries(titlePhraseCount)
        .filter(([phrase, count]) => {
          const words = phrase.split(" ");
          const meaningful = words.filter(w => !STOPWORDS.has(w) && w.length > 2);
          return count >= 2 && meaningful.length >= 1 && phrase.length > 2;
        })
        .sort((a, b) => b[1] - a[1])
        .map(([phrase]) => phrase)
    ).slice(0, 15);

    // ── Ad Copy Phrases: 2-3 word phrases from descriptions in 2+ ads ──────
    const descPhraseCount = {};
    ads.forEach(ad => {
      const seen = new Set();
      extractNgrams(ad.description || "", 2, 3).forEach(gram => {
        const words = gram.split(" ");
        const meaningful = words.filter(w => !STOPWORDS.has(w) && w.length > 2);
        if (meaningful.length >= 1 && !seen.has(gram)) {
          descPhraseCount[gram] = (descPhraseCount[gram] || 0) + 1;
          seen.add(gram);
        }
      });
    });
    const adCopyPhrases = dedup(
      Object.entries(descPhraseCount)
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .map(([phrase]) => phrase)
    ).slice(0, 15);

    // ── Commercial Intent Words found in all ad copy ─────────────────────
    const allAdText = ads.map(a => `${a.title} ${a.description}`).join(" ").toLowerCase();
    const commercialFound = [...COMMERCIAL_SIGNALS].filter(word => allAdText.includes(word));

    // ── Advertiser Brands: domain names of all advertisers ───────────────
    const brands = dedup(
      ads.map(a => {
        // Try to extract brand from site name or domain
        const domain = a.domain || "";
        const brandName = domain.split(".")[0];
        return brandName.charAt(0).toUpperCase() + brandName.slice(1);
      }).filter(b => b && b.length > 1)
    );

    // ── Sitelink Topics: extract topics from sitelink text across all ads ─
    const sitelinkPhraseCount = {};
    ads.forEach(ad => {
      (ad.sitelinks || []).forEach(sl => {
        const seen = new Set();
        extractNgrams(sl, 1, 3).forEach(gram => {
          if (!seen.has(gram)) {
            sitelinkPhraseCount[gram] = (sitelinkPhraseCount[gram] || 0) + 1;
            seen.add(gram);
          }
        });
      });
    });
    const sitelinkTopics = dedup(
      Object.entries(sitelinkPhraseCount)
        .filter(([phrase, count]) => {
          const words = phrase.split(" ");
          const meaningful = words.filter(w => !STOPWORDS.has(w) && w.length > 2);
          return count >= 2 && meaningful.length >= 1;
        })
        .sort((a, b) => b[1] - a[1])
        .map(([phrase]) => phrase)
    ).slice(0, 12);

    // ── Long Tail Bids: full ad titles (4+ words) = exact bidding phrases ─
    const longTailBids = dedup(
      ads
        .map(a => a.title || "")
        .filter(t => t.split(/\s+/).length >= 4)
        .sort((a, b) => {
          // Sort by frequency of individual words appearing across ads
          const scoreA = tokenize(a).reduce((s, w) => s + (titlePhraseCount[w] || 0), 0);
          const scoreB = tokenize(b).reduce((s, w) => s + (titlePhraseCount[w] || 0), 0);
          return scoreB - scoreA;
        })
    ).slice(0, 12);

    // ── Page distribution ─────────────────────────────────────────────────
    const page1Count = ads.filter(a => a.page === 1).length;
    const page2Count = ads.filter(a => a.page === 2).length;

    setKeywords({
      primary: keyword,
      totalAds: n,
      page1Count,
      page2Count,
      biddingTerms,
      adCopyPhrases,
      commercialFound,
      brands,
      sitelinkTopics,
      longTailBids,
    });
    setProcessing(false);
  };

  const getCSV = () => {
    if (!keywords) return "";
    const rows = [
      ["Category", "Keyword / Term", "Source", "Frequency in Ads"],
      ["Primary", keywords.primary, "User Search", "—"],
      ...keywords.biddingTerms.map(k => ["Bidding Term", k, "Ad Titles", `${freqInAds(k, ads, "title")}/${keywords.totalAds}`]),
      ...keywords.adCopyPhrases.map(k => ["Ad Copy Phrase", k, "Ad Descriptions", `${freqInAds(k, ads, "description")}/${keywords.totalAds}`]),
      ...keywords.commercialFound.map(k => ["Commercial Signal", k, "All Ad Copy", `${freqInAds(k, ads, "all")}/${keywords.totalAds}`]),
      ...keywords.brands.map((k, i) => ["Advertiser Brand", k, ads[i]?.domain || "—", "—"]),
      ...keywords.sitelinkTopics.map(k => ["Sitelink Topic", k, "Ad Sitelinks", "—"]),
      ...keywords.longTailBids.map(k => ["Long Tail Bid", k, "Ad Title (Full)", "—"]),
    ].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    return rows;
  };

  const downloadCSV = () => {
    const b = new Blob([getCSV()], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = `ad-keywords-${(keyword || "").replace(/\s+/g, "-")}.csv`;
    a.click();
  };

  const copyCSV = () => {
    navigator.clipboard.writeText(getCSV());
    setCopyMsg("Copied!"); setTimeout(() => setCopyMsg(""), 2000);
  };

  // ── Theme ────────────────────────────────────────────────────────────────
  const th = T || {};
  const surface    = th.surface    || "#1d1a2e";
  const surface2   = th.surface2   || "#252238";
  const surface3   = th.surface3   || "#2c2844";
  const border     = th.border     || "#2e2b42";
  const text       = th.text       || "#ede8de";
  const textSub    = th.textSub    || "#8a8499";
  const textMuted  = th.textMuted  || "#4e4a60";
  const accent     = th.accent     || "#c9a96e";
  const accentSub  = th.accentSub  || "#9b8afb";
  const accentGreen= th.accentGreen|| "#5dcfaa";
  const shadow     = th.shadow     || "rgba(0,0,0,0.3)";
  const adGold     = "#f59e0b";

  const card = {
    background: surface, border: `1px solid ${border}`,
    borderRadius: 20, padding: "20px 24px",
    boxShadow: `0 4px 20px ${shadow}`, marginBottom: 12,
  };

  const tag = (color) => ({
    display: "inline-flex", alignItems: "center", gap: 5,
    background: `${color}15`, border: `1px solid ${color}30`,
    borderRadius: 8, padding: "5px 12px", fontSize: 12,
    color, fontWeight: 500, margin: "3px", cursor: "default",
    transition: "background 0.2s",
  });

  const sections = keywords ? [
    { label: "Primary Keyword",    key: "primary",         color: accentSub,  isString: true, desc: "The keyword you searched",                        freq: null },
    { label: "Bidding Terms",      key: "biddingTerms",    color: adGold,     desc: "Phrases from ad titles appearing in 2+ ads — what advertisers actively bid on", freq: "title" },
    { label: "Ad Copy Phrases",    key: "adCopyPhrases",   color: "#f472b6",  desc: "2-3 word phrases from descriptions in 2+ ads",                   freq: "description" },
    { label: "Commercial Signals", key: "commercialFound", color: "#fb923c",  desc: "Purchase-intent words found in ad copy",                          freq: "all" },
    { label: "Advertiser Brands",  key: "brands",          color: accentGreen,desc: "Domains of all advertisers bidding on this keyword",              freq: null },
    { label: "Sitelink Topics",    key: "sitelinkTopics",  color: "#60a5fa",  desc: "Topics advertisers highlight in sitelinks — their priorities",    freq: null },
    { label: "Long Tail Bids",     key: "longTailBids",    color: accent,     desc: "Full ad titles (4+ words) — exact phrases advertisers bid on",    freq: null },
  ] : [];

  if (!searched && !loading) return (
    <div style={{ ...card, textAlign: "center", padding: "60px" }}>
      <div style={{ fontSize: 15, color: textMuted, fontWeight: 500 }}>Search a keyword to analyze sponsored ad keywords</div>
      <div style={{ fontSize: 12, color: textMuted, marginTop: 6 }}>Extracts bidding terms, ad copy phrases, commercial signals, and more from all ads</div>
    </div>
  );

  if (searched && !loading && !processing && !keywords && !ads.length) return (
    <div style={{ ...card, textAlign: "center", padding: "60px" }}>
      <div style={{ fontSize: 15, color: textMuted, fontWeight: 500 }}>No sponsored ads found for this keyword</div>
      <div style={{ fontSize: 12, color: textMuted, marginTop: 6 }}>Try a more commercial keyword like "custom web development services"</div>
    </div>
  );

  if (loading || processing) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {[...Array(6)].map((_, i) => (
        <div key={i} style={{ ...card, opacity: 1 - i * 0.12 }}>
          <div style={{ height: 13, background: surface2, borderRadius: 6, width: "22%", marginBottom: 14 }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[...Array(5)].map((_, j) => <div key={j} style={{ height: 30, width: `${55 + j * 18}px`, background: surface3, borderRadius: 8 }} />)}
          </div>
        </div>
      ))}
      <div style={{ textAlign: "center", fontSize: 12, color: textMuted }}>Analyzing ad keywords...</div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: text, marginBottom: 4 }}>Sponsored Ad Keywords</div>
          <div style={{ fontSize: 12, color: textMuted }}>
            Keyword intelligence from <span style={{ color: adGold, fontWeight: 700 }}>{keywords?.totalAds || ads.length} ads</span> for <span style={{ color: accent, fontWeight: 600 }}>"{keyword}"</span>
            {keywords && (
              <span style={{ marginLeft: 8, color: textMuted }}>
                — Page 1: {keywords.page1Count} ads · Page 2: {keywords.page2Count} ads
              </span>
            )}
          </div>
        </div>
        {keywords && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={downloadCSV} style={{ background: surface2, border: `1px solid ${border}`, borderRadius: 10, padding: "7px 16px", color: textSub, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Download CSV</button>
            <button onClick={copyCSV} style={{ background: copyMsg ? `${accentGreen}18` : surface2, border: `1px solid ${copyMsg ? accentGreen : border}`, borderRadius: 10, padding: "7px 16px", color: copyMsg ? accentGreen : textSub, fontSize: 12, cursor: "pointer", fontWeight: 600, transition: "all 0.2s" }}>
              {copyMsg || "Copy Sheet"}
            </button>
          </div>
        )}
      </div>

      {/* Keyword sections */}
      {keywords && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sections.map(({ label, key, color, isString, desc, freq }) => {
            const items = isString ? [keywords[key]] : (keywords[key] || []);
            return (
              <div key={key} style={card}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: text }}>{label}</span>
                  <span style={{ background: `${color}18`, border: `1px solid ${color}35`, borderRadius: 50, padding: "2px 9px", fontSize: 11, color, fontWeight: 700 }}>{items.length}</span>
                  <span style={{ fontSize: 11, color: textMuted }}>{desc}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                  {!items.length
                    ? <span style={{ color: textMuted, fontSize: 12, fontStyle: "italic" }}>No data found</span>
                    : items.map((item, idx) => {
                      const f = freq ? freqInAds(item, ads, freq) : null;
                      const total = keywords.totalAds;
                      return (
                        <span key={idx} style={tag(color)}
                          onMouseEnter={e => e.currentTarget.style.background = `${color}28`}
                          onMouseLeave={e => e.currentTarget.style.background = `${color}15`}>
                          {item}
                          {f !== null && f > 0 && (
                            <span style={{ background: `${color}28`, borderRadius: 5, padding: "1px 6px", fontSize: 10, fontWeight: 800 }}>{f}/{total}</span>
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
      )}

      {/* Summary cards */}
      {keywords && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10, marginTop: 16 }}>
          {[
            ["Bidding Terms",    keywords.biddingTerms.length,    adGold],
            ["Ad Copy Phrases",  keywords.adCopyPhrases.length,   "#f472b6"],
            ["Intent Signals",   keywords.commercialFound.length, "#fb923c"],
            ["Brands",          keywords.brands.length,          accentGreen],
            ["Sitelink Topics",  keywords.sitelinkTopics.length,  "#60a5fa"],
            ["Long Tail Bids",   keywords.longTailBids.length,    accent],
          ].map(([l, c, col]) => (
            <div key={l} style={{ background: surface, border: `1px solid ${border}`, borderRadius: 14, padding: "14px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: col, marginBottom: 4 }}>{c}</div>
              <div style={{ fontSize: 10, color: textMuted, fontWeight: 500 }}>{l}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
