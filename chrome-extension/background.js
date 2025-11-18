const API_URL = "http://127.0.0.1:8000";
const AUTO_SYNC_ALARM_NAME = "autoSyncBookmarks";
const DEFAULT_INTERVAL_MIN = 15;
const TOKEN_STORAGE_KEY = "auth_token";
const TOKEN_TIMESTAMP_KEY = "auth_token_timestamp";
const TOKEN_EXPIRY_DAYS = 7; // Refresh token weekly

// ===== Token Management =====

async function getStoredToken() {
  const data = await chrome.storage.sync.get([TOKEN_STORAGE_KEY]);
  return data[TOKEN_STORAGE_KEY] || null;
}

async function saveToken(token) {
  await chrome.storage.sync.set({
    [TOKEN_STORAGE_KEY]: token,
    [TOKEN_TIMESTAMP_KEY]: Date.now()
  });
  console.log("✓ Token saved securely");
}

async function isTokenExpired() {
  const data = await chrome.storage.sync.get([TOKEN_TIMESTAMP_KEY]);
  if (!data[TOKEN_TIMESTAMP_KEY]) return true;
  
  const tokenAge = Date.now() - data[TOKEN_TIMESTAMP_KEY];
  const expiryMs = TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return tokenAge > expiryMs;
}

async function ensureValidToken() {
  let token = await getStoredToken();
  
  // Check if token exists and is not expired
  if (token && !(await isTokenExpired())) {
    return token;
  }
  
  // Request new token from backend
  try {
    console.log("Requesting new authentication token...");
    const resp = await fetch(`${API_URL}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    
    if (!resp.ok) {
      throw new Error(`Failed to get token: HTTP ${resp.status}`);
    }
    
    const data = await resp.json();
    await saveToken(data.token);
    console.log("✓ New token obtained");
    return data.token;
  } catch (err) {
    console.error("Token request failed:", err);
    throw new Error("Unable to obtain authentication token");
  }
}

async function collectBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const items = [];

  function traverse(nodes, path) {
    for (const node of nodes) {
      if (node.url) {
        items.push({
          title: node.title || "",
          url: node.url,
          folder_path: path,
          created_at: node.dateAdded
            ? new Date(node.dateAdded).toISOString()
            : null
        });
      } else {
        const folderName = node.title || "Folder";
        const newPath = path ? `${path}/${folderName}` : folderName;
        if (node.children) {
          traverse(node.children, newPath);
        }
      }
    }
  }

  traverse(tree, "");
  return items;
}

async function syncBookmarks(meta) {
  const bookmarks = await collectBookmarks();

  const payload = {
    browser_name: meta.browser_name || "Chrome",
    device_name: meta.device_name || "Laptop Lokal",
    profile_name: meta.profile_name || "Default",
    bookmarks
  };

  try {
    // Ensure we have a valid token
    const token = await ensureValidToken();

    const resp = await fetch(`${API_URL}/api/sync/bookmarks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const text = await resp.text();
      if (resp.status === 401) {
        // Token invalid, clear it and try again
        await chrome.storage.sync.remove([TOKEN_STORAGE_KEY]);
        throw new Error("Token expired, please retry");
      }
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    console.log("✓ Sync successful:", data);
    return data;
  } catch (err) {
    console.error("Sync failed:", err.message);
    throw err;
  }
}

// Atur alarm auto sync berdasarkan setting yang tersimpan
function setupAutoSyncFromStorage() {
  chrome.storage.sync.get(
    ["auto_sync_enabled", "auto_sync_interval"],
    (data) => {
      const enabled = data.auto_sync_enabled ?? false;
      let interval = parseInt(data.auto_sync_interval, 10);
      if (isNaN(interval) || interval <= 0) {
        interval = DEFAULT_INTERVAL_MIN;
      }

      if (!enabled) {
        console.log("Auto sync dimatikan, hapus alarm.");
        chrome.alarms.clear(AUTO_SYNC_ALARM_NAME);
        return;
      }

      chrome.alarms.create(AUTO_SYNC_ALARM_NAME, {
        periodInMinutes: interval
      });
      console.log(
        `Auto sync diaktifkan setiap ${interval} menit (alarm: ${AUTO_SYNC_ALARM_NAME}).`
      );
    }
  );
}

// Saat alarm berbunyi → auto sync
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_SYNC_ALARM_NAME) {
    console.log("Alarm auto sync fired, mulai sync...");

    chrome.storage.sync.get(
      ["browser_name", "device_name", "profile_name"],
      (data) => {
        const meta = {
          browser_name: data.browser_name || "Chrome",
          device_name: data.device_name || "Laptop Lokal",
          profile_name: data.profile_name || "Default"
        };

        syncBookmarks(meta)
          .then((result) => {
            console.log("Auto sync sukses:", result);
          })
          .catch((err) => {
            console.error("Auto sync gagal:", err);
          });
      }
    );
  }
});

// Listener pesan dari popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "SYNC_BOOKMARKS") {
    const meta = message.meta || {};
    syncBookmarks(meta)
      .then((result) => {
        sendResponse({ ok: true, result });
      })
      .catch((err) => {
        console.error(err);
        sendResponse({ ok: false, error: err.message });
      });
    return true; // async
  }

  if (message.type === "UPDATE_SETTINGS") {
    setupAutoSyncFromStorage();
    sendResponse({ ok: true });
    return; // sync response ok
  }
});

// Inisialisasi saat extension di-install atau browser start
chrome.runtime.onInstalled.addListener(() => {
  setupAutoSyncFromStorage();
});

chrome.runtime.onStartup.addListener(() => {
  setupAutoSyncFromStorage();
});
