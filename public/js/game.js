// ══════════════════════ Talk 2 Defuse — Client ══════════════════════
const socket = io();

// ── State ───────────────────────────────────────────────────────
let myRole = null;
let myName = '';
let roomCode = '';
let bombState = null;
let manualData = null;
let timerValue = 0;
let timerSpeed = 1;
let gameDifficulty = 'easy';
let isHoldingButton = false;
let buttonHoldModule = -1;
let stripColor = null;
let chatAutoScroll = true;
let simonFlashing = false;
let customSettings = {
  timer: 300, maxStrikes: 3, wireCount: 4,
  modules: ['wires', 'button', 'keypad'],
  sequenceEnforcement: true, strikeSpeedup: true,
};

// ── Settings ─────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  masterVolume: 100,
  sfxVolume: 100,
  musicVolume: 100,
  screenShake: true,
  reducedMotion: false,
  colorblind: false,
  chatFontSize: 'medium',
  showTimestamps: true,
  actionConfirmations: true,
};
let settings = { ...DEFAULT_SETTINGS };
let _prevMusicVolume = 100; // for music toggle restore

function loadSettings() {
  try {
    const raw = localStorage.getItem('gameSettings');
    if (raw) {
      const saved = JSON.parse(raw);
      settings = { ...DEFAULT_SETTINGS, ...saved };
    }
    // Migrate legacy musicMuted flag
    const legacyMuted = localStorage.getItem('musicMuted');
    if (legacyMuted !== null) {
      if (legacyMuted === 'true' && settings.musicVolume > 0) {
        settings.musicVolume = 0;
      }
      localStorage.removeItem('musicMuted');
      saveSettings();
    }
  } catch (_) {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try { localStorage.setItem('gameSettings', JSON.stringify(settings)); } catch (_) {}
}

function applySettings() {
  // Audio
  AudioFX.setMasterVolume(settings.masterVolume / 100);
  AudioFX.setSfxVolume(settings.sfxVolume / 100);
  AudioFX.setMusicVolume(settings.musicVolume / 100);

  // Visual
  document.body.classList.toggle('colorblind', settings.colorblind);
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);

  // Chat
  const chatEl = document.getElementById('chat-messages');
  if (chatEl) {
    chatEl.classList.remove('chat-sm', 'chat-md', 'chat-lg');
    if (settings.chatFontSize === 'small') chatEl.classList.add('chat-sm');
    else if (settings.chatFontSize === 'large') chatEl.classList.add('chat-lg');
    else chatEl.classList.add('chat-md');
    chatEl.classList.toggle('chat-hide-timestamps', !settings.showTimestamps);
  }

  // Music toggle button sync
  const musicBtn = document.getElementById('btn-music-toggle');
  if (musicBtn) {
    musicBtn.classList.toggle('muted', settings.musicVolume === 0);
  }
}

// Load and apply settings immediately
loadSettings();
applySettings();

// ── DOM / Screens ───────────────────────────────────────────────
const screens = {
  landing: document.getElementById('screen-landing'),
  lobby: document.getElementById('screen-lobby'),
  briefing: document.getElementById('screen-briefing'),
  game: document.getElementById('screen-game'),
  result: document.getElementById('screen-result'),
};
let _currentScreen = 'landing';
function showScreen(name) {
  const prev = _currentScreen;
  _currentScreen = name;

  // Stop menu music when leaving landing/lobby
  if (name !== 'landing' && name !== 'lobby') AudioFX.stopMenuMusic();
  // Hang up voice chat when returning to landing
  if (name === 'landing' && typeof VoiceChat !== 'undefined') VoiceChat.hangup();
  // Show room code in game topbar
  if (name === 'game' && roomCode) {
    const el = document.getElementById('game-room-code');
    if (el) el.textContent = 'Room: ' + roomCode;
  }
  // Show magnifier on landing page
  if (name === 'landing' && typeof magActive !== 'undefined' && !magActive) {
    setTimeout(() => toggleMagnifier(), 500);
  }
  // Hide magnifier when leaving game/landing
  if (name !== 'game' && name !== 'landing' && typeof magActive !== 'undefined' && magActive) {
    magActive = false;
    const mag = document.getElementById('magnifier');
    if (mag) mag.classList.add('hidden');
    if (magRafId) { cancelAnimationFrame(magRafId); magRafId = null; }
  }
  // Cleanup game effects when leaving
  if (name !== 'game') {
    const gm = document.querySelector('.game-main');
    if (gm) gm.classList.remove('timer-urgent', 'timer-critical', 'timer-critical-pulse');
    stopDust();
    stopFuseSparks();
    AudioFX.stopRoomAmbience();
    resetAllAnnotations();
    window._executorRendered = false;
    Object.keys(redactionCache).forEach(k => delete redactionCache[k]);
  }

  // Cinematic transition
  const prevScreen = screens[prev];
  const nextScreen = screens[name];
  if (prevScreen && nextScreen && prevScreen !== nextScreen) {
    prevScreen.classList.add('screen-exit');
    nextScreen.classList.remove('active');
    setTimeout(() => {
      prevScreen.classList.remove('active', 'screen-exit');
      nextScreen.classList.add('active', 'screen-enter');
      setTimeout(() => nextScreen.classList.remove('screen-enter'), 400);
    }, 200);
  } else {
    Object.values(screens).forEach(s => s.classList.remove('active', 'screen-exit', 'screen-enter'));
    nextScreen.classList.add('active', 'screen-enter');
    setTimeout(() => nextScreen.classList.remove('screen-enter'), 400);
  }
}

// ══════════════════════ LANDING ══════════════════════
const nameInput = document.getElementById('player-name');
const codeInput = document.getElementById('room-code-input');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const landingError = document.getElementById('landing-error');

function updateLandingButtons() {
  const hasName = nameInput.value.trim().length > 0;
  btnCreate.disabled = !hasName;
  btnJoin.disabled = !hasName || codeInput.value.trim().length !== 4;
}
nameInput.addEventListener('input', updateLandingButtons);
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.replace(/[^0-9]/g, '');
  updateLandingButtons();
});

btnCreate.addEventListener('click', () => {
  AudioFX.fuseLit();
  myName = nameInput.value.trim();
  const pendingCode = codeInput.value.trim();
  if (pendingCode.length === 4) {
    // Code is filled in — join/reconnect that room instead of creating new
    tryJoinOrReconnect(pendingCode, myName);
  } else {
    socket.emit('create-room', { playerName: myName }, (res) => {
      if (res.code) { roomCode = res.code; enterLobby(); }
    });
  }
});
function tryJoinOrReconnect(code, name) {
  socket.emit('join-room', { roomCode: code, playerName: name }, (res) => {
    if (res.error) {
      // If game in progress, try reconnecting instead
      socket.emit('reconnect-room', { roomCode: code, playerName: name }, (rRes) => {
        if (rRes && rRes.success) {
          roomCode = code;
          myName = name;
          // game-resume event will handle showing the game screen
        } else {
          landingError.textContent = res.error;
          landingError.classList.remove('hidden');
          codeInput.classList.add('input-error');
          setTimeout(() => codeInput.classList.remove('input-error'), 2000);
        }
      });
    } else { roomCode = code; enterLobby(); }
  });
}

btnJoin.addEventListener('click', () => {
  AudioFX.fuseLit();
  myName = nameInput.value.trim();
  const code = codeInput.value.trim();
  tryJoinOrReconnect(code, myName);
});
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btnJoin.disabled) btnJoin.click(); });
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btnCreate.disabled) btnCreate.click(); });

// Solo Practice
let isSoloMode = false;
function exitSoloMode() {
  isSoloMode = false;
  const chatPanel = document.querySelector('.chat-panel');
  if (chatPanel) chatPanel.classList.remove('solo-hidden');
  const content = document.getElementById('game-content');
  if (content) content.classList.remove('solo-content');
}
let soloDifficulty = 'medium';
let soloRound = 1;
const SOLO_ROUNDS_PER_LEVEL = { easy: 3, medium: 3, hard: 2 };
const ALL_MODULE_TYPES = ['wires', 'button', 'keypad', 'simon', 'morse', 'memory', 'maze', 'password', 'knob'];

// Pick N random modules (always includes wires on round 1 of easy)
function pickSoloModules(difficulty, round) {
  let count;
  if (difficulty === 'easy') {
    count = round === 1 ? 1 : 2; // Round 1: 1 module, Round 2-3: 2 modules
  } else if (difficulty === 'medium') {
    count = round === 1 ? 3 : (round === 2 ? 4 : 5);
  } else {
    count = round === 1 ? 6 : 7 + Math.floor(Math.random() * 3); // 6, then 7-9
  }
  count = Math.min(count, ALL_MODULE_TYPES.length);

  // First round of easy always starts with wires as intro
  if (difficulty === 'easy' && round === 1) return ['wires'];

  // Always include wires, then pick random others
  const others = ALL_MODULE_TYPES.filter(m => m !== 'wires');
  const shuffled = others.sort(() => Math.random() - 0.5);
  const picked = ['wires', ...shuffled.slice(0, count - 1)];
  return picked;
}

function buildSoloSettings(difficulty, round) {
  const modules = pickSoloModules(difficulty, round);
  const timerMap = { easy: 300, medium: 360, hard: 300 };
  // More modules = more time, but not linearly
  const baseTime = timerMap[difficulty] || 300;
  const extraTime = Math.max(0, modules.length - 1) * 30;
  return {
    timer: baseTime + extraTime,
    maxStrikes: 3,
    wireCount: 3 + Math.floor(Math.random() * 3), // 3-5
    modules,
    sequenceEnforcement: true,
    strikeSpeedup: difficulty === 'hard',
  };
}

document.getElementById('btn-solo').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) { landingError.textContent = 'Enter a callsign first.'; landingError.classList.remove('hidden'); return; }

  // Show solo difficulty picker
  const existing = document.getElementById('solo-picker');
  if (existing) { existing.remove(); return; }

  const picker = document.createElement('div');
  picker.id = 'solo-picker';
  picker.className = 'solo-picker';
  picker.innerHTML = `
    <div class="solo-picker-title">Solo Practice — Choose Difficulty</div>
    <div class="solo-picker-buttons">
      <button class="btn btn-diff solo-diff-btn" data-diff="easy"><strong>Easy</strong><span>1–2 modules · 3 rounds</span></button>
      <button class="btn btn-diff solo-diff-btn" data-diff="medium"><strong>Medium</strong><span>3–5 modules · 3 rounds</span></button>
      <button class="btn btn-diff solo-diff-btn" data-diff="hard"><strong>Hard</strong><span>6–9 modules · 2 rounds</span></button>
    </div>
    <button class="btn btn-link solo-picker-cancel" style="margin-top:8px;font-size:12px">Cancel</button>
  `;
  document.querySelector('.action-card').appendChild(picker);

  picker.querySelector('.solo-picker-cancel').addEventListener('click', () => picker.remove());
  picker.querySelectorAll('.solo-diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      soloDifficulty = btn.dataset.diff;
      picker.remove();
      AudioFX.fuseLit();
      myName = name;
      soloDifficulty = btn.dataset.diff;
      soloRound = 1;
      const cs = buildSoloSettings(soloDifficulty, soloRound);
      socket.emit('create-solo', { playerName: myName, difficulty: 'custom', customSettings: cs }, (res) => {
        if (res.code) { roomCode = res.code; }
      });
    });
  });
});

socket.on('solo-start', async (data) => {
  resetMagCracks();
  isSoloMode = true;
  myRole = 'solo';
  bombState = data.bomb;
  manualData = data.manual;
  gameDifficulty = soloDifficulty;
  currentManualTab = 'index';

  // Play solo intro (only on first round)
  if (soloRound === 1) await playIntro('solo');

  showScreen('game');
  renderSoloView();
  if (soloRound === 1) showKeybindOverlay();
  updateTimer(data.timer, 1);
  updateStrikes(0, data.maxStrikes);
  const diffLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }[soloDifficulty] || 'Practice';
  const totalRounds = SOLO_ROUNDS_PER_LEVEL[soloDifficulty] || 3;
  const modCount = bombState.modules.length;
  document.getElementById('game-bomb-type').textContent = `${diffLabel} ${soloRound}/${totalRounds} — ${modCount} module${modCount > 1 ? 's' : ''}`;
});

function renderSoloView() {
  clearAllMorseTimeouts();
  // Hide chat panel in solo mode
  const chatPanel = document.querySelector('.chat-panel');
  if (chatPanel) chatPanel.classList.add('solo-hidden');

  const content = document.getElementById('game-content');
  content.classList.add('solo-content');
  document.getElementById('game-module-count').textContent = `${bombState.modules.length} module${bombState.modules.length > 1 ? 's' : ''}`;

  // Tab setup
  const tabOrder = ['index', 'overview', 'procedures', 'sequence'];
  const moduleOrder = ['wires', 'button', 'keypad', 'simon', 'morse', 'memory', 'maze', 'password', 'knob'];
  moduleOrder.forEach(m => { if (manualData.chapters[m]) tabOrder.push(m); });
  tabOrder.push('appendix');
  const tabLabels = { index: 'Index', overview: 'Overview', procedures: 'Procedures', sequence: 'Sequence', wires: 'Wires', button: 'Button', keypad: 'Keypad', simon: 'Simon', morse: 'Morse', memory: 'Memory', maze: 'Maze', password: 'Password', knob: 'Knob', appendix: 'Appendix' };

  let html = '<div class="solo-layout">';

  // Top: Bomb info + modules
  html += '<div class="solo-bomb-section">';
  html += '<div class="solo-section-label">BOMB</div>';

  // Bomb info plate for solo — needed to look up protocol
  html += '<div class="solo-bomb-info">';
  html += `<div class="solo-info-item"><span class="solo-info-label">Serial</span><span class="solo-info-value serial-value">${bombState.serial}</span></div>`;
  html += `<div class="solo-info-item"><span class="solo-info-label">Shape</span><span class="solo-info-value">${cap(bombState.shape)}</span></div>`;
  html += `<div class="solo-info-item"><span class="solo-info-label">Size</span><span class="solo-info-value">${cap(bombState.size)}</span></div>`;
  html += `<div class="solo-info-item"><span class="solo-info-label">Batteries</span><span class="solo-info-value">${bombState.batteries}</span></div>`;
  const indStr = bombState.indicators.map(i => `<span class="solo-ind${i.lit ? ' lit' : ''}">${i.lit ? '●' : '○'} ${i.label}</span>`).join(' ');
  html += `<div class="solo-info-item"><span class="solo-info-label">Indicators</span><span class="solo-info-value">${indStr}</span></div>`;
  html += `<div class="solo-info-item"><span class="solo-info-label">Ports</span><span class="solo-info-value">${bombState.ports.join(', ') || 'None'}</span></div>`;
  html += '</div>';

  html += '<div class="solo-module-grid">';
  bombState.modules.forEach((mod, mi) => html += renderModule(mod, mi));
  html += '</div></div>';

  // Bottom: Manual
  html += '<div class="solo-manual-section">';
  html += '<div class="solo-section-label">MANUAL</div>';
  html += '<div class="manual-container">';
  html += '<div class="manual-cover-header"><div class="manual-header-text"><span class="manual-classification">PRACTICE</span><div class="manual-title-text">Bomb Disposal Manual</div></div></div>';
  html += '<div class="manual-tabs">';
  tabOrder.forEach(tab => {
    if (tab === 'index' || manualData.chapters[tab]) {
      html += `<button class="manual-tab${currentManualTab === tab ? ' active' : ''}" data-tab="${tab}">${tabLabels[tab] || cap(tab)}</button>`;
    }
  });
  html += '</div>';
  html += '<div class="manual-search"></div>';
  html += `<div class="manual-body" id="manual-body">${renderManualTab(currentManualTab)}</div>`;
  html += '</div></div>';

  html += '</div>';
  content.innerHTML = html;
  attachExecutorListeners();

  // Auto-show magnifier for solo
  if (!magActive) toggleMagnifier();
  // Annotations + page effects for solo
  applyRedactions();
  applyPageDamage();
  showAnnoWrapper();
  setupAnnoCanvas();

  document.querySelectorAll('.manual-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const prevTab = currentManualTab;
      currentManualTab = tab.dataset.tab;
      document.querySelectorAll('.manual-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentManualTab));
      flipManualPage(currentManualTab, prevTab);
      AudioFX.click();
    });
  });
}

// Help modal
document.getElementById('btn-how-to-play').addEventListener('click', () => document.getElementById('modal-help').classList.remove('hidden'));
document.querySelector('#modal-help .modal-close').addEventListener('click', () => document.getElementById('modal-help').classList.add('hidden'));
document.querySelector('#modal-help .modal-backdrop').addEventListener('click', () => document.getElementById('modal-help').classList.add('hidden'));
document.getElementById('btn-help-ingame').addEventListener('click', () => document.getElementById('modal-help').classList.remove('hidden'));
document.getElementById('btn-help-lobby').addEventListener('click', () => document.getElementById('modal-help').classList.remove('hidden'));

// Settings modal
function syncSettingsUI() {
  document.getElementById('setting-master-vol').value = settings.masterVolume;
  document.getElementById('setting-master-vol-val').textContent = settings.masterVolume;
  document.getElementById('setting-sfx-vol').value = settings.sfxVolume;
  document.getElementById('setting-sfx-vol-val').textContent = settings.sfxVolume;
  document.getElementById('setting-music-vol').value = settings.musicVolume;
  document.getElementById('setting-music-vol-val').textContent = settings.musicVolume;
  document.getElementById('setting-screen-shake').checked = settings.screenShake;
  document.getElementById('setting-reduced-motion').checked = settings.reducedMotion;
  document.getElementById('setting-colorblind').checked = settings.colorblind;
  document.querySelectorAll('input[name="setting-chat-size"]').forEach(r => { r.checked = r.value === settings.chatFontSize; });
  document.getElementById('setting-show-timestamps').checked = settings.showTimestamps;
  document.getElementById('setting-action-confirmations').checked = settings.actionConfirmations;
}

function openSettingsModal() {
  syncSettingsUI();
  document.getElementById('modal-settings').classList.remove('hidden');
}
function closeSettingsModal() {
  document.getElementById('modal-settings').classList.add('hidden');
}

document.getElementById('btn-settings-landing').addEventListener('click', openSettingsModal);
document.getElementById('btn-settings-ingame').addEventListener('click', openSettingsModal);
document.querySelector('#modal-settings .modal-close').addEventListener('click', closeSettingsModal);
document.querySelector('#modal-settings .modal-backdrop').addEventListener('click', closeSettingsModal);

// Settings change listeners — instant apply, no save button
['setting-master-vol', 'setting-sfx-vol', 'setting-music-vol'].forEach(id => {
  const el = document.getElementById(id);
  const valEl = document.getElementById(id + '-val');
  const key = id === 'setting-master-vol' ? 'masterVolume' : id === 'setting-sfx-vol' ? 'sfxVolume' : 'musicVolume';
  el.addEventListener('input', () => {
    const v = +el.value;
    valEl.textContent = v;
    settings[key] = v;
    if (key === 'musicVolume' && v > 0) _prevMusicVolume = v;
    saveSettings();
    applySettings();
    // Start/stop music based on music volume changes
    if (key === 'musicVolume') {
      if (v === 0) AudioFX.stopMenuMusic();
      else if (!AudioFX.isMenuPlaying && (screens.landing.classList.contains('active') || screens.lobby.classList.contains('active'))) AudioFX.menuMusic();
    }
  });
});

['setting-screen-shake', 'setting-reduced-motion', 'setting-colorblind', 'setting-show-timestamps', 'setting-action-confirmations'].forEach(id => {
  const el = document.getElementById(id);
  const keyMap = {
    'setting-screen-shake': 'screenShake',
    'setting-reduced-motion': 'reducedMotion',
    'setting-colorblind': 'colorblind',
    'setting-show-timestamps': 'showTimestamps',
    'setting-action-confirmations': 'actionConfirmations',
  };
  el.addEventListener('change', () => {
    settings[keyMap[id]] = el.checked;
    saveSettings();
    applySettings();
  });
});

document.querySelectorAll('input[name="setting-chat-size"]').forEach(r => {
  r.addEventListener('change', () => {
    settings.chatFontSize = r.value;
    saveSettings();
    applySettings();
  });
});


// Music toggle
const btnMusicToggle = document.getElementById('btn-music-toggle');
btnMusicToggle.classList.toggle('muted', settings.musicVolume === 0);

btnMusicToggle.addEventListener('click', () => {
  if (settings.musicVolume > 0) {
    _prevMusicVolume = settings.musicVolume;
    settings.musicVolume = 0;
    AudioFX.stopMenuMusic();
  } else {
    settings.musicVolume = _prevMusicVolume || 100;
    AudioFX.menuMusic();
  }
  saveSettings();
  applySettings();
  syncSettingsUI();
});

// Start music on first user interaction on landing (if not muted)
document.getElementById('screen-landing').addEventListener('click', () => {
  if (settings.musicVolume > 0) AudioFX.menuMusic();
}, { once: false });

// ══════════════════════ SCOREBOARD (localStorage) ══════════════════════
const SCORES_KEY = 'talk2defuse_scores';

function loadLocalScores() {
  try { return JSON.parse(localStorage.getItem(SCORES_KEY) || '[]'); } catch { return []; }
}

function saveLocalScore(record) {
  const scores = loadLocalScores();
  scores.push(record);
  if (scores.length > 200) scores.splice(0, scores.length - 200);
  localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
}

function getLocalScoreboard() {
  const scores = loadLocalScores();
  const wins = scores.filter(s => s.won).sort((a, b) => b.score - a.score).slice(0, 20);
  const recent = scores.slice(-10).reverse();
  const totalGames = scores.length;
  const totalWins = scores.filter(s => s.won).length;
  const winRate = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;
  return { wins, recent, stats: { totalGames, totalWins, winRate } };
}

// Seed dummy data if leaderboard is empty
(function seedDummyScores() {
  if (loadLocalScores().length >= 10) return;
  const names = ['Ghost', 'Viper', 'Falcon', 'Echo', 'Raven', 'Nova', 'Blitz', 'Shadow', 'Phoenix', 'Cipher', 'Havoc', 'Specter', 'Lynx', 'Titan', 'Pulse'];
  const diffs = ['easy', 'medium', 'hard', 'flip'];
  const now = Date.now();
  const dummy = [];
  for (let i = 0; i < 30; i++) {
    const diff = diffs[Math.floor(Math.random() * diffs.length)];
    const won = Math.random() > 0.35;
    const timeRem = won ? Math.floor(30 + Math.random() * 300) : 0;
    const strikes = Math.floor(Math.random() * 3);
    const mult = { easy: 1, medium: 2, hard: 3, flip: 4 }[diff];
    const score = won ? Math.max(0, Math.round((1000 + timeRem * 10 - strikes * 200) * mult)) : 0;
    const e = names[Math.floor(Math.random() * names.length)];
    let inst = names[Math.floor(Math.random() * names.length)];
    while (inst === e) inst = names[Math.floor(Math.random() * names.length)];
    dummy.push({
      won, score, difficulty: diff, timeRemaining: timeRem,
      strikes, maxStrikes: 3, executor: e, instructor: inst,
      timestamp: now - (30 - i) * 3600000 * (1 + Math.random() * 3),
    });
  }
  localStorage.setItem(SCORES_KEY, JSON.stringify(dummy));
})();

// Auto-load scoreboard on connect
function loadLandingScoreboard() {
  renderScoreboard();
}
socket.on('connect', loadLandingScoreboard);

// Leaderboard hide/show
const btnLeaderboardHide = document.getElementById('btn-leaderboard-toggle');
const btnLeaderboardShow = document.getElementById('btn-leaderboard-show');
const panelRight = document.getElementById('landing-panel-right');
if (btnLeaderboardHide && btnLeaderboardShow && panelRight) {
  btnLeaderboardHide.addEventListener('click', () => {
    panelRight.classList.add('panel-hidden');
    btnLeaderboardShow.classList.remove('hidden');
  });
  btnLeaderboardShow.addEventListener('click', () => {
    panelRight.classList.remove('panel-hidden');
    btnLeaderboardShow.classList.add('hidden');
  });
}

// ══════════════════════ LOBBY ══════════════════════
function enterLobby() {
  landingError.classList.add('hidden');
  document.getElementById('lobby-room-code').textContent = roomCode;
  showScreen('lobby');
}

document.getElementById('btn-copy-code').addEventListener('click', () => {
  navigator.clipboard.writeText(roomCode).then(() => showToast('Room code copied!'));
});

// Lobby voice controls
document.getElementById('lobby-mute-btn').addEventListener('click', () => {
  VoiceChat.toggleMute();
  updateLobbyVoiceUI();
});
document.getElementById('lobby-mode-btn').addEventListener('click', () => {
  VoiceChat.setMode(VoiceChat.mode === 'open-mic' ? 'push-to-talk' : 'open-mic');
  updateLobbyVoiceUI();
});
function updateLobbyVoiceUI() {
  const panel = document.getElementById('lobby-voice-panel');
  const muteBtn = document.getElementById('lobby-mute-btn');
  const modeBtn = document.getElementById('lobby-mode-btn');
  const status = document.getElementById('lobby-voice-status');
  if (!panel) return;
  if (VoiceChat.hasStream) {
    panel.classList.remove('hidden');
    muteBtn.textContent = VoiceChat.isMuted ? '🔇 Muted' : '🔊 Mic On';
    modeBtn.textContent = VoiceChat.mode === 'open-mic' ? 'Open Mic' : 'PTT';
    if (VoiceChat.isConnected) {
      status.textContent = VoiceChat.mode === 'push-to-talk' ? 'Hold Space to talk' : 'Connected';
      status.style.color = 'var(--accent-green)';
    } else {
      status.textContent = 'Connecting...';
      status.style.color = 'var(--accent-yellow)';
    }
  } else {
    panel.classList.add('hidden');
  }
}

document.getElementById('btn-leave-lobby').addEventListener('click', () => {
  VoiceChat.hangup();
  socket.disconnect();
  socket.connect();
  showScreen('landing');
  exitSoloMode();
  nameInput.value = '';
  codeInput.value = '';
  updateLandingButtons();
  if (settings.musicVolume > 0) AudioFX.menuMusic();
});

document.querySelectorAll('.btn-role').forEach(btn => {
  btn.addEventListener('click', () => {
    // If this role is taken by the partner, flash the switch button instead
    if (btn.classList.contains('role-taken')) {
      const switchBtn = document.getElementById('btn-request-switch');
      if (switchBtn) {
        switchBtn.classList.add('glow-hint');
        setTimeout(() => switchBtn.classList.remove('glow-hint'), 1500);
      }
      showToast('This role is taken — request a switch below!');
      return;
    }
    document.querySelectorAll('.btn-role').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    socket.emit('select-role', { role: btn.dataset.role });
    AudioFX.click();
  });
});

document.querySelectorAll('.btn-diff').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-diff').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const customPanel = document.getElementById('custom-settings');
    if (btn.dataset.diff === 'custom') {
      customPanel.classList.remove('hidden');
      readCustomSettingsFromUI();
      socket.emit('select-difficulty', { difficulty: 'custom', customSettings });
    } else {
      customPanel.classList.add('hidden');
      socket.emit('select-difficulty', { difficulty: btn.dataset.diff });
    }
    AudioFX.click();
  });
});

// ── Custom Settings Listeners ──
function readCustomSettingsFromUI() {
  customSettings = {
    timer: +document.getElementById('custom-timer').value,
    maxStrikes: +document.getElementById('custom-strikes').value,
    wireCount: +document.getElementById('custom-wires').value,
    modules: ['wires'],
    sequenceEnforcement: document.getElementById('custom-sequence').checked,
    strikeSpeedup: document.getElementById('custom-speedup').checked,
  };
  if (document.getElementById('custom-mod-button').checked) customSettings.modules.push('button');
  if (document.getElementById('custom-mod-keypad').checked) customSettings.modules.push('keypad');
  if (document.getElementById('custom-mod-simon').checked) customSettings.modules.push('simon');
  if (document.getElementById('custom-mod-morse').checked) customSettings.modules.push('morse');
  if (document.getElementById('custom-mod-memory').checked) customSettings.modules.push('memory');
  if (document.getElementById('custom-mod-maze').checked) customSettings.modules.push('maze');
  if (document.getElementById('custom-mod-password').checked) customSettings.modules.push('password');
  if (document.getElementById('custom-mod-knob').checked) customSettings.modules.push('knob');
}

function emitCustomSettings() {
  readCustomSettingsFromUI();
  socket.emit('update-custom-settings', { customSettings });
}

