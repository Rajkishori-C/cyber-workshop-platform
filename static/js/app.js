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
let isCtfAssessmentStarted = false;
let violationCount = 0;
let isHandlingViolation = false;

function isAntiCheatActive() {
  if (!currentTeam) return false;
  if (currentSection === 'quiz') {
    return isAssessmentStarted && !quizCompletedState;
  }
  if (currentSection === 'ctf') {
    return isCtfAssessmentStarted;
  }
  return false;
}

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
    if (!isAntiCheatActive()) return;
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

    if (!isFull && !isInputElementActive()) {
      triggerScreenViolation("Fullscreen mode exited");
    }
  });

  // Anti-Cheat: Tab Visibility Listener
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isAntiCheatActive()) {
      triggerScreenViolation("Tab switched or minimized");
    }
  });

  // Anti-Cheat: Window Blur Listener (Ignore if typing in an input)
  window.addEventListener('blur', () => {
    const el = document.activeElement;
    const isTyping = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    if (isAntiCheatActive() && !isTyping) {
      triggerScreenViolation("Window focus lost");
    }
  });

  // Anti-Cheat: Prevent Copying Questions into AI tools
  document.addEventListener('copy', (e) => {
    const el = document.activeElement;
    const isTyping = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    if (!isTyping && isAntiCheatActive()) {
      e.preventDefault();
      showToast("⚠️ Copying question text is disabled during assessment.", "error");
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

  if (name) {
    if (badge) badge.textContent = name;
    if (changeBtn) changeBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
  } else {
    if (badge) badge.textContent = 'Not Joined';
    if (changeBtn) changeBtn.style.display = 'inline-flex';
    if (logoutBtn) logoutBtn.style.display = 'none';
    hideAssessmentUI();
  }
}

function logoutStudent(toastMsg) {
  fetch('/api/team/logout', { method: 'POST' }).catch(() => {});
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  currentTeam = '';
  localStorage.removeItem('ctf_team');
  isAssessmentStarted = false;
  isCtfAssessmentStarted = false;
  quizCompletedState = false;
  hasPromptedAllAnswered = false;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  updateTeamUI(null);
  hideAssessmentUI();

  if (toastMsg) showToast(toastMsg, 'info');
  showRoleGateway();

  loadQuizData(true);
  loadCTFData(true);
}

/**
 * Checks if the current team still exists in the database.
 * If the admin deleted the team or wiped all contestants,
 * this automatically logs out the student and resets their view!
 */
async function verifyCurrentTeam() {
  if (!currentTeam) return;
  try {
    const res = await fetch(`/api/team/status?team=${encodeURIComponent(currentTeam)}`, { cache: 'no-store' });
    const data = await res.json();
    if (!data.exists) {
      // Pod was deleted or wiped by admin!
      logoutStudent("Your pod was cleared or reset by the event organizer. Please rejoin.");
    } else if (data.quiz_completed) {
      quizCompletedState = true;
      isAssessmentStarted = false;
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      hideAssessmentUI();
    } else if (data.start_time && !isAssessmentStarted && !quizCompletedState) {
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

function startCtfWithFullscreen() {
  if (!currentTeam) {
    showRoleGateway();
    return;
  }
  requestAssessmentFullscreen();
  isCtfAssessmentStarted = true;
  showToast("CTF Arena started! Fullscreen locked.", "success");
  renderCTF();
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
    if (!quizCompletedState && currentSection === 'quiz') {
      submitFinalQuizAuto();
    }
  }
}

async function triggerScreenViolation(reason) {
  if (!isAntiCheatActive() || !currentTeam || isHandlingViolation) return;
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

function isStudentTyping(containerId) {
  const container = document.getElementById(containerId);
  const el = document.activeElement;
  return !!(el && container && container.contains(el) && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'));
}

// -------------------------------------------------------------
// Section Switcher & Status
// -------------------------------------------------------------
async function refreshSectionStatus() {
  try {
    const res = await fetch('/api/sections/status', { cache: 'no-store' });
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

    // Live refresh data from server to catch admin deletions/additions
    if (currentSection === 'quiz') {
      await loadQuizData(false);
    } else {
      await loadCTFData(false);
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
    hideStartAssessmentCard();
    renderCTF();
  }
}

// -------------------------------------------------------------
// Quiz Section (Saturday)
// -------------------------------------------------------------
let quizCompletedState = false;
let lastQuizSignature = '';

async function loadQuizData(forceRender = false) {
  try {
    const url = currentTeam ? `/api/quiz?team=${encodeURIComponent(currentTeam)}` : '/api/quiz';
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();

    const isLocked = Boolean(data.locked);
    if (data.locked) {
      if (sectionsStatus.quiz) sectionsStatus.quiz.is_open = false;
      quizData = [];
    } else {
      quizData = data.questions || [];
      const newCompleted = Boolean(data.quiz_completed);
      if (newCompleted && !quizCompletedState) {
        quizCompletedState = true;
        isAssessmentStarted = false;
        if (timerInterval) clearInterval(timerInterval);
        hideAssessmentUI();
      }
      quizCompletedState = newCompleted;
    }

    const currentSignature = JSON.stringify({
      locked: isLocked,
      completed: quizCompletedState,
      questions: quizData.map(q => ({
        id: q.id,
        title: q.title,
        question: q.question,
        answered: q.answered,
        sub: q.submitted_answer,
        type: q.type,
        opts: q.options
      }))
    });

    const hasChanged = currentSignature !== lastQuizSignature;
    lastQuizSignature = currentSignature;

    const isTyping = isStudentTyping('quizQuestionsContainer');
    if (forceRender || (hasChanged && !isTyping)) {
      renderQuiz();
    } else if (hasChanged && isTyping) {
      // Safely remove any deleted question cards without disturbing active typing inputs
      const activeIds = new Set(quizData.map(q => q.id));
      document.querySelectorAll('#quizQuestionsContainer .challenge-card').forEach(card => {
        const id = card.id.replace('card-', '');
        if (id && !activeIds.has(id)) {
          card.remove();
        }
      });
      updateQuizProgressCount();
    }
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
  if (!isAssessmentStarted && !quizCompletedState) {
    if (infoBanner) infoBanner.style.display = 'none';
    showStartAssessmentCard();
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 30px 20px; font-size: 1rem;">
        🔒 Questions are locked until you click <strong>"Start Assessment & Lock Fullscreen"</strong> above.
      </div>
    `;
    return;
  }

  // 4. Assessment is active and fullscreen started (or finalized)
  hideStartAssessmentCard();
  if (infoBanner) infoBanner.style.display = quizCompletedState ? 'none' : 'block';

  if (quizData.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px;">No quiz questions available yet.</div>`;
    return;
  }

  const answeredCount = quizData.filter(q => q.answered).length;

  const cardsHtml = quizData.map((q, idx) => {
    const isAnswered = q.answered;

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
              ${quizCompletedState ? 'disabled' : ''}
              onchange="handleMcqSelect('${q.id}', ${optIdx})"
            >
            <span>${escapeHtml(opt)}</span>
          </label>
        `;
      }).join('') + `</div>`;
    } else {
      inputHtml = `
        <div style="margin: 14px 0; display: flex; gap: 10px; flex-wrap: wrap;">
          <input 
            type="text" 
            id="quiz_text_${q.id}" 
            class="flag-input" 
            style="flex: 1; min-width: 220px; font-size: 1rem;" 
            placeholder="Type your answer..." 
            value="${isAnswered ? escapeHtml(q.submitted_answer) : ''}" 
            ${quizCompletedState ? 'disabled' : ''}
            autocomplete="off"
            onblur="handleShortAnswerSave('${q.id}', false)"
          >
          <button 
            type="button" 
            class="btn-cyber btn-cyan" 
            style="padding: 10px 18px; font-size: 0.9rem;"
            ${quizCompletedState ? 'disabled' : ''} 
            onclick="handleShortAnswerSave('${q.id}', true)"
          >
            Save
          </button>
        </div>
      `;
    }

    let statusBanner = '';
    if (isAnswered) {
      statusBanner = `
        <div class="quiz-save-status" style="margin-bottom: 10px;">
          <span class="badge" style="background: rgba(56, 189, 248, 0.12); color: var(--neon-cyan); border: 1px solid var(--neon-cyan); font-weight: 600; padding: 4px 10px;">
            ✓ Response Recorded
          </span>
        </div>
      `;
    } else {
      statusBanner = `
        <div class="quiz-save-status" style="margin-bottom: 10px;">
          <span class="badge" style="background: rgba(148, 163, 184, 0.1); color: var(--text-muted); border: 1px solid rgba(148, 163, 184, 0.25); padding: 4px 10px;">
            Not answered yet
          </span>
        </div>
      `;
    }

    return `
      <div class="challenge-card" id="card-${q.id}">
        <div class="card-header">
          <div class="card-tags">
            <span class="badge badge-cat" style="font-weight: 800;">QUIZ #${idx + 1}</span>
            <span class="badge badge-cat">${escapeHtml(q.category)}</span>
            <span class="badge badge-easy">${q.type === 'mcq' ? 'Multiple Choice' : 'Short Answer'}</span>
          </div>
          <div class="points-pill">${q.points} pts</div>
        </div>

        <div class="card-title">${escapeHtml(q.title)}</div>
        ${statusBanner}

        <div class="card-desc">
          ${escapeHtml(q.question)}
        </div>

        <div>
          ${inputHtml}
        </div>
      </div>
    `;
  }).join('');

  if (quizCompletedState) {
    container.innerHTML = `
      <div style="background: var(--bg-card); border: 2px solid var(--neon-green); border-radius: 14px; padding: 40px 24px; text-align: center; max-width: 680px; margin: 20px auto; box-shadow: 0 10px 40px rgba(0,255,100,0.15);">
        <div style="font-size: 3.5rem; margin-bottom: 12px;">🎉</div>
        <h2 style="color: var(--neon-green); font-size: 1.8rem; margin-bottom: 8px; letter-spacing: 1px;">QUIZ ASSESSMENT COMPLETED!</h2>
        <div class="badge badge-easy" style="font-size: 1.05rem; padding: 6px 20px; margin: 10px auto 20px auto; display: inline-block;">
          POD: ${escapeHtml(currentTeam)}
        </div>
        <p style="color: var(--text-bright); font-size: 1.1rem; margin-bottom: 10px;">
          Your responses for <strong>${answeredCount} / ${quizData.length}</strong> questions have been submitted and locked.
        </p>
        <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 28px; line-height: 1.6;">
          🔒 Assessment timer has stopped and fullscreen mode has ended.<br>
          Scores and standings are being calculated live on the main auditorium screen!
        </p>
        <div style="display: flex; gap: 14px; justify-content: center; flex-wrap: wrap;">
          <button class="btn-cyber btn-cyan" onclick="logoutStudent('Assessment completed. Logged out successfully.')" style="font-size: 1.05rem; padding: 12px 28px; font-weight: bold;">
            🚪 Exit Assessment & Log Out
          </button>
          <button class="btn-cyber" onclick="toggleReviewAnswers()" id="btnToggleReview" style="font-size: 1rem; padding: 12px 22px;">
            👁️ Review Submitted Answers (Read-Only)
          </button>
        </div>
        <div id="reviewAnswersContainer" style="display: none; margin-top: 32px; text-align: left;">
          <hr style="border-color: rgba(255,255,255,0.1); margin-bottom: 24px;">
          <h4 style="color: var(--neon-cyan); margin-bottom: 16px; text-align: center;">YOUR SUBMITTED RESPONSES:</h4>
          ${cardsHtml}
        </div>
      </div>
    `;
    return;
  }

  const finishCard = `
    <div style="background: var(--bg-card); border: 2px solid var(--neon-cyan); border-radius: 12px; padding: 26px; text-align: center; margin: 30px auto; max-width: 650px; box-shadow: 0 8px 30px rgba(0,0,0,0.4);">
      <h3 style="color: var(--neon-cyan); margin-bottom: 8px; font-size: 1.3rem;">🏁 READY TO SUBMIT YOUR QUIZ?</h3>
      <p id="quizProgressText" style="color: var(--text-bright); font-size: 1rem; margin-bottom: 18px;">
        Answered: <strong>${answeredCount} / ${quizData.length}</strong> questions
      </p>
      <button id="btnFinalSubmitQuiz" class="btn-cyber ${answeredCount === quizData.length && quizData.length > 0 ? 'btn-green' : 'btn-cyan'}" style="font-size: 1.1rem; padding: 14px 38px; font-weight: bold; width: 100%; max-width: 420px; margin: 0 auto; ${answeredCount === quizData.length && quizData.length > 0 ? 'box-shadow: 0 0 20px rgba(16, 185, 129, 0.6);' : ''}" onclick="confirmFinishQuiz()">
        ${answeredCount === quizData.length && quizData.length > 0 ? '⚡ Submit & Complete Quiz Now' : '⚡ Final Submit Quiz'}
      </button>
      <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 12px; margin-bottom: 0;">
        ⚠️ Once you click Final Submit, your answers are permanently locked and cannot be changed!
      </p>
    </div>
  `;

  container.innerHTML = cardsHtml + finishCard;
}

async function handleMcqSelect(qid, optIdx) {
  if (!currentTeam || quizCompletedState) return;

  const card = document.getElementById(`card-${qid}`);
  if (card) {
    card.querySelectorAll('.mcq-option-label').forEach(lbl => lbl.classList.remove('selected'));
    const input = card.querySelector(`input[value="${optIdx}"]`);
    if (input) input.closest('.mcq-option-label').classList.add('selected');
    
    const statusBox = card.querySelector('.quiz-save-status');
    if (statusBox) {
      statusBox.innerHTML = `<span class="badge" style="background: rgba(56,189,248,0.15); color: var(--neon-cyan); border: 1px solid var(--neon-cyan);">Saving...</span>`;
    }
  }

  const qObj = quizData.find(q => q.id === qid);
  if (qObj) {
    qObj.answered = true;
    qObj.submitted_answer = optIdx;
  }

  try {
    const res = await fetch('/api/quiz/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        team: currentTeam,
        question_id: qid,
        answer: optIdx
      })
    });
    const data = await res.json();
    if (data.success) {
      if (card) {
        const statusBox = card.querySelector('.quiz-save-status');
        if (statusBox) {
          statusBox.innerHTML = `<span class="badge" style="background: rgba(56,189,248,0.15); color: var(--neon-cyan); border: 1px solid var(--neon-cyan);">✓ Response Recorded</span>`;
        }
      }
      updateQuizProgressCount();
    } else {
      showToast(data.message || 'Error saving answer', 'error');
    }
  } catch (err) {
    showToast('Network error saving answer', 'error');
  }
}

async function handleShortAnswerSave(qid, showToastMsg) {
  if (!currentTeam || quizCompletedState) return;
  const input = document.getElementById(`quiz_text_${qid}`);
  if (!input) return;
  const textVal = input.value.trim();
  if (!textVal) return;

  const card = document.getElementById(`card-${qid}`);
  if (card) {
    const statusBox = card.querySelector('.quiz-save-status');
    if (statusBox) {
      statusBox.innerHTML = `<span class="badge" style="background: rgba(56,189,248,0.15); color: var(--neon-cyan); border: 1px solid var(--neon-cyan);">Saving...</span>`;
    }
  }

  const qObj = quizData.find(q => q.id === qid);
  if (qObj) {
    qObj.answered = true;
    qObj.submitted_answer = textVal;
  }

  try {
    const res = await fetch('/api/quiz/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        team: currentTeam,
        question_id: qid,
        answer: textVal
      })
    });
    const data = await res.json();
    if (data.success) {
      if (card) {
        const statusBox = card.querySelector('.quiz-save-status');
        if (statusBox) {
          statusBox.innerHTML = `<span class="badge" style="background: rgba(56,189,248,0.15); color: var(--neon-cyan); border: 1px solid var(--neon-cyan);">✓ Response Recorded</span>`;
        }
      }
      if (showToastMsg) showToast('Answer saved!', 'success');
      updateQuizProgressCount();
    } else {
      showToast(data.message || 'Error saving answer', 'error');
    }
  } catch (err) {
    showToast('Network error saving answer', 'error');
  }
}

let hasPromptedAllAnswered = false;

function updateQuizProgressCount() {
  const answeredCount = quizData.filter(q => q.answered).length;
  const totalCount = quizData.length;
  const progressEl = document.getElementById('quizProgressText');
  if (progressEl) {
    progressEl.innerHTML = `Answered: <strong>${answeredCount} / ${totalCount}</strong> questions`;
  }
  const submitBtn = document.getElementById('btnFinalSubmitQuiz');
  if (submitBtn) {
    if (answeredCount === totalCount && totalCount > 0) {
      submitBtn.innerHTML = `⚡ Submit & Complete Quiz Now (All ${totalCount} Done!)`;
      submitBtn.className = 'btn-cyber btn-green';
      submitBtn.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.6)';
    } else {
      submitBtn.innerHTML = `⚡ Final Submit Quiz (${answeredCount} / ${totalCount})`;
    }
  }

  // The moment all questions are answered, prompt the user immediately!
  if (answeredCount === totalCount && totalCount > 0 && !quizCompletedState && !hasPromptedAllAnswered) {
    hasPromptedAllAnswered = true;
    showAllQuestionsAnsweredModal();
  }
}

function showAllQuestionsAnsweredModal() {
  let m = document.getElementById('allQuestionsAnsweredModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'allQuestionsAnsweredModal';
    m.className = 'modal-overlay';
    m.style.display = 'none';
    m.style.zIndex = '9999';
    m.innerHTML = `
      <div class="modal-card" style="text-align: center; border: 2px solid var(--neon-green); max-width: 480px; box-shadow: 0 10px 40px rgba(0, 255, 100, 0.25);">
        <div style="font-size: 3.2rem; margin-bottom: 8px;">🏁</div>
        <h3 style="color: var(--neon-green); margin-bottom: 8px; font-size: 1.35rem;">ALL QUESTIONS ANSWERED!</h3>
        <p style="color: var(--text-bright); font-size: 1.05rem; margin-bottom: 8px;">
          You have completed all <strong>${quizData.length}</strong> questions!
        </p>
        <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 24px;">
          Would you like to finalize and submit your quiz now?
        </p>
        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
          <button class="btn-cyber btn-green" onclick="submitFinalQuizNow()" style="padding: 12px 26px; font-weight: bold; font-size: 1rem;">
            ⚡ Submit Quiz Now
          </button>
          <button class="btn-cyber" onclick="closeFinishPromptModal()" style="padding: 12px 20px; font-size: 0.95rem;">
            Review Answers
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(m);
  }
  m.style.display = 'flex';
}

function submitFinalQuizNow() {
  closeFinishPromptModal();
  confirmFinishQuiz(true);
}

function closeFinishPromptModal() {
  const m = document.getElementById('allQuestionsAnsweredModal');
  if (m) m.style.display = 'none';
}

function toggleReviewAnswers() {
  const container = document.getElementById('reviewAnswersContainer');
  const btn = document.getElementById('btnToggleReview');
  if (!container || !btn) return;
  const isHidden = container.style.display === 'none';
  container.style.display = isHidden ? 'block' : 'none';
  btn.textContent = isHidden ? '🙈 Hide Review' : '👁️ Review Submitted Answers (Read-Only)';
}

async function confirmFinishQuiz(skipConfirm = false) {
  if (!currentTeam || quizCompletedState) return;
  const answeredCount = quizData.filter(q => q.answered).length;
  const totalCount = quizData.length;
  const unanswered = totalCount - answeredCount;

  if (!skipConfirm) {
    let msg = `Ready to submit your final quiz answers?\n\n• Answered: ${answeredCount} / ${totalCount}\n`;
    if (unanswered > 0) {
      msg += `• Unanswered: ${unanswered} (will be marked 0 pts)\n`;
    }
    msg += `\n⚠️ Once submitted, you cannot change your answers!`;

    if (!confirm(msg)) return;
  }

  closeFinishPromptModal();

  try {
    const res = await fetch('/api/quiz/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: currentTeam })
    });
    const data = await res.json();
    if (data.success) {
      quizCompletedState = true;
      isAssessmentStarted = false;
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      hideAssessmentUI();
      showToast('🎉 Quiz finalized and submitted successfully!', 'success');
      await loadQuizData(true);
    } else {
      showToast(data.message || 'Error submitting quiz', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to server.', 'error');
  }
}

async function submitFinalQuizAuto() {
  if (!currentTeam || quizCompletedState) return;
  closeFinishPromptModal();
  try {
    await fetch('/api/quiz/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: currentTeam })
    });
    quizCompletedState = true;
    isAssessmentStarted = false;
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    hideAssessmentUI();
    showToast('⏱️ Assessment time is up! Your answers have been submitted.', 'info');
    await loadQuizData(true);
  } catch (err) {}
}

// -------------------------------------------------------------
// CTF Section (Sunday)
// -------------------------------------------------------------
let lastCTFSignature = '';

async function loadCTFData(forceRender = false) {
  try {
    const url = currentTeam ? `/api/challenges?team=${encodeURIComponent(currentTeam)}` : '/api/challenges';
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();

    const isLocked = Boolean(data.locked);
    if (data.locked) {
      if (sectionsStatus.ctf) sectionsStatus.ctf.is_open = false;
      challengesData = [];
    } else {
      challengesData = data.challenges || [];
    }

    const currentSignature = JSON.stringify({
      locked: isLocked,
      challenges: challengesData.map(c => ({
        id: c.id,
        title: c.title,
        solved: c.solved,
        hint_unlocked: c.hint_unlocked
      }))
    });

    const hasChanged = currentSignature !== lastCTFSignature;
    lastCTFSignature = currentSignature;

    const isTyping = isStudentTyping('ctfQuestionsContainer');
    if (forceRender || (hasChanged && !isTyping)) {
      renderCTF();
    } else if (hasChanged && isTyping) {
      // Safely remove any deleted challenge cards without disturbing active typing inputs
      const activeIds = new Set(challengesData.map(c => c.id));
      document.querySelectorAll('#ctfQuestionsContainer .challenge-card').forEach(card => {
        const id = card.id.replace('card-', '');
        if (id && !activeIds.has(id)) {
          card.remove();
        }
      });
    }
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

  // 3. Section is open, pod joined, but CTF assessment NOT started in fullscreen
  if (!isCtfAssessmentStarted) {
    if (infoBanner) infoBanner.style.display = 'none';
    hideStartAssessmentCard();
    container.innerHTML = `
      <div class="locked-section-card" style="border-color: var(--neon-green);">
        <div class="locked-icon">🔒</div>
        <h2 style="color: var(--text-bright); margin-bottom: 8px;">CTF ARENA IS FULLSCREEN LOCKED</h2>
        <div class="badge badge-easy" style="font-size: 0.95rem; padding: 6px 18px; margin: 12px auto; display: inline-block;">
          ANTI-CHEAT MONITORING ENABLED
        </div>
        <p style="color: var(--text-muted); font-size: 0.95rem; max-width: 540px; margin: 12px auto 20px auto; line-height: 1.5;">
          All challenges are self-contained on screen. To ensure fair competition and prevent unauthorized AI tools or external browsing, challenges are only unlocked in Fullscreen mode.
        </p>
        <button class="btn-cyber btn-green" onclick="startCtfWithFullscreen()" style="font-size: 1.05rem; padding: 12px 30px; font-weight: bold;">
          ⛶ Enter CTF Arena & Lock Fullscreen
        </button>
      </div>
    `;
    return;
  }

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
          <div class="points-pill">${ch.points} pts</div>
        </div>

        <div class="card-title">${escapeHtml(ch.title)}</div>

        <div class="solved-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          FLAG CAPTURED
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
    if (myPod) {
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
