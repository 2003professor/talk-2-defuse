const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ── Room state ──────────────────────────────────────────────────
const rooms = new Map();

// ── Score Persistence ───────────────────────────────────────────
const SCORES_DIR = path.join(__dirname, 'data');
const SCORES_FILE = path.join(SCORES_DIR, 'scores.json');

function loadScores() {
  try {
    return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf-8'));
  } catch { return []; }
}

function saveScore(record) {
  if (!fs.existsSync(SCORES_DIR)) fs.mkdirSync(SCORES_DIR, { recursive: true });
  const scores = loadScores();
  scores.push(record);
  fs.writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2));
}

function calculateScore(won, timeRemaining, strikes, difficulty, totalTime) {
  if (!won) return 0;
  if (difficulty === 'custom') return 0;
  const multiplier = { easy: 1, medium: 2, hard: 3 }[difficulty] || 1;
  let score = (1000 + timeRemaining * 10 - strikes * 200) * multiplier;
  if (timeRemaining > totalTime / 2) score += 500;
  return Math.max(0, Math.round(score));
}

const VALID_MODULES = ['wires', 'button', 'keypad', 'simon', 'morse'];

function validateCustomSettings(cs) {
  if (!cs || typeof cs !== 'object') return null;
  const timer = Math.max(60, Math.min(600, Math.round(Number(cs.timer) || 300)));
  const maxStrikes = Math.max(1, Math.min(5, Math.round(Number(cs.maxStrikes) || 3)));
  const wireCount = Math.max(3, Math.min(6, Math.round(Number(cs.wireCount) || 4)));
  let modules = Array.isArray(cs.modules) ? cs.modules.filter(m => VALID_MODULES.includes(m)) : ['wires'];
  if (!modules.includes('wires')) modules.unshift('wires');
  const sequenceEnforcement = !!cs.sequenceEnforcement;
  const strikeSpeedup = !!cs.strikeSpeedup;
  return { timer, maxStrikes, wireCount, modules, sequenceEnforcement, strikeSpeedup };
}

function getScoreboard() {
  const scores = loadScores();
  const wins = scores.filter(s => s.won).sort((a, b) => b.score - a.score).slice(0, 20);
  const recent = scores.slice(-10).reverse();
  const totalGames = scores.length;
  const totalWins = scores.filter(s => s.won).length;
  const winRate = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;
  return { wins, recent, stats: { totalGames, totalWins, winRate } };
}

function generateRoomCode() {
  let code;
  do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(code));
  return code;
}

// ── Constants ───────────────────────────────────────────────────
const WIRE_COLORS = ['red', 'blue', 'yellow', 'green', 'white', 'black', 'orange', 'purple'];
const BOMB_SHAPES = ['round', 'square', 'cylindrical', 'briefcase', 'barrel'];
const BOMB_SIZES = ['small', 'medium', 'large'];
const BUTTON_LABELS = ['PRESS', 'HOLD', 'ABORT', 'DETONATE'];
const BUTTON_ICONS = ['triangle', 'circle', 'star', 'lightning'];
const BUTTON_COLORS_LIST = ['red', 'blue', 'green', 'yellow', 'white', 'orange', 'purple'];
const STRIP_COLORS = ['red', 'blue', 'yellow', 'white'];
const INDICATOR_LABELS = ['FRK', 'CAR', 'SIG', 'NSA', 'MSA', 'TRN', 'CLR', 'IND', 'FRQ', 'SND', 'BOB'];
const PORT_TYPES = ['DVI-D', 'Parallel', 'PS/2', 'RJ-45', 'Serial', 'RCA'];
const SIMON_COLORS = ['red', 'blue', 'green', 'yellow'];
const PROTOCOLS = ['Alpha', 'Bravo', 'Charlie'];

const CASING_THEMES = ['gunmetal', 'military', 'hazard', 'stealth', 'rusted'];
const CASING_TEXTURES = ['brushed', 'diamond', 'carbon', 'corrugated'];
const STENCIL_POOL_STATIC = [
  'DANGER — HIGH EXPLOSIVE', 'HANDLE WITH CARE', 'THIS SIDE UP ↑',
  'NO SMOKING', '⚠ CAUTION', 'INSPECTED', 'DO NOT DROP',
  'FRAGILE', 'KEEP AWAY FROM HEAT',
];
function getStencilPool() {
  return [
    ...STENCIL_POOL_STATIC,
    `LOT #${1000 + Math.floor(Math.random() * 9000)}`,
    `MFG: ${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-20${24 + Math.floor(Math.random() * 3)}`,
    `NET WT: ${5 + Math.floor(Math.random() * 40)}kg`,
  ];
}
const MODEL_NUMERALS = ['II', 'III', 'IV', 'V'];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickN(arr, n) { return shuffle(arr).slice(0, n); }

// ── Bomb Generation ─────────────────────────────────────────────
function generateSerial() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  let serial = '';
  serial += pick(chars.split(''));
  serial += pick(chars.split(''));
  serial += pick(digits.split(''));
  serial += pick(chars.split(''));
  serial += pick(digits.split(''));
  serial += pick(digits.split(''));
  return serial;
}