function applyCustomSettingsToUI(cs) {
  if (!cs) return;
  document.getElementById('custom-timer').value = cs.timer;
  document.getElementById('custom-timer-val').textContent = cs.timer;
  document.getElementById('custom-strikes').value = cs.maxStrikes;
  document.getElementById('custom-strikes-val').textContent = cs.maxStrikes;
  document.getElementById('custom-wires').value = cs.wireCount;
  document.getElementById('custom-wires-val').textContent = cs.wireCount;
  document.getElementById('custom-mod-button').checked = cs.modules.includes('button');
  document.getElementById('custom-mod-keypad').checked = cs.modules.includes('keypad');
  document.getElementById('custom-mod-simon').checked = cs.modules.includes('simon');
  document.getElementById('custom-mod-morse').checked = cs.modules.includes('morse');
  document.getElementById('custom-mod-memory').checked = cs.modules.includes('memory');
  document.getElementById('custom-mod-maze').checked = cs.modules.includes('maze');
  document.getElementById('custom-mod-password').checked = cs.modules.includes('password');
  document.getElementById('custom-mod-knob').checked = cs.modules.includes('knob');
  document.getElementById('custom-sequence').checked = cs.sequenceEnforcement;
  document.getElementById('custom-speedup').checked = cs.strikeSpeedup;
  customSettings = cs;
}

// Slider value displays + emit
['custom-timer', 'custom-strikes', 'custom-wires'].forEach(id => {
  const el = document.getElementById(id);
  const valEl = document.getElementById(id + '-val');
  el.addEventListener('input', () => { valEl.textContent = el.value; emitCustomSettings(); });
});
// Checkboxes + toggles
['custom-mod-button', 'custom-mod-keypad', 'custom-mod-simon', 'custom-mod-morse',
 'custom-mod-memory', 'custom-mod-maze', 'custom-mod-password', 'custom-mod-knob',
 'custom-sequence', 'custom-speedup'].forEach(id => {
  document.getElementById(id).addEventListener('change', emitCustomSettings);
});

document.getElementById('btn-ready').addEventListener('click', () => {
  AudioFX.stopMenuMusic();
  socket.emit('player-ready');
  document.getElementById('btn-ready').disabled = true;
  document.getElementById('btn-ready').textContent = 'Waiting...';
});

socket.on('lobby-update', (state) => {
  renderLobbyPlayers(state);
  // Track partner name for leaderboard
  const partner = state.players.find(p => p.name !== myName);
  if (partner) window._partnerName = partner.name;
  // Auto-start voice chat — only first player (host) initiates to avoid dual-offer deadlock
  if (state.players.length === 2 && !VoiceChat.hasStream && state.players[0].name === myName) {
    VoiceChat.startCall();
  }
  // Update lobby voice controls (delayed to catch connection state)
  setTimeout(updateLobbyVoiceUI, 500);
  setTimeout(updateLobbyVoiceUI, 2000);
  document.querySelectorAll('.btn-diff').forEach(b => b.classList.toggle('active', b.dataset.diff === state.difficulty));
  const customPanel = document.getElementById('custom-settings');
  if (state.difficulty === 'custom') {
    customPanel.classList.remove('hidden');
    if (state.customSettings) applyCustomSettingsToUI(state.customSettings);
  } else {
    customPanel.classList.add('hidden');
  }
  // Ready button: only enabled when 2 players, both have roles, and I have a role
  const me = state.players.find(p => p.name === myName);
  const readyBtn = document.getElementById('btn-ready');
  const hasPartner = state.players.length === 2;
  const iHaveRole = me && me.role;
  const bothHaveRoles = hasPartner && state.players.every(p => p.role);
  const validRoles = state.players.some(p => p.role === 'instructor') && state.players.some(p => p.role === 'executor');

  if (me && me.ready) {
    readyBtn.disabled = true;
    readyBtn.textContent = 'Waiting...';
  } else if (hasPartner && iHaveRole && bothHaveRoles && validRoles) {
    readyBtn.disabled = false;
    readyBtn.textContent = 'Ready';
  } else {
    readyBtn.disabled = true;
    readyBtn.textContent = hasPartner ? 'Choose Roles' : 'Waiting for partner...';
  }

  // Show switch request button when both roles are assigned
  const switchArea = document.getElementById('switch-request-area');
  if (switchArea) {
    switchArea.classList.toggle('hidden', !(hasPartner && bothHaveRoles && validRoles));
  }

  // Highlight assigned role and mark the other as taken ONLY if partner exists
  const partner2 = hasPartner ? state.players.find(p => p.name !== myName) : null;
  document.querySelectorAll('.btn-role').forEach(b => {
    const isMyRole = me && b.dataset.role === me.role;
    const isTaken = partner2 && partner2.role && partner2.role === b.dataset.role;
    b.classList.toggle('selected', isMyRole);
    b.classList.toggle('role-taken', !!isTaken && !isMyRole);
  });
});

function renderLobbyPlayers(state) {
  const container = document.getElementById('player-slots');
  container.innerHTML = '';
  for (let i = 0; i < 2; i++) {
    const p = state.players[i];
    const slot = document.createElement('div');
    slot.className = 'player-slot';
    slot.innerHTML = p
      ? `<div class="player-name">${esc(p.name)}</div>
         <div class="player-role">${p.role ? cap(p.role) : 'Choosing role...'}</div>
         <span class="ready-badge ${p.ready ? 'is-ready' : 'not-ready'}">${p.ready ? 'Ready' : 'Not Ready'}</span>`
      : `<div class="player-name" style="color:var(--text-muted)">Waiting for player...</div>`;
    container.appendChild(slot);
  }
  const status = document.getElementById('lobby-status');
  if (state.players.length < 2) status.textContent = 'Share the room code with your partner!';
  else if (!state.players.every(p => p.role)) status.textContent = 'Both players must choose a role.';
  else if (!state.players.every(p => p.ready)) status.textContent = 'Both players must be ready.';
  else status.textContent = 'Starting...';
}

socket.on('role-error', ({ message }) => {
  showToast(message);
});

// ── Role Switch System ──
document.getElementById('btn-request-switch').addEventListener('click', () => {
  socket.emit('request-switch');
  AudioFX.click();
});

socket.on('switch-pending', ({ message }) => {
  const status = document.getElementById('switch-status');
  if (status) status.textContent = message;
});

socket.on('switch-error', ({ message }) => {
  showToast(message);
  const btn = document.getElementById('btn-request-switch');
  if (btn) { btn.disabled = true; btn.textContent = 'No more switches'; }
});

socket.on('switch-request', ({ from, remaining }) => {
  // Show incoming switch request
  const switchArea = document.getElementById('switch-request-area');
  if (!switchArea) return;
  // Remove any existing incoming request
  const old = switchArea.querySelector('.switch-incoming');
  if (old) old.remove();

  const div = document.createElement('div');
  div.className = 'switch-incoming';
  div.innerHTML = `
    <p><strong>${esc(from)}</strong> wants to switch roles. Accept?</p>
    <div class="switch-btns">
      <button class="btn-accept">Accept</button>
      <button class="btn-decline">Decline</button>
    </div>
  `;
  switchArea.appendChild(div);
  AudioFX.radioClick();

  div.querySelector('.btn-accept').addEventListener('click', () => {
    socket.emit('switch-response', { accepted: true });
    div.remove();
  });
  div.querySelector('.btn-decline').addEventListener('click', () => {
    socket.emit('switch-response', { accepted: false });
    div.remove();
  });
});

socket.on('switch-accepted', () => {
  showToast('Roles switched!');
  const status = document.getElementById('switch-status');
  if (status) status.textContent = '';
});

socket.on('switch-declined', () => {
  showToast('Switch request declined.');
  const status = document.getElementById('switch-status');
  if (status) status.textContent = 'Partner declined.';
  setTimeout(() => { if (status) status.textContent = ''; }, 3000);
});

// ══════════════════════ BRIEFING ══════════════════════
socket.on('go-briefing', () => {
  showScreen('briefing');
  const sel = document.querySelector('.btn-role.selected');
  myRole = sel ? sel.dataset.role : 'executor';
  const rt = document.getElementById('briefing-role-text');
  const steps = document.getElementById('briefing-steps');
  if (myRole === 'instructor') {
    rt.innerHTML = 'You are the <strong style="color:var(--accent-blue)">INSTRUCTOR</strong> — you have the manual but CANNOT see the bomb.';
    steps.innerHTML = `
      <div class="briefing-step"><span class="step-num">1</span><div><strong>Listen to the bomb details</strong><br>Your partner will describe: serial number, shape, size, batteries, indicators, and ports.</div></div>
      <div class="briefing-step step-critical"><span class="step-num">2</span><div><strong>Find the PROTOCOL</strong><br>Open the <em>Index</em> tab and match the bomb details to find the Protocol (Alpha, Bravo, or Charlie). This determines ALL the rules. <strong>Get this right first!</strong></div></div>
      <div class="briefing-step step-critical"><span class="step-num">3</span><div><strong>Find the SEQUENCE</strong><br>Open the <em>Sequence</em> tab. Use the battery count + serial number to find the correct module solve order. Tell your partner which module to solve first, second, etc. <strong>Wrong order = strike!</strong></div></div>
      <div class="briefing-step"><span class="step-num">4</span><div><strong>Guide each module</strong><br>For each module, open its tab in the manual, find the rules for your Protocol, and tell your partner exactly what to do.</div></div>
    `;
  } else {
    rt.innerHTML = 'You are the <strong style="color:var(--accent-orange)">EXECUTOR</strong> — you see the bomb but have NO manual.';
    steps.innerHTML = `
      <div class="briefing-step step-critical"><span class="step-num">1</span><div><strong>Describe the bomb FIRST</strong><br>Before touching anything, tell your partner: the serial number, shape, size, batteries, indicators, and ports. They need this to find the Protocol.</div></div>
      <div class="briefing-step step-critical"><span class="step-num">2</span><div><strong>Wait for the PROTOCOL and SEQUENCE</strong><br>Your partner will tell you the Protocol and which module to solve first. <strong>Don't solve modules in the wrong order — it causes a strike!</strong></div></div>
      <div class="briefing-step"><span class="step-num">3</span><div><strong>Describe each module</strong><br>Tell your partner what you see on each module (wire colors, button label, symbols, etc.) and follow their instructions precisely.</div></div>
      <div class="briefing-step"><span class="step-num">4</span><div><strong>3 strikes = explosion</strong><br>Wrong actions and wrong sequence both cause strikes. The timer speeds up with each strike.</div></div>
    `;
  }
});

document.getElementById('btn-briefing-ready').addEventListener('click', () => {
  socket.emit('briefing-ready');
  document.getElementById('btn-briefing-ready').disabled = true;
  document.getElementById('btn-briefing-ready').textContent = 'Waiting...';
  document.getElementById('btn-briefing-ready').classList.remove('pulse');
  document.getElementById('briefing-status').textContent = 'Waiting for partner...';
});

socket.on('briefing-partner-ready', () => {
  document.getElementById('briefing-status').textContent = 'Partner ready!';
});

socket.on('start-countdown', () => {
  document.getElementById('briefing-status').textContent = '';
  const overlay = document.getElementById('countdown-overlay');
  const numEl = document.getElementById('countdown-number');
  const labelEl = document.getElementById('countdown-label');
  overlay.classList.remove('hidden');
  overlay.classList.add('cd-active');

  const steps = [
    { text: '3', cls: 'cd-step-3', label: 'STAND BY', delay: 0, sfx: () => AudioFX.countdownTick(3) },
    { text: '2', cls: 'cd-step-2', label: 'GET READY', delay: 1000, sfx: () => AudioFX.countdownTick(2) },
    { text: '1', cls: 'cd-step-1', label: 'BRACE', delay: 2000, sfx: () => AudioFX.countdownTick(1) },
    { text: 'GO', cls: 'cd-step-go', label: '', delay: 3000, sfx: () => AudioFX.countdownGo() },
  ];

  const prevClasses = [];

  steps.forEach(({ text, cls, label, delay, sfx }) => {
    setTimeout(() => {
      // Remove previous step classes
      prevClasses.forEach(c => overlay.classList.remove(c));
      prevClasses.push(cls);

      // Set text
      numEl.textContent = text;
      labelEl.textContent = label;

      // Add step class
      overlay.classList.add(cls);

      // Re-trigger number animation
      numEl.style.animation = 'none';
      numEl.offsetHeight;
      numEl.style.animation = '';

      // Screen shake on GO
      if (cls === 'cd-step-go' && settings.screenShake) {
        overlay.classList.add('cd-shake');
      }

      sfx();
    }, delay);
  });
});

// ══════════════════════ GAME START ══════════════════════
socket.on('game-start', async (data) => {
  myRole = data.role;
  gameDifficulty = data.difficulty || 'easy';
  timerSpeed = 1;
  isHoldingButton = false;
  stripColor = null;
  simonFlashing = false;
  resetMagCracks();

  // Play cinematic intro before showing the game
  await playIntro(data.role);

  showScreen('game');

  if (data.role === 'executor') {
    bombState = data.bomb;
    timerValue = data.bomb.timer;
    renderExecutorView();
  } else {
    manualData = data.manual;
    timerValue = data.timer;
    currentManualTab = 'index';
    renderInstructorView();
    showKeybindOverlay();
  }

  updateTimer(timerValue, 1);
  updateStrikes(myRole === 'executor' ? bombState.strikes : 0, data.maxStrikes || (bombState ? bombState.maxStrikes : 3));

  document.getElementById('chat-messages').innerHTML = '';
  addSystemMessage('Game started! Communicate through this chat.');
  if (myRole === 'executor') {
    addSystemMessage('Describe the bomb to your partner: Protocol, serial number, shape, indicators, batteries, ports, and all modules.');
  } else {
    addSystemMessage('Wait for your partner to describe the bomb. Use the Index tab to identify it. The PROTOCOL determines which rules to follow!');
  }
  addSystemMessage('WARNING: Mistakes speed up the timer and skip time! Third strike detonates the bomb.');
});

// ══════════════════════ EXECUTOR VIEW ══════════════════════
const SCREW_SVG = `<svg viewBox="0 0 12 12" width="12" height="12"><defs><radialGradient id="sg" cx="38%" cy="32%"><stop offset="0%" stop-color="#999"/><stop offset="40%" stop-color="#666"/><stop offset="100%" stop-color="#2a2a2a"/></radialGradient></defs><circle cx="6" cy="6" r="5" fill="url(#sg)" stroke="#1a1a1a" stroke-width="0.8"/><circle cx="6" cy="6" r="5" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="0.3"/><line x1="2.5" y1="6" x2="9.5" y2="6" stroke="#1a1a1a" stroke-width="0.8"/><line x1="6" y1="2.5" x2="6" y2="9.5" stroke="#1a1a1a" stroke-width="0.8"/></svg>`;
const RIVET_SVG = `<svg viewBox="0 0 12 12" width="12" height="12"><defs><radialGradient id="rg" cx="35%" cy="28%"><stop offset="0%" stop-color="#aaa"/><stop offset="30%" stop-color="#777"/><stop offset="100%" stop-color="#3a3a3a"/></radialGradient></defs><circle cx="6" cy="6" r="4.5" fill="url(#rg)" stroke="#222" stroke-width="0.6"/><circle cx="4.5" cy="4.2" r="1.5" fill="rgba(255,255,255,0.12)"/></svg>`;

function renderExecutorView() {
  clearAllMorseTimeouts();
  const content = document.getElementById('game-content');
  document.getElementById('game-bomb-type').textContent = '';

  const solved = bombState.modules.filter(m => m.solved).length;
  document.getElementById('game-module-count').textContent = `Modules: ${solved}/${bombState.modules.length}`;

  const shapeClass = `bomb-shape-${bombState.shape}`;
  const themeClass = bombState.casingTheme ? `bomb-theme-${bombState.casingTheme}` : '';
  const textureClass = bombState.casingTexture ? `bomb-texture-${bombState.casingTexture}` : '';
  const stripeClass = bombState.casingTheme ? `bomb-stripe-${bombState.casingTheme}` : '';
  const modCount = bombState.modules.length;
  const rivets = Array(8).fill(RIVET_SVG).join('');

  let html = '<div class="bomb-container">';
  html += `<div class="bomb-casing ${shapeClass} ${themeClass} ${textureClass}">`;

  // Shape-specific decoration
  const shapeDecorations = {
    round: `<div class="bomb-deco-round"><svg viewBox="0 0 200 60" width="100%" height="60" preserveAspectRatio="none">
      <defs>
        <radialGradient id="domeG" cx="50%" cy="100%"><stop offset="0%" stop-color="rgba(255,255,255,0.1)"/><stop offset="100%" stop-color="transparent"/></radialGradient>
        <radialGradient id="fuseGlow" cx="50%" cy="50%"><stop offset="0%" stop-color="#ffe066" stop-opacity="0.8"/><stop offset="50%" stop-color="#f0883e" stop-opacity="0.4"/><stop offset="100%" stop-color="transparent"/></radialGradient>
      </defs>
      <ellipse cx="100" cy="58" rx="100" ry="44" fill="url(#domeG)"/>
      <rect x="88" y="28" width="24" height="22" rx="4" fill="#2a2d31" stroke="#5a5d62" stroke-width="2"/>
      <rect x="93" y="32" width="14" height="14" rx="2" fill="#1a1c20" stroke="#3a3d42" stroke-width="1"/>
      <line x1="100" y1="28" x2="100" y2="10" stroke="#c9a227" stroke-width="3" stroke-linecap="round"/>
      <line x1="100" y1="28" x2="100" y2="10" stroke="#8a7020" stroke-width="1" stroke-dasharray="2 3"/>
      <path d="M100 10 C105 2 114 5 110 -4" stroke="#c9a227" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <circle cx="110" cy="-4" r="8" fill="url(#fuseGlow)"/>
      <circle cx="110" cy="-4" r="4" fill="#ffc040" opacity="0.9"/>
      <circle cx="110" cy="-4" r="2" fill="#fff8e0" opacity="0.7"/>
      <circle cx="110" cy="-4" r="8" fill="none" stroke="rgba(255,180,40,0.5)" stroke-width="2"><animate attributeName="r" from="8" to="20" dur="1.2s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.6" to="0" dur="1.2s" repeatCount="indefinite"/></circle>
      <circle cx="110" cy="-4" r="4" fill="none" stroke="rgba(255,220,80,0.6)" stroke-width="1.5"><animate attributeName="r" from="4" to="12" dur="0.8s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.8" to="0" dur="0.8s" repeatCount="indefinite"/></circle>
    </svg></div>`,
    square: `<div class="bomb-deco-square">
      <span class="bomb-deco-square-corner tl"></span><span class="bomb-deco-square-corner tr"></span>
      <span class="bomb-deco-square-corner bl"></span><span class="bomb-deco-square-corner br"></span>
    </div>`,
    cylindrical: `<div class="bomb-deco-cylindrical"><svg viewBox="0 0 300 24" width="100%" height="24" preserveAspectRatio="none">
      <defs><linearGradient id="capG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(255,255,255,0.1)"/><stop offset="50%" stop-color="rgba(255,255,255,0.02)"/><stop offset="100%" stop-color="rgba(255,255,255,0.08)"/></linearGradient></defs>
      <rect x="0" y="0" width="300" height="24" fill="url(#capG)"/>
      <line x1="0" y1="4" x2="300" y2="4" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      <line x1="0" y1="12" x2="300" y2="12" stroke="rgba(255,255,255,0.04)" stroke-width="0.5"/>
      <line x1="0" y1="20" x2="300" y2="20" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      <circle cx="30" cy="12" r="5" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
      <circle cx="30" cy="12" r="2" fill="rgba(255,255,255,0.06)"/>
      <circle cx="270" cy="12" r="5" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
      <circle cx="270" cy="12" r="2" fill="rgba(255,255,255,0.06)"/>
      <rect x="140" y="7" width="20" height="10" rx="2" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
    </svg></div>`,
    briefcase: `<div class="bomb-deco-briefcase"><svg viewBox="0 0 200 42" width="100%" height="42" preserveAspectRatio="xMidYMax meet">
      <defs><linearGradient id="handleG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6a6d72"/><stop offset="50%" stop-color="#4a4d52"/><stop offset="100%" stop-color="#3a3d42"/></linearGradient></defs>
      <rect x="60" y="2" width="80" height="12" rx="6" fill="none" stroke="url(#handleG)" stroke-width="3"/>
      <rect x="60" y="8" width="4" height="14" rx="1" fill="#3a3d42" stroke="#5a5d62" stroke-width="1"/>
      <rect x="136" y="8" width="4" height="14" rx="1" fill="#3a3d42" stroke="#5a5d62" stroke-width="1"/>
      <rect x="72" y="22" width="14" height="12" rx="2" fill="#2a2d31" stroke="#6a6d72" stroke-width="1.5"/>
      <circle cx="79" cy="28" r="2.5" fill="#555" stroke="#777" stroke-width="0.5"/>
      <line x1="79" y1="26" x2="79" y2="30" stroke="#888" stroke-width="0.7"/>
      <rect x="114" y="22" width="14" height="12" rx="2" fill="#2a2d31" stroke="#6a6d72" stroke-width="1.5"/>
      <circle cx="121" cy="28" r="2.5" fill="#555" stroke="#777" stroke-width="0.5"/>
      <line x1="121" y1="26" x2="121" y2="30" stroke="#888" stroke-width="0.7"/>
      <line x1="62" y1="35" x2="62" y2="42" stroke="#4a4d52" stroke-width="1.5"/>
      <line x1="138" y1="35" x2="138" y2="42" stroke="#4a4d52" stroke-width="1.5"/>
    </svg></div>`,
    barrel: `<div class="bomb-deco-barrel"><svg viewBox="0 0 300 22" width="100%" height="22" preserveAspectRatio="none">
      <defs><linearGradient id="bandG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(255,255,255,0.1)"/><stop offset="40%" stop-color="rgba(255,255,255,0.03)"/><stop offset="100%" stop-color="rgba(255,255,255,0.08)"/></linearGradient></defs>
      <rect x="0" y="0" width="300" height="22" fill="url(#bandG)"/>
      <line x1="0" y1="3" x2="300" y2="3" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
      <line x1="0" y1="19" x2="300" y2="19" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
      <circle cx="40" cy="11" r="4" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
      <circle cx="40" cy="11" r="1.5" fill="rgba(255,255,255,0.06)"/>
      <circle cx="150" cy="11" r="6" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      <circle cx="150" cy="11" r="3" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="0.5"/>
      <circle cx="260" cy="11" r="4" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
      <circle cx="260" cy="11" r="1.5" fill="rgba(255,255,255,0.06)"/>
    </svg></div>`,
  };
  html += shapeDecorations[bombState.shape] || '';

  // Hazard stripe top
  html += `<div class="bomb-casing-edge top ${stripeClass}"></div>`;
  // Rivet row
  html += `<div class="rivet-row">${rivets}</div>`;

  // Timer LED on bomb casing
  html += '<div class="bomb-timer-led"></div>';

  // ── Metal Nameplate ──
  html += '<div class="bomb-info-plate">';
  html += '<span class="plate-corner-bl"></span><span class="plate-corner-br"></span>';
  html += `<div class="plate-protocol">DEVICE IDENTIFICATION</div>`;
  html += `<div class="plate-serial-row"><span class="plate-serial">${bombState.serial}</span></div>`;
  html += '<div class="plate-fields">';
  html += `<div class="plate-field"><span class="plate-field-label">Shape</span><span class="plate-field-value">${cap(bombState.shape)}</span></div>`;
  html += `<div class="plate-field"><span class="plate-field-label">Size</span><span class="plate-field-value">${cap(bombState.size)}</span></div>`;
  html += '<div class="plate-field"><span class="plate-field-label">Batteries</span><span class="plate-field-value"><span class="battery-icons">';
  for (let b = 0; b < bombState.batteries; b++) html += '<span class="battery-icon"></span>';
  if (bombState.batteries === 0) html += 'None';
  html += '</span></span></div>';
  html += '<div class="plate-field"><span class="plate-field-label">Indicators</span><span class="plate-field-value">';
  if (bombState.indicators.length === 0) html += 'None';
  else html += bombState.indicators.map(i => `<span class="indicator-led ${i.lit ? 'lit' : 'unlit'}"><span class="led-dot"></span>${i.label}</span>`).join(' ');
  html += '</span></div>';
  html += '<div class="plate-field" style="grid-column:1/-1"><span class="plate-field-label">Ports</span><span class="plate-field-value">';
  if (bombState.ports.length === 0) html += 'None';
  else html += bombState.ports.map(p => `<span class="port-chip">${p}</span>`).join(' ');
  html += '</span></div>';
  html += '</div></div>';

  // ── Stencil Labels ──
  if (bombState.stencilLabels && bombState.stencilLabels.length) {
    bombState.stencilLabels.forEach(s => {
      html += `<div class="bomb-stencil" style="top:${s.top}%;left:${s.left}%;transform:rotate(${s.rotation}deg)">${esc(s.text)}</div>`;
    });
  }

  // ── Module Grid ──
  html += `<div class="bomb-modules-grid modules-${modCount}">`;
  bombState.modules.forEach((mod, mi) => { html += renderModule(mod, mi); });
  html += '</div>';

  // ── Model Placard ──
  if (bombState.modelNumber) {
    html += `<div class="bomb-placard"><span class="placard-hazard">⚠</span> ${esc(bombState.modelNumber)}</div>`;
  }

  // Bottom shape decorations
  if (bombState.shape === 'barrel') html += '<div class="bomb-deco-barrel"></div>';
  if (bombState.shape === 'cylindrical') html += '<div class="bomb-deco-cylindrical"></div>';

  // Rivet row + hazard stripe bottom
  html += `<div class="rivet-row">${rivets}</div>`;
  html += `<div class="bomb-casing-edge bottom ${stripeClass}"></div>`;

  html += '</div></div>';
  content.innerHTML = html;
  attachExecutorListeners();
  // Faux-3D: animate modules in (only on first render, not updates)
  if (!window._executorRendered) {
    window._executorRendered = true;
    animateModuleEntrance();
    // Phase 6: start ambient effects
    initDust();
    startFuseSparks();
    AudioFX.startRoomAmbience();
  }
}

