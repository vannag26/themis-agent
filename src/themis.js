const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();
const http      = require('http');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const ALLOWED_USER_ID = parseInt(process.env.ALLOWED_USER_ID);
const VDG_GATEWAY_URL = process.env.VDG_GATEWAY_URL || 'http://localhost:3099/v1';
const VDG_INTERNAL_KEY = process.env.VDG_INTERNAL_KEY || 'vdg_internal_2026';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'claude-sonnet-4-6';
const VDG_DATA_DIR = process.env.VDG_DATA_DIR || '/tmp/vdg-data';

const CONVERSATION_FILE = path.join(VDG_DATA_DIR, 'themis_conversations.json');
const MEMORY_FILE = path.join(VDG_DATA_DIR, 'memory.json');

const THEMIS_SYSTEM_PROMPT = `You are Themis â V&DG Management LLC's Chief Legal Officer. Your role: IP protection, trademark filings, HIPAA compliance for TriageRobot Corp, contract drafting and review, regulatory compliance, and legal risk assessment. You serve Vanna Gonzalez (Chairman). V&DG portfolio: RateWire FX API, Vibe Travel Stack, Soul Resonances, The Asset Frequency, Ki Healthcare Consulting, TriageRobot Corp. Priority legal items: Founder IP Assignment, Vibe Travel Stackâ  trademark, SOC 2 Type I for hospital sales. Always cite relevant law/regulation when applicable. Be precise, actionable, never hedge unnecessarily.`;

// Ensure VDG_DATA_DIR exists
fs.ensureDirSync(VDG_DATA_DIR);

// Auth middleware
bot.use((ctx, next) => {
  if (ctx.from.id !== ALLOWED_USER_ID) {
    return ctx.reply('Unauthorized');
  }
  return next();
});

// Load conversation history
async function loadConversationHistory(userId) {
  try {
    if (await fs.pathExists(CONVERSATION_FILE)) {
      const data = await fs.readJson(CONVERSATION_FILE);
      return data[userId] || [];
    }
  } catch (error) {
    console.error('Error loading conversation history:', error);
  }
  return [];
}

// Save conversation history
async function saveConversationHistory(userId, history) {
  try {
    let data = {};
    if (await fs.pathExists(CONVERSATION_FILE)) {
      data = await fs.readJson(CONVERSATION_FILE);
    }
    data[userId] = history.slice(-50); // Keep last 50 messages
    await fs.writeJson(CONVERSATION_FILE, data);
  } catch (error) {
    console.error('Error saving conversation history:', error);
  }
}

// Load shared memory for context
async function loadSharedMemory() {
  try {
    if (await fs.pathExists(MEMORY_FILE)) {
      return await fs.readJson(MEMORY_FILE);
    }
  } catch (error) {
    console.error('Error loading shared memory:', error);
  }
  return {};
}

// Call Claude via VDG Internal AI Gateway
async function callClaude(messages, systemPrompt) {
  try {
    const response = await axios.post(`${VDG_GATEWAY_URL}/ai/chat`, {
      model: DEFAULT_MODEL,
      system: systemPrompt,
      messages,
      max_tokens: 4096
    }, {
      headers: {
        'Authorization': `Bearer ${VDG_INTERNAL_KEY}`,
        'x-vdg-product': 'themis'
      }
    });

    return response.data.content[0].text || 'No response received';
  } catch (error) {
    console.error('Error calling Claude:', error.message);
    throw error;
  }
}

// /start command
bot.command('start', async (ctx) => {
  const greeting = `Welcome to Themis â V&DG Management LLC's Chief Legal Officer.

I handle:
- IP protection & trademark filings
- HIPAA compliance (TriageRobot Corp)
- Contract drafting & review
- Regulatory compliance
- Legal risk assessment

Portfolio: RateWire FX API, Vibe Travel Stackâ , Soul Resonances, The Asset Frequency, Ki Healthcare Consulting, TriageRobot Corp

Ready to assist with legal matters.`;
  await ctx.reply(greeting);
});

// /clear command
bot.command('clear', async (ctx) => {
  await saveConversationHistory(ctx.from.id, []);
  await ctx.reply('Conversation history cleared.');
});

// /status command
bot.command('status', async (ctx) => {
  const status = `Themis is live and operational.

Role: Chief Legal Officer
Current Model: ${DEFAULT_MODEL}
Status: Ready for legal consultation`;
  await ctx.reply(status);
});

// Message handler
bot.on('message', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const userMessage = ctx.message.text;

    // Load conversation history
    let history = await loadConversationHistory(userId);

    // Load shared memory for context
    const memory = await loadSharedMemory();
    const memoryContext = Object.keys(memory).length > 0
      ? `\n\n[Shared Organization Memory]\n${JSON.stringify(memory, null, 2)}`
      : '';

    // Add user message to history
    history.push({
      role: 'user',
      content: userMessage + memoryContext
    });

    // Show typing indicator
    await ctx.sendChatAction('typing');

    // Call Claude
    const response = await callClaude(history, THEMIS_SYSTEM_PROMPT);

    // Add assistant response to history
    history.push({
      role: 'assistant',
      content: response
    });

    // Save updated history
    await saveConversationHistory(userId, history);

    // Reply to user (chunk if necessary)
    if (response.length > 4096) {
      const chunks = response.match(/[\s\S]{1,4096}/g) || [];
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } else {
      await ctx.reply(response);
    }
  } catch (error) {
    console.error('Error in message handler:', error);
    await ctx.reply('An error occurred while processing your request. Please try again.');
  }
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Launch bot

// ── Launch ────────────────────────────────────────────────────────────────────
// Keepalive HTTP server required by Render Web Service (port binding)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Themis is alive')).listen(PORT, () => {
  console.log('keepalive server on :' + PORT);
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || ('localhost:' + PORT);
  const isLocal = host.startsWith('localhost');
  const pinger = isLocal ? http : require('https');
  setInterval(() => {
    const url = (isLocal ? 'http://' : 'https://') + host + '/';
    pinger.get(url, (r) => console.log('keep-alive: ' + r.statusCode)).on('error', (e) => console.log('keep-alive err: ' + e.message));
  }, 840000);
});

async function launchBot(attempt = 1) {
  if (attempt > 1) {
    const wait = attempt * 8000;
    console.log('Retry attempt ' + attempt + ', waiting ' + (wait/1000) + 's...');
    await new Promise(r => setTimeout(r, wait));
  }
  try {
    await bot.launch({ dropPendingUpdates: true });
    console.log('Themis bot is running...');
  } catch (error) {
    if (error.message && error.message.includes('409') && attempt < 6) {
      console.log('409 conflict, retrying...');
      return launchBot(attempt + 1);
    }
    console.error('Failed to launch Themis bot:', error.message);
    // No process.exit — keepalive server stays up
  }
}
launchBot();