function generateBomb(difficulty, customSettings) {
  const isCustom = difficulty === 'custom' && customSettings;
  const shape = pick(BOMB_SHAPES);
  const size = pick(BOMB_SIZES);
  const serial = generateSerial();
  const serialLastDigit = parseInt(serial[serial.length - 1]);
  const serialOdd = serialLastDigit % 2 === 1;
  const protocol = pick(PROTOCOLS);

  const numIndicators = isCustom ? (2 + Math.floor(Math.random() * 2))
    : difficulty === 'easy' ? (1 + Math.floor(Math.random() * 2))
    : difficulty === 'medium' ? (2 + Math.floor(Math.random() * 2))
    : (3 + Math.floor(Math.random() * 2));
  const indicatorLabels = pickN(INDICATOR_LABELS, numIndicators);
  const indicators = indicatorLabels.map(label => ({ label, lit: Math.random() > 0.5 }));

  const batteries = isCustom ? (1 + Math.floor(Math.random() * 3))
    : difficulty === 'easy' ? Math.floor(Math.random() * 3)
    : difficulty === 'medium' ? (1 + Math.floor(Math.random() * 3))
    : (2 + Math.floor(Math.random() * 3));

  const numPorts = isCustom ? (1 + Math.floor(Math.random() * 2))
    : difficulty === 'easy' ? Math.floor(Math.random() * 2)
    : difficulty === 'medium' ? (1 + Math.floor(Math.random() * 2))
    : (2 + Math.floor(Math.random() * 2));
  const ports = pickN(PORT_TYPES, numPorts);

  const hasVowelInSerial = /[AEIOU]/.test(serial);
  const hasLitFRK = indicators.some(i => i.label === 'FRK' && i.lit);
  const hasLitCAR = indicators.some(i => i.label === 'CAR' && i.lit);
  const hasLitBOB = indicators.some(i => i.label === 'BOB' && i.lit);

  const casingTheme = pick(CASING_THEMES);
  const casingTexture = pick(CASING_TEXTURES);
  const stencilLabels = pickN(getStencilPool(), 2 + Math.floor(Math.random() * 2)).map(text => ({
    text,
    rotation: -3 + Math.random() * 6,
    top: 20 + Math.random() * 40,
    left: 5 + Math.random() * 60,
  }));
  const modelNumber = 'MK-' + pick(MODEL_NUMERALS) + '-' + String(1000 + Math.floor(Math.random() * 9000));

  const bomb = {
    shape, size, serial, difficulty, protocol,
    indicators, batteries, ports,
    serialOdd, hasVowelInSerial,
    hasLitFRK, hasLitCAR, hasLitBOB,
    casingTheme, casingTexture, stencilLabels, modelNumber,
    modules: [],
    timer: isCustom ? customSettings.timer : difficulty === 'easy' ? 300 : difficulty === 'medium' ? 240 : 180,
    maxStrikes: isCustom ? customSettings.maxStrikes : 3,
    strikes: 0,
    sequenceEnforcement: isCustom ? customSettings.sequenceEnforcement : true,
    strikeSpeedup: isCustom ? customSettings.strikeSpeedup : true,
  };

  // ── Wire Module (all levels) ──────────────────────────────
  const wireCount = isCustom ? customSettings.wireCount
    : difficulty === 'easy' ? 3 + Math.floor(Math.random() * 2)
    : difficulty === 'medium' ? 4 + Math.floor(Math.random() * 2)
    : 5 + Math.floor(Math.random() * 2);
  const wireColors = [];
  for (let i = 0; i < wireCount; i++) wireColors.push(pick(WIRE_COLORS));

  const correctWire = solveWiresForProtocol(wireColors, wireCount, serialOdd, protocol);
  bomb.modules.push({
    type: 'wires', wireColors, wireCount,
    correctSequence: [correctWire], cutWires: [], solved: false,
  });

  // ── Button Module (medium + hard, or custom) ─────────────────────────
  if (isCustom ? customSettings.modules.includes('button') : (difficulty === 'medium' || difficulty === 'hard')) {
    const buttonColor = pick(BUTTON_COLORS_LIST);
    const buttonLabel = pick(BUTTON_LABELS);
    const buttonIcon = pick(BUTTON_ICONS);
    const stripColor = pick(STRIP_COLORS);
    const correctAction = solveButtonForProtocol(buttonColor, buttonLabel, batteries, hasLitCAR, hasLitFRK, hasLitBOB, protocol);
    bomb.modules.push({
      type: 'button', color: buttonColor, label: buttonLabel,
      icon: buttonIcon, stripColor, correctAction, solved: false,
    });
  }

  // ── Keypad Module (medium + hard, or custom) ─────────────────────────
  if (isCustom ? customSettings.modules.includes('keypad') : (difficulty === 'medium' || difficulty === 'hard')) {
    const columns = [
      ['★', '△', '♪', '☀', '♠', '♥', '☆'],
      ['♦', '★', '☆', '⚡', '♠', '♥', '□'],
      ['☀', '♪', '□', '♦', '△', '♣', '★'],
      ['♥', '☆', '⚡', '♣', '★', '♦', '○'],
      ['○', '☀', '♠', '□', '♪', '△', '♦'],
      ['⚡', '○', '♥', '☆', '♣', '★', '△'],
    ];
    const colIdx = Math.floor(Math.random() * columns.length);
    const column = columns[colIdx];
    const selected = shuffle(column).slice(0, 4);
    const correctOrder = selected.slice().sort((a, b) => column.indexOf(a) - column.indexOf(b));
    bomb.modules.push({
      type: 'keypad', symbols: shuffle(selected),
      correctOrder, pressedSymbols: [], columnIndex: colIdx, solved: false,
    });
  }

  // ── Simon Says Module (hard only, or custom) ─────────────────────────
  if (isCustom ? customSettings.modules.includes('simon') : difficulty === 'hard') {
    const sequenceLength = 3 + Math.floor(Math.random() * 2);
    const sequence = [];
    for (let i = 0; i < sequenceLength; i++) sequence.push(pick(SIMON_COLORS));
    const responseMap = buildSimonMap(hasVowelInSerial);
    bomb.modules.push({
      type: 'simon', sequence, responseMap,
      currentStep: 0, playerInput: [], solved: false,
    });
  }

  // ── Morse Code Module (hard only, or custom) ─────────────────────────
  if (isCustom ? customSettings.modules.includes('morse') : difficulty === 'hard') {
    const morseWords = [
      { word: 'SHELL', freq: '3.505' }, { word: 'HALLS', freq: '3.515' },
      { word: 'SLICK', freq: '3.522' }, { word: 'TRICK', freq: '3.532' },
      { word: 'BOXES', freq: '3.535' }, { word: 'LEAKS', freq: '3.542' },
      { word: 'STROBE', freq: '3.545' }, { word: 'BISTRO', freq: '3.552' },
      { word: 'FLICK', freq: '3.555' }, { word: 'BOMBS', freq: '3.565' },
      { word: 'BREAK', freq: '3.572' }, { word: 'BRICK', freq: '3.575' },
      { word: 'STEAK', freq: '3.582' }, { word: 'STING', freq: '3.592' },
      { word: 'VECTOR', freq: '3.595' }, { word: 'BEATS', freq: '3.600' },
    ];
    const chosen = pick(morseWords);
    bomb.modules.push({ type: 'morse', word: chosen.word, correctFreq: chosen.freq, solved: false });
  }

  // Randomize module order
  bomb.modules = shuffle(bomb.modules);

  // Determine solve order
  if (bomb.modules.length > 1) {
    bomb.solveOrder = determineSolveOrder(bomb);
  } else {
    bomb.solveOrder = [0];
  }
  bomb.nextSolveIndex = 0; // tracks which position in solveOrder should be solved next

  bomb.manual = generateManual(bomb);
  return bomb;
}

// ── Solve Order Determination ─────────────────────────────────
function determineSolveOrder(bomb) {
  const batteryGroup = bomb.batteries <= 1 ? 0 : bomb.batteries <= 3 ? 1 : 2;
  const isOdd = bomb.serialOdd;
  const orderTable = [
    [['wires','keypad','button','simon','morse'], ['morse','simon','wires','button','keypad']],
    [['button','wires','morse','keypad','simon'], ['keypad','morse','simon','wires','button']],
    [['simon','button','keypad','morse','wires'], ['wires','morse','button','simon','keypad']],
  ];
  const fullOrder = orderTable[batteryGroup][isOdd ? 1 : 0];
  const presentTypes = bomb.modules.map(m => m.type);
  const filteredOrder = fullOrder.filter(t => presentTypes.includes(t));
  return filteredOrder.map(t => bomb.modules.findIndex(m => m.type === t));
}

// ══════════════════════ PROTOCOL-DEPENDENT SOLVERS ══════════════════════

function solveWiresForProtocol(wireColors, wireCount, serialOdd, protocol) {
  const count = (c) => wireColors.filter(w => w === c).length;
  const last = wireColors[wireCount - 1];
  const first = wireColors[0];

  if (protocol === 'Alpha') {
    if (wireCount === 3) {
      if (count('red') === 0) return 2;
      if (last === 'white') return wireCount;
      if (count('orange') > 1) return 1;
      if (count('blue') > 1) { let idx = -1; wireColors.forEach((c, i) => { if (c === 'blue') idx = i; }); return idx + 1; }
      return wireCount;
    }
    if (wireCount === 4) {
      if (count('red') > 1 && serialOdd) return 2;
      if (last === 'yellow' && count('red') === 0) return 1;
      if (first === 'purple') return wireCount;
      if (count('blue') === 1) return 1;
      if (count('yellow') > 1) return wireCount;
      return 2;
    }
    if (wireCount === 5) {
      if (last === 'black' && serialOdd) return 4;
      if (count('red') === 1 && count('yellow') > 1) return 1;
      if (count('orange') >= 1 && count('purple') >= 1) return 3;
      if (count('black') === 0) return 2;
      return 1;
    }
    // 6 wires
    if (count('yellow') === 0 && serialOdd) return 3;
    if (count('purple') > 1) return 5;
    if (count('yellow') === 1 && count('white') > 1) return 4;
    if (count('red') === 0) return wireCount;
    return 4;
  }

  if (protocol === 'Bravo') {
    if (wireCount === 3) {
      if (first === 'red') return wireCount;
      if (count('white') > 1) return 1;
      if (last === 'purple') return 3;
      if (last === 'blue') return 2;
      return 1;
    }
    if (wireCount === 4) {
      if (count('yellow') === 0 && serialOdd) return 1;
      if (first === 'orange') return 2;
      if (count('red') === 1 && last !== 'red') return 1;
      if (count('blue') > 2) return wireCount;
      if (count('green') > 0) return 2;
      return wireCount;
    }
    if (wireCount === 5) {
      if (first === 'white' && serialOdd) return 3;
      if (count('red') === 0 && count('yellow') === 1) return 5;
      if (count('purple') >= 2) return 1;
      if (count('black') > 1) return 2;
      if (count('blue') === 0) return 4;
      return 5;
    }
    // 6 wires
    if (count('red') === 1 && serialOdd) return 2;
    if (count('orange') > 1 && count('purple') === 0) return 6;
    if (count('white') > 2) return 5;
    if (count('green') === 0) return 4;
    if (count('black') > 1) return 1;
    return 3;
  }

  // Charlie
  if (wireCount === 3) {
    if (count('blue') === 0) return wireCount;
    if (first === 'white') return 1;
    if (count('red') > 1) return 2;
    if (count('orange') === 0 && first === 'purple') return 2;
    return 2;
  }
  if (wireCount === 4) {
    if (count('green') >= 1 && serialOdd) return wireCount;
    if (last === 'blue' && count('yellow') === 0) return 2;
    if (count('orange') >= 1 && last === 'purple') return 3;
    if (count('red') === 1) return 3;
    if (count('white') > 1) return 1;
    return 2;
  }
  if (wireCount === 5) {
    if (last === 'yellow' && serialOdd) return 1;
    if (count('white') === 0 && count('red') > 1) return 3;
    if (count('orange') === 0 && first === 'purple') return 2;
    if (count('green') === 1) return 5;
    if (count('black') > 1) return 2;
    return 4;
  }
  // 6 wires
  if (count('black') > 1 && serialOdd) return 5;
  if (count('purple') >= 2 && count('orange') === 0) return 1;
  if (count('green') === 0) return 3;
  if (count('red') > 2) return 6;
  if (count('yellow') === 1) return 4;
  return 2;
}

