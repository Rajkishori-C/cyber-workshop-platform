#!/usr/bin/env python3
"""
2-Day College Workshop Platform: Saturday Quiz + Sunday CTF + Combined Leaderboard
Features:
- Saturday Quiz Section: Multiple-choice & Short-answer with server-side validation
- Sunday CTF Section: Flag capture, hint penalties, and self-contained puzzles
- Unified Combined Leaderboard: Total Points (Quiz + CTF Net Score) with tie-breaker
- Section Scheduling & Manual Control: Automated date/time window or instant toggle
- Pod-Based Scoring: Shared score per pod, single pod login
- Cloud Deployment Ready: Works seamlessly on Replit, Heroku, Render, or local offline LAN
"""

import os
import sys
import json
import sqlite3
import socket
import datetime
import csv
import io
import re
import html
import hmac
import time
import threading
from collections import defaultdict
from functools import wraps
from flask import Flask, request, jsonify, render_template, send_from_directory, Response, make_response, session, redirect, url_for

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHALLENGES_FILE = os.path.join(BASE_DIR, "challenges.json")
QUIZ_FILE = os.path.join(BASE_DIR, "quiz.json")
SETTINGS_FILE = os.path.join(BASE_DIR, "settings.json")
CHALLENGE_FILES_DIR = os.path.join(BASE_DIR, "challenge_files")
DB_FILE = os.path.join(BASE_DIR, "ctf.db")

app = Flask(__name__, template_folder="templates", static_folder="static")
app.secret_key = os.environ.get("FLASK_SECRET", "workshop-two-day-ctf-secret-key-2026")
app.config['JSON_SORT_KEYS'] = False

# -------------------------------------------------------------
# Settings & Scheduling
# -------------------------------------------------------------
DEFAULT_SETTINGS = {
    "room_code": "WORKSHOP26",
    "admin_password": "admin2026",
    "timer_duration_minutes": 60,
    "anti_cheat_enabled": True,
    "max_violations": 3,
    "quiz_mode": "manual",        # "manual" or "scheduled"
    "quiz_enabled": False,
    "quiz_start_time": "2026-09-19T09:00",
    "quiz_end_time": "2026-09-19T21:00",
    "ctf_mode": "manual",         # "manual" or "scheduled"
    "ctf_enabled": False,
    "ctf_start_time": "2026-09-20T09:00",
    "ctf_end_time": "2026-09-20T21:00"
}

def load_settings():
    if not os.path.exists(SETTINGS_FILE):
        save_settings(DEFAULT_SETTINGS)
        return DEFAULT_SETTINGS
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Ensure all default keys exist
            for k, v in DEFAULT_SETTINGS.items():
                if k not in data:
                    data[k] = v
            return data
    except Exception:
        return DEFAULT_SETTINGS

# -------------------------------------------------------------
# In-Memory Micro-Cache for Concurrency (135+ Participants)
# -------------------------------------------------------------
_cache_lock = threading.Lock()
_section_status_cache = {}
_section_status_cache_time = 0
_leaderboard_cache = None
_leaderboard_cache_time = 0

def invalidate_caches():
    global _section_status_cache_time, _leaderboard_cache_time, _section_status_cache, _leaderboard_cache
    with _cache_lock:
        _section_status_cache.clear()
        _section_status_cache_time = 0
        _leaderboard_cache = None
        _leaderboard_cache_time = 0

def save_settings(data):
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    invalidate_caches()

def get_section_status(section_name: str):
    """Evaluates whether a section ('quiz' or 'ctf') is currently open with 2s micro-cache."""
    global _section_status_cache_time
    now_ts = time.time()
    if not app.config.get("TESTING"):
        with _cache_lock:
            if now_ts - _section_status_cache_time < 2.0 and section_name in _section_status_cache:
                return _section_status_cache[section_name]
            elif now_ts - _section_status_cache_time >= 2.0:
                _section_status_cache.clear()

    settings = load_settings()
    mode = settings.get(f"{section_name}_mode", "manual")
    enabled = settings.get(f"{section_name}_enabled", False)
    start_str = settings.get(f"{section_name}_start_time", "")
    end_str = settings.get(f"{section_name}_end_time", "")
    display_title = "CTF" if section_name.lower() == "ctf" else "Quiz"

    if mode == "manual":
        res = {
            "is_open": bool(enabled),
            "mode": "manual",
            "enabled": bool(enabled),
            "message": "Open" if enabled else f"{display_title} will be enabled by team"
        }
        with _cache_lock:
            _section_status_cache[section_name] = res
            _section_status_cache_time = time.time()
        return res

    # Scheduled mode
    now = datetime.datetime.now()
    try:
        start_dt = datetime.datetime.fromisoformat(start_str) if start_str else None
        end_dt = datetime.datetime.fromisoformat(end_str) if end_str else None
    except Exception:
        return {"is_open": bool(enabled), "mode": "manual", "enabled": bool(enabled), "message": "Manual Fallback"}

    if start_dt and now < start_dt:
        return {
            "is_open": False,
            "mode": "scheduled",
            "start_time": start_str,
            "message": f"{display_title} will be enabled by team (Opens {start_dt.strftime('%A at %I:%M %p')})"
        }
    elif end_dt and now > end_dt:
        return {
            "is_open": False,
            "mode": "scheduled",
            "end_time": end_str,
            "message": f"{display_title} will be enabled by team"
        }
    else:
        res = {
            "is_open": True,
            "mode": "scheduled",
            "message": "Open (Scheduled)"
        }
        with _cache_lock:
            _section_status_cache[section_name] = res
            _section_status_cache_time = time.time()
        return res

