import os
import base64
from PIL import Image, ImageDraw, ImageFont

OUTPUT_DIR = r"C:\Users\rajki\.gemini\antigravity\scratch\offline-ctf\challenge_files"
os.makedirs(OUTPUT_DIR, exist_ok=True)

print("[*] Generating physical challenge assets in:", OUTPUT_DIR)

# -------------------------------------------------------------
# 1. Steganography: stego_art.jpg
# -------------------------------------------------------------
stego_path = os.path.join(OUTPUT_DIR, "stego_art.jpg")
img = Image.new("RGB", (600, 400), color=(10, 15, 25))
draw = ImageDraw.Draw(img)

# Draw terminal/cyber grid lines
for y in range(0, 400, 25):
    draw.line([(0, y), (600, y)], fill=(18, 30, 48), width=1)
for x in range(0, 600, 25):
    draw.line([(x, 0), (x, 400)], fill=(18, 30, 48), width=1)

draw.rectangle([60, 60, 540, 340], outline=(0, 229, 255), width=2)
draw.text((80, 90), "[ SYSTEM DIAGNOSTICS: CLASSIFIED ]", fill=(0, 255, 102))
draw.text((80, 130), "NODE ID: CYBER-NODE-09", fill=(180, 200, 220))
draw.text((80, 160), "STATUS: TELEMETRY NORMAL", fill=(180, 200, 220))
draw.text((80, 190), "ENCRYPTION: AES-GCM-256 ENABLED", fill=(180, 200, 220))
draw.text((80, 230), "NOTICE: Nothing visible on screen.", fill=(255, 184, 0))
draw.text((80, 260), "Inspect the raw byte stream beneath the canvas...", fill=(100, 130, 160))

img.save(stego_path, "JPEG", quality=95)

# Append secret flag at EOF (trailer steganography)
secret_payload = b"\n\n--- CONFIDENTIAL ARCHIVE PAYLOAD ---\nFLAG: CTF{m0r3_th4n_m33ts_th3_3y3_7734}\nEOF\n"
with open(stego_path, "ab") as f:
    f.write(secret_payload)

print("[+] Created stego_art.jpg with appended EOF payload")

# -------------------------------------------------------------
# 2. Forensics: corrupted_photo.png (Damaged PNG Magic Bytes)
# -------------------------------------------------------------
corrupted_png_path = os.path.join(OUTPUT_DIR, "corrupted_photo.png")
png_img = Image.new("RGB", (500, 250), color=(15, 20, 32))
png_draw = ImageDraw.Draw(png_img)
png_draw.rectangle([20, 20, 480, 230], outline=(0, 255, 102), width=3)
png_draw.text((50, 60), "[+] HEADER REPAIR SUCCESSFUL!", fill=(0, 255, 102))
png_draw.text((50, 110), "FLAG: CTF{m4g1c_byt3s_r3st0r3d_9921}", fill=(0, 229, 255))
png_draw.text((50, 160), "You know your file signatures well.", fill=(200, 200, 200))

temp_valid_png = os.path.join(OUTPUT_DIR, "temp_valid.png")
png_img.save(temp_valid_png, "PNG")

with open(temp_valid_png, "rb") as f:
    valid_bytes = f.read()

# PNG Magic bytes are: 89 50 4E 47 0D 0A 1A 0A
# Corrupt the first 8 bytes with zero bytes (00 00 00 00 00 00 00 00)
corrupted_bytes = b"\x00\x00\x00\x00\x00\x00\x00\x00" + valid_bytes[8:]

with open(corrupted_png_path, "wb") as f:
    f.write(corrupted_bytes)

if os.path.exists(temp_valid_png):
    os.remove(temp_valid_png)

print("[+] Created corrupted_photo.png (damaged header waiting for hex repair)")

# -------------------------------------------------------------
# 3. Linux / CLI: server_access.log
# -------------------------------------------------------------
log_path = os.path.join(OUTPUT_DIR, "server_access.log")
flag_linux = "CTF{gr3p_c0mm4nd_m4st3r_2026}"
b64_flag = base64.b64encode(flag_linux.encode()).decode()

log_lines = []
endpoints = ["/index.html", "/about.html", "/login", "/static/style.css", "/api/v1/status", "/favicon.ico", "/images/logo.png"]
ips = ["192.168.1.42", "192.168.1.15", "10.0.0.8", "172.16.0.4", "192.168.1.99", "10.0.0.22"]

import random
random.seed(42)