function solveButtonForProtocol(color, label, batteries, hasLitCAR, hasLitFRK, hasLitBOB, protocol) {
  const hasLitSIG = hasLitFRK; // reuse param slot — caller passes indicators
  if (protocol === 'Alpha') {
    if (color === 'blue' && label === 'ABORT') return { type: 'hold', releaseColor: 'blue' };
    if (batteries > 1 && label === 'DETONATE') return { type: 'press' };
    if (color === 'orange' && batteries > 1) return { type: 'hold', releaseColor: 'yellow' };
    if (color === 'white' && hasLitCAR) return { type: 'hold', releaseColor: 'white' };
    if (batteries > 2 && hasLitFRK) return { type: 'press' };
    if (color === 'yellow') return { type: 'hold', releaseColor: 'yellow' };
    if (color === 'red' && label === 'HOLD') return { type: 'press' };
    return { type: 'hold', releaseColor: 'red' };
  }
  if (protocol === 'Bravo') {
    if (color === 'red' && label === 'DETONATE') return { type: 'press' };
    if (color === 'purple' && hasLitFRK) return { type: 'press' };
    if (batteries > 2 && hasLitBOB) return { type: 'press' };
    if (color === 'green' && label === 'HOLD') return { type: 'hold', releaseColor: 'blue' };
    if (color === 'blue' && hasLitFRK) return { type: 'hold', releaseColor: 'yellow' };
    if (batteries > 1 && label === 'ABORT') return { type: 'press' };
    if (color === 'orange' && label === 'PRESS') return { type: 'hold', releaseColor: 'red' };
    if (color === 'yellow' && label === 'PRESS') return { type: 'hold', releaseColor: 'white' };
    return { type: 'press' };
  }
  // Charlie
  if (color === 'yellow' && label === 'ABORT') return { type: 'hold', releaseColor: 'yellow' };
  if (color === 'orange' && label === 'DETONATE') return { type: 'press' };
  if (color === 'white' && batteries > 2) return { type: 'press' };
  if (color === 'red' && hasLitCAR) return { type: 'press' };
  if (color === 'purple' && label === 'HOLD') return { type: 'hold', releaseColor: 'blue' };
  if (color === 'green' && label === 'DETONATE') return { type: 'hold', releaseColor: 'red' };
  if (color === 'blue' && batteries > 1) return { type: 'hold', releaseColor: 'blue' };
  if (label === 'HOLD' && hasLitFRK) return { type: 'press' };
  return { type: 'hold', releaseColor: 'white' };
}

function buildSimonMap(hasVowel) {
  if (hasVowel) {
    return [
      { red: 'blue', blue: 'red', green: 'yellow', yellow: 'green' },
      { red: 'yellow', blue: 'green', green: 'blue', yellow: 'red' },
      { red: 'green', blue: 'red', green: 'yellow', yellow: 'blue' },
    ];
  }
  return [
    { red: 'blue', blue: 'yellow', green: 'green', yellow: 'red' },
    { red: 'red', blue: 'blue', green: 'yellow', yellow: 'green' },
    { red: 'yellow', blue: 'green', green: 'blue', yellow: 'red' },
  ];
}

// ══════════════════════ MANUAL GENERATION ══════════════════════

