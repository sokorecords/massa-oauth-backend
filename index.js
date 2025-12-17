// index.js - Backend complet avec progression réelle
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { kv } from '@vercel/kv';
import { MASSA_TRUTHS, PRIVATE_KEY_CHARS } from './truths.js';

const app = express();

// --- CONFIGURATION CORS ---
const allowedOrigin = 'https://spreadmassaquest.build.half-red.net';

app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const CLIENT_ID = "SHFXVndGU2ZBRk1GbzlpWlFJR1Q6MTpjaQ";

// --- ROUTES AUTHENTIFICATION ---

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Massa Quest Backend Active' });
});

app.post('/api/oauth/token', async (req, res) => {
  const { code, redirect_uri, code_verifier } = req.body;
  if (!code || !redirect_uri || !code_verifier) return res.status(400).json({ error: 'Missing parameters' });

  try {
    const bodyPairs = [
      "grant_type=authorization_code",
      "client_id=" + encodeURIComponent(CLIENT_ID),
      "code=" + encodeURIComponent(code),
      "redirect_uri=" + encodeURIComponent(redirect_uri),
      "code_verifier=" + encodeURIComponent(code_verifier)
    ];
    const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: bodyPairs.join("&")
    });
    const data = await tokenResponse.json();
    res.status(tokenResponse.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/user/profile', async (req, res) => {
  const { access_token } = req.body;
  try {
    const profileResponse = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const data = await profileResponse.json();
    res.status(profileResponse.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- ROUTES DU JEU (LOGIQUE DE PROGRESSION) ---

// 1. Générer le post quotidien à partir de truths.js
app.post('/api/game/generate', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Username requis" });

  const today = new Date().toISOString().split('T')[0];
  const key = `daily:${username}:${today}`;

  try {
    const alreadyPlayed = await kv.get(key);
    if (alreadyPlayed) return res.json({ text: null });

    // Sélection aléatoire d'une vérité
    const randomIndex = Math.floor(Math.random() * MASSA_TRUTHS.length);
    const text = MASSA_TRUTHS[randomIndex];

    // On ne marque "joué" que si la génération a réussi
    await kv.set(key, "true", { ex: 86400 });
    res.json({ text });
  } catch (err) {
    console.error("Erreur Generate:", err);
    res.status(500).json({ error: "Redis Error", details: err.message });
  }
});

// 2. Valider le tweet et donner le fragment SUIVANT (de 1 à 53)
app.post('/api/game/submit', async (req, res) => {
  const { username, tweetUrl } = req.body;
  if (!username || !tweetUrl) return res.status(400).json({ error: "Données manquantes" });

  try {
    const countKey = `user:count:${username}`;
    let currentCount = await kv.get(countKey) || 0;

    // Si l'utilisateur a déjà tout trouvé
    if (currentCount >= 53) {
      return res.json({ status: "ERROR", message: "Tu as déjà découvert toute la clé !" });
    }

    // Récupérer le caractère à la position actuelle
    const fragment = PRIVATE_KEY_CHARS[currentCount];
    const position = currentCount + 1;

    // Incrémenter la progression dans Redis
    await kv.set(countKey, currentCount + 1);
    
    // Sauvegarder aussi le fragment dans la liste de l'utilisateur (historique)
    await kv.sadd(`user:fragments:${username}`, `${position}:${fragment}`);

    res.json({ 
      status: "SUCCESS", 
      fragment: fragment, 
      position: position 
    });
  } catch (err) {
    console.error("Erreur Submit:", err);
    res.status(500).json({ error: "Redis Error", details: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend prêt sur le port ${PORT}`);
});

export default app;