# Rate Limiting Tracker
submission_history = defaultdict(list)
SUBMISSION_WINDOW = 10.0
MAX_SUBMISSIONS_IN_WINDOW = 8

def is_rate_limited(team_name: str) -> bool:
    if app.config.get("TESTING"):
        return False
    now = time.time()
    history = submission_history[team_name]
    submission_history[team_name] = [t for t in history if now - t < SUBMISSION_WINDOW]
    if len(submission_history[team_name]) >= MAX_SUBMISSIONS_IN_WINDOW:
        return True
    submission_history[team_name].append(now)
    return False

# Security & No-Cache Headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'self' data:;"
    )
    return response

# -------------------------------------------------------------
# Database Setup
# -------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_FILE, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Teams table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE COLLATE NOCASE NOT NULL,
            start_time TIMESTAMP,
            violations_count INTEGER DEFAULT 0,
            quiz_completed BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    try:
        cursor.execute("ALTER TABLE teams ADD COLUMN quiz_completed BOOLEAN DEFAULT 0")
        conn.commit()
    except Exception:
        pass
    
    # CTF Solves table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS solves (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_name TEXT COLLATE NOCASE NOT NULL,
            challenge_id TEXT NOT NULL,
            points INTEGER NOT NULL,
            solved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(team_name, challenge_id)
        )
    """)
    
    # CTF Hints unlocked table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS hints_unlocked (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_name TEXT COLLATE NOCASE NOT NULL,
            challenge_id TEXT NOT NULL,
            penalty INTEGER NOT NULL DEFAULT 0,
            unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(team_name, challenge_id)
        )
    """)
    
    # Quiz Answers table (New for Saturday Quiz)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS quiz_answers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_name TEXT COLLATE NOCASE NOT NULL,
            question_id TEXT NOT NULL,
            submitted_answer TEXT NOT NULL,
            is_correct BOOLEAN NOT NULL,
            points_awarded INTEGER NOT NULL,
            answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(team_name, question_id)
        )
    """)

    # Submissions audit log
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS submissions_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_name TEXT NOT NULL,
            challenge_id TEXT NOT NULL,
            submitted_flag TEXT NOT NULL,
            is_correct BOOLEAN NOT NULL,
            ip_address TEXT,
            submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Automatic Column Migrations
    cursor.execute("PRAGMA table_info(teams)")
    team_cols = [row["name"] for row in cursor.fetchall()]
    if "start_time" not in team_cols:
        cursor.execute("ALTER TABLE teams ADD COLUMN start_time TIMESTAMP")
    if "violations_count" not in team_cols:
        cursor.execute("ALTER TABLE teams ADD COLUMN violations_count INTEGER DEFAULT 0")

    cursor.execute("PRAGMA table_info(submissions_log)")
    sub_cols = [row["name"] for row in cursor.fetchall()]
    if "ip_address" not in sub_cols:
        cursor.execute("ALTER TABLE submissions_log ADD COLUMN ip_address TEXT")

    conn.commit()
    conn.close()

# -------------------------------------------------------------
# Data Loaders (Quiz & CTF)
# -------------------------------------------------------------
def load_challenges():
    if not os.path.exists(CHALLENGES_FILE):
        return []
    try:
        with open(CHALLENGES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def save_challenges(data):
    with open(CHALLENGES_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    invalidate_caches()

def load_quiz():
    if not os.path.exists(QUIZ_FILE):
        return []
    try:
        with open(QUIZ_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def save_quiz(data):
    with open(QUIZ_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    invalidate_caches()

# -------------------------------------------------------------
# Admin Auth Decorator
# -------------------------------------------------------------
def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get("is_admin"):
            if request.is_json:
                return jsonify({"success": False, "message": "Admin authentication required."}), 401
            return redirect("/admin/login")
        return f(*args, **kwargs)
    return decorated_function

# -------------------------------------------------------------
# Frontend Routes
# -------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/projector")
def projector():
    return render_template("projector.html")

@app.route("/admin")
@admin_required
def admin_dashboard():
    return render_template("admin.html")

@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    settings = load_settings()
    if request.method == "POST":
        data = request.get_json(force=True, silent=True) or request.form
        password = data.get("password", "").strip()
        expected = settings.get("admin_password", "admin2026").strip()
        if hmac.compare_digest(password.encode("utf-8"), expected.encode("utf-8")):
            session["is_admin"] = True
            if request.is_json:
                return jsonify({"success": True})
            return redirect("/admin")
        else:
            if request.is_json:
                return jsonify({"success": False, "message": "Incorrect admin password."}), 401
            return render_template("admin_login.html", error="Incorrect password.")
    return render_template("admin_login.html")

@app.route("/admin/logout")
def admin_logout():
    session.pop("is_admin", None)
    return redirect("/")

# -------------------------------------------------------------
# Section Status & Config API
# -------------------------------------------------------------
@app.route("/api/sections/status")
def get_sections_status():
    """Returns live open/closed status of Quiz and CTF sections."""
    quiz_stat = get_section_status("quiz")
    ctf_stat = get_section_status("ctf")
    settings = load_settings()
    return jsonify({
        "quiz": quiz_stat,
        "ctf": ctf_stat,
        "timer_duration_minutes": settings.get("timer_duration_minutes", 60),
        "anti_cheat_enabled": settings.get("anti_cheat_enabled", True)
    })

# -------------------------------------------------------------
# Team Login & Session
# -------------------------------------------------------------
@app.route("/api/team/login", methods=["POST"])
def team_login():
    data = request.get_json(force=True, silent=True) or {}
    raw_name = data.get("name", "").strip()
    submitted_code = data.get("room_code", "").strip()
    settings = load_settings()
    
    expected_code = settings.get("room_code", "WORKSHOP26").strip()
    if not hmac.compare_digest(submitted_code.upper().encode("utf-8"), expected_code.upper().encode("utf-8")):
        return jsonify({"success": False, "message": "Invalid Room Passcode! Check whiteboard."}), 401

    if not (2 <= len(raw_name) <= 30):
        return jsonify({"success": False, "message": "Pod name must be 2 to 30 characters."}), 400
    if not re.match(r"^[a-zA-Z0-9 _\-]+$", raw_name):
        return jsonify({"success": False, "message": "Letters, numbers, spaces, hyphens, and underscores only."}), 400

    clean_name = html.escape(raw_name)
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT OR IGNORE INTO teams (name) VALUES (?)", (clean_name,))
        conn.commit()
        
        cursor.execute("SELECT name, start_time, violations_count FROM teams WHERE name = ? COLLATE NOCASE", (clean_name,))
        row = cursor.fetchone()
        session["team_name"] = row["name"]
        
        return jsonify({
            "success": True,
            "team": row["name"],
            "start_time": row["start_time"],
            "violations_count": row["violations_count"]
        })
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
    finally:
        conn.close()

@app.route("/api/team/start", methods=["POST"])
def team_start():
    data = request.get_json(force=True, silent=True) or {}
    team_name = data.get("team", "").strip()
    if not team_name:
        return jsonify({"success": False, "message": "Pod name required."}), 400

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT start_time FROM teams WHERE name = ? COLLATE NOCASE", (team_name,))
        row = cursor.fetchone()
        if not row:
            return jsonify({"success": False, "message": "Pod not found."}), 404

        start_time = row["start_time"]
        if not start_time:
            now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute("UPDATE teams SET start_time = ? WHERE name = ? COLLATE NOCASE", (now_str, team_name))
            conn.commit()
            start_time = now_str

        return jsonify({"success": True, "start_time": start_time})
    finally:
        conn.close()

@app.route("/api/team/violation", methods=["POST"])
def record_violation():
    data = request.get_json(force=True, silent=True) or {}
    team_name = data.get("team", "").strip()
    settings = load_settings()
    if not settings.get("anti_cheat_enabled", True) or not team_name:
        return jsonify({"success": True, "violations_count": 0})

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE teams SET violations_count = violations_count + 1 WHERE name = ? COLLATE NOCASE", (team_name,))
        conn.commit()
        cursor.execute("SELECT violations_count FROM teams WHERE name = ? COLLATE NOCASE", (team_name,))
        row = cursor.fetchone()
        v_count = row["violations_count"] if row else 1
        return jsonify({"success": True, "violations_count": v_count})
    finally:
        conn.close()

@app.route("/api/team/status")
def team_status():
    team_name = request.args.get("team", "").strip()
    if not team_name:
        return jsonify({"exists": False})
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT name, start_time, violations_count, quiz_completed FROM teams WHERE name = ? COLLATE NOCASE", (team_name,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return jsonify({"exists": False})
    return jsonify({
        "exists": True,
        "name": row["name"],
        "start_time": row["start_time"],
        "violations_count": row["violations_count"],
        "quiz_completed": bool(row["quiz_completed"])
    })

@app.route("/api/team/logout", methods=["POST"])
def team_logout():
    session.pop("team_name", None)
    return jsonify({"success": True})

# -------------------------------------------------------------
# Quiz Endpoints (Saturday Quiz)
# -------------------------------------------------------------
@app.route("/api/quiz")
def get_quiz():
    """Returns active quiz questions for participants. Answers & correctness strictly stripped."""
    quiz_stat = get_section_status("quiz")
    if not quiz_stat["is_open"]:
        return jsonify({"locked": True, "message": quiz_stat["message"], "questions": [], "quiz_completed": False})

    team_name = request.args.get("team", "").strip() or session.get("team_name", "")

    questions = load_quiz()
    
    conn = get_db()
    cursor = conn.cursor()
    answered_dict = {}
    team_quiz_completed = False
    
    if team_name:
        cursor.execute("SELECT quiz_completed FROM teams WHERE name = ? COLLATE NOCASE", (team_name,))
        t_row = cursor.fetchone()
        if t_row and t_row["quiz_completed"]:
            team_quiz_completed = True

        cursor.execute("SELECT question_id, submitted_answer FROM quiz_answers WHERE team_name = ? COLLATE NOCASE", (team_name,))
        for r in cursor.fetchall():
            answered_dict[r["question_id"]] = {
                "submitted_answer": r["submitted_answer"]
            }
    conn.close()

    sanitized = []
    for q in questions:
        if not q.get("active", True):
            continue
        qid = q["id"]
        is_answered = qid in answered_dict
        user_data = answered_dict.get(qid, {})

        item = {
            "id": qid,
            "title": q.get("title", ""),
            "type": q.get("type", "mcq"),
            "category": q.get("category", "General"),
            "question": q.get("question", ""),
            "points": q.get("points", 50),
            "answered": is_answered,
            "submitted_answer": user_data.get("submitted_answer")
        }

        # For MCQs, include the choices list, but NEVER the correct answer index!
        if q.get("type") == "mcq":
            item["options"] = q.get("options", [])
            
        sanitized.append(item)

    return jsonify({"locked": False, "questions": sanitized, "quiz_completed": team_quiz_completed})

@app.route("/api/quiz/submit", methods=["POST"])
def submit_quiz_answer():
    """Saves a pod's quiz answer server-side. Answers can be updated until quiz is finalized."""
    quiz_stat = get_section_status("quiz")
    if not quiz_stat["is_open"]:
        return jsonify({"success": False, "message": f"Quiz section is closed: {quiz_stat['message']}"}), 403

    data = request.get_json(force=True, silent=True) or {}
    team_name = data.get("team", "").strip() or session.get("team_name", "")
    question_id = data.get("question_id", "").strip()
    user_answer = data.get("answer")

    if not team_name or not question_id or user_answer is None:
        return jsonify({"success": False, "message": "Missing team name, question ID, or answer."}), 400

    settings = load_settings()
    conn_chk = get_db()
    c_chk = conn_chk.cursor()
    c_chk.execute("SELECT start_time, quiz_completed FROM teams WHERE name = ? COLLATE NOCASE", (team_name,))
    t_row = c_chk.fetchone()
    conn_chk.close()
    if t_row:
        if t_row["quiz_completed"]:
            return jsonify({"success": False, "message": "Quiz has already been finalized and submitted by your pod!"}), 400
        if t_row["start_time"]:
            try:
                st = datetime.datetime.fromisoformat(t_row["start_time"].replace(" ", "T"))
                elapsed = (datetime.datetime.now() - st).total_seconds()
                timer_limit = int(settings.get("timer_duration_minutes", 60)) * 60 + 60
                if elapsed > timer_limit:
                    return jsonify({"success": False, "message": "Assessment timer has expired for your pod!"}), 403
            except Exception:
                pass

    questions = load_quiz()
    q_dict = {q["id"]: q for q in questions}
    if question_id not in q_dict:
        return jsonify({"success": False, "message": "Unknown question ID."}), 404

    target_q = q_dict[question_id]
    points = int(target_q.get("points", 50))
    q_type = target_q.get("type", "mcq")

    # Evaluate correctness
    is_correct = False
    submitted_str = str(user_answer).strip()

    if q_type == "mcq":
        try:
            selected_idx = int(user_answer)
            correct_idx = int(target_q.get("correct_option", 0))
            is_correct = (selected_idx == correct_idx)
        except (ValueError, TypeError):
            is_correct = False
    else: # short_answer
        accepted = [a.strip().lower() for a in target_q.get("accepted_answers", [])]
        is_correct = (submitted_str.lower() in accepted)

    points_awarded = points if is_correct else 0

    conn = get_db()
    cursor = conn.cursor()
    try:
        # Ensure team is registered
        cursor.execute("INSERT OR IGNORE INTO teams (name) VALUES (?)", (team_name,))
        # Upsert answer so changes are saved before final submission
        cursor.execute("""
            INSERT INTO quiz_answers (team_name, question_id, submitted_answer, is_correct, points_awarded)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(team_name, question_id) DO UPDATE SET
                submitted_answer = excluded.submitted_answer,
                is_correct = excluded.is_correct,
                points_awarded = excluded.points_awarded,
                answered_at = CURRENT_TIMESTAMP
        """, (team_name, question_id, submitted_str, is_correct, points_awarded))
        conn.commit()
        invalidate_caches()

        res_payload = {
            "success": True,
            "saved": True,
            "message": "Response recorded."
        }
        if app.config.get("TESTING"):
            res_payload["is_correct"] = is_correct
            res_payload["points"] = points_awarded
            res_payload["points_awarded"] = points_awarded

        return jsonify(res_payload)
    finally:
        conn.close()

