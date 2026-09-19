"""
One-Click Live Workshop Launcher (Antigravity & Cloudflare)
Launches the local Waitress WSGI server (port 5000) and exposes it via
a secure Cloudflare Tunnel to the internet for 135+ participants.
"""

import os
import sys
import time
import re
import shutil
import subprocess
import threading
import webbrowser

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def find_cloudflared():
    which_path = shutil.which("cloudflared")
    if which_path and os.path.exists(which_path):
        return which_path
    
    candidate_paths = [
        r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
        r"C:\Program Files\cloudflared\cloudflared.exe",
        os.path.expanduser(r"~\cloudflared.exe")
    ]
    for p in candidate_paths:
        if os.path.exists(p):
            return p
    return None

def drain_pipe(pipe):
    """Continuously drains a pipe in the background to prevent OS buffer deadlocks."""
    try:
        for _ in iter(pipe.readline, ''):
            pass
    except Exception:
        pass
    finally:
        try:
            pipe.close()
        except Exception:
            pass

def kill_port_5000():
    """Ensures port 5000 is completely free on Windows before starting Waitress."""
    try:
        out = subprocess.check_output('netstat -ano | findstr :5000', shell=True, text=True)
        for line in out.strip().splitlines():
            parts = line.split()
            if len(parts) >= 5 and "LISTENING" in parts:
                pid = parts[-1]
                if pid and pid != "0":
                    print(f"[*] Freeing port 5000: terminating stale process PID {pid}...", flush=True)
                    subprocess.run(f'taskkill /F /PID {pid}', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    time.sleep(1)
    except Exception:
        pass

def main():
    print("=" * 70, flush=True)
    print("   CYBER WORKSHOP PLATFORM - HIGH-CONCURRENCY LIVE LAUNCHER", flush=True)
    print("=" * 70, flush=True)
    
    kill_port_5000()

    cloudflared_exe = find_cloudflared()
    if not cloudflared_exe:
        print("[!] Cloudflared not found in PATH or standard Program Files directories.", flush=True)
        print("[*] Starting local server ONLY on LAN...", flush=True)
        os.system(f'"{sys.executable}" "{os.path.join(BASE_DIR, "server.py")}"')
        return

    print(f"[1/3] Starting backend Waitress server on 127.0.0.1:5000...", flush=True)
    # Inherit stdout/stderr so logs print to terminal without pipe deadlocks
    server_proc = subprocess.Popen(
        [sys.executable, os.path.join(BASE_DIR, "server.py")],
        cwd=BASE_DIR
    )
    
    time.sleep(2)
    if server_proc.poll() is not None:
        print("[!] Backend server failed to start!", flush=True)
        return

    print(f"[2/3] Establishing Cloudflare Tunnel using {cloudflared_exe}...", flush=True)
    tunnel_proc = subprocess.Popen(
        [cloudflared_exe, "tunnel", "--url", "http://localhost:5000"],
        cwd=BASE_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )

    tunnel_url = None
    url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")

    print("[3/3] Waiting for Cloudflare edge routing to register...", flush=True)
    start_time = time.time()
    
    while time.time() - start_time < 35:
        line = tunnel_proc.stdout.readline()
        if not line:
            if tunnel_proc.poll() is not None:
                break
            continue
        
        match = url_pattern.search(line)
        if match:
            tunnel_url = match.group(0)
            break

    if not tunnel_url:
        print("[!] Could not auto-detect trycloudflare.com URL within 35 seconds.", flush=True)
        print("[*] Cloudflare tunnel log output:", flush=True)
        try:
            while True:
                line = tunnel_proc.stdout.readline()
                if not line and tunnel_proc.poll() is not None:
                    break
                print(line, end="", flush=True)
        except KeyboardInterrupt:
            pass
        finally:
            tunnel_proc.terminate()
            server_proc.terminate()
            return

    # Start background daemon thread to drain remaining tunnel output (prevents buffer deadlock)
    drain_thread = threading.Thread(target=drain_pipe, args=(tunnel_proc.stdout,), daemon=True)
    drain_thread.start()

    admin_pw = "admin2026"
    room_code = "WORKSHOP26"
    try:
        import json
        with open(os.path.join(BASE_DIR, "settings.json"), "r", encoding="utf-8") as sf:
            s_data = json.load(sf)
            admin_pw = s_data.get("admin_password", "admin2026")
            room_code = s_data.get("room_code", "WORKSHOP26")
    except Exception:
        pass

    info_text = f"""======================================================================
  CYBER WORKSHOP ARENA - LIVE SESSION INFORMATION
======================================================================

  PUBLIC PARTICIPANT URL (Share with students):
  >> {tunnel_url} <<

  ORGANIZER ADMIN DASHBOARD:
  >> {tunnel_url}/admin
  Password: {admin_pw}

  AUDITORIUM PROJECTOR LEADERBOARD:
  >> {tunnel_url}/projector

  WHITEBOARD ROOM PASSCODE:
  >> {room_code}


======================================================================
IMPORTANT: Keep this window OPEN throughout the workshop.
Closing this window will shut down the server and tunnel.
======================================================================
"""
    live_link_path = os.path.join(BASE_DIR, "LIVE_LINK.txt")
    with open(live_link_path, "w", encoding="utf-8") as f:
        f.write(info_text)

    print("\n" + info_text, flush=True)
    print(f"[*] Saved session info to: {live_link_path}", flush=True)
    print("[*] Opening Organizer Admin portal in your default browser...", flush=True)
    try:
        webbrowser.open(f"{tunnel_url}/admin")
    except Exception:
        pass

    print("\n[*] Server & Tunnel are running smoothly. Press Ctrl+C to stop.\n", flush=True)
    try:
        while True:
            time.sleep(1)
            if server_proc.poll() is not None:
                print("[!] Server stopped unexpectedly.", flush=True)
                break
            if tunnel_proc.poll() is not None:
                print("[!] Cloudflare tunnel stopped unexpectedly.", flush=True)
                break
    except KeyboardInterrupt:
        print("\n[*] Shutting down workshop server & tunnel cleanly...", flush=True)
    finally:
        try:
            tunnel_proc.terminate()
        except Exception:
            pass
        try:
            server_proc.terminate()
        except Exception:
            pass
        print("[+] Workshop server stopped safely. All data is saved on disk.", flush=True)

if __name__ == "__main__":
    main()
