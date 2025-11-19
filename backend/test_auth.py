import urllib.request
import urllib.error
import json

BASE_URL = "http://127.0.0.1:8000/api"
VALID_TOKEN = "c8a72aeb957e004217433ec8c59636d0a193e7d8906aacedd543bdd13bd9c8aa"
INVALID_TOKEN = "invalid_token_123"

def make_request(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except urllib.error.URLError as e:
        return None, str(e)

def test_no_token():
    print("Test 1: Request without token...")
    status, _ = make_request(f"{BASE_URL}/bookmarks")
    if status == 403 or status == 401:
        print("PASS: Got expected 401/403")
    else:
        print(f"FAIL: Expected 401/403, got {status}")

def test_invalid_token():
    print("\nTest 2: Request with invalid token...")
    headers = {"X-Auth-Token": INVALID_TOKEN}
    status, _ = make_request(f"{BASE_URL}/bookmarks", headers)
    if status == 401:
        print("PASS: Got expected 401")
    else:
        print(f"FAIL: Expected 401, got {status}")

def test_valid_token():
    print("\nTest 3: Request with valid token...")
    headers = {"X-Auth-Token": VALID_TOKEN}
    status, body = make_request(f"{BASE_URL}/bookmarks", headers)
    if status == 200:
        print("PASS: Got expected 200")
    else:
        print(f"FAIL: Expected 200, got {status}")
        print(body)

if __name__ == "__main__":
    print("Running auth tests...")
    test_no_token()
    test_invalid_token()
    test_valid_token()
