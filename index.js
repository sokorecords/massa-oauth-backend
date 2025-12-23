import express from 'express';
import cors from 'cors';
import { kv } from '@vercel/kv';
import { MASSA_TRUTHS } from './truths.js';

const app = express();

// MODE DEBUG: Mettre à true pour tester
const DEBUG_MODE = process.env.DEBUG_MODE === "true" || false;
if (DEBUG_MODE) {
  console.log("⚠️ DEBUG MODE ACTIVATED");
}

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

    let activeFragment = null;
    if (state?.pioneer) {
      activeFragment = remainingIndices.length > 0 
        ? remainingIndices[Math.floor(Math.random() * remainingIndices.length)] 
        : null;
    } else if (state?.activeFragmentIndex !== null && state?.activeFragmentIndex !== undefined) {
      activeFragment = state.activeFragmentIndex;
    } else {
      activeFragment = remainingIndices.length > 0 
        ? remainingIndices[Math.floor(Math.random() * remainingIndices.length)] 
        : null;
    }

    state = {
      lastUpdate: today,
      activeFragmentIndex: activeFragment,
      winningMessageId: Math.floor(Math.random() * MASSA_TRUTHS.length),
      pioneer: null
    };
    await kv.set('gameState', state);
  }
  return state;
}

// --- USER STATUS ---
async function getUserStatus(username) {
  const today = getTodayUTC();
  const statusKey = `status:${username}:${today}`;
  return await kv.get(statusKey);
}

async function setUserStatus(username, status) {
  const today = getTodayUTC();
  const statusKey = `status:${username}:${today}`;
  await kv.set(statusKey, status);
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
app.post('/api/game/generate', async (req, res) => {
  const { username } = req.body;
  
  const streak = await updateUserStreak(username);
  const userStatus = await getUserStatus(username);
  const gameState = await getGameState();

  if (userStatus?.messageId !== undefined) {
    return res.json({ 
      status: "ALREADY_GENERATED", 
      messageId: userStatus.messageId,
      text: MASSA_TRUTHS[userStatus.messageId],
      userStatus,
      pioneer: gameState.pioneer,
      streak 
    });
  }

  const messageId = Math.floor(Math.random() * MASSA_TRUTHS.length);
  
  const newStatus = {
    messageId,
    submitted: false,
    claimStatus: "pending"
  };
  
  await setUserStatus(username, newStatus);

  res.json({ 
    status: "NEW_MESSAGE", 
    messageId, 
    text: MASSA_TRUTHS[messageId],
    userStatus: newStatus,
    pioneer: gameState.pioneer,
    streak 
  });
});

app.post('/api/game/check-status', async (req, res) => {
  const { username } = req.body;
  
  const userStatus = await getUserStatus(username);
  const gameState = await getGameState();
  
  if (!userStatus) {
    return res.json({
      status: "NO_STATUS",
      userStatus: null,
      pioneer: gameState.pioneer
    });
  }
  
  res.json({
    status: userStatus.messageId !== undefined ? "HAS_STATUS" : "NO_STATUS",
    messageId: userStatus.messageId,
    text: userStatus.messageId !== undefined ? MASSA_TRUTHS[userStatus.messageId] : null,
    userStatus,
    pioneer: gameState.pioneer
  });
});

app.post('/api/game/submit', async (req, res) => {
  const { username, tweetUrl, isRepost } = req.body;
  
  if (!tweetUrl || !tweetUrl.includes('/status/')) {
    return res.status(400).json({ error: "Invalid tweet URL" });
  }

  const urlMatch = tweetUrl.match(/(?:twitter\.com|x\.com)\/([^\/]+)\/status\/(\d+)/);
  if (!urlMatch) {
    return res.status(400).json({ error: "Invalid tweet URL format" });
  }
  
  const urlUsername = urlMatch[1].toLowerCase();
  const tweetId = urlMatch[2];

  const userStatus = await getUserStatus(username);
  const gameState = await getGameState();

  if (userStatus?.claimStatus === "pioneer" || userStatus?.claimStatus === "follower") {
    return res.json({ 
      status: "ALREADY_CLAIMED",
      message: "You have already claimed your fragment for today."
    });
  }

  if (isRepost && gameState.pioneer) {
    if (!userStatus?.firstTweetUrl) {
      return res.status(400).json({ 
        error: "You must first share your own generated message before claiming via repost."
      });
    }
    
    if (tweetUrl === userStatus.firstTweetUrl) {
      return res.status(400).json({ 
        error: "Please submit your REPOST link of the pioneer's message, not your original post."
      });
    }
    
    if (urlUsername !== username.toLowerCase()) {
      return res.status(400).json({ 
        error: `This post belongs to @${urlUsername}. Please submit YOUR repost link from your @${username} account.`
      });
    }
    
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
  }

  if (!userStatus?.submitted) {
    if (urlUsername !== username.toLowerCase()) {
      return res.status(400).json({ 
        error: `This post belongs to @${urlUsername}. Please submit YOUR post link from your @${username} account.`
      });
    }
    
    await setUserStatus(username, {
      ...userStatus,
      submitted: true,
      firstTweetUrl: tweetUrl,
      firstTweetId: tweetId
    });

    if (gameState.pioneer) {
      return res.json({ 
        status: "PIONEER_EXISTS",
        pioneer: gameState.pioneer,
        message: `Today's fragment was already discovered by @${gameState.pioneer.username}. Repost their message to unlock it.`
      });
    }

    if (gameState.activeFragmentIndex !== null && 
        parseInt(userStatus.messageId) === gameState.winningMessageId) {
      
      const char = PRIVATE_KEY_CHARS[gameState.activeFragmentIndex];
      
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
        submitted: true,
        claimStatus: "pioneer"
      });

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

    await setUserStatus(username, {
      ...userStatus,
      submitted: true,
      claimStatus: "not_found"
    });

    return res.json({ 
      status: "NOT_FOUND",
      message: "Today's fragment remains hidden. Keep an eye on the MassArmy Telegram — another pioneer might reveal it soon!"
    });
  }

  res.status(400).json({ error: "You have already submitted your post for today." });
});

