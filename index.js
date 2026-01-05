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
    
    // Alerte Telegram pour les milestones
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

    // CARRY-OVER: Garder le fragment actif si non trouvé
    let activeFragment = null;
    if (state?.pioneer) {
      // Fragment trouvé hier, en choisir un nouveau
      activeFragment = remainingIndices.length > 0 
        ? remainingIndices[Math.floor(Math.random() * remainingIndices.length)] 
        : null;
    } else if (state?.activeFragmentIndex !== null && state?.activeFragmentIndex !== undefined) {
      // Fragment pas trouvé hier, le garder (CARRY-OVER)
      activeFragment = state.activeFragmentIndex;
    } else {
      // Première fois ou état corrompu
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
  console.log('[Profile] Route called');
  
  try {
    const { access_token } = req.body;
    console.log('[Profile] Access token received:', !!access_token);
    
    if (!access_token) {
      console.log('[Profile] ERROR: No access token');
      return res.status(400).json({ error: "Missing access_token" });
    }
    
    console.log('[Profile] Fetching user data from X API...');
    const response = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
      headers: { "Authorization": `Bearer ${access_token}` }
    });
    const data = await response.json();
    console.log('[Profile] User data received:', data.data?.username);
    
    // Créer collection avec un marqueur permanent
    if (data.data?.username) {
      const username = data.data.username;
      const collectionKey = `user:collection:${username}`;
      
      console.log(`[Profile] Checking/creating collection: ${collectionKey}`);
      
      try {
        // Vérifier si existe déjà
        const exists = await kv.exists(collectionKey);
        console.log(`[Profile] Collection exists before: ${exists}`);
        
        if (exists === 0) {
          // Créer avec un marqueur permanent "_user_registered"
          await kv.sadd(collectionKey, '_user_registered');
          console.log(`[Profile] Collection created with marker`);
          
          // Vérifier
          const checkAfter = await kv.exists(collectionKey);
          console.log(`[Profile] Collection exists after: ${checkAfter}`);
        } else {
          console.log(`[Profile] Collection already exists`);
        }
        
      } catch (kvError) {
        console.error(`[Profile] KV Error:`, kvError);
      }
      
    } else {
      console.log('[Profile] No username in data');
    }
    
    res.json(data);
  } catch (err) { 
    console.error('[Profile] Main error:', err);
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
  
  const streak = await updateUserStreak(username);
  const userStatus = await getUserStatus(username);
  const gameState = await getGameState();

  console.log(`[Generate] User: ${username}, Status:`, userStatus);

  if (userStatus?.messageId !== undefined) {
    console.log(`[Generate] User already generated today`);
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

  console.log(`[Generate] New message generated for ${username}`);

  res.json({ 
    status: "NEW_MESSAGE", 
    messageId, 
    text: MASSA_TRUTHS[messageId],
    userStatus: newStatus,
    pioneer: gameState.pioneer,
    streak 
  });
});

// Route pour vérifier l'état sans générer
app.post('/api/game/check-status', async (req, res) => {
  const { username } = req.body;
  
  const userStatus = await getUserStatus(username);
  const gameState = await getGameState();
  
  // Si pas de statut, retourner null
  if (!userStatus) {
    return res.json({
      status: "NO_STATUS",
      userStatus: null,
      pioneer: gameState.pioneer
    });
  }
  
  // Retourner le statut existant
  res.json({
    status: userStatus.messageId !== undefined ? "HAS_STATUS" : "NO_STATUS",
    messageId: userStatus.messageId,
    text: userStatus.messageId !== undefined ? MASSA_TRUTHS[userStatus.messageId] : null,
    userStatus,
    pioneer: gameState.pioneer
  });
});

