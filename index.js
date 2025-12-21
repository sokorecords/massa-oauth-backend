import express from 'express';
import cors from 'cors';
import { kv } from '@vercel/kv';
import { MASSA_TRUTHS } from './truths.js';

const app = express();

app.use(cors({
  origin: 'https://spreadmassaquest.build.half-red.net',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

const PRIVATE_KEY_CHARS = (process.env.MASSA_PRIVATE_KEY || "").split("");

// --- TELEGRAM WEBHOOK ---
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

// --- HELPERS ---
const getTodayUTC = () => new Date().toISOString().split('T')[0];
const getYesterdayUTC = () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
};

// MODE DEBUG: Mettre à true pour tester
const DEBUG_MODE = process.env.DEBUG_MODE === "true" || false;

// Helper pour date de test
function getTestDate() {
  if (DEBUG_MODE) {
    // En mode debug, on peut simuler différents jours
    const testDate = process.env.TEST_DATE || getTodayUTC();
    return testDate;
  }
  return getTodayUTC();
}

// --- STREAK ---
async function updateUserStreak(username) {
  const today = getTodayUTC();
  const yesterday = getYesterdayUTC();
  
  const streakKey = `streak:${username}`;
  const streakData = await kv.get(streakKey);
  
  if (!streakData) {
    await kv.set(streakKey, { lastVisit: today, streak: 1 });
    return 1;
  }
  
  if (streakData.lastVisit === today) {
    return streakData.streak;
  }
  
  if (streakData.lastVisit === yesterday) {
    const newStreak = streakData.streak + 1;
    await kv.set(streakKey, { lastVisit: today, streak: newStreak });
    
    // Alerte Telegram pour les milestones (30 jours)
    if (newStreak === 30 || newStreak === 31 || newStreak === 60 || newStreak === 90) {
      sendTelegramAlert(
        `<b>🔥 STREAK MILESTONE! 🔥</b>\n\n` +
        `User @${username} reached a ${newStreak}-day streak!\n` +
        `True dedication to the MassArmy! 🚀`
      );
    }
    
    return newStreak;
  }
  
  await kv.set(streakKey, { lastVisit: today, streak: 1 });
  return 1;
}

// --- GAME STATE ---
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
      pioneer: null // {username, url, index, char}
    };
    await kv.set('gameState', state);
  }
  return state;
}

// --- USER STATUS ---
async function getUserStatus(username) {
  const today = DEBUG_MODE ? getTestDate() : getTodayUTC();
  const statusKey = `status:${username}:${today}`;
  return await kv.get(statusKey);
}

async function setUserStatus(username, status) {
  const today = DEBUG_MODE ? getTestDate() : getTodayUTC();
  const statusKey = `status:${username}:${today}`;
  await kv.set(statusKey, status);
}

// ROUTE DEBUG UNIQUEMENT - À SUPPRIMER EN PRODUCTION
if (DEBUG_MODE) {
  app.post('/api/debug/reset-user', async (req, res) => {
    const { username } = req.body;
    const today = getTestDate();
    
    await kv.del(`status:${username}:${today}`);
    await kv.del(`limit:${username}:${today}`);
    
    res.json({ message: `User ${username} reset for ${today}` });
  });

  app.post('/api/debug/reset-day', async (req, res) => {
    await kv.del('gameState');
    res.json({ message: 'Game state reset' });
  });

  app.post('/api/debug/clear-collection', async (req, res) => {
    const { username } = req.body;
    await kv.del(`user:collection:${username}`);
    res.json({ message: `Collection cleared for ${username}` });
  });
}

// --- ROUTES AUTH ---
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
      headers: { "Authorization": `Bearer ${access_token}` }
    });
    const data = await response.json();
    res.json(data);
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

