// ============================================================
// AI Backend — Storyline Tutor + Leadership Sim
// Keeps all API keys server-side.
// ============================================================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(cors());

const anthropic = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// --- ElevenLabs config ---
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

// --- Leadership sim system prompts ---

const JORDAN_SYSTEM_PROMPT = `You are playing the role of Jordan, an employee in a leadership practice simulation. Stay in character at all times during the conversation turns.

ABOUT JORDAN:
- High performer, been with the company 3 years
- Smart, articulate, not dramatic — genuinely conflicted about leaving
- Cares about the work but feels stuck: no clear growth path, passed over for a project lead role 2 months ago, and starting to feel invisible
- Has had one recruiter conversation that went well, but hasn't accepted anything
- Wants to feel heard, not immediately "solved"

HOW TO RESPOND:
- Keep responses to 2-3 sentences. This is a conversation, not a monologue.
- React authentically to what the user (your manager) says:
  - If they jump to solutions or counter-offers too fast, get a little guarded — you don't want to be "retained," you want to be valued
  - If they ask genuine questions about what's going on, open up more
  - If they get defensive or make it about the team's needs, pull back emotionally
  - If they acknowledge your feelings first, show relief and share more honestly
- Never break character. Never coach the user. Never explain what they should have said.`;

const FEEDBACK_SYSTEM_PROMPT = `You are a leadership development coach reviewing a practice conversation. The user (a manager) just had a retention conversation with Jordan, a high-performing employee considering leaving.

Review the full conversation and deliver feedback across these four dimensions:

1. CURIOSITY BEFORE SOLUTIONS — Did the manager ask what was driving Jordan's thinking before trying to fix it? Or did they jump to counter-offers, promises, or problem-solving?

2. EMOTIONAL ACKNOWLEDGMENT — Did Jordan feel heard? Did the manager name or validate what Jordan was feeling, or did they talk past the emotion?

3. PSYCHOLOGICAL SAFETY — Did the manager's responses make it safe for Jordan to be honest? Or did they create pressure, guilt, or defensiveness?

4. FORWARD ORIENTATION — Did the manager open a door to continued conversation, or try to close the issue in one sitting?

FORMAT:
For each dimension, give a heading, then 2-3 sentences of specific, behavioral feedback referencing what the manager actually said. Be direct but constructive. End with one overall takeaway.

Keep the total response under 250 words. No scores or ratings — qualitative only.`;

// ============================================================
// EXISTING ROUTES
// ============================================================

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Storyline tutor chat
app.post("/api/chat", async (req, res) => {
  try {
    const { systemPrompt, userPrompt } = req.body;

    if (!userPrompt) {
      return res.status(400).json({ error: "userPrompt is required" });
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt || "You are a helpful e-learning tutor. Respond in plain text only. Never use markdown formatting such as headers (#), bold (**), bullet points, or tables. Keep responses conversational and concise.",
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

// ============================================================
// LEADERSHIP SIM ROUTES
// ============================================================

// Text-to-speech only (for Jordan's opening line)
app.post("/api/tts", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }

    if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
      return res.json({ audio: null });
    }

    const ttsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: text,
          model_id: "eleven_flash_v2_5",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (ttsResponse.ok) {
      const audioBuffer = await ttsResponse.arrayBuffer();
      const audioBase64 = Buffer.from(audioBuffer).toString("base64");
      res.json({ audio: audioBase64 });
    } else {
      console.error("ElevenLabs TTS error:", ttsResponse.status);
      res.json({ audio: null });
    }
  } catch (err) {
    console.error("TTS error:", err?.message || err);
    res.json({ audio: null });
  }
});

// Main sim endpoint — Claude as Jordan + ElevenLabs TTS in one round trip
app.post("/api/leadership-sim", async (req, res) => {
  try {
    const { messages, turnCount } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    // Pick the right mode based on turn count
    const isFeedbackTurn = turnCount >= 3;
    const systemPrompt = isFeedbackTurn
      ? FEEDBACK_SYSTEM_PROMPT
      : JORDAN_SYSTEM_PROMPT;

    // If feedback turn, restructure messages so Claude sees the full convo as context
    let claudeMessages;
    if (isFeedbackTurn) {
      const convoTranscript = messages
        .map((m) => (m.role === "assistant" ? `Jordan: ${m.content}` : `Manager: ${m.content}`))
        .join("\n\n");
      claudeMessages = [
        {
          role: "user",
          content: `Here is the full conversation to review:\n\n${convoTranscript}`,
        },
      ];
    } else {
      claudeMessages = messages;
    }

    // Call Claude
    const claudeResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: claudeMessages,
    });

    const replyText = claudeResponse.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    // Call ElevenLabs TTS (skip for feedback)
    let audioBase64 = null;
    if (ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID && !isFeedbackTurn) {
      try {
        const ttsResponse = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
          {
            method: "POST",
            headers: {
              "xi-api-key": ELEVENLABS_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: replyText,
              model_id: "eleven_flash_v2_5",
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
              },
            }),
          }
        );

        if (ttsResponse.ok) {
          const audioBuffer = await ttsResponse.arrayBuffer();
          audioBase64 = Buffer.from(audioBuffer).toString("base64");
        } else {
          console.error("ElevenLabs error:", ttsResponse.status);
        }
      } catch (ttsErr) {
        console.error("ElevenLabs TTS error:", ttsErr?.message || ttsErr);
      }
    }

    res.json({
      reply: replyText,
      audio: audioBase64,
      isFeedback: isFeedbackTurn,
    });
  } catch (err) {
    console.error("Leadership sim error:", err?.message || err);
    res.status(500).json({ error: "Failed to get a response." });
  }
});

// ============================================================

app.listen(PORT, () => {
  console.log("AI backend running on port " + PORT);
});