// 2. Submit link
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

  // CAS 1: Repost - l'utilisateur essaie de claim via repost du pionnier
  if (isRepost && gameState.pioneer) {
    // Vérifier que l'utilisateur a déjà soumis son propre tweet
    if (!userStatus?.firstTweetUrl) {
      return res.status(400).json({ 
        error: "You must first share your own generated message before claiming via quoting."
      });
    }
    
    // Vérifier que ce n'est pas son propre tweet original
    if (tweetUrl === userStatus.firstTweetUrl) {
      return res.status(400).json({ 
        error: "Please submit your Quote link of the pioneer's message, not your original post."
      });
    }
    
    // Vérifier que le repost appartient bien à l'utilisateur
    if (urlUsername !== username.toLowerCase()) {
      return res.status(400).json({ 
        error: `This post belongs to @${urlUsername}. Please submit YOUR quote link from your @${username} account.`
      });
    }
    
    // Tout est OK, débloquer le fragment
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

  // CAS 2: Première soumission
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
        message: `Today's fragment was already discovered by @${gameState.pioneer.username}. Quote their message to unlock it.`
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
      message: "Today's fragment remains hidden. Keep an eye on the MassArmy Telegram — another pioneer might reveal it soon! If someone finds it, come back here to quote their message and unlock the fragment for yourself."
    });
  }

  res.status(400).json({ error: "You have already submitted your post for today." });
});

// 3. Get user collection
app.get('/api/user/collection/:username', async (req, res) => {
  const data = await kv.smembers(`user:collection:${req.params.username}`);
  res.json({ collection: data || [] });
});

// 4. Get game status
app.get('/api/game/status', async (req, res) => {
  const gameState = await getGameState();
  res.json({ 
    pioneer: gameState.pioneer,
    fragmentAvailable: gameState.activeFragmentIndex !== null
  });
});

// ========================================
// ADMIN ROUTES
// ========================================

// Middleware de vérification admin
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme123";

function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }
  
  const token = authHeader.substring(7); // Enlever "Bearer "
  
  if (token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized - Invalid token' });
  }
  
  next();
}

// Route de login admin
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  
  if (password === ADMIN_PASSWORD) {
    res.json({ 
      success: true,
      token: ADMIN_PASSWORD,
      message: 'Login successful'
    });
  } else {
    res.status(401).json({ 
      success: false,
      error: 'Invalid password' 
    });
  }
});