function generateManual(bomb) {
  const manual = { bombIndex: [], chapters: {} };

  // Real bomb entry
  manual.bombIndex.push({
    serial: bomb.serial, shape: bomb.shape, size: bomb.size,
    protocol: bomb.protocol,
    indicators: bomb.indicators.map(i => `${i.label}${i.lit ? '*' : ''}`).join(', '),
    batteries: bomb.batteries,
    ports: bomb.ports.join(', ') || 'None',
    modules: bomb.modules.map(m => m.type),
  });

  // Same-serial decoys — share the real serial but differ in other fields
  // Forces instructor to cross-reference shape, size, batteries, indicators, etc.
  const otherProtocols = PROTOCOLS.filter(p => p !== bomb.protocol);
  const sameSerialCount = 2 + Math.floor(Math.random() * 2); // 2-3 same-serial decoys
  for (let i = 0; i < sameSerialCount; i++) {
    // Pick a different shape or size so there's always a distinguishing field
    let dShape = pick(BOMB_SHAPES);
    let dSize = pick(BOMB_SIZES);
    // Guarantee at least one field differs from the real bomb
    if (dShape === bomb.shape && dSize === bomb.size) {
      dShape = pick(BOMB_SHAPES.filter(s => s !== bomb.shape));
    }
    const dNumInd = 1 + Math.floor(Math.random() * 4);
    const dInds = pickN(INDICATOR_LABELS, dNumInd).map(l => `${l}${Math.random() > 0.5 ? '*' : ''}`);
    const dModCount = 1 + Math.floor(Math.random() * 5);
    manual.bombIndex.push({
      serial: bomb.serial, shape: dShape, size: dSize,
      protocol: otherProtocols[i % otherProtocols.length],
      indicators: dInds.join(', '),
      batteries: Math.floor(Math.random() * 5),
      ports: pickN(PORT_TYPES, Math.floor(Math.random() * 3)).join(', ') || 'None',
      modules: shuffle(['wires', 'button', 'keypad', 'simon', 'morse']).slice(0, dModCount),
    });
  }

  // Regular decoys (unique serials)
  const decoyCount = 5 + Math.floor(Math.random() * 3);
  for (let i = 0; i < decoyCount; i++) {
    const dSerial = generateSerial();
    const dNumInd = 1 + Math.floor(Math.random() * 4);
    const dInds = pickN(INDICATOR_LABELS, dNumInd).map(l => `${l}${Math.random() > 0.5 ? '*' : ''}`);
    const dModCount = 1 + Math.floor(Math.random() * 5);
    manual.bombIndex.push({
      serial: dSerial, shape: pick(BOMB_SHAPES), size: pick(BOMB_SIZES),
      protocol: pick(PROTOCOLS),
      indicators: dInds.join(', '),
      batteries: Math.floor(Math.random() * 5),
      ports: pickN(PORT_TYPES, Math.floor(Math.random() * 3)).join(', ') || 'None',
      modules: shuffle(['wires', 'button', 'keypad', 'simon', 'morse']).slice(0, dModCount),
    });
  }
  manual.bombIndex = shuffle(manual.bombIndex);

  // ── Overview Chapter (always present) ──────────────────────
  manual.chapters.overview = {
    title: 'Technical Overview',
    description: 'Field assessment blueprint of standard ordnance device. Reference only — do not attempt disassembly without protocol authorization.',
    lore: 'Each device is assembled from modular components housed in a hardened casing. The detonator core is connected via the timer mechanism to one or more defusal modules. Successful neutralization requires disarming ALL modules before the countdown expires. Strikes from incorrect actions accelerate the timer and may trigger early detonation.',
  };

  // ── Procedures Chapter (always present) ──────────────────────
  manual.chapters.procedures = {
    title: 'Field Procedures',
    sections: [
      {
        subtitle: 'Section 1 — Initial Assessment',
        items: [
          'Identify bomb shape (round, square, cylindrical, briefcase, or barrel) and report to instructor.',
          'Read serial number aloud using NATO phonetic alphabet (see Appendix).',
          'Count batteries and report total.',
          'Identify all indicator labels and whether each is LIT or UNLIT.',
          'Identify port types present on the device.',
          'Cross-reference Index tab to determine Protocol designation.',
        ],
      },
      {
        subtitle: 'Section 2 — Module Priority',
        items: [
          'Modules MUST be solved in the order specified by the Sequence tab.',
          'Locked modules cannot be interacted with until the previous module is solved.',
          'Determine the sequence using battery count and serial last digit (see Sequence tab).',
          'Button: Requires coordination on hold timing — clear comms essential.',
          'Simon Says: Multi-stage memory — mapping changes with strikes.',
          'Morse Code: Begin observation early, even while locked — decode the pattern ahead of time.',
        ],
      },
      {
        subtitle: 'Section 3 — Communication Protocol',
        natoRef: true,
        items: [
          'Use NATO phonetic alphabet for serial numbers and ambiguous letters.',
          'Confirm colors by repeating: "Color confirmed: [COLOR]."',
          'Use "Read back" after critical instructions to verify understanding.',
          'Say "STRIKE" loudly if a mistake occurs — instructor must re-check mappings.',
        ],
      },
      {
        subtitle: 'Section 4 — Strike Response',
        strikeTable: true,
        items: [
          'After any strike, pause and re-verify the current protocol.',
          'Simon Says mappings CHANGE with each strike — re-check the table.',
          'Stay calm. Rushing causes more strikes than careful re-assessment.',
        ],
      },
    ],
  };

  // ── Sequence Chapter (always present) ──────────────────────
  manual.chapters.sequence = {
    title: 'Module Sequence',
    description: 'Modules should be solved in a specific order. Solving a module OUT OF SEQUENCE results in a STRIKE and the timer speeds up (x1.5). Determine the correct sequence from the table below and relay it to the executor.',
    table: {
      headers: ['Batteries', 'Serial Last Digit', 'Solve Order'],
      rows: [
        ['0\u20131', 'Even', 'Wires \u2192 Keypad \u2192 Button \u2192 Simon \u2192 Morse'],
        ['0\u20131', 'Odd', 'Morse \u2192 Simon \u2192 Wires \u2192 Button \u2192 Keypad'],
        ['2\u20133', 'Even', 'Button \u2192 Wires \u2192 Morse \u2192 Keypad \u2192 Simon'],
        ['2\u20133', 'Odd', 'Keypad \u2192 Morse \u2192 Simon \u2192 Wires \u2192 Button'],
        ['4+', 'Even', 'Simon \u2192 Button \u2192 Keypad \u2192 Morse \u2192 Wires'],
        ['4+', 'Odd', 'Wires \u2192 Morse \u2192 Button \u2192 Simon \u2192 Keypad'],
      ],
    },
    note: 'Skip module types not present on the bomb. Example: if the bomb has only Wires, Button, Keypad \u2014 use only those from the sequence above, in order.',
  };

  // ── Wire Chapter (protocol-dependent) ──────────────────────
  manual.chapters.wires = {
    title: 'Wire Defusal',
    description: 'CRITICAL: First identify the bomb\'s Protocol from the Index tab. Then find the matching Protocol section below and use the rules for the correct wire count. Use the FIRST rule that applies.',
    protocols: {
      Alpha: {
        sections: [
          { subtitle: '3 Wires', rules: [
            'IF there are no red wires \u2192 cut the SECOND wire.',
            'IF the last wire is white \u2192 cut the LAST wire.',
            'IF there is more than one orange wire \u2192 cut the FIRST wire.',
            'IF there is more than one blue wire \u2192 cut the LAST BLUE wire.',
            'OTHERWISE \u2192 cut the LAST wire.',
          ]},
          { subtitle: '4 Wires', rules: [
            'IF there is more than one red wire AND the serial number\'s last digit is ODD \u2192 cut the SECOND wire.',
            'IF the last wire is yellow AND there are no red wires \u2192 cut the FIRST wire.',
            'IF the first wire is purple \u2192 cut the LAST wire.',
            'IF there is exactly one blue wire \u2192 cut the FIRST wire.',
            'IF there is more than one yellow wire \u2192 cut the LAST wire.',
            'OTHERWISE \u2192 cut the SECOND wire.',
          ]},
          { subtitle: '5 Wires', rules: [
            'IF the last wire is black AND the serial number\'s last digit is ODD \u2192 cut the FOURTH wire.',
            'IF there is exactly one red wire AND more than one yellow wire \u2192 cut the FIRST wire.',
            'IF there is any orange wire AND any purple wire \u2192 cut the THIRD wire.',
            'IF there are no black wires \u2192 cut the SECOND wire.',
            'OTHERWISE \u2192 cut the FIRST wire.',
          ]},
          { subtitle: '6 Wires', rules: [
            'IF there are no yellow wires AND the serial number\'s last digit is ODD \u2192 cut the THIRD wire.',
            'IF there is more than one purple wire \u2192 cut the FIFTH wire.',
            'IF there is exactly one yellow wire AND more than one white wire \u2192 cut the FOURTH wire.',
            'IF there are no red wires \u2192 cut the LAST wire.',
            'OTHERWISE \u2192 cut the FOURTH wire.',
          ]},
        ],
      },
      Bravo: {
        sections: [
          { subtitle: '3 Wires', rules: [
            'IF the first wire is red \u2192 cut the LAST wire.',
            'IF there is more than one white wire \u2192 cut the FIRST wire.',
            'IF the last wire is purple \u2192 cut the THIRD wire.',
            'IF the last wire is blue \u2192 cut the SECOND wire.',
            'OTHERWISE \u2192 cut the FIRST wire.',
          ]},
          { subtitle: '4 Wires', rules: [
            'IF there are no yellow wires AND the serial number\'s last digit is ODD \u2192 cut the FIRST wire.',
            'IF the first wire is orange \u2192 cut the SECOND wire.',
            'IF there is exactly one red wire AND the last wire is not red \u2192 cut the FIRST wire.',
            'IF there are more than two blue wires \u2192 cut the LAST wire.',
            'IF there is any green wire \u2192 cut the SECOND wire.',
            'OTHERWISE \u2192 cut the LAST wire.',
          ]},
          { subtitle: '5 Wires', rules: [
            'IF the first wire is white AND the serial number\'s last digit is ODD \u2192 cut the THIRD wire.',
            'IF there are no red wires AND exactly one yellow wire \u2192 cut the FIFTH wire.',
            'IF there are two or more purple wires \u2192 cut the FIRST wire.',
            'IF there is more than one black wire \u2192 cut the SECOND wire.',
            'IF there are no blue wires \u2192 cut the FOURTH wire.',
            'OTHERWISE \u2192 cut the FIFTH wire.',
          ]},
          { subtitle: '6 Wires', rules: [
            'IF there is exactly one red wire AND the serial number\'s last digit is ODD \u2192 cut the SECOND wire.',
            'IF there is more than one orange wire AND no purple wires \u2192 cut the SIXTH wire.',
            'IF there are more than two white wires \u2192 cut the FIFTH wire.',
            'IF there are no green wires \u2192 cut the FOURTH wire.',
            'IF there is more than one black wire \u2192 cut the FIRST wire.',
            'OTHERWISE \u2192 cut the THIRD wire.',
          ]},
        ],
      },
      Charlie: {
        sections: [
          { subtitle: '3 Wires', rules: [
            'IF there are no blue wires \u2192 cut the LAST wire.',
            'IF the first wire is white \u2192 cut the FIRST wire.',
            'IF there is more than one red wire \u2192 cut the SECOND wire.',
            'IF there are no orange wires AND the first wire is purple \u2192 cut the SECOND wire.',
            'OTHERWISE \u2192 cut the SECOND wire.',
          ]},
          { subtitle: '4 Wires', rules: [
            'IF there is any green wire AND the serial number\'s last digit is ODD \u2192 cut the LAST wire.',
            'IF the last wire is blue AND there are no yellow wires \u2192 cut the SECOND wire.',
            'IF there is any orange wire AND the last wire is purple \u2192 cut the THIRD wire.',
            'IF there is exactly one red wire \u2192 cut the THIRD wire.',
            'IF there is more than one white wire \u2192 cut the FIRST wire.',
            'OTHERWISE \u2192 cut the SECOND wire.',
          ]},
          { subtitle: '5 Wires', rules: [
            'IF the last wire is yellow AND the serial number\'s last digit is ODD \u2192 cut the FIRST wire.',
            'IF there are no white wires AND more than one red wire \u2192 cut the THIRD wire.',
            'IF there are no orange wires AND the first wire is purple \u2192 cut the SECOND wire.',
            'IF there is exactly one green wire \u2192 cut the FIFTH wire.',
            'IF there is more than one black wire \u2192 cut the SECOND wire.',
            'OTHERWISE \u2192 cut the FOURTH wire.',
          ]},
          { subtitle: '6 Wires', rules: [
            'IF there is more than one black wire AND the serial number\'s last digit is ODD \u2192 cut the FIFTH wire.',
            'IF there are two or more purple wires AND no orange wires \u2192 cut the FIRST wire.',
            'IF there are no green wires \u2192 cut the THIRD wire.',
            'IF there are more than two red wires \u2192 cut the SIXTH wire.',
            'IF there is exactly one yellow wire \u2192 cut the FOURTH wire.',
            'OTHERWISE \u2192 cut the SECOND wire.',
          ]},
        ],
      },
    },
  };

  // ── Button Chapter (protocol-dependent) ────────────────────
  if (bomb.modules.some(m => m.type === 'button')) {
    manual.chapters.button = {
      title: 'Button Module',
      description: 'CRITICAL: Use the rules for the bomb\'s Protocol (from the Index). Follow the FIRST rule that applies. Rules reference indicator lights and battery count.',
      protocols: {
        Alpha: { rules: [
          'IF the button is BLUE and the label says "ABORT" \u2192 HOLD the button.',
          'IF there are more than 1 battery and the label says "DETONATE" \u2192 PRESS and immediately release.',
          'IF the button is ORANGE and there are more than 1 battery \u2192 HOLD the button.',
          'IF the button is WHITE and there is a lit indicator labeled "CAR" \u2192 HOLD the button.',
          'IF there are more than 2 batteries and there is a lit indicator labeled "FRK" \u2192 PRESS and immediately release.',
          'IF the button is YELLOW \u2192 HOLD the button.',
          'IF the button is RED and the label says "HOLD" \u2192 PRESS and immediately release.',
          'OTHERWISE \u2192 HOLD the button.',
        ]},
        Bravo: { rules: [
          'IF the button is RED and the label says "DETONATE" \u2192 PRESS and immediately release.',
          'IF the button is PURPLE and there is a lit indicator labeled "FRK" \u2192 PRESS and immediately release.',
          'IF there are more than 2 batteries and there is a lit indicator labeled "BOB" \u2192 PRESS and immediately release.',
          'IF the button is GREEN and the label says "HOLD" \u2192 HOLD the button.',
          'IF the button is BLUE and there is a lit indicator labeled "FRK" \u2192 HOLD the button.',
          'IF there are more than 1 battery and the label says "ABORT" \u2192 PRESS and immediately release.',
          'IF the button is ORANGE and the label says "PRESS" \u2192 HOLD the button.',
          'IF the button is YELLOW and the label says "PRESS" \u2192 HOLD the button.',
          'OTHERWISE \u2192 PRESS and immediately release.',
        ]},
        Charlie: { rules: [
          'IF the button is YELLOW and the label says "ABORT" \u2192 HOLD the button.',
          'IF the button is ORANGE and the label says "DETONATE" \u2192 PRESS and immediately release.',
          'IF the button is WHITE and there are more than 2 batteries \u2192 PRESS and immediately release.',
          'IF the button is RED and there is a lit indicator labeled "CAR" \u2192 PRESS and immediately release.',
          'IF the button is PURPLE and the label says "HOLD" \u2192 HOLD the button.',
          'IF the button is GREEN and the label says "DETONATE" \u2192 HOLD the button.',
          'IF the button is BLUE and there are more than 1 battery \u2192 HOLD the button.',
          'IF the label says "HOLD" and there is a lit indicator labeled "FRK" \u2192 PRESS and immediately release.',
          'OTHERWISE \u2192 HOLD the button.',
        ]},
      },
      holdRules: [
        'When holding, a colored STRIP will light up. Release based on the strip color:',
        'Blue strip → release when the countdown timer has a 4 in any position.',
        'White strip → release when the countdown timer has a 1 in any position.',
        'Yellow strip → release when the countdown timer has a 5 in any position.',
        'Red strip → release when the countdown timer has a 1 in any position.',
      ],
      note: 'IMPORTANT: "lit indicator" means the light next to the label is ON (marked with * in the Index). An unlit indicator does NOT count. Hold rules are the same for all protocols.',
    };
  }

  // ── Keypad Chapter (same for all protocols) ────────────────
  if (bomb.modules.some(m => m.type === 'keypad')) {
    manual.chapters.keypad = {
      title: 'Keypad Module',
      description: 'The keypad shows 4 symbols. Find which COLUMN below contains ALL 4 symbols. Press them in top-to-bottom column order. (Same for all protocols.)',
      columns: [
        ['★', '△', '♪', '☀', '♠', '♥', '☆'],
        ['♦', '★', '☆', '⚡', '♠', '♥', '□'],
        ['☀', '♪', '□', '♦', '△', '♣', '★'],
        ['♥', '☆', '⚡', '♣', '★', '♦', '○'],
        ['○', '☀', '♠', '□', '♪', '△', '♦'],
        ['⚡', '○', '♥', '☆', '♣', '★', '△'],
      ],
    };
  }

  // ── Simon Says Chapter ─────────────────────────────────────
  if (bomb.modules.some(m => m.type === 'simon')) {
    manual.chapters.simon = {
      title: 'Simon Says Module',
      description: 'The module flashes a color sequence. Press the CORRECT response color for each flash (not the same color!). The mapping depends on whether the serial number contains a VOWEL (A, E, I, O, U) and your current STRIKE count. (Same for all protocols.)',
      tables: {
        withVowel: {
          label: 'Serial Number Contains a Vowel',
          '0 strikes': { red: 'BLUE', blue: 'RED', green: 'YELLOW', yellow: 'GREEN' },
          '1 strike': { red: 'YELLOW', blue: 'GREEN', green: 'BLUE', yellow: 'RED' },
          '2 strikes': { red: 'GREEN', blue: 'RED', green: 'YELLOW', yellow: 'BLUE' },
        },
        withoutVowel: {
          label: 'Serial Number Does NOT Contain a Vowel',
          '0 strikes': { red: 'BLUE', blue: 'YELLOW', green: 'GREEN', yellow: 'RED' },
          '1 strike': { red: 'RED', blue: 'BLUE', green: 'YELLOW', yellow: 'GREEN' },
          '2 strikes': { red: 'YELLOW', blue: 'GREEN', green: 'BLUE', yellow: 'RED' },
        },
      },
      note: 'The module has multiple stages. Stage 1 shows 1 flash, Stage 2 shows 2 flashes, etc. You must respond to ALL flashes in order each stage. The mapping changes as you accumulate strikes!',
    };
  }

  // ── Morse Code Chapter ─────────────────────────────────────
  if (bomb.modules.some(m => m.type === 'morse')) {
    manual.chapters.morse = {
      title: 'Morse Code Module',
      description: 'A light flashes a word in Morse code (repeating). Decode the word and select the matching frequency. (Same for all protocols.)',
      morseAlphabet: {
        A:'.-',B:'-...',C:'-.-.',D:'-..',E:'.',F:'..-.',G:'--.',H:'....',I:'..',J:'.---',
        K:'-.-',L:'.-..',M:'--',N:'-.',O:'---',P:'.--.',Q:'--.-',R:'.-.',S:'...',T:'-',
        U:'..-',V:'...-',W:'.--',X:'-..-',Y:'-.--',Z:'--..',
      },
      frequencyTable: [
        { word: 'SHELL', freq: '3.505' }, { word: 'HALLS', freq: '3.515' },
        { word: 'SLICK', freq: '3.522' }, { word: 'TRICK', freq: '3.532' },
        { word: 'BOXES', freq: '3.535' }, { word: 'LEAKS', freq: '3.542' },
        { word: 'STROBE', freq: '3.545' }, { word: 'BISTRO', freq: '3.552' },
        { word: 'FLICK', freq: '3.555' }, { word: 'BOMBS', freq: '3.565' },
        { word: 'BREAK', freq: '3.572' }, { word: 'BRICK', freq: '3.575' },
        { word: 'STEAK', freq: '3.582' }, { word: 'STING', freq: '3.592' },
        { word: 'VECTOR', freq: '3.595' }, { word: 'BEATS', freq: '3.600' },
      ],
    };
  }

  // ── Appendix Chapter (always present) ──────────────────────
  manual.chapters.appendix = {
    title: 'Appendix',
    nato: [
      ['A','Alpha'],['B','Bravo'],['C','Charlie'],['D','Delta'],['E','Echo'],
      ['F','Foxtrot'],['G','Golf'],['H','Hotel'],['I','India'],['J','Juliet'],
      ['K','Kilo'],['L','Lima'],['M','Mike'],['N','November'],['O','Oscar'],
      ['P','Papa'],['Q','Quebec'],['R','Romeo'],['S','Sierra'],['T','Tango'],
      ['U','Uniform'],['V','Victor'],['W','Whiskey'],['X','X-ray'],['Y','Yankee'],
      ['Z','Zulu'],
    ],
    indicatorCodes: [
      { label: 'FRK', meaning: 'Frequency Relay Key' },
      { label: 'CAR', meaning: 'Carrier Signal' },
      { label: 'SIG', meaning: 'Signal Processor' },
      { label: 'NSA', meaning: 'Navigation Sensor Array' },
      { label: 'MSA', meaning: 'Measurement Standard Amp' },
      { label: 'TRN', meaning: 'Transmission Node' },
      { label: 'CLR', meaning: 'Clearance Authorization' },
      { label: 'IND', meaning: 'Industrial Override' },
      { label: 'FRQ', meaning: 'Frequency Response Unit' },
      { label: 'SND', meaning: 'Sound Detection Module' },
      { label: 'BOB', meaning: 'Battery Overload Bypass' },
    ],
    portDescriptions: [
      { type: 'DVI-D', desc: 'Digital video connector — 24+1 pin layout' },
      { type: 'Parallel', desc: 'DB-25 parallel data port — 25 pin' },
      { type: 'PS/2', desc: 'Mini-DIN 6 pin peripheral connector' },
      { type: 'RJ-45', desc: 'Ethernet network jack — 8P8C modular' },
      { type: 'Serial', desc: 'RS-232 serial port — DE-9 connector' },
      { type: 'RCA', desc: 'Composite audio/video phono connector' },
    ],
  };

  // ── Margin Notes (1-2 random) ──────────────────────
  const marginNotePool = [
    { text: '← check this twice!' },
    { text: 'IMPORTANT' },
    { text: '← verify with partner' },
    { text: 'DON\'T SKIP' },
    { text: '← common mistake here' },
    { text: 'READ CAREFULLY' },
  ];
  const moduleChapters = Object.keys(manual.chapters).filter(k => ['wires','button','keypad','simon','morse'].includes(k));
  const noteChapters = moduleChapters.length > 0 ? moduleChapters : ['overview'];
  const noteCount = 1 + Math.floor(Math.random() * 2);
  manual.marginNotes = pickN(marginNotePool, noteCount).map(n => ({
    ...n,
    chapter: pick(noteChapters),
    rotation: -5 + Math.random() * 10,
  }));

  // ── Chapter Stamps (0-2 random) ──────────────────────
  const stampTexts = ['CONFIDENTIAL', 'EYES ONLY', 'TOP SECRET', 'RESTRICTED'];
  const stampCount = Math.floor(Math.random() * 3);
  const stampChapters = Object.keys(manual.chapters);
  manual.pageStamps = stampCount > 0 ? pickN(stampTexts, stampCount).map(text => ({
    text,
    chapter: pick(stampChapters),
  })) : [];

  return manual;
}