for i in range(1, 550):
    ip = random.choice(ips)
    ep = random.choice(endpoints)
    code = random.choice([200, 200, 200, 304, 200, 404])
    size = random.randint(300, 8500)
    minute = (i // 10) % 60
    sec = (i * 3) % 60
    log_lines.append(f'{ip} - - [15/Sep/2026:10:{minute:02d}:{sec:02d} +0000] "GET {ep} HTTP/1.1" {code} {size} "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"')

# Inject the suspicious malicious line with command injection at line 380
malicious_line = (
    f'192.168.1.250 - - [15/Sep/2026:10:48:12 +0000] '
    f'"GET /cgi-bin/admin.sh?exec=echo+{b64_flag}+|+base64+-d HTTP/1.1" 200 482 "curl/7.68.0"'
)
log_lines.insert(380, malicious_line)

with open(log_path, "w", encoding="utf-8") as f:
    f.write("\n".join(log_lines) + "\n")

print(f"[+] Created server_access.log with 551 lines (injection at line 381)")

# -------------------------------------------------------------
# 4. Programming / Reverse Engineering: secret_vault.py
# -------------------------------------------------------------
vault_path = os.path.join(OUTPUT_DIR, "secret_vault.py")
target_flag = "CTF{r3v3rs3_x0r_k3y_9021}"
xor_key = 0x5A
encrypted_numbers = [ord(c) ^ xor_key for c in target_flag]

vault_code = f'''#!/usr/bin/env python3
"""
SECRET VAULT AUTHORIZATION PROTOCOL
Reverse engineer this script to discover the passkey!
Run it, inspect it, or write a quick solver.
"""

VAULT_HASH = {encrypted_numbers}

def verify_passkey(candidate: str) -> bool:
    if len(candidate) != len(VAULT_HASH):
        return False
    
    # Each character has been transformed through a bitwise operator with an unknown byte
    # Hint: Check what operator undoes XOR (Hint: XOR is its own inverse!)
    transformed = [ord(char) ^ 0x5A for char in candidate]
    return transformed == VAULT_HASH

if __name__ == "__main__":
    print("========================================")
    print("  CLASSIFIED FACILITY - ACCESS TERMINAL ")
    print("========================================")
    attempt = input("Enter Access Passkey: ").strip()
    
    if verify_passkey(attempt):
        print("\\n[+] ACCESS GRANTED! Flag accepted: " + attempt)
    else:
        print("\\n[-] ACCESS DENIED! Invalid passkey.")
'''

with open(vault_path, "w", encoding="utf-8") as f:
    f.write(vault_code)

print("[+] Created secret_vault.py")

# -------------------------------------------------------------
# 5. Encoding Multi-Layer: transmission.txt
# -------------------------------------------------------------
encoding_path = os.path.join(OUTPUT_DIR, "transmission.txt")
flag_encoding = "CTF{l4y3rs_0f_c0d1ng_unr4v3l3d}"

# Layer 1: ROT13
def rot13(s):
    res = []
    for c in s:
        if 'a' <= c <= 'z':
            res.append(chr((ord(c) - ord('a') + 13) % 26 + ord('a')))
        elif 'A' <= c <= 'Z':
            res.append(chr((ord(c) - ord('A') + 13) % 26 + ord('A')))
        else:
            res.append(c)
    return "".join(res)

l1 = rot13(flag_encoding)
# Layer 2: Base64
l2 = base64.b64encode(l1.encode()).decode()
# Layer 3: Hex
l3 = l2.encode().hex()

transmission_content = f"""INTERCEPTED SIGNAL TRANSMISSION
SOURCE: UNKNOWN SATELLITE
COORDINATES: CLASSIFIED
------------------------------------------------------------
THE TRANSMISSION HAS BEEN TRIPLE-ENCODED TO PREVENT INTERCEPTION.
ANALYSTS REPORT THREE LAYERS OF OBSCURATION:
1. HEXADECIMAL REPRESENTATION (OUTER)
2. BASE64 ENCODING (MIDDLE)
3. CAESAR CIPHER / ROT-13 (INNERMOST)

RAW PAYLOAD:
{l3}
------------------------------------------------------------
DECODE THE STREAM TO RECOVER THE ORIGINAL FLAG IN CTF{{...}} FORMAT.
"""

with open(encoding_path, "w", encoding="utf-8") as f:
    f.write(transmission_content)

print("[+] Created transmission.txt")
print("[*] All challenge assets successfully generated.")
