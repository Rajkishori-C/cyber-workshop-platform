# CYBER DEFENSE ASSESSMENT PLATFORM (OFFLINE CTF)

A self-contained, 100% offline cybersecurity assessment platform designed specifically for college workshops, hackathons, and classroom labs.

Built to be **stress-free for organizers** and **crystal clear for freshers** with zero prior CTF experience.

---

## Key Highlights

- **100% Offline**: Zero external network calls, zero CDN links, zero Google Fonts. Everything runs locally on your laptop.
- **On-The-Spot Teams (Room Passcode)**: No tedious pre-registration. Write the **Room Passcode** (default: `WORKSHOP26`) on the whiteboard. Students form teams on the spot and enter their chosen name + the passcode.
- **Self-Contained Questions (Zero File Downloads)**: No firewall blocks, no broken downloads, and no phone file-system confusion. All ciphers, code, and logs are rendered directly on-screen in copyable code boxes.
- **Organizer Visual Question Customizer (`/admin`)**: Add, edit, or delete questions through a clean web form. Use the **Active / Hidden toggle** to control exactly which questions students see.
- **Demo Team Cleanup (`🗑️ Delete Team`)**: Practice or demonstrate beforehand, then delete dummy test teams with one click in the Admin panel before the real event starts.
- **Fullscreen Lock & Tab-Switch Anti-Cheat**: Clicking "Start Assessment" locks fullscreen. If a student leaves the tab, minimizes the window, or switches apps, a red warning pops up and the violation is logged live to the Organizer Dashboard.
- **Assessment Countdown Timer**: Configurable (default: 60 minutes). Starts individually when each team clicks "Start Assessment".
- **Dedicated Projector View (`/projector`)**: Live scoreboard with Top-3 podium (Gold, Silver, Bronze) and real-time solve ticker.
- **Emergency CSV Backup**: Instant export via `/api/export/csv` to safeguard results against power loss.

---

## Quick Start (Single Command)

### Launch the Server
- **Double-click** `run.bat` (Windows).
- Or run in PowerShell:
  ```powershell
  python server.py
  ```

On startup, your terminal displays:
```
====================================================================
  [+] Room Passcode: WORKSHOP26 (Share on Whiteboard)
  [+] Admin Portal:  http://localhost:5000/admin (Password: admin2026)
  [+] Projector:     http://localhost:5000/projector
--------------------------------------------------------------------
  >>> PARTICIPANT URL (Share on whiteboard / projector):
      -> http://192.168.137.1:5000
====================================================================
```

---

## Classroom Workflow (Step-by-Step)

### 1. Before Students Arrive (Test & Demo)
1. Launch `python server.py`.
2. Open `http://localhost:5000` on your browser.
3. Test joining as a dummy team (e.g. `Test_Demo` with room code `WORKSHOP26`).
4. Click **Start Assessment**, test answering Question 1 (Demo Flag: `CTF{welcome_to_cyber_workshop_2026}`).
5. Go to `http://localhost:5000/admin` (Password: `admin2026`).
6. In the **Teams & Demo Cleaner** tab, click **🗑️ Delete Team** next to `Test_Demo` to wipe your test score!

### 2. When Students Arrive
1. Write the URL and Room Code on the classroom whiteboard:
   ```
   Website: http://192.168.137.1:5000
   Room Passcode: WORKSHOP26
   ```
2. Students open the link on their laptops or phones.
3. They enter their Team Name (e.g. `Pod 4`) + the Room Passcode.
4. When you announce the start, everyone clicks **"Start Assessment"** (starts their 60-minute countdown and locks fullscreen).
5. Open `http://localhost:5000/projector` on the classroom projector screen to show live rankings.

---

## Managing Questions in Admin (`/admin`)

You can customize questions at `http://localhost:5000/admin`:
- **Toggle Active / Hidden**: Hide any question you don't want students to see with one click.
- **Edit Question**: Change points, question description, hint, or flag.
- **Add New Question**: Click `+ Add New Question` to create your own custom challenge.

---

## Pre-Loaded Self-Contained Questions

| # | Title | Category | Points | Self-Contained Task | Flag / Solution |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Demo: How Flags Work | Demo / Warmup | 50 | Walkthrough demo on screen | `CTF{welcome_to_cyber_workshop_2026}` |
| **2** | Inspect the Page Source | Web Security | 100 | Find comment in browser F12 Inspect | `CTF{h1dd3n_1n_th3_d0m_c0mm3nts}` |
| **3** | The Base64 Transmission | Cryptography & Ciphers | 100 | Decode on-screen Base64 string | `CTF{base64_decoding_is_easy}` |
| **4** | Caesar's Cipher (ROT-13) | Cryptography & Ciphers | 150 | Rotate on-screen ROT-13 text | `CTF{rot13_cipher_success_2026}` |
| **5** | Malicious Server Log | Linux & Commands | 100 | Inspect on-screen access log box | `CTF{grep_finds_the_needle_in_haystack}` |
| **6** | Binary Byte Stream | Cyber Logic | 150 | Translate on-screen 8-bit binary | `CTF{bits}` |

---

## Windows Firewall (If Students Cannot Connect)
If participants on mobile hotspot or local Wi-Fi cannot open the website, open PowerShell as Administrator and run:
```powershell
New-NetFirewallRule -DisplayName "CTF Workshop Server" -Direction Inbound -LocalPort 5000 -Protocol TCP -Action Allow -Profile Any
```