function renderModule(mod, mi) {
  const sc = mod.solved ? ' solved' : '';
  const ledClass = mod.solved ? 'solved-led' : 'unsolved';
  const solvedBadge = mod.solved ? '<span class="module-solved-badge">&#10003; DEFUSED</span>' : '';
  const moduleNames = { wires: 'Wires', button: 'Button', keypad: 'Keypad', simon: 'Simon Says', morse: 'Morse Code', memory: 'Memory', maze: 'Maze', password: 'Password', knob: 'Knob' };
  const title = moduleNames[mod.type] || cap(mod.type);

  let html = `<div class="module-panel${sc}" data-module="${mi}" data-type="${mod.type}">`;
  // Corner screws
  html += `<span class="screw-tl">${SCREW_SVG}</span><span class="screw-tr">${SCREW_SVG}</span>`;
  html += `<span class="screw-bl">${SCREW_SVG}</span><span class="screw-br">${SCREW_SVG}</span>`;
  // Header
  html += `<div class="module-panel-header"><span class="module-status-led ${ledClass}"></span>${title}${solvedBadge}</div>`;
  html += '<div class="module-panel-body">';

  switch (mod.type) {
    case 'wires': {
      html += '<div class="wire-rack">';
      mod.wireColors.forEach((color, wi) => {
        const isCut = (mod.cutWires || []).includes(wi);
        const label = `${cap(color)} Wire — Position ${wi + 1} of ${mod.wireCount}`;
        html += `<div class="wire-row wire-color-${color}${isCut ? ' wire-cut' : ''}" data-module="${mi}" data-wire="${wi}" tabindex="0" role="button" aria-label="${label}">`;
        html += '<div class="wire-terminal wire-terminal-left"></div>';
        html += '<div class="wire-strand"></div>';
        html += '<div class="wire-terminal wire-terminal-right"></div>';
        html += `<span class="wire-label">${cap(color)}</span>`;
        html += `<span class="wire-tooltip">${label}</span>`;
        html += '</div>';
      });
      html += '</div>';
      break;
    }
    case 'button': {
      const iconMap = { triangle: '\u25B3', circle: '\u25CB', star: '\u2605', lightning: '\u26A1' };
      const icon = iconMap[mod.icon] || mod.icon;
      html += '<div class="bomb-button-container">';
      html += '<div class="bomb-button-mount"><div class="bomb-button-bezel">';
      html += `<div class="bomb-button-cap bomb-button-cap-${mod.color}${mod.solved ? ' solved-btn' : ''}" data-module="${mi}" tabindex="0" role="button" aria-label="${mod.color} button labeled ${mod.label}">`;
      html += `<span class="btn-icon">${icon}</span><span class="btn-label">${mod.label}</span>`;
      html += '</div></div></div>';
      html += `<div class="bomb-button-info">Color: ${cap(mod.color)} &middot; Label: ${mod.label} &middot; Icon: ${mod.icon}</div>`;
      if (isHoldingButton && buttonHoldModule === mi) {
        html += `<div class="holding-indicator">HOLDING... ${stripColor ? `Strip color: <strong style="color:${stripColor}">${cap(stripColor)}</strong> — release at the right time!` : 'waiting for strip...'}</div>`;
      }
      html += '</div>';
      break;
    }
    case 'keypad': {
      html += '<div class="keypad-grid">';
      mod.symbols.forEach(sym => {
        const pressed = (mod.pressedSymbols || []).includes(sym);
        html += `<div class="keypad-key${pressed ? ' pressed' : ''}" data-module="${mi}" data-symbol="${sym}" tabindex="0" role="button" aria-label="Symbol ${sym}">${sym}</div>`;
      });
      html += '</div>';
      break;
    }
    case 'simon': {
      html += '<div class="simon-container"><div class="simon-display" id="simon-display-' + mi + '">';
      ['red', 'blue', 'green', 'yellow'].forEach(c => {
        html += `<div class="simon-light simon-${c}" data-module="${mi}" data-color="${c}" tabindex="0" role="button" aria-label="Simon ${c}"><span class="cb-label">${c[0].toUpperCase()}</span></div>`;
      });
      html += '</div>';
      html += `<button class="btn btn-tiny simon-replay-btn" data-module="${mi}">Replay Sequence</button></div>`;
      break;
    }
    case 'morse': {
      html += '<div class="morse-container">';
      html += '<div class="morse-lamp-assembly">';
      html += `<div class="morse-bulb-housing"><div class="morse-light" id="morse-light-${mi}"></div></div>`;
      html += `<div class="morse-status" id="morse-status-${mi}"></div>`;
      html += '<div class="morse-lamp-label">Signal Lamp</div>';
      html += '</div>';
      html += '<div class="morse-info">Describe the blinking pattern to your partner.</div>';
      html += '<div class="morse-freq-input">';
      html += `<label>Frequency (MHz):</label>`;
      html += `<select class="morse-freq-select" data-module="${mi}"><option value="">Select...</option>`;
      ['3.505','3.515','3.522','3.532','3.535','3.542','3.545','3.552','3.555','3.565','3.572','3.575','3.582','3.592','3.595','3.600'].forEach(f => {
        html += `<option value="${f}">${f} MHz</option>`;
      });
      html += '</select>';
      html += `<button class="btn btn-primary btn-tiny morse-submit-btn" data-module="${mi}">Submit</button>`;
      html += '</div></div>';
      break;
    }
    case 'password': {
      html += '<div class="password-container">';
      html += '<div class="password-columns">';
      for (let c = 0; c < 5; c++) {
        const letterIdx = mod.currentLetters ? mod.currentLetters[c] : 0;
        const letter = mod.columns[c][letterIdx];
        html += `<div class="password-column" data-module="${mi}" data-col="${c}">`;
        html += `<button class="btn btn-tiny password-arrow password-up" data-module="${mi}" data-col="${c}" data-dir="up" aria-label="Cycle column ${c+1} up">\u25B2</button>`;
        html += `<div class="password-letter">${letter}</div>`;
        html += `<button class="btn btn-tiny password-arrow password-down" data-module="${mi}" data-col="${c}" data-dir="down" aria-label="Cycle column ${c+1} down">\u25BC</button>`;
        html += '</div>';
      }
      html += '</div>';
      html += `<button class="btn btn-primary btn-tiny password-submit-btn" data-module="${mi}">Submit Word</button>`;
      html += '</div>';
      break;
    }
    case 'memory': {
      const stageNum = mod.currentStage + 1;
      const total = mod.totalStages || 5;
      html += '<div class="memory-container">';
      html += `<div class="memory-stage-indicator">Stage ${Math.min(stageNum, total)} / ${total}</div>`;
      html += `<div class="memory-display">${mod.display}</div>`;
      html += '<div class="memory-buttons">';
      mod.buttons.forEach((label, idx) => {
        html += `<button class="memory-button" data-module="${mi}" data-label="${label}" data-position="${idx+1}" tabindex="0" role="button" aria-label="Button labeled ${label} at position ${idx+1}">${label}</button>`;
      });
      html += '</div></div>';
      break;
    }
    case 'maze': {
      html += '<div class="maze-container">';
      html += `<div class="maze-grid" id="maze-grid-${mi}">`;
      for (let r = 0; r < mod.grid; r++) {
        for (let c = 0; c < mod.grid; c++) {
          let cellClass = 'maze-cell';
          let content = '';
          if (r === mod.currentPos.row && c === mod.currentPos.col) { cellClass += ' maze-player'; content = '\u25CF'; }
          else if (r === mod.start.row && c === mod.start.col) { cellClass += ' maze-start'; content = '\u25CB'; }
          else if (r === mod.end.row && c === mod.end.col) { cellClass += ' maze-end'; content = '\u25B2'; }
          mod.markers.forEach(m => { if (m.row === r && m.col === c) { cellClass += ' maze-marker'; if (!content) content = '\u25C9'; } });
          html += `<div class="${cellClass}" data-row="${r}" data-col="${c}">${content}</div>`;
        }
      }
      html += '</div>';
      html += '<div class="maze-controls">';
      html += `<button class="btn btn-tiny maze-dir-btn" data-module="${mi}" data-dir="up" aria-label="Move up">\u25B2</button>`;
      html += '<div class="maze-controls-row">';
      html += `<button class="btn btn-tiny maze-dir-btn" data-module="${mi}" data-dir="left" aria-label="Move left">\u25C0</button>`;
      html += `<button class="btn btn-tiny maze-dir-btn" data-module="${mi}" data-dir="down" aria-label="Move down">\u25BC</button>`;
      html += `<button class="btn btn-tiny maze-dir-btn" data-module="${mi}" data-dir="right" aria-label="Move right">\u25B6</button>`;
      html += '</div></div></div>';
      break;
    }
    case 'knob': {
      html += '<div class="knob-container">';
      html += '<div class="knob-led-grid">';
      for (let i = 0; i < 12; i++) {
        if (i === 6) html += '</div><div class="knob-led-grid">';
        html += `<div class="knob-led${mod.leds[i] ? ' on' : ''}"></div>`;
      }
      html += '</div>';
      html += '<div class="knob-dial-container">';
      const positions = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
      positions.forEach(pos => {
        const active = mod.currentPosition === pos ? ' active' : '';
        html += `<button class="btn btn-tiny knob-position-btn${active}" data-module="${mi}" data-position="${pos}" aria-label="Set dial to ${pos}">${pos}</button>`;
      });
      html += '</div>';
      html += `<button class="btn btn-primary btn-tiny knob-submit-btn" data-module="${mi}">Set Position</button>`;
      html += '</div>';
      break;
    }
  }

  html += '</div></div>';
  return html;
}

function attachExecutorListeners() {
  // Wires
  document.querySelectorAll('.wire-row:not(.wire-cut)').forEach(wire => {
    wire.addEventListener('click', (e) => {
      const mi = +wire.dataset.module, wi = +wire.dataset.wire;
      showConfirmation(e, `Cut ${wire.getAttribute('aria-label')}?`, () => {
        socket.emit('cut-wire', { moduleIndex: mi, wireIndex: wi });
        AudioFX.snip();
      });
    });
    wire.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wire.click(); } });
  });

  // Button (press vs hold)
  document.querySelectorAll('.bomb-button-cap:not(.solved-btn)').forEach(btn => {
    let holdTimer = null;
    btn.addEventListener('mousedown', () => {
      AudioFX.buttonPress();
      const mi = +btn.dataset.module;
      holdTimer = setTimeout(() => {
        isHoldingButton = true;
        buttonHoldModule = mi;
        stripColor = null;
        socket.emit('button-hold', { moduleIndex: mi });
        if (isSoloMode) renderSoloView(); else renderExecutorView();
        holdTimer = null;
      }, 600);
    });
    btn.addEventListener('mouseup', () => {
      const mi = +btn.dataset.module;
      if (holdTimer) {
        clearTimeout(holdTimer); holdTimer = null;
        showConfirmation({ clientX: btn.getBoundingClientRect().left + 60, clientY: btn.getBoundingClientRect().top - 10 },
          'Quick PRESS this button?', () => socket.emit('button-press', { moduleIndex: mi }));
      } else if (isHoldingButton && buttonHoldModule === mi) {
        isHoldingButton = false;
        socket.emit('button-release', { moduleIndex: mi, timerValue });
        if (isSoloMode) renderSoloView(); else renderExecutorView();
      }
    });
    btn.addEventListener('mouseleave', () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const mi = +btn.dataset.module;
        showConfirmation({ clientX: btn.getBoundingClientRect().left + 60, clientY: btn.getBoundingClientRect().top - 10 },
          'Quick PRESS this button?', () => { socket.emit('button-press', { moduleIndex: mi }); AudioFX.buttonPress(); });
      }
    });
  });

  // Keypad
  document.querySelectorAll('.keypad-key:not(.pressed)').forEach(key => {
    key.addEventListener('click', () => {
      socket.emit('keypad-press', { moduleIndex: +key.dataset.module, symbol: key.dataset.symbol });
      AudioFX.keypadBeep();
    });
    key.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); key.click(); } });
  });

  // Simon Says
  document.querySelectorAll('.simon-light').forEach(light => {
    light.addEventListener('click', () => {
      if (simonFlashing) return;
      socket.emit('simon-input', { moduleIndex: +light.dataset.module, color: light.dataset.color });
      AudioFX.keypadBeep();
      light.classList.add('active');
      setTimeout(() => light.classList.remove('active'), 200);
    });
  });
  document.querySelectorAll('.simon-replay-btn').forEach(btn => {
    btn.addEventListener('click', () => socket.emit('simon-replay', { moduleIndex: +btn.dataset.module }));
  });

  // Morse submit
  document.querySelectorAll('.morse-submit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mi = +btn.dataset.module;
      const sel = document.querySelector(`.morse-freq-select[data-module="${mi}"]`);
      if (sel.value) {
        showConfirmation({ clientX: btn.getBoundingClientRect().left, clientY: btn.getBoundingClientRect().top - 10 },
          `Submit frequency ${sel.value} MHz?`, () => socket.emit('morse-submit', { moduleIndex: mi, freq: sel.value }));
      }
    });
  });

  // Password
  document.querySelectorAll('.password-arrow').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('password-cycle', { moduleIndex: +btn.dataset.module, column: +btn.dataset.col, direction: btn.dataset.dir });
      AudioFX.click();
    });
  });
  document.querySelectorAll('.password-submit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mi = +btn.dataset.module;
      const mod = bombState.modules[mi];
      const word = mod.currentLetters.map((idx, c) => mod.columns[c][idx]).join('');
      showConfirmation({ clientX: btn.getBoundingClientRect().left, clientY: btn.getBoundingClientRect().top - 10 },
        `Submit word "${word}"?`, () => socket.emit('password-submit', { moduleIndex: mi }));
    });
  });

  // Memory
  document.querySelectorAll('.memory-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const mi = +btn.dataset.module;
      const label = +btn.dataset.label;
      const position = +btn.dataset.position;
      socket.emit('memory-press', { moduleIndex: mi, label, position });
      AudioFX.keypadBeep();
    });
  });

  // Maze
  document.querySelectorAll('.maze-dir-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('maze-move', { moduleIndex: +btn.dataset.module, direction: btn.dataset.dir });
      AudioFX.click();
    });
  });
  // Maze keyboard controls — use shared handler to avoid listener leak
  if (!window._mazeKeyHandler) {
    window._mazeKeyHandler = (e) => {
      if (!bombState) return;
      const mazeIdx = bombState.modules.findIndex(m => m.type === 'maze' && !m.solved);
      if (mazeIdx === -1) return;
      const dirMap = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      const dir = dirMap[e.key];
      if (dir) { e.preventDefault(); socket.emit('maze-move', { moduleIndex: mazeIdx, direction: dir }); AudioFX.click(); }
    };
    document.addEventListener('keydown', window._mazeKeyHandler);
  }

  // Knob
  document.querySelectorAll('.knob-position-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.knob-position-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AudioFX.click();
    });
  });
  document.querySelectorAll('.knob-submit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mi = +btn.dataset.module;
      const activeBtn = document.querySelector(`.knob-position-btn.active[data-module="${mi}"]`);
      if (activeBtn) {
        const pos = activeBtn.dataset.position;
        showConfirmation({ clientX: btn.getBoundingClientRect().left, clientY: btn.getBoundingClientRect().top - 10 },
          `Set dial to ${pos}?`, () => socket.emit('knob-set', { moduleIndex: mi, position: pos }));
      }
    });
  });

  // Start morse flashing
  bombState.modules.forEach((mod, mi) => {
    if (mod.type === 'morse' && !mod.solved) startMorseFlash(mi, mod.word);
  });
  // Auto-trigger first Simon flash
  bombState.modules.forEach((mod, mi) => {
    if (mod.type === 'simon' && !mod.solved) {
      setTimeout(() => socket.emit('simon-replay', { moduleIndex: mi }), 500);
    }
  });
}

// ── Morse Code Flashing ─────────────────────────────────────────
const MORSE_CODE = {
  A:'.-',B:'-...',C:'-.-.',D:'-..',E:'.',F:'..-.',G:'--.',H:'....',I:'..',J:'.---',
  K:'-.-',L:'.-..',M:'--',N:'-.',O:'---',P:'.--.',Q:'--.-',R:'.-.',S:'...',T:'-',
  U:'..-',V:'...-',W:'.--',X:'-..-',Y:'-.--',Z:'--..'
};

const _morseTimeouts = new Map();

function clearAllMorseTimeouts() {
  _morseTimeouts.forEach(tid => clearTimeout(tid));
  _morseTimeouts.clear();
}

function startMorseFlash(moduleIndex, letter) {
  // Clear any existing timeout for this module
  if (_morseTimeouts.has(moduleIndex)) clearTimeout(_morseTimeouts.get(moduleIndex));
  const lightEl = document.getElementById(`morse-light-${moduleIndex}`);
  if (!lightEl) return;
  const statusEl = document.getElementById(`morse-status-${moduleIndex}`);
  const DOT = 200, DASH = 800, GAP = 400, REPEAT_PAUSE = 3000;
  const code = MORSE_CODE[letter];
  if (!code) return;
  // Build timings for single letter
  const timings = [];
  for (let j = 0; j < code.length; j++) {
    timings.push({ on: true, duration: code[j] === '.' ? DOT : DASH });
    if (j < code.length - 1) timings.push({ on: false, duration: GAP });
  }
  // Long pause at end signals reset
  timings.push({ on: false, duration: REPEAT_PAUSE, isReset: true });
  let idx = 0;
  function step() {
    if (!document.getElementById(`morse-light-${moduleIndex}`)) { _morseTimeouts.delete(moduleIndex); return; }
    const t = timings[idx % timings.length];
    lightEl.classList.toggle('on', t.on);
    if (statusEl) {
      statusEl.textContent = t.isReset ? '— repeating —' : '';
    }
    idx++;
    _morseTimeouts.set(moduleIndex, setTimeout(step, t.duration));
  }
  step();
}

// ── Simon Says Flash Handler ────────────────────────────────────
socket.on('simon-flash', ({ moduleIndex, sequence }) => {
  simonFlashing = true;
  let i = 0;
  const interval = setInterval(() => {
    if (i > 0) {
      const prevLight = document.querySelector(`.simon-light.simon-${sequence[i - 1]}[data-module="${moduleIndex}"]`);
      if (prevLight) prevLight.classList.remove('active');
    }
    if (i < sequence.length) {
      const light = document.querySelector(`.simon-light.simon-${sequence[i]}[data-module="${moduleIndex}"]`);
      if (light) { light.classList.add('active'); AudioFX.keypadBeep(); }
      i++;
    } else {
      clearInterval(interval);
      simonFlashing = false;
    }
  }, 600);
});

// Button strip color reveal
socket.on('button-strip', ({ moduleIndex, stripColor: sc }) => {
  stripColor = sc;
  if (isHoldingButton && buttonHoldModule === moduleIndex) { if (isSoloMode) renderSoloView(); else renderExecutorView(); }
});

// ══════════════════════ INSTRUCTOR VIEW ══════════════════════
let currentManualTab = 'index';

// SVG bomb illustration for the manual
const BOMB_SVG = `<svg viewBox="0 0 80 100" width="44" height="55" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="40" cy="62" r="28"/>
  <rect x="34" y="26" width="12" height="14" rx="2"/>
  <line x1="40" y1="16" x2="40" y2="26"/>
  <path d="M44 12 C48 6 56 8 52 2"/>
  <circle cx="52" cy="2" r="2.5" fill="currentColor"/>
  <line x1="28" y1="50" x2="22" y2="44" stroke-width="1.5"/>
  <line x1="52" y1="50" x2="58" y2="44" stroke-width="1.5"/>
  <line x1="40" y1="90" x2="40" y2="96" stroke-width="1.5"/>
</svg>`;

// Wire diagram SVG for wire chapters
const WIRE_SVG = `<svg viewBox="0 0 120 56" width="100" height="47" fill="none" stroke-width="3" stroke-linecap="round">
  <line x1="5" y1="5" x2="115" y2="5" stroke="#dc3545"/>
  <line x1="5" y1="13" x2="115" y2="13" stroke="#0d6efd"/>
  <line x1="5" y1="21" x2="115" y2="21" stroke="#ffc107"/>
  <line x1="5" y1="29" x2="115" y2="29" stroke="#198754"/>
  <line x1="5" y1="37" x2="115" y2="37" stroke="#f0883e"/>
  <line x1="5" y1="45" x2="115" y2="45" stroke="#bc8cff"/>
</svg>`;

function renderInstructorView() {
  const content = document.getElementById('game-content');
  document.getElementById('game-bomb-type').textContent = 'Manual';
  document.getElementById('game-module-count').textContent = '';
  if (roomCode) document.getElementById('game-room-code').textContent = 'Room: ' + roomCode;

  // Tab order: index, overview, procedures, sequence, module chapters (conditional), appendix
  const tabOrder = ['overview', 'procedures', 'sequence'];
  const moduleOrder = ['wires', 'button', 'keypad', 'simon', 'morse', 'memory', 'maze', 'password', 'knob'];
  moduleOrder.forEach(m => { if (manualData.chapters[m]) tabOrder.push(m); });
  tabOrder.push('appendix');
  const tabNames = ['index', ...tabOrder.filter(t => manualData.chapters[t])];

  let html = '<div class="manual-container">';
  // Book cover header
  html += '<div class="manual-cover-header">';
  html += `<div class="manual-emblem">${BOMB_SVG}</div>`;
  html += '<div class="manual-header-text">';
  html += '<span class="manual-classification">CLASSIFIED</span>';
  html += '<div class="manual-title-text">Bomb Disposal Manual</div>';
  html += '<div class="manual-subtitle-text">Field Reference Guide &mdash; Talk 2 Defuse Division</div>';
  html += '</div></div>';
  // Tabs
  const tabLabels = { index: 'Index', overview: 'Overview', procedures: 'Procedures', sequence: 'Sequence', wires: 'Wires', button: 'Button', keypad: 'Keypad', simon: 'Simon', morse: 'Morse', memory: 'Memory', maze: 'Maze', password: 'Password', knob: 'Knob', appendix: 'Appendix' };
  html += '<div class="manual-tabs">';
  tabNames.forEach(tab => {
    const label = tabLabels[tab] || cap(tab);
    html += `<button class="manual-tab${currentManualTab === tab ? ' active' : ''}" data-tab="${tab}">${label}</button>`;
  });
  html += '</div>';
  html += '<div class="manual-search"><input type="text" id="manual-search-input" placeholder="Search manual..." autocomplete="off"></div>';
  html += `<div class="manual-body" id="manual-body">${renderManualTab(currentManualTab)}</div>`;
  html += '</div>';
  content.innerHTML = html;

  // Book guide removed — unified guide triggered from topbar
  // Auto-show magnifier for instructor
  if (!magActive) toggleMagnifier();
  // Apply initial redactions and page damage
  applyRedactions();
  applyPageDamage();
  // Show annotation pen button (outside the book, fixed right side)
  showAnnoWrapper();
  setupAnnoCanvas();

  document.querySelectorAll('.manual-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const prevTab = currentManualTab;
      currentManualTab = tab.dataset.tab;
      document.querySelectorAll('.manual-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentManualTab));
      flipManualPage(currentManualTab, prevTab);
      AudioFX.click();
    });
  });

  document.getElementById('manual-search-input').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) { document.getElementById('manual-body').innerHTML = renderManualTab(currentManualTab); return; }
    let results = '';
    manualData.bombIndex.forEach(entry => {
      const text = `${entry.serial} ${entry.shape} ${entry.size} ${entry.protocol} ${entry.indicators} ${entry.ports} ${entry.modules.join(' ')}`.toLowerCase();
      if (text.includes(q)) {
        const protoClass = `protocol-cell protocol-cell-${entry.protocol.toLowerCase()}`;
        results += `<div class="search-result"><strong>${esc(entry.serial)}</strong> — ${cap(entry.size)} ${cap(entry.shape)} — <span class="${protoClass}">${entry.protocol}</span> — ${entry.indicators} — ${entry.batteries} batt — ${entry.ports}</div>`;
      }
    });
    Object.entries(manualData.chapters).forEach(([key, ch]) => {
      const searchText = JSON.stringify(ch).toLowerCase();
      if (searchText.includes(q)) {
        results += `<div class="search-result"><strong>${ch.title}</strong> — contains "${esc(q)}"</div>`;
      }
    });
    document.getElementById('manual-body').innerHTML = results || '<p style="color:var(--text-dim)">No results found.</p>';
  });
}

// ── Module Diagram SVGs ──
const MODULE_DIAGRAMS = {
  wires: {
    svg: `<svg viewBox="0 0 120 60" width="240" height="120" fill="none" stroke="#4a4030" stroke-width="0.8">
      <rect x="2" y="2" width="116" height="56" rx="3" stroke-dasharray="4 2"/>
      <text x="60" y="10" text-anchor="middle" fill="#6b5d44" font-size="4" font-family="monospace">JUNCTION BOX CROSS-SECTION</text>
      <rect x="6" y="14" width="10" height="32" rx="1" fill="none" stroke-width="1"/>
      <rect x="104" y="14" width="10" height="32" rx="1" fill="none" stroke-width="1"/>
      <text x="11" y="50" text-anchor="middle" fill="#6b5d44" font-size="3">TERM A</text>
      <text x="109" y="50" text-anchor="middle" fill="#6b5d44" font-size="3">TERM B</text>
      <line x1="16" y1="20" x2="104" y2="20" stroke="#dc3545" stroke-width="1.5"/>
      <line x1="16" y1="27" x2="50" y2="27" stroke="#0d6efd" stroke-width="1.5"/>
      <line x1="50" y1="27" x2="60" y2="30" stroke="#0d6efd" stroke-width="1.5"/>
      <line x1="60" y1="30" x2="70" y2="27" stroke="#0d6efd" stroke-width="1.5"/>
      <line x1="70" y1="27" x2="104" y2="27" stroke="#0d6efd" stroke-width="1.5"/>
      <line x1="16" y1="34" x2="104" y2="34" stroke="#ffc107" stroke-width="1.5"/>
      <line x1="16" y1="41" x2="104" y2="41" stroke="#198754" stroke-width="1.5"/>
      <circle cx="11" cy="20" r="1.5" fill="#dc3545"/><circle cx="109" cy="20" r="1.5" fill="#dc3545"/>
      <circle cx="11" cy="27" r="1.5" fill="#0d6efd"/><circle cx="109" cy="27" r="1.5" fill="#0d6efd"/>
      <circle cx="11" cy="34" r="1.5" fill="#ffc107"/><circle cx="109" cy="34" r="1.5" fill="#ffc107"/>
      <circle cx="11" cy="41" r="1.5" fill="#198754"/><circle cx="109" cy="41" r="1.5" fill="#198754"/>
    </svg>`,
    caption: 'FIG 1: Wire routing through junction box — terminal block cross-section',
  },
  button: {
    svg: `<svg viewBox="0 0 100 80" width="200" height="160" fill="none" stroke="#4a4030" stroke-width="0.8">
      <text x="50" y="8" text-anchor="middle" fill="#6b5d44" font-size="4" font-family="monospace">BUTTON MECHANISM CUTAWAY</text>
      <ellipse cx="50" cy="25" rx="28" ry="10" stroke-dasharray="3 2"/>
      <path d="M22 25 L22 45 Q22 55 50 55 Q78 55 78 45 L78 25" stroke-width="1"/>
      <ellipse cx="50" cy="25" rx="22" ry="7" fill="none" stroke-width="1.2"/>
      <text x="50" y="27" text-anchor="middle" fill="#6b5d44" font-size="3.5">DOME CAP</text>
      <line x1="50" y1="32" x2="50" y2="42" stroke-dasharray="2 1" stroke-width="0.6"/>
      <text x="50" y="40" text-anchor="middle" fill="#6b5d44" font-size="3">SPRING</text>
      <rect x="38" y="45" width="24" height="4" rx="1"/>
      <text x="50" y="48" text-anchor="middle" fill="#6b5d44" font-size="2.5">CONTACT PLATE</text>
      <rect x="18" y="56" width="64" height="6" rx="2" stroke-width="1"/>
      <text x="50" y="60" text-anchor="middle" fill="#6b5d44" font-size="3">STRIP LED HOUSING</text>
      <line x1="22" y1="59" x2="78" y2="59" stroke="#d29922" stroke-width="1" stroke-dasharray="3 2"/>
      <text x="50" y="70" text-anchor="middle" fill="#6b5d44" font-size="3">← COLORED INDICATOR STRIP →</text>
    </svg>`,
    caption: 'FIG 2: Button module cutaway — dome, spring, contact, LED strip',
  },
  keypad: {
    svg: `<svg viewBox="0 0 80 80" width="160" height="160" fill="none" stroke="#4a4030" stroke-width="0.8">
      <text x="40" y="8" text-anchor="middle" fill="#6b5d44" font-size="4" font-family="monospace">KEYPAD LAYOUT — TOP VIEW</text>
      <rect x="10" y="12" width="60" height="60" rx="4" stroke-width="1.2"/>
      <rect x="14" y="16" width="25" height="25" rx="3"/><text x="26.5" y="31" text-anchor="middle" fill="#6b5d44" font-size="5">POS 1</text>
      <rect x="41" y="16" width="25" height="25" rx="3"/><text x="53.5" y="31" text-anchor="middle" fill="#6b5d44" font-size="5">POS 2</text>
      <rect x="14" y="43" width="25" height="25" rx="3"/><text x="26.5" y="58" text-anchor="middle" fill="#6b5d44" font-size="5">POS 3</text>
      <rect x="41" y="43" width="25" height="25" rx="3"/><text x="53.5" y="58" text-anchor="middle" fill="#6b5d44" font-size="5">POS 4</text>
      <text x="40" y="78" text-anchor="middle" fill="#6b5d44" font-size="3">SYMBOL WINDOWS — 2×2 GRID</text>
    </svg>`,
    caption: 'FIG 3: Keypad module — 2×2 symbol window positions',
  },
  simon: {
    svg: `<svg viewBox="0 0 100 100" width="180" height="180" fill="none" stroke="#4a4030" stroke-width="0.8">
      <text x="50" y="8" text-anchor="middle" fill="#6b5d44" font-size="4" font-family="monospace">SIMON QUADRANT MAP</text>
      <circle cx="50" cy="54" r="38" stroke-width="1.2"/>
      <line x1="50" y1="16" x2="50" y2="92" stroke-width="0.6" stroke-dasharray="3 2"/>
      <line x1="12" y1="54" x2="88" y2="54" stroke-width="0.6" stroke-dasharray="3 2"/>
      <path d="M50 18 A36 36 0 0 0 14 54" stroke="#dc3545" stroke-width="2" fill="none"/>
      <text x="30" y="38" text-anchor="middle" fill="#dc3545" font-size="5" font-weight="bold">RED</text>
      <path d="M50 18 A36 36 0 0 1 86 54" stroke="#0d6efd" stroke-width="2" fill="none"/>
      <text x="70" y="38" text-anchor="middle" fill="#0d6efd" font-size="5" font-weight="bold">BLUE</text>
      <path d="M14 54 A36 36 0 0 0 50 90" stroke="#198754" stroke-width="2" fill="none"/>
      <text x="30" y="74" text-anchor="middle" fill="#198754" font-size="5" font-weight="bold">GREEN</text>
      <path d="M86 54 A36 36 0 0 1 50 90" stroke="#d29922" stroke-width="2" fill="none"/>
      <text x="70" y="74" text-anchor="middle" fill="#d29922" font-size="5" font-weight="bold">YELLOW</text>
      <text x="50" y="98" text-anchor="middle" fill="#6b5d44" font-size="3">INPUT QUADRANTS — PRESS MAPPED COLOR</text>
    </svg>`,
    caption: 'FIG 4: Simon Says — color quadrant positions and input direction',
  },
  morse: {
    svg: `<svg viewBox="0 0 200 50" width="360" height="90" fill="none" stroke="#4a4030" stroke-width="0.8">
      <text x="100" y="8" text-anchor="middle" fill="#6b5d44" font-size="4" font-family="monospace">MORSE TIMING DIAGRAM</text>
      <line x1="10" y1="30" x2="190" y2="30" stroke-width="0.5" stroke-dasharray="2 2"/>
      <rect x="10" y="16" width="8" height="14" rx="1" fill="#4a4030" opacity="0.6"/><text x="14" y="14" text-anchor="middle" fill="#6b5d44" font-size="3">DIT</text>
      <rect x="24" y="16" width="20" height="14" rx="1" fill="#4a4030" opacity="0.6"/><text x="34" y="14" text-anchor="middle" fill="#6b5d44" font-size="3">DAH</text>
      <rect x="50" y="16" width="8" height="14" rx="1" fill="#4a4030" opacity="0.6"/>
      <line x1="18" y1="37" x2="24" y2="37" stroke-width="0.5"/><text x="21" y="42" text-anchor="middle" fill="#6b5d44" font-size="2.5">GAP</text>
      <line x1="58" y1="37" x2="72" y2="37" stroke-width="0.5"/><text x="65" y="42" text-anchor="middle" fill="#6b5d44" font-size="2.5">LETTER GAP</text>
      <rect x="72" y="16" width="20" height="14" rx="1" fill="#4a4030" opacity="0.6"/>
      <rect x="98" y="16" width="8" height="14" rx="1" fill="#4a4030" opacity="0.6"/>
      <rect x="112" y="16" width="8" height="14" rx="1" fill="#4a4030" opacity="0.6"/>
      <line x1="120" y1="37" x2="148" y2="37" stroke-width="0.5"/><text x="134" y="42" text-anchor="middle" fill="#6b5d44" font-size="2.5">WORD GAP</text>
      <rect x="148" y="16" width="8" height="14" rx="1" fill="#4a4030" opacity="0.6"/>
      <text x="100" y="48" text-anchor="middle" fill="#6b5d44" font-size="3">PULSE TIMELINE — SHORT=DIT, LONG=DAH</text>
    </svg>`,
    caption: 'FIG 5: Morse code timing — dit/dah pulses with inter-element and letter gaps',
  },
};

