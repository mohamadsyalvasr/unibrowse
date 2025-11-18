const API_URL = "http://127.0.0.1:8000/api/sync/bookmarks";
const AUTO_SYNC_ALARM_NAME = "autoSyncBookmarks";
const DEFAULT_INTERVAL_MIN = 15;

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

  const resp = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  console.log("Sync result:", data);
  return data;
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
