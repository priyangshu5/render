// openrouter.js
// =============================================================
// Connects Mimu's "brain" to the OpenRouter AI service.
// We send: the system prompt + the user's recent history + the
// new message. We receive: the AI's reply text.
// =============================================================

const axios = require("axios");
const config = require("./config");
const logger = require("./utils/logger");
const { buildSystemPrompt } = require("./systemPrompt");

// Ask the AI for a reply.
// - history: array of past messages [{ role, content }, ...]
// - userMessage: the new text the user just sent
// Returns: a string (Mimu's reply). Never throws — returns a
// friendly fallback message if something goes wrong.
async function getAIReply(history, userMessage) {
  // Build the messages array the AI expects.
  // 1) The system prompt sets Mimu's personality and rules.
  // 2) The history gives context.
  // 3) The newest user message goes last.
  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...history,
    { role: "user", content: userMessage },
  ];

  try {
    const response = await axios.post(
      config.OPENROUTER_URL,
      {
        model: config.OPENROUTER_MODEL,
        messages: messages,
        // temperature controls creativity (0 = strict, 1 = creative).
        temperature: 0.7,
        max_tokens: 800,
      },
      {
        headers: {
          // Your secret key authorizes the request.
          Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          // OpenRouter likes these optional identifying headers.
          "HTTP-Referer": "https://mimu.assistant",
          "X-Title": "Mimu WhatsApp Assistant",
        },
        timeout: 30000, // give up after 30 seconds
      }
    );

    // Dig the reply text out of the response structure.
    const reply =
      response.data &&
      response.data.choices &&
      response.data.choices[0] &&
      response.data.choices[0].message &&
      response.data.choices[0].message.content;

    if (!reply) {
      logger.error("OpenRouter returned an empty reply.");
      return "Sorry, I couldn't think of a reply just now. Please try again.";
    }

    return reply.trim();
  } catch (err) {
    // Log the real error for debugging, but show the user something kind.
    const detail = err.response
      ? JSON.stringify(err.response.data)
      : err.message;
    logger.error(`OpenRouter request failed: ${detail}`);
    return "Sorry, I'm having a little trouble right now. Please try again in a moment.";
  }
}

module.exports = { getAIReply };
