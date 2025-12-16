// api/game/unlock.js - Débloquer un fragment déjà révélé (après repost)

import { gameState, getTodayUTC, initializeDay, PRIVATE_KEY_CHARS } from './today.js';

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
    const { userId, tweetUrl } = req.body;

    if (!userId || !tweetUrl) {
      return res.status(400).json({ 
        error: 'Missing required fields: userId, tweetUrl' 
      });
    }

    // Initialiser le jour si nécessaire
    initializeDay();

    // Vérifier qu'il y a bien un message du jour révélé
    if (!gameState.messageOfTheDay) {
      return res.status(400).json({
        error: 'No fragment has been revealed today yet.'
      });
    }

    const motd = gameState.messageOfTheDay;

    console.log(`🔓 Déverrouillage demandé par userId=${userId}`);

    // Retourner le fragment
    return res.status(200).json({
      success: true,
      fragment: {
        index: motd.fragmentIndex,
        char: motd.fragmentChar
      },
      messageOfTheDay: {
        text: motd.text,
        revealedBy: motd.revealedBy,
        timestamp: motd.timestamp
      },
      message: "Fragment unlocked! This fragment is one character of a private key."
    });
  } catch (err) {
    console.error('Erreur /api/game/unlock:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}