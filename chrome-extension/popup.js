document.addEventListener("DOMContentLoaded", () => {
  const browserNameInput = document.getElementById("browserName");
  const deviceNameInput = document.getElementById("deviceName");
  const profileNameInput = document.getElementById("profileName");
  const saveBtn = document.getElementById("saveBtn");
  const statusEl = document.getElementById("status");

  // Load nilai terakhir dari storage
  chrome.storage.sync.get(
    ["browser_name", "device_name", "profile_name"],
    (data) => {
      browserNameInput.value = data.browser_name || "Chrome";
      deviceNameInput.value = data.device_name || "Laptop Lokal";
      profileNameInput.value = data.profile_name || "Default";
    }
  );

  saveBtn.addEventListener("click", () => {
    const browser_name = browserNameInput.value.trim() || "Chrome";
    const device_name = deviceNameInput.value.trim() || "Laptop Lokal";
    const profile_name = profileNameInput.value.trim() || "Default";

    statusEl.textContent = "Menyimpan & mulai sync...";

    // Simpan ke storage dulu
    chrome.storage.sync.set(
      { browser_name, device_name, profile_name },
      () => {
        // Setelah tersimpan, kirim pesan ke background untuk sync
        chrome.runtime.sendMessage(
          {
            type: "SYNC_BOOKMARKS",
            meta: { browser_name, device_name, profile_name }
          },
          (response) => {
            if (!response) {
              statusEl.textContent =
                "Tidak ada response (cek background.js / console).";
              return;
            }
            if (response.ok) {
              const res = response.result;
              statusEl.textContent = `Berhasil. Inserted: ${res.inserted}, Updated: ${res.updated}`;
            } else {
              statusEl.textContent = "Error: " + response.error;
            }
          }
        );
      }
    );
  });
});