// ── Overview Blueprint SVG ──
const BLUEPRINT_SVG = `<svg viewBox="0 0 300 400" width="300" height="400" fill="none" stroke="#4a4030" stroke-width="0.8" font-family="monospace" font-size="5">
  <!-- Casing outline -->
  <rect x="80" y="40" width="140" height="280" rx="20" stroke-width="1.5" stroke-dasharray="6 3"/>
  <text x="150" y="35" text-anchor="middle" fill="#5c1010" font-size="6" font-weight="bold">DEVICE SCHEMATIC — EXPLODED VIEW</text>

  <!-- Detonator core -->
  <circle cx="150" cy="90" r="22" stroke-width="1" stroke-dasharray="4 2"/>
  <circle cx="150" cy="90" r="10" stroke-width="0.6"/>
  <text x="150" y="92" text-anchor="middle" fill="#6b5d44" font-size="4">CORE</text>
  <line x1="172" y1="90" x2="230" y2="90" stroke-width="0.5"/>
  <circle cx="230" cy="90" r="6" stroke-width="0.5" fill="#f4edd8"/>
  <text x="230" y="91.5" text-anchor="middle" fill="#5c1010" font-size="4.5" font-weight="bold">1</text>
  <text x="240" y="91" fill="#4a4030" font-size="4">Detonator Core</text>

  <!-- Timer mechanism -->
  <rect x="120" y="120" width="60" height="25" rx="3" stroke-dasharray="4 2"/>
  <text x="150" y="135" text-anchor="middle" fill="#6b5d44" font-size="4">TIMER</text>
  <line x1="180" y1="132" x2="230" y2="120" stroke-width="0.5"/>
  <circle cx="230" cy="120" r="6" stroke-width="0.5" fill="#f4edd8"/>
  <text x="230" y="121.5" text-anchor="middle" fill="#5c1010" font-size="4.5" font-weight="bold">2</text>
  <text x="240" y="121" fill="#4a4030" font-size="4">Timer Mechanism</text>

  <!-- Module bays -->
  <rect x="95" y="155" width="50" height="40" rx="3"/><text x="120" y="178" text-anchor="middle" fill="#6b5d44" font-size="3.5">MOD A</text>
  <rect x="155" y="155" width="50" height="40" rx="3"/><text x="180" y="178" text-anchor="middle" fill="#6b5d44" font-size="3.5">MOD B</text>
  <rect x="95" y="200" width="50" height="40" rx="3"/><text x="120" y="223" text-anchor="middle" fill="#6b5d44" font-size="3.5">MOD C</text>
  <rect x="155" y="200" width="50" height="40" rx="3"/><text x="180" y="223" text-anchor="middle" fill="#6b5d44" font-size="3.5">MOD D</text>
  <line x1="205" y1="175" x2="230" y2="160" stroke-width="0.5"/>
  <circle cx="230" cy="160" r="6" stroke-width="0.5" fill="#f4edd8"/>
  <text x="230" y="161.5" text-anchor="middle" fill="#5c1010" font-size="4.5" font-weight="bold">3</text>
  <text x="240" y="161" fill="#4a4030" font-size="4">Module Bays</text>

  <!-- Battery compartment -->
  <rect x="100" y="250" width="100" height="20" rx="4" stroke-dasharray="4 2"/>
  <rect x="108" y="254" width="18" height="12" rx="1" fill="none" stroke="#d29922" stroke-width="0.8"/>
  <rect x="133" y="254" width="18" height="12" rx="1" fill="none" stroke="#d29922" stroke-width="0.8"/>
  <rect x="158" y="254" width="18" height="12" rx="1" fill="none" stroke="#d29922" stroke-width="0.8"/>
  <line x1="80" y1="260" x2="50" y2="260" stroke-width="0.5"/>
  <circle cx="50" cy="260" r="6" stroke-width="0.5" fill="#f4edd8"/>
  <text x="50" y="261.5" text-anchor="middle" fill="#5c1010" font-size="4.5" font-weight="bold">4</text>
  <text x="15" y="261" fill="#4a4030" font-size="4">Battery Compartment</text>

  <!-- Indicator panel -->
  <rect x="105" y="278" width="90" height="14" rx="2"/>
  <circle cx="120" cy="285" r="3" fill="none" stroke="#3fb950" stroke-width="0.6"/>
  <circle cx="135" cy="285" r="3" fill="none" stroke="#3fb950" stroke-width="0.6"/>
  <circle cx="150" cy="285" r="3" fill="none" stroke="#6e7681" stroke-width="0.6"/>
  <circle cx="165" cy="285" r="3" fill="none" stroke="#3fb950" stroke-width="0.6"/>
  <circle cx="180" cy="285" r="3" fill="none" stroke="#6e7681" stroke-width="0.6"/>
  <line x1="80" y1="285" x2="50" y2="290" stroke-width="0.5"/>
  <circle cx="50" cy="290" r="6" stroke-width="0.5" fill="#f4edd8"/>
  <text x="50" y="291.5" text-anchor="middle" fill="#5c1010" font-size="4.5" font-weight="bold">5</text>
  <text x="15" y="291" fill="#4a4030" font-size="4">Indicator Panel</text>

  <!-- Port array -->
  <rect x="110" y="300" width="80" height="14" rx="2" stroke-dasharray="3 2"/>
  <rect x="115" y="303" width="12" height="8" rx="1" fill="none" stroke-width="0.5"/>
  <rect x="132" y="303" width="12" height="8" rx="1" fill="none" stroke-width="0.5"/>
  <rect x="149" y="303" width="12" height="8" rx="1" fill="none" stroke-width="0.5"/>
  <rect x="166" y="303" width="12" height="8" rx="1" fill="none" stroke-width="0.5"/>
  <line x1="205" y1="307" x2="230" y2="320" stroke-width="0.5"/>
  <circle cx="230" cy="320" r="6" stroke-width="0.5" fill="#f4edd8"/>
  <text x="230" y="321.5" text-anchor="middle" fill="#5c1010" font-size="4.5" font-weight="bold">6</text>
  <text x="240" y="321" fill="#4a4030" font-size="4">Port Array</text>

  <!-- Legend box -->
  <rect x="30" y="345" width="240" height="48" rx="3" stroke-dasharray="4 2"/>
  <text x="40" y="356" fill="#5c1010" font-size="4" font-weight="bold">COMPONENT INDEX:</text>
  <text x="40" y="364" fill="#4a4030" font-size="3.5">1 Detonator Core — primary charge initiator</text>
  <text x="40" y="371" fill="#4a4030" font-size="3.5">2 Timer Mechanism — countdown controller</text>
  <text x="40" y="378" fill="#4a4030" font-size="3.5">3 Module Bays — defusal interface ports</text>
  <text x="160" y="364" fill="#4a4030" font-size="3.5">4 Battery Compartment — power cells</text>
  <text x="160" y="371" fill="#4a4030" font-size="3.5">5 Indicator Panel — status LEDs</text>
  <text x="160" y="378" fill="#4a4030" font-size="3.5">6 Port Array — data connectors</text>
</svg>`;

// ── Port ID SVGs for Appendix ──
const PORT_SVGS = {
  'DVI-D': `<svg viewBox="0 0 40 20" width="40" height="20" fill="none" stroke="#4a4030" stroke-width="0.8"><rect x="2" y="2" width="36" height="16" rx="2"/><line x1="8" y1="6" x2="8" y2="14" stroke-width="2"/><circle cx="15" cy="7" r="1"/><circle cx="20" cy="7" r="1"/><circle cx="25" cy="7" r="1"/><circle cx="30" cy="7" r="1"/><circle cx="15" cy="13" r="1"/><circle cx="20" cy="13" r="1"/><circle cx="25" cy="13" r="1"/><circle cx="30" cy="13" r="1"/></svg>`,
  'Parallel': `<svg viewBox="0 0 40 20" width="40" height="20" fill="none" stroke="#4a4030" stroke-width="0.8"><path d="M4 3 L36 3 L38 10 L36 17 L4 17 L2 10 Z"/><line x1="8" y1="7" x2="32" y2="7" stroke-width="0.5"/><line x1="8" y1="13" x2="32" y2="13" stroke-width="0.5"/></svg>`,
  'PS/2': `<svg viewBox="0 0 40 20" width="40" height="20" fill="none" stroke="#4a4030" stroke-width="0.8"><circle cx="20" cy="10" r="8"/><circle cx="16" cy="7" r="1"/><circle cx="24" cy="7" r="1"/><circle cx="14" cy="12" r="1"/><circle cx="20" cy="12" r="1"/><circle cx="26" cy="12" r="1"/></svg>`,
  'RJ-45': `<svg viewBox="0 0 40 20" width="40" height="20" fill="none" stroke="#4a4030" stroke-width="0.8"><rect x="6" y="2" width="28" height="16" rx="1"/><rect x="10" y="5" width="20" height="6" rx="1" stroke-dasharray="2 1"/><line x1="14" y1="14" x2="14" y2="17" stroke-width="0.5"/><line x1="20" y1="14" x2="20" y2="17" stroke-width="0.5"/><line x1="26" y1="14" x2="26" y2="17" stroke-width="0.5"/></svg>`,
  'Serial': `<svg viewBox="0 0 40 20" width="40" height="20" fill="none" stroke="#4a4030" stroke-width="0.8"><path d="M4 3 L36 3 L38 10 L36 17 L4 17 L2 10 Z"/><circle cx="12" cy="7" r="1"/><circle cx="20" cy="7" r="1"/><circle cx="28" cy="7" r="1"/><circle cx="16" cy="13" r="1"/><circle cx="24" cy="13" r="1"/></svg>`,
  'RCA': `<svg viewBox="0 0 40 20" width="40" height="20" fill="none" stroke="#4a4030" stroke-width="0.8"><circle cx="20" cy="10" r="8"/><circle cx="20" cy="10" r="3"/><circle cx="20" cy="10" r="1" fill="#4a4030"/></svg>`,
};

