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

