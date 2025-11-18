const API_URL = "http://127.0.0.1:8000/api/sync/bookmarks";
const AUTO_SYNC_ALARM_NAME = "autoSyncBookmarks";
const DEFAULT_INTERVAL_MIN = 15;

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
