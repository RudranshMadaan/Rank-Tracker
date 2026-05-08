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
  res.json({ status: "✅ SERP Proxy running", version: "4.0" });
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

// --- Shared heading + metadata extractor ---
function extractFromScope($, $scope, $full) {
  // Headings grouped
  const result = {};
  for (let i = 1; i <= 6; i++) {
    const texts = [];
    $scope.find(`h${i}`).each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text && text.length > 2 && text.length < 250 && !texts.includes(text))
        texts.push(text);
    });
    result[`h${i}`] = texts.length > 0 ? texts : ["—"];
  }

  // Ordered document-sequence headings
  const ordered = [];
  $scope.find("h1,h2,h3,h4,h5,h6").each((_, el) => {
    const level = parseInt(el.tagName.toLowerCase().replace("h", ""));
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text && text.length > 2 && text.length < 250)
      ordered.push({ level, text });
  });
  result.ordered = ordered;

  // Meta title
  result.meta_title = $full("title").first().text().replace(/\s+/g, " ").trim() || "—";

  // Meta description
  result.meta_description =
    $full('meta[name="description"]').attr("content") ||
    $full('meta[property="og:description"]').attr("content") ||
    "—";

  // URL slug — passed in separately, stored client-side
  // Word count from body content
  const bodyText = $scope.text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length;
  result.word_count = wordCount;

  // Body paragraphs — top 20 meaningful ones for keyword extraction
  const paragraphs = [];
  $scope.find("p").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length > 40 && text.length < 1000) paragraphs.push(text);
  });
  result.paragraphs = paragraphs.slice(0, 20);

  return result;
}

// --- Cheerio scraper (fast, works for server-rendered sites) ---
async function scrapeWithCheerio(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    timeout: 12000,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const $full = $; // keep full doc reference for meta tags
  $("nav,header,footer,aside,script,style,noscript,iframe").remove();
  $("[class*='nav'],[class*='menu'],[class*='footer'],[class*='header'],[class*='sidebar'],[id*='nav'],[id*='footer'],[id*='header'],[id*='menu']").remove();
  const contentAreas = ["main","article","[role='main']",".content","#content",".post",".entry","section"];
  let $content = null;
  for (const sel of contentAreas) {
    if ($(sel).length > 0) { $content = $(sel).first(); break; }
  }
  return extractFromScope($, $content || $("body"), $full);
}

// --- Check if result has actual content ---
function hasContent(result) {
  return ["h1","h2","h3","h4","h5","h6"].some(k =>
    result[k] && result[k].length > 0 && result[k][0] !== "—"
  ) && (result.ordered || []).length > 0;
}

// --- Puppeteer scraper (for JS-rendered sites like React/Next.js) ---
async function scrapeWithPuppeteer(url) {
  let chromium, puppeteer;
  try {
    chromium = require("@sparticuz/chromium-min");
    puppeteer = require("puppeteer-core");
  } catch {
    throw new Error("Puppeteer not installed");
  }

  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
    ],
    executablePath: await chromium.executablePath(
      "https://github.com/Sparticuz/chromium/releases/download/v130.0.0/chromium-v130.0.0-pack.tar"
    ),
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
  });

  try {
    const page = await browser.newPage();

    // Block unnecessary resources to save memory
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image","stylesheet","font","media"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    // Wait briefly for JS to render key content
    await new Promise(r => setTimeout(r, 2500));

    const data = await page.evaluate(() => {
      ["nav","header","footer","aside","script","style"].forEach(tag =>
        document.querySelectorAll(tag).forEach(el => el.remove())
      );
      ["nav","menu","footer","header","sidebar"].forEach(cls => {
        document.querySelectorAll(`[class*="${cls}"],[id*="${cls}"]`).forEach(el => el.remove());
      });

      const scope =
        document.querySelector("main") ||
        document.querySelector("[role='main']") ||
        document.querySelector("article") ||
        document.querySelector(".content") ||
        document.querySelector("#content") ||
        document.body;

      // Grouped headings
      const result = {};
      for (let i = 1; i <= 6; i++) {
        const texts = [];
        scope.querySelectorAll(`h${i}`).forEach(el => {
          const t = el.textContent.replace(/\s+/g, " ").trim();
          if (t && t.length > 2 && t.length < 250 && !texts.includes(t)) texts.push(t);
        });
        result[`h${i}`] = texts.length ? texts : ["—"];
      }

      // Ordered headings
      const ordered = [];
      scope.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach(el => {
        const level = parseInt(el.tagName.replace("H", ""));
        const text = el.textContent.replace(/\s+/g, " ").trim();
        if (text && text.length > 2 && text.length < 250) ordered.push({ level, text });
      });
      result.ordered = ordered;

      // Meta title + description
      result.meta_title = document.title?.replace(/\s+/g, " ").trim() || "—";
      result.meta_description =
        document.querySelector('meta[name="description"]')?.getAttribute("content") ||
        document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
        "—";

      // Word count
      const bodyText = scope.textContent.replace(/\s+/g, " ").trim();
      result.word_count = bodyText.split(/\s+/).filter(w => w.length > 0).length;

      // Body paragraphs — top 20 meaningful ones
      const paragraphs = [];
      scope.querySelectorAll("p").forEach(el => {
        const t = el.textContent.replace(/\s+/g, " ").trim();
        if (t.length > 40 && t.length < 1000) paragraphs.push(t);
      });
      result.paragraphs = paragraphs.slice(0, 20);

      return result;
    });

    return data;
  } finally {
    await browser.close();
  }
}

// --- Main scrape route: Cheerio first, Puppeteer fallback ---
app.get("/scrape-headings", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing url param" });

  const empty = { h1:["—"],h2:["—"],h3:["—"],h4:["—"],h5:["—"],h6:["—"], ordered:[] };

  try {
    // Step 1: Try Cheerio (fast, ~1-2s)
    let result;
    try {
      result = await scrapeWithCheerio(url);
    } catch {
      result = { ...empty };
    }

    // Step 2: If Cheerio got no content, fall back to Puppeteer
    if (!hasContent(result)) {
      console.log(`Cheerio empty for ${url} — trying Puppeteer`);
      try {
        result = await scrapeWithPuppeteer(url);
        console.log(`Puppeteer success for ${url}`);
      } catch (e) {
        console.log(`Puppeteer failed for ${url}: ${e.message}`);
        // Return whatever we have (h1 fallback comes from client)
      }
    }

    res.json(result);
  } catch (err) {
    res.json({ ...empty, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ SERP Proxy v4.0 running on port ${PORT}`);
});
