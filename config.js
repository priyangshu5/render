// config.js
// =============================================================
// This file holds all your settings and secret keys.
// You must REPLACE every "PUT_..._HERE" placeholder with your
// real values before running the bot.
// No .env file is used — everything is here in plain JavaScript.
// =============================================================

const config = {
  // ----- OpenRouter (the AI provider) -----
  // Get your key from https://openrouter.ai/keys
  OPENROUTER_API_KEY: "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",

  // The AI model Mimu will use. Do not change unless you know why.
  OPENROUTER_MODEL: "openai/gpt-oss-120b:free",

  // The OpenRouter chat endpoint (the web address we send messages to).
  OPENROUTER_URL: "https://openrouter.ai/api/v1/chat/completions",

  // ----- Telegram (your admin control panel) -----
  // Create a bot with @BotFather on Telegram to get this token.
  TELEGRAM_BOT_TOKEN: "8290621400:AAH22ft6EBH_en05HW9oTBwdRSEkBA8yoiM",

  // Your personal Telegram numeric user ID (NOT your username).
  // Get it from @userinfobot on Telegram. Only this ID can control the bot.
  OWNER_TELEGRAM_ID: "7548668234",

  // ----- Behaviour settings -----
  // How many recent messages to remember per user (for context).
  MEMORY_LIMIT: 20,

  // Anti-spam: minimum seconds a user must wait between messages.
  USER_COOLDOWN_SECONDS: 2,

  // Rate limiting: max messages a user can send per minute.
  MAX_MESSAGES_PER_MINUTE: 15,

  // How long (in minutes) before we re-show the welcome message
  // to a returning user.
  WELCOME_RESET_MINUTES: 60,
};

// Export the config object so other files can use it.
module.exports = config;
