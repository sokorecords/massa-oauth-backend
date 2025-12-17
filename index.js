// index.js - Backend proxy avec Auth X et Support Redis (KV)
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { kv } from '@vercel/kv'; // Ajout de la connexion Redis

const app = express();

// --- CONFIGURATION CORS (Ta version optimisée) ---
const allowedOrigin = 'https://spreadmassaquest.build.half-red.net';

app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const CLIENT_ID = "SHFXVndGU2ZBRk1GbzlpWlFJR1Q6MTpjaQ";

// --- ROUTES AUTHENTIFICATION (Tes routes d'origine) ---

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Massa OAuth Backend with Redis is running!' });
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

// --- NOUVELLES ROUTES DU JEU (Lien avec Upstash/Redis) ---

// 1. Générer le post quotidien et vérifier s'il a déjà joué
app.post('/api/game/generate', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Username requis" });

  const today = new Date().toISOString().split('T')[0];
  const key = `daily:${username}:${today}`;

  try {
    const alreadyPlayed = await kv.get(key);
    if (alreadyPlayed) return res.json({ text: null });

    // Texte avec un code unique pour éviter le spam
    const text = `I'm hunting for @MassaLabs secrets on #MassaQuest! 🧪 Progress: [${Math.random().toString(36).substring(7).toUpperCase()}] 
Join the quest here: https://spreadmassaquest.build.half-red.net/`;

    // Marquer comme joué pendant 24h
    await kv.set(key, "true", { ex: 86400 });
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: "Redis Error", details: err.message });
  }
});

// 2. Valider le tweet et débloquer un fragment
app.post('/api/game/submit', async (req, res) => {
  const { username, tweetUrl } = req.body;
  if (!username || !tweetUrl) return res.status(400).json({ error: "Données manquantes" });

  try {
    // Liste des lettres à débloquer pour Massa
    const letters = ["M", "A", "S", "S", "A"];
    const fragment = letters[Math.floor(Math.random() * letters.length)];
    
    // On enregistre le fragment dans le "set" Redis de l'utilisateur
    await kv.sadd(`user:fragments:${username}`, fragment);
    
    res.json({ status: "SUCCESS", fragment: fragment });
  } catch (err) {
    res.status(500).json({ error: "Redis Error", details: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend prêt sur le port ${PORT}`);
});

export default app;
