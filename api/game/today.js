// api/game/today.js - Récupère l'état du jeu pour aujourd'hui (avec Vercel KV)

import { kv } from '@vercel/kv';

// Les 53 caractères de la clé privée
const PRIVATE_KEY_CHARS = "S12bFTmZYFZfFBQc7rMz8Yt92gELGJrgMiNpqnPPAwYRyi2LFNXp".split("");

// Fonction pour obtenir la date du jour (UTC)
function getTodayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().split('T')[0];
}

// Fonction pour récupérer l'état depuis KV
async function getGameState() {
  const state = await kv.get('gameState');
  if (!state) {
    // État initial
    return {
      lastUpdate: null,
      activeFragments: [],
      revealedFragments: {},
      messageOfTheDay: null,
      carryOverCount: 0
    };
  }
  return state;
}

// Fonction pour sauvegarder l'état dans KV
async function saveGameState(state) {
  await kv.set('gameState', state);
}

// Fonction pour initialiser le jour
async function initializeDay() {
  const today = getTodayUTC();
  const gameState = await getGameState();
  
  // Si c'est un nouveau jour
  if (gameState.lastUpdate !== today) {
    console.log(`🆕 Nouveau jour détecté: ${today}`);
    
    // Calculer combien de fragments sont disponibles (1 + carry-over)
    const availableFragments = 1 + gameState.carryOverCount;
    
    // Trouver les fragments pas encore révélés
    const unrevealedFragments = [];
    for (let i = 0; i < PRIVATE_KEY_CHARS.length; i++) {
      if (!gameState.revealedFragments[i]) {
        unrevealedFragments.push(i);
      }
    }
    
    // Sélectionner aléatoirement les fragments actifs pour aujourd'hui
    const fragmentsToActivate = Math.min(availableFragments, unrevealedFragments.length);
    gameState.activeFragments = [];
    
    const shuffled = [...unrevealedFragments].sort(() => Math.random() - 0.5);
    for (let i = 0; i < fragmentsToActivate; i++) {
      gameState.activeFragments.push(shuffled[i]);
    }
    
    console.log(`✅ ${fragmentsToActivate} fragment(s) actif(s) aujourd'hui`);
    console.log(`📦 Fragments actifs: ${gameState.activeFragments.join(', ')}`);
    
    gameState.lastUpdate = today;
    gameState.messageOfTheDay = null; // Reset le message du jour
    
    // Sauvegarder
    await saveGameState(gameState);
  }
  
  return gameState;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Initialiser le jour si nécessaire
    const gameState = await initializeDay();

    // Retourner l'état public (sans révéler quels fragments sont actifs)
    const response = {
      date: getTodayUTC(),
      totalFragments: PRIVATE_KEY_CHARS.length,
      revealedCount: Object.keys(gameState.revealedFragments).length,
      messageOfTheDay: gameState.messageOfTheDay,
      hasActiveFragments: gameState.activeFragments.length > 0,
      // NE PAS exposer activeFragments ou carryOverCount pour éviter la triche
    };

    return res.status(200).json(response);
  } catch (err) {
    console.error('Erreur /api/game/today:', err);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    });
  }
}

// Export des fonctions utilitaires pour les autres endpoints
export { getTodayUTC, getGameState, saveGameState, initializeDay, PRIVATE_KEY_CHARS };
