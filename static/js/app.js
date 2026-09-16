/**
 * 2-DAY WORKSHOP PLATFORM - CLIENT SCRIPT
 * Features:
 * - Saturday Quiz (MCQs + Short Answers) & Sunday CTF Arena
 * - Live Combined Leaderboard (Total Points = Quiz + CTF Net Score)
 * - Section Lock & Timing Status Checker
 * - Touch-Friendly Mobile UI
 * - Server-Side Verified Scoring
 */

// State
let currentTeam = localStorage.getItem('ctf_team') || '';
let currentSection = 'quiz'; // 'quiz' or 'ctf'
let sectionsStatus = { quiz: { is_open: true }, ctf: { is_open: true } };
let quizData = [];
let challengesData = [];
let soundEnabled = localStorage.getItem('ctf_sound') !== 'disabled';

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Audio Synthesizer
const AudioSys = {
  ctx: null,
  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  playSuccess() {
    if (!soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, now + i * 0.08);
        gain.gain.setValueAtTime(0.15, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.25);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.25);
      });
    } catch (e) {}
  },
  playError() {
    if (!soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.25);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } catch (e) {}
  }
};

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();

  if (currentTeam) {
    updateTeamUI(currentTeam);
  } else {
    showTeamModal();
  }

  await refreshSectionStatus();
  await loadQuizData();
  await loadCTFData();
  await loadLeaderboard();

  // Polling intervals
  setInterval(loadLeaderboard, 6000);
  setInterval(refreshSectionStatus, 10000);
});

function setupEventListeners() {
  // Section Navigation Tabs (Quiz vs CTF)
  document.querySelectorAll('.section-nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
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
    changeBtn.addEventListener('click', () => {
      showTeamModal();
    });
  }

  // Audio toggle
  const soundBtn = document.getElementById('btnToggleSound');
  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      localStorage.setItem('ctf_sound', soundEnabled ? 'enabled' : 'disabled');
      soundBtn.textContent = soundEnabled ? 'Audio: ON' : 'Audio: MUTED';
      showToast(`Audio ${soundEnabled ? 'Enabled' : 'Muted'}`, 'info');
    });
  }
}

// -------------------------------------------------------------
// Team Registration & Room Code
// -------------------------------------------------------------
function showTeamModal() {
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
      showToast(`Welcome, ${escapeHtml(currentTeam)}!`, 'success');
      loadQuizData();
      loadCTFData();
      loadLeaderboard();
    } else {
      showToast(data.message || 'Invalid Room Code or Name.', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to server.', 'error');
  }
}

function updateTeamUI(name) {
  const badge = document.getElementById('teamBadgeName');
  if (badge) badge.textContent = name;
}

// -------------------------------------------------------------
// Section Switcher & Status
// -------------------------------------------------------------
async function refreshSectionStatus() {
  try {
    const res = await fetch('/api/sections/status');
    sectionsStatus = await res.json();

    const quizTag = document.getElementById('quizStatusTag');
    const ctfTag = document.getElementById('ctfStatusTag');

    if (quizTag) {
      const open = sectionsStatus.quiz.is_open;
      quizTag.textContent = open ? 'OPEN' : 'LOCKED';
      quizTag.className = `section-status-tag ${open ? 'status-open' : 'status-locked'}`;
    }

    if (ctfTag) {
      const open = sectionsStatus.ctf.is_open;
      ctfTag.textContent = open ? 'OPEN' : 'LOCKED';
      ctfTag.className = `section-status-tag ${open ? 'status-open' : 'status-locked'}`;
    }

    switchSectionView(currentSection);
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
    quizData = data.questions || [];
    renderQuiz();
  } catch (err) {}
}

function renderQuiz() {
  const container = document.getElementById('quizQuestionsContainer');
  if (!container) return;

  // Check if Quiz section is locked
  if (sectionsStatus.quiz && !sectionsStatus.quiz.is_open) {
    container.innerHTML = `
      <div class="locked-section-card">
        <svg class="locked-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <h2 style="color: var(--neon-red); margin-bottom: 8px;">SATURDAY QUIZ SECTION IS LOCKED</h2>
        <p style="color: var(--text-muted); font-size: 1rem;">
          ${escapeHtml(sectionsStatus.quiz.message || 'This section is currently closed.')}
        </p>
      </div>
    `;
    return;
  }

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
          <div style="background: rgba(255, 51, 102, 0.15); border: 1px solid var(--neon-red); color: var(--neon-red); padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 0.82rem; margin-bottom: 10px; display: inline-flex; align-items: center; gap: 6px;">
            ✕ INCORRECT (0 PTS)
          </div>
        `;
      }
    }

    let explanationHtml = '';
    if (isAnswered && q.explanation) {
      explanationHtml = `
        <div style="background: #0f1826; border: 1px solid #24344d; padding: 10px 14px; border-radius: 4px; font-size: 0.85rem; color: #a0b6d4; margin-top: 10px;">
          <strong>Explanation:</strong> ${escapeHtml(q.explanation)}
        </div>
      `;
    }

    return `
      <div class="challenge-card ${isAnswered ? (isCorrect ? 'solved' : '') : ''}" id="card-${q.id}" style="margin-bottom: 20px;">
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

        <div class="card-desc" style="font-size: 0.95rem; line-height: 1.6;">
          ${escapeHtml(q.question)}
        </div>

        <form onsubmit="handleQuizSubmit(event, '${q.id}', '${q.type}')">
          ${inputHtml}
          ${explanationHtml}

          <div style="margin-top: 14px;">
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
        AudioSys.playSuccess();
        showToast(data.message, 'success');
      } else {
        AudioSys.playError();
        showToast(data.message, 'error');
      }
      await loadQuizData();
      await loadLeaderboard();
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
    challengesData = data.challenges || [];
    renderCTF();
  } catch (err) {}
}