@app.route("/api/quiz/finish", methods=["POST"])
def finish_quiz():
    """Finalizes and permanently locks the Saturday Quiz for a pod."""
    data = request.get_json(force=True, silent=True) or {}
    team_name = data.get("team", "").strip() or session.get("team_name", "")

    if not team_name:
        return jsonify({"success": False, "message": "Pod name required."}), 400

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, quiz_completed FROM teams WHERE name = ? COLLATE NOCASE", (team_name,))
        row = cursor.fetchone()
        if not row:
            cursor.execute("INSERT INTO teams (name, quiz_completed) VALUES (?, 1)", (team_name,))
        else:
            cursor.execute("UPDATE teams SET quiz_completed = 1 WHERE name = ? COLLATE NOCASE", (team_name,))
        conn.commit()
        invalidate_caches()
        return jsonify({"success": True, "message": "Quiz finalized and submitted successfully!"})
    finally:
        conn.close()

# -------------------------------------------------------------
# CTF Endpoints (Sunday CTF)
# -------------------------------------------------------------
@app.route("/api/challenges")
def get_challenges():
    """Returns active CTF challenges for participants. Flags strictly stripped."""
    ctf_stat = get_section_status("ctf")
    if not ctf_stat["is_open"]:
        return jsonify({"locked": True, "message": ctf_stat["message"], "challenges": []})

    team_name = request.args.get("team", "").strip()
    challenges = load_challenges()
    
    conn = get_db()
    cursor = conn.cursor()
    
    submitted_set = set()
    unlocked_hints = set()
    
    if team_name:
        cursor.execute("SELECT DISTINCT challenge_id FROM submissions_log WHERE team_name = ? COLLATE NOCASE", (team_name,))
        submitted_set = {row["challenge_id"] for row in cursor.fetchall()}
        cursor.execute("SELECT challenge_id FROM hints_unlocked WHERE team_name = ? COLLATE NOCASE", (team_name,))
        unlocked_hints = {row["challenge_id"] for row in cursor.fetchall()}
    
    sanitized = []
    for ch in challenges:
        if not ch.get("active", True):
            continue

        cid = ch.get("id")
        is_submitted = cid in submitted_set
        is_hint_unlocked = cid in unlocked_hints
        
        item = {
            "id": cid,
            "title": ch.get("title"),
            "category": ch.get("category"),
            "difficulty": ch.get("difficulty", "easy"),
            "points": ch.get("points", 20),
            "description": ch.get("description", ""),
            "has_hint": bool(ch.get("hint")),
            "hint_cost": ch.get("hint_cost", 0),
            "hint_unlocked": is_hint_unlocked,
            "hint": ch.get("hint") if is_hint_unlocked else None,
            "solved": is_submitted,
            "submitted": is_submitted,
            "files": ch.get("files", [])
        }
        sanitized.append(item)
        
    conn.close()
    return jsonify({"locked": False, "challenges": sanitized})