function renderManualTab(tab) {
  // Find page number
  const allTabs = ['index'];
  const tabOrder2 = ['overview', 'procedures', 'sequence'];
  const moduleOrder2 = ['wires', 'button', 'keypad', 'simon', 'morse', 'memory', 'maze', 'password', 'knob'];
  moduleOrder2.forEach(m => { if (manualData.chapters[m]) tabOrder2.push(m); });
  tabOrder2.push('appendix');
  tabOrder2.forEach(t => { if (manualData.chapters[t]) allTabs.push(t); });
  const pageNum = allTabs.indexOf(tab) + 1;

  if (tab === 'index') {
    let html = `<div class="page-header"><div class="page-header-icon">${BOMB_SVG}</div><div><div class="page-header-title">Bomb Type Index</div><div class="page-header-sub">Cross-reference with partner description to identify device</div></div></div>`;
    html += '<p class="index-desc">Ask your partner for: shape, size, serial number, indicators (which are LIT — marked with *), battery count, and port types. Match to identify the bomb. The <strong>PROTOCOL</strong> determines which defusal rules to follow!</p>';
    html += '<table class="bomb-index-table"><thead><tr><th>Serial</th><th>Protocol</th><th>Shape</th><th>Size</th><th>Indicators</th><th>Batt</th><th>Ports</th><th>Modules</th></tr></thead><tbody>';
    manualData.bombIndex.forEach(entry => {
      const protoClass = `protocol-cell protocol-cell-${entry.protocol.toLowerCase()}`;
      const r = entry.redacted || [];
      const rc = (field, val) => r.includes(field) ? '<span class="redacted-perm">██████</span>' : val;
      html += `<tr><td><strong>${esc(entry.serial)}</strong></td><td><span class="${protoClass}">${entry.protocol}</span></td><td>${rc('shape', cap(entry.shape))}</td><td>${rc('size', cap(entry.size))}</td><td class="small-text">${rc('indicators', esc(entry.indicators))}</td><td>${rc('batteries', entry.batteries)}</td><td class="small-text">${rc('ports', esc(entry.ports))}</td><td class="small-text">${entry.modules.map(cap).join(', ')}</td></tr>`;
    });
    html += '</tbody></table>';
    html += `<div class="page-number">PG ${pageNum}</div>`;
    return html;
  }

  const ch = manualData.chapters[tab];
  if (!ch) return '<p>Chapter not found.</p>';

  // Page header with appropriate icon
  const pageIcons = {
    overview: BOMB_SVG,
    procedures: `<svg viewBox="0 0 50 50" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="4" width="34" height="42" rx="3"/><line x1="14" y1="14" x2="36" y2="14"/><line x1="14" y1="22" x2="36" y2="22"/><line x1="14" y1="30" x2="28" y2="30"/><rect x="12" y="10" width="4" height="4" rx="0.5"/><rect x="12" y="18" width="4" height="4" rx="0.5"/><rect x="12" y="26" width="4" height="4" rx="0.5"/></svg>`,
    sequence: `<svg viewBox="0 0 50 50" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/><text x="12" y="15" text-anchor="middle" font-size="8" fill="currentColor" stroke="none" font-weight="900">1</text><circle cx="38" cy="12" r="6"/><text x="38" y="15" text-anchor="middle" font-size="8" fill="currentColor" stroke="none" font-weight="900">2</text><circle cx="12" cy="38" r="6"/><text x="12" y="41" text-anchor="middle" font-size="8" fill="currentColor" stroke="none" font-weight="900">3</text><path d="M18 12 L32 12" stroke-dasharray="3 2"/><path d="M38 18 L12 32" stroke-dasharray="3 2"/></svg>`,
    wires: WIRE_SVG,
    button: `<svg viewBox="0 0 50 50" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="25" cy="25" r="20"/><circle cx="25" cy="25" r="8" fill="currentColor" opacity="0.3"/></svg>`,
    keypad: `<svg viewBox="0 0 50 50" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="5" width="17" height="17" rx="3"/><rect x="28" y="5" width="17" height="17" rx="3"/><rect x="5" y="28" width="17" height="17" rx="3"/><rect x="28" y="28" width="17" height="17" rx="3"/></svg>`,
    simon: `<svg viewBox="0 0 50 50" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="20" height="20" rx="4" fill="rgba(220,53,69,0.3)"/><rect x="27" y="3" width="20" height="20" rx="4" fill="rgba(13,110,253,0.3)"/><rect x="3" y="27" width="20" height="20" rx="4" fill="rgba(25,135,84,0.3)"/><rect x="27" y="27" width="20" height="20" rx="4" fill="rgba(255,193,7,0.3)"/></svg>`,
    morse: `<svg viewBox="0 0 60 30" width="50" height="25" fill="currentColor" opacity="0.6"><circle cx="6" cy="15" r="4"/><rect x="16" y="11" width="14" height="8" rx="4"/><circle cx="38" cy="15" r="4"/><circle cx="50" cy="15" r="4"/></svg>`,
    memory: `<svg viewBox="0 0 50 50" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2"><rect x="10" y="3" width="30" height="16" rx="3"/><text x="25" y="14" text-anchor="middle" font-size="10" fill="currentColor" stroke="none" font-weight="bold">3</text><rect x="3" y="28" width="10" height="16" rx="2"/><rect x="16" y="28" width="10" height="16" rx="2"/><rect x="29" y="28" width="10" height="16" rx="2"/><rect x="42" y="28" width="6" height="16" rx="2"/></svg>`,
    maze: `<svg viewBox="0 0 50 50" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="42" height="42"/><line x1="4" y1="11" x2="18" y2="11"/><line x1="25" y1="4" x2="25" y2="18"/><line x1="32" y1="11" x2="46" y2="11"/><line x1="11" y1="18" x2="25" y2="18"/><line x1="32" y1="25" x2="46" y2="25"/><line x1="4" y1="32" x2="18" y2="32"/><line x1="25" y1="32" x2="25" y2="46"/><circle cx="10" cy="25" r="3" fill="currentColor"/><circle cx="40" cy="39" r="2" fill="rgba(220,53,69,0.6)"/></svg>`,
    password: `<svg viewBox="0 0 50 50" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="10" width="8" height="30" rx="2"/><rect x="14" y="10" width="8" height="30" rx="2"/><rect x="25" y="10" width="8" height="30" rx="2"/><rect x="36" y="10" width="8" height="30" rx="2"/><text x="7" y="28" text-anchor="middle" font-size="8" fill="currentColor" stroke="none">A</text><text x="18" y="28" text-anchor="middle" font-size="8" fill="currentColor" stroke="none">B</text><text x="29" y="28" text-anchor="middle" font-size="8" fill="currentColor" stroke="none">C</text><text x="40" y="28" text-anchor="middle" font-size="8" fill="currentColor" stroke="none">D</text></svg>`,
    knob: `<svg viewBox="0 0 50 50" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2"><circle cx="25" cy="28" r="14"/><line x1="25" y1="14" x2="25" y2="20" stroke-width="3" stroke-linecap="round"/><circle cx="25" cy="28" r="3" fill="currentColor"/><circle cx="10" cy="8" r="2" fill="currentColor" opacity="0.5"/><circle cx="18" cy="8" r="2" fill="currentColor"/><circle cx="26" cy="8" r="2" fill="currentColor" opacity="0.5"/><circle cx="34" cy="8" r="2" fill="currentColor"/><circle cx="42" cy="8" r="2" fill="currentColor" opacity="0.5"/></svg>`,
    appendix: `<svg viewBox="0 0 50 50" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="38" height="42" rx="3"/><line x1="12" y1="12" x2="38" y2="12"/><line x1="12" y1="20" x2="38" y2="20"/><line x1="12" y1="28" x2="38" y2="28"/><line x1="12" y1="36" x2="28" y2="36"/></svg>`,
  };
  const pageSubs = {
    overview: 'Device Schematic Reference',
    procedures: 'Standard Operating Procedures',
    sequence: 'Required Defusal Sequence',
    memory: 'Multi-Stage Recall Protocol',
    maze: 'Navigation Grid Reference',
    password: 'Word Identification Protocol',
    knob: 'LED Pattern Dial Reference',
    appendix: 'Quick Reference Tables',
  };
  const icon = pageIcons[tab] || BOMB_SVG;
  const subText = pageSubs[tab] || 'Defusal Protocol Reference';
  let html = `<div class="page-header"><div class="page-header-icon">${icon}</div><div><div class="page-header-title">${ch.title}</div><div class="page-header-sub">${subText}</div></div></div>`;

  // Coffee stain (random position, always rendered but subtle)
  const coffeeLeft = 50 + Math.floor((tab.charCodeAt(0) * 7) % 40);
  const coffeeTop = 30 + Math.floor((tab.charCodeAt(1 % tab.length) * 11) % 50);
  html += `<div class="coffee-stain" style="left:${coffeeLeft}%;top:${coffeeTop}%"></div>`;

  // Chapter stamp if this chapter has one
  if (manualData.pageStamps) {
    const stamp = manualData.pageStamps.find(s => s.chapter === tab);
    if (stamp) html += `<div class="chapter-stamp">${stamp.text}</div>`;
  }

  // Margin notes for this chapter
  if (manualData.marginNotes) {
    manualData.marginNotes.filter(n => n.chapter === tab).forEach(n => {
      html += `<div class="margin-note" style="transform:rotate(${n.rotation}deg)">${n.text}</div>`;
    });
  }

  if (ch.description) html += `<p class="chapter-desc">${ch.description}</p>`;

  // ── Overview chapter ──
  if (tab === 'overview') {
    html += `<div class="manual-blueprint">${BLUEPRINT_SVG}</div>`;
    if (ch.lore) html += `<p class="overview-lore">${ch.lore}</p>`;
    html += `<div class="page-number">PG ${pageNum}</div>`;
    return html;
  }

  // ── Procedures chapter ──
  if (tab === 'procedures' && ch.sections) {
    ch.sections.forEach(sec => {
      html += `<h3 class="section-subtitle">${sec.subtitle}</h3>`;
      if (sec.natoRef) {
        html += '<div class="nato-quick-ref">';
        ['A-Alpha','B-Bravo','C-Charlie','D-Delta','E-Echo','F-Foxtrot','N-November','O-Oscar','S-Sierra'].forEach(pair => {
          html += `<span class="nato-pair">${pair}</span>`;
        });
        html += '</div>';
      }
      if (sec.strikeTable) {
        html += '<table class="strike-ref-table"><thead><tr><th>Strike</th><th>Speed</th><th>Time Skip</th><th>Effect</th></tr></thead><tbody>';
        html += '<tr><td>1st</td><td>1.5x</td><td>-15s</td><td>Timer accelerates</td></tr>';
        html += '<tr><td>2nd</td><td>2.0x</td><td>-25s</td><td>Timer critical speed</td></tr>';
        html += '<tr><td>3rd</td><td>—</td><td>—</td><td class="strike-fatal">DETONATION</td></tr>';
        html += '</tbody></table>';
      }
      html += '<ol class="procedure-checklist">';
      sec.items.forEach(item => html += `<li>${item}</li>`);
      html += '</ol>';
    });
    html += `<div class="page-number">PG ${pageNum}</div>`;
    return html;
  }

  // ── Sequence chapter ──
  if (tab === 'sequence' && ch.table) {
    html += '<table class="bomb-index-table"><thead><tr>';
    ch.table.headers.forEach(h => html += `<th>${h}</th>`);
    html += '</tr></thead><tbody>';
    ch.table.rows.forEach(row => {
      html += '<tr>';
      row.forEach(cell => html += `<td>${cell}</td>`);
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += `<div class="page-number">PG ${pageNum}</div>`;
    return html;
  }

  // ── Module diagram (for wires/button/keypad/simon/morse) ──
  const diagram = MODULE_DIAGRAMS[tab];
  if (diagram) {
    html += `<div class="manual-diagram">${diagram.svg}<div class="diagram-caption">${diagram.caption}</div></div>`;
  }

  // Wire color legend for wire chapter
  if (tab === 'wires') {
    html += '<div class="wire-legend">';
    [['Red','#dc3545'],['Blue','#0d6efd'],['Yellow','#ffc107'],['Green','#198754'],['White','#e8e8e8'],['Black','#333'],['Orange','#f0883e'],['Purple','#bc8cff']].forEach(([name, color]) => {
      html += `<span class="wire-swatch"><span class="wire-swatch-color" style="background:${color}"></span>${name}</span>`;
    });
    html += '</div>';
  }

  // ── Protocol-dependent chapters (wires, button) ──
  if (ch.protocols) {
    const protoClassMap = { Alpha: 'proto-alpha', Bravo: 'proto-bravo', Charlie: 'proto-charlie' };
    const protoStampMap = { Alpha: 'STANDARD', Bravo: 'PRIORITY', Charlie: 'CRITICAL' };
    Object.entries(ch.protocols).forEach(([protoName, protoData]) => {
      const pc = protoClassMap[protoName] || '';
      html += `<div class="protocol-section ${pc}">`;
      html += `<h3 class="protocol-header">Protocol ${protoName} <span class="protocol-stamp">${protoStampMap[protoName] || ''}</span></h3>`;

      // Wire-style: sections with subtitle + rules
      if (protoData.sections) {
        protoData.sections.forEach(sec => {
          html += `<h4 class="section-subtitle">${sec.subtitle}</h4>`;
          html += '<ol class="rule-list">';
          sec.rules.forEach(r => html += `<li>${r}</li>`);
          html += '</ol>';
        });
      }

      // Button-style: flat rules list
      if (protoData.rules) {
        html += '<ol class="rule-list">';
        protoData.rules.forEach(r => html += `<li>${r}</li>`);
        html += '</ol>';
      }

      // Memory-style: stages with rules
      if (protoData.stages) {
        protoData.stages.forEach(stage => {
          html += `<h4 class="section-subtitle">${stage.title}</h4>`;
          html += '<ol class="rule-list">';
          stage.rules.forEach(r => html += `<li>${r}</li>`);
          html += '</ol>';
        });
      }

      // Knob-style: LED pattern table
      if (protoData.patterns) {
        html += '<div class="knob-pattern-table">';
        protoData.patterns.forEach(p => {
          html += '<div class="knob-pattern-row">';
          html += '<div class="knob-pattern-leds">';
          for (let i = 0; i < 12; i++) {
            if (i === 6) html += '</div><div class="knob-pattern-leds">';
            html += `<span class="knob-manual-led${p.leds[i] ? ' on' : ''}"></span>`;
          }
          html += '</div>';
          html += `<span class="knob-pattern-position">\u2192 ${p.position}</span>`;
          html += '</div>';
        });
        html += '</div>';
      }

      html += '</div>';
    });

    // Hold rules (shared across protocols)
    if (ch.holdRules) {
      html += '<div class="hold-rules-section"><h3 class="section-subtitle">If Holding (All Protocols):</h3>';
      ch.holdRules.forEach(r => html += `<p class="hold-rule">${r}</p>`);
      html += '</div>';
    }
  }

  // ── Non-protocol chapters ──

  // Wire sections (legacy fallback)
  if (ch.sections && !ch.protocols && tab !== 'procedures') {
    ch.sections.forEach(sec => {
      html += `<h3 class="section-subtitle">${sec.subtitle}</h3>`;
      html += '<ol class="rule-list">';
      sec.rules.forEach(r => html += `<li>${r}</li>`);
      html += '</ol>';
    });
  }

  // Button rules (legacy fallback)
  if (ch.rules && !ch.protocols) {
    html += '<ol class="rule-list">';
    ch.rules.forEach(r => html += `<li>${r}</li>`);
    html += '</ol>';
  }
  if (ch.holdRules && !ch.protocols) {
    html += '<div class="hold-rules-section"><h3 class="section-subtitle">If Holding:</h3>';
    ch.holdRules.forEach(r => html += `<p class="hold-rule">${r}</p>`);
    html += '</div>';
  }

  // Keypad columns
  if (ch.columns) {
    html += '<div class="keypad-columns-grid">';
    ch.columns.forEach((col, i) => {
      html += `<div class="keypad-column"><div class="keypad-column-header">Col ${i + 1}</div><div class="keypad-column-symbols">`;
      col.forEach(sym => html += `<span>${sym}</span>`);
      html += '</div></div>';
    });
    html += '</div>';
  }

  // Simon Says tables
  if (ch.tables) {
    Object.entries(ch.tables).forEach(([key, table]) => {
      html += `<h3 class="section-subtitle">${table.label}</h3>`;
      html += '<table class="simon-table"><thead><tr><th>Strikes</th><th>Red →</th><th>Blue →</th><th>Green →</th><th>Yellow →</th></tr></thead><tbody>';
      ['0 strikes', '1 strike', '2 strikes'].forEach(sk => {
        const row = table[sk];
        if (row) html += `<tr><td>${sk}</td><td>${row.red}</td><td>${row.blue}</td><td>${row.green}</td><td>${row.yellow}</td></tr>`;
      });
      html += '</tbody></table>';
    });
  }

  // Morse code dictionary — 4-column grid table with visual dots/dashes
  if (ch.morseAlphabet && ch.frequencyTable) {
    function morseVis(code) {
      let v = '';
      for (const c of code) {
        if (c === '·') v += '<span class="mc_dit"></span>';
        else if (c === '—') v += '<span class="mc_dah"></span>';
      }
      return v;
    }
    html += '<h3 class="section-subtitle">Morse Code → Frequency Lookup</h3>';
    html += '<div class="morse-dict-grid">';
    const half = Math.ceil(ch.frequencyTable.length / 2);
    const col1 = ch.frequencyTable.slice(0, half);
    const col2 = ch.frequencyTable.slice(half);
    html += '<table class="morse-dict-table"><tbody>';
    for (let i = 0; i < half; i++) {
      const e1 = col1[i];
      const l1 = e1.word[0];
      const m1 = ch.morseAlphabet[l1] || '';
      html += `<tr><td class="mc_letter">${l1}</td><td class="mc_visual">${morseVis(m1)}</td><td class="mc_code">${m1}</td><td class="mc_freq">${e1.freq}</td>`;
      if (col2[i]) {
        const e2 = col2[i];
        const l2 = e2.word[0];
        const m2 = ch.morseAlphabet[l2] || '';
        html += `<td class="mc_sep"></td><td class="mc_letter">${l2}</td><td class="mc_visual">${morseVis(m2)}</td><td class="mc_code">${m2}</td><td class="mc_freq">${e2.freq}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
  }

  // ── Password word list (grouped by first letter) ──
  if (ch.wordList) {
    html += '<h3 class="section-subtitle">Valid Words</h3>';
    const groups = {};
    ch.wordList.forEach(w => {
      const letter = w[0];
      if (!groups[letter]) groups[letter] = [];
      groups[letter].push(w);
    });
    html += '<div class="password-word-groups">';
    Object.keys(groups).sort().forEach(letter => {
      html += `<div class="pw-group"><span class="pw-letter">${letter}</span><span class="pw-words">${groups[letter].join(', ')}</span></div>`;
    });
    html += '</div>';
  }

  // ── Memory stages (protocol-dependent, rendered via ch.protocols[].stages) ──
  if (ch.protocols && tab === 'memory') {
    // Already handled by the protocol renderer above via protoData.stages
    // Add extra rendering for stage rules here
    const protoClassMap = { Alpha: 'proto-alpha', Bravo: 'proto-bravo', Charlie: 'proto-charlie' };
    const protoStampMap = { Alpha: 'STANDARD', Bravo: 'PRIORITY', Charlie: 'CRITICAL' };
    // Clear previously rendered protocol sections (memory uses stages not sections/rules)
    // Re-render with stage-specific layout
  }

  // ── Maze diagrams ──
  if (ch.mazes) {
    html += '<h3 class="section-subtitle">Maze Layouts</h3>';
    html += '<div class="maze-manual-grid">';
    ch.mazes.forEach((maze, idx) => {
      html += `<div class="maze-manual-item"><div class="maze-manual-label">Maze ${idx + 1} — Markers: (${maze.markers[0].row + 1},${maze.markers[0].col + 1}) and (${maze.markers[1].row + 1},${maze.markers[1].col + 1})</div>`;
      html += '<div class="maze-manual-diagram">';
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 6; c++) {
          let cls = 'maze-manual-cell';
          // Check walls: right and down
          const hasWallRight = maze.walls.some(w => w[0] === r && w[1] === c && w[2] === 'r');
          const hasWallDown = maze.walls.some(w => w[0] === r && w[1] === c && w[2] === 'd');
          if (hasWallRight) cls += ' wall-right';
          if (hasWallDown) cls += ' wall-down';
          let content = '';
          if (maze.markers.some(m => m.row === r && m.col === c)) { cls += ' marker'; content = '\u25C9'; }
          html += `<div class="${cls}">${content}</div>`;
        }
      }
      html += '</div></div>';
    });
    html += '</div>';
  }

  // ── Knob LED patterns (rendered via protocol system above) ──
  // Additional knob-specific rendering for LED pattern tables
  if (tab === 'knob' && ch.protocols) {
    // The protocol renderer above handles this via protoData.patterns
    // We need to render LED pattern tables specifically
  }

  // ── Appendix ──
  if (tab === 'appendix') {
    // NATO Phonetic Alphabet
    if (ch.nato) {
      html += '<h3 class="section-subtitle">NATO Phonetic Alphabet</h3>';
      html += '<table class="nato-table"><thead><tr><th>Letter</th><th>Word</th><th>Letter</th><th>Word</th></tr></thead><tbody>';
      for (let i = 0; i < ch.nato.length; i += 2) {
        const a = ch.nato[i];
        const b = ch.nato[i + 1];
        html += `<tr><td><strong>${a[0]}</strong></td><td>${a[1]}</td>`;
        if (b) html += `<td><strong>${b[0]}</strong></td><td>${b[1]}</td>`;
        else html += '<td></td><td></td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    }

    // Indicator Codes
    if (ch.indicatorCodes) {
      html += '<h3 class="section-subtitle">Indicator Codes</h3>';
      html += '<table class="bomb-index-table"><thead><tr><th>Code</th><th>Meaning</th></tr></thead><tbody>';
      ch.indicatorCodes.forEach(ic => {
        html += `<tr><td><strong>${ic.label}</strong></td><td>${ic.meaning}</td></tr>`;
      });
      html += '</tbody></table>';
    }

    // Port ID Guide
    if (ch.portDescriptions) {
      html += '<h3 class="section-subtitle">Port Identification Guide</h3>';
      html += '<div class="port-guide">';
      ch.portDescriptions.forEach(p => {
        const svg = PORT_SVGS[p.type] || '';
        html += `<div class="port-guide-row">${svg}<div class="port-guide-info"><strong>${p.type}</strong><span>${p.desc}</span></div></div>`;
      });
      html += '</div>';
    }

    // Strike Effects
    html += '<h3 class="section-subtitle">Strike Effects Reference</h3>';
    html += '<table class="strike-ref-table"><thead><tr><th>Strike</th><th>Speed</th><th>Time Skip</th><th>Effect</th></tr></thead><tbody>';
    html += '<tr><td>1st</td><td>1.5x</td><td>-15s</td><td>Timer accelerates</td></tr>';
    html += '<tr><td>2nd</td><td>2.0x</td><td>-25s</td><td>Timer critical speed</td></tr>';
    html += '<tr><td>3rd</td><td>—</td><td>—</td><td class="strike-fatal">DETONATION</td></tr>';
    html += '</tbody></table>';
  }

  if (ch.note) html += `<div class="rule-note">${ch.note}</div>`;
  html += `<div class="page-number">PG ${pageNum}</div>`;
  return html;
}

// ══════════════════════ GAME UPDATES ══════════════════════
socket.on('game-update', (data) => {
  if (data.timerSpeed) timerSpeed = data.timerSpeed;
  if (data.bomb) {
    // Save scroll positions before re-render
    const scrollSelectors = ['#game-content', '.game-main', '#manual-body', '.solo-bomb-section', '.solo-manual-section', '.solo-module-grid'];
    const savedScrolls = [];
    scrollSelectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (el && el.scrollTop > 0) savedScrolls.push({ sel, top: el.scrollTop });
    });
    // Also save window scroll
    const winScroll = window.scrollY;

    bombState = data.bomb;
    if (isSoloMode) renderSoloView(); else renderExecutorView();

    // Restore scroll positions
    requestAnimationFrame(() => {
      savedScrolls.forEach(({ sel, top }) => {
        const el = document.querySelector(sel);
        if (el) el.scrollTop = top;
      });
      if (winScroll > 0) window.scrollTo(0, winScroll);
    });
  }
  if (data.event === 'sequence-warning') {
    AudioFX.strike();
    flashLighting('yellow', 1200);
    addSystemMessage('⚠ WRONG SEQUENCE — free pass this time! Check the Sequence tab for the correct order.');
    // Big centered warning overlay
    const warn = document.createElement('div');
    warn.className = 'sequence-warning-overlay';
    warn.innerHTML = `
      <div class="seq-warn-icon">⚠</div>
      <div class="seq-warn-title">WRONG ORDER!</div>
      <div class="seq-warn-text">You solved a module out of sequence.<br>Check the <strong>Sequence</strong> tab in the manual for the correct order.</div>
      <div class="seq-warn-pass">FREE PASS — next time it's a strike!</div>
    `;
    document.body.appendChild(warn);
    setTimeout(() => warn.classList.add('seq-warn-fade'), 4000);
    setTimeout(() => warn.remove(), 5000);
  }
  if (data.event === 'module-solved') {
    AudioFX.success();
    showToast(`${cap(data.moduleType)} module defused!`);
    addSystemMessage(`Module solved: ${cap(data.moduleType)}`);
    flashLighting('green', 500);
    // Find which module was solved and trigger effects
    if (bombState) {
      const mi = bombState.modules.findIndex(m => m.type === data.moduleType && m.solved);
      if (mi >= 0) triggerSolvePulse(mi);
    }
  }
  if (data.event === 'simon-stage-complete') {
    showToast(`Simon Says: Stage ${data.stage} complete!`);
    setTimeout(() => {
      const mi = bombState.modules.findIndex(m => m.type === 'simon' && !m.solved);
      if (mi >= 0) socket.emit('simon-replay', { moduleIndex: mi });
    }, 800);
  }
  if (data.event === 'memory-stage-complete') {
    showToast(`Memory: Stage ${data.stage} complete!`);
    AudioFX.click();
  }
  if (data.event === 'maze-moved') {
    AudioFX.click();
  }
  if (data.event === 'password-cycle') {
    // Just re-render (already done via bombState update)
  }
  if (data.event === 'strike') {
    AudioFX.strike();
    showStrikeFlash();
    flashLighting('red', 500);
    addMagCrack(data.strikes);
    // Faux-3D bomb shake
    const bombEl = document.querySelector('.bomb-container');
    if (bombEl) { bombEl.classList.add('bomb-shake'); setTimeout(() => bombEl.classList.remove('bomb-shake'), 500); }
    updateStrikes(data.strikes, data.maxStrikes);
    showToast(data.message);
    addSystemMessage(data.message);
    if (bombState) bombState.strikes = data.strikes;
    // Show speed-up effect
    if (data.timerSpeed && data.timerSpeed > 1) {
      AudioFX.timerSpeedup(data.timerSpeed);
    }
  }
});

socket.on('timer-tick', ({ timer, speed }) => {
  timerValue = timer;
  timerSpeed = speed || 1;
  updateTimer(timer, speed);
  AudioFX.tick(speed || 1);
});

function updateTimer(s, speed) {
  const el = document.getElementById('game-timer');
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  el.textContent = `${mm}:${ss}`;
  if (speed && speed > 1) {
    el.textContent += ` x${speed}`;
  }
  el.classList.remove('warning', 'danger', 'speed-up');
  if (speed > 1) el.classList.add('speed-up');
  if (s <= 10) el.classList.add('danger');
  else if (s <= 30) el.classList.add('warning');
  // Faux-3D timer urgency atmosphere
  const gm = document.querySelector('.game-main');
  if (gm) {
    gm.classList.toggle('timer-urgent', s <= 30 && s > 10);
    gm.classList.toggle('timer-critical', s <= 10);
    gm.classList.toggle('timer-critical-pulse', s <= 10);
  }
}

function updateStrikes(strikes, max) {
  const c = document.getElementById('game-strikes');
  let h = '';
  for (let i = 0; i < max; i++) {
    const used = i < strikes;
    h += `<div class="strike-icon${used ? ' used' : ''}">${used ? '✕' : '○'}</div>`;
  }
  c.innerHTML = h;
}

// ══════════════════════ GAME OVER ══════════════════════
socket.on('game-over', (data) => {
  const icon = document.getElementById('result-icon');
  const title = document.getElementById('result-title');
  const resultContainer = document.querySelector('.result-container');
  document.getElementById('result-reason').textContent = data.reason;
  resultContainer.classList.remove('lose-bg');

  // Clear any previous explosion overlay
  const explosionOverlay = document.getElementById('explosion-overlay');
  explosionOverlay.classList.add('hidden');
  explosionOverlay.classList.remove('active');

  if (data.won) {
    // Solo progression: complete rounds at each level, then advance
    if (isSoloMode) {
      const totalRounds = SOLO_ROUNDS_PER_LEVEL[gameDifficulty] || 3;
      const nextDiff = { easy: 'medium', medium: 'hard' }[gameDifficulty];
      AudioFX.defused();

      if (soloRound < totalRounds) {
        // More rounds at this level
        soloRound++;
        showToast(`Round ${soloRound - 1} cleared! Round ${soloRound}/${totalRounds}...`);
        setTimeout(() => {
          const cs = buildSoloSettings(gameDifficulty, soloRound);
          socket.emit('create-solo', { playerName: myName, difficulty: 'custom', customSettings: cs }, (res) => {
            if (res.code) { roomCode = res.code; }
          });
        }, 2000);
        return;
      }

      if (nextDiff) {
        // Level complete — advance to next difficulty
        soloRound = 1;
        soloDifficulty = nextDiff;
        gameDifficulty = nextDiff;
        showToast(`${cap(gameDifficulty)} complete! Advancing to ${cap(nextDiff)}...`);
        setTimeout(() => {
          const cs = buildSoloSettings(nextDiff, soloRound);
          socket.emit('create-solo', { playerName: myName, difficulty: 'custom', customSettings: cs }, (res) => {
            if (res.code) { roomCode = res.code; }
          });
        }, 2500);
        return;
      }

      // Beat all of hard — show final victory
      showScreen('result');
      icon.textContent = '🏆';
      title.textContent = 'ALL CHALLENGES COMPLETE!';
      title.className = 'result-title win';
      document.getElementById('result-reason').textContent = 'You cleared all 8 rounds across Easy, Medium, and Hard. You\'re ready for the real thing!';
      const scoreEl = document.getElementById('result-score');
      scoreEl.innerHTML = '<span class="score-label">Final Score</span>' + data.score.toLocaleString();
      scoreEl.classList.remove('hidden');
      const mm2 = Math.floor(data.timeRemaining / 60), ss2 = data.timeRemaining % 60;
      document.getElementById('result-stats').innerHTML = `
        <div class="result-stat-row"><span class="stat-label">Time Remaining</span><span class="stat-value">${String(mm2).padStart(2, '0')}:${String(ss2).padStart(2, '0')}</span></div>
        <div class="result-stat-row"><span class="stat-label">Strikes Used</span><span class="stat-value">${data.strikes} / ${data.maxStrikes}</span></div>
        <div class="result-stat-row"><span class="stat-label">Difficulty</span><span class="stat-value">Hard (Final Round)</span></div>`;
      return;
    }
    showScreen('result');
    icon.textContent = '💚'; title.textContent = 'DEFUSED!'; title.className = 'result-title win';
    AudioFX.defused();
  } else {
    // ── DRAMATIC EXPLOSION SEQUENCE ──
    icon.textContent = '💥'; title.textContent = 'BOOM!'; title.className = 'result-title lose';
    AudioFX.explosion();
    setTimeout(() => AudioFX.explosion(), 300);
    shatterMagLens();

    // Create dramatic explosion overlay
    const dramaticEl = document.createElement('div');
    dramaticEl.className = 'explosion-dramatic';
    dramaticEl.innerHTML = `
      <div class="explosion-shake-layer">
        <div class="explosion-white"></div>
        <div class="explosion-cracks"></div>
        <div class="explosion-fireball"></div>
        <div class="explosion-fireball-2"></div>
        <div class="explosion-ring"></div>
        <div class="explosion-ring-2"></div>
        <div class="explosion-pulse"></div>
        <div class="explosion-smoke"></div>
        <div class="explosion-embers"></div>
        <div class="explosion-debris"></div>
      </div>
    `;
    document.body.appendChild(dramaticEl);

    // Spawn random embers — lots of them
    const embersContainer = dramaticEl.querySelector('.explosion-embers');
    for (let i = 0; i < 80; i++) {
      const ember = document.createElement('div');
      ember.className = 'ember';
      const angle = Math.random() * Math.PI * 2;
      const dist = 150 + Math.random() * 800;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist - 300;
      const size = 2 + Math.random() * 6;
      const hue = 15 + Math.random() * 35;
      const light = 45 + Math.random() * 40;
      ember.style.cssText = `
        animation-delay: ${Math.random() * 0.4}s;
        animation-duration: ${0.8 + Math.random() * 1.5}s;
        --tx: ${tx}px; --ty: ${ty}px;
        width: ${size}px; height: ${size}px;
        background: hsl(${hue}, 100%, ${light}%);
        box-shadow: 0 0 ${size * 2}px hsl(${hue}, 100%, ${light}%);
      `;
      embersContainer.appendChild(ember);
    }

    // Spawn debris chunks
    const debrisContainer = dramaticEl.querySelector('.explosion-debris');
    for (let i = 0; i < 25; i++) {
      const chunk = document.createElement('div');
      chunk.className = 'debris';
      const angle = Math.random() * Math.PI * 2;
      const dist = 300 + Math.random() * 700;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist - 200;
      const w = 8 + Math.random() * 20;
      const h = 6 + Math.random() * 14;
      const rot = Math.random() * 720 - 360;
      chunk.style.cssText = `
        width: ${w}px; height: ${h}px;
        animation-delay: ${Math.random() * 0.2}s;
        animation-duration: ${1.2 + Math.random() * 1}s;
        --tx: ${tx}px; --ty: ${ty}px; --rot: ${rot}deg;
      `;
      debrisContainer.appendChild(chunk);
    }

    // Hide the game content immediately — bomb is destroyed
    const gameContent = document.getElementById('game-content');
    if (gameContent) gameContent.style.opacity = '0';
    const chatPanel = document.querySelector('.chat-panel');
    if (chatPanel) chatPanel.style.opacity = '0';

    // Transition to result after explosion peak
    setTimeout(() => {
      showScreen('result');
      resultContainer.classList.add('lose-bg');
      // Restore opacity after screen has fully switched
      setTimeout(() => {
        if (gameContent) gameContent.style.opacity = '';
        if (chatPanel) chatPanel.style.opacity = '';
      }, 500);
    }, 1500);

    // Clean up after all animations finish
    setTimeout(() => {
      dramaticEl.remove();
      explosionOverlay.classList.add('hidden');
      explosionOverlay.classList.remove('active');
    }, 5000);
  }

  // Score display
  const scoreEl = document.getElementById('result-score');
  if (data.score > 0) {
    scoreEl.innerHTML = `<span class="score-label">Score</span>${data.score.toLocaleString()}`;
    scoreEl.classList.remove('hidden');
  } else {
    scoreEl.classList.add('hidden');
  }

  const mm = Math.floor(data.timeRemaining / 60), ss = data.timeRemaining % 60;
  document.getElementById('result-stats').innerHTML = `
    <div class="result-stat-row"><span class="stat-label">Time Remaining</span><span class="stat-value">${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}</span></div>
    <div class="result-stat-row"><span class="stat-label">Strikes Used</span><span class="stat-value">${data.strikes} / ${data.maxStrikes}</span></div>
    <div class="result-stat-row"><span class="stat-label">Difficulty</span><span class="stat-value">${cap(data.difficulty)}</span></div>
    <div class="result-stat-row"><span class="stat-label">Score</span><span class="stat-value" style="color:#c9a227;font-family:var(--font-mono)">${data.difficulty === 'custom' ? '--' : (data.score > 0 ? data.score.toLocaleString() : '—')}</span></div>`;

  // Save to localStorage leaderboard (skip solo and custom)
  if (!isSoloMode && data.difficulty !== 'custom') {
    saveLocalScore({
      won: data.won,
      score: data.score || 0,
      difficulty: data.difficulty,
      timeRemaining: data.timeRemaining,
      strikes: data.strikes,
      maxStrikes: data.maxStrikes,
      executor: myRole === 'executor' ? myName : (window._partnerName || 'Partner'),
      instructor: myRole === 'instructor' ? myName : (window._partnerName || 'Partner'),
      timestamp: Date.now(),
    });
    renderScoreboard();
  }
});

document.getElementById('btn-play-again').addEventListener('click', () => {
  if (isSoloMode) {
    // Retry same round
    const cs = buildSoloSettings(gameDifficulty, soloRound);
    socket.emit('create-solo', { playerName: myName, difficulty: 'custom', customSettings: cs }, (res) => {
      if (res.code) { roomCode = res.code; }
    });
    return;
  }
  const payload = {};
  if (gameDifficulty === 'custom') { payload.difficulty = 'custom'; payload.customSettings = customSettings; }
  socket.emit('play-again', payload);
});
document.getElementById('btn-change-difficulty').addEventListener('click', () => {
  if (isSoloMode) {
    exitSoloMode();
    VoiceChat.hangup();
    socket.disconnect();
    socket.connect();
    showScreen('landing');
    if (settings.musicVolume > 0) AudioFX.menuMusic();
    return;
  }
  socket.emit('play-again', {});
});

socket.on('back-to-lobby', (state) => {
  if (isSoloMode) {
    exitSoloMode();
    showScreen('landing');
    if (settings.musicVolume > 0) AudioFX.menuMusic();
    return;
  }
  showScreen('lobby');
  document.getElementById('btn-ready').disabled = false;
  document.getElementById('btn-ready').textContent = 'Ready';
  document.querySelectorAll('.btn-role').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.btn-diff').forEach(b => b.classList.toggle('active', b.dataset.diff === state.difficulty));
  renderLobbyPlayers(state);
  isHoldingButton = false; bombState = null; manualData = null; stripColor = null;
  timerSpeed = 1;
  // Sync custom settings panel
  const customPanel = document.getElementById('custom-settings');
  if (state.difficulty === 'custom') {
    customPanel.classList.remove('hidden');
    if (state.customSettings) applyCustomSettingsToUI(state.customSettings);
  } else {
    customPanel.classList.add('hidden');
  }
  // Reset briefing ready state
  document.getElementById('btn-briefing-ready').disabled = false;
  document.getElementById('btn-briefing-ready').textContent = 'Ready';
  document.getElementById('btn-briefing-ready').classList.add('pulse');
  document.getElementById('briefing-status').textContent = '';
  document.getElementById('countdown-overlay').classList.add('hidden');
  // Refresh scoreboard data for when they return to landing
  loadLandingScoreboard();
});

// ══════════════════════ CHAT ══════════════════════
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatCharCount = document.getElementById('chat-char-count');
const chatNewBadge = document.getElementById('chat-new-badge');

let typingTimeout = null;
chatInput.addEventListener('input', () => {
  const rem = 200 - chatInput.value.length;
  chatCharCount.textContent = rem;
  chatCharCount.style.color = rem < 20 ? 'var(--accent-red)' : 'var(--text-muted)';
  // Typing indicator
  if (!typingTimeout) socket.emit('typing');
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => { typingTimeout = null; }, 1000);
});
document.getElementById('btn-send-chat').addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', { text });
  chatInput.value = '';
  chatCharCount.textContent = '200';
  chatCharCount.style.color = 'var(--text-muted)';
}

// ── Typing Indicator ──
let typingIndicatorTimeout = null;
socket.on('partner-typing', () => {
  let el = document.getElementById('typing-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'typing-indicator';
    el.className = 'typing-indicator';
    el.textContent = 'Partner is typing...';
    chatMessages.parentNode.insertBefore(el, chatNewBadge);
  }
  el.classList.remove('hidden');
  clearTimeout(typingIndicatorTimeout);
  typingIndicatorTimeout = setTimeout(() => el.classList.add('hidden'), 2000);
});

// ── Quick Phrases ──
const quickPhrases = ['Wait', 'Ready', 'Go ahead', 'Read that again', 'Which wire?', 'Cut it!', 'Hold on', 'I\'m not sure'];
const quickPhraseBar = document.createElement('div');
quickPhraseBar.className = 'quick-phrases';
quickPhrases.forEach(phrase => {
  const btn = document.createElement('button');
  btn.className = 'btn btn-tiny quick-phrase-btn';
  btn.textContent = phrase;
  btn.addEventListener('click', () => {
    socket.emit('chat-message', { text: phrase });
    AudioFX.click();
  });
  quickPhraseBar.appendChild(btn);
});
document.querySelector('.chat-input-row').before(quickPhraseBar);

// ── Tab Notification ──
let unreadCount = 0;
const originalTitle = document.title;
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { unreadCount = 0; document.title = originalTitle; }
});

socket.on('chat-message', (msg) => {
  addChatMessage(msg);
  AudioFX.message();
  if (document.hidden) { unreadCount++; document.title = `(${unreadCount}) ${originalTitle}`; }
});
socket.on('message-edited', ({ messageId, newText }) => {
  const el = document.querySelector(`[data-msg-id="${messageId}"] .msg-text`);
  if (el) { el.textContent = newText; el.insertAdjacentHTML('beforeend', ' <span style="font-size:11px;color:var(--text-muted)">(edited)</span>'); }
});

function addChatMessage(msg) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.dataset.msgId = msg.id;
  const time = new Date(msg.timestamp);
  const ts = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
  const isMe = msg.sender === myName;
  const canEdit = isMe && (Date.now() - msg.timestamp < 5000);
  div.innerHTML = `<div class="msg-header"><span class="msg-sender ${msg.role || ''}">${esc(msg.sender)}</span><span class="msg-time">${ts}</span>${canEdit ? `<button class="msg-edit-btn" data-msg-id="${msg.id}">edit</button>` : ''}</div><div class="msg-text">${esc(msg.text)}</div>`;
  chatMessages.appendChild(div);

  if (canEdit) {
    const editBtn = div.querySelector('.msg-edit-btn');
    editBtn.addEventListener('click', () => {
      const newText = prompt('Edit message:', msg.text);
      if (newText && newText.trim() && newText !== msg.text) socket.emit('edit-message', { messageId: msg.id, newText: newText.trim() });
    });
    setTimeout(() => editBtn.remove(), 5000 - (Date.now() - msg.timestamp));
  }

  if (chatAutoScroll) chatMessages.scrollTop = chatMessages.scrollHeight;
  else chatNewBadge.classList.remove('hidden');
}

function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'chat-msg system-msg';
  div.innerHTML = `<div class="msg-text">${esc(text)}</div>`;
  chatMessages.appendChild(div);
  if (chatAutoScroll) chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatMessages.addEventListener('scroll', () => {
  chatAutoScroll = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 40;
  if (chatAutoScroll) chatNewBadge.classList.add('hidden');
});
chatNewBadge.addEventListener('click', () => { chatMessages.scrollTop = chatMessages.scrollHeight; chatNewBadge.classList.add('hidden'); });

// ══════════════════════ CONFIRMATION TOOLTIP ══════════════════════
const confirmTooltip = document.getElementById('confirm-tooltip');
const confirmText = document.getElementById('confirm-text');
const confirmYes = document.getElementById('confirm-yes');
const confirmNo = document.getElementById('confirm-no');
let confirmCallback = null;

function showConfirmation(e, text, onConfirm) {
  if (!settings.actionConfirmations) { onConfirm(); return; }
  const x = e.clientX || (e.left + 60);
  const y = e.clientY || (e.top - 10);
  confirmText.textContent = text;
  confirmCallback = onConfirm;
  confirmTooltip.style.left = Math.min(x, window.innerWidth - 240) + 'px';
  confirmTooltip.style.top = Math.max(y - 60, 8) + 'px';
  confirmTooltip.classList.remove('hidden');
  confirmYes.focus();
}
confirmYes.addEventListener('click', () => { confirmTooltip.classList.add('hidden'); if (confirmCallback) confirmCallback(); confirmCallback = null; });
confirmNo.addEventListener('click', () => { confirmTooltip.classList.add('hidden'); confirmCallback = null; });
document.addEventListener('click', (e) => {
  if (!confirmTooltip.classList.contains('hidden') && !confirmTooltip.contains(e.target) && !e.target.closest('.wire-row,.bomb-button-cap,.keypad-key,.morse-submit-btn,.password-submit-btn,.knob-submit-btn,.maze-dir-btn,.memory-button')) {
    confirmTooltip.classList.add('hidden'); confirmCallback = null;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!confirmTooltip.classList.contains('hidden')) { confirmTooltip.classList.add('hidden'); confirmCallback = null; }
  }
});

// ══════════════════════ EFFECTS ══════════════════════
function showStrikeFlash() {
  if (!settings.screenShake) return;
  const f = document.getElementById('strike-flash');
  f.classList.remove('hidden'); f.offsetHeight; f.style.animation = 'none'; f.offsetHeight; f.style.animation = '';
  setTimeout(() => f.classList.add('hidden'), 500);
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._to); t._to = setTimeout(() => t.classList.add('hidden'), 3000);
}

socket.on('partner-disconnected', () => { showToast('Partner disconnected.'); addSystemMessage('Partner disconnected.'); });

function renderScoreboard() {
  const data = getLocalScoreboard();
  const body = document.getElementById('scoreboard-body');
  if (!data || (!data.wins.length && !data.recent.length)) {
    body.innerHTML = '<p class="scoreboard-empty">No games played yet. Be the first!</p>';
    return;
  }
  let html = '';

  // Stats bar
  html += '<div class="scoreboard-stats">';
  html += `<div class="scoreboard-stat"><div class="stat-num">${data.stats.totalGames}</div><div class="stat-lbl">Games</div></div>`;
  html += `<div class="scoreboard-stat"><div class="stat-num">${data.stats.totalWins}</div><div class="stat-lbl">Wins</div></div>`;
  html += `<div class="scoreboard-stat"><div class="stat-num">${data.stats.winRate}%</div><div class="stat-lbl">Win Rate</div></div>`;
  html += '</div>';

  // Top wins
  if (data.wins.length) {
    html += '<div class="scoreboard-section-title">Top Wins</div>';
    html += '<table class="scoreboard-table"><thead><tr><th>#</th><th>Pair</th><th>Diff</th><th>Score</th><th>Time Left</th><th>Date</th></tr></thead><tbody>';
    data.wins.forEach((g, i) => {
      const rank = i + 1;
      const rankClass = rank <= 3 ? `rank-${rank}` : 'rank-other';
      const mm = String(Math.floor(g.timeRemaining / 60)).padStart(2, '0');
      const ss = String(g.timeRemaining % 60).padStart(2, '0');
      const d = new Date(g.timestamp);
      const date = `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`;
      html += `<tr>
        <td class="rank-cell ${rankClass}">${rank}</td>
        <td class="pair-cell"><div class="pair-names">${esc(g.executor)} + ${esc(g.instructor)}</div></td>
        <td><span class="diff-badge diff-${g.difficulty}">${cap(g.difficulty)}</span></td>
        <td class="score-cell">${g.score.toLocaleString()}</td>
        <td>${mm}:${ss}</td>
        <td>${date}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }

  // Recent games
  if (data.recent.length) {
    html += '<div class="scoreboard-section-title">Recent Missions</div>';
    html += '<table class="scoreboard-table"><thead><tr><th>Result</th><th>Pair</th><th>Diff</th><th>Score</th><th>Date</th></tr></thead><tbody>';
    data.recent.forEach(g => {
      const result = g.won ? '<span class="recent-result recent-win">WIN</span>' : '<span class="recent-result recent-loss">LOSS</span>';
      const d = new Date(g.timestamp);
      const date = `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`;
      html += `<tr>
        <td>${result}</td>
        <td class="pair-cell"><div class="pair-names">${esc(g.executor)} + ${esc(g.instructor)}</div></td>
        <td><span class="diff-badge diff-${g.difficulty}">${cap(g.difficulty)}</span></td>
        <td class="score-cell">${g.score > 0 ? g.score.toLocaleString() : '—'}</td>
        <td>${date}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }

  body.innerHTML = html;
}

// ══════════════════════ FULLSCREEN ══════════════════════
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function updateFullscreenIcons() {
  const isFS = !!document.fullscreenElement;
  document.querySelectorAll('.fs-expand').forEach(el => el.classList.toggle('hidden', isFS));
  document.querySelectorAll('.fs-compress').forEach(el => el.classList.toggle('hidden', !isFS));
}

document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);
document.getElementById('btn-fullscreen-game').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenIcons);

// ══════════════════════ ACHIEVEMENTS ══════════════════════
const ACHIEVEMENTS = {
  first_defuse: { name: 'First Defuse', desc: 'Defuse your first bomb', icon: '🏆' },
  flawless: { name: 'Flawless', desc: 'Defuse on hard with 0 strikes', icon: '💎' },
  speed_demon: { name: 'Speed Demon', desc: 'Defuse with 50%+ time remaining on hard', icon: '⚡' },
  veteran: { name: 'Veteran', desc: 'Complete 10 games', icon: '🎖' },
  elite: { name: 'Elite', desc: 'Complete 50 games', icon: '⭐' },
  comeback: { name: 'Comeback', desc: 'Win with max strikes - 1', icon: '🔥' },
  perfect_score: { name: 'Perfect Score', desc: 'Score over 5000', icon: '👑' },
  all_modules: { name: 'Module Master', desc: 'Defuse a bomb with all 9 modules', icon: '🧩' },
  solo_win: { name: 'Lone Wolf', desc: 'Defuse in solo practice', icon: '🐺' },
  ten_wins: { name: 'Unstoppable', desc: 'Win 10 games', icon: '🚀' },
};

function loadAchievements() {
  try { return JSON.parse(localStorage.getItem('achievements') || '{}'); } catch { return {}; }
}

function unlockAchievement(key) {
  const unlocked = loadAchievements();
  if (unlocked[key]) return;
  const ach = ACHIEVEMENTS[key];
  if (!ach) return;
  unlocked[key] = { unlockedAt: Date.now() };
  localStorage.setItem('achievements', JSON.stringify(unlocked));
  showToast(`${ach.icon} Achievement: ${ach.name}!`);
}

function checkAchievements(data) {
  const stats = loadPlayerStats();
  if (data.won) {
    unlockAchievement('first_defuse');
    if (data.difficulty === 'hard' && data.strikes === 0) unlockAchievement('flawless');
    if (data.difficulty === 'hard') {
      const totalTime = data.difficulty === 'hard' ? 180 : 300;
      if (data.timeRemaining > totalTime / 2) unlockAchievement('speed_demon');
    }
    if (data.strikes === data.maxStrikes - 1) unlockAchievement('comeback');
    if (data.score > 5000) unlockAchievement('perfect_score');
    if (isSoloMode) unlockAchievement('solo_win');
    if (stats.wins >= 10) unlockAchievement('ten_wins');
  }
  if (stats.totalGames >= 10) unlockAchievement('veteran');
  if (stats.totalGames >= 50) unlockAchievement('elite');
}

// ══════════════════════ PLAYER STATS ══════════════════════
function loadPlayerStats() {
  try { return JSON.parse(localStorage.getItem('playerStats') || '{"totalGames":0,"wins":0,"totalScore":0}'); } catch { return { totalGames: 0, wins: 0, totalScore: 0 }; }
}

function updatePlayerStats(data) {
  const stats = loadPlayerStats();
  stats.totalGames++;
  if (data.won) { stats.wins++; stats.totalScore += data.score || 0; }
  if (!stats.bestScore || (data.score || 0) > stats.bestScore) stats.bestScore = data.score || 0;
  localStorage.setItem('playerStats', JSON.stringify(stats));
  return stats;
}

// Hook into game-over
socket.on('game-over', (data) => {
  updatePlayerStats(data);
  setTimeout(() => checkAchievements(data), 1500);
});

// ══════════════════════ UTILITIES ══════════════════════
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function esc(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ══════════════════════ RECONNECTION ══════════════════════
let reconnectData = null; // { roomCode, playerName }

socket.on('disconnect', () => {
  if (myRole && roomCode) {
    reconnectData = { roomCode, playerName: myName };
    showReconnectOverlay('Connection lost. Attempting to reconnect...');
  }
});

socket.on('connect', () => {
  if (reconnectData) {
    socket.emit('reconnect-room', reconnectData, (res) => {
      if (res && res.success) {
        hideReconnectOverlay();
        addSystemMessage('Reconnected to the game!');
      } else {
        hideReconnectOverlay();
        reconnectData = null;
        showToast(res?.error || 'Could not reconnect.');
        showScreen('landing');
      }
    });
  }
});

socket.on('partner-disconnected-temp', ({ holdDuration }) => {
  addSystemMessage(`Partner disconnected. Waiting ${holdDuration / 1000}s for reconnect...`);
  showToast('Partner disconnected — waiting for reconnect...');
});

socket.on('partner-reconnected', () => {
  addSystemMessage('Partner reconnected!');
  showToast('Partner reconnected!');
});

socket.on('game-resume', (data) => {
  reconnectData = null;
  myRole = data.role;
  gameDifficulty = data.difficulty;
  if (data.role === 'executor') {
    bombState = data.bomb;
    showScreen('game');
    renderExecutorView();
  } else {
    manualData = data.manual;
    showScreen('game');
    renderInstructorView();
  }
  updateTimer(data.timer || 0, timerSpeed);
});

function showReconnectOverlay(msg) {
  let overlay = document.getElementById('reconnect-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'reconnect-overlay';
    overlay.className = 'reconnect-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="reconnect-content"><div class="reconnect-spinner"></div><p>${msg}</p></div>`;
  overlay.classList.remove('hidden');
}

function hideReconnectOverlay() {
  const overlay = document.getElementById('reconnect-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// ══════════════════════ INSTRUCTOR: REDACTED TEXT ══════════════════════
const redactionCache = {}; // { tabName: redacted innerHTML }

function applyRedactions() {
  const body = document.getElementById('manual-body');
  if (!body) return;

  // If we already have cached redactions for this tab, restore them
  if (redactionCache[currentManualTab]) {
    body.innerHTML = redactionCache[currentManualTab];
    return;
  }
  const safeWords = ['cut','press','hold','wire','button','red','blue','yellow','green','white','black','orange','purple',
    'first','last','second','third','fourth','fifth','position','label','serial','batteries','indicators','ports','protocol',
    'alpha','bravo','charlie','wires','keypad','simon','morse','memory','maze','password','knob',
    'if','then','otherwise','not','and','or','the','a','is','are','has','have','more','than','no','when',
    'strike','module','stage','display','frequency','column','pattern','vowel','odd','even',
    'shell','halls','slick','trick','boxes','leaks','strobe','bistro','flick','bombs','break','brick',
    'steak','sting','vector','beats','mhz','release','timer','countdown','lit','indicator',
    'alpha','bravo','cobra','delta','eagle','flame','ghost','havoc','intel','joker',
    'knife','lance','motor','nerve','omega','pulse','dot','dash','short','long','blink',
    'about','after','again','below','could','every','first','found','great','house','large','learn',
    'never','other','place','plant','point','right','small','sound','spell','still','study','their',
    'there','these','thing','think','three','water','where','which','world','would','write',
    'press','abort','detonate','hold','triangle','circle','star','lightning',
    'up','down','left','right',
    'says','strip','pressed','number','contains','strikes','solve','solved',
    'order','sequence','same','only','count','type','color','colors','matching',
    'look','find','match','check','verify','identify','read','note','important',
    'critical','warning','proceed','follow','apply','use','using','rules','rule'];
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip text inside tables, SVGs, code elements, and image containers
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('table, svg, code, .morse-dict-table, .bomb-index-table, .strike-ref-table, .nato-table, .simon-table, .password-word-table, .password-word-groups, .keypad-columns-grid, .knob-pattern-table, .wire-legend, .wire-swatch, img, .mc_visual, .mc_code')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  let redactCount = 0;
  const maxRedact = 8 + Math.floor(Math.random() * 6); // 8-13 redactions per page
  textNodes.forEach(node => {
    if (redactCount >= maxRedact) return;
    const text = node.textContent;
    if (text.trim().length < 5) return;
    const words = text.split(/(\s+)/);
    let changed = false;
    const newParts = words.map(w => {
      if (redactCount >= maxRedact) return w;
      if (w.trim().length < 3 || /^\s+$/.test(w)) return w;
      const lower = w.toLowerCase().replace(/[^a-z]/g, '');
      if (safeWords.includes(lower)) return w;
      // Protect numbers, frequencies, codes, symbols, short words
      if (/\d/.test(w)) return w; // contains any digit
      if (/[→←↑↓●○■★△♪☀♠♥♦♣□☆⚡○✓]/.test(w)) return w; // symbols
      if (w.length <= 3) return w; // too short
      if (Math.random() > 0.06) return w; // ~6% chance per eligible word
      redactCount++;
      return `<span class="redacted" title="Click to reveal">${w}</span>`;
    });
    if (redactCount > 0 && newParts.some(p => p.includes('redacted'))) {
      const span = document.createElement('span');
      span.innerHTML = newParts.join('');
      node.parentNode.replaceChild(span, node);
    }
  });

  // Cache the redacted HTML for this tab
  redactionCache[currentManualTab] = body.innerHTML;
}

// ══════════════════════ INSTRUCTOR: TORN/DAMAGED PAGES ══════════════════════
function applyPageDamage() {
  const body = document.getElementById('manual-body');
  if (!body) return;
  body.style.position = 'relative';
  // Random chance of each damage type
  if (Math.random() < 0.3) body.classList.add('page-torn-corner');
  if (Math.random() < 0.25) body.classList.add('page-burn-edge');
  // Scorch mark
  if (Math.random() < 0.35) {
    const scorch = document.createElement('div');
    scorch.className = 'page-scorch';
    scorch.style.top = (20 + Math.random() * 50) + '%';
    scorch.style.left = (10 + Math.random() * 60) + '%';
    scorch.style.transform = `rotate(${Math.random() * 360}deg)`;
    body.appendChild(scorch);
  }
  // Tear line
  if (Math.random() < 0.3) {
    const tear = document.createElement('div');
    tear.className = 'page-tear-line';
    tear.style.top = (30 + Math.random() * 40) + '%';
    body.appendChild(tear);
  }
}

// ══════════════════════ INSTRUCTOR: ANNOTATION SYSTEM ══════════════════════
let annoActive = false;
let annoDrawing = false;
let annoColor = '#f85149';
let annoIsEraser = false;
let annoCanvas = null;
let annoCtx = null;
const annoPageData = {}; // { tabName: imageDataURL } — persists per page
let annoWrapperEl = null;

function showAnnoWrapper() {
  // If old wrapper exists but was detached from DOM (re-render), discard it
  if (annoWrapperEl && !annoWrapperEl.parentElement) { annoWrapperEl = null; }
  if (annoWrapperEl) { annoWrapperEl.classList.remove('hidden'); return; }
  const manualContainer = document.querySelector('.manual-container');
  if (!manualContainer) return;
  manualContainer.style.position = 'relative';
  manualContainer.style.overflow = 'visible';

  annoWrapperEl = document.createElement('div');
  annoWrapperEl.className = 'anno-wrapper';
  annoWrapperEl.id = 'anno-wrapper';
  annoWrapperEl.innerHTML = `
    <button class="anno-toggle-btn" id="anno-toggle" title="Annotations">✏️</button>
    <div class="anno-palette" id="anno-palette">
      <button class="anno-btn anno-color active" data-color="#f85149" style="background:#f85149" title="Red"></button>
      <button class="anno-btn anno-color" data-color="#58a6ff" style="background:#58a6ff" title="Blue"></button>
      <button class="anno-btn anno-color" data-color="#3fb950" style="background:#3fb950" title="Green"></button>
      <button class="anno-btn anno-color" data-color="#d29922" style="background:#d29922" title="Yellow"></button>
      <button class="anno-btn anno-color" data-color="#1a1a1a" style="background:#1a1a1a" title="Black"></button>
      <div class="anno-divider"></div>
      <button class="anno-btn anno-eraser" data-color="erase" title="Eraser"></button>
      <div class="anno-divider"></div>
      <button class="anno-btn anno-clear" data-action="clear" title="Clear this page">✕</button>
    </div>
  `;
  manualContainer.appendChild(annoWrapperEl);

  // Toggle button
  annoWrapperEl.querySelector('#anno-toggle').addEventListener('click', () => {
    const palette = annoWrapperEl.querySelector('#anno-palette');
    const btn = annoWrapperEl.querySelector('#anno-toggle');
    if (annoActive) {
      // Close
      annoActive = false;
      palette.classList.remove('open');
      btn.classList.remove('active');
      if (annoCanvas) { saveAnnoPage(); annoCanvas.classList.remove('drawing'); }
    } else {
      // Open
      annoActive = true;
      palette.classList.add('open');
      btn.classList.add('active');
      setupAnnoCanvas();
      if (annoCanvas) annoCanvas.classList.add('drawing');
    }
    AudioFX.click();
  });

  // Colors
  annoWrapperEl.querySelectorAll('.anno-color').forEach(btn => {
    btn.addEventListener('click', () => {
      annoWrapperEl.querySelectorAll('.anno-color, .anno-eraser').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      annoIsEraser = false;
      annoColor = btn.dataset.color;
    });
  });

  // Eraser
  annoWrapperEl.querySelector('.anno-eraser').addEventListener('click', function() {
    annoWrapperEl.querySelectorAll('.anno-color, .anno-eraser').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    annoIsEraser = true;
  });

  // Clear
  annoWrapperEl.querySelector('[data-action="clear"]').addEventListener('click', () => {
    clearAnnoPage();
    AudioFX.click();
  });
}

function hideAnnoWrapper() {
  if (annoWrapperEl) annoWrapperEl.classList.add('hidden');
  annoActive = false;
}

function setupAnnoCanvas() {
  const body = document.getElementById('manual-body');
  if (!body) return;
  body.style.position = 'relative';

  // Remove old canvas
  const old = body.querySelector('.ink-canvas');
  if (old) {
    // Save before removing
    saveAnnoPage();
    old.remove();
  }

  // Create canvas sized to the full scrollable content
  annoCanvas = document.createElement('canvas');
  annoCanvas.className = 'ink-canvas';
  annoCanvas.width = body.clientWidth;
  annoCanvas.height = Math.max(body.scrollHeight, body.clientHeight, 800);
  body.appendChild(annoCanvas);
  annoCtx = annoCanvas.getContext('2d');

  // Restore saved annotations for this specific tab
  const savedData = annoPageData[currentManualTab];
  if (savedData) {
    const img = new Image();
    img.onload = () => { if (annoCtx) annoCtx.drawImage(img, 0, 0); };
    img.src = savedData;
  }

  // Drawing events
  annoCanvas.onmousedown = (e) => {
    if (!annoActive) return;
    annoDrawing = true;
    const r = annoCanvas.getBoundingClientRect();
    annoCtx.beginPath();
    annoCtx.moveTo(e.clientX - r.left, e.clientY - r.top);
  };
  annoCanvas.onmousemove = (e) => {
    if (!annoDrawing || !annoActive) return;
    const r = annoCanvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (annoIsEraser) {
      annoCtx.clearRect(x - 15, y - 15, 30, 30);
    } else {
      annoCtx.lineWidth = 2.5;
      annoCtx.lineCap = 'round';
      annoCtx.lineJoin = 'round';
      annoCtx.strokeStyle = annoColor;
      annoCtx.globalAlpha = 0.8;
      annoCtx.lineTo(x, y);
      annoCtx.stroke();
      annoCtx.globalAlpha = 1;
    }
  };
  annoCanvas.onmouseup = () => { annoDrawing = false; saveAnnoPage(); };
  annoCanvas.onmouseleave = () => { annoDrawing = false; saveAnnoPage(); };

  if (annoActive) annoCanvas.classList.add('drawing');
}

function saveAnnoPage() {
  saveAnnoPageAs(currentManualTab);
}

function saveAnnoPageAs(tabName) {
  if (!annoCanvas || !annoCtx || !tabName) return;
  try {
    // Only save if there's actual drawn content (not a blank canvas)
    const data = annoCanvas.toDataURL();
    annoPageData[tabName] = data;
  } catch(_) {}
}

function clearAnnoPage() {
  if (annoCtx && annoCanvas) {
    annoCtx.clearRect(0, 0, annoCanvas.width, annoCanvas.height);
    delete annoPageData[currentManualTab];
  }
}

function resetAllAnnotations() {
  Object.keys(annoPageData).forEach(k => delete annoPageData[k]);
  annoActive = false;
  annoDrawing = false;
  annoCanvas = null;
  annoCtx = null;
  annoWrapperEl = null;
}

// ══════════════════════ MAGNIFYING GLASS ══════════════════════
const magnifier = document.getElementById('magnifier');
const magnifierLens = document.getElementById('magnifier-lens');
let magActive = false;
let magDragging = false;
let magOffsetX = 0, magOffsetY = 0;
const MAG_SIZE = 260;

const MAG_ZOOM = 2;
let magRafId = null;

function toggleMagnifier() {
  magActive = !magActive;
  magnifier.classList.toggle('hidden', !magActive);
  if (magActive) {
    magnifier.style.left = (window.innerWidth / 2 - MAG_SIZE / 2) + 'px';
    magnifier.style.top = (window.innerHeight / 3) + 'px';
    magRafId = requestAnimationFrame(magLoop);
  } else {
    if (magRafId) { cancelAnimationFrame(magRafId); magRafId = null; }
    magnifierLens.style.backgroundImage = '';
    magnifierLens.style.backgroundColor = '';
  }
}

let _magLastFrame = 0;
function magLoop(now) {
  if (!magActive) return;
  // Throttle to ~24fps — balance between smooth and performant
  if (now - _magLastFrame > 42) {
    _magLastFrame = now;
    updateMagZoom();
  }
  magRafId = requestAnimationFrame(magLoop);
}

function updateMagZoom() {
  const magRect = magnifier.getBoundingClientRect();
  const cx = magRect.left + MAG_SIZE / 2;
  const cy = magRect.top + MAG_SIZE / 2;

  // Remove old zoom
  const existing = magnifierLens.querySelector('.mag-zoom');
  if (existing) existing.remove();

  // Use game-main in game, or landing screen as fallback
  const gameMain = document.querySelector('.game-main') || document.querySelector('#screen-landing.active');
  if (!gameMain) return;
  const gmRect = gameMain.getBoundingClientRect();

  const relX = cx - gmRect.left;
  const relY = cy - gmRect.top;

  const zoomDiv = document.createElement('div');
  zoomDiv.className = 'mag-zoom';
  zoomDiv.style.cssText = 'position:absolute;inset:0;border-radius:50%;overflow:hidden;';

  const clone = gameMain.cloneNode(true);
  clone.style.cssText = `
    position: absolute;
    width: ${gmRect.width}px;
    height: ${gmRect.height}px;
    pointer-events: none;
    transform-origin: 0 0;
    transform: scale(${MAG_ZOOM});
    left: ${(-relX * MAG_ZOOM + MAG_SIZE / 2)}px;
    top: ${(-relY * MAG_ZOOM + MAG_SIZE / 2)}px;
    overflow: visible;
  `;

  // Fix scroll offsets and copy canvas data
  const origEls = gameMain.querySelectorAll('*');
  const cloneEls = clone.querySelectorAll('*');
  for (let i = 0; i < origEls.length; i++) {
    const orig = origEls[i];
    const ce = cloneEls[i];
    if (!ce) continue;

    // Copy canvas pixel data (cloneNode doesn't copy canvas content)
    if (orig.tagName === 'CANVAS' && orig.width > 0 && orig.height > 0) {
      try {
        ce.width = orig.width;
        ce.height = orig.height;
        const ctx = ce.getContext('2d');
        if (ctx) ctx.drawImage(orig, 0, 0);
      } catch(_) {}
    }

    // Fix scroll offsets — wrap children in offset container (not transform on parent)
    if (orig.scrollTop > 0 || orig.scrollLeft > 0) {
      const scrollT = orig.scrollTop;
      const scrollL = orig.scrollLeft;
      // Pull out absolutely-positioned canvases (ink-canvas) before wrapping
      const absCanvases = Array.from(ce.querySelectorAll('.ink-canvas'));
      absCanvases.forEach(ac => { ac.remove(); ac.style.top = (-scrollT) + 'px'; });
      // Wrap remaining children in offset container
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `margin-top:${-scrollT}px;margin-left:${-scrollL}px;`;
      while (ce.firstChild) wrapper.appendChild(ce.firstChild);
      ce.appendChild(wrapper);
      // Re-add canvases directly on the scrolled element (not in wrapper)
      absCanvases.forEach(ac => ce.appendChild(ac));
      ce.style.overflow = 'hidden';
    }
  }

  zoomDiv.appendChild(clone);
  magnifierLens.appendChild(zoomDiv);
}

// Drag handlers
magnifier.addEventListener('mousedown', (e) => {
  magDragging = true;
  magOffsetX = e.clientX - magnifier.getBoundingClientRect().left;
  magOffsetY = e.clientY - magnifier.getBoundingClientRect().top;
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!magDragging) return;
  magnifier.style.left = (e.clientX - magOffsetX) + 'px';
  magnifier.style.top = (e.clientY - magOffsetY) + 'px';
});

document.addEventListener('mouseup', () => { magDragging = false; });

// Touch support
magnifier.addEventListener('touchstart', (e) => {
  magDragging = true;
  const t = e.touches[0];
  magOffsetX = t.clientX - magnifier.getBoundingClientRect().left;
  magOffsetY = t.clientY - magnifier.getBoundingClientRect().top;
  e.preventDefault();
}, { passive: false });

document.addEventListener('touchmove', (e) => {
  if (!magDragging) return;
  const t = e.touches[0];
  magnifier.style.left = (t.clientX - magOffsetX) + 'px';
  magnifier.style.top = (t.clientY - magOffsetY) + 'px';
}, { passive: false });

document.addEventListener('touchend', () => { magDragging = false; });

// Keyboard shortcuts: G = magnifier, M = mute, Escape = close magnifier
document.addEventListener('keydown', (e) => {
  if (document.activeElement === document.getElementById('chat-input')) return;
  if (document.activeElement === document.getElementById('manual-search-input')) return;
  if (e.key === 'g' || e.key === 'G') { toggleMagnifier(); }
  else if (e.key === 'm' || e.key === 'M') { if (VoiceChat.hasStream) VoiceChat.toggleMute(); }
  else if (e.key === 'Escape' && magActive) { toggleMagnifier(); }
});

// ══════════════════════ FLIP MODE — ROLE SWAP ══════════════════════
socket.on('flip-swap', (data) => {
  const overlay = document.getElementById('flip-swap-overlay');
  const textEl = document.getElementById('flip-swap-text');
  const roleEl = document.getElementById('flip-swap-role');

  // Show swap overlay
  overlay.classList.remove('hidden');
  textEl.textContent = 'ROLES SWAPPED!';
  textEl.style.animation = 'none';
  void textEl.offsetWidth; // reflow
  textEl.style.animation = '';

  const newRole = data.role;
  roleEl.textContent = `YOU ARE NOW: ${newRole.toUpperCase()}`;
  roleEl.className = `flip-swap-role role-${newRole}`;

  AudioFX.impactBoom();

  // Update local state
  myRole = newRole;

  // After 1.5s, hide overlay and re-render
  setTimeout(() => {
    overlay.classList.add('hidden');
    if (newRole === 'executor') {
      bombState = data.bomb;
      window._executorRendered = false; // allow entrance animation
      renderExecutorView();
    } else {
      manualData = data.manual;
      currentManualTab = 'index';
      renderInstructorView();
    }
  }, 1500);
});

// ══════════════════════ PAGE FLIP HELPER ══════════════════════
let isFlipping = false;
const TAB_ORDER = ['index','overview','procedures','sequence','wires','button','keypad','simon','morse','memory','maze','password','knob','appendix'];

function flipManualPage(newTab, prevTab) {
  const body = document.getElementById('manual-body');
  if (!body || isFlipping) return;
  isFlipping = true;
  AudioFX.pageFlip();

  // Determine direction based on previous tab position vs new
  const oldIdx = TAB_ORDER.indexOf(prevTab || 'index');
  const newIdx = TAB_ORDER.indexOf(newTab);
  const goingForward = newIdx > oldIdx;

  const outClass = goingForward ? 'page-out-left' : 'page-out-right';
  const inClass = goingForward ? 'page-in-right' : 'page-in-left';

  // Save annotations for the OLD page before flipping
  saveAnnoPageAs(prevTab || currentManualTab);

  body.classList.add(outClass);
  setTimeout(() => {
    body.scrollTop = 0;
    body.innerHTML = renderManualTab(newTab);
    body.classList.remove(outClass, 'page-torn-corner', 'page-burn-edge');
    body.querySelectorAll('.page-scorch,.page-tear-line').forEach(el => el.remove());
    body.classList.add(inClass);
    // Apply instructor effects
    applyRedactions();
    applyPageDamage();
    // Restore annotation canvas for the new page (with that page's saved data)
    setupAnnoCanvas();
    setTimeout(() => { body.classList.remove(inClass); isFlipping = false; }, 350);
  }, 230);
}

// ══════════════════════ CINEMATIC INTRO SEQUENCE ══════════════════════
const introOverlay = document.getElementById('intro-overlay');
const introContent = document.getElementById('intro-content');
const introSkipBtn = document.getElementById('intro-skip-btn');
let introTimeout = null;
let introResolve = null;

function playIntro(role) {
  // Skip only if user explicitly disabled in settings
  if (settings.skipIntro) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    introResolve = resolve;
    introOverlay.classList.remove('hidden');
    introContent.innerHTML = '';

    if (role === 'instructor') {
      playInstructorIntro();
    } else if (role === 'solo') {
      playSoloIntro();
    } else {
      playExecutorIntro();
    }

  });
}

function endIntro() {
  if (Array.isArray(introTimeout)) { introTimeout.forEach(t => clearTimeout(t)); }
  else if (introTimeout) { clearTimeout(introTimeout); }
  introTimeout = null;
  introOverlay.classList.add('hidden');
  introContent.innerHTML = '';
  if (introResolve) { introResolve(); introResolve = null; }
}

introSkipBtn.addEventListener('click', () => { endIntro(); AudioFX.click(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Shift' && !introOverlay.classList.contains('hidden')) { endIntro(); }
});

function playExecutorIntro() {
  AudioFX.tensionDrone(5.8);
  AudioFX.ambientSiren();

  const _t = [];
  const sched = (fn, ms) => _t.push(setTimeout(() => { if (!introOverlay.classList.contains('hidden')) fn(); }, ms));

  function glitch() {
    const g = document.getElementById('intro-glitch');
    if (g) { const top = 20 + Math.random() * 60; g.style.clipPath = `inset(${top}% 0 ${95-top}% 0)`; g.classList.add('active'); setTimeout(() => g.classList.remove('active'), 120); }
  }
  function rgbSplit() {
    introContent.classList.add('intro-rgb-split');
    setTimeout(() => introContent.classList.remove('intro-rgb-split'), 150);
  }
  function staticBurst() {
    const s = document.createElement('div'); s.className = 'intro-static-burst';
    introContent.appendChild(s); setTimeout(() => s.remove(), 150);
  }

  const bombShape = bombState ? (bombState.shape || 'unknown').toUpperCase() : 'UNKNOWN';

  introContent.innerHTML = `
    <div class="intro-vignette"></div>
    <div class="intro-hud" id="intro-hud">
      <div class="intro-hud-item intro-hud-tl">CAM-07 // REC <span class="intro-rec-dot">●</span>
        <span class="intro-hud-signal"><span class="intro-hud-bar" style="height:4px"></span><span class="intro-hud-bar" style="height:7px"></span><span class="intro-hud-bar" style="height:10px"></span><span class="intro-hud-bar off" style="height:13px"></span></span>
      </div>
      <div class="intro-hud-item intro-hud-tr" id="intro-timestamp"></div>
      <div class="intro-hud-item intro-hud-bl">FACILITY SECTOR 9 // AUTH LEVEL: OMEGA
        <span class="intro-hud-battery"><span class="intro-hud-battery-body"><span class="intro-hud-battery-fill" id="intro-batt" style="width:85%"></span></span><span class="intro-hud-battery-tip"></span></span>
      </div>
      <div class="intro-hud-item intro-hud-br" id="intro-framecnt">FRM: 00000</div>
    </div>
    <div class="intro-glitch" id="intro-glitch"></div>
    <div class="intro-radio" id="intro-radio1" style="position:absolute;top:32%;width:80%;text-align:center;"></div>
    <div class="intro-radio" id="intro-radio2" style="position:absolute;top:38%;width:70%;text-align:center;font-size:14px;color:rgba(88,166,255,0.7);text-shadow:0 0 8px rgba(88,166,255,0.3);"></div>
    <div class="intro-location" id="intro-loc" style="position:absolute;top:42%;"></div>
    <div class="intro-sublocation" id="intro-subloc" style="position:absolute;top:52%;"></div>
    <div class="intro-status" id="intro-status" style="position:absolute;top:58%;"></div>
    <div class="intro-timer-preview" id="intro-timer" style="position:absolute;top:40%;"></div>
    <div class="intro-approach" id="intro-approach" style="position:absolute;top:45%;"></div>
    <div class="intro-flash" id="intro-flash"></div>
  `;

  // Night vision tint
  introContent.classList.add('intro-nightvision');

  // Live HUD
  let frameNum = 0;
  const hudInterval = setInterval(() => {
    if (introOverlay.classList.contains('hidden')) { clearInterval(hudInterval); return; }
    const ts = document.getElementById('intro-timestamp');
    const fc = document.getElementById('intro-framecnt');
    const bt = document.getElementById('intro-batt');
    if (ts) { const now = new Date(); ts.textContent = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3,'0'); }
    if (fc) { frameNum++; fc.textContent = 'FRM: ' + String(frameNum).padStart(5,'0'); }
    if (bt) { const w = Math.max(10, 85 - frameNum * 0.5); bt.style.width = w + '%'; }
  }, 100);

  // 0.05-0.25s — garbled radio fragments (multiple voices)
  sched(() => {
    const g1 = document.createElement('div'); g1.className = 'intro-garble';
    g1.textContent = '> ...PERIMETER SECURE—'; g1.style.cssText = 'top:28%;left:12%;';
    introContent.appendChild(g1); setTimeout(() => g1.remove(), 250);
  }, 50);
  sched(() => {
    const g2 = document.createElement('div'); g2.className = 'intro-garble';
    g2.textContent = '> —COPY THAT, MOVING TO—'; g2.style.cssText = 'top:42%;left:58%;color:rgba(88,166,255,0.25);';
    introContent.appendChild(g2); setTimeout(() => g2.remove(), 200);
  }, 180);
  sched(() => {
    const g3 = document.createElement('div'); g3.className = 'intro-garble';
    g3.textContent = '> —NEGATIVE, HOLD POS—'; g3.style.cssText = 'top:35%;left:35%;';
    introContent.appendChild(g3); setTimeout(() => g3.remove(), 180);
  }, 280);

  // 0.35s — first radio transmission (command)
  sched(() => {
    AudioFX.radioClick();
    AudioFX.typingClicks(35);
    const r1 = document.getElementById('intro-radio1');
    if (r1) { r1.textContent = '> COMMAND: EXPLOSIVE DEVICE CONFIRMED AT TARGET LOCATION.'; r1.classList.add('typing'); r1.style.opacity = '1'; }
  }, 350);

  // 0.5s — glitch + RGB split
  sched(() => { glitch(); rgbSplit(); }, 550);

  // 0.9s — second radio voice (different color — blue, field unit)
  sched(() => {
    AudioFX.radioClick();
    const r2 = document.getElementById('intro-radio2');
    if (r2) { r2.textContent = '> FIELD: Copy. Alpha unit en route. ETA 30 seconds.'; r2.classList.add('typing'); r2.style.opacity = '1'; }
  }, 900);

  // 1.1s — glitch
  sched(glitch, 1100);

  // 1.5s — location SLAMS in
  sched(() => {
    AudioFX.impactBoom();
    document.querySelectorAll('#intro-radio1,#intro-radio2').forEach(el => { if (el) { el.style.transition = 'opacity 0.15s'; el.style.opacity = '0'; } });
    const loc = document.getElementById('intro-loc');
    if (loc) { loc.textContent = 'BUILDING 7'; loc.classList.add('slam'); }
    introContent.classList.add('intro-shake');
    setTimeout(() => introContent.classList.remove('intro-shake'), 400);
    rgbSplit();
  }, 1500);

  // 1.8s — sublocation
  sched(() => {
    const sub = document.getElementById('intro-subloc');
    if (sub) { sub.textContent = '— SUBLEVEL 3 — SECTOR NINE —'; sub.classList.add('show'); }
  }, 1800);

  // 2.1s — status lines (including device type)
  sched(() => {
    const status = document.getElementById('intro-status');
    if (!status) return;
    [
      { text: '■ THREAT LEVEL: CRITICAL', cls: 'critical', delay: 0 },
      { text: '■ CIVILIANS EVACUATED', cls: 'info', delay: 180 },
      { text: `■ DEVICE TYPE: ${bombShape}`, cls: 'info', delay: 360 },
      { text: '■ TIMER DETECTED — ACTIVE', cls: 'critical', delay: 540 },
    ].forEach(l => {
      const div = document.createElement('div');
      div.className = `intro-status-line ${l.cls}`;
      div.textContent = l.text;
      status.appendChild(div);
      setTimeout(() => div.classList.add('show'), l.delay);
    });
  }, 2100);

  // 2.8s — heartbeat
  sched(() => {
    introContent.classList.add('intro-heartbeat');
    AudioFX.heartbeat();
    setTimeout(() => AudioFX.heartbeat(), 800);
    setTimeout(() => AudioFX.heartbeat(), 1600);
  }, 2800);

  // 3.5s — timer preview
  sched(() => {
    introContent.classList.remove('intro-heartbeat');
    document.querySelectorAll('#intro-loc,#intro-subloc,#intro-status').forEach(el => {
      if (el) { el.style.transition = 'opacity 0.3s'; el.style.opacity = '0'; }
    });
    const timer = document.getElementById('intro-timer');
    if (timer) {
      let c = 0;
      const times = ['05:00','04:59','04:58','04:57','04:56'];
      timer.textContent = times[0]; timer.classList.add('show');
      const iv = setInterval(() => { c++; if (c < times.length) timer.textContent = times[c]; else clearInterval(iv); }, 100);
    }
  }, 3500);

  // 4.0s — SILENCE: cut everything, brief darkness
  sched(() => {
    const timer = document.getElementById('intro-timer');
    if (timer) timer.style.display = 'none';
    introContent.classList.add('intro-silence');
  }, 4000);

  // 4.3s — approach text (in the silence)
  sched(() => {
    introContent.classList.remove('intro-silence');
    const approach = document.getElementById('intro-approach');
    if (approach) { approach.textContent = 'APPROACH THE DEVICE'; approach.classList.add('show'); }
  }, 4300);

  // 4.7s — glitch
  sched(glitch, 4700);

  // 5.0s — metal clang + white flash
  sched(() => {
    AudioFX.metalClang();
    setTimeout(() => {
      AudioFX.revealWhoosh();
      const flash = document.getElementById('intro-flash');
      if (flash) flash.classList.add('fire');
    }, 150);
  }, 5000);

  sched(() => { clearInterval(hudInterval); introContent.classList.remove('intro-nightvision'); endIntro(); }, 5500);
  introTimeout = _t;
}

function playInstructorIntro() {
  AudioFX.tensionDrone(4);

  const _t = [];
  const sched = (fn, ms) => _t.push(setTimeout(() => { if (!introOverlay.classList.contains('hidden')) fn(); }, ms));

  introContent.innerHTML = `
    <div class="intro-vignette"></div>
    <div class="intro-transmission" id="intro-trans" style="position:absolute;top:34%;"></div>
    <div class="intro-surveillance" id="intro-surv" style="">
      <svg viewBox="0 0 80 60" width="80" height="60" fill="none" stroke="rgba(100,255,100,0.5)" stroke-width="1.5">
        <circle cx="40" cy="25" r="18"/><rect x="30" y="38" width="20" height="8" rx="2"/>
        <line x1="40" y1="8" x2="40" y2="2"/><line x1="40" y1="2" x2="50" y2="-2" stroke-width="1"/>
      </svg>
      <div class="intro-surveillance-label">DEVICE IMAGE // LOW-RES CAPTURE</div>
    </div>
    <div class="intro-classified" id="intro-class" style="position:absolute;top:45%;"></div>
    <div class="intro-file-list" id="intro-files" style="position:absolute;top:52%;left:50%;transform:translateX(-50%);"></div>
    <div class="intro-loading-bar" id="intro-loadbar" style="position:absolute;top:63%;left:50%;transform:translateX(-50%);">
      <div class="intro-loading-bar-fill" id="intro-loadfill"></div>
    </div>
    <div class="intro-loading-text" id="intro-loadtext" style="position:absolute;top:66%;">DECRYPTING MANUAL DATA...</div>
    <div class="intro-connection" id="intro-conn" style="position:absolute;top:72%;"></div>
    <div class="intro-flash" id="intro-flash"></div>
  `;

  // 0.0s — CRT power-on
  introContent.classList.add('intro-crt-poweron', 'intro-crt-curve');
  AudioFX.crtPowerOn();

  // 0.3s — transmission flicker
  sched(() => {
    AudioFX.radioClick();
    const trans = document.getElementById('intro-trans');
    if (trans) { trans.textContent = '▶ INCOMING TRANSMISSION'; trans.classList.add('flicker'); }
  }, 300);

  // 0.7s — surveillance photo flash
  sched(() => {
    const surv = document.getElementById('intro-surv');
    if (surv) surv.classList.add('show');
  }, 700);

  // 1.0s — classified stamp
  sched(() => {
    AudioFX.stampHit();
    const cls = document.getElementById('intro-class');
    if (cls) { cls.textContent = 'TOP SECRET // EYES ONLY'; cls.classList.add('stamp'); }
    const trans = document.getElementById('intro-trans');
    if (trans) { trans.style.transition = 'opacity 0.2s'; trans.style.opacity = '0.3'; }
    introContent.classList.add('intro-shake');
    setTimeout(() => introContent.classList.remove('intro-shake'), 300);
  }, 1000);

  // 1.2s — static burst between stamp and files
  sched(() => {
    const s = document.createElement('div'); s.className = 'intro-static-burst';
    introContent.appendChild(s); setTimeout(() => s.remove(), 150);
  }, 1200);

  // 1.5s — file decryption scroll with REAL module names + loading bar
  sched(() => {
    const bar = document.getElementById('intro-loadbar');
    const text = document.getElementById('intro-loadtext');
    if (bar) bar.classList.add('show');
    if (text) text.classList.add('show');
    AudioFX.typingClicks(20);

    const files = document.getElementById('intro-files');
    if (!files) return;
    // Use actual modules from the bomb if available
    const moduleNames = bombState ? bombState.modules.map(m => m.type) : ['wires','button','keypad'];
    const fileMap = {
      wires: 'wire_protocols_v3.enc', button: 'button_schema.dat', keypad: 'keypad_columns.bin',
      simon: 'simon_response_map.enc', morse: 'morse_frequencies.dat', memory: 'memory_matrix.enc',
      maze: 'maze_layouts_v2.bin', password: 'password_wordlist.enc', knob: 'knob_patterns.dat',
    };
    const fileNames = moduleNames.slice(0, 5).map(m => fileMap[m] || `${m}_data.enc`);
    fileNames.forEach((name, i) => {
      setTimeout(() => {
        if (introOverlay.classList.contains('hidden')) return;
        const line = document.createElement('div');
        line.className = 'intro-file-line';
        line.innerHTML = `${name} <span class="file-status working">DECRYPTING...</span>`;
        files.appendChild(line);
        setTimeout(() => line.classList.add('show'), 20);
        setTimeout(() => {
          const st = line.querySelector('.file-status');
          if (st) { st.textContent = 'DECRYPTED ✓'; st.className = 'file-status done'; }
        }, 220);
      }, i * 240);
    });
  }, 1500);

  // 2.8s — connection established with partner name
  sched(() => {
    const conn = document.getElementById('intro-conn');
    if (conn) {
      // Try to get partner's name from lobby state
      const partnerName = window._partnerName || 'EXECUTOR';
      conn.innerHTML = `LINK TO ${partnerName.toUpperCase()}: <span class="intro-redact">████████</span> ACTIVE`;
      conn.classList.add('show');
    }
    AudioFX.radioClick();
  }, 2800);

  // 3.3s — flash + end
  sched(() => {
    AudioFX.revealWhoosh();
    const flash = document.getElementById('intro-flash');
    if (flash) flash.classList.add('fire');
  }, 3300);

  sched(() => { introContent.classList.remove('intro-crt-poweron', 'intro-crt-curve'); endIntro(); }, 3700);
  introTimeout = _t;
}

function playSoloIntro() {
  AudioFX.tensionDrone(3.2);

  const _t = [];
  const sched = (fn, ms) => _t.push(setTimeout(() => { if (!introOverlay.classList.contains('hidden')) fn(); }, ms));

  const diffLabel = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' }[soloDifficulty] || 'STANDARD';

  introContent.innerHTML = `
    <div class="intro-vignette"></div>
    <div class="intro-hud">
      <div class="intro-hud-item intro-hud-tl">TRAINING-CAM-01 // REC <span class="intro-rec-dot">●</span></div>
      <div class="intro-hud-item intro-hud-tr" id="intro-timestamp-s"></div>
      <div class="intro-hud-item intro-hud-bl">TRAINING DIVISION // CLEARANCE: STANDARD</div>
    </div>
    <div class="intro-glitch" id="intro-glitch"></div>
    <div class="intro-solo-badge" id="intro-solo" style="position:absolute;top:34%;"></div>
    <div class="intro-location" id="intro-loc" style="position:absolute;top:42%;font-size:36px;"></div>
    <div class="intro-status" id="intro-status-solo" style="position:absolute;top:52%;"></div>
    <div class="intro-approach" id="intro-approach" style="position:absolute;top:45%;"></div>
    <div class="intro-flash" id="intro-flash"></div>
  `;

  // Live timestamp
  const hudIv = setInterval(() => {
    if (introOverlay.classList.contains('hidden')) { clearInterval(hudIv); return; }
    const ts = document.getElementById('intro-timestamp-s');
    if (ts) { const now = new Date(); ts.textContent = now.toTimeString().split(' ')[0]; }
  }, 200);

  // 0.3s — solo badge
  sched(() => {
    const badge = document.getElementById('intro-solo');
    if (badge) { badge.textContent = '◆ SOLO OPERATION — PRACTICE MODE ◆'; badge.classList.add('show'); }
  }, 300);

  // 0.5s — glitch
  sched(() => {
    const g = document.getElementById('intro-glitch');
    if (g) { g.classList.add('active'); setTimeout(() => g.classList.remove('active'), 100); }
  }, 500);

  // 0.8s — location slam
  sched(() => {
    AudioFX.impactBoom();
    const loc = document.getElementById('intro-loc');
    if (loc) { loc.textContent = 'TRAINING FACILITY'; loc.classList.add('slam'); }
    introContent.classList.add('intro-shake');
    setTimeout(() => introContent.classList.remove('intro-shake'), 300);
  }, 800);

  // 1.1s — difficulty + module count status
  sched(() => {
    const status = document.getElementById('intro-status-solo');
    if (status) {
      const modCount = bombState ? bombState.modules.length : '?';
      [
        { text: `■ DIFFICULTY: ${diffLabel}`, cls: 'critical', delay: 0 },
        { text: `■ ROUND ${soloRound} / ${SOLO_ROUNDS_PER_LEVEL[soloDifficulty] || 3}`, cls: 'ready', delay: 180 },
        { text: `■ MODULES: ${modCount}`, cls: 'info', delay: 360 },
      ].forEach(l => {
        const div = document.createElement('div');
        div.className = `intro-status-line ${l.cls}`;
        div.textContent = l.text;
        status.appendChild(div);
        setTimeout(() => div.classList.add('show'), l.delay);
      });
    }
  }, 1100);

  // 1.8s — fade + approach
  sched(() => {
    document.querySelectorAll('#intro-solo,#intro-loc,#intro-status-solo').forEach(el => {
      if (el) { el.style.transition = 'opacity 0.3s'; el.style.opacity = '0'; }
    });
    const approach = document.getElementById('intro-approach');
    if (approach) { approach.textContent = 'BEGIN EXERCISE'; approach.classList.add('show'); }
  }, 1800);

  // 2.5s — flash
  sched(() => {
    AudioFX.revealWhoosh();
    const flash = document.getElementById('intro-flash');
    if (flash) flash.classList.add('fire');
  }, 2500);

  sched(() => { clearInterval(hudIv); endIntro(); }, 2900);
  introTimeout = _t;
}

function showKeybindOverlay() {
  const existing = document.getElementById('keybind-overlay');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'keybind-overlay';
  el.className = 'keybind-overlay';
  el.innerHTML = `
    <div class="kb-row"><span class="kb-key">←</span> <span class="kb-key">→</span> Flip pages</div>
    <div class="kb-row"><span class="kb-key">↑</span> <span class="kb-key">↓</span> Scroll</div>
    <div class="kb-row"><span class="kb-key">G</span> Toggle magnifier</div>
    <div class="kb-row"><span class="kb-key">M</span> Mute / unmute mic</div>
    <div class="kb-row"><span class="kb-key">✏️</span> Draw on pages</div>
  `;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('kb-fade'), 3500);
  setTimeout(() => el.remove(), 5000);
}

// ══════════════════════ KEYBOARD PAGE NAVIGATION ══════════════════════
document.addEventListener('keydown', (e) => {
  // Only when manual is visible and chat input not focused
  if (!manualData) return;
  if (document.activeElement === document.getElementById('chat-input')) return;
  if (document.activeElement === document.getElementById('manual-search-input')) return;
  if (isFlipping) return;

  // Scroll up/down with W/S or ArrowUp/ArrowDown
  const isUp = e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W';
  const isDown = e.key === 'ArrowDown' || e.key === 's' || e.key === 'S';
  if (isUp || isDown) {
    const body = document.getElementById('manual-body');
    if (body) {
      e.preventDefault();
      body.scrollBy({ top: isDown ? 120 : -120, behavior: 'smooth' });
    }
    return;
  }

  const isLeft = e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A';
  const isRight = e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D';
  if (!isLeft && !isRight) return;

  // Build the list of visible tabs
  const tabBtns = document.querySelectorAll('.manual-tab');
  if (tabBtns.length === 0) return;
  const tabNames = Array.from(tabBtns).map(b => b.dataset.tab);
  const currentIdx = tabNames.indexOf(currentManualTab);
  if (currentIdx === -1) return;

  let newIdx;
  if (isRight) {
    newIdx = currentIdx + 1;
    if (newIdx >= tabNames.length) return; // already on last tab
  } else {
    newIdx = currentIdx - 1;
    if (newIdx < 0) return; // already on first tab
  }

  e.preventDefault();
  const prevTab = currentManualTab;
  currentManualTab = tabNames[newIdx];
  tabBtns.forEach(t => t.classList.toggle('active', t.dataset.tab === currentManualTab));
  flipManualPage(currentManualTab, prevTab);
  AudioFX.click();
});

// ══════════════════════ FAUX-3D: MOUSE TRACKING & EFFECTS ══════════════════════
const gameMain = document.querySelector('.game-main');
const gameContent = document.getElementById('game-content');
const lightingOverlay = document.getElementById('lighting-overlay');

if (gameMain) {
  gameMain.addEventListener('mousemove', (e) => {
    const rect = gameMain.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1; // -1 to 1
    const my = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    gameContent.style.setProperty('--mx', mx.toFixed(3));
    gameContent.style.setProperty('--my', my.toFixed(3));
    if (lightingOverlay) {
      lightingOverlay.style.setProperty('--mx', mx.toFixed(3));
      lightingOverlay.style.setProperty('--my', my.toFixed(3));
    }
    // Parallax layers
    const pFar = document.getElementById('parallax-far');
    const pMid = document.getElementById('parallax-mid');
    if (pFar) { pFar.style.transform = `translate(${mx * -8}px, ${my * -5}px)`; }
    if (pMid) { pMid.style.transform = `translate(${mx * -15}px, ${my * -10}px)`; }
    // Module shadow parallax
    document.querySelectorAll('.module-panel').forEach(p => {
      p.style.setProperty('--shadow-x', (mx * 4) + 'px');
      p.style.setProperty('--shadow-y', (my * 3) + 'px');
    });
    // Manual shadow parallax
    const manual = document.querySelector('.manual-container');
    if (manual) {
      manual.style.setProperty('--book-sx', (mx * 6) + 'px');
      manual.style.setProperty('--book-sy', (my * 4) + 'px');
    }
  });

  gameMain.addEventListener('mouseleave', () => {
    gameContent.style.setProperty('--mx', '0');
    gameContent.style.setProperty('--my', '0');
  });

  // Resize dust canvas
  window.addEventListener('resize', () => {
    if (dustCanvas && dustCtx && dustCanvas.parentElement) {
      dustCanvas.width = dustCanvas.parentElement.clientWidth;
      dustCanvas.height = dustCanvas.parentElement.clientHeight;
    }
  });
}

// Lighting flash helpers
function flashLighting(color, duration) {
  if (!lightingOverlay) return;
  lightingOverlay.classList.add('flash-' + color);
  setTimeout(() => lightingOverlay.classList.remove('flash-' + color), duration || 400);
}

// ── Magnifier Lens Crack System ──
let magCrackLevel = 0;

function addMagCrack(strikeNum) {
  const lens = document.getElementById('magnifier-lens');
  if (!lens) return;
  magCrackLevel = Math.min(strikeNum, 3);
  // Remove old crack SVG
  const old = lens.querySelector('.mag-cracks');
  if (old) old.remove();
  // Build crack SVG sized to lens
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 260 260');
  svg.setAttribute('class', 'mag-cracks');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:20;pointer-events:none;border-radius:50%;overflow:hidden;';

  const cx = 130, cy = 130;
  // Generate cracks radiating from a strike point
  const strikePoints = [
    { x: 90, y: 70 },   // strike 1 — upper left
    { x: 180, y: 170 },  // strike 2 — lower right
    { x: 130, y: 130 },  // strike 3 — dead center
  ];
  for (let s = 0; s < magCrackLevel; s++) {
    const sp = strikePoints[s];
    const numLines = 5 + s * 3; // more cracks per strike
    for (let i = 0; i < numLines; i++) {
      const angle = (i / numLines) * Math.PI * 2 + (s * 0.5);
      const len = 80 + Math.random() * 100;
      const ex = sp.x + Math.cos(angle) * len;
      const ey = sp.y + Math.sin(angle) * len;
      // Main crack — thick, bright white
      const mid1x = sp.x + Math.cos(angle) * len * 0.4 + (Math.random() - 0.5) * 20;
      const mid1y = sp.y + Math.sin(angle) * len * 0.4 + (Math.random() - 0.5) * 20;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${sp.x} ${sp.y} Q${mid1x} ${mid1y} ${ex} ${ey}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', `rgba(255,255,255,${0.5 + s * 0.15})`);
      path.setAttribute('stroke-width', `${2 + s * 1}`);
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('filter', 'drop-shadow(0 0 2px rgba(255,255,255,0.4))');
      svg.appendChild(path);
      // Branches — more of them, more visible
      if (Math.random() > 0.25) {
        const bAngle = angle + (Math.random() - 0.5) * 1.5;
        const bLen = 25 + Math.random() * 45;
        const bx = mid1x + Math.cos(bAngle) * bLen;
        const by = mid1y + Math.sin(bAngle) * bLen;
        const branch = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        branch.setAttribute('d', `M${mid1x} ${mid1y} L${bx} ${by}`);
        branch.setAttribute('fill', 'none');
        branch.setAttribute('stroke', `rgba(255,255,255,${0.3 + s * 0.1})`);
        branch.setAttribute('stroke-width', `${1.2 + s * 0.3}`);
        svg.appendChild(branch);
        // Sub-branch
        if (Math.random() > 0.5) {
          const sbAngle = bAngle + (Math.random() - 0.5) * 1;
          const sbLen = 10 + Math.random() * 20;
          const sbx = bx + Math.cos(sbAngle) * sbLen;
          const sby = by + Math.sin(sbAngle) * sbLen;
          const sub = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          sub.setAttribute('d', `M${bx} ${by} L${sbx} ${sby}`);
          sub.setAttribute('fill', 'none');
          sub.setAttribute('stroke', `rgba(255,255,255,${0.2 + s * 0.05})`);
          sub.setAttribute('stroke-width', '0.8');
          svg.appendChild(sub);
        }
      }
    }
    // Impact point — bigger, glowing
    const impact = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    impact.setAttribute('cx', sp.x);
    impact.setAttribute('cy', sp.y);
    impact.setAttribute('r', 6 + s * 3);
    impact.setAttribute('fill', `rgba(255,255,255,${0.08 + s * 0.04})`);
    impact.setAttribute('stroke', `rgba(255,255,255,${0.5 + s * 0.15})`);
    impact.setAttribute('stroke-width', '2');
    impact.setAttribute('filter', 'drop-shadow(0 0 3px rgba(255,255,255,0.3))');
    svg.appendChild(impact);
  }
  lens.appendChild(svg);
}

function shatterMagLens() {
  const mag = document.getElementById('magnifier');
  const lens = document.getElementById('magnifier-lens');
  if (!lens || !mag) return;
  // Max cracks
  addMagCrack(3);
  // Add shatter class for bright cracks
  lens.classList.add('mag-shattered');
  // Spawn tiny glass shards falling from magnifier position
  const rect = mag.getBoundingClientRect();
  const mcx = rect.left + rect.width / 2;
  const mcy = rect.top + rect.height / 2;
  for (let i = 0; i < 10; i++) {
    const shard = document.createElement('div');
    shard.className = 'lens-shard';
    const tx = (Math.random() - 0.5) * 150;
    const ty = 80 + Math.random() * 200;
    const rot = Math.random() * 180 - 90;
    const w = 10 + Math.random() * 30;
    const h = 8 + Math.random() * 20;
    shard.style.cssText = `
      left: ${mcx - w / 2}px; top: ${mcy - h / 2}px;
      width: ${w}px; height: ${h}px;
      --p1: ${Math.random()*30}%; --p2: ${Math.random()*20}%;
      --p3: ${70+Math.random()*30}%; --p4: ${Math.random()*40}%;
      --p5: ${30+Math.random()*40}%; --p6: ${80+Math.random()*20}%;
      --tx: ${tx}px; --ty: ${ty}px; --rot: ${rot}deg;
      --dur: ${1 + Math.random() * 1}s; --delay: ${Math.random() * 0.2}s;
    `;
    document.body.appendChild(shard);
    setTimeout(() => shard.remove(), 3000);
  }
}

function resetMagCracks() {
  const lens = document.getElementById('magnifier-lens');
  if (!lens) return;
  const old = lens.querySelector('.mag-cracks');
  if (old) old.remove();
  lens.classList.remove('mag-shattered');
  magCrackLevel = 0;
}

// ══════════════════════ PHASE 6: DUST PARTICLES ══════════════════════
const dustCanvas = document.getElementById('dust-canvas');
let dustCtx = null;
let dustParticles = [];
let dustAnimId = null;

function initDust() {
  if (!dustCanvas) return;
  const parent = dustCanvas.parentElement;
  if (!parent) return;
  dustCanvas.width = parent.clientWidth;
  dustCanvas.height = parent.clientHeight;
  dustCtx = dustCanvas.getContext('2d');
  dustParticles = [];
  for (let i = 0; i < 20; i++) {
    dustParticles.push({
      x: Math.random() * dustCanvas.width,
      y: Math.random() * dustCanvas.height,
      size: 1 + Math.random() * 2.5,
      speedX: (Math.random() - 0.5) * 0.3,
      speedY: -0.1 - Math.random() * 0.2,
      opacity: 0.05 + Math.random() * 0.12,
    });
  }
  if (!dustAnimId) dustAnimLoop();
}

function dustAnimLoop() {
  if (!dustCtx || !dustCanvas.width) return;
  dustCtx.clearRect(0, 0, dustCanvas.width, dustCanvas.height);
  dustParticles.forEach(p => {
    p.x += p.speedX;
    p.y += p.speedY;
    if (p.y < -10) { p.y = dustCanvas.height + 10; p.x = Math.random() * dustCanvas.width; }
    if (p.x < -10) p.x = dustCanvas.width + 10;
    if (p.x > dustCanvas.width + 10) p.x = -10;
    dustCtx.beginPath();
    dustCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    dustCtx.fillStyle = `rgba(200,200,180,${p.opacity})`;
    dustCtx.fill();
  });
  dustAnimId = requestAnimationFrame(dustAnimLoop);
}

function stopDust() {
  if (dustAnimId) { cancelAnimationFrame(dustAnimId); dustAnimId = null; }
}

// ══════════════════════ PHASE 6: FUSE SPARK PARTICLES ══════════════════════
let fuseSparkInterval = null;

function startFuseSparks() {
  stopFuseSparks();
  fuseSparkInterval = setInterval(() => {
    const fuseGlow = document.querySelector('.fuse-glow-outer');
    if (!fuseGlow) return;
    const rect = fuseGlow.getBoundingClientRect();
    const contentRect = document.getElementById('game-content')?.getBoundingClientRect();
    if (!contentRect) return;
    for (let i = 0; i < 3; i++) {
      const spark = document.createElement('div');
      spark.style.cssText = `
        position: fixed; z-index: 50; pointer-events: none;
        width: ${2 + Math.random() * 3}px; height: ${2 + Math.random() * 3}px;
        border-radius: 50%;
        background: hsl(${30 + Math.random() * 20}, 100%, ${60 + Math.random() * 30}%);
        box-shadow: 0 0 4px hsl(30, 100%, 60%);
        left: ${rect.left + rect.width / 2 + (Math.random() - 0.5) * 8}px;
        top: ${rect.top + rect.height / 2}px;
        transition: all ${0.4 + Math.random() * 0.6}s ease-out;
      `;
      document.body.appendChild(spark);
      requestAnimationFrame(() => {
        spark.style.left = (parseFloat(spark.style.left) + (Math.random() - 0.5) * 30) + 'px';
        spark.style.top = (parseFloat(spark.style.top) + 10 + Math.random() * 25) + 'px';
        spark.style.opacity = '0';
      });
      setTimeout(() => spark.remove(), 1000);
    }
  }, 200);
}

function stopFuseSparks() {
  if (fuseSparkInterval) { clearInterval(fuseSparkInterval); fuseSparkInterval = null; }
}

// ══════════════════════ PHASE 6: MODULE CONFETTI ══════════════════════
function spawnConfetti(moduleEl) {
  if (!moduleEl) return;
  const rect = moduleEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const colors = ['#3fb950', '#58a6ff', '#d29922', '#f0883e', '#bc8cff', '#e6edf3'];
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-particle';
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 100;
    p.style.cssText = `
      left: ${cx}px; top: ${cy}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      width: ${4 + Math.random() * 5}px; height: ${3 + Math.random() * 4}px;
      --tx: ${Math.cos(angle) * dist}px;
      --ty: ${Math.sin(angle) * dist - 40}px;
      --rot: ${Math.random() * 720 - 360}deg;
      --dur: ${0.6 + Math.random() * 0.6}s;
      border-radius: ${Math.random() > 0.5 ? '50%' : '1px'};
    `;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1500);
  }
}

// ══════════════════════ PHASE 6: SOLVE PULSE ══════════════════════
function triggerSolvePulse(moduleIndex) {
  const panel = document.querySelector(`.module-panel[data-module="${moduleIndex}"]`);
  if (panel) {
    panel.classList.add('solve-pulse');
    spawnConfetti(panel);
    setTimeout(() => panel.classList.remove('solve-pulse'), 600);
  }
}

// ══════════════════════ FAUX-3D: MODULE ENTRANCE ══════════════════════
function animateModuleEntrance() {
  const panels = document.querySelectorAll('.module-panel');
  panels.forEach((panel, i) => {
    panel.style.opacity = '0';
    panel.style.transform = 'translateZ(-20px) scale(0.92)';
    setTimeout(() => {
      panel.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
      panel.style.opacity = '1';
      panel.style.transform = 'translateZ(8px) scale(1)';
    }, 100 + i * 120);
  });
}

// ══════════════════════ TOPBAR EXIT MENU ══════════════════════
const topbarTitle = document.getElementById('topbar-title');
const topbarDropdown = document.getElementById('topbar-dropdown');

topbarTitle.addEventListener('click', (e) => {
  e.stopPropagation();
  topbarDropdown.classList.toggle('hidden');
  AudioFX.click();
});
document.addEventListener('click', () => topbarDropdown.classList.add('hidden'));

document.getElementById('btn-exit-game').addEventListener('click', () => {
  topbarDropdown.classList.add('hidden');
  exitSoloMode();
  reconnectData = null;
  roomCode = '';
  myRole = null;
  bombState = null;
  manualData = null;
  // Close magnifier if open
  if (magActive) { magActive = false; magnifier.classList.add('hidden'); }
  VoiceChat.hangup();
  socket.disconnect();
  socket.connect();
  showScreen('landing');
  nameInput.value = '';
  codeInput.value = '';
  updateLandingButtons();
  if (settings.musicVolume > 0) AudioFX.menuMusic();
});

// ══════════════════════ UNIFIED SPOTLIGHT GUIDE ══════════════════════
const EXECUTOR_GUIDE = [
  { target: '#game-timer', title: 'Timer', text: 'Your countdown. Hits zero = explosion. Strikes speed it up — watch for the orange "x1.5" or "x2".' },
  { target: '#game-strikes', title: 'Strikes', text: 'Wrong actions add strikes (✕). Too many = game over. Each strike also speeds up the timer and skips time.' },
  { target: '.module-panel', title: 'Bomb Modules', text: 'Each panel is a module to defuse. Red LED = unsolved, green = done. Click wires, buttons, keys, etc. to interact.' },
  { target: '.bomb-info-plate, .device-id-plate', title: 'Bomb Info', text: 'Serial number, shape, batteries, indicators, ports. READ THESE to your Instructor — they need them to find the right manual page.' },
  { target: '.chat-panel', title: 'Chat & Voice', text: 'Talk to your partner here. Use quick phrases for speed, or click 🎤 Call for voice chat. Hold Spacebar for push-to-talk.' },
  { target: '#magnifier', title: 'Magnifying Glass', text: 'Drag the magnifying glass to zoom into any area. Works on everything. Press Escape to dismiss.' },
];

const INSTRUCTOR_GUIDE = [
  { target: '#game-timer', title: 'Timer', text: 'Your partner\'s countdown. When it hits zero, the bomb explodes. Keep them focused!' },
  { target: '#game-strikes', title: 'Strikes', text: 'Wrong actions add strikes. Too many = game over. Strikes speed up the timer too.' },
  { target: '.manual-cover-header', title: 'The Defusal Manual', text: 'Your only resource. You can\'t see the bomb — your partner must describe it. You read the rules and tell them what to do.' },
  { target: '.manual-tabs', title: 'Manual Tabs', text: 'The manual is split into tabs. Start with <strong>Index</strong> to identify the bomb, then use module tabs for defusal rules. Use <strong>A/D</strong> or <strong>← →</strong> arrow keys to flip pages.' },
  { target: '.manual-body', switchTab: 'index', title: '① Index — Start Here', text: 'Ask your partner for the serial, shape, size, batteries, indicators, and ports. Match them in this table to find the <strong>Protocol</strong> (Alpha/Bravo/Charlie). Watch for decoys!' },
  { target: '.manual-body', switchTab: 'sequence', title: '② Sequence', text: 'Modules must be solved in a specific order. Check this BEFORE starting — wrong order = strike + timer speedup.' },
  { target: '.manual-body', switchTab: 'wires', title: '③ Module Rules', text: 'Each module has its own tab. For protocol-dependent modules (Wires, Button, Memory, Knob), find the right Protocol section. Others are universal.' },
  { target: '.manual-body', switchTab: 'appendix', title: '④ Appendix', text: 'NATO phonetic alphabet, indicator codes, port guide, strike effects. Quick reference when you need it.' },
  { target: '.manual-search', title: 'Search', text: 'Type to search across all tabs — serial numbers, module names, anything. Fastest lookup under pressure.' },
  { target: '.chat-panel', title: 'Chat & Voice', text: 'Communicate here. Use quick phrases for speed, or 🎤 Call for voice. Hold Spacebar for push-to-talk.' },
  { target: '.anno-wrapper', title: 'Annotations', text: 'Click ✏️ to draw on the manual — circle info, write notes, underline rules. Pick colors from the palette. Annotations persist per page.' },
  { target: '#magnifier', title: 'Magnifying Glass', text: 'Drag the magnifying glass to zoom into any area. Works on the manual, bomb, chat — everything. Press Escape to dismiss.' },
];

const SOLO_GUIDE = [
  { target: '#game-timer', title: 'Timer', text: 'Your countdown — hits zero = explosion. You get extra time in practice mode.' },
  { target: '#game-strikes', title: 'Strikes', text: 'Wrong actions add strikes (✕). Too many = game over.' },
  { target: '.solo-bomb-info', title: 'Bomb Info', text: 'Serial, shape, size, batteries, indicators, ports. Use these to look up the bomb in the Index tab.' },
  { target: '.module-panel', title: 'Modules', text: 'Defuse all modules to win. Red LED = unsolved, green = done. Click to interact.' },
  { target: '.manual-tabs', title: 'Manual', text: 'All defusal rules are here. Start with <strong>Index</strong> to find your bomb\'s Protocol. Use <strong>A/D</strong> or <strong>← →</strong> to flip pages.' },
  { target: '.manual-body', switchTab: 'index', title: '① Look Up the Bomb', text: 'Match serial, shape, batteries etc. to find the Protocol. Then use module tabs for the rules.' },
  { target: '.manual-body', switchTab: 'wires', title: '② Module Rules', text: 'Each module tab has defusal rules. Protocol-dependent modules need the matching Protocol section.' },
  { target: '.anno-wrapper', title: 'Annotations', text: 'Click ✏️ to draw on the manual. Circle things, write notes. Annotations persist per page.' },
  { target: '#magnifier', title: 'Magnifying Glass', text: 'Drag to zoom into any area. Press Escape to dismiss.' },
];

let _guideSteps = [];
let _guideIdx = 0;

function openSpotlightGuide(steps) {
  _guideSteps = steps;
  _guideIdx = 0;
  document.getElementById('guide-overlay').classList.remove('hidden');
  _renderSpotlight();
}

function _closeSpotlight() {
  document.getElementById('guide-overlay').classList.add('hidden');
  document.getElementById('guide-spotlight').style.opacity = '0';
}

function _renderSpotlight() {
  // Skip missing targets
  while (_guideIdx < _guideSteps.length && !document.querySelector(_guideSteps[_guideIdx].target)) _guideIdx++;
  if (_guideIdx >= _guideSteps.length) { _closeSpotlight(); return; }

  const step = _guideSteps[_guideIdx];
  const total = _guideSteps.length;

  // Switch manual tab if the step requests it
  if (step.switchTab) {
    const tabBtn = document.querySelector(`.manual-tab[data-tab="${step.switchTab}"]`);
    if (tabBtn) {
      currentManualTab = step.switchTab;
      document.querySelectorAll('.manual-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentManualTab));
      const body = document.getElementById('manual-body');
      if (body) body.innerHTML = renderManualTab(currentManualTab);
    }
  }

  const targetEl = document.querySelector(step.target);

  document.getElementById('guide-tooltip-step').textContent = `${_guideIdx + 1} / ${total}`;
  document.getElementById('guide-tooltip-title').textContent = step.title;
  document.getElementById('guide-tooltip-text').innerHTML = step.text;
  document.getElementById('guide-back').style.visibility = _guideIdx === 0 ? 'hidden' : 'visible';
  document.getElementById('guide-next').textContent = _guideIdx === total - 1 ? 'Got it!' : 'Next';

  const spotlight = document.getElementById('guide-spotlight');
  const tooltip = document.getElementById('guide-tooltip');

  if (targetEl) {
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => {
      const rect = targetEl.getBoundingClientRect();
      const pad = 8;
      spotlight.style.left = (rect.left - pad) + 'px';
      spotlight.style.top = (rect.top - pad) + 'px';
      spotlight.style.width = (rect.width + pad * 2) + 'px';
      spotlight.style.height = (rect.height + pad * 2) + 'px';
      spotlight.style.opacity = '1';

      let tTop = rect.bottom + 14;
      let tLeft = rect.left;
      if (tTop + 200 > window.innerHeight) tTop = rect.top - 14 - 200;
      if (tLeft + 320 > window.innerWidth) tLeft = window.innerWidth - 340;
      tTop = Math.max(10, Math.min(tTop, window.innerHeight - 220));
      tLeft = Math.max(10, tLeft);
      tooltip.style.top = tTop + 'px';
      tooltip.style.left = tLeft + 'px';
      tooltip.style.transform = '';
    }, 120);
  }
}

document.getElementById('guide-next').addEventListener('click', () => {
  AudioFX.click();
  if (_guideIdx < _guideSteps.length - 1) { _guideIdx++; _renderSpotlight(); }
  else _closeSpotlight();
});
document.getElementById('guide-back').addEventListener('click', () => {
  AudioFX.click();
  if (_guideIdx > 0) { _guideIdx--; _renderSpotlight(); }
});
document.getElementById('guide-skip').addEventListener('click', () => { AudioFX.click(); _closeSpotlight(); });
document.getElementById('guide-dimmer').addEventListener('click', _closeSpotlight);

// Topbar button → context-aware guide
document.getElementById('btn-guide-ingame').addEventListener('click', () => {
  if (isSoloMode) openSpotlightGuide(SOLO_GUIDE);
  else if (myRole === 'instructor') openSpotlightGuide(INSTRUCTOR_GUIDE);
  else openSpotlightGuide(EXECUTOR_GUIDE);
  AudioFX.click();
});

// Book guide merged into INSTRUCTOR_GUIDE — single unified guide per role

// ══════════════════════ INTERACTIVE TUTORIAL ══════════════════════
const TUTORIAL_STEPS = [
  {
    title: 'Welcome, Agent!',
    text: 'Talk 2 Defuse is a cooperative bomb defusal game for 2 players. One sees the bomb, the other has the manual. You must communicate to defuse it before time runs out!',
    tip: 'You can also play Solo Practice mode to learn on your own.',
    icon: `<svg width="80" height="80" viewBox="0 0 80 80" fill="none"><circle cx="40" cy="40" r="36" stroke="#d29922" stroke-width="3" fill="rgba(210,153,34,0.1)"/><circle cx="40" cy="40" r="20" stroke="#f0883e" stroke-width="2" fill="none"/><circle cx="40" cy="40" r="6" fill="#d29922"/><line x1="40" y1="20" x2="40" y2="34" stroke="#f0883e" stroke-width="3" stroke-linecap="round"/></svg>`,
  },
  {
    title: 'Two Roles',
    text: '<strong>Executor</strong> — Sees the bomb. Describes what\'s on it and performs actions (cutting wires, pressing buttons, etc.).<br><br><strong>Instructor</strong> — Has the defusal manual. Looks up the bomb in the index and reads the correct instructions.',
    tip: 'Neither player can see what the other sees. Communication is everything!',
    icon: `<svg width="80" height="80" viewBox="0 0 80 80" fill="none"><rect x="6" y="20" width="28" height="40" rx="4" stroke="#f0883e" stroke-width="2.5" fill="rgba(240,136,62,0.1)"/><text x="20" y="45" text-anchor="middle" font-size="20" fill="#f0883e">💣</text><rect x="46" y="20" width="28" height="40" rx="4" stroke="#58a6ff" stroke-width="2.5" fill="rgba(88,166,255,0.1)"/><text x="60" y="45" text-anchor="middle" font-size="20" fill="#58a6ff">📖</text><path d="M34 40 L46 40" stroke="#3fb950" stroke-width="2" stroke-dasharray="3 2"/></svg>`,
  },
  {
    title: 'Step 1: Describe the Bomb',
    text: 'The <strong>Executor</strong> starts by describing the bomb to the Instructor via chat (or voice):<br>• Serial number<br>• Shape &amp; size<br>• Number of batteries<br>• Indicator labels (which are lit)<br>• Port types',
    tip: 'The serial number is the most important — the Instructor needs it to find the bomb in the manual\'s Index tab.',
    icon: `<svg width="80" height="80" viewBox="0 0 80 80" fill="none"><rect x="10" y="15" width="60" height="50" rx="6" stroke="#3a3d42" stroke-width="2.5" fill="rgba(30,33,38,0.6)"/><text x="40" y="35" text-anchor="middle" font-size="9" fill="#58a6ff" font-family="monospace" font-weight="bold">SN: AB3CD7</text><rect x="18" y="42" width="12" height="8" rx="1" fill="rgba(210,153,34,0.3)" stroke="#d29922" stroke-width="1"/><rect x="34" y="42" width="12" height="8" rx="1" fill="rgba(210,153,34,0.3)" stroke="#d29922" stroke-width="1"/><circle cx="60" cy="46" r="4" fill="rgba(63,185,80,0.4)" stroke="#3fb950" stroke-width="1"/><text x="60" y="48" text-anchor="middle" font-size="5" fill="#3fb950">FRK</text></svg>`,
  },
  {
    title: 'Step 2: Find the Protocol',
    text: 'The <strong>Instructor</strong> opens the <em>Index</em> tab in the manual and matches the bomb\'s details. This reveals the <strong>Protocol</strong> (Alpha, Bravo, or Charlie) — which determines which defusal rules to follow.',
    tip: 'Beware of decoy entries! Cross-reference serial, shape, size, and batteries to find the correct match.',
    icon: `<svg width="80" height="80" viewBox="0 0 80 80" fill="none"><rect x="12" y="10" width="56" height="60" rx="4" fill="rgba(244,237,216,0.1)" stroke="#8b7d3c" stroke-width="2"/><line x1="20" y1="24" x2="60" y2="24" stroke="#6b5d44" stroke-width="1"/><line x1="20" y1="34" x2="60" y2="34" stroke="#6b5d44" stroke-width="1"/><line x1="20" y1="44" x2="60" y2="44" stroke="#6b5d44" stroke-width="1"/><rect x="22" y="50" width="18" height="10" rx="2" fill="rgba(220,53,69,0.2)" stroke="#dc3545" stroke-width="1.5"/><text x="31" y="58" text-anchor="middle" font-size="7" fill="#dc3545" font-weight="bold">ALPHA</text></svg>`,
  },
  {
    title: 'Step 3: Solve Modules',
    text: 'Each bomb has modules that must be defused. The Instructor reads the rules for each module (using the correct Protocol), and the Executor performs the action.<br><br><strong>9 module types:</strong> Wires, Button, Keypad, Simon Says, Morse Code, Memory, Maze, Password, Knob',
    tip: 'Modules may need to be solved in a specific order — check the Sequence tab!',
    icon: `<svg width="80" height="80" viewBox="0 0 80 80" fill="none"><rect x="4" y="4" width="34" height="34" rx="4" stroke="#dc3545" stroke-width="2" fill="rgba(220,53,69,0.08)"/><line x1="12" y1="14" x2="30" y2="14" stroke="#dc3545" stroke-width="2.5" stroke-linecap="round"/><line x1="12" y1="21" x2="30" y2="21" stroke="#0d6efd" stroke-width="2.5" stroke-linecap="round"/><line x1="12" y1="28" x2="30" y2="28" stroke="#ffc107" stroke-width="2.5" stroke-linecap="round"/><rect x="42" y="4" width="34" height="34" rx="4" stroke="#58a6ff" stroke-width="2" fill="rgba(88,166,255,0.08)"/><circle cx="59" cy="21" r="10" stroke="#58a6ff" stroke-width="2"/><rect x="4" y="42" width="34" height="34" rx="4" stroke="#bc8cff" stroke-width="2" fill="rgba(188,140,255,0.08)"/><rect x="12" y="50" width="10" height="10" rx="2" stroke="#bc8cff" stroke-width="1.5"/><rect x="24" y="50" width="10" height="10" rx="2" stroke="#bc8cff" stroke-width="1.5"/><rect x="42" y="42" width="34" height="34" rx="4" stroke="#3fb950" stroke-width="2" fill="rgba(63,185,80,0.08)"/><text x="59" y="63" text-anchor="middle" font-size="16" fill="#3fb950" font-weight="bold">3</text></svg>`,
  },
  {
    title: 'Strikes & Timer',
    text: 'Every wrong action causes a <strong>strike</strong>. Too many strikes and the bomb explodes!<br><br>Strikes also <strong>speed up the timer</strong> — first strike makes it 1.5x faster, second makes it 2x. Time is also skipped on each strike.',
    tip: 'Stay calm and double-check instructions before acting. One wrong move can cascade!',
    icon: `<svg width="80" height="80" viewBox="0 0 80 80" fill="none"><text x="15" y="35" font-size="24" fill="#f85149">✕</text><text x="35" y="35" font-size="24" fill="#f85149">✕</text><text x="55" y="35" font-size="16" fill="#3a3d42">○</text><circle cx="40" cy="58" r="14" stroke="#d29922" stroke-width="2.5" fill="none"/><path d="M40 48v10l6 4" stroke="#f0883e" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`,
  },
  {
    title: 'Communication Tips',
    text: 'Use the <strong>chat panel</strong> to talk, or click <strong>🎤 Call</strong> for voice chat.<br><br><strong>Quick phrases</strong> are above the chat input for common callouts like "Wait", "Go ahead", and "Read that again".<br><br>Use NATO phonetics for letters: Alpha, Bravo, Charlie...',
    tip: 'Voice chat supports Push-to-Talk (hold Spacebar) or Open Mic mode.',
    icon: `<svg width="80" height="80" viewBox="0 0 80 80" fill="none"><rect x="8" y="12" width="50" height="36" rx="6" stroke="#58a6ff" stroke-width="2" fill="rgba(88,166,255,0.08)"/><rect x="16" y="22" width="26" height="4" rx="2" fill="rgba(88,166,255,0.3)"/><rect x="16" y="30" width="18" height="4" rx="2" fill="rgba(88,166,255,0.2)"/><path d="M58 36 L68 42 L58 48" fill="rgba(88,166,255,0.15)" stroke="#58a6ff" stroke-width="1.5"/><circle cx="64" cy="62" r="8" stroke="#3fb950" stroke-width="2" fill="rgba(63,185,80,0.1)"/><line x1="64" y1="56" x2="64" y2="64" stroke="#3fb950" stroke-width="2.5" stroke-linecap="round"/><path d="M58 64 Q58 70 64 70 Q70 70 70 64" stroke="#3fb950" stroke-width="1.5" fill="none"/></svg>`,
  },
  {
    title: 'You\'re Ready!',
    text: 'Enter a callsign and click <strong>DEPLOY</strong> to create a room, then share the code with your partner. Or click <strong>Solo Practice</strong> to try it alone first.<br><br>Good luck, agent. The clock is ticking.',
    tip: '',
    icon: `<svg width="80" height="80" viewBox="0 0 80 80" fill="none"><circle cx="40" cy="40" r="30" stroke="#3fb950" stroke-width="3" fill="rgba(63,185,80,0.1)"/><path d="M26 40 L36 50 L56 30" stroke="#3fb950" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  },
];

let tutorialStep = 0;

function showTutorial() {
  tutorialStep = 0;
  document.getElementById('tutorial-overlay').classList.remove('hidden');
  renderTutorialStep();
}

function closeTutorial() {
  document.getElementById('tutorial-overlay').classList.add('hidden');
  localStorage.setItem('tutorialSeen', 'true');
}

function renderTutorialStep() {
  const step = TUTORIAL_STEPS[tutorialStep];
  const total = TUTORIAL_STEPS.length;
  document.getElementById('tutorial-step-counter').textContent = `Step ${tutorialStep + 1} of ${total}`;
  document.getElementById('tutorial-progress-bar').style.width = `${((tutorialStep + 1) / total) * 100}%`;
  document.getElementById('tutorial-illustration').innerHTML = step.icon;
  document.getElementById('tutorial-title').textContent = step.title;
  document.getElementById('tutorial-text').innerHTML = step.text;
  const tipEl = document.getElementById('tutorial-tip');
  if (step.tip) { tipEl.innerHTML = `<strong>Tip:</strong> ${step.tip}`; tipEl.style.display = ''; }
  else { tipEl.style.display = 'none'; }
  document.getElementById('tutorial-back').style.visibility = tutorialStep === 0 ? 'hidden' : 'visible';
  document.getElementById('tutorial-next').textContent = tutorialStep === total - 1 ? 'Start Playing!' : 'Next';
}

document.getElementById('tutorial-next').addEventListener('click', () => {
  if (tutorialStep < TUTORIAL_STEPS.length - 1) { tutorialStep++; renderTutorialStep(); AudioFX.click(); }
  else { closeTutorial(); AudioFX.click(); }
});
document.getElementById('tutorial-back').addEventListener('click', () => {
  if (tutorialStep > 0) { tutorialStep--; renderTutorialStep(); AudioFX.click(); }
});
document.getElementById('tutorial-skip').addEventListener('click', () => { closeTutorial(); AudioFX.click(); });
document.getElementById('btn-tutorial').addEventListener('click', () => { showTutorial(); AudioFX.click(); });

// Auto-show tutorial on first visit
if (!localStorage.getItem('tutorialSeen')) {
  setTimeout(showTutorial, 800);
}

// ══════════════════════ VOICE CHAT ══════════════════════
VoiceChat.init(socket);

document.getElementById('voice-mic-btn').addEventListener('click', () => {
  if (VoiceChat.hasStream) VoiceChat.hangup();
  else VoiceChat.startCall();
});
document.getElementById('voice-mute-btn').addEventListener('click', () => VoiceChat.toggleMute());
document.getElementById('voice-mode-btn').addEventListener('click', () => {
  VoiceChat.setMode(VoiceChat.mode === 'open-mic' ? 'push-to-talk' : 'open-mic');
});
// Push-to-talk: spacebar (only when chat input not focused)
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && document.activeElement !== document.getElementById('chat-input')) {
    VoiceChat.setPTT(true);
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') VoiceChat.setPTT(false);
});

// ══════════════════════ INIT ══════════════════════
applySettings();

// Show magnifier on landing page as a fun interactive element
setTimeout(() => {
  if (_currentScreen === 'landing' && !magActive) {
    toggleMagnifier();
  }
}, 1200);
