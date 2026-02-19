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

// Load settings immediately
loadSettings();

// ── DOM / Screens ───────────────────────────────────────────────
const screens = {
  landing: document.getElementById('screen-landing'),
  lobby: document.getElementById('screen-lobby'),
  briefing: document.getElementById('screen-briefing'),
  game: document.getElementById('screen-game'),
  result: document.getElementById('screen-result'),
};
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  // Stop menu music when leaving landing/lobby
  if (name !== 'landing' && name !== 'lobby') AudioFX.stopMenuMusic();
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
  socket.emit('create-room', { playerName: myName }, (res) => {
    if (res.code) { roomCode = res.code; enterLobby(); }
  });
});
btnJoin.addEventListener('click', () => {
  AudioFX.fuseLit();
  myName = nameInput.value.trim();
  const code = codeInput.value.trim();
  socket.emit('join-room', { roomCode: code, playerName: myName }, (res) => {
    if (res.error) {
      landingError.textContent = res.error;
      landingError.classList.remove('hidden');
      codeInput.classList.add('input-error');
      setTimeout(() => codeInput.classList.remove('input-error'), 2000);
    } else { roomCode = code; enterLobby(); }
  });
});
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btnJoin.disabled) btnJoin.click(); });
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btnCreate.disabled) btnCreate.click(); });

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

// Auto-load scoreboard on connect
function loadLandingScoreboard() {
  socket.emit('get-scoreboard', {}, renderScoreboard);
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

document.getElementById('btn-leave-lobby').addEventListener('click', () => {
  socket.disconnect();
  socket.connect();
  showScreen('landing');
  nameInput.value = '';
  codeInput.value = '';
  updateLandingButtons();
  if (settings.musicVolume > 0) AudioFX.menuMusic();
});

document.querySelectorAll('.btn-role').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-role').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    socket.emit('select-role', { role: btn.dataset.role });
    document.getElementById('btn-ready').disabled = false;
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
  document.querySelectorAll('.btn-diff').forEach(b => b.classList.toggle('active', b.dataset.diff === state.difficulty));
  const customPanel = document.getElementById('custom-settings');
  if (state.difficulty === 'custom') {
    customPanel.classList.remove('hidden');
    if (state.customSettings) applyCustomSettingsToUI(state.customSettings);
  } else {
    customPanel.classList.add('hidden');
  }
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
  document.querySelectorAll('.btn-role').forEach(b => b.classList.remove('selected'));
});

