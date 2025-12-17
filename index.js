// index.js - Backend proxy pour échanger les tokens OAuth X
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();

// --- CONFIGURATION CORS CORRIGÉE ---
const allowedOrigin = 'https://spreadmassaquest.build.half-red.net';

app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Gestion explicite du Preflight (requêtes OPTIONS)
app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});
// -----------------------------------

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
    return res.status(400).json({ 
      error: 'Missing required parameters'
    });
  }

  try {
    const bodyPairs = [
      "grant_type=authorization_code",
      "client_id=" + encodeURIComponent(CLIENT_ID),
      "code=" + encodeURIComponent(code),
      "redirect_uri=" + encodeURIComponent(redirect_uri),
      "code_verifier=" + encodeURIComponent(code_verifier)
    ];
    const bodyString = bodyPairs.join("&");

    const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: bodyString
    });

    const data = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res.status(tokenResponse.status).json(data);
    }

    res.json(data);
  } catch (err) {
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
    return res.status(400).json({ error: 'Missing access_token' });
  }

  try {
    const profileResponse = await fetch("https://api.x.com/2/users/me?user.fields=profile_image_url", {
      headers: { 
        Authorization: `Bearer ${access_token}` 
      }
    });

    const data = await profileResponse.json();
    if (!profileResponse.ok) return res.status(profileResponse.status).json(data);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend démarré sur le port ${PORT}`);
});

export default app;
