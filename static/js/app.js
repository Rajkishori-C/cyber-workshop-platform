/**
 * 2-DAY CYBER WORKSHOP PLATFORM - CLIENT APPLICATION
 * Features:
 * - Role Selection Gateway (Student Pod vs Workshop Organizer)
 * - Strict Fullscreen Gating (Questions 100% hidden until assessment starts)
 * - Real-Time Team Session Sync (Reflects Admin Deletions / Wipes Instantly)
 * - Student Logout / Leave Pod
 * - Fullscreen Lock & Tab-Switch Anti-Cheat Tracker
 * - Closed Section Messaging ("Quiz / CTF will be enabled by team")
 * - Personal Score and Standings Tracking
 */

// State
let currentTeam = localStorage.getItem('ctf_team') || '';
let currentSection = 'quiz'; // 'quiz' or 'ctf'
let sectionsStatus = { quiz: { is_open: false }, ctf: { is_open: false } };
let quizData = [];
let challengesData = [];

// Timer & Assessment State
let assessmentStartTime = null;
let timerDurationMinutes = 60;
let timerInterval = null;
let isAssessmentStarted = false;
let violationCount = 0;
let isHandlingViolation = false;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();

  if (currentTeam) {
    updateTeamUI(currentTeam);
    await verifyCurrentTeam();
  } else {
    updateTeamUI(null);
    showRoleGateway();
  }

  await refreshSectionStatus();
  await loadQuizData();
  await loadCTFData();
  await updatePodScore();

  // Polling intervals (Optimized for 135+ simultaneous participants)
  setInterval(updatePodScore, 6000);
  setInterval(refreshSectionStatus, 5000);
  setInterval(verifyCurrentTeam, 8000);
});

function setupEventListeners() {
  // Section Navigation Tabs (Quiz vs CTF)
  document.querySelectorAll('.section-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.section-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSection = btn.getAttribute('data-section');
      switchSectionView(currentSection);
    });
  });

  // Team login form
  const loginForm = document.getElementById('teamLoginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('teamNameInput').value.trim();
      const roomCode = document.getElementById('roomCodeInput').value.trim();
      if (name && roomCode) {
        registerTeam(name, roomCode);
      }
    });
  }

  // Change team button
  const changeBtn = document.getElementById('btnChangeTeam');
  if (changeBtn) {
    changeBtn.addEventListener('click', () => showRoleGateway());
  }

  // Student Logout button
  const logoutBtn = document.getElementById('btnLogoutTeam');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm(`Are you sure you want to log out of pod "${currentTeam}"?`)) {
        logoutStudent("Logged out of pod.");
      }
    });
  }

  // Anti-Cheat: Fullscreen Change Listener
  document.addEventListener('fullscreenchange', () => {
    const isFull = !!document.fullscreenElement;
    const badge = document.getElementById('fullscreenStatusBadge');
    const reEnterBtn = document.getElementById('btnEnterFullscreen');

    if (badge) {
      badge.textContent = isFull ? '⛶ FULLSCREEN LOCKED' : '⚠️ FULLSCREEN EXITED';
      badge.className = `badge ${isFull ? 'badge-easy' : 'badge-hard'}`;
    }
    if (reEnterBtn) {
      reEnterBtn.style.display = isFull ? 'none' : 'inline-flex';
    }

    function isInputElementActive() {
      const el = document.activeElement;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    }

    if (!isFull && isAssessmentStarted && !isInputElementActive()) {
      triggerScreenViolation("Fullscreen mode exited");
    }
  });

  // Anti-Cheat: Tab Visibility Listener
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isAssessmentStarted) {
      triggerScreenViolation("Tab switched or minimized");
    }
  });

  // Anti-Cheat: Window Blur Listener (Ignore if typing in an input)
  window.addEventListener('blur', () => {
    const el = document.activeElement;
    const isTyping = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    if (isAssessmentStarted && !isTyping) {
      triggerScreenViolation("Window focus lost");
    }
  });
}