// Route pour obtenir tous les utilisateurs et leurs progressions (PROTÉGÉE)
app.get('/api/admin/all-users', verifyAdmin, async (req, res) => {
  try {
    const today = getTodayUTC();
    
    // Récupérer tous les utilisateurs qui ont une collection
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
    
    // Trier par nombre de fragments (décroissant)
    users.sort((a, b) => b.fragmentsCount - a.fragmentsCount);
    
    res.json({ users, count: users.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// ROUTES DEBUG
// ========================================

if (DEBUG_MODE) {
  console.log("Loading DEBUG routes...");
  
  // Reset les actions d'un utilisateur pour aujourd'hui
  app.post('/api/debug/reset-user', async (req, res) => {
    const { username } = req.body;
    const today = getTodayUTC();
    
    await kv.del(`status:${username}:${today}`);
    
    res.json({ 
      message: `User ${username} reset for ${today}`,
      username,
      date: today
    });
  });

  // Reset l'état global du jeu
  app.post('/api/debug/reset-game', async (req, res) => {
    const today = getTodayUTC();
    
    await kv.del('gameState');
    
    const globalRevealed = await kv.smembers('global:revealed_indices') || [];
    const remainingIndices = PRIVATE_KEY_CHARS.map((_, i) => i)
                               .filter(i => !globalRevealed.includes(i.toString()));

    const newState = {
      lastUpdate: today,
      activeFragmentIndex: remainingIndices.length > 0 
        ? remainingIndices[Math.floor(Math.random() * remainingIndices.length)] 
        : null,
      winningMessageId: Math.floor(Math.random() * MASSA_TRUTHS.length),
      pioneer: null
    };
    
    await kv.set('gameState', newState);
    
    res.json({ 
      message: 'Game state reset - new fragment selected',
      newState: {
        fragmentIndex: newState.activeFragmentIndex,
        winningMessageId: newState.winningMessageId,
        totalRevealed: globalRevealed.length,
        remaining: remainingIndices.length
      }
    });
  });

  // Vider la collection d'un utilisateur
  app.post('/api/debug/clear-collection', async (req, res) => {
    const { username } = req.body;
    await kv.del(`user:collection:${username}`);
    res.json({ message: `Collection cleared for ${username}` });
  });
  
  // Simuler qu'un utilisateur a soumis sans succès
  app.post('/api/debug/simulate-submitted', async (req, res) => {
    const { username } = req.body;
    
    await setUserStatus(username, {
      messageId: Math.floor(Math.random() * MASSA_TRUTHS.length),
      submitted: true,
      claimStatus: "not_found",
      firstTweetUrl: "https://x.com/test/status/123456"
    });
    
    res.json({ message: `${username} set to "submitted without success"` });
  });
  
  // Simuler qu'un pionnier a trouvé
  app.post('/api/debug/simulate-pioneer', async (req, res) => {
    const { username, tweetUrl } = req.body;
    const gameState = await getGameState();
    
    if (gameState.activeFragmentIndex === null) {
      return res.status(400).json({ error: "No active fragment" });
    }
    
    const char = PRIVATE_KEY_CHARS[gameState.activeFragmentIndex];
    
    gameState.pioneer = {
      username: username || "TestPioneer",
      url: tweetUrl || "https://x.com/test/status/999999",
      index: gameState.activeFragmentIndex,
      char
    };
    
    await kv.set('gameState', gameState);
    await kv.sadd('global:revealed_indices', gameState.activeFragmentIndex.toString());
    
    res.json({ 
      message: `Pioneer set!`,
      pioneer: gameState.pioneer
    });
  });
  
  // Voir l'état actuel d'un utilisateur
  app.get('/api/debug/user-status/:username', async (req, res) => {
    const userStatus = await getUserStatus(req.params.username);
    const collection = await kv.smembers(`user:collection:${req.params.username}`);
    const streak = await kv.get(`streak:${req.params.username}`);
    
    res.json({
      userStatus,
      collection,
      streak
    });
  });
  
  // Voir l'état global du jeu
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
  
  // FORCER le prochain message à être gagnant (pour tester)
  app.post('/api/debug/force-win', async (req, res) => {
    const { username } = req.body;
    
    const userStatus = await getUserStatus(username);
    const gameState = await getGameState();
    
    if (!userStatus?.messageId) {
      return res.status(400).json({ error: "User must generate a message first" });
    }
    
    // Modifier le gameState pour que le messageId de l'user soit le gagnant
    gameState.winningMessageId = userStatus.messageId;
    await kv.set('gameState', gameState);
    
    res.json({ 
      message: `${username}'s message is now the winning one!`,
      messageId: userStatus.messageId,
      winningMessageId: gameState.winningMessageId
    });
  });
}

// Route toujours disponible
app.post('/api/test/fix-status', async (req, res) => {
  const { username } = req.body;
  const today = getTodayUTC();
  const statusKey = `status:${username}:${today}`;
  
  const current = await kv.get(statusKey);
  if (current && current.claimStatus === "not_found") {
    current.submitted = true;
    await kv.set(statusKey, current);
    res.json({ message: 'Status fixed!', status: current });
  } else {
    res.json({ message: 'Nothing to fix', status: current });
  }
});

// TEST - Route de diagnostic
app.get('/api/test-alive', (req, res) => {
  res.json({ 
    message: 'Backend alive',
    debugMode: DEBUG_MODE,
    env: process.env.DEBUG_MODE 
  });
}); 

// ============================================
// ⚠️ ROUTE DE RESET TEMPORAIRE - À SUPPRIMER APRÈS TEST
// ============================================
app.post('/api/admin/reset-all', verifyAdmin, async (req, res) => {
  try {
    const allKeys = await kv.keys('*');
    
    for (const key of allKeys) {
      await kv.del(key);
    }
    
    res.json({ 
      message: 'Database completely reset',
      keysDeleted: allKeys.length
    });
  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// ROUTE ADMIN STATS (fonctionne sans DEBUG_MODE)
// ============================================
app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
  try {
    // Récupérer toutes les collections d'utilisateurs
    const collectionKeys = await kv.keys('user:collection:*');
    const totalUsers = collectionKeys.length;
    
    // Compter les fragments révélés (total de toutes les collections)
    let totalFragments = 0;
    for (const key of collectionKeys) {
      const collection = await kv.smembers(key);
      totalFragments += (collection ? collection.length : 0);
    }
    
    // Chercher le pioneer d'aujourd'hui dans le gameState
    const gameState = await kv.get('gameState');
    const pioneer = gameState?.pioneer || null;
    
    res.json({
      totalUsers,
      totalFragments,
      todayPioneer: pioneer
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: err.message });
  }
});


export default app;





