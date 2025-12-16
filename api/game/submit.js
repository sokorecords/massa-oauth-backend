// api/game/submit.js - Soumettre un post X et vérifier si un fragment est révélé

// Import du state partagé
import { gameState, getTodayUTC, initializeDay, PRIVATE_KEY_CHARS } from './today.js';

// Liste des 150 phrases
const MASSA_TRUTHS = [
  "Massa produces parallel blocks through Blockclique, moving away from linear blockchain limits. This enables true concurrency while preserving decentralization.",
  "On Massa, smart contracts are autonomous and can schedule actions directly on-chain. Applications no longer depend on bots or external servers to function.",
  // ... (toutes les 150 phrases - je les abrège ici pour la lisibilité)
  "Massa builds a web that is stable, sovereign, and unstoppable. Autonomy becomes the core of the digital world."
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

    if (!messageId || !tweetUrl || !userId) {
      return res.status(400).json({ 
        error: 'Missing required fields: messageId, tweetUrl, userId' 
      });
    }

    // Initialiser le jour si nécessaire
    initializeDay();

    console.log(`📥 Soumission reçue: messageId=${messageId}, userId=${userId}`);

    // Vérifier si ce messageId correspond à un fragment actif
    const fragmentIndex = gameState.activeFragments.find(idx => {
      // Logique: le messageId correspond à l'index de la phrase
      // On peut assigner aléatoirement ou selon une règle
      // Pour simplifier: chaque phrase peut révéler un fragment spécifique
      return idx === messageId; // Simple mapping 1:1 pour commencer
    });

    if (fragmentIndex !== undefined) {
      // 🎉 FRAGMENT RÉVÉLÉ !
      const fragmentChar = PRIVATE_KEY_CHARS[fragmentIndex];
      
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
        text: MASSA_TRUTHS[messageId],
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

      console.log(`✅ Fragment révélé ! Index: ${fragmentIndex}, Char: ${fragmentChar}`);

      return res.status(200).json({
        success: true,
        revealed: true,
        fragment: {
          index: fragmentIndex,
          char: fragmentChar
        },
        message: "Fragment revealed! You found today's fragment."
      });
    } else {
      // Pas de fragment révélé
      // Incrémenter le carry-over si aucun fragment n'a été révélé aujourd'hui
      if (!gameState.messageOfTheDay) {
        gameState.carryOverCount = gameState.activeFragments.length;
      }

      console.log(`❌ Pas de fragment pour messageId=${messageId}`);

      return res.status(200).json({
        success: true,
        revealed: false,
        message: "Today's fragment has not been revealed yet. Another message may still unlock it."
      });
    }
  } catch (err) {
    console.error('Erreur /api/game/submit:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