// ══════════════════════ SOCKET.IO ══════════════════════

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on('create-room', ({ playerName }, cb) => {
    const code = generateRoomCode();
    rooms.set(code, {
      players: [{ id: socket.id, name: playerName, role: null, ready: false }],
      bomb: null, state: 'lobby', difficulty: 'easy',
      customSettings: null,
      timerTimeout: null, timerSpeed: 1, briefingReady: [],
    });
    socket.join(code);
    socket.roomCode = code;
    cb({ code });
  });

  socket.on('join-room', ({ roomCode, playerName }, cb) => {
    const room = rooms.get(roomCode);
    if (!room) return cb({ error: 'Room not found.' });
    if (room.players.length >= 2) return cb({ error: 'Room is full.' });
    if (room.state !== 'lobby') return cb({ error: 'Game already in progress.' });
    room.players.push({ id: socket.id, name: playerName, role: null, ready: false });
    socket.join(roomCode);
    socket.roomCode = roomCode;
    cb({ success: true });
    io.to(roomCode).emit('lobby-update', getLobbyState(room));
  });

  socket.on('select-role', ({ role }) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    if (room.players.some(p => p.id !== socket.id && p.role === role)) {
      socket.emit('role-error', { message: `${role} role is already taken.` });
      return;
    }
    player.role = role;
    io.to(socket.roomCode).emit('lobby-update', getLobbyState(room));
  });

  socket.on('select-difficulty', ({ difficulty, customSettings }) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    room.difficulty = difficulty;
    if (difficulty === 'custom' && customSettings) {
      room.customSettings = validateCustomSettings(customSettings);
    } else if (difficulty !== 'custom') {
      room.customSettings = null;
    }
    io.to(socket.roomCode).emit('lobby-update', getLobbyState(room));
  });

  socket.on('update-custom-settings', ({ customSettings }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.difficulty !== 'custom') return;
    room.customSettings = validateCustomSettings(customSettings);
    io.to(socket.roomCode).emit('lobby-update', getLobbyState(room));
  });

  socket.on('player-ready', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.ready = true;
    io.to(socket.roomCode).emit('lobby-update', getLobbyState(room));
    if (room.players.length === 2 &&
        room.players.every(p => p.ready && p.role) &&
        room.players.some(p => p.role === 'instructor') &&
        room.players.some(p => p.role === 'executor')) {
      room.state = 'briefing';
      io.to(socket.roomCode).emit('go-briefing');
    }
  });

  socket.on('briefing-ready', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'briefing') return;
    if (!room.briefingReady.includes(socket.id)) {
      room.briefingReady.push(socket.id);
      // Notify the other player
      socket.to(socket.roomCode).emit('briefing-partner-ready');
    }
    if (room.briefingReady.length >= 2) {
      io.to(socket.roomCode).emit('start-countdown');
      setTimeout(() => {
        if (!room || room.state !== 'briefing') return;
        room.bomb = generateBomb(room.difficulty, room.customSettings);
        room.state = 'playing';
        room.timerSpeed = 1;
        room.players.forEach(p => {
          if (p.role === 'executor') {
            io.to(p.id).emit('game-start', { role: 'executor', bomb: getExecutorView(room.bomb), difficulty: room.difficulty });
          } else {
            io.to(p.id).emit('game-start', {
              role: 'instructor', manual: room.bomb.manual,
              timer: room.bomb.timer, maxStrikes: room.bomb.maxStrikes, difficulty: room.difficulty,
            });
          }
        });
        startTimer(socket.roomCode);
      }, 4000);
    }
  });

  // ── Game Actions ──────────────────────────────────────────
  socket.on('cut-wire', ({ moduleIndex, wireIndex }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'playing') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== 'executor') return;
    const mod = room.bomb.modules[moduleIndex];
    if (!mod || mod.type !== 'wires' || mod.solved) return;
    if (mod.cutWires.includes(wireIndex)) return;

    mod.cutWires.push(wireIndex);
    const expectedWire = mod.correctSequence[mod.cutWires.length - 1];

    if (wireIndex + 1 === expectedWire) {
      if (mod.cutWires.length === mod.correctSequence.length) {
        mod.solved = true;
        checkSequenceViolation(socket.roomCode, room, moduleIndex);
        emitGameUpdate(socket.roomCode, room, { event: 'module-solved', moduleType: 'wires' });
        checkWin(socket.roomCode, room);
      } else {
        emitGameUpdate(socket.roomCode, room, { event: 'wire-cut-correct', wireIndex });
      }
    } else {
      addStrike(socket.roomCode, room, 'Wrong wire!');
    }
  });

  socket.on('button-press', ({ moduleIndex }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'playing') return;
    const mod = room.bomb.modules[moduleIndex];
    if (!mod || mod.type !== 'button' || mod.solved) return;
    if (mod.correctAction.type === 'press') {
      mod.solved = true;
      checkSequenceViolation(socket.roomCode, room, moduleIndex);
      emitGameUpdate(socket.roomCode, room, { event: 'module-solved', moduleType: 'button' });
      checkWin(socket.roomCode, room);
    } else {
      addStrike(socket.roomCode, room, 'Wrong! You should have HELD the button.');
    }
  });

  socket.on('button-hold', ({ moduleIndex }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'playing') return;
    const mod = room.bomb.modules[moduleIndex];
    if (!mod || mod.type !== 'button' || mod.solved) return;
    if (mod.correctAction.type === 'hold') {
      const executor = room.players.find(p => p.role === 'executor');
      if (executor) io.to(executor.id).emit('button-strip', { moduleIndex, stripColor: mod.stripColor });
    } else {
      addStrike(socket.roomCode, room, 'Wrong! You should have done a quick PRESS.');
    }
  });

  socket.on('button-release', ({ moduleIndex, timerValue }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'playing') return;
    const mod = room.bomb.modules[moduleIndex];
    if (!mod || mod.type !== 'button' || mod.solved) return;
    if (mod.correctAction.type !== 'hold') { addStrike(socket.roomCode, room, 'Wrong action on button.'); return; }
    const timerStr = String(timerValue);
    const releaseMap = { blue: '4', white: '1', yellow: '5', red: '1' };
    const targetDigit = releaseMap[mod.stripColor];
    if (timerStr.includes(targetDigit)) {
      mod.solved = true;
      checkSequenceViolation(socket.roomCode, room, moduleIndex);
      emitGameUpdate(socket.roomCode, room, { event: 'module-solved', moduleType: 'button' });
      checkWin(socket.roomCode, room);
    } else {
      addStrike(socket.roomCode, room, `Released at wrong time! (needed a ${targetDigit} in the timer)`);
    }
  });

  socket.on('keypad-press', ({ moduleIndex, symbol }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'playing') return;
    const mod = room.bomb.modules[moduleIndex];
    if (!mod || mod.type !== 'keypad' || mod.solved) return;
    if (mod.pressedSymbols.includes(symbol)) return;
    const expectedSymbol = mod.correctOrder[mod.pressedSymbols.length];
    if (symbol === expectedSymbol) {
      mod.pressedSymbols.push(symbol);
      if (mod.pressedSymbols.length === mod.correctOrder.length) {
        mod.solved = true;
        checkSequenceViolation(socket.roomCode, room, moduleIndex);
        emitGameUpdate(socket.roomCode, room, { event: 'module-solved', moduleType: 'keypad' });
        checkWin(socket.roomCode, room);
      } else {
        emitGameUpdate(socket.roomCode, room, { event: 'keypad-correct', symbol });
      }
    } else {
      mod.pressedSymbols = [];
      addStrike(socket.roomCode, room, 'Wrong symbol order! Keypad reset.');
    }
  });

  socket.on('simon-input', ({ moduleIndex, color }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'playing') return;
    const mod = room.bomb.modules[moduleIndex];
    if (!mod || mod.type !== 'simon' || mod.solved) return;
    const strikeKey = Math.min(room.bomb.strikes, 2);
    const map = mod.responseMap[strikeKey];
    const expectedFlash = mod.sequence[mod.playerInput.length];
    const expectedResponse = map[expectedFlash];
    if (color === expectedResponse) {
      mod.playerInput.push(color);
      if (mod.playerInput.length === mod.currentStep + 1) {
        mod.currentStep++;
        mod.playerInput = [];
        if (mod.currentStep >= mod.sequence.length) {
          mod.solved = true;
          checkSequenceViolation(socket.roomCode, room, moduleIndex);
          emitGameUpdate(socket.roomCode, room, { event: 'module-solved', moduleType: 'simon' });
          checkWin(socket.roomCode, room);
        } else {
          emitGameUpdate(socket.roomCode, room, { event: 'simon-stage-complete', stage: mod.currentStep });
        }
      } else {
        emitGameUpdate(socket.roomCode, room, { event: 'simon-input-correct' });
      }
    } else {
      mod.playerInput = [];
      addStrike(socket.roomCode, room, 'Wrong Simon Says response!');
    }
  });

  socket.on('simon-replay', ({ moduleIndex }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'playing') return;
    const mod = room.bomb.modules[moduleIndex];
    if (!mod || mod.type !== 'simon' || mod.solved) return;
    const executor = room.players.find(p => p.role === 'executor');
    if (executor) {
      io.to(executor.id).emit('simon-flash', {
        moduleIndex, sequence: mod.sequence.slice(0, mod.currentStep + 1),
      });
    }
  });

  socket.on('morse-submit', ({ moduleIndex, freq }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'playing') return;
    const mod = room.bomb.modules[moduleIndex];
    if (!mod || mod.type !== 'morse' || mod.solved) return;
    if (freq === mod.correctFreq) {
      mod.solved = true;
      checkSequenceViolation(socket.roomCode, room, moduleIndex);
      emitGameUpdate(socket.roomCode, room, { event: 'module-solved', moduleType: 'morse' });
      checkWin(socket.roomCode, room);
    } else {
      addStrike(socket.roomCode, room, `Wrong frequency! ${freq} MHz is incorrect.`);
    }
  });

  // ── Chat ──────────────────────────────────────────────────
  socket.on('chat-message', ({ text }) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    io.to(socket.roomCode).emit('chat-message', {
      id: Date.now() + '-' + socket.id,
      sender: player.name, role: player.role,
      text: text.slice(0, 200), timestamp: Date.now(),
    });
  });

  socket.on('edit-message', ({ messageId, newText }) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    io.to(socket.roomCode).emit('message-edited', { messageId, newText: newText.slice(0, 200) });
  });

  socket.on('play-again', ({ difficulty, customSettings }) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    if (room.timerTimeout) { clearTimeout(room.timerTimeout); room.timerTimeout = null; }
    room.state = 'lobby';
    room.bomb = null;
    room.timerSpeed = 1;
    room.difficulty = difficulty || room.difficulty;
    if (customSettings) room.customSettings = validateCustomSettings(customSettings);
    room.briefingReady = [];
    room.players.forEach(p => { p.ready = false; });
    io.to(socket.roomCode).emit('back-to-lobby', getLobbyState(room));
  });

  socket.on('get-scoreboard', (_, cb) => {
    if (typeof cb === 'function') cb(getScoreboard());
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) {
      if (room.timerTimeout) { clearTimeout(room.timerTimeout); room.timerTimeout = null; }
      rooms.delete(code);
    } else {
      if (room.state === 'playing') endGame(code, room, false, 'Partner disconnected.');
      io.to(code).emit('partner-disconnected');
    }
  });
});

