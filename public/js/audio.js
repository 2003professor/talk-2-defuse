// ══════════════════════ Web Audio Sound Effects ══════════════════════
// Generates all sounds programmatically — no external audio files needed.

const AudioFX = (() => {
  let ctx;
  let masterGain, sfxGain, musicGain;
  let _masterVol = 1, _sfxVol = 1, _musicVol = 1;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function ensureGainNodes() {
    if (masterGain) return;
    const c = getCtx();
    masterGain = c.createGain();
    masterGain.gain.value = _masterVol;
    masterGain.connect(c.destination);

    sfxGain = c.createGain();
    sfxGain.gain.value = _sfxVol;
    sfxGain.connect(masterGain);

    musicGain = c.createGain();
    musicGain.gain.value = _musicVol;
    musicGain.connect(masterGain);
  }

  function getSfxDest() {
    ensureGainNodes();
    return sfxGain;
  }

  function getMusicDest() {
    ensureGainNodes();
    return musicGain;
  }

  function play(fn) {
    try {
      const c = getCtx();
      if (c.state === 'suspended') c.resume();
      const dest = getSfxDest();
      fn(c, dest);
    } catch (_) { /* audio not available */ }
  }

  return {
    snip() {
      play((c, dest) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(800, c.currentTime);
        o.frequency.exponentialRampToValueAtTime(200, c.currentTime + 0.1);
        g.gain.setValueAtTime(0.3, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.15);
        o.connect(g).connect(dest);
        o.start(); o.stop(c.currentTime + 0.15);
      });
    },

    success() {
      play((c, dest) => {
        [523, 659, 784].forEach((freq, i) => {
          const o = c.createOscillator();
          const g = c.createGain();
          o.type = 'sine';
          o.frequency.value = freq;
          g.gain.setValueAtTime(0.25, c.currentTime + i * 0.15);
          g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + i * 0.15 + 0.4);
          o.connect(g).connect(dest);
          o.start(c.currentTime + i * 0.15);
          o.stop(c.currentTime + i * 0.15 + 0.4);
        });
      });
    },

    strike() {
      play((c, dest) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(150, c.currentTime);
        o.frequency.exponentialRampToValueAtTime(50, c.currentTime + 0.4);
        g.gain.setValueAtTime(0.4, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.4);
        o.connect(g).connect(dest);
        o.start(); o.stop(c.currentTime + 0.4);
      });
    },

    explosion() {
      play((c, dest) => {
        const t = c.currentTime;
        // Layer 1: Sub-bass boom punch (the "BOOM" you feel)
        const sub = c.createOscillator();
        const subG = c.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(60, t);
        sub.frequency.exponentialRampToValueAtTime(20, t + 1.0);
        subG.gain.setValueAtTime(0.7, t);
        subG.gain.exponentialRampToValueAtTime(0.01, t + 1.0);
        sub.connect(subG).connect(dest);
        sub.start(t); sub.stop(t + 1.0);

        // Layer 2: Mid punch (adds body)
        const mid = c.createOscillator();
        const midG = c.createGain();
        mid.type = 'sawtooth';
        mid.frequency.setValueAtTime(120, t);
        mid.frequency.exponentialRampToValueAtTime(30, t + 0.5);
        midG.gain.setValueAtTime(0.35, t);
        midG.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
        mid.connect(midG).connect(dest);
        mid.start(t); mid.stop(t + 0.5);

        // Layer 3: Noise burst (the crack/debris)
        const bufferSize = c.sampleRate * 2;
        const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          const env = Math.pow(1 - i / bufferSize, 1.5);
          data[i] = (Math.random() * 2 - 1) * env;
        }
        const src = c.createBufferSource();
        src.buffer = buffer;
        const noiseG = c.createGain();
        noiseG.gain.setValueAtTime(0.6, t);
        noiseG.gain.setValueAtTime(0.6, t + 0.05);
        noiseG.gain.exponentialRampToValueAtTime(0.01, t + 2.0);
        const lpf = c.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.setValueAtTime(800, t);
        lpf.frequency.exponentialRampToValueAtTime(150, t + 2.0);
        src.connect(lpf).connect(noiseG).connect(dest);
        src.start(t);

        // Layer 4: High crack (initial impact snap)
        const crack = c.createBufferSource();
        const crackBuf = c.createBuffer(1, c.sampleRate * 0.15, c.sampleRate);
        const crackData = crackBuf.getChannelData(0);
        for (let i = 0; i < crackData.length; i++) {
          crackData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / crackData.length, 4);
        }
        crack.buffer = crackBuf;
        const crackG = c.createGain();
        crackG.gain.setValueAtTime(0.5, t);
        crackG.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
        const hpf = c.createBiquadFilter();
        hpf.type = 'highpass';
        hpf.frequency.value = 2000;
        crack.connect(hpf).connect(crackG).connect(dest);
        crack.start(t);
      });
    },

    defused() {
      play((c, dest) => {
        const notes = [523, 659, 784, 1047];
        notes.forEach((freq, i) => {
          const o = c.createOscillator();
          const g = c.createGain();
          o.type = 'sine';
          o.frequency.value = freq;
          g.gain.setValueAtTime(0.2, c.currentTime + i * 0.2);
          g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + i * 0.2 + 0.5);
          o.connect(g).connect(dest);
          o.start(c.currentTime + i * 0.2);
          o.stop(c.currentTime + i * 0.2 + 0.5);
        });
      });
    },

    click() {
      play((c, dest) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'sine';
        o.frequency.value = 600;
        g.gain.setValueAtTime(0.15, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.05);
        o.connect(g).connect(dest);
        o.start(); o.stop(c.currentTime + 0.05);
      });
    },

    // Paper page flip — realistic swoosh + rustle + settle
    pageFlip() {
      play((c, dest) => {
        const t = c.currentTime;

        // Layer 1: Initial lift — quick high-freq burst (paper peeling off)
        const liftLen = c.sampleRate * 0.08;
        const liftBuf = c.createBuffer(1, liftLen, c.sampleRate);
        const liftData = liftBuf.getChannelData(0);
        for (let i = 0; i < liftLen; i++) {
          liftData[i] = (Math.random() * 2 - 1) * (1 - i / liftLen) * 0.6;
        }
        const lift = c.createBufferSource();
        lift.buffer = liftBuf;
        const liftF = c.createBiquadFilter();
        liftF.type = 'highpass'; liftF.frequency.value = 4000;
        const liftG = c.createGain();
        liftG.gain.setValueAtTime(0.08, t);
        lift.connect(liftF).connect(liftG).connect(dest);
        lift.start(t); lift.stop(t + 0.08);

        // Layer 2: Main swoosh — shaped noise through bandpass
        const swooshLen = c.sampleRate * 0.3;
        const swooshBuf = c.createBuffer(1, swooshLen, c.sampleRate);
        const swooshData = swooshBuf.getChannelData(0);
        for (let i = 0; i < swooshLen; i++) {
          const pos = i / swooshLen;
          // Asymmetric envelope: fast attack, gradual decay
          const env = pos < 0.2 ? pos / 0.2 : Math.pow(1 - (pos - 0.2) / 0.8, 1.5);
          swooshData[i] = (Math.random() * 2 - 1) * env;
        }
        const swoosh = c.createBufferSource();
        swoosh.buffer = swooshBuf;
        const swBP = c.createBiquadFilter();
        swBP.type = 'bandpass';
        swBP.frequency.setValueAtTime(4500, t + 0.02);
        swBP.frequency.exponentialRampToValueAtTime(1200, t + 0.25);
        swBP.Q.value = 0.6;
        const swG = c.createGain();
        swG.gain.setValueAtTime(0.14, t + 0.02);
        swG.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
        swoosh.connect(swBP).connect(swG).connect(dest);
        swoosh.start(t + 0.02); swoosh.stop(t + 0.32);

        // Layer 3: Settle thud — page lands flat
        const thud = c.createOscillator();
        const thudG = c.createGain();
        thud.type = 'sine';
        thud.frequency.setValueAtTime(120, t + 0.22);
        thud.frequency.exponentialRampToValueAtTime(60, t + 0.35);
        thudG.gain.setValueAtTime(0.05, t + 0.22);
        thudG.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        thud.connect(thudG).connect(dest);
        thud.start(t + 0.22); thud.stop(t + 0.36);

        // Layer 4: Trailing rustle — tiny noise tail
        const rustleLen = c.sampleRate * 0.12;
        const rustleBuf = c.createBuffer(1, rustleLen, c.sampleRate);
        const rustleData = rustleBuf.getChannelData(0);
        for (let i = 0; i < rustleLen; i++) {
          rustleData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rustleLen, 2);
        }
        const rustle = c.createBufferSource();
        rustle.buffer = rustleBuf;
        const rLP = c.createBiquadFilter();
        rLP.type = 'lowpass'; rLP.frequency.value = 2000;
        const rG = c.createGain();
        rG.gain.setValueAtTime(0.04, t + 0.25);
        rG.gain.exponentialRampToValueAtTime(0.001, t + 0.37);
        rustle.connect(rLP).connect(rG).connect(dest);
        rustle.start(t + 0.25); rustle.stop(t + 0.38);
      });
    },

    // Fuse sizzle — short "tsssss" sound (filtered noise + high sine crackle)
    fuseLit() {
      play((c, dest) => {
        const dur = 0.8;
        const t = c.currentTime;
        // White noise buffer for sizzle
        const bufLen = c.sampleRate * dur;
        const buf = c.createBuffer(1, bufLen, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
        const noise = c.createBufferSource();
        noise.buffer = buf;
        // Bandpass filter — keep only the hissy frequencies
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(7000, t);
        bp.frequency.linearRampToValueAtTime(4000, t + dur);
        bp.Q.value = 1.5;
        // Gain envelope — quick attack, slow fade
        const g = c.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.25, t + 0.03);
        g.gain.setValueAtTime(0.25, t + 0.1);
        g.gain.exponentialRampToValueAtTime(0.01, t + dur);
        noise.connect(bp).connect(g).connect(dest);
        noise.start(t);
        noise.stop(t + dur);
        // High sine crackle on top
        const o = c.createOscillator();
        const g2 = c.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(6000, t);
        o.frequency.exponentialRampToValueAtTime(3000, t + dur);
        g2.gain.setValueAtTime(0.04, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g2).connect(dest);
        o.start(t);
        o.stop(t + dur);
      });
    },

    // Clock tick — thin sharp "tet" like a clock mechanism. Scales with speed.
    tick(speed = 1) {
      play((c, dest) => {
        const t = c.currentTime;
        const freq = 2400 + (speed - 1) * 400;
        const vol = 0.15 + (speed - 1) * 0.10;

        // Single thin click: high sine, no pitch bend, ultra-short
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(Math.min(vol, 0.4), t);
        g.gain.setValueAtTime(0.001, t + 0.018);
        o.connect(g).connect(dest);
        o.start(t); o.stop(t + 0.02);

        // Secondary double-tap when sped up
        if (speed > 1) {
          const o2 = c.createOscillator();
          const g2 = c.createGain();
          o2.type = 'sine';
          o2.frequency.value = freq * 1.2;
          const vol2 = Math.min(vol * 0.5, 0.2);
          g2.gain.setValueAtTime(vol2, t + 0.06);
          g2.gain.setValueAtTime(0.001, t + 0.078);
          o2.connect(g2).connect(dest);
          o2.start(t + 0.06); o2.stop(t + 0.08);
        }

        // At 2x speed, add a low rumble undertone
        if (speed >= 2) {
          const o3 = c.createOscillator();
          const g3 = c.createGain();
          o3.type = 'sawtooth';
          o3.frequency.value = 60;
          g3.gain.setValueAtTime(0.05, t);
          g3.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
          o3.connect(g3).connect(dest);
          o3.start(t); o3.stop(t + 0.13);
        }
      });
    },

    // Alarm sound when timer speed increases after a strike
    timerSpeedup(speed) {
      play((c, dest) => {
        // Rising alarm sweep
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(200, c.currentTime);
        o.frequency.exponentialRampToValueAtTime(800 * speed, c.currentTime + 0.5);
        g.gain.setValueAtTime(0.2, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.6);
        o.connect(g).connect(dest);
        o.start();
        o.stop(c.currentTime + 0.6);

        // Staccato warning beeps
        for (let i = 0; i < 3; i++) {
          const ob = c.createOscillator();
          const gb = c.createGain();
          ob.type = 'square';
          ob.frequency.value = 1200;
          const t = c.currentTime + 0.6 + i * 0.15;
          gb.gain.setValueAtTime(0.15, t);
          gb.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
          ob.connect(gb).connect(dest);
          ob.start(t);
          ob.stop(t + 0.1);
        }
      });
    },

    buttonPress() {
      play((c, dest) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(300, c.currentTime);
        o.frequency.exponentialRampToValueAtTime(150, c.currentTime + 0.2);
        g.gain.setValueAtTime(0.3, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.2);
        o.connect(g).connect(dest);
        o.start(); o.stop(c.currentTime + 0.2);
      });
    },

    keypadBeep() {
      play((c, dest) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'square';
        o.frequency.value = 440 + Math.random() * 200;
        g.gain.setValueAtTime(0.12, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.1);
        o.connect(g).connect(dest);
        o.start(); o.stop(c.currentTime + 0.1);
      });
    },

    message() {
      play((c, dest) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'sine';
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.1, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + 0.08);
        o.connect(g).connect(dest);
        o.start(); o.stop(c.currentTime + 0.08);
      });
    },

    // Countdown tick: dramatic multi-layered impact — 3=red, 2=orange, 1=yellow
    countdownTick(n) {
      play((c, dest) => {
        const t = c.currentTime;
        const freqs = { 3: 220, 2: 261, 1: 329 };  // rising tension
        const freq = freqs[n] || 261;

        // Layer 1: main tone (triangle for warmth)
        const o1 = c.createOscillator();
        const g1 = c.createGain();
        o1.type = 'triangle';
        o1.frequency.setValueAtTime(freq, t);
        o1.frequency.exponentialRampToValueAtTime(freq * 0.85, t + 0.5);
        g1.gain.setValueAtTime(0.4, t);
        g1.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
        o1.connect(g1).connect(dest);
        o1.start(t); o1.stop(t + 0.55);

        // Layer 2: sub-bass thump
        const o2 = c.createOscillator();
        const g2 = c.createGain();
        o2.type = 'sine';
        o2.frequency.setValueAtTime(80, t);
        o2.frequency.exponentialRampToValueAtTime(40, t + 0.25);
        g2.gain.setValueAtTime(0.5, t);
        g2.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
        o2.connect(g2).connect(dest);
        o2.start(t); o2.stop(t + 0.3);

        // Layer 3: noise transient (impact)
        const buf = c.createBuffer(1, c.sampleRate * 0.08, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
        const noise = c.createBufferSource();
        noise.buffer = buf;
        const ng = c.createGain();
        ng.gain.setValueAtTime(0.3, t);
        ng.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
        const nf = c.createBiquadFilter();
        nf.type = 'highpass'; nf.frequency.value = 800;
        noise.connect(nf).connect(ng).connect(dest);
        noise.start(t); noise.stop(t + 0.1);

        // Layer 4: high harmonic ping (octave up)
        const o3 = c.createOscillator();
        const g3 = c.createGain();
        o3.type = 'sine';
        o3.frequency.value = freq * 2;
        g3.gain.setValueAtTime(0.12, t);
        g3.gain.exponentialRampToValueAtTime(0.01, t + 0.35);
        o3.connect(g3).connect(dest);
        o3.start(t); o3.stop(t + 0.4);

        // Rising tension tail (only on "1")
        if (n === 1) {
          const oRise = c.createOscillator();
          const gRise = c.createGain();
          oRise.type = 'sawtooth';
          oRise.frequency.setValueAtTime(200, t + 0.2);
          oRise.frequency.exponentialRampToValueAtTime(800, t + 0.9);
          gRise.gain.setValueAtTime(0.0, t + 0.2);
          gRise.gain.linearRampToValueAtTime(0.15, t + 0.6);
          gRise.gain.exponentialRampToValueAtTime(0.01, t + 0.9);
          const fRise = c.createBiquadFilter();
          fRise.type = 'lowpass'; fRise.frequency.value = 2000;
          oRise.connect(fRise).connect(gRise).connect(dest);
          oRise.start(t + 0.2); oRise.stop(t + 0.95);
        }
      });
    },

    // Countdown GO: epic slam with siren burst and chord
    countdownGo() {
      play((c, dest) => {
        const t = c.currentTime;

        // Layer 1: power chord (C4+E4+G4+C5)
        [261, 329, 392, 523].forEach((freq, i) => {
          const o = c.createOscillator();
          const g = c.createGain();
          o.type = i < 2 ? 'sawtooth' : 'triangle';
          o.frequency.value = freq;
          g.gain.setValueAtTime(0.2, t);
          g.gain.setValueAtTime(0.2, t + 0.3);
          g.gain.exponentialRampToValueAtTime(0.01, t + 0.8);
          o.connect(g).connect(dest);
          o.start(t); o.stop(t + 0.85);
        });

        // Layer 2: massive sub impact
        const oSub = c.createOscillator();
        const gSub = c.createGain();
        oSub.type = 'sine';
        oSub.frequency.setValueAtTime(100, t);
        oSub.frequency.exponentialRampToValueAtTime(30, t + 0.4);
        gSub.gain.setValueAtTime(0.6, t);
        gSub.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
        oSub.connect(gSub).connect(dest);
        oSub.start(t); oSub.stop(t + 0.45);

        // Layer 3: noise burst (crash)
        const buf = c.createBuffer(1, c.sampleRate * 0.2, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
        const noise = c.createBufferSource();
        noise.buffer = buf;
        const ng = c.createGain();
        ng.gain.setValueAtTime(0.35, t);
        ng.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
        const nf = c.createBiquadFilter();
        nf.type = 'bandpass'; nf.frequency.value = 3000; nf.Q.value = 0.5;
        noise.connect(nf).connect(ng).connect(dest);
        noise.start(t); noise.stop(t + 0.25);

        // Layer 4: rising siren sweep
        const oSiren = c.createOscillator();
        const gSiren = c.createGain();
        oSiren.type = 'square';
        oSiren.frequency.setValueAtTime(400, t);
        oSiren.frequency.exponentialRampToValueAtTime(1200, t + 0.15);
        oSiren.frequency.exponentialRampToValueAtTime(600, t + 0.5);
        gSiren.gain.setValueAtTime(0.08, t);
        gSiren.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
        const sf = c.createBiquadFilter();
        sf.type = 'lowpass'; sf.frequency.value = 2500;
        oSiren.connect(sf).connect(gSiren).connect(dest);
        oSiren.start(t); oSiren.stop(t + 0.55);
      });
    },

    // ── Menu Music ──────────────────────────────────────────────
    _menuNodes: [],
    isMenuPlaying: false,
    _menuTimers: [],

    menuMusic() {
      if (this.isMenuPlaying) return;
      try {
        const c = getCtx();
        if (c.state === 'suspended') c.resume();
        this.isMenuPlaying = true;
        const nodes = [];
        const timers = [];
        const musicDest = getMusicDest();

        // Master gain for fade-out
        const master = c.createGain();
        master.gain.setValueAtTime(0, c.currentTime);
        master.gain.linearRampToValueAtTime(1, c.currentTime + 2);
        master.connect(musicDest);
        nodes.push(master);

        // ── Layer 1: Dark pad (minor chord drone) ──
        const padGain = c.createGain();
        padGain.gain.value = 0.04;
        const padFilter = c.createBiquadFilter();
        padFilter.type = 'lowpass';
        padFilter.frequency.value = 300;
        padFilter.Q.value = 1;
        padGain.connect(padFilter).connect(master);
        nodes.push(padGain, padFilter);

        // A2 minor chord: A2, C3, E3 with slight detune
        [110, 130.81, 164.81, 109.4, 131.2, 165.2].forEach(freq => {
          const osc = c.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          osc.connect(padGain);
          osc.start();
          nodes.push(osc);
        });

        // Slow LFO on pad filter — breathing swell
        const padLfo = c.createOscillator();
        const padLfoGain = c.createGain();
        padLfo.type = 'sine';
        padLfo.frequency.value = 0.08;
        padLfoGain.gain.value = 120;
        padLfo.connect(padLfoGain).connect(padFilter.frequency);
        padLfo.start();
        nodes.push(padLfo, padLfoGain);

        // ── Layer 2: Sub bass heartbeat (felt, not heard) ──
        const heartbeatInterval = 2400;

        function heartbeat() {
          if (!AudioFX.isMenuPlaying) return;
          try {
            const now = c.currentTime;
            // "Lub" — deep sub thump
            const lub = c.createOscillator();
            const lubG = c.createGain();
            const lubF = c.createBiquadFilter();
            lub.type = 'sine';
            lub.frequency.setValueAtTime(40, now);
            lub.frequency.exponentialRampToValueAtTime(22, now + 0.3);
            lubF.type = 'lowpass';
            lubF.frequency.value = 60;
            lubG.gain.setValueAtTime(0.06, now);
            lubG.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            lub.connect(lubF).connect(lubG).connect(master);
            lub.start(now);
            lub.stop(now + 0.45);

            // "Dub" — softer echo
            const dub = c.createOscillator();
            const dubG = c.createGain();
            const dubF = c.createBiquadFilter();
            dub.type = 'sine';
            dub.frequency.setValueAtTime(35, now + 0.3);
            dub.frequency.exponentialRampToValueAtTime(20, now + 0.55);
            dubF.type = 'lowpass';
            dubF.frequency.value = 50;
            dubG.gain.setValueAtTime(0.03, now + 0.3);
            dubG.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
            dub.connect(dubF).connect(dubG).connect(master);
            dub.start(now + 0.3);
            dub.stop(now + 0.65);
          } catch (_) {}
          timers.push(setTimeout(heartbeat, heartbeatInterval));
        }
        timers.push(setTimeout(heartbeat, 500));

        // ── Layer 3: Tension melody — pentatonic minor motif ──
        const melodyNotes = [220, 261.63, 329.63, 293.66, 220, 196, 164.81, 220];
        let melodyIdx = 0;

        function melodyNote() {
          if (!AudioFX.isMenuPlaying) return;
          try {
            const now = c.currentTime;
            const freq = melodyNotes[melodyIdx % melodyNotes.length];
            melodyIdx++;

            const osc = c.createOscillator();
            const g = c.createGain();
            const f = c.createBiquadFilter();
            osc.type = 'sine';
            osc.frequency.value = freq;
            f.type = 'lowpass';
            f.frequency.value = 800;
            g.gain.setValueAtTime(0.03, now);
            g.gain.linearRampToValueAtTime(0.025, now + 0.3);
            g.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
            osc.connect(f).connect(g).connect(master);
            osc.start(now);
            osc.stop(now + 2.8);

            // Subtle reverb-like echo
            const echo = c.createOscillator();
            const echoG = c.createGain();
            echo.type = 'sine';
            echo.frequency.value = freq;
            echoG.gain.setValueAtTime(0.008, now + 0.15);
            echoG.gain.exponentialRampToValueAtTime(0.001, now + 3);
            echo.connect(echoG).connect(master);
            echo.start(now + 0.15);
            echo.stop(now + 3.2);
          } catch (_) {}
          // Play notes at steady musical intervals (half notes at ~50bpm)
          const nextDelay = 2400;
          timers.push(setTimeout(melodyNote, nextDelay));
        }
        timers.push(setTimeout(melodyNote, 4000));

        this._menuNodes = nodes;
        this._menuMaster = master;
        this._menuTimers = timers;
      } catch (_) {
        this.isMenuPlaying = false;
      }
    },

    stopMenuMusic() {
      if (!this.isMenuPlaying) return;
      this.isMenuPlaying = false;
      this._menuTimers.forEach(t => clearTimeout(t));
      this._menuTimers = [];
      const master = this._menuMaster;
      if (master) {
        try {
          const c = getCtx();
          master.gain.setValueAtTime(master.gain.value, c.currentTime);
          master.gain.linearRampToValueAtTime(0, c.currentTime + 1.5);
          setTimeout(() => {
            this._menuNodes.forEach(n => { try { if (n.stop) n.stop(); n.disconnect(); } catch (_) {} });
            this._menuNodes = [];
            this._menuMaster = null;
          }, 1600);
        } catch (_) {
          this._menuNodes.forEach(n => { try { if (n.stop) n.stop(); n.disconnect(); } catch (_) {} });
          this._menuNodes = [];
          this._menuMaster = null;
        }
      }
    },

    // ── Volume Control ──────────────────────────────────────────
    setMasterVolume(v) {
      _masterVol = v;
      if (masterGain) masterGain.gain.value = v;
    },

    setSfxVolume(v) {
      _sfxVol = v;
      if (sfxGain) sfxGain.gain.value = v;
    },

    setMusicVolume(v) {
      _musicVol = v;
      if (musicGain) musicGain.gain.value = v;
      // Also update the menu music's own master gain if currently playing
      if (this._menuMaster && this.isMenuPlaying) {
        try {
          const c = getCtx();
          this._menuMaster.gain.setValueAtTime(this._menuMaster.gain.value, c.currentTime);
          this._menuMaster.gain.linearRampToValueAtTime(v > 0 ? 1 : 0, c.currentTime + 0.1);
        } catch (_) {}
      }
    },
  };
})();