@app.route("/api/submit", methods=["POST"])
def submit_flag():
    ctf_stat = get_section_status("ctf")
    if not ctf_stat["is_open"]:
        return jsonify({"success": False, "message": f"CTF section is closed: {ctf_stat['message']}"}), 403

    data = request.get_json(force=True, silent=True) or {}
    team_name = data.get("team", "").strip()
    if session.get("team_name") and not app.config.get("TESTING"):
        team_name = session.get("team_name")
    elif not team_name:
        team_name = session.get("team_name", "")
    challenge_id = data.get("challenge_id", "").strip()
    submitted_flag = data.get("flag", "").strip()
    client_ip = request.remote_addr or "127.0.0.1"
    
    if not team_name or not challenge_id or not submitted_flag:
        return jsonify({"success": False, "message": "Missing pod name, challenge ID, or flag."}), 400

    if is_rate_limited(team_name.lower()):
        return jsonify({"success": False, "message": "Submitting too fast! Wait 5 seconds."}), 429
    
    challenges = load_challenges()
    ch_dict = {ch["id"]: ch for ch in challenges}
    
    if challenge_id not in ch_dict:
        return jsonify({"success": False, "message": "Unknown challenge ID."}), 404
        
    target = ch_dict[challenge_id]
    correct_flag = target.get("flag", "").strip()
    points = target.get("points", 20)
    
    # Collect all accepted aliases (lowercase, trimmed)
    aliases = [a.strip().lower() for a in target.get("aliases", []) if a.strip()]
    if correct_flag and correct_flag.lower() not in aliases:
        aliases.append(correct_flag.lower())

    sub_clean = submitted_flag.strip().lower()
    # Support if student wrapped answer in CTF{...}
    sub_unwrapped = re.sub(r"^ctf\{(.*)\}$", r"\1", sub_clean).strip()

    is_correct = (sub_clean in aliases) or (sub_unwrapped in aliases)
    
    conn = get_db()
    cursor = conn.cursor()
    try:
        # Check if already submitted
        cursor.execute("SELECT id FROM submissions_log WHERE team_name = ? COLLATE NOCASE AND challenge_id = ?", (team_name, challenge_id))
        if cursor.fetchone():
            conn.commit()
            return jsonify({"success": False, "message": "Answer already recorded for this question."}), 400

        cursor.execute("""
            INSERT INTO submissions_log (team_name, challenge_id, submitted_flag, is_correct, ip_address)
            VALUES (?, ?, ?, ?, ?)
        """, (team_name, challenge_id, submitted_flag, is_correct, client_ip))
        
        cursor.execute("INSERT OR IGNORE INTO teams (name) VALUES (?)", (team_name,))
        if is_correct:
            cursor.execute("INSERT OR IGNORE INTO solves (team_name, challenge_id, points) VALUES (?, ?, ?)", (team_name, challenge_id, points))
            
        conn.commit()
        invalidate_caches()
        return jsonify({
            "success": True, 
            "message": "Answer recorded successfully!", 
            "submitted": True
        })
    finally:
        conn.close()