// ── Helpers ─────────────────────────────────────────────────────
function getLobbyState(room) {
  const state = {
    players: room.players.map(p => ({ name: p.name, role: p.role, ready: p.ready })),
    difficulty: room.difficulty,
  };
  if (room.difficulty === 'custom' && room.customSettings) {
    state.customSettings = room.customSettings;
  }
  return state;
}

function getExecutorView(bomb) {
  return {
    shape: bomb.shape, size: bomb.size,
    serial: bomb.serial, protocol: bomb.protocol,
    indicators: bomb.indicators,
    batteries: bomb.batteries, ports: bomb.ports,
    casingTheme: bomb.casingTheme, casingTexture: bomb.casingTexture,
    stencilLabels: bomb.stencilLabels, modelNumber: bomb.modelNumber,
    timer: bomb.timer, maxStrikes: bomb.maxStrikes, strikes: bomb.strikes,
    modules: bomb.modules.map(m => {
      if (m.type === 'wires') return { type: 'wires', wireColors: m.wireColors, wireCount: m.wireCount, cutWires: [...m.cutWires], solved: m.solved };
      if (m.type === 'button') return { type: 'button', color: m.color, label: m.label, icon: m.icon, solved: m.solved };
      if (m.type === 'keypad') return { type: 'keypad', symbols: m.symbols, pressedSymbols: [...m.pressedSymbols], solved: m.solved };
      if (m.type === 'simon') return { type: 'simon', currentStep: m.currentStep, sequenceLength: m.sequence.length, solved: m.solved };
      if (m.type === 'morse') return { type: 'morse', word: m.word, solved: m.solved };
    }),
  };
}

