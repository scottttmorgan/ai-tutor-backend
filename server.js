// ============================================================
// BACKEND SERVER — Node.js + Express
// ============================================================
// Receives UserPrompt from Storyline, sends it to Claude,
// returns the reply.
//
// SETUP:
//   1. npm init -y
//   2. npm install express cors @anthropic-ai/sdk dotenv
//   3. cp .env.example .env   (add your API key)
//   4. node server.js
// ============================================================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

const anthropic = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { userPrompt } = req.body;

    if (!userPrompt) {
      return res.status(400).json({ error: "userPrompt is required" });
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: userPrompt }],
    });

    const reply = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    res.json({ reply });
  } catch (err) {
    console.error("Claude API error:", err?.message || err);
    res.status(500).json({ error: "Failed to get a response from the AI." });
  }
});

app.listen(PORT, () => {
  console.log(`AI Tutor backend running on http://localhost:${PORT}`);
});