// -------------------------------------------------------------
// Role Gateway Controls
// -------------------------------------------------------------
function showRoleGateway() {
  closeTeamModal();
  const modal = document.getElementById('roleGatewayModal');
  if (modal) modal.style.display = 'flex';
}

function closeRoleGateway() {
  const modal = document.getElementById('roleGatewayModal');
  if (modal) modal.style.display = 'none';
}

function selectRole(role) {
  if (role === 'admin') {
    window.location.href = '/admin/login';
  } else {
    closeRoleGateway();
    showTeamModal();
  }
}

// -------------------------------------------------------------
// Team Registration & Session Verification (Admin Wipe Reflection)
// -------------------------------------------------------------
function showTeamModal() {
  closeRoleGateway();
  const modal = document.getElementById('teamModal');
  if (modal) modal.style.display = 'flex';
}

function closeTeamModal() {
  const modal = document.getElementById('teamModal');
  if (modal) modal.style.display = 'none';
}

async function registerTeam(name, roomCode) {
  try {
    const res = await fetch('/api/team/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, room_code: roomCode })
    });
    const data = await res.json();
    if (data.success) {
      currentTeam = data.team;
      localStorage.setItem('ctf_team', currentTeam);
      updateTeamUI(currentTeam);
      closeTeamModal();
      closeRoleGateway();
      showToast(`Welcome, ${escapeHtml(currentTeam)}!`, 'success');

      if (data.start_time) {
        initAssessmentTimer(data.start_time);
      }

      await loadQuizData();
      await loadCTFData();
      await updatePodScore();
    } else {
      showToast(data.message || 'Invalid Room Code or Name.', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to server.', 'error');
  }
}

function updateTeamUI(name) {
  const badge = document.getElementById('teamBadgeName');
  const changeBtn = document.getElementById('btnChangeTeam');
  const logoutBtn = document.getElementById('btnLogoutTeam');
  const scoreVal = document.getElementById('teamPointsVal');

  if (name) {
    if (badge) badge.textContent = name;
    if (changeBtn) changeBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
  } else {
    if (badge) badge.textContent = 'Not Joined';
    if (scoreVal) scoreVal.textContent = '0 pts';
    if (changeBtn) changeBtn.style.display = 'inline-flex';
    if (logoutBtn) logoutBtn.style.display = 'none';
    hideAssessmentUI();
  }
}

function logoutStudent(toastMsg) {
  currentTeam = '';
  localStorage.removeItem('ctf_team');
  isAssessmentStarted = false;
  if (timerInterval) clearInterval(timerInterval);

  updateTeamUI(null);
  hideAssessmentUI();

  if (toastMsg) showToast(toastMsg, 'info');
  showRoleGateway();

  loadQuizData();
  loadCTFData();
}

/**
 * Checks if the current team still exists in the database.
 * If the admin deleted the team or wiped all contestants,
 * this automatically logs out the student and resets their view!
 */
async function verifyCurrentTeam() {
  if (!currentTeam) return;
  try {
    const res = await fetch(`/api/team/status?team=${encodeURIComponent(currentTeam)}`);
    const data = await res.json();
    if (!data.exists) {
      // Pod was deleted or wiped by admin!
      logoutStudent("Your pod was cleared or reset by the event organizer. Please rejoin.");
    } else if (data.start_time && !isAssessmentStarted) {
      initAssessmentTimer(data.start_time);
    }
  } catch (err) {}
}

// -------------------------------------------------------------
// Fullscreen & Assessment Timer Controls
// -------------------------------------------------------------
function showStartAssessmentCard() {
  const card = document.getElementById('startAssessmentCard');
  if (card && currentTeam && !isAssessmentStarted) {
    card.style.display = 'block';
  }
}

function hideStartAssessmentCard() {
  const card = document.getElementById('startAssessmentCard');
  if (card) card.style.display = 'none';
}

function hideAssessmentUI() {
  hideStartAssessmentCard();
  const bar = document.getElementById('assessmentBar');
  const violModal = document.getElementById('violationModal');
  if (bar) bar.style.display = 'none';
  if (violModal) violModal.style.display = 'none';
}

function requestAssessmentFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

async function startAssessmentWithFullscreen() {
  if (!currentTeam) {
    showRoleGateway();
    return;
  }

  requestAssessmentFullscreen();

  try {
    const res = await fetch('/api/team/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: currentTeam })
    });
    const data = await res.json();
    if (data.success && data.start_time) {
      initAssessmentTimer(data.start_time);
      showToast("Assessment started! Fullscreen locked.", "success");
      renderQuiz();
      renderCTF();
    }
  } catch (err) {
    showToast("Error starting assessment", "error");
  }
}

