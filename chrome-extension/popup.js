document.addEventListener("DOMContentLoaded", () => {
  const browserNameInput = document.getElementById("browserName");
  const deviceNameInput = document.getElementById("deviceName");
  const profileNameInput = document.getElementById("profileName");
  const authTokenInput = document.getElementById("authToken");
  const autoSyncEnabledInput = document.getElementById("autoSyncEnabled");
  const autoSyncIntervalInput = document.getElementById("autoSyncInterval");
  const saveBtn = document.getElementById("saveBtn");
  const statusEl = document.getElementById("status");

  // Load nilai terakhir dari storage
  chrome.storage.sync.get(
    [
      "browser_name",
      "device_name",
      "profile_name",
      "auth_token",
      "auto_sync_enabled",
      "auto_sync_interval"
    ],
    (data) => {
      browserNameInput.value = data.browser_name || "Chrome";
      deviceNameInput.value = data.device_name || "Laptop Lokal";
      profileNameInput.value = data.profile_name || "Default";
      authTokenInput.value = data.auth_token || "";
      autoSyncEnabledInput.checked = data.auto_sync_enabled ?? false;
      autoSyncIntervalInput.value = data.auto_sync_interval || 15;
    }
  );

  saveBtn.addEventListener("click", () => {
    const browser_name = browserNameInput.value.trim() || "Chrome";
    const device_name = deviceNameInput.value.trim() || "Laptop Lokal";
    const profile_name = profileNameInput.value.trim() || "Default";
    const auth_token = authTokenInput.value.trim();
    const auto_sync_enabled = autoSyncEnabledInput.checked;
    let auto_sync_interval = parseInt(autoSyncIntervalInput.value, 10);
    if (isNaN(auto_sync_interval) || auto_sync_interval <= 0) {
      auto_sync_interval = 15; // default 15 menit
    }

    statusEl.textContent = "Menyimpan & mulai sync...";

    // Simpan ke storage
    chrome.storage.sync.set(
      {
        browser_name,
        device_name,
        profile_name,
        auth_token,
        auto_sync_enabled,
        auto_sync_interval
      },
      () => {
        // Beritahu background untuk update alarm
        chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS" });

        // Lalu minta sync sekali sekarang
        chrome.runtime.sendMessage(
          {
            type: "SYNC_BOOKMARKS",
            meta: { browser_name, device_name, profile_name, auth_token }
          },
          (response) => {
            if (!response) {
              statusEl.textContent =
                "Tidak ada response (cek background.js / console).";
              return;
            }
            if (response.ok) {
              const res = response.result;
              statusEl.textContent =
                `Berhasil. Inserted: ${res.inserted}, Updated: ${res.updated}`;
            } else {
              statusEl.textContent = "Error: " + response.error;
            }
          }
        );
      }
    );
  });
});