app.get('/api/user/collection/:username', async (req, res) => {
  const data = await kv.smembers(`user:collection:${req.params.username}`);
  res.json({ collection: data || [] });
});

app.get('/api/game/status', async (req, res) => {
  const gameState = await getGameState();
  res.json({ 
    pioneer: gameState.pioneer,
    fragmentAvailable: gameState.activeFragmentIndex !== null
  });
});

// --- ADMIN ROUTES ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme123";

function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const token = authHeader.substring(7);
  
  if (token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
}

app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  
  if (password === ADMIN_PASSWORD) {
    res.json({ 
      success: true,
      token: ADMIN_PASSWORD
    });
  } else {
    res.status(401).json({ 
      success: false,
      error: 'Invalid password' 
    });
  }
});

app.get('/api/admin/all-users', verifyAdmin, async (req, res) => {
  try {
    const today = getTodayUTC();
    const allKeys = await kv.keys('user:collection:*');
    const users = [];
    
    for (const key of allKeys) {
      const username = key.replace('user:collection:', '');
      const collection = await kv.smembers(key);
      const streak = await kv.get(`streak:${username}`);
      const status = await kv.get(`status:${username}:${today}`);
      
      users.push({
        username,
        fragmentsCount: collection ? collection.length : 0,
        collection: collection || [],
        streak: streak?.streak || 0,
        lastActive: streak?.lastVisit || null,
        status: status
      });
    }
    
    users.sort((a, b) => b.fragmentsCount - a.fragmentsCount);
    
    res.json({ users, count: users.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DEBUG ROUTES ---
if (DEBUG_MODE) {
  app.post('/api/debug/reset-user', async (req, res) => {
    const { username } = req.body;
    const today = getTodayUTC();
    await kv.del(`status:${username}:${today}`);
    res.json({ message: `User ${username} reset` });
  });

  app.post('/api/debug/reset-game', async (req, res) => {
    await kv.del('gameState');
    const gameState = await getGameState();
    res.json({ message: 'Game reset', gameState });
  });

  app.post('/api/debug/clear-collection', async (req, res) => {
    const { username } = req.body;
    await kv.del(`user:collection:${username}`);
    res.json({ message: 'Collection cleared' });
  });

  app.post('/api/debug/simulate-submitted', async (req, res) => {
    const { username } = req.body;
    await setUserStatus(username, {
      messageId: 0,
      submitted: true,
      claimStatus: "not_found",
      firstTweetUrl: "https://x.com/test/123"
    });
    res.json({ message: 'Submitted simulated' });
  });

  app.post('/api/debug/simulate-pioneer', async (req, res) => {
    const { username } = req.body;
    const gameState = await getGameState();
    
    if (gameState.activeFragmentIndex === null) {
      return res.status(400).json({ error: "No active fragment" });
    }
    
    const char = PRIVATE_KEY_CHARS[gameState.activeFragmentIndex];
    gameState.pioneer = {
      username: username || "TestPioneer",
      url: "https://x.com/test/999",
      index: gameState.activeFragmentIndex,
      char
    };
    
    await kv.set('gameState', gameState);
    await kv.sadd('global:revealed_indices', gameState.activeFragmentIndex.toString());
    
    res.json({ message: 'Pioneer simulated', pioneer: gameState.pioneer });
  });

  app.get('/api/debug/user-status/:username', async (req, res) => {
    const userStatus = await getUserStatus(req.params.username);
    const collection = await kv.smembers(`user:collection:${req.params.username}`);
    const streak = await kv.get(`streak:${req.params.username}`);
    
    res.json({ userStatus, collection, streak });
  });

  app.get('/api/debug/game-state', async (req, res) => {
    const gameState = await getGameState();
    const globalRevealed = await kv.smembers('global:revealed_indices');
    
    res.json({
      gameState,
      globalRevealed,
      totalRevealed: globalRevealed ? globalRevealed.length : 0,
      remaining: 53 - (globalRevealed ? globalRevealed.length : 0)
    });
  });

  app.post('/api/debug/force-win', async (req, res) => {
    const { username } = req.body;
    const userStatus = await getUserStatus(username);
    const gameState = await getGameState();
    
    if (!userStatus?.messageId) {
      return res.status(400).json({ error: "Generate message first" });
    }
    
    gameState.winningMessageId = userStatus.messageId;
    await kv.set('gameState', gameState);
    
    res.json({ message: 'Forced win', messageId: userStatus.messageId });
  });
}

app.get('/api/test-alive', (req, res) => {
  res.json({ message: 'Backend alive', debugMode: DEBUG_MODE });
});

export default app;