function initAssessmentTimer(startTimeStr) {
  isAssessmentStarted = true;
  assessmentStartTime = new Date(startTimeStr.replace(' ', 'T'));

  hideStartAssessmentCard();
  const bar = document.getElementById('assessmentBar');
  if (bar) bar.style.display = 'block';

  if (timerInterval) clearInterval(timerInterval);
  updateCountdown();
  timerInterval = setInterval(updateCountdown, 1000);

  // Render questions now that assessment is started
  if (currentSection === 'quiz') {
    renderQuiz();
  } else {
    renderCTF();
  }
}

function updateCountdown() {
  if (!assessmentStartTime) return;
  const now = new Date();
  const elapsedSeconds = Math.floor((now - assessmentStartTime) / 1000);
  const totalSeconds = timerDurationMinutes * 60;
  const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);

  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const timerEl = document.getElementById('assessmentCountdown');

  if (timerEl) {
    timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    if (remainingSeconds <= 300) {
      timerEl.style.color = 'var(--neon-red)';
    } else {
      timerEl.style.color = 'var(--neon-green)';
    }
  }

  if (remainingSeconds === 0) {
    clearInterval(timerInterval);
    showToast("Assessment time has expired!", "error");
  }
}

async function triggerScreenViolation(reason) {
  if (!currentTeam || !isAssessmentStarted || isHandlingViolation) return;
  isHandlingViolation = true;

  violationCount++;

  try {
    const res = await fetch('/api/team/violation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: currentTeam })
    });
    const data = await res.json();
    if (data.success) {
      violationCount = data.violations_count || violationCount;
    }
  } catch (e) {}

  const modal = document.getElementById('violationModal');
  const countText = document.getElementById('violationCountText');
  if (countText) {
    countText.textContent = `Violation #${violationCount} Recorded (${reason})`;
  }
  if (modal) modal.style.display = 'flex';

  setTimeout(() => { isHandlingViolation = false; }, 1500);
}

function resumeAssessmentFullscreen() {
  requestAssessmentFullscreen();
  const modal = document.getElementById('violationModal');
  if (modal) modal.style.display = 'none';
}

// -------------------------------------------------------------
// Section Switcher & Status
// -------------------------------------------------------------
async function refreshSectionStatus() {
  try {
    const res = await fetch('/api/sections/status');
    const data = await res.json();
    sectionsStatus = data;
    if (data.timer_duration_minutes) {
      timerDurationMinutes = data.timer_duration_minutes;
    }

    const quizTag = document.getElementById('quizStatusTag');
    const ctfTag = document.getElementById('ctfStatusTag');

    if (quizTag) {
      const open = sectionsStatus.quiz && sectionsStatus.quiz.is_open;
      quizTag.textContent = open ? 'OPEN' : 'LOCKED';
      quizTag.className = `section-status-tag ${open ? 'status-open' : 'status-locked'}`;
    }

    if (ctfTag) {
      const open = sectionsStatus.ctf && sectionsStatus.ctf.is_open;
      ctfTag.textContent = open ? 'OPEN' : 'LOCKED';
      ctfTag.className = `section-status-tag ${open ? 'status-open' : 'status-locked'}`;
    }

    // Re-render current section view to reflect lock immediately
    if (currentSection === 'quiz') {
      renderQuiz();
    } else {
      renderCTF();
    }
  } catch (err) {}
}

