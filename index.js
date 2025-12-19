import express from 'express';
import cors from 'cors';
import { kv } from '@vercel/kv';
import { MASSA_TRUTHS } from './truths.js';

const app = express();

// --- CONFIGURATION CORS ---
app.use(cors({
  origin: 'https://spreadmassaquest.build.half-red.net',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// Clé privée morcelée (Vercel Env Var)
const PRIVATE_KEY_CHARS = (process.env.MASSA_PRIVATE_KEY || "").split("");

// --- FONCTION TELEGRAM WEBHOOK ---
async function sendTelegramAlert(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
  } catch (err) {
    console.error("Telegram Webhook Error:", err);
  }
}

// Helper: UTC Date
const getTodayUTC = () => new Date().toISOString().split('T')[0];
const getYesterdayUTC = () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
};

// --- GESTION DU STREAK ---
async function updateUserStreak(username) {
  const today = getTodayUTC();
  const yesterday = getYesterdayUTC();
  
  const streakKey = `streak:${username}`;
  const streakData = await kv.get(streakKey);
  
  if (!streakData) {
    // Première visite
    await kv.set(streakKey, { lastVisit: today, streak: 1 });
    return 1;
  }
  
  if (streakData.lastVisit === today) {
    // Déjà visité aujourd'hui
    return streakData.streak;
  }
  
  if (streakData.lastVisit === yesterday) {
    // Jour consécutif
    const newStreak = streakData.streak + 1;
    await kv.set(streakKey, { lastVisit: today, streak: newStreak });
    return newStreak;
  }
  
  // Streak cassé
  await kv.set(streakKey, { lastVisit: today, streak: 1 });
  return 1;
}

// --- GESTION DE L'ÉTAT DU JOUR ---
async function getGameState() {
  const today = getTodayUTC();
  let state = await kv.get('gameState');

  if (!state || state.lastUpdate !== today) {
    const globalRevealed = await kv.smembers('global:revealed_indices') || [];
    const remainingIndices = PRIVATE_KEY_CHARS.map((_, i) => i)
                               .filter(i => !globalRevealed.includes(i.toString()));

    state = {
      lastUpdate: today,
      activeFragmentIndex: remainingIndices.length > 0 
        ? remainingIndices[Math.floor(Math.random() * remainingIndices.length)] 
        : null,
      winningMessageId: Math.floor(Math.random() * MASSA_TRUTHS.length),
      messageOfTheDay: null 
    };
    await kv.set('gameState', state);
  }
  return state;
}

// --- ROUTES AUTH X (Proxy) ---
app.post('/api/oauth/token', async (req, res) => {
  const { code, redirect_uri, code_verifier } = req.body;
  try {
    const response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "SHFXVndGU2ZBRk1GbzlpWlFJR1Q6MTpjaQ",
        code,
        redirect_uri,
        code_verifier
      })
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) { 
    console.error("Token error:", err);
    res.status(500).json({ error: err.message }); 
  }
});

app.post('/api/user/profile', async (req, res) => {
  try {
    const { access_token } = req.body;
    if (!access_token) {
      return res.status(400).json({ error: "Missing access_token" });
    }
    
    const response = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
      headers: { 
        "Authorization": `Bearer ${access_token}`
      }
    });
    const data = await response.json();
    console.log("X API Response:", data);
    res.json(data);
  } catch (err) { 
    console.error("Profile error:", err);
    res.status(500).json({ error: err.message }); 
  }
});

// --- NOUVELLE ROUTE: GET STREAK ---
app.get('/api/user/streak/:username', async (req, res) => {
  try {
    const streak = await updateUserStreak(req.params.username);
    res.json({ streak });
  } catch (err) {
    console.error("Streak error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- LOGIQUE DU JEU ---

// 1. Générer le message (Limite 1/jour)
app.post('/api/game/generate', async (req, res) => {
  const { username } = req.body;
  const today = getTodayUTC();
  const limitKey = `limit:${username}:${today}`;

  // Mettre à jour le streak à chaque génération
  const streak = await updateUserStreak(username);

  const savedId = await kv.get(limitKey);
  if (savedId !== null) {
    return res.json({ 
      status: "ALREADY", 
      messageId: savedId, 
      text: MASSA_TRUTHS[savedId],
      streak 
    });
  }

  const messageId = Math.floor(Math.random() * MASSA_TRUTHS.length);
  await kv.set(limitKey, messageId);
  res.json({ 
    status: "SUCCESS", 
    messageId, 
    text: MASSA_TRUTHS[messageId],
    streak 
  });
});

// 2. Soumettre le lien (Scenario A & B)
app.post('/api/game/submit', async (req, res) => {
  const { username, tweetUrl, messageId } = req.body;
  const state = await getGameState();

  if (state.messageOfTheDay) {
    return res.json({ status: "GLOBAL_FOUND", motd: state.messageOfTheDay });
  }

  if (state.activeFragmentIndex !== null && parseInt(messageId) === state.winningMessageId) {
    const char = PRIVATE_KEY_CHARS[state.activeFragmentIndex];
    
    const motd = { 
        url: tweetUrl, 
        username, 
        index: state.activeFragmentIndex, 
        char 
    };
    
    state.messageOfTheDay = motd;
    await kv.set('gameState', state);
    await kv.sadd('global:revealed_indices', state.activeFragmentIndex);
    await kv.sadd(`user:collection:${username}`, `${state.activeFragmentIndex}:${char}`);

    sendTelegramAlert(`🚨 <b>Fragment Revealed!</b>\n\nUser @${username} found a new clue.\n<a href="${tweetUrl}">See the proof on X</a>`);

    return res.json({ status: "WINNER", char, index: state.activeFragmentIndex });
  }

  res.json({ status: "NOT_FOUND" });
});

// 3. Débloquer via Repost (Scenario C)
app.post('/api/game/unlock', async (req, res) => {
  const { username } = req.body;
  const state = await kv.get('gameState');
  if (!state?.messageOfTheDay) return res.status(400).send("No fragment");

  const clue = `${state.messageOfTheDay.index}:${state.messageOfTheDay.char}`;
  await kv.sadd(`user:collection:${username}`, clue);
  res.json({ status: "SUCCESS", char: state.messageOfTheDay.char });
});

// 4. Charger la collection perso
app.get('/api/user/collection/:username', async (req, res) => {
  const data = await kv.smembers(`user:collection:${req.params.username}`);
  res.json({ collection: data || [] });
});

export default app;
