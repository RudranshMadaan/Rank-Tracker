console.log("SERVER FILE LOADED");
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = 3001;

app.use(cors()); // Allow requests from your React app
app.use(express.json());

// Proxy route — forwards requests to SerpAPI
app.get("/serp", async (req, res) => {
  try {
    const { q, api_key, start = 0, num = 12, hl = "en", gl = "us" } = req.query;

    if (!q || !api_key) {
      return res.status(400).json({ error: "Missing required params: q, api_key" });
    }

    const params = new URLSearchParams({ engine: "google", q, api_key, start, num, hl, gl });
    const response = await fetch(`https://serpapi.com/search.json?${params}`);
    const data = await response.json();

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ SerpAPI Proxy running at http://localhost:${PORT}`);
  console.log(`   Test it: http://localhost:${PORT}/serp?q=test&api_key=YOUR_KEY`);
});