function switchSectionView(section) {
  const quizView = document.getElementById('quizSectionView');
  const ctfView = document.getElementById('ctfSectionView');

  if (section === 'quiz') {
    if (quizView) quizView.style.display = 'block';
    if (ctfView) ctfView.style.display = 'none';
    renderQuiz();
  } else {
    if (quizView) quizView.style.display = 'none';
    if (ctfView) ctfView.style.display = 'block';
    renderCTF();
  }
}

// -------------------------------------------------------------
// Quiz Section (Saturday)
// -------------------------------------------------------------
async function loadQuizData() {
  try {
    const url = currentTeam ? `/api/quiz?team=${encodeURIComponent(currentTeam)}` : '/api/quiz';
    const res = await fetch(url);
    const data = await res.json();

    if (data.locked) {
      if (sectionsStatus.quiz) sectionsStatus.quiz.is_open = false;
      quizData = [];
    } else {
      quizData = data.questions || [];
    }
    renderQuiz();
  } catch (err) {}
}

function renderQuiz() {
  const container = document.getElementById('quizQuestionsContainer');
  const infoBanner = document.getElementById('quizInfoBanner');
  if (!container) return;

  // 1. Check if Quiz section is locked / closed
  if (!sectionsStatus.quiz || !sectionsStatus.quiz.is_open) {
    if (infoBanner) infoBanner.style.display = 'none';
    hideStartAssessmentCard();
    container.innerHTML = `
      <div class="locked-section-card">
        <div class="locked-icon">🔒</div>
        <h2 style="color: var(--text-bright); margin-bottom: 8px;">SATURDAY QUIZ SECTION IS CLOSED</h2>
        <div class="badge badge-hard" style="font-size: 1.05rem; padding: 6px 18px; margin: 12px auto; display: inline-block;">
          QUIZ WILL BE ENABLED BY TEAM
        </div>
        <p style="color: var(--text-muted); font-size: 1rem; max-width: 520px; margin: 0 auto;">
          Please wait for the workshop mentors to open this section. Once enabled, you will be able to start your assessment!
        </p>
      </div>
    `;
    return;
  }

  // 2. Section is open, but pod not joined
  if (!currentTeam) {
    if (infoBanner) infoBanner.style.display = 'none';
    hideStartAssessmentCard();
    container.innerHTML = `
      <div class="locked-section-card">
        <div class="locked-icon">👥</div>
        <h2 style="color: var(--text-bright); margin-bottom: 8px;">JOIN YOUR POD TO BEGIN</h2>
        <p style="color: var(--text-muted); font-size: 1rem; max-width: 520px; margin: 12px auto;">
          Please enter with your pod name and whiteboard room passcode to view questions.
        </p>
        <button class="btn-cyber btn-cyan" onclick="showTeamModal()" style="margin-top: 12px; font-size: 1rem; padding: 10px 24px;">
          Join Workshop Pod
        </button>
      </div>
    `;
    return;
  }

  // 3. Section is open, pod joined, but assessment NOT started in fullscreen
  if (!isAssessmentStarted) {
    if (infoBanner) infoBanner.style.display = 'none';
    showStartAssessmentCard();
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 30px 20px; font-size: 1rem;">
        🔒 Questions are locked until you click <strong>"Start Assessment & Lock Fullscreen"</strong> above.
      </div>
    `;
    return;
  }

  // 4. Assessment is active and fullscreen started
  hideStartAssessmentCard();
  if (infoBanner) infoBanner.style.display = 'block';

  if (quizData.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px;">No quiz questions available yet.</div>`;
    return;
  }

  container.innerHTML = quizData.map((q, idx) => {
    const isAnswered = q.answered;
    const isCorrect = q.is_correct;

    let inputHtml = '';
    if (q.type === 'mcq') {
      inputHtml = `<div class="mcq-options-group">` + (q.options || []).map((opt, optIdx) => {
        const isChecked = isAnswered && String(q.submitted_answer) === String(optIdx);
        return `
          <label class="mcq-option-label ${isChecked ? 'selected' : ''}">
            <input 
              type="radio" 
              name="quiz_choice_${q.id}" 
              value="${optIdx}" 
              ${isChecked ? 'checked' : ''} 
              ${isAnswered ? 'disabled' : ''}
              onchange="handleMcqSelect('${q.id}', this)"
            >
            <span>${escapeHtml(opt)}</span>
          </label>
        `;
      }).join('') + `</div>`;
    } else {
      inputHtml = `
        <div style="margin: 14px 0;">
          <input 
            type="text" 
            id="quiz_text_${q.id}" 
            class="flag-input" 
            style="width: 100%; font-size: 1rem;" 
            placeholder="Type your answer..." 
            value="${isAnswered ? escapeHtml(q.submitted_answer) : ''}" 
            ${isAnswered ? 'disabled' : ''}
            autocomplete="off"
            required
          >
        </div>
      `;
    }

    let statusBanner = '';
    if (isAnswered) {
      if (isCorrect) {
        statusBanner = `
          <div class="solved-banner" style="display:inline-flex; margin-bottom: 10px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            CORRECT ANSWER (+${q.points_awarded} PTS)
          </div>
        `;
      } else {
        statusBanner = `
          <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid var(--neon-red); color: var(--neon-red); padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 0.85rem; margin-bottom: 10px; display: inline-flex; align-items: center; gap: 6px;">
            ✕ INCORRECT (0 PTS)
          </div>
        `;
      }
    }

    let explanationHtml = '';
    if (isAnswered && q.explanation) {
      explanationHtml = `
        <div style="background: #101726; border: 1px solid var(--border-color); padding: 12px 16px; border-radius: 6px; font-size: 0.9rem; color: #a5b4fc; margin-top: 12px;">
          <strong>Explanation:</strong> ${escapeHtml(q.explanation)}
        </div>
      `;
    }

    return `
      <div class="challenge-card ${isAnswered ? (isCorrect ? 'solved' : '') : ''}" id="card-${q.id}">
        <div class="card-header">
          <div class="card-tags">
            <span class="badge badge-cat" style="font-weight: 800;">QUIZ #${idx + 1}</span>
            <span class="badge badge-cat">${escapeHtml(q.category)}</span>
            <span class="badge badge-easy">${q.type === 'mcq' ? 'Multiple Choice' : 'Short Answer'}</span>
          </div>
          <div class="points-pill">+${q.points} pts</div>
        </div>

        <div class="card-title">${escapeHtml(q.title)}</div>
        ${statusBanner}

        <div class="card-desc">
          ${escapeHtml(q.question)}
        </div>

        <form onsubmit="handleQuizSubmit(event, '${q.id}', '${q.type}')">
          ${inputHtml}
          ${explanationHtml}

          <div style="margin-top: 16px;">
            <button type="submit" class="btn-cyber btn-cyan" ${isAnswered ? 'disabled' : ''}>
              ${isAnswered ? 'Submitted' : 'Submit Answer'}
            </button>
          </div>
        </form>
      </div>
    `;
  }).join('');
}

