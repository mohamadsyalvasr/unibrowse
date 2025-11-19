from fastapi import FastAPI, Depends, HTTPException, Security
from fastapi.security.api_key import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import sqlite3
from datetime import datetime
import threading
import os

DB_PATH = "sync_browser.db"
AUTH_TOKENS_FILE = "auth_tokens.txt"
API_KEY_NAME = "X-Auth-Token"

api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)
db_lock = threading.Lock()

valid_tokens = set()

def load_tokens():
    global valid_tokens
    if os.path.exists(AUTH_TOKENS_FILE):
        with open(AUTH_TOKENS_FILE, "r") as f:
            tokens = [line.strip() for line in f if line.strip()]
            valid_tokens = set(tokens)
        print(f"Loaded {len(valid_tokens)} tokens.")
    else:
        print(f"Warning: {AUTH_TOKENS_FILE} not found. No tokens loaded.")

async def get_api_key(api_key_header: str = Security(api_key_header)):
    if api_key_header in valid_tokens:
        return api_key_header
    raise HTTPException(
        status_code=401,
        detail="Invalid or missing Authentication Token"
    )

def get_conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS browsers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                device_name TEXT NOT NULL,
                profile_name TEXT NOT NULL,
                UNIQUE(name, device_name, profile_name)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS bookmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                browser_id INTEGER NOT NULL,
                title TEXT,
                url TEXT NOT NULL,
                folder_path TEXT,
                created_at TEXT,
                updated_at TEXT,
                UNIQUE(browser_id, url, folder_path),
                FOREIGN KEY (browser_id) REFERENCES browsers(id)
            )
            """
        )
        conn.commit()

class BookmarkIn(BaseModel):
    title: Optional[str] = ""
    url: str
    folder_path: Optional[str] = ""
    created_at: Optional[str] = None

class SyncBookmarksPayload(BaseModel):
    browser_name: str
    device_name: str
    profile_name: str
    bookmarks: List[BookmarkIn]

app = FastAPI(title="Local Browser Sync")

# CORS biar bisa diakses dari extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # kalau mau lebih ketat nanti bisa dibatasi
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    init_db()
    load_tokens()

def get_or_create_browser_id(name: str, device_name: str, profile_name: str) -> int:
    with db_lock:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id FROM browsers 
            WHERE name = ? AND device_name = ? AND profile_name = ?
            """,
            (name, device_name, profile_name),
        )
        row = cur.fetchone()
        if row:
            return row["id"]
        cur.execute(
            """
            INSERT INTO browsers (name, device_name, profile_name)
            VALUES (?, ?, ?)
            """,
            (name, device_name, profile_name),
        )
        conn.commit()
        return cur.lastrowid

@app.post("/api/sync/bookmarks")
def sync_bookmarks(payload: SyncBookmarksPayload, token: str = Depends(get_api_key)):
    browser_id = get_or_create_browser_id(
        payload.browser_name,
        payload.device_name,
        payload.profile_name,
    )

    now = datetime.utcnow().isoformat()

    with db_lock:
        conn = get_conn()
        cur = conn.cursor()
        inserted = 0
        updated = 0

        for b in payload.bookmarks:
            cur.execute(
                """
                SELECT id FROM bookmarks
                WHERE browser_id = ? AND url = ? AND IFNULL(folder_path, '') = ?
                """,
                (browser_id, b.url, b.folder_path or ""),
            )
            row = cur.fetchone()
            if row:
                cur.execute(
                    """
                    UPDATE bookmarks
                    SET title = ?, created_at = COALESCE(?, created_at), updated_at = ?
                    WHERE id = ?
                    """,
                    (b.title, b.created_at, now, row["id"]),
                )
                updated += 1
            else:
                cur.execute(
                    """
                    INSERT INTO bookmarks (browser_id, title, url, folder_path, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        browser_id,
                        b.title,
                        b.url,
                        b.folder_path or "",
                        b.created_at,
                        now,
                    ),
                )
                inserted += 1

        conn.commit()

    return {
        "status": "ok",
        "inserted": inserted,
        "updated": updated,
        "browser_id": browser_id,
    }

@app.get("/api/bookmarks")
def list_bookmarks(token: str = Depends(get_api_key)):
    with db_lock:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT b.id, br.name as browser_name, br.device_name, br.profile_name,
                   b.title, b.url, b.folder_path, b.created_at, b.updated_at
            FROM bookmarks b
            JOIN browsers br ON br.id = b.browser_id
            ORDER BY b.updated_at DESC
            """
        )
        rows = cur.fetchall()
        return [dict(r) for r in rows]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
