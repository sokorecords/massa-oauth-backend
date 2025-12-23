// script.js – Version finale avec tous les scénarios

const CLIENT_ID = "SHFXVndGU2ZBRk1GbzlpWlFJR1Q6MTpjaQ";
const REDIRECT_URI = window.location.origin; 
const BACKEND_BASE = "https://massa-oauth-backend.vercel.app";

let userData = {
  clues: Array(53).fill(null),
  username: "",
  avatar: "",
  streak: 0
};

let currentState = {
  messageText: "",
  messageId: null,
  userStatus: null,
  pioneer: null
};

let isLoadingState = false; // Flag pour savoir si on charge l'état initial

// --- UTILS ---
function manualBase64UrlEncode(buffer) {
  const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  let i = 0;
  while (i < len) {
    const chr1 = bytes[i++];
    const chr2 = i < len ? bytes[i++] : NaN;
    const chr3 = i < len ? bytes[i++] : NaN;
    const enc1 = chr1 >> 2;
    const enc2 = ((chr1 & 3) << 4) | (isNaN(chr2) ? 0 : chr2 >> 4);
    const enc3 = isNaN(chr2) ? 64 : ((chr2 & 15) << 2) | (isNaN(chr3) ? 0 : chr3 >> 6);
    const enc4 = isNaN(chr3) ? 64 : chr3 & 63;
    output += base64Chars.charAt(enc1) + base64Chars.charAt(enc2);
    if (enc3 < 64) output += base64Chars.charAt(enc3);
    if (enc4 < 64) output += base64Chars.charAt(enc4);
  }
  return output;
}

// --- INIT ---
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOMContentLoaded fired");
  const currentUrl = window.location.href;

  if (currentUrl.indexOf('code=') > -1) {
    if (window.opener) {
      window.opener.postMessage({ type: 'oauth_redirect', url: currentUrl }, window.location.origin);
      window.close();
      return;
    } else {
      handleOAuthCallback(currentUrl);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.origin === window.location.origin && event.data.type === 'oauth_redirect') {
      handleOAuthCallback(event.data.url);
    }
  });

  const saved = localStorage.getItem("smq_user");
  console.log("LocalStorage content:", saved);
  
  if (saved) {
    try {
      userData = JSON.parse(saved);
      console.log("Parsed userData:", userData);
      
      if (userData.username) {
        console.log("Username found, calling showConnectedUI");
        showConnectedUI();
        fetchUserCollection();
      } else {
        console.log("No username in userData");
      }
    } catch(e) {
      console.error("Error parsing localStorage:", e);
      localStorage.removeItem("smq_user");
    }
  } else {
    console.log("No saved data in localStorage");
  }

  setupEventListeners();
  buildPeriodicTable();
});