function handleMcqSelect(qid, input) {
  const card = document.getElementById(`card-${qid}`);
  if (!card) return;
  card.querySelectorAll('.mcq-option-label').forEach(lbl => lbl.classList.remove('selected'));
  input.closest('.mcq-option-label').classList.add('selected');
}

async function handleQuizSubmit(event, questionId, qType) {
  event.preventDefault();
  if (!currentTeam) {
    showToast('Please join your pod first!', 'error');
    showTeamModal();
    return;
  }

  let answerVal = null;
  if (qType === 'mcq') {
    const selected = document.querySelector(`input[name="quiz_choice_${questionId}"]:checked`);
    if (!selected) {
      showToast('Please select an option before submitting.', 'error');
      return;
    }
    answerVal = parseInt(selected.value);
  } else {
    const input = document.getElementById(`quiz_text_${questionId}`);
    if (!input || !input.value.trim()) {
      showToast('Please enter an answer before submitting.', 'error');
      return;
    }
    answerVal = input.value.trim();
  }

  const btn = event.target.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/quiz/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        team: currentTeam,
        question_id: questionId,
        answer: answerVal
      })
    });
    const data = await res.json();
    if (data.success) {
      if (data.is_correct) {
        showToast(data.message, 'success');
      } else {
        showToast(data.message, 'error');
      }
      await loadQuizData();
      await updatePodScore();
    } else {
      showToast(data.message || 'Error submitting answer.', 'error');
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    showToast('Failed to submit answer.', 'error');
    if (btn) btn.disabled = false;
  }
}