function renderCTF() {
  const container = document.getElementById('ctfQuestionsContainer');
  if (!container) return;

  if (sectionsStatus.ctf && !sectionsStatus.ctf.is_open) {
    container.innerHTML = `
      <div class="locked-section-card">
        <svg class="locked-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <h2 style="color: var(--neon-red); margin-bottom: 8px;">SUNDAY CTF SECTION IS LOCKED</h2>
        <p style="color: var(--text-muted); font-size: 1rem;">
          ${escapeHtml(sectionsStatus.ctf.message || 'This section is currently closed.')}
        </p>
      </div>
    `;
    return;
  }

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
          <div style="background:#1a1708; border:1px dashed var(--neon-amber); color:#ffdf80; padding:8px 12px; border-radius:4px; font-size:0.85rem; margin:12px 0;">
            <strong>[!] HINT:</strong> ${escapeHtml(ch.hint)}
          </div>
        `;
      } else {
        hintHtml = `
          <div style="margin: 10px 0;">
            <button type="button" class="btn-cyber" style="border-color: var(--neon-amber); color: var(--neon-amber); font-size:0.8rem;" onclick="unlockCTFHint('${escapeHtml(ch.id)}')">
              Unlock Hint (-${ch.hint_cost} pts)
            </button>
          </div>
        `;
      }
    }

    return `
      <div class="challenge-card ${isSolved ? 'solved' : ''}" id="ctf-card-${ch.id}" style="margin-bottom: 20px;">
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

        <div class="card-desc" style="font-size: 0.95rem; line-height: 1.6;">
          ${ch.description}
        </div>

        ${hintHtml}

        <form class="submit-group" style="margin-top: 14px;" onsubmit="handleCTFSubmit(event, '${escapeHtml(ch.id)}')">
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
      AudioSys.playSuccess();
      showToast(data.message, 'success');
      await loadCTFData();
      await loadLeaderboard();
    } else {
      AudioSys.playError();
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
      await loadLeaderboard();
    }
  } catch (err) {}
}

// -------------------------------------------------------------
// Combined Leaderboard
// -------------------------------------------------------------
async function loadLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();
    const board = data.leaderboard || [];
    renderLeaderboard(board);

    // Update pod score badge in header
    if (currentTeam) {
      const myPod = board.find(t => t.name.toLowerCase() === currentTeam.toLowerCase());
      const scoreBadge = document.getElementById('teamPointsVal');
      if (scoreBadge && myPod) {
        scoreBadge.textContent = `${myPod.total_score} pts (Quiz: ${myPod.quiz_points} | CTF: ${myPod.ctf_net})`;
      }
    }
  } catch (err) {}
}

function renderLeaderboard(board) {
  const tbody = document.getElementById('combinedLeaderboardBody');
  if (!tbody) return;

  if (board.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:24px;">No pods registered yet. Join to see rankings!</td></tr>`;
    return;
  }

  tbody.innerHTML = board.map(item => {
    const isMe = currentTeam && item.name.toLowerCase() === currentTeam.toLowerCase();
    let rankClass = '';
    if (item.rank === 1) rankClass = 'rank-1';
    else if (item.rank === 2) rankClass = 'rank-2';
    else if (item.rank === 3) rankClass = 'rank-3';

    const lastTime = item.last_activity ? item.last_activity.split(' ')[1] || item.last_activity : '-';

    return `
      <tr class="${isMe ? 'team-current' : ''}">
        <td class="${rankClass}">#${item.rank}</td>
        <td style="font-weight: 700; color: ${isMe ? 'var(--neon-cyan)' : 'var(--text-bright)'};">
          ${escapeHtml(item.name)} ${isMe ? '<span style="font-size:0.75rem; color:var(--neon-cyan);">(YOU)</span>' : ''}
        </td>
        <td style="color: var(--neon-green); font-weight: 900; font-size: 1.15rem;">
          ${item.total_score} pts
        </td>
        <td>
          <div class="score-pill-group">
            <span class="score-pill score-pill-quiz">Quiz: ${item.quiz_points}</span>
            <span class="score-pill score-pill-ctf">CTF: ${item.ctf_net}</span>
            ${item.ctf_penalty > 0 ? `<span class="score-pill score-pill-penalty">-${item.ctf_penalty}</span>` : ''}
          </div>
        </td>
        <td style="color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(lastTime)}</td>
      </tr>
    `;
  }).join('');
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
