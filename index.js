const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { kv } = require('@vercel/kv'); // Connexion Upstash Redis

const app = express();

app.use(cors({ origin: '*', credentials: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const CLIENT_ID = "SHFXVndGU2ZBRk1GbzlpWlFJR1Q6MTpjaQ";
const ADMIN_WEBHOOK_URL = process.env.ADMIN_WEBHOOK_URL;

const TRUTHS_POOL = [
  "Massa scales to 10,000+ TPS without sacrificing decentralization. #DeWeb @massachain $MAS",
  "No AWS. No shutdowns. Massa cannot be stopped. This is real freedom. #DeWeb @massachain $MAS",
  "Websites that live forever on-chain. That's the DeWeb by Massa. #DeWeb @massachain $MAS",
  "300+ nodes. Try censoring Massa. You can't. #SpreadMassaQuest @massachain $MAS",
  "The future of the internet is autonomous and uncensorable. #Massa @massachain $MAS"
];

// --- GESTION DU JEU ---
async function getGameState() {
  const today = new Date().toISOString().split('T')[0];
  let state = await kv.get('gameState');

  if (!state || state.lastResetDate !== today) {
    state = {
      lastResetDate: today,
      winningMessageId: Math.floor(Math.random() * TRUTHS_POOL.length),
      isRevealed: false,
      revealedBy: null,
      winningTweetUrl: null,
      winningFragmentChar: "M" // Ton indice secret du jour
    };
    await kv.set('gameState', state);
  }
  return state;
}

// --- TES ROUTES OAUTH (PRÉSERVÉES) ---

app.post('/api/oauth/token', async (req, res) => {
  const { code, redirect_uri, code_verifier } = req.body;
  try {
    const authHeader = Buffer.from(`${CLIENT_ID}:`).toString('base64');
    const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${authHeader}` },
      body: new URLSearchParams({ code, grant_type: "authorization_code", redirect_uri, code_verifier, client_id: CLIENT_ID })
    });
    const data = await tokenResponse.json();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/user/profile', async (req, res) => {
  const { access_token } = req.body;
  try {
    const profileResponse = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const data = await profileResponse.json();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- NOUVELLES ROUTES DU JEU (ADMIN + USER C) ---

app.post('/api/game/generate', async (req, res) => {
  const { username } = req.body;
  const state = await getGameState();
  const userKey = `user:${state.lastResetDate}:${username}`;

  const userAction = await kv.get(userKey);
  if (userAction && userAction.hasGenerated) {
    return res.status(403).json({ error: "Daily limit reached." });
  }

  const assignedId = Math.floor(Math.random() * TRUTHS_POOL.length);
  const text = TRUTHS_POOL[assignedId] + " https://spreadmassaquest.deweb.half-red.net";

  await kv.set(userKey, { hasGenerated: true, assignedMessageId: assignedId, step: 1 });
  res.json({ text });
});

app.post('/api/game/submit', async (req, res) => {
  const { username, tweetUrl } = req.body;
  const state = await getGameState();
  const userKey = `user:${state.lastResetDate}:${username}`;
  let userAction = await kv.get(userKey);

  if (!userAction) return res.status(400).json({ error: "Generate first." });

  // LOGIQUE USER C (Si quelqu'un a déjà gagné)
  if (state.isRevealed && state.revealedBy !== username) {
    if (userAction.step === 1) {
      userAction.step = 2; // Doit maintenant reposter le gagnant
      await kv.set(userKey, userAction);
      return res.json({
        status: "NEED_REPOST",
        revealedBy: state.revealedBy,
        originalTweetUrl: state.winningTweetUrl 
      });
    }
    if (userAction.step === 2) {
      return res.json({ status: "SUCCESS", fragment: state.winningFragmentChar });
    }
  }

  // LOGIQUE GAGNANT (Si c'est la bonne phrase)
  if (!state.isRevealed && userAction.assignedMessageId === state.winningMessageId) {
    state.isRevealed = true;
    state.revealedBy = username;
    state.winningTweetUrl = tweetUrl;
    await kv.set('gameState', state);

    // ALERTE ADMIN (DISCORD)
    if (ADMIN_WEBHOOK_URL) {
      await fetch(ADMIN_WEBHOOK_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ content: `✅ **Indice Révélé !**\nUtilisateur : @${username}\nLien : ${tweetUrl}` })
      });
    }
    return res.json({ status: "SUCCESS", fragment: state.winningFragmentChar });
  }

  res.json({ status: "NOT_FOUND", message: "Try again tomorrow!" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Serveur prêt sur ${PORT}`));
