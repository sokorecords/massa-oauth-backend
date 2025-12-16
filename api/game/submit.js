// api/game/submit.js - Soumettre un post X et vérifier si un fragment est révélé (avec Vercel KV)

import { getTodayUTC, getGameState, saveGameState, initializeDay, PRIVATE_KEY_CHARS } from './today.js';

// Liste des 150 phrases (importée depuis truths.js dans le vrai code)
// Pour cet exemple, je mets juste les premières
const MASSA_TRUTHS = [
  "Massa produces parallel blocks through Blockclique, moving away from linear blockchain limits. This enables true concurrency while preserving decentralization.",
  "On Massa, smart contracts are autonomous and can schedule actions directly on-chain. Applications no longer depend on bots or external servers to function.",
  "Massa stores both frontends and backends directly inside the blockchain. Applications do not rely on hosting providers or gateways to remain accessible.",
  // ... Toutes les 150 phrases
];

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messageId, tweetUrl, userId } = req.body;

    if (messageId === undefined || !tweetUrl || !userId) {
      return res.status(400).json({ 
        error: 'Missing required fields: messageId, tweetUrl, userId' 
      });
    }

    // Initialiser le jour si nécessaire
    let gameState = await initializeDay();

    console.log(`📥 Soumission reçue: messageId=${messageId}, userId=${userId}`);

    // Vérifier si ce messageId correspond à un fragment actif
    // Logique : Chaque messageId peut potentiellement révéler un fragment
    // On assigne aléatoirement un fragment à chaque message généré
    
    // Pour simplifier : un messageId peut révéler n'importe quel fragment actif (aléatoire)
    if (gameState.activeFragments.length > 0) {
      // Choisir aléatoirement un fragment parmi les actifs
      const randomIndex = Math.floor(Math.random() * gameState.activeFragments.length);
      const fragmentIndex = gameState.activeFragments[randomIndex];
      const fragmentChar = PRIVATE_KEY_CHARS[fragmentIndex];
      
      // 🎉 FRAGMENT RÉVÉLÉ !
      console.log(`✅ Fragment révélé ! Index: ${fragmentIndex}, Char: ${fragmentChar}`);
      
      // Marquer comme révélé
      gameState.revealedFragments[fragmentIndex] = {
        messageId,
        revealedBy: userId,
        timestamp: new Date().toISOString(),
        tweetUrl
      };

      // Définir le message du jour
      gameState.messageOfTheDay = {
        messageId,
        text: MASSA_TRUTHS[messageId] || "Message text not found",
        fragmentIndex,
        fragmentChar,
        revealedBy: userId,
        timestamp: new Date().toISOString(),
        tweetUrl
      };

      // Retirer ce fragment des fragments actifs
      gameState.activeFragments = gameState.activeFragments.filter(i => i !== fragmentIndex);

      // Reset carry-over (fragment révélé aujourd'hui)
      gameState.carryOverCount = gameState.activeFragments.length;

      // Sauvegarder l'état
      await saveGameState(gameState);

      return res.status(200).json({
        success: true,
        revealed: true,
        fragment: {
          index: fragmentIndex,
          char: fragmentChar
        },
        message: "Fragment revealed! You found today's fragment.",
        isFirstReveal: true
      });
    } else {
      // Aucun fragment actif (tous révélés aujourd'hui ou carry-over complet)
      console.log(`❌ Aucun fragment actif disponible`);

      return res.status(200).json({
        success: true,
        revealed: false,
        message: "Today's fragment has not been revealed yet. Another message may still unlock it.",
        hasMessageOfTheDay: !!gameState.messageOfTheDay
      });
    }
  } catch (err) {
    console.error('Erreur /api/game/submit:', err);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    });
  }
}