// --- AUTH ---
async function loginWithX() {
  const state = Math.random().toString(36).substring(2, 15);
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const verifier = manualBase64UrlEncode(array.buffer);
  
  localStorage.setItem("x_oauth_state", state);
  localStorage.setItem("x_code_verifier", verifier);

  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const challenge = manualBase64UrlEncode(digest);

  const authUrl = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=tweet.read%20users.read%20offline.access&state=${state}&code_challenge=${challenge}&code_challenge_method=S256&force_login=true`;

  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
    window.location.href = authUrl;
  } else {
    window.open(authUrl, "x_login", "width=600,height=700");
  }
}

async function handleOAuthCallback(urlStr) {
  const url = new URL(urlStr);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = localStorage.getItem("x_oauth_state");
  const verifier = localStorage.getItem("x_code_verifier");

  if (!code || state !== savedState) return;

  try {
    const tokenRes = await fetch(`${BACKEND_BASE}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: REDIRECT_URI, code_verifier: verifier })
    });
    
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return;

    const profRes = await fetch(`${BACKEND_BASE}/api/user/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: tokenData.access_token })
    });
    
    const profData = await profRes.json();
    const user = profData.data || profData;
    
    if (!user.username && !user.screen_name) return;

    userData.username = user.username || user.screen_name;
    const rawAvatar = user.profile_image_url || "";
    userData.avatar = rawAvatar ? rawAvatar.replace("_normal", "") : "";
    
    localStorage.setItem("smq_user", JSON.stringify(userData));
    window.history.replaceState({}, document.title, "/");
    showConnectedUI();
    fetchUserCollection();
    
    localStorage.removeItem("x_oauth_state");
    localStorage.removeItem("x_code_verifier");
  } catch (err) { 
    console.error("Auth error:", err);
  }
}

// --- GAME LOGIC ---

async function generateTruth() {
    if (!userData.username) {
        alert("Please connect with X first");
        return;
    }
    
    const btn = document.getElementById("generateBtn");
    if (btn) btn.disabled = true;
    
    try {
        const res = await fetch(`${BACKEND_BASE}/api/game/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: userData.username })
        });
        const data = await res.json();
        
        currentState.messageText = data.text;
        currentState.messageId = data.messageId;
        currentState.userStatus = data.userStatus;
        currentState.pioneer = data.pioneer;
        
        if (data.streak) {
            userData.streak = data.streak;
            localStorage.setItem("smq_user", JSON.stringify(userData));
            updateStreakDisplay();
        }
        
        displayGameState(data);
    } catch (err) { 
        console.error(err);
        alert("Error generating message");
    }
    
    if (btn) btn.disabled = false;
}

