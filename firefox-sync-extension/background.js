const API_URL = "http://127.0.0.1:8000";
const AUTO_SYNC_ALARM_NAME = "autoSyncBookmarks";
const DEFAULT_INTERVAL_MIN = 15;
const TOKEN_STORAGE_KEY = "auth_token";
const TOKEN_TIMESTAMP_KEY = "auth_token_timestamp";
const TOKEN_EXPIRY_DAYS = 7; // Refresh token weekly

// --- Token Management ---

async function getStoredToken() {
  const data = await browser.storage.local.get([TOKEN_STORAGE_KEY]);
  return data[TOKEN_STORAGE_KEY] || null;
}

async function saveToken(token) {
  await browser.storage.local.set({
    [TOKEN_STORAGE_KEY]: token,
    [TOKEN_TIMESTAMP_KEY]: Date.now()
  });
  console.log("✓ Token saved securely");
}

async function isTokenExpired() {
  const data = await browser.storage.local.get([TOKEN_TIMESTAMP_KEY]);
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

// --- Helper ambil bookmarks ---

async function collectBookmarks() {
  const tree = await browser.bookmarks.getTree();
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

// --- Sync ke backend ---

async function syncBookmarks(meta) {
  const bookmarks = await collectBookmarks();

  const payload = {
    browser_name: meta.browser_name || "Firefox",
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
        await browser.storage.local.remove([TOKEN_STORAGE_KEY]);
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

// --- Setup auto sync berdasarkan storage ---

async function setupAutoSyncFromStorage() {
  const data = await browser.storage.local.get([
    "auto_sync_enabled",
    "auto_sync_interval"
  ]);

  const enabled = data.auto_sync_enabled ?? false;
  let interval = parseInt(data.auto_sync_interval, 10);
  if (isNaN(interval) || interval <= 0) {
    interval = DEFAULT_INTERVAL_MIN;
  }

  if (!enabled) {
    console.log("Auto sync dimatikan, hapus alarm.");
    await browser.alarms.clear(AUTO_SYNC_ALARM_NAME);
    return;
  }

  await browser.alarms.create(AUTO_SYNC_ALARM_NAME, {
    periodInMinutes: interval
  });
  console.log(
    `Auto sync diaktifkan setiap ${interval} menit (alarm: ${AUTO_SYNC_ALARM_NAME}).`
  );
}

// --- Alarm handler: jalan tiap X menit ---

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTO_SYNC_ALARM_NAME) return;

  console.log("Alarm auto sync fired, mulai sync...");

  const data = await browser.storage.local.get([
    "browser_name",
    "device_name",
    "profile_name"
  ]);

  const meta = {
    browser_name: data.browser_name || "Firefox",
    device_name: data.device_name || "Laptop Lokal",
    profile_name: data.profile_name || "Default"
  };

  try {
    const result = await syncBookmarks(meta);
    console.log("Auto sync sukses:", result);
  } catch (err) {
    console.error("Auto sync gagal:", err);
  }
});

// --- Listener pesan dari popup ---

browser.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;

  if (message.type === "SYNC_BOOKMARKS") {
    const meta = message.meta || {};
    return syncBookmarks(meta)
      .then((result) => ({ ok: true, result }))
      .catch((err) => {
        console.error(err);
        return { ok: false, error: err.message };
      });
  }

  if (message.type === "UPDATE_SETTINGS") {
    return setupAutoSyncFromStorage().then(() => ({ ok: true }));
  }
});

// --- Inisialisasi saat di-install & browser start ---

browser.runtime.onInstalled.addListener(() => {
  setupAutoSyncFromStorage();
});

browser.runtime.onStartup.addListener(() => {
  setupAutoSyncFromStorage();
});
