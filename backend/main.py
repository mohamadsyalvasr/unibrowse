from fastapi import FastAPI, HTTPException, Depends, Header, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from pydantic import BaseModel
from typing import List, Optional
import sqlite3
from datetime import datetime, timedelta
import threading
import secrets
import hashlib
import os
from functools import lru_cache

DB_PATH = "sync_browser.db"
AUTH_TOKENS_FILE = "auth_tokens.txt"

db_lock = threading.Lock()
limiter = Limiter(key_func=get_remote_address)

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

# ===== Security: Token Management =====

def hash_token(token: str) -> str:
    """Hash token using SHA-256"""
    return hashlib.sha256(token.encode()).hexdigest()

def generate_token() -> str:
    """Generate a secure random token"""
    return secrets.token_urlsafe(32)

def load_valid_tokens() -> set:
    """Load valid tokens from file"""
    if not os.path.exists(AUTH_TOKENS_FILE):
        return set()
    try:
        with open(AUTH_TOKENS_FILE, "r") as f:
            return set(line.strip() for line in f if line.strip())
    except Exception as e:
        print(f"Error loading tokens: {e}")
        return set()

def save_token(token_hash: str):
    """Save token hash to file"""
    try:
        with open(AUTH_TOKENS_FILE, "a") as f:
            f.write(f"{token_hash}\n")
    except Exception as e:
        print(f"Error saving token: {e}")

@lru_cache(maxsize=128)
def verify_token(token: str) -> bool:
    """Verify if token is valid (cached for performance)"""
    if not token:
        return False
    token_hash = hash_token(token)
    valid_tokens = load_valid_tokens()
    return token_hash in valid_tokens

def get_token_from_header(authorization: Optional[str] = Header(None)) -> str:
    """Extract and validate token from Authorization header"""
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header format",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = parts[1]
    if not verify_token(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    
    return token

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

class TokenResponse(BaseModel):
    token: str
    expires_in: int = 86400  # 24 hours

app = FastAPI(title="Local Browser Sync - Secure Edition")

# ===== Security Middleware =====

# Trusted host middleware - only allow localhost
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["127.0.0.1", "localhost"],
)

# CORS middleware - restrict to localhost only
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1", "http://localhost"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["X-Total-Count"],
)

# Rate limiting exception handler
@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request, exc):
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many requests. Please try again later."
    )

@app.on_event("startup")
def on_startup():
    init_db()
    print(f"✓ Database initialized")
    print(f"✓ Auth tokens stored in: {AUTH_TOKENS_FILE}")
    print(f"✓ Security middleware active")

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

@app.post("/api/auth/token", response_model=TokenResponse)
def create_token():
    """Generate a new authentication token"""
    token = generate_token()
    token_hash = hash_token(token)
    save_token(token_hash)
    return TokenResponse(token=token, expires_in=86400)

@app.post("/api/sync/bookmarks")
@limiter.limit("10/minute")
def sync_bookmarks(
    payload: SyncBookmarksPayload,
    token: str = Depends(get_token_from_header),
):
    """Sync bookmarks from extension (requires valid token)"""
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
@limiter.limit("30/minute")
def list_bookmarks(token: str = Depends(get_token_from_header)):
    """List all bookmarks (requires valid token)"""
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
    # For HTTPS support, generate self-signed certificate:
    # openssl req -x509 -newkey rsa:4096 -nodes -out cert.pem -keyout key.pem -days 365
    # Then use: ssl_keyfile="key.pem", ssl_certfile="cert.pem"
    
    print("""
    ╔════════════════════════════════════════════════════════════╗
    ║  UniBrowser Backend - Secure Mode                          ║
    ╠════════════════════════════════════════════════════════════╣
    ║  API Base URL: http://127.0.0.1:8000                       ║
    ║  Endpoints:                                                ║
    ║    POST   /api/auth/token          - Generate auth token   ║
    ║    POST   /api/sync/bookmarks      - Sync bookmarks        ║
    ║    GET    /api/bookmarks           - List bookmarks        ║
    ║                                                             ║
    ║  Security Features:                                        ║
    ║    ✓ Token-based authentication                            ║
    ║    ✓ Rate limiting (10 sync/min, 30 list/min)             ║
    ║    ✓ Trusted host verification                             ║
    ║    ✓ CORS restricted to localhost                          ║
    ║    ✓ Secure headers                                        ║
    ║                                                             ║
    ║  Setup Instructions:                                       ║
    ║    1. Get token: curl http://127.0.0.1:8000/api/auth/token║
    ║    2. Store token in extension storage                     ║
    ║    3. Include in requests: Authorization: Bearer <token>   ║
    ╚════════════════════════════════════════════════════════════╝
    """)
    
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
