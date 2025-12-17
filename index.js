// index.js - Version Finale Sécurisée
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { kv } from '@vercel/kv';
// IMPORTANT : On ajoute bien l'extension .js ici
import { MASSA_TRUTHS } from './truths.js';

const app = express();

// --- CONFIGURATION CORS ULTRA-COMPLÈTE ---
const allowedOrigin = 'https://spreadmassaquest.build.half-red.net';

app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Middleware pour s'assurer que le JSON est bien lu
app.use(express.json());

// Récupération sécurisée de la clé (Variable d'environnement Vercel)
const SECRET_KEY = process.env.MASSA_PRIVATE_KEY || "";
const PRIVATE_KEY_CHARS = SECRET_KEY.split("");

// --- ROUTES ---

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Massa Quest Backend is Online' });
});

// 1. Générer le post quotidien
app.post('/api/game/generate', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Username requis" });

    const today = new Date().toISOString().split('T')[0];
    const key = `daily:${username}:${today}`;

    const alreadyPlayed = await kv.get(key);
    if (alreadyPlayed) return res.json({ text: null });

    // Pioche une phrase au hasard
    const randomIndex = Math.floor(Math.random() * MASSA_TRUTHS.length);
    const text = MASSA_TRUTHS[randomIndex];

    await kv.set(key, "true", { ex: 86400 });
    res.json({ text });
  } catch (err) {
    console.error("Erreur Generate:", err);
    res.status(500).json({ error: "Erreur interne", details: err.message });
  }
});

// 2. Valider et donner l'indice suivant
app.post('/api/game/submit', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Données manquantes" });

    const countKey = `user:count:${username}`;
    let currentCount = (await kv.get(countKey)) || 0;

    if (currentCount >= 53 || currentCount >= PRIVATE_KEY_CHARS.length) {
      return res.json({ status: "ERROR", message: "Quête terminée !" });
    }

    const fragment = PRIVATE_KEY_CHARS[currentCount];
    const position = currentCount + 1;

    await kv.set(countKey, currentCount + 1);

    res.json({ 
      status: "SUCCESS", 
      fragment: fragment, 
      position: position 
    });
  } catch (err) {
    console.error("Erreur Submit:", err);
    res.status(500).json({ error: "Erreur interne" });
  }
});

// --- ROUTES OAUTH (Copie tes anciennes routes ici) ---
app.post('/api/oauth/token', async (req, res) => {
  const { code, redirect_uri, code_verifier } = req.body;
  try {
    const bodyPairs = [
      "grant_type=authorization_code",
      "client_id=SHFXVndGU2ZBRk1GbzlpWlFJR1Q6MTpjaQ",
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/user/profile', async (req, res) => {
  const { access_token } = req.body;
  try {
    const profileResponse = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const data = await profileResponse.json();
    res.status(profileResponse.status).json(data);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Ready on ${PORT}`));

export default app;
