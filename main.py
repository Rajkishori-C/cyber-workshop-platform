#!/usr/bin/env python3
"""
Replit / Cloud Entrypoint for Cyber Workshop CTF Platform
Redirects to server.py
"""
import os
import server

if __name__ == "__main__":
    server.init_db()
    settings = server.load_settings()
    port = int(os.environ.get("PORT", 5000))
    ip_list = server.get_local_ip_addresses()

    print("=" * 68)
    print("   ____  _____ _____ _     ___ _   _ _____   ____ _____ _____ ")
    print("  / __ \\|  ___|  ___| |   |_ _| \\ | | ____| / ___|_   _|  ___|")
    print(" | |  | | |_  | |_  | |    | ||  \\| |  _|  | |     | | | |_   ")
    print(" | |__| |  _| |  _| | |___ | || |\\  | |___ | |___  | | |  _|  ")
    print("  \\____/|_|   |_|   |_____|___|_| \\_|_____| \\____| |_| |_|    ")
    print("=" * 68)
    print(f"  [+] Admin Portal:  /admin (Password: {settings.get('admin_password', 'admin2026')})")
    print(f"  [+] Room Passcode: {settings.get('room_code', 'WORKSHOP26')}")
    print(f"  [+] Port:          {port}")
    print("=" * 68)

    try:
        from waitress import serve
        print(f"[*] Starting Waitress production WSGI server on 0.0.0.0:{port}...")
        serve(server.app, host="0.0.0.0", port=port, threads=16)
    except ImportError:
        print(f"[!] Falling back to Flask on 0.0.0.0:{port}...")
        server.app.run(host="0.0.0.0", port=port, threaded=True)
