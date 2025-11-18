const API_URL = "http://127.0.0.1:8000/api/sync/bookmarks";

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

// Listener pesan dari popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "SYNC_BOOKMARKS") {
    const meta = message.meta || {};
    syncBookmarks(meta)
      .then((result) => {
        sendResponse({ ok: true, result });
      })
      .catch((err) => {
        console.error(err);
        sendResponse({ ok: false, error: err.message });
      });

    return true; // async response
  }
});