// -------------------------------------------------------------
// CTF Section (Sunday)
// -------------------------------------------------------------
async function loadCTFData() {
  try {
    const url = currentTeam ? `/api/challenges?team=${encodeURIComponent(currentTeam)}` : '/api/challenges';
    const res = await fetch(url);
    const data = await res.json();

    if (data.locked) {
      if (sectionsStatus.ctf) sectionsStatus.ctf.is_open = false;
      challengesData = [];
    } else {
      challengesData = data.challenges || [];
    }
    renderCTF();
  } catch (err) {}
}

function renderCTF() {
  const container = document.getElementById('ctfQuestionsContainer');
  const infoBanner = document.getElementById('ctfInfoBanner');
  if (!container) return;

  // 1. Check if CTF section is locked / closed
  if (!sectionsStatus.ctf || !sectionsStatus.ctf.is_open) {
    if (infoBanner) infoBanner.style.display = 'none';
    hideStartAssessmentCard();
    container.innerHTML = `
      <div class="locked-section-card">
        <div class="locked-icon">🔒</div>
        <h2 style="color: var(--text-bright); margin-bottom: 8px;">SUNDAY CTF ARENA IS CLOSED</h2>
        <div class="badge badge-hard" style="font-size: 1.05rem; padding: 6px 18px; margin: 12px auto; display: inline-block;">
          CTF WILL BE ENABLED BY TEAM
        </div>
        <p style="color: var(--text-muted); font-size: 1rem; max-width: 520px; margin: 0 auto;">
          Please wait for the workshop mentors to open this section. Once enabled, flag challenges will appear automatically!
        </p>
      </div>
    `;
    return;
  }

  // 2. Section is open, but pod not joined
  if (!currentTeam) {
    if (infoBanner) infoBanner.style.display = 'none';
    hideStartAssessmentCard();
    container.innerHTML = `
      <div class="locked-section-card">
        <div class="locked-icon">👥</div>
        <h2 style="color: var(--text-bright); margin-bottom: 8px;">JOIN YOUR POD TO BEGIN</h2>
        <p style="color: var(--text-muted); font-size: 1rem; max-width: 520px; margin: 12px auto;">
          Please enter with your pod name and whiteboard room passcode to view challenges.
        </p>
        <button class="btn-cyber btn-cyan" onclick="showTeamModal()" style="margin-top: 12px; font-size: 1rem; padding: 10px 24px;">
          Join Workshop Pod
        </button>
      </div>
    `;
    return;
  }

  // 3. Section is open, pod joined, but assessment NOT started in fullscreen
  if (!isAssessmentStarted) {
    if (infoBanner) infoBanner.style.display = 'none';
    showStartAssessmentCard();
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 30px 20px; font-size: 1rem;">
        🔒 Challenges are locked until you click <strong>"Start Assessment & Lock Fullscreen"</strong> above.
      </div>
    `;
    return;
  }

  // 4. Assessment is active and fullscreen started
  hideStartAssessmentCard();
  if (infoBanner) infoBanner.style.display = 'block';

  if (challengesData.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px;">No CTF challenges available yet.</div>`;
    return;
  }

  container.innerHTML = challengesData.map((ch, idx) => {
    const isSolved = ch.solved;

    let hintHtml = '';
    if (ch.has_hint) {
      if (ch.hint_unlocked && ch.hint) {
        hintHtml = `
          <div style="background:#1f190a; border:1px dashed var(--neon-amber); color:#fef3c7; padding:10px 14px; border-radius:6px; font-size:0.9rem; margin:14px 0;">
            <strong>[!] HINT:</strong> ${escapeHtml(ch.hint)}
          </div>
        `;
      } else {
        hintHtml = `
          <div style="margin: 12px 0;">
            <button type="button" class="btn-cyber" style="border-color: var(--neon-amber); color: var(--neon-amber); font-size:0.85rem;" onclick="unlockCTFHint('${escapeHtml(ch.id)}')">
              Unlock Hint (-${ch.hint_cost} pts)
            </button>
          </div>
        `;
      }
    }

    return `
      <div class="challenge-card ${isSolved ? 'solved' : ''}" id="ctf-card-${ch.id}">
        <div class="card-header">
          <div class="card-tags">
            <span class="badge badge-cat" style="font-weight: 800;">CTF #${idx + 1}</span>
            <span class="badge badge-cat">${escapeHtml(ch.category)}</span>
            <span class="badge badge-${escapeHtml(ch.difficulty)}">${escapeHtml(ch.difficulty)}</span>
          </div>
          <div class="points-pill">+${ch.points} pts</div>
        </div>

        <div class="card-title">${escapeHtml(ch.title)}</div>

        <div class="solved-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          FLAG CAPTURED (+${ch.points} PTS)
        </div>

        <div class="card-desc">
          ${ch.description}
        </div>

        ${hintHtml}

        <form class="submit-group" style="margin-top: 16px;" onsubmit="handleCTFSubmit(event, '${escapeHtml(ch.id)}')">
          <input 
            type="text" 
            class="flag-input" 
            id="flag-${escapeHtml(ch.id)}" 
            placeholder="${isSolved ? 'Completed!' : 'CTF{...}'}" 
            ${isSolved ? 'disabled' : ''} 
            autocomplete="off"
            required
          >
          <button type="submit" class="btn-cyber btn-green btn-submit" ${isSolved ? 'disabled' : ''}>
            ${isSolved ? 'Captured' : 'Submit Flag'}
          </button>
        </form>
      </div>
    `;
  }).join('');
}