@app.route("/api/hint/unlock", methods=["POST"])
def unlock_hint():
    data = request.get_json(force=True, silent=True) or {}
    team_name = data.get("team", "").strip()
    challenge_id = data.get("challenge_id", "").strip()
    
    challenges = load_challenges()
    ch_dict = {ch["id"]: ch for ch in challenges}
    if challenge_id not in ch_dict:
        return jsonify({"success": False, "message": "Question not found."}), 404
        
    ch = ch_dict[challenge_id]
    hint_text = ch.get("hint", "")
    hint_cost = ch.get("hint_cost", 0)
    
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM hints_unlocked WHERE team_name = ? COLLATE NOCASE AND challenge_id = ?", (team_name, challenge_id))
        if not cursor.fetchone():
            cursor.execute("INSERT OR IGNORE INTO teams (name) VALUES (?)", (team_name,))
            cursor.execute("INSERT INTO hints_unlocked (team_name, challenge_id, penalty) VALUES (?, ?, ?)", (team_name, challenge_id, hint_cost))
            conn.commit()
        return jsonify({"success": True, "hint": hint_text, "penalty": hint_cost})
    finally:
        conn.close()

# -------------------------------------------------------------
# Combined Leaderboard Calculation
# -------------------------------------------------------------
@app.route("/api/leaderboard")
def get_leaderboard():
    """
    Ranks pods by TOTAL COMBINED POINTS = (Quiz Points) + (CTF Gross - CTF Deductions).
    Tie-breaker: Earliest last activity timestamp.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    # 1. Fetch all registered teams
    cursor.execute("SELECT name, start_time, violations_count, created_at FROM teams ORDER BY created_at ASC")
    teams = {
        row["name"]: {
            "name": row["name"],
            "start_time": row["start_time"],
            "violations_count": row["violations_count"],
            "created_at": row["created_at"],
            "quiz_points": 0,
            "quiz_count": 0,
            "ctf_gross": 0,
            "ctf_penalty": 0,
            "ctf_solves": [],
            "last_activity": None
        } for row in cursor.fetchall()
    }
    
    # 2. Quiz Points
    cursor.execute("SELECT team_name, points_awarded, answered_at FROM quiz_answers ORDER BY answered_at ASC")
    for row in cursor.fetchall():
        tname = row["team_name"]
        if tname not in teams:
            teams[tname] = {"name": tname, "start_time": None, "violations_count": 0, "created_at": row["answered_at"], "quiz_points": 0, "quiz_count": 0, "ctf_gross": 0, "ctf_penalty": 0, "ctf_solves": [], "last_activity": None}
        teams[tname]["quiz_points"] += row["points_awarded"]
        teams[tname]["quiz_count"] += 1
        teams[tname]["last_activity"] = row["answered_at"]

    # 3. CTF Solves
    cursor.execute("SELECT team_name, challenge_id, points, solved_at FROM solves ORDER BY solved_at ASC")
    for row in cursor.fetchall():
        tname = row["team_name"]
        if tname not in teams:
            teams[tname] = {"name": tname, "start_time": None, "violations_count": 0, "created_at": row["solved_at"], "quiz_points": 0, "quiz_count": 0, "ctf_gross": 0, "ctf_penalty": 0, "ctf_solves": [], "last_activity": None}
        teams[tname]["ctf_gross"] += row["points"]
        teams[tname]["ctf_solves"].append(row["challenge_id"])
        # Update last activity if newer
        solv_time = row["solved_at"]
        if not teams[tname]["last_activity"] or solv_time > teams[tname]["last_activity"]:
            teams[tname]["last_activity"] = solv_time

    # 4. CTF Penalties
    cursor.execute("SELECT team_name, penalty FROM hints_unlocked")
    for row in cursor.fetchall():
        tname = row["team_name"]
        if tname in teams:
            teams[tname]["ctf_penalty"] += row["penalty"]

    # 5. Calculate Final Scores
    leaderboard = []
    for tname, data in teams.items():
        ctf_net = max(0, data["ctf_gross"] - data["ctf_penalty"])
        total_score = ctf_net  # Sunday CTF score is the sole tournament scoring factor

        leaderboard.append({
            "name": tname,
            "total_score": total_score,
            "quiz_points": 0,
            "quiz_count": 0,
            "ctf_net": ctf_net,
            "ctf_gross": data["ctf_gross"],
            "ctf_penalty": data["ctf_penalty"],
            "ctf_solves_count": len(data["ctf_solves"]),
            "violations_count": data["violations_count"],
            "last_activity": data["last_activity"],
            "created_at": data["created_at"]
        })

    # Sort criteria: Total Score DESC, earliest last_activity ASC (tie-breaker), created_at ASC
    def sort_key(item):
        la = item["last_activity"] or "9999-99-99 99:99:99"
        return (-item["total_score"], la, item["created_at"])

    leaderboard.sort(key=sort_key)
    for i, item in enumerate(leaderboard, start=1):
        item["rank"] = i

    # Recent Solves Ticker (Quiz + CTF)
    cursor.execute("""
        SELECT team_name, 'CTF: ' || challenge_id as item_title, points, solved_at as event_time
        FROM solves
        ORDER BY solved_at DESC
        LIMIT 8
    """)
    recent = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return jsonify({
        "leaderboard": leaderboard,
        "recent_activity": recent,
        "total_teams": len(leaderboard)
    })

# -------------------------------------------------------------
# Admin Management Endpoints
# -------------------------------------------------------------
@app.route("/api/admin/settings", methods=["GET", "POST"])
@admin_required
def admin_settings():
    settings = load_settings()
    if request.method == "POST":
        data = request.get_json(force=True, silent=True) or {}
        for key in ["room_code", "admin_password", "quiz_mode", "ctf_mode", "quiz_start_time", "quiz_end_time", "ctf_start_time", "ctf_end_time"]:
            if key in data and str(data[key]).strip():
                settings[key] = str(data[key]).strip()
        if "timer_duration_minutes" in data:
            settings["timer_duration_minutes"] = max(5, int(data["timer_duration_minutes"]))
        if "anti_cheat_enabled" in data:
            settings["anti_cheat_enabled"] = bool(data["anti_cheat_enabled"])
        if "quiz_enabled" in data:
            settings["quiz_enabled"] = bool(data["quiz_enabled"])
        if "ctf_enabled" in data:
            settings["ctf_enabled"] = bool(data["ctf_enabled"])

        save_settings(settings)
        return jsonify({"success": True, "settings": settings})

    return jsonify(settings)

@app.route("/api/admin/quiz", methods=["GET"])
@admin_required
def admin_get_all_quiz():
    """Admin view: returns all quiz questions WITH correct answers."""
    return jsonify(load_quiz())

@app.route("/api/admin/quiz/save", methods=["POST"])
@admin_required
def admin_save_quiz_question():
    data = request.get_json(force=True, silent=True) or {}
    qid = data.get("id", "").strip() or ("quiz-" + str(int(time.time())))
    
    questions = load_quiz()
    existing_idx = next((i for i, q in enumerate(questions) if q["id"] == qid), None)
    
    q_obj = {
        "id": qid,
        "title": data.get("title", "Untitled Question").strip(),
        "type": data.get("type", "mcq"),
        "category": data.get("category", "General").strip(),
        "question": data.get("question", "").strip(),
        "points": int(data.get("points", 50)),
        "active": bool(data.get("active", True)),
        "explanation": data.get("explanation", "").strip()
    }
    
    if q_obj["type"] == "mcq":
        q_obj["options"] = data.get("options", [])
        q_obj["correct_option"] = int(data.get("correct_option", 0))
    else:
        q_obj["accepted_answers"] = data.get("accepted_answers", [])
        
    if existing_idx is not None:
        questions[existing_idx] = q_obj
    else:
        questions.append(q_obj)
        
    save_quiz(questions)
    return jsonify({"success": True, "question": q_obj})

@app.route("/api/admin/quiz/toggle", methods=["POST"])
@admin_required
def admin_toggle_quiz_question():
    data = request.get_json(force=True, silent=True) or {}
    qid = data.get("id", "").strip()
    questions = load_quiz()
    for q in questions:
        if q["id"] == qid:
            q["active"] = not q.get("active", True)
            save_quiz(questions)
            return jsonify({"success": True, "id": qid, "active": q["active"]})
    return jsonify({"success": False, "message": "Question not found."}), 404

@app.route("/api/admin/quiz/delete", methods=["POST"])
@admin_required
def admin_delete_quiz_question():
    data = request.get_json(force=True, silent=True) or {}
    qid = data.get("id", "").strip()
    questions = load_quiz()
    new_list = [q for q in questions if q["id"] != qid]
    save_quiz(new_list)

    # Clean up any orphan answers from database
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM quiz_answers WHERE question_id = ?", (qid,))
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()

    invalidate_caches()
    return jsonify({"success": True, "deleted": qid})

@app.route("/api/admin/challenges", methods=["GET"])
@admin_required
def admin_get_all_challenges():
    return jsonify(load_challenges())

@app.route("/api/admin/challenge/save", methods=["POST"])
@admin_required
def admin_save_challenge():
    data = request.get_json(force=True, silent=True) or {}
    cid = data.get("id", "").strip() or ("ctf-" + str(int(time.time())))
    challenges = load_challenges()
    existing_idx = next((i for i, c in enumerate(challenges) if c["id"] == cid), None)
    
    ch_obj = {
        "id": cid,
        "title": data.get("title", "Untitled Challenge").strip(),
        "category": data.get("category", "General").strip(),
        "difficulty": data.get("difficulty", "easy").strip(),
        "points": int(data.get("points", 100)),
        "active": bool(data.get("active", True)),
        "description": data.get("description", "").strip(),
        "hint": data.get("hint", "").strip(),
        "hint_cost": int(data.get("hint_cost", 0)),
        "flag": data.get("flag", "").strip(),
        "files": data.get("files", [])
    }
    
    if existing_idx is not None:
        challenges[existing_idx] = ch_obj
    else:
        challenges.append(ch_obj)
        
    save_challenges(challenges)
    return jsonify({"success": True, "challenge": ch_obj})

@app.route("/api/admin/challenge/toggle", methods=["POST"])
@admin_required
def admin_toggle_challenge():
    data = request.get_json(force=True, silent=True) or {}
    cid = data.get("id", "").strip()
    challenges = load_challenges()
    for ch in challenges:
        if ch["id"] == cid:
            ch["active"] = not ch.get("active", True)
            save_challenges(challenges)
            return jsonify({"success": True, "id": cid, "active": ch["active"]})
    return jsonify({"success": False, "message": "Challenge not found."}), 404

@app.route("/api/admin/challenge/delete", methods=["POST"])
@admin_required
def admin_delete_challenge():
    data = request.get_json(force=True, silent=True) or {}
    cid = data.get("id", "").strip()
    challenges = load_challenges()
    new_list = [c for c in challenges if c["id"] != cid]
    save_challenges(new_list)

    # Clean up any orphan solves/hints from database
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM solves WHERE challenge_id = ?", (cid,))
        cursor.execute("DELETE FROM hints_unlocked WHERE challenge_id = ?", (cid,))
        cursor.execute("DELETE FROM submissions_log WHERE challenge_id = ?", (cid,))
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()

    invalidate_caches()
    return jsonify({"success": True, "deleted": cid})

@app.route("/api/admin/teams", methods=["GET"])
@admin_required
def admin_list_teams():
    lb_res = get_leaderboard().json
    return jsonify(lb_res.get("leaderboard", []))

@app.route("/api/admin/team/delete", methods=["POST"])
@admin_required
def admin_delete_team():
    data = request.get_json(force=True, silent=True) or {}
    team_name = data.get("team_name", "").strip()
    if not team_name:
        return jsonify({"success": False, "message": "Pod name required."}), 400

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM solves WHERE team_name = ? COLLATE NOCASE", (team_name,))
        cursor.execute("DELETE FROM hints_unlocked WHERE team_name = ? COLLATE NOCASE", (team_name,))
        cursor.execute("DELETE FROM quiz_answers WHERE team_name = ? COLLATE NOCASE", (team_name,))
        cursor.execute("DELETE FROM submissions_log WHERE team_name = ? COLLATE NOCASE", (team_name,))
        cursor.execute("DELETE FROM teams WHERE name = ? COLLATE NOCASE", (team_name,))
        conn.commit()
        return jsonify({"success": True, "message": f"Pod '{team_name}' and all associated scores deleted."})
    finally:
        conn.close()

@app.route("/api/admin/reset", methods=["POST"])
@admin_required
def admin_reset_all():
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM solves")
        cursor.execute("DELETE FROM hints_unlocked")
        cursor.execute("DELETE FROM quiz_answers")
        cursor.execute("DELETE FROM submissions_log")
        cursor.execute("DELETE FROM teams")
        conn.commit()
        submission_history.clear()
        return jsonify({"success": True, "message": "All scores, quiz answers, and teams reset."})
    finally:
        conn.close()

@app.route("/api/export/csv")
def export_csv():
    conn = get_db()
    cursor = conn.cursor()
    output = io.StringIO()
    writer = csv.writer(output)
    
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    writer.writerow([f"# WORKSHOP 2-DAY COMBINED ASSESSMENT RESULTS - {now_str}"])
    writer.writerow([])
    writer.writerow(["=== COMBINED POD STANDINGS ==="])
    writer.writerow(["Rank", "Pod Name", "Total Score", "Quiz Points", "CTF Net Points", "CTF Deductions", "Tab Violations", "Last Activity"])
    
    lb_res = get_leaderboard().json
    for item in lb_res.get("leaderboard", []):
        writer.writerow([
            item["rank"],
            item["name"],
            item["total_score"],
            item["quiz_points"],
            item["ctf_net"],
            item["ctf_penalty"],
            item.get("violations_count", 0),
            item["last_activity"] or "N/A"
        ])
        
    writer.writerow([])
    writer.writerow(["=== QUIZ SUBMISSIONS AUDIT LOG ==="])
    writer.writerow(["Timestamp", "Pod Name", "Question ID", "Submitted Answer", "Is Correct", "Points Awarded"])
    cursor.execute("SELECT answered_at, team_name, question_id, submitted_answer, is_correct, points_awarded FROM quiz_answers ORDER BY answered_at ASC")
    for r in cursor.fetchall():
        writer.writerow([r["answered_at"], r["team_name"], r["question_id"], r["submitted_answer"], bool(r["is_correct"]), r["points_awarded"]])

    writer.writerow([])
    writer.writerow(["=== CTF SOLVES AUDIT LOG ==="])
    writer.writerow(["Timestamp", "Pod Name", "Challenge ID", "Points Awarded"])
    cursor.execute("SELECT solved_at, team_name, challenge_id, points FROM solves ORDER BY solved_at ASC")
    for r in cursor.fetchall():
        writer.writerow([r["solved_at"], r["team_name"], r["challenge_id"], r["points"]])
        
    conn.close()
    
    csv_data = output.getvalue()
    filename = f"workshop_results_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    response = Response(csv_data, mimetype="text/csv")
    response.headers["Content-Disposition"] = f"attachment; filename={filename}"
    return response

# -------------------------------------------------------------
# Host IP Address Detection
# -------------------------------------------------------------
def get_local_ip_addresses():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        primary_ip = s.getsockname()[0]
        s.close()
        if not primary_ip.startswith("127."):
            ips.add(primary_ip)
    except Exception:
        pass
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith("127."):
                ips.add(ip)
    except Exception:
        pass
    return sorted(list(ips))

# -------------------------------------------------------------
# Main Entry Point (Cloud & Local Ready)
# -------------------------------------------------------------
if __name__ == "__main__":
    init_db()
    settings = load_settings()
    port = int(os.environ.get("PORT", 5000))
    ip_list = get_local_ip_addresses()

    print("=" * 68)
    print("   ____  _____ _____ _     ___ _   _ _____   ____ _____ _____ ")
    print("  / __ \\|  ___|  ___| |   |_ _| \\ | | ____| / ___|_   _|  ___|")
    print(" | |  | | |_  | |_  | |    | ||  \\| |  _|  | |     | | | |_   ")
    print(" | |__| |  _| |  _| | |___ | || |\\  | |___ | |___  | | |  _|  ")
    print("  \\____/|_|   |_|   |_____|___|_| \\_|_____| \\____| |_| |_|    ")
    print("=" * 68)
    print(f"  [+] Room Passcode: {settings.get('room_code', 'WORKSHOP26')}")
    print(f"  [+] Admin Portal:  http://localhost:{port}/admin (Password: {settings.get('admin_password', 'admin2026')})")
    print(f"  [+] Saturday Quiz: {settings.get('quiz_mode').upper()} (Open: {settings.get('quiz_enabled')})")
    print(f"  [+] Sunday CTF:    {settings.get('ctf_mode').upper()} (Open: {settings.get('ctf_enabled')})")
    print("-" * 68)
    print(f"  >>> PARTICIPANT URL: http://localhost:{port}")
    for ip in ip_list:
        print(f"      -> http://{ip}:{port}")
    print("=" * 68)

    try:
        from waitress import serve
        print(f"[*] Starting production Waitress WSGI server on 0.0.0.0:{port} (16 threads)...")
        serve(app, host="0.0.0.0", port=port, threads=16)
    except ImportError:
        print(f"[!] Falling back to Flask server on 0.0.0.0:{port}...")
        app.run(host="0.0.0.0", port=port, threaded=True)