// ══════════════════════ BRIEFING ══════════════════════
socket.on('go-briefing', () => {
  showScreen('briefing');
  const sel = document.querySelector('.btn-role.selected');
  myRole = sel ? sel.dataset.role : 'executor';
  const rt = document.getElementById('briefing-role-text');
  if (myRole === 'instructor') {
    rt.innerHTML = 'You are the <strong style="color:var(--accent-blue)">Instructor</strong>. You have the bomb defusal manual but CANNOT see the bomb. Guide your partner through the chat.';
  } else {
    rt.innerHTML = 'You are the <strong style="color:var(--accent-orange)">Executor</strong>. You see the bomb but have NO manual. Describe everything to your partner and follow their instructions.';
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
socket.on('game-start', (data) => {
  showScreen('game');
  myRole = data.role;
  gameDifficulty = data.difficulty || 'easy';
  timerSpeed = 1;
  isHoldingButton = false;
  stripColor = null;
  simonFlashing = false;

  if (data.role === 'executor') {
    bombState = data.bomb;
    timerValue = data.bomb.timer;
    renderExecutorView();
  } else {
    manualData = data.manual;
    timerValue = data.timer;
    renderInstructorView();
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
}

function renderModule(mod, mi) {
  const sc = mod.solved ? ' solved' : '';
  const ledClass = mod.solved ? 'solved-led' : 'unsolved';
  const solvedBadge = mod.solved ? '<span class="module-solved-badge">&#10003; DEFUSED</span>' : '';
  const moduleNames = { wires: 'Wires', button: 'Button', keypad: 'Keypad', simon: 'Simon Says', morse: 'Morse Code' };
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
        html += `<div class="simon-light simon-${c}" data-module="${mi}" data-color="${c}" tabindex="0" role="button" aria-label="Simon ${c}"></div>`;
      });
      html += '</div>';
      html += `<button class="btn btn-tiny simon-replay-btn" data-module="${mi}">Replay Sequence</button></div>`;
      break;
    }
    case 'morse': {
      html += '<div class="morse-container">';
      html += '<div class="morse-lamp-assembly">';
      html += `<div class="morse-bulb-housing"><div class="morse-light" id="morse-light-${mi}"></div></div>`;
      html += '<div class="morse-lamp-label">Signal Lamp</div>';
      html += '</div>';
      html += '<div class="morse-info">Watch the flashing light. Describe the pattern to your partner.</div>';
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
        renderExecutorView();
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
        renderExecutorView();
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

function startMorseFlash(moduleIndex, word) {
  const lightEl = document.getElementById(`morse-light-${moduleIndex}`);
  if (!lightEl) return;
  const DOT = 200, DASH = 600, GAP = 200, LETTER_GAP = 600, WORD_GAP = 1400;
  const timings = [];
  for (let i = 0; i < word.length; i++) {
    const code = MORSE_CODE[word[i]];
    if (!code) continue;
    for (let j = 0; j < code.length; j++) {
      timings.push({ on: true, duration: code[j] === '.' ? DOT : DASH });
      if (j < code.length - 1) timings.push({ on: false, duration: GAP });
    }
    if (i < word.length - 1) timings.push({ on: false, duration: LETTER_GAP });
  }
  timings.push({ on: false, duration: WORD_GAP });
  let idx = 0;
  function step() {
    if (!document.getElementById(`morse-light-${moduleIndex}`)) return;
    const t = timings[idx % timings.length];
    lightEl.classList.toggle('on', t.on);
    idx++;
    setTimeout(step, t.duration);
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
  if (isHoldingButton && buttonHoldModule === moduleIndex) renderExecutorView();
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
  document.getElementById('game-bomb-type').textContent = 'Bomb: Identify from Index';
  document.getElementById('game-module-count').textContent = '';

  // Tab order: index, overview, procedures, sequence, module chapters (conditional), appendix
  const tabOrder = ['overview', 'procedures', 'sequence'];
  const moduleOrder = ['wires', 'button', 'keypad', 'simon', 'morse'];
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
  const tabLabels = { index: 'Index', overview: 'Overview', procedures: 'Procedures', sequence: 'Sequence', wires: 'Wires', button: 'Button', keypad: 'Keypad', simon: 'Simon', morse: 'Morse', appendix: 'Appendix' };
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

  document.querySelectorAll('.manual-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentManualTab = tab.dataset.tab;
      document.querySelectorAll('.manual-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === currentManualTab));
      document.getElementById('manual-body').innerHTML = renderManualTab(currentManualTab);
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
  const moduleOrder2 = ['wires', 'button', 'keypad', 'simon', 'morse'];
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
      html += `<tr><td><strong>${esc(entry.serial)}</strong></td><td><span class="${protoClass}">${entry.protocol}</span></td><td>${cap(entry.shape)}</td><td>${cap(entry.size)}</td><td class="small-text">${esc(entry.indicators)}</td><td>${entry.batteries}</td><td class="small-text">${esc(entry.ports)}</td><td class="small-text">${entry.modules.map(cap).join(', ')}</td></tr>`;
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
    appendix: `<svg viewBox="0 0 50 50" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="38" height="42" rx="3"/><line x1="12" y1="12" x2="38" y2="12"/><line x1="12" y1="20" x2="38" y2="20"/><line x1="12" y1="28" x2="38" y2="28"/><line x1="12" y1="36" x2="28" y2="36"/></svg>`,
  };
  const pageSubs = {
    overview: 'Device Schematic Reference',
    procedures: 'Standard Operating Procedures',
    sequence: 'Required Defusal Sequence',
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
  if (ch.morseAlphabet) {
    function morseVis(code) {
      let v = '';
      for (const ch of code) {
        if (ch === '.') v += '<span class="mc_dit"></span>';
        else if (ch === '-') v += '<span class="mc_dah"></span>';
      }
      return v;
    }
    html += '<h3 class="section-subtitle">Morse Alphabet</h3>';
    html += '<div class="morse-dict-grid">';
    const entries = Object.entries(ch.morseAlphabet);
    const half = Math.ceil(entries.length / 2);
    const col1 = entries.slice(0, half);
    const col2 = entries.slice(half);
    html += '<table class="morse-dict-table"><tbody>';
    for (let i = 0; i < half; i++) {
      const [l1, c1] = col1[i];
      html += `<tr><td class="mc_letter">${l1}</td><td class="mc_visual">${morseVis(c1)}</td><td class="mc_code">${c1}</td>`;
      if (col2[i]) {
        const [l2, c2] = col2[i];
        html += `<td class="mc_sep"></td><td class="mc_letter">${l2}</td><td class="mc_visual">${morseVis(c2)}</td><td class="mc_code">${c2}</td>`;
      } else {
        html += '<td></td><td></td><td></td><td></td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
  }
  if (ch.frequencyTable) {
    html += '<h3 class="section-subtitle">Frequency Table</h3>';
    html += '<table class="bomb-index-table"><thead><tr><th>Word</th><th>Frequency</th></tr></thead><tbody>';
    ch.frequencyTable.forEach(e => html += `<tr><td>${e.word}</td><td>${e.freq} MHz</td></tr>`);
    html += '</tbody></table>';
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
  if (data.bomb) { bombState = data.bomb; renderExecutorView(); }
  if (data.event === 'sequence-violation') {
    AudioFX.strike();
    showToast(data.message || 'Wrong sequence! Strike + time accelerated!');
    addSystemMessage(data.message || 'Sequence violation! Strike added and timer sped up.');
  }
  if (data.event === 'module-solved') {
    AudioFX.success();
    showToast(`${cap(data.moduleType)} module defused!`);
    addSystemMessage(`Module solved: ${cap(data.moduleType)}`);
  }
  if (data.event === 'simon-stage-complete') {
    showToast(`Simon Says: Stage ${data.stage} complete!`);
    setTimeout(() => {
      const mi = bombState.modules.findIndex(m => m.type === 'simon' && !m.solved);
      if (mi >= 0) socket.emit('simon-replay', { moduleIndex: mi });
    }, 800);
  }
  if (data.event === 'strike') {
    AudioFX.strike();
    showStrikeFlash();
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
    showScreen('result');
    icon.textContent = '💚'; title.textContent = 'DEFUSED!'; title.className = 'result-title win';
    AudioFX.defused();
  } else {
    // Explosion sequence: flash + shake + boom, then show result
    icon.textContent = '💥'; title.textContent = 'BOOM!'; title.className = 'result-title lose';
    AudioFX.explosion();

    // Show explosion overlay on game screen first
    explosionOverlay.classList.remove('hidden');
    // Force reflow to restart animations
    void explosionOverlay.offsetWidth;
    if (settings.screenShake) explosionOverlay.classList.add('active');

    // Transition to result screen after the flash
    setTimeout(() => {
      showScreen('result');
      resultContainer.classList.add('lose-bg');
    }, 800);

    // Clean up explosion overlay after drip animations fully fade out
    setTimeout(() => {
      explosionOverlay.classList.add('hidden');
      explosionOverlay.classList.remove('active');
    }, 6500);
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
});

document.getElementById('btn-play-again').addEventListener('click', () => {
  const payload = {};
  if (gameDifficulty === 'custom') { payload.difficulty = 'custom'; payload.customSettings = customSettings; }
  socket.emit('play-again', payload);
});
document.getElementById('btn-change-difficulty').addEventListener('click', () => socket.emit('play-again', {}));

socket.on('back-to-lobby', (state) => {
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

chatInput.addEventListener('input', () => {
  const rem = 200 - chatInput.value.length;
  chatCharCount.textContent = rem;
  chatCharCount.style.color = rem < 20 ? 'var(--accent-red)' : 'var(--text-muted)';
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

socket.on('chat-message', (msg) => { addChatMessage(msg); AudioFX.message(); });
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
  if (!confirmTooltip.classList.contains('hidden') && !confirmTooltip.contains(e.target) && !e.target.closest('.wire-row,.bomb-button-cap,.keypad-key,.morse-submit-btn')) {
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

// ══════════════════════ SCOREBOARD ══════════════════════
function renderScoreboard(data) {
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

// ══════════════════════ UTILITIES ══════════════════════
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ══════════════════════ INIT ══════════════════════
applySettings();