// Fonction pour vérifier l'état au chargement (reconnexion)
async function checkUserStateOnLoad() {
    console.log("checkUserStateOnLoad called, username:", userData.username);
    if (!userData.username) return;
    
    isLoadingState = true;
    
    try {
        console.log("Checking game state without generating...");
        const res = await fetch(`${BACKEND_BASE}/api/game/check-status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: userData.username })
        });
        const data = await res.json();
        console.log("Game state received:", data);
        
        // Si pas de statut, ne rien afficher (attendre que l'user clique sur Generate)
        if (data.status === "NO_STATUS") {
            console.log("No status yet, waiting for user to generate");
            return;
        }
        
        currentState.messageText = data.text;
        currentState.messageId = data.messageId;
        currentState.userStatus = data.userStatus;
        currentState.pioneer = data.pioneer;
        
        console.log("User status:", data.userStatus);
        console.log("Calling displayGameState...");
        
        // Afficher l'état approprié au chargement
        displayGameState(data);
        
    } catch (err) {
        console.error("Error checking state:", err);
    } finally {
        isLoadingState = false;
    }
}

function displayGameState(data) {
    console.log("displayGameState called with:", data);
    
    const gameContainer = document.getElementById("gameContainer");
    const generationArea = document.getElementById("generationArea");
    const postCard = document.getElementById("postCard");
    const postText = document.getElementById("postText");
    const submitArea = document.getElementById("submitArea");
    const unlockArea = document.getElementById("unlockArea");
    const gameFeedback = document.getElementById("gameFeedback");
    const tweetUrlInput = document.getElementById("tweetUrl");
    const generateBtn = document.getElementById("generateBtn");
    
    // Fonction helper pour créer/mettre à jour le message de statut
    function showStatusMessage(html, popupMessage = null) {
        console.log("showStatusMessage called");
        // Masquer les zones de jeu
        if (generationArea) generationArea.style.display = "none";
        if (postCard) postCard.style.display = "none";
        
        // Pop-up si demandé ET si pas en chargement initial
        if (popupMessage && !isLoadingState) {
            alert(popupMessage);
        } else if (popupMessage && isLoadingState) {
            // À la reconnexion, afficher la pop-up
            alert(popupMessage);
        }
        
        // Créer ou mettre à jour le message de statut
        let statusDiv = document.getElementById("statusMessage");
        if (!statusDiv) {
            statusDiv = document.createElement("div");
            statusDiv.id = "statusMessage";
            gameContainer.appendChild(statusDiv);
        }
        statusDiv.innerHTML = html;
        statusDiv.style.display = "block";
    }
    
    // Fonction helper pour afficher la zone de jeu normale
    function showGameArea() {
        console.log("showGameArea called");
        const statusDiv = document.getElementById("statusMessage");
        if (statusDiv) statusDiv.style.display = "none";
        
        if (generationArea) generationArea.style.display = "block";
        if (postCard) {
            postCard.style.display = "block";
            postCard.classList.remove("hidden");
        }
    }
    
    // ========== SCÉNARIO 1: Déjà récupéré (Pioneer ou Follower) ==========
    if (data.userStatus?.claimStatus === "pioneer" || data.userStatus?.claimStatus === "follower") {
        console.log("Scenario: Fragment already claimed");
        const statusHtml = `
            <div style="background: #d1fae5; padding: 2rem; border-radius: 12px; text-align: center; max-width: 600px; margin: 2rem auto; border: 2px solid #10b981;">
                <h3 style="color: #10b981; margin-bottom: 1rem; font-size: 1.5rem;">✅ Fragment Claimed!</h3>
                <p style="color: #059669; font-size: 1.1rem; line-height: 1.6;">
                    You have already claimed your fragment for today.<br>
                    Come back tomorrow for a new challenge!
                </p>
            </div>
        `;
        
        const popupMsg = "✅ You have already claimed your fragment for today. Come back tomorrow!";
        showStatusMessage(statusHtml, popupMsg);
        
        if (generateBtn) {
            generateBtn.textContent = "Truth Already Generated";
            generateBtn.disabled = true;
        }
        return;
    }
    
    // ========== SCÉNARIO 2A: Soumis sans succès - Pionnier pas encore révélé ==========
    if (data.userStatus?.submitted && !data.pioneer) {
        console.log("Scenario: Submitted but not found, no pioneer yet");
        const statusHtml = `
            <div style="background: #f1f5f9; padding: 2rem; border-radius: 12px; text-align: center; max-width: 600px; margin: 2rem auto; border: 2px solid #64748b;">
                <h3 style="color: #64748b; margin-bottom: 1rem; font-size: 1.5rem;">⏳ Fragment Pending</h3>
                <p style="color: #475569; font-size: 1.05rem; line-height: 1.8;">
                    Today's fragment remains hidden.<br><br>
                    Keep an eye on the <strong>MassArmy Telegram</strong> – another pioneer might reveal it soon!<br><br>
                    If someone finds it, come back here to repost their message and unlock the fragment for yourself.
                </p>
            </div>
        `;
        
        const popupMsg = "⏳ Today's fragment remains hidden. Keep an eye on the MassArmy Telegram – another pioneer might reveal it soon!";
        showStatusMessage(statusHtml, popupMsg);
        
        if (generateBtn) {
            generateBtn.textContent = "Truth Already Generated";
            generateBtn.disabled = true;
        }
        return;
    }
    
    // ========== SCÉNARIO 2B: Soumis sans succès - MAIS pionnier a révélé ==========
    if (data.userStatus?.submitted && data.pioneer) {
        console.log("Scenario: Submitted but pioneer found");
        // Masquer la génération mais GARDER postCard pour unlockArea
        if (generationArea) generationArea.style.display = "none";
        const statusDiv = document.getElementById("statusMessage");
        if (statusDiv) statusDiv.style.display = "none";
        
        if (postText) postText.textContent = data.text;
        if (postCard) {
            postCard.style.display = "block";
            postCard.classList.remove("hidden");
        }
        if (submitArea) submitArea.style.display = "none";
        
        showRepostInterface(data.pioneer);
        
        if (generateBtn) {
            generateBtn.textContent = "Truth Already Generated";
            generateBtn.disabled = true;
        }
        
        const popupMsg = `🎉 Today's fragment has been discovered by @${data.pioneer.username}! Repost their message to unlock it for yourself.`;
        if (isLoadingState) {
            alert(popupMsg);
        } else if (!isLoadingState) {
            alert(popupMsg);
        }
        return;
    }
    
    // ========== SCÉNARIO 3: Première génération mais pionnier existe déjà ==========
    if (data.pioneer && data.status === "ALREADY_GENERATED") {
        console.log("Scenario: Already generated but pioneer exists");
        showGameArea();
        
        if (postText) postText.textContent = data.text;
        if (submitArea) submitArea.style.display = "block";
        if (unlockArea) unlockArea.classList.add("hidden");
        if (tweetUrlInput) tweetUrlInput.value = "";
        
        if (gameFeedback) {
            gameFeedback.textContent = "Share this message on X, then paste your post link below.";
            gameFeedback.style.color = "#3b82f6";
        }
        if (generateBtn) {
            generateBtn.textContent = "Truth Already Generated";
            generateBtn.disabled = true;
        }
        
        if (!isLoadingState) {
            alert(`Today's fragment was already discovered by @${data.pioneer.username}. Share your generated message first, then you'll be able to repost the winning message.`);
        }
        return;
    }
    
    // ========== SCÉNARIO 4: Nouvelle génération normale ==========
    console.log("Scenario: Normal generation");
    showGameArea();
    
    if (postText) postText.textContent = data.text;
    if (submitArea) submitArea.style.display = "block";
    if (unlockArea) unlockArea.classList.add("hidden");
    if (tweetUrlInput) tweetUrlInput.value = "";
    
    if (gameFeedback) {
        gameFeedback.textContent = "Share this message on X, then paste your post link below to check for today's fragment.";
        gameFeedback.style.color = "#3b82f6";
    }
    
    if (generateBtn && data.status === "ALREADY_GENERATED") {
        generateBtn.textContent = "Truth Already Generated";
        generateBtn.disabled = true;
    }
}

function showRepostInterface(pioneer) {
    const unlockArea = document.getElementById("unlockArea");
    const pioneerUser = document.getElementById("pioneerUser");
    const pioneerLink = document.getElementById("pioneerLink");
    const gameFeedback = document.getElementById("gameFeedback");
    const submitArea = document.getElementById("submitArea");
    const repostUrlInput = document.getElementById("repostUrl");
    const shareBtn = document.getElementById("shareBtn");
    
    if (unlockArea) unlockArea.classList.remove("hidden");
    if (pioneerUser) pioneerUser.textContent = pioneer.username;
    if (pioneerLink) {
        pioneerLink.href = pioneer.url;
        pioneerLink.textContent = "View Pioneer's Post";
    }
    
    // Masquer complètement la zone de soumission du premier post
    if (submitArea) submitArea.style.display = "none";
    
    // Désactiver le bouton de partage
    if (shareBtn) {
        shareBtn.textContent = "✅ Post Shared";
        shareBtn.disabled = true;
        shareBtn.style.opacity = "0.6";
    }
    
    // Réinitialiser le champ de saisie pour le repost
    if (repostUrlInput) {
        repostUrlInput.value = "";
    }
    
    if (gameFeedback) {
        gameFeedback.innerHTML = `
            <div style="text-align: left; line-height: 1.8; margin-bottom: 1.5rem;">
                <strong style="color: #f59e0b; font-size: 1.2rem;">🎉 Today's fragment has been discovered!</strong><br><br>
                <strong>📋 How to unlock it for yourself:</strong><br>
                1️⃣ Click "View Pioneer's Post" below<br>
                2️⃣ Repost their message on X<br>
                3️⃣ Go to YOUR profile and copy the link of YOUR repost<br>
                4️⃣ Paste it in the field below and click "I have reposted"
            </div>
        `;
        gameFeedback.style.color = "#f59e0b";
        gameFeedback.style.background = "#fffbeb";
        gameFeedback.style.padding = "1.5rem";
        gameFeedback.style.borderRadius = "8px";
        gameFeedback.style.border = "2px solid #fbbf24";
    }
}

function shareOnX() {
    if (!currentState.messageText) {
        alert("Please generate a message first");
        return;
    }
    
    const tweetText = encodeURIComponent(currentState.messageText);
    const shareUrl = `https://twitter.com/intent/tweet?text=${tweetText}`;
    
    const width = 550;
    const height = 420;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;
    
    window.open(shareUrl, 'share_twitter', `width=${width},height=${height},left=${left},top=${top}`);
}

async function submitTweet() {
    const tweetUrl = document.getElementById("tweetUrl")?.value.trim();
    if (!tweetUrl) {
        alert("Please paste your tweet link");
        return;
    }
    
    if (!tweetUrl.includes("x.com") && !tweetUrl.includes("twitter.com")) {
        alert("Please enter a valid X/Twitter link");
        return;
    }
    
    const btn = document.getElementById("submitBtn");
    if (btn) btn.disabled = true;
    
    try {
        const res = await fetch(`${BACKEND_BASE}/api/game/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                username: userData.username, 
                tweetUrl,
                isRepost: false
            })
        });
        const data = await res.json();
        handleSubmitResponse(data);
    } catch (err) { 
        console.error(err);
        alert("Error during verification");
    }
    
    if (btn) btn.disabled = false;
}

async function unlockFragment() {
    const tweetUrl = document.getElementById("repostUrl")?.value.trim();
    if (!tweetUrl) {
        alert("Please paste your repost link");
        return;
    }
    
    const btn = document.getElementById("unlockBtn");
    if (btn) btn.disabled = true;
    
    try {
        const res = await fetch(`${BACKEND_BASE}/api/game/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                username: userData.username, 
                tweetUrl,
                isRepost: true
            })
        });
        const data = await res.json();
        handleSubmitResponse(data);
    } catch (err) { 
        console.error(err);
        alert("Error unlocking fragment");
    }
    
    if (btn) btn.disabled = false;
}