app.get('/api/user/streak/:username', async (req, res) => {
  try {
    const streak = await updateUserStreak(req.params.username);
    res.json({ streak });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GAME LOGIC ---

// 1. Generate message
app.post('/api/game/generate', async (req, res) => {
  const { username } = req.body;
  const today = getTodayUTC();
  
  const streak = await updateUserStreak(username);
  const userStatus = await getUserStatus(username);
  const gameState = await getGameState();

  console.log(`[Generate] User: ${username}, Status:`, userStatus);

  // Si déjà généré aujourd'hui
  if (userStatus?.messageId !== undefined) {
    console.log(`[Generate] User already generated today`);
    return res.json({ 
      status: "ALREADY_GENERATED", 
      messageId: userStatus.messageId,
      text: MASSA_TRUTHS[userStatus.messageId],
      userStatus, // IMPORTANT: retourner le userStatus complet
      pioneer: gameState.pioneer,
      streak 
    });
  }

  // Générer nouveau message
  const messageId = Math.floor(Math.random() * MASSA_TRUTHS.length);
  
  const newStatus = {
    messageId,
    submitted: false,
    claimStatus: "pending" // pending | not_found | pioneer | follower
  };
  
  await setUserStatus(username, newStatus);

  console.log(`[Generate] New message generated for ${username}`);

  res.json({ 
    status: "NEW_MESSAGE", 
    messageId, 
    text: MASSA_TRUTHS[messageId],
    userStatus: newStatus, // IMPORTANT: retourner le nouveau status
    pioneer: gameState.pioneer,
    streak 
  });
});

// 2. Submit link (first submission OR repost)
app.post('/api/game/submit', async (req, res) => {
  const { username, tweetUrl, isRepost } = req.body;
  
  if (!tweetUrl || !tweetUrl.includes('/status/')) {
    return res.status(400).json({ error: "Invalid tweet URL" });
  }

  // Extraire le username de l'URL (x.com/USERNAME/status/...)
  const urlMatch = tweetUrl.match(/(?:twitter\.com|x\.com)\/([^\/]+)\/status\/(\d+)/);
  if (!urlMatch) {
    return res.status(400).json({ error: "Invalid tweet URL format" });
  }
  
  const urlUsername = urlMatch[1].toLowerCase();
  const tweetId = urlMatch[2];

  const userStatus = await getUserStatus(username);
  const gameState = await getGameState();

  // Vérifier si user a déjà claim aujourd'hui
  if (userStatus?.claimStatus === "pioneer" || userStatus?.claimStatus === "follower") {
    return res.json({ 
      status: "ALREADY_CLAIMED",
      message: "You have already claimed your fragment for today."
    });
  }

  // CAS 1: Repost après qu'un pionnier ait trouvé
  if (isRepost && gameState.pioneer) {
    // Vérifier que c'est un URL différent du premier post
    if (userStatus?.firstTweetUrl && tweetUrl !== userStatus.firstTweetUrl) {
      // Vérifier que le username correspond
      if (urlUsername !== username.toLowerCase()) {
        return res.status(400).json({ 
          error: `This post belongs to @${urlUsername}, not @${username}. Please submit YOUR repost link.`
        });
      }
      
      // Débloquer l'indice
      const clue = `${gameState.pioneer.index}:${gameState.pioneer.char}`;
      await kv.sadd(`user:collection:${username}`, clue);
      
      await setUserStatus(username, {
        ...userStatus,
        claimStatus: "follower",
        repostUrl: tweetUrl
      });

      return res.json({ 
        status: "FOLLOWER_SUCCESS",
        char: gameState.pioneer.char,
        index: gameState.pioneer.index,
        message: "Fragment unlocked! A new character has been added to your table."
      });
    } else {
      return res.status(400).json({ 
        error: "Please submit your repost link, not your original post." 
      });
    }
  }

  // CAS 2: Première soumission
  if (!userStatus?.submitted) {
    // Vérifier que le username correspond
    if (urlUsername !== username.toLowerCase()) {
      return res.status(400).json({ 
        error: `This post belongs to @${urlUsername}. Please submit YOUR post link from your @${username} account.`
      });
    }
    
    // Marquer comme soumis
    await setUserStatus(username, {
      ...userStatus,
      submitted: true,
      firstTweetUrl: tweetUrl,
      firstTweetId: tweetId
    });

    // Si pionnier déjà trouvé
    if (gameState.pioneer) {
      return res.json({ 
        status: "PIONEER_EXISTS",
        pioneer: gameState.pioneer,
        message: `Today's fragment was already discovered by @${gameState.pioneer.username}. Repost their message to unlock it.`
      });
    }

    // Vérifier si c'est le message gagnant
    if (gameState.activeFragmentIndex !== null && 
        parseInt(userStatus.messageId) === gameState.winningMessageId) {
      
      const char = PRIVATE_KEY_CHARS[gameState.activeFragmentIndex];
      
      // Marquer comme pionnier
      gameState.pioneer = { 
        url: tweetUrl, 
        username, 
        index: gameState.activeFragmentIndex, 
        char 
      };
      
      await kv.set('gameState', gameState);
      await kv.sadd('global:revealed_indices', gameState.activeFragmentIndex.toString());
      await kv.sadd(`user:collection:${username}`, `${gameState.activeFragmentIndex}:${char}`);
      
      await setUserStatus(username, {
        ...userStatus,
        claimStatus: "pioneer"
      });

      // Alert Telegram
      sendTelegramAlert(
        `<b>🚨 FRAGMENT REVEALED! 🚨</b>\n\n` +
        `User @${username} discovered today's clue.\n` +
        `Character: <code>${char}</code> at position ${gameState.activeFragmentIndex}\n\n` +
        `<a href="${tweetUrl}">View the post on X</a>`
      );

      return res.json({ 
        status: "PIONEER",
        char,
        index: gameState.activeFragmentIndex,
        message: "BINGO! You revealed today's fragment. The community thanks you, Pioneer."
      });
    }

    // Pas trouvé
    await setUserStatus(username, {
      ...userStatus,
      submitted: true, // IMPORTANT: marquer comme soumis
      claimStatus: "not_found"
    });

    return res.json({ 
      status: "NOT_FOUND",
      message: "Today's fragment remains hidden. Keep an eye on the MassArmy Telegram – another pioneer might reveal it soon! If someone finds it, come back here to repost their message and unlock the fragment for yourself."
    });
  }

  res.status(400).json({ error: "You have already submitted your post for today." });
});

// 3. Get user collection
app.get('/api/user/collection/:username', async (req, res) => {
  const data = await kv.smembers(`user:collection:${req.params.username}`);
  res.json({ collection: data || [] });
});

// 4. Get game status (pour afficher l'état)
app.get('/api/game/status', async (req, res) => {
  const gameState = await getGameState();
  res.json({ 
    pioneer: gameState.pioneer,
    fragmentAvailable: gameState.activeFragmentIndex !== null
  });
});

export default app;