function emitGameUpdate(code, room, extra) {
  room.players.forEach(p => {
    if (p.role === 'executor') {
      io.to(p.id).emit('game-update', { bomb: getExecutorView(room.bomb), timerSpeed: room.timerSpeed || 1, ...extra });
    } else {
      io.to(p.id).emit('game-update', { strikes: room.bomb.strikes, maxStrikes: room.bomb.maxStrikes, timerSpeed: room.timerSpeed || 1, ...extra });
    }
  });
}

function addStrike(code, room, message) {
  room.bomb.strikes++;

  // Max strikes reached = detonation
  if (room.bomb.strikes >= room.bomb.maxStrikes) {
    endGame(code, room, false, `Strike ${room.bomb.strikes} — the bomb detonates!`);
    return;
  }

  const remaining = room.bomb.maxStrikes - room.bomb.strikes;

  if (room.bomb.strikeSpeedup) {
    // Speed up timer + skip time
    const speedLevels = { 1: 1.5, 2: 2.0 };
    room.timerSpeed = speedLevels[room.bomb.strikes] || 2;
    const skipAmounts = { 1: 15, 2: 25 };
    const skip = skipAmounts[room.bomb.strikes] || 0;
    room.bomb.timer = Math.max(5, room.bomb.timer - skip);
    // Restart timer with new speed
    if (room.timerTimeout) { clearTimeout(room.timerTimeout); room.timerTimeout = null; }
    startTimer(code);
    emitGameUpdate(code, room, {
      event: 'strike', strikes: room.bomb.strikes, maxStrikes: room.bomb.maxStrikes,
      timerSpeed: room.timerSpeed, timerSkip: skip,
      message: `STRIKE! ${message} Timer accelerated to ${room.timerSpeed}x speed! ${skip}s skipped! ${remaining} strike${remaining !== 1 ? 's' : ''} before detonation.`,
    });
  } else {
    // No speedup — just report the strike
    emitGameUpdate(code, room, {
      event: 'strike', strikes: room.bomb.strikes, maxStrikes: room.bomb.maxStrikes,
      timerSpeed: room.timerSpeed || 1, timerSkip: 0,
      message: `STRIKE! ${message} ${remaining} strike${remaining !== 1 ? 's' : ''} before detonation.`,
    });
  }
}