function handleSubmitResponse(data) {
    const feedback = document.getElementById("gameFeedback");
    const submitArea = document.getElementById("submitArea");
    const shareBtn = document.getElementById("shareBtn");
    
    if (data.status === "PIONEER") {
        if (feedback) {
            feedback.textContent = "BINGO! You revealed today's fragment. The community thanks you, Pioneer. A new character has been added to your table.";
            feedback.style.color = "#10b981";
            feedback.style.fontWeight = "bold";
        }
        alert("BINGO! You revealed today's fragment. The community thanks you, Pioneer.");
        fetchUserCollection();
        if (submitArea) submitArea.style.display = "none";
        if (shareBtn) {
            shareBtn.textContent = "You already shared your daily post";
            shareBtn.disabled = true;
        }
    } 
    else if (data.status === "FOLLOWER_SUCCESS") {
        if (feedback) {
            feedback.textContent = "Fragment unlocked! A new character has been added to your table.";
            feedback.style.color = "#10b981";
            feedback.style.fontWeight = "bold";
        }
        alert("Fragment unlocked! A new character has been added to your table.");
        fetchUserCollection();
        document.getElementById("unlockArea")?.classList.add("hidden");
    }
    else if (data.status === "PIONEER_EXISTS") {
        showRepostInterface(data.pioneer);
        alert(`Today's fragment was already discovered by @${data.pioneer.username}. Repost their message to unlock it.`);
    }
    else if (data.status === "NOT_FOUND") {
        if (feedback) {
            feedback.textContent = data.message;
            feedback.style.color = "#64748b";
        }
        alert("Today's fragment remains hidden. Keep an eye on the MassArmy Telegram – another pioneer might reveal it soon! If someone finds it, come back here to repost their message and unlock the fragment for yourself.");
        if (submitArea) submitArea.style.display = "none";
        if (shareBtn) {
            shareBtn.textContent = "You already shared your daily post";
            shareBtn.disabled = true;
        }
    }
    else if (data.status === "ALREADY_CLAIMED") {
        if (feedback) {
            feedback.textContent = data.message;
            feedback.style.color = "#10b981";
        }
        alert(data.message);
    }
    else if (data.error) {
        alert(data.error);
    }
}

