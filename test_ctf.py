#!/usr/bin/env python3
"""
Automated Test Suite for Offline CTF & Assessment Platform
Verifies:
1. Room Passcode verification & on-the-spot team registration
2. Start Assessment timer tracking
3. Anti-cheat tab-switch violation tracking
4. Server-side flag stripping
5. CTF flag submission & duplicate prevention
6. Admin login authentication
7. Admin team deletion (for demo cleanups)
8. Admin challenge toggle (active/hidden)
9. CSV export
10. Saturday Quiz question retrieval & answer key stripping
11. Saturday Quiz MCQ submission & scoring
12. Saturday Quiz short-answer submission & scoring
13. Saturday Quiz duplicate submission prevention
14. Combined Leaderboard scoring (Quiz + CTF Net)
15. Section scheduling & lock controls
16. Admin Quiz CRUD
"""

import os
import sys
import unittest
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server
from server import app, init_db, get_db, load_settings, save_settings, load_quiz, save_quiz, submission_history

class AssessmentTestSuite(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        app.config['TESTING'] = True
        cls.client = app.test_client()

        # Isolate test database so live ctf.db is NEVER touched or wiped
        cls.orig_db_file = server.DB_FILE
        cls.test_db_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_ctf.db")
        server.DB_FILE = cls.test_db_file

        # Save original state to restore on teardown
        cls.orig_settings = load_settings()
        cls.orig_quiz = load_quiz()

        init_db()

        # Clean slate for test db
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM solves")
        cursor.execute("DELETE FROM hints_unlocked")
        cursor.execute("DELETE FROM quiz_answers")
        cursor.execute("DELETE FROM submissions_log")
        cursor.execute("DELETE FROM teams")
        conn.commit()
        conn.close()
        submission_history.clear()

        # Ensure both sections open for test suite
        settings = dict(cls.orig_settings)
        settings["quiz_mode"] = "manual"
        settings["quiz_enabled"] = True
        settings["ctf_mode"] = "manual"
        settings["ctf_enabled"] = True
        save_settings(settings)

    @classmethod
    def tearDownClass(cls):
        # Restore settings and quiz data
        save_settings(cls.orig_settings)
        save_quiz(cls.orig_quiz)

        # Restore live database pointer
        server.DB_FILE = cls.orig_db_file
        if os.path.exists(cls.test_db_file):
            try:
                os.remove(cls.test_db_file)
            except Exception:
                pass
        submission_history.clear()

    def test_01_room_passcode_verification(self):
        """Ensure only teams with the valid whiteboard room passcode can join."""
        settings = load_settings()
        room_code = settings.get("room_code", "WORKSHOP26")

        # 1. Incorrect room code rejected
        res1 = self.client.post('/api/team/login', json={
            "name": "IntruderPod",
            "room_code": "WRONG_CODE"
        })
        self.assertEqual(res1.status_code, 401)
        self.assertFalse(res1.get_json()["success"])

        # 2. Correct room code accepted
        res2 = self.client.post('/api/team/login', json={
            "name": "Pod_Alpha_01",
            "room_code": room_code
        })
        self.assertEqual(res2.status_code, 200)
        self.assertTrue(res2.get_json()["success"])
        self.assertEqual(res2.get_json()["team"], "Pod_Alpha_01")
        print("\n[+] PASS: Room passcode verification verified.")

    def test_02_assessment_start_and_timer(self):
        """Test team start trigger and start_time recording."""
        team = "Pod_Alpha_01"
        res = self.client.post('/api/team/start', json={"team": team})
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertIsNotNone(data["start_time"])
        print("[+] PASS: Assessment start timestamp recording verified.")

    def test_03_anti_cheat_violation_tracking(self):
        """Test tab-switch detection logs violation to database."""
        team = "Pod_Alpha_01"
        res = self.client.post('/api/team/violation', json={"team": team})
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertGreaterEqual(data["violations_count"], 1)
        print("[+] PASS: Anti-cheat violation logging verified.")

    def test_04_server_side_flag_stripping(self):
        """Ensure student API never leaks the 'flag' field."""
        res = self.client.get('/api/challenges?team=Pod_Alpha_01')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        challenges = data.get("challenges", [])
        self.assertGreater(len(challenges), 0)
        for ch in challenges:
            self.assertNotIn("flag", ch, f"Flag leaked in {ch.get('id')}")
        print("[+] PASS: Server-side flag stripping verified.")

    def test_05_flag_submission(self):
        """Test submitting the demo flag."""
        team = "Pod_Alpha_01"
        res = self.client.post('/api/submit', json={
            "team": team,
            "challenge_id": "demo-01",
            "flag": "CTF{welcome_to_cyber_workshop_2026}"
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["points"], 50)
        print("[+] PASS: Flag submission verified.")

    def test_06_admin_login_and_auth(self):
        """Test admin login session creation."""
        settings = load_settings()
        admin_pass = settings.get("admin_password", "admin2026")

        # Bad password
        res1 = self.client.post('/admin/login', json={"password": "wrong"})
        self.assertEqual(res1.status_code, 401)

        # Good password
        res2 = self.client.post('/admin/login', json={"password": admin_pass})
        self.assertEqual(res2.status_code, 200)
        print("[+] PASS: Admin authentication verified.")

    def test_07_admin_delete_team(self):
        """Test deleting a specific test/demo team."""
        demo_team = "DemoTestTeam_99"
        settings = load_settings()
        self.client.post('/api/team/login', json={"name": demo_team, "room_code": settings["room_code"]})
        self.client.post('/api/submit', json={"team": demo_team, "challenge_id": "demo-01", "flag": "CTF{welcome_to_cyber_workshop_2026}"})

        # Admin logs in and deletes this demo team
        self.client.post('/admin/login', json={"password": settings.get("admin_password", "admin2026")})
        del_res = self.client.post('/api/admin/team/delete', json={"team_name": demo_team})
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.get_json()["success"])

        # Verify team is gone from leaderboard
        lb_res = self.client.get('/api/leaderboard')
        lb = lb_res.get_json()["leaderboard"]
        self.assertFalse(any(t["name"] == demo_team for t in lb))
        print("[+] PASS: Admin delete team (demo cleanup) verified.")

    def test_08_admin_challenge_toggle_and_save(self):
        """Test toggling question visibility and saving question."""
        settings = load_settings()
        self.client.post('/admin/login', json={"password": settings.get("admin_password", "admin2026")})

        # Toggle demo-01 active/hidden
        toggle_res = self.client.post('/api/admin/challenge/toggle', json={"id": "demo-01"})
        self.assertEqual(toggle_res.status_code, 200)

        # Restore
        self.client.post('/api/admin/challenge/toggle', json={"id": "demo-01"})
        print("[+] PASS: Admin question visibility toggle verified.")

    def test_09_csv_export(self):
        """Verify CSV results export."""
        res = self.client.get('/api/export/csv')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.mimetype, "text/csv")
        print("[+] PASS: CSV export verified.")

    def test_10_quiz_retrieval_and_answer_stripping(self):
        """Ensure participant quiz endpoint does NOT reveal correct answers, correctness, or explanation."""
        res = self.client.get('/api/quiz?team=Pod_Alpha_01')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertFalse(data.get("locked"))
        questions = data.get("questions", [])
        self.assertGreater(len(questions), 0)

        for q in questions:
            self.assertNotIn("correct_option", q, f"Correct option leaked in {q.get('id')}")
            self.assertNotIn("accepted_answers", q, f"Accepted answers leaked in {q.get('id')}")
            self.assertNotIn("explanation", q, f"Explanation leaked in {q.get('id')}")
            self.assertNotIn("is_correct", q, f"Correctness leaked in {q.get('id')}")
        print("[+] PASS: Quiz answer key and correctness stripping verified.")

    def test_11_quiz_mcq_submission(self):
        """Test submitting correct MCQ choice on Saturday Quiz."""
        team = "Pod_Alpha_01"
        questions = load_quiz()
        mcq_q = next((q for q in questions if q.get("type") == "mcq" and q.get("active", True)), None)
        if not mcq_q:
            mcq_q = {
                "id": "quiz-test-mcq", "title": "Test MCQ", "type": "mcq",
                "category": "General", "question": "What is 2+2?",
                "options": ["3", "4", "5"], "correct_option": 1, "points": 50, "active": True
            }
            questions.append(mcq_q)
            save_quiz(questions)

        AssessmentTestSuite.tested_mcq = mcq_q
        ans = mcq_q.get("correct_option", 0)
        res = self.client.post('/api/quiz/submit', json={
            "team": team,
            "question_id": mcq_q["id"],
            "answer": ans
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertTrue(data["is_correct"])
        self.assertEqual(data["points"], mcq_q.get("points", 50))
        print("[+] PASS: Quiz MCQ correct submission verified.")

    def test_12_quiz_short_answer_submission(self):
        """Test submitting short-answer with case-insensitivity on Saturday Quiz."""
        team = "Pod_Alpha_01"
        questions = load_quiz()
        sa_q = next((q for q in questions if q.get("type") == "short_answer" and q.get("active", True)), None)
        if not sa_q:
            sa_q = {
                "id": "quiz-test-sa", "title": "Test Short Answer", "type": "short_answer",
                "category": "General", "question": "What is HTTPS port?",
                "accepted_answers": ["443", "port 443"], "points": 50, "active": True
            }
            questions.append(sa_q)
            save_quiz(questions)

        AssessmentTestSuite.tested_sa = sa_q
        ans = sa_q.get("accepted_answers", ["443"])[0]
        res = self.client.post('/api/quiz/submit', json={
            "team": team,
            "question_id": sa_q["id"],
            "answer": ans.upper()  # Test case-insensitivity
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertTrue(data["is_correct"])
        self.assertEqual(data["points"], sa_q.get("points", 50))
        print("[+] PASS: Quiz short-answer case-insensitive submission verified.")

    def test_13_quiz_duplicate_submission_prevention(self):
        """Ensure a pod cannot submit an answer after finalizing the quiz."""
        team = "Pod_Alpha_01"
        # 1. Finalize quiz
        fin_res = self.client.post('/api/quiz/finish', json={"team": team})
        self.assertEqual(fin_res.status_code, 200)
        self.assertTrue(fin_res.get_json()["success"])

        # 2. Attempt to submit again after finalization
        qid = getattr(AssessmentTestSuite, 'tested_mcq', {}).get("id", "quiz-01")
        res = self.client.post('/api/quiz/submit', json={
            "team": team,
            "question_id": qid,
            "answer": 0
        })
        self.assertEqual(res.status_code, 400)
        data = res.get_json()
        self.assertFalse(data["success"])
        self.assertIn("already", data["message"].lower())
        print("[+] PASS: Quiz finalization and submission lock verified.")

    def test_14_combined_leaderboard_scoring(self):
        """Verify combined leaderboard math: Total = Quiz Points + max(0, CTF Gross - CTF Deductions)."""
        res = self.client.get('/api/leaderboard')
        self.assertEqual(res.status_code, 200)
        lb = res.get_json()["leaderboard"]
        pod = next((t for t in lb if t["name"] == "Pod_Alpha_01"), None)
        self.assertIsNotNone(pod)

        expected_quiz_points = (
            getattr(AssessmentTestSuite, 'tested_mcq', {}).get("points", 50) +
            getattr(AssessmentTestSuite, 'tested_sa', {}).get("points", 50)
        )
        self.assertEqual(pod["quiz_points"], expected_quiz_points)
        self.assertEqual(pod["ctf_gross"], 50)
        self.assertEqual(pod["total_score"], 50 + expected_quiz_points)
        print("[+] PASS: Combined leaderboard scoring math verified.")

    def test_15_section_status_and_lock_controls(self):
        """Test locking a section and confirming participant requests are blocked."""
        settings = load_settings()
        # Lock CTF section
        settings["ctf_enabled"] = False
        settings["ctf_mode"] = "manual"
        save_settings(settings)

        # Try to submit flag
        res = self.client.post('/api/submit', json={
            "team": "Pod_Beta_99",
            "challenge_id": "demo-01",
            "flag": "CTF{welcome_to_cyber_workshop_2026}"
        })
        self.assertEqual(res.status_code, 403)
        self.assertFalse(res.get_json()["success"])

        # Re-enable CTF
        settings["ctf_enabled"] = True
        save_settings(settings)
        print("[+] PASS: Section status & lock controls verified.")

    def test_16_admin_quiz_crud(self):
        """Test organizer adding, toggling, and deleting quiz questions."""
        settings = load_settings()
        self.client.post('/admin/login', json={"password": settings.get("admin_password", "admin2026")})

        # 1. Create new MCQ question
        new_q = {
            "title": "Automated Test Question",
            "type": "mcq",
            "category": "Testing",
            "points": 75,
            "question": "What does HTTP stand for?",
            "options": ["HyperText Transfer Protocol", "High Tech Transport Program", "Host Text Transfer Path", "None"],
            "correct_option": 0,
            "explanation": "Standard web transfer protocol."
        }
        create_res = self.client.post('/api/admin/quiz/save', json=new_q)
        self.assertEqual(create_res.status_code, 200)
        created_id = create_res.get_json()["question"]["id"]

        # 2. Toggle active status
        tog_res = self.client.post('/api/admin/quiz/toggle', json={"id": created_id})
        self.assertEqual(tog_res.status_code, 200)

        # 3. Delete question
        del_res = self.client.post('/api/admin/quiz/delete', json={"id": created_id})
        self.assertEqual(del_res.status_code, 200)
        print("[+] PASS: Admin Quiz CRUD verified.")

if __name__ == "__main__":
    unittest.main(verbosity=2)
