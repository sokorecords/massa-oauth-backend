// index.js - Backend proxy pour échanger les tokens OAuth X
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// Configuration CORS - Permet les requêtes depuis votre site DeWeb
app.use(cors({
  origin: '*', // Accepte toutes les origines (temporaire pour tester)
  credentials: false, // IMPORTANT : mettre false quand origin est '*'
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const CLIENT_ID = "SHFXVndGU2ZBRk1GbzlpWlFJR1Q6MTpjaQ";

// Route de test
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Massa OAuth Backend is running!' 
  });
});

// Endpoint pour échanger le code contre un token
app.post('/api/oauth/token', async (req, res) => {
  console.log('📥 Requête reçue:', req.body);
  
  const { code, redirect_uri, code_verifier } = req.body;

  if (!code || !redirect_uri || !code_verifier) {
    console.error('❌ Paramètres manquants');
    return res.status(400).json({ 
      error: 'Missing required parameters',
      received: { code: !!code, redirect_uri: !!redirect_uri, code_verifier: !!code_verifier }
    });
  }

  try {
    // Construction du body
    const bodyPairs = [
      "grant_type=authorization_code",
      "client_id=" + encodeURIComponent(CLIENT_ID),
      "code=" + encodeURIComponent(code),
      "redirect_uri=" + encodeURIComponent(redirect_uri),
      "code_verifier=" + encodeURIComponent(code_verifier)
    ];
    const bodyString = bodyPairs.join("&");

    console.log('🔄 Envoi vers X API...');

    // Requête vers l'API X
    const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: bodyString
    });

    const data = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('❌ Erreur X API:', data);
      return res.status(tokenResponse.status).json(data);
    }

    console.log('✅ Token obtenu avec succès');
    res.json(data);
  } catch (err) {
    console.error('❌ Erreur serveur:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      message: err.message 
    });
  }
});
// Endpoint pour récupérer le profil utilisateur
app.post('/api/user/profile', async (req, res) => {
  const { access_token } = req.body;

  if (!access_token) {
    return res.status(400).json({ 
      error: 'Missing access_token' 
    });
  }

  try {
    console.log('🔄 Récupération du profil utilisateur...');

    const profileResponse = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
      headers: { 
        Authorization: `Bearer ${access_token}` 
      }
    });

    const data = await profileResponse.json();

    if (!profileResponse.ok) {
      console.error('❌ Erreur profil X API:', data);
      return res.status(profileResponse.status).json(data);
    }

    console.log('✅ Profil récupéré avec succès');
    res.json(data);
  } catch (err) {
    console.error('❌ Erreur serveur profil:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      message: err.message 
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Massa OAuth Backend démarré sur le port ${PORT}`);
  console.log(`📍 URL: http://localhost:${PORT}`);

});

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