async function fetchUserCollection() {
    if (!userData.username) return;
    
    try {
        const res = await fetch(`${BACKEND_BASE}/api/user/collection/${userData.username}`);
        const data = await res.json();
        
        if (data.collection) {
            userData.clues = Array(53).fill(null);
            data.collection.forEach(item => {
                const [idx, char] = item.split(':');
                userData.clues[parseInt(idx)] = char;
            });
            localStorage.setItem("smq_user", JSON.stringify(userData));
            buildPeriodicTable();
            updateCluesCount();
        }
    } catch (err) { 
        console.error(err);
    }
}

async function fetchUserStreak() {
    if (!userData.username) return;
    
    try {
        const res = await fetch(`${BACKEND_BASE}/api/user/streak/${userData.username}`);
        const data = await res.json();
        
        if (data.streak) {
            userData.streak = data.streak;
            localStorage.setItem("smq_user", JSON.stringify(userData));
            updateStreakDisplay();
        }
    } catch (err) {
        console.error(err);
    }
}

// --- UI ---

function showConnectedUI() {
    console.log("showConnectedUI called");
    document.getElementById("authSection")?.classList.add("hidden");
    document.getElementById("connectedInfo")?.classList.remove("hidden");
    document.getElementById("gameContainer")?.classList.remove("hidden");
    
    const userDisplay = document.getElementById("username");
    if (userDisplay) userDisplay.textContent = "@" + userData.username;
    
    const avatarDisplay = document.getElementById("userAvatar");
    if (avatarDisplay && userData.avatar) {
        avatarDisplay.src = userData.avatar;
        avatarDisplay.onerror = () => {
            avatarDisplay.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect fill='%23ddd' width='40' height='40'/%3E%3C/svg%3E";
        };
    }
    
    fetchUserStreak();
    
    console.log("About to call checkUserStateOnLoad");
    // Vérifier l'état de l'utilisateur à la reconnexion
    setTimeout(() => {
        checkUserStateOnLoad();
    }, 500); // Petit délai pour être sûr que le DOM est prêt
}