function startTimer(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.timerTimeout) { clearTimeout(room.timerTimeout); room.timerTimeout = null; }

  function tick() {
    if (!room.bomb || room.state !== 'playing') return;
    room.bomb.timer--;
    const speed = room.timerSpeed || 1;
    io.to(code).emit('timer-tick', { timer: room.bomb.timer, speed });
    if (room.bomb.timer <= 0) {
      endGame(code, room, false, 'Time ran out!');
      return;
    }
    room.timerTimeout = setTimeout(tick, Math.round(1000 / speed));
  }

  room.timerTimeout = setTimeout(tick, Math.round(1000 / (room.timerSpeed || 1)));
}

function checkWin(code, room) {
  if (room.bomb.modules.every(m => m.solved)) {
    endGame(code, room, true, 'All modules defused!');
    return;
  }
}

// Call this when a module is solved to check if it was out of sequence
function checkSequenceViolation(code, room, moduleIndex) {
  const bomb = room.bomb;
  if (!bomb.solveOrder || bomb.solveOrder.length <= 1) return;

  // If sequence enforcement is off, just advance the pointer without penalty
  if (!bomb.sequenceEnforcement) {
    bomb.nextSolveIndex++;
    while (bomb.nextSolveIndex < bomb.solveOrder.length && bomb.modules[bomb.solveOrder[bomb.nextSolveIndex]].solved) {
      bomb.nextSolveIndex++;
    }
    return;
  }

  const expectedIndex = bomb.solveOrder[bomb.nextSolveIndex];
  if (moduleIndex === expectedIndex) {
    // Correct sequence — advance pointer
    bomb.nextSolveIndex++;
  } else {
    // Wrong sequence — strike + speed up timer
    bomb.strikes++;
    room.timerSpeed = (room.timerSpeed || 1) * 1.5;
    bomb.nextSolveIndex++;
    // Also advance past the out-of-order module in solveOrder so it doesn't trigger again
    while (bomb.nextSolveIndex < bomb.solveOrder.length && bomb.modules[bomb.solveOrder[bomb.nextSolveIndex]].solved) {
      bomb.nextSolveIndex++;
    }
    if (bomb.strikes >= bomb.maxStrikes) {
      endGame(code, room, false, 'Too many strikes!');
      return;
    }
    emitGameUpdate(code, room, { event: 'sequence-violation', message: 'Wrong sequence! Strike + time accelerated!' });
  }
}

function endGame(code, room, won, reason) {
  if (room.state !== 'playing') return;
  room.state = 'result';
  if (room.timerTimeout) { clearTimeout(room.timerTimeout); room.timerTimeout = null; }

  const totalTime = room.difficulty === 'custom' && room.customSettings ? room.customSettings.timer
    : ({ easy: 300, medium: 240, hard: 180 }[room.difficulty] || 300);
  const score = calculateScore(won, room.bomb.timer, room.bomb.strikes, room.difficulty, totalTime);
  const modulesSolved = room.bomb.modules.filter(m => m.solved).length;
  const totalModules = room.bomb.modules.length;

  const executor = room.players.find(p => p.role === 'executor');
  const instructor = room.players.find(p => p.role === 'instructor');

  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    executor: executor ? executor.name : '???',
    instructor: instructor ? instructor.name : '???',
    difficulty: room.difficulty,
    won,
    score,
    timeRemaining: room.bomb.timer,
    totalTime,
    strikes: room.bomb.strikes,
    maxStrikes: room.bomb.maxStrikes,
    modulesSolved,
    totalModules,
    protocol: room.bomb.protocol,
    reason,
    timestamp: Date.now(),
  };
  saveScore(record);

  io.to(code).emit('game-over', {
    won, reason, timeRemaining: room.bomb.timer,
    strikes: room.bomb.strikes, maxStrikes: room.bomb.maxStrikes, difficulty: room.difficulty,
    score,
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Wire & Fire running at http://localhost:${PORT}`));
