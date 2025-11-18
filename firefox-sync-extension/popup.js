document.addEventListener("DOMContentLoaded", () => {
  const browserNameInput = document.getElementById("browserName");
  const deviceNameInput = document.getElementById("deviceName");
  const profileNameInput = document.getElementById("profileName");
  const autoSyncEnabledInput = document.getElementById("autoSyncEnabled");
  const autoSyncIntervalInput = document.getElementById("autoSyncInterval");
  const saveBtn = document.getElementById("saveBtn");
  const statusEl = document.getElementById("status");

  // Load setting terakhir
  browser.storage.local
    .get([
      "browser_name",
      "device_name",
      "profile_name",
      "auto_sync_enabled",
      "auto_sync_interval"
    ])
    .then((data) => {
      browserNameInput.value = data.browser_name || "Firefox";
      deviceNameInput.value = data.device_name || "Laptop Lokal";
      profileNameInput.value = data.profile_name || "Default";
      autoSyncEnabledInput.checked = data.auto_sync_enabled ?? false;
      autoSyncIntervalInput.value = data.auto_sync_interval || 15;
    });

  saveBtn.addEventListener("click", async () => {
    const browser_name = (browserNameInput.value || "").trim() || "Firefox";
    const device_name = (deviceNameInput.value || "").trim() || "Laptop Lokal";
    const profile_name = (profileNameInput.value || "").trim() || "Default";
    const auto_sync_enabled = autoSyncEnabledInput.checked;

    let auto_sync_interval = parseInt(autoSyncIntervalInput.value, 10);
    if (isNaN(auto_sync_interval) || auto_sync_interval <= 0) {
      auto_sync_interval = 15;
    }

    statusEl.textContent = "Menyimpan & mulai sync...";

    await browser.storage.local.set({
      browser_name,
      device_name,
      profile_name,
      auto_sync_enabled,
      auto_sync_interval
    });

    // Beri tahu background untuk update alarm auto sync
    await browser.runtime.sendMessage({ type: "UPDATE_SETTINGS" });

    // Lalu minta sync sekali sekarang
    const response = await browser.runtime.sendMessage({
      type: "SYNC_BOOKMARKS",
      meta: { browser_name, device_name, profile_name }
    });

    if (!response) {
      statusEl.textContent = "Tidak ada response (cek background.js / console).";
      return;
    }
    if (response.ok) {
      const res = response.result;
      statusEl.textContent =
        `Berhasil. Inserted: ${res.inserted}, Updated: ${res.updated}`;
    } else {
      statusEl.textContent = "Error: " + response.error;
    }
  });
});