function buildPeriodicTable() {
  const table = document.getElementById("periodicTable");
  if (!table) return;
  
  table.innerHTML = "";
  for (let i = 0; i < 53; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.textContent = userData.clues[i] || "?";
    if (userData.clues[i]) cell.classList.add("unlocked");
    table.appendChild(cell);
  }
}

function updateCluesCount() {
    const count = userData.clues.filter(c => c !== null).length;
    const countEl = document.getElementById("cluesCount");
    if (countEl) countEl.textContent = count;
}

function updateStreakDisplay() {
    const streakLine = document.getElementById("streakLine");
    const streakEl = document.getElementById("streak");
    
    if (streakLine && streakEl && userData.streak > 0) {
        streakEl.textContent = userData.streak;
        streakLine.classList.remove("hidden");
    }
}

function setupEventListeners() {
    document.getElementById("loginBtn")?.addEventListener("click", loginWithX);
    
    document.getElementById("logoutBtn")?.addEventListener("click", () => {
        if (confirm("Are you sure you want to logout?")) {
            localStorage.clear();
            location.reload();
        }
    });
    
    document.querySelectorAll("#generateBtn").forEach(btn => {
        btn.addEventListener("click", generateTruth);
    });
    
    document.getElementById("shareBtn")?.addEventListener("click", shareOnX);
    document.getElementById("submitBtn")?.addEventListener("click", submitTweet);
    document.getElementById("unlockBtn")?.addEventListener("click", unlockFragment);
}
