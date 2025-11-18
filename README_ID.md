# 🌀 UniBrowse — Cross-Browser Personal Sync Tool

UniBrowse adalah **tools pribadi** untuk melakukan sinkronisasi data browser (bookmark, history, dll) dari berbagai browser seperti **Chrome** dan **Firefox**, lalu menyimpannya ke satu **backend FastAPI + SQLite** secara lokal.

Tools ini terdiri dari:

* **Backend API (FastAPI)** — penyimpanan & pengelolaan database.
* **Chrome/Chromium Extension** — pengambil data (grabber).
* **Firefox Extension** — pengambil data (grabber).
* Fitur:

  * Sync manual dari UI extension.
  * **Auto Sync** berdasarkan interval menit yang dapat diatur.
  * Menyimpan data bookmark lengkap:

    * title
    * url
    * folder_path
    * created_at
    * browser_name
    * device_name
    * profile_name

---

## ✨ Fitur Utama

* Sinkronisasi bookmark dari **Chrome / Edge / Brave / Opera** (Manifest V3)
* Sinkronisasi bookmark dari **Firefox** (WebExtension)
* Input **Browser Name**, **Device Name**, **Profile Name** dari UI extension
* Auto-sync tiap X menit (konfigurable)
* Backend sederhana dan cepat (FastAPI + SQLite)
* Semua data tetap **lokal** di komputer kamu
* Cocok untuk pengguna yang punya banyak browser / banyak device

---

# 📁 Struktur Project

```
unibrowse/
│
├─ backend/
│   └─ main.py          # FastAPI server + SQLite
│
├─ chrome-extension/
│   ├─ manifest.json
│   ├─ background.js
│   ├─ popup.html
│   └─ popup.js
│
└─ firefox-extension/
    ├─ manifest.json
    ├─ background.js
    ├─ popup.html
    └─ popup.js
```

---

# 🚀 Cara Menjalankan (How To)

Berikut langkah lengkap agar semuanya berjalan di lokal.

---

# 1. Backend — FastAPI + SQLite

### Install dependencies

```bash
cd backend
pip install fastapi uvicorn
```

### Jalankan server

```bash
python main.py
# atau
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Akses:

* Swagger Docs → [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
* Lihat data bookmark → [http://127.0.0.1:8000/api/bookmarks](http://127.0.0.1:8000/api/bookmarks)

---

# 2. Chrome / Edge / Brave Extension

### Cara Install

1. Buka Chrome → `chrome://extensions`
2. Aktifkan **Developer Mode**
3. Klik **Load Unpacked**
4. Pilih folder **chrome-extension/**

### Penggunaan

* Klik ikon extension
* Isi:

  * Browser Name
  * Device Name
  * Profile Name
* (Opsional) centang **Auto Sync** dan set interval
* Klik **Sync Now**

---

# 3. Firefox Extension

### Cara Install

1. Buka Firefox → `about:debugging#/runtime/this-firefox`
2. Klik **Load Temporary Add-on…**
3. Pilih `manifest.json` dari folder **firefox-extension/**

### Penggunaan

Sama seperti Chrome.

---

# 📝 API Endpoint

### POST /api/sync/bookmarks

Payload:

```json
{
  "browser_name": "Chrome",
  "device_name": "Laptop Rumah",
  "profile_name": "Default",
  "bookmarks": [
    {
      "title": "GitHub",
      "url": "https://github.com/",
      "folder_path": "Bookmarks Bar/Dev",
      "created_at": "2023-05-12T10:00:00Z"
    }
  ]
}
```

Response:

```json
{
  "status": "ok",
  "inserted": 50,
  "updated": 10,
  "browser_id": 1
}
```

---

# 📊 Database Schema (SQLite)

### Table: browsers

| field        | type   |
| ------------ | ------ |
| id           | int PK |
| name         | text   |
| device_name  | text   |
| profile_name | text   |

### Table: bookmarks

| field       | type   |
| ----------- | ------ |
| id          | int PK |
| browser_id  | FK     |
| title       | text   |
| url         | text   |
| folder_path | text   |
| created_at  | text   |
| updated_at  | text   |

---

# 🧩 Auto Sync Engine

Chrome: menggunakan `chrome.alarms`
Firefox: menggunakan `browser.alarms`

Interval sync disimpan di storage sehingga persistent.

---

# 🛠 Development Notes

### Ubah API URL

Jika backend berjalan di port lain:

```js
const API_URL = "http://localhost:5000/api/sync/bookmarks";
```

### Build extension

```bash
zip -r chrome-extension.zip chrome-extension/
zip -r firefox-extension.zip firefox-extension/
```

---

# ❤️ License

MIT