async function handleCTFSubmit(event, challengeId) {
  event.preventDefault();
  if (!currentTeam) {
    showToast('Please join your pod first!', 'error');
    showTeamModal();
    return;
  }

  const input = document.getElementById(`flag-${challengeId}`);
  if (!input) return;
  const flag = input.value.trim();
  if (!flag) return;

  const btn = event.target.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        team: currentTeam,
        challenge_id: challengeId,
        flag: flag
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      await loadCTFData();
      await updatePodScore();
    } else {
      showToast(data.message, 'error');
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    showToast('Network error submitting flag.', 'error');
    if (btn) btn.disabled = false;
  }
}

async function unlockCTFHint(challengeId) {
  if (!confirm("Unlocking this hint will deduct points from your CTF score. Proceed?")) return;
  try {
    const res = await fetch('/api/hint/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: currentTeam, challenge_id: challengeId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Hint unlocked! (-${data.penalty} pts)`, 'info');
      await loadCTFData();
      await updatePodScore();
    }
  } catch (err) {}
}

// -------------------------------------------------------------
// Pod Standings & Score Sync (Leaderboard is for Organizer/Projector)
// -------------------------------------------------------------
async function updatePodScore() {
  if (!currentTeam) return;
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();
    const board = data.leaderboard || [];

    const myPod = board.find(t => t.name.toLowerCase() === currentTeam.toLowerCase());
    const scoreBadge = document.getElementById('teamPointsVal');
    if (myPod) {
      if (scoreBadge) {
        scoreBadge.textContent = `${myPod.total_score} pts (Quiz: ${myPod.quiz_points} | CTF: ${myPod.ctf_net})`;
      }
      if (myPod.violations_count !== undefined) {
        violationCount = myPod.violations_count;
      }
    }
  } catch (err) {}
}

function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
