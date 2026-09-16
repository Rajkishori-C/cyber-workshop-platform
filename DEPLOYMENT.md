# 🚀 DEPLOYMENT GUIDE: CYBER WORKSHOP (QUIZ + CTF PLATFORM)

This guide covers how to deploy the workshop platform either **online via a public URL** or **100% offline over local Wi-Fi / LAN**.

---

## 🌐 OPTION 1: 1-Click Deployment on Replit (Recommended for Online Use)

Replit provides a free public URL with instant setup:
1. Go to [https://replit.com](https://replit.com) and create a free account.
2. Click **"+ Create Repl"** and choose **"Import from GitHub"** or select **"Python"** template and drag-and-drop the project folder files.
3. In the Replit shell or `.replit` configuration, set the run command:
   ```bash
   python server.py
   ```
4. Click **"Run"**.
5. Replit will install the requirements from `requirements.txt` and provide a public `https://<your-repl-name>.replit.app` URL.
6. Share this URL with students on the projector screen along with the **Room Passcode** (default: `WORKSHOP26`).

---

## ⚡ OPTION 2: Free Cloud Web Service on Render

Render provides free HTTPS web services with automated GitHub deployment:
1. Push this folder to a GitHub repository.
2. Log in to [https://render.com](https://render.com) and click **"New +" -> "Web Service"**.
3. Select your GitHub repository.
4. Fill in the service configuration:
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python server.py`
5. Click **"Deploy Web Service"**.
6. Render will assign an HTTPS URL (e.g. `https://my-cyber-ctf.onrender.com`).
   *Note: `server.py` automatically reads the dynamic `$PORT` environment variable provided by Render.*

---

## 🟣 OPTION 3: Deployment on Heroku

The project includes a root `Procfile` (`web: python server.py`):
1. Install the Heroku CLI and login:
   ```bash
   heroku login
   ```
2. Create a Heroku application:
   ```bash
   heroku create workshop-ctf-2026
   ```
3. Deploy the application:
   ```bash
   git add .
   git commit -m "Deploy workshop platform"
   git push heroku main
   ```
4. Open the deployed application:
   ```bash
   heroku open
   ```

---

## 📡 OPTION 4: 100% Offline Local Wi-Fi / Classroom LAN (No Internet Required)

If your college venue has restricted internet or firewalls, run the platform completely offline:

1. **Connect the Organizer PC** to the classroom Wi-Fi or a Mobile Hotspot.
2. **Double-click `run.bat`** (or open PowerShell in the project directory and run):
   ```powershell
   python server.py
   ```
3. `server.py` will print your local network IP address, for example:
   ```
   ============================================================
   [*] MULTI-THREADED PRODUCTION SERVER ONLINE (Waitress WSGI)
   [*] LOCAL ACCESS:       http://127.0.0.1:5000
   [*] WI-FI / LAN ACCESS: http://192.168.1.45:5000
   [*] ORGANIZER PANEL:    http://127.0.0.1:5000/admin
   [*] PROJECTOR VIEW:     http://127.0.0.1:5000/projector
   ============================================================
   ```
4. Write `http://192.168.1.45:5000` on the whiteboard for students to connect from their laptops and smartphones!

---

## 🔒 ORGANIZER CREDENTIALS & SECURITY

- **Organizer Admin Panel**: Accessible at `/admin`
- **Default Admin Password**: `admin2026` *(Change in Admin -> Settings)*
- **Default Room Passcode**: `WORKSHOP26` *(Write on whiteboard to prevent unauthorized outside access)*
- **Projector View**: Accessible at `/projector` (Auto-refreshes every 4s, full-screen ready)

---

## 💾 DATA PERSISTENCE & BACKUP ADVICE

- SQLite (`ctf.db` with WAL mode) stores all registrations, quiz submissions, and CTF solves.
- **Before ending the event or shutting down your cloud instance**:
  Navigate to **Organizer Panel -> CSV Export & Audit** and click **"Download Workshop Results (CSV)"**.
  This gives you a complete offline spreadsheet record of all pod standings, timestamps, and answers.
