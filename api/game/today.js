// api/game/today.js - Récupère l'état du jeu pour aujourd'hui

// Pour stocker l'état, on utilise un objet en mémoire (temporaire)
// TODO: Remplacer par Vercel KV ou une vraie DB en production
let gameState = {
  lastUpdate: null,
  activeFragments: [], // Liste des indices de fragments actifs aujourd'hui
  revealedFragments: {}, // { fragmentIndex: { messageId, revealedBy, timestamp } }
  messageOfTheDay: null, // { messageId, text, fragmentIndex, revealedBy, timestamp }
  carryOverCount: 0 // Nombre de fragments en attente
};

// Les 53 caractères de la clé privée
const PRIVATE_KEY_CHARS = "S12bFTmZYFZfFBQc7rMz8Yt92gELGJrgMiNpqnPPAwYRyi2LFNXp".split("");

// Fonction pour obtenir la date du jour (UTC)
function getTodayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().split('T')[0];
}

// Fonction pour initialiser le jour (appelée au premier accès de la journée)
function initializeDay() {
  const today = getTodayUTC();
  
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
  }
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
    initializeDay();

    // Retourner l'état public (sans révéler quels fragments sont actifs)
    const response = {
      date: getTodayUTC(),
      totalFragments: PRIVATE_KEY_CHARS.length,
      revealedCount: Object.keys(gameState.revealedFragments).length,
      messageOfTheDay: gameState.messageOfTheDay,
      hasActiveFragments: gameState.activeFragments.length > 0,
      // NE PAS exposer activeFragments ou carryOverCount
    };

    return res.status(200).json(response);
  } catch (err) {
    console.error('Erreur /api/game/today:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Export de l'état pour les autres endpoints (simulation d'un store partagé)
export { gameState, getTodayUTC, initializeDay, PRIVATE_KEY_CHARS };