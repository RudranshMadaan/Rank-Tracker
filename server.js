console.log("SERVER FILE LOADED v3.0");
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({ status: "✅ SERP Proxy running", version: "3.0" });
});

// SerpAPI Proxy
app.get("/serp", async (req, res) => {
  try {
    const { q, api_key, start = 0, num = 10, hl = "en", gl = "us" } = req.query;
    if (!q || !api_key)
      return res.status(400).json({ error: "Missing required params: q, api_key" });
    const params = new URLSearchParams({ engine: "google", q, api_key, start, num, hl, gl });
    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cheerio H1-H6 Scraper
app.get("/scrape-headings", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing url param" });

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      timeout: 15000,
    });

    if (!response.ok) {
      return res.json({ h1:["—"],h2:["—"],h3:["—"],h4:["—"],h5:["—"],h6:["—"], error:`HTTP ${response.status}` });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove noise elements
    $("nav, header, footer, aside, script, style, noscript, iframe").remove();
    $("[class*='nav'],[class*='menu'],[class*='footer'],[class*='header'],[class*='sidebar'],[class*='cookie'],[class*='banner'],[id*='nav'],[id*='footer'],[id*='header'],[id*='sidebar'],[id*='menu']").remove();

    // Find main content area
    const contentAreas = ["main","article","[role='main']",".content","#content",".post",".entry",".page-content","section"];
    let $content = null;
    for (const selector of contentAreas) {
      if ($(selector).length > 0) { $content = $(selector).first(); break; }
    }
    const $scope = $content || $("body");

    const result = {};
    for (let i = 1; i <= 6; i++) {
      const texts = [];
      $scope.find(`h${i}`).each((_, el) => {
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (text && text.length > 2 && text.length < 250 && !texts.includes(text)) {
          texts.push(text);
        }
      });
      result[`h${i}`] = texts.length > 0 ? texts : ["—"];
    }

    res.json(result);
  } catch (err) {
    res.json({ h1:["—"],h2:["—"],h3:["—"],h4:["—"],h5:["—"],h6:["—"], error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ SERP Proxy v3.0 running on port ${PORT}`);
});
