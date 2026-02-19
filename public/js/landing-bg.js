// ══════════════════════ Wire & Circuit Background ══════════════════════
// Animated canvas: circuit-board wires, pulsing nodes, traveling sparks,
// with a faint bomb silhouette in the center.

(function() {
  const canvas = document.getElementById('landing-bg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W, H, nodes, wires, pulses, sparks, raf;

  const COLORS = {
    wire: 'rgba(88,166,255,0.07)',
    wireActive: 'rgba(240,136,62,0.12)',
    node: 'rgba(88,166,255,0.15)',
    nodeGlow: 'rgba(240,136,62,0.3)',
    pulse: 'rgba(240,136,62,0.6)',
    spark: 'rgba(248,81,73,0.8)',
    grid: 'rgba(88,166,255,0.018)',
    centerGlow1: 'rgba(240,100,30,0.06)',
    centerGlow2: 'rgba(248,81,73,0.03)',
  };

  // Bomb silhouette center (relative to canvas center)
  let bombCx, bombCy, bombRadius;

  function resize() {
    const parent = canvas.parentElement;
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    canvas.width = pw * devicePixelRatio;
    canvas.height = ph * devicePixelRatio;
    W = pw;
    H = ph;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    // Bomb silhouette position — centered, upper half
    bombCx = W * 0.5;
    bombCy = H * 0.42;
    bombRadius = Math.min(W, H) * 0.18;

    init();
  }

  function init() {
    const w = W;
    const h = H;

    // Generate nodes on a loose grid with higher density near bomb center
    nodes = [];
    const spacing = 120;
    const cols = Math.ceil(w / spacing) + 1;
    const rows = Math.ceil(h / spacing) + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Jitter position
        const x = c * spacing + (Math.random() - 0.5) * 60;
        const y = r * spacing + (Math.random() - 0.5) * 60;
        const size = 1.5 + Math.random() * 2;
        nodes.push({
          x, y, size,
          baseAlpha: 0.05 + Math.random() * 0.1,
          alpha: 0,
          phase: Math.random() * Math.PI * 2,
          pulseSpeed: 0.3 + Math.random() * 0.5,
          active: false,
          activeTimer: 0,
        });
      }
    }

    // Extra nodes near bomb center for density
    const extraCount = 12;
    for (let i = 0; i < extraCount; i++) {
      const angle = (Math.PI * 2 * i) / extraCount + (Math.random() - 0.5) * 0.4;
      const dist = bombRadius * (0.6 + Math.random() * 0.8);
      nodes.push({
        x: bombCx + Math.cos(angle) * dist,
        y: bombCy + Math.sin(angle) * dist,
        size: 1.5 + Math.random() * 1.5,
        baseAlpha: 0.06 + Math.random() * 0.08,
        alpha: 0,
        phase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.3 + Math.random() * 0.5,
        active: false,
        activeTimer: 0,
      });
    }

    // Connect nearby nodes with wires (circuit traces)
    wires = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Higher connection probability near bomb center
        const midX = (nodes[i].x + nodes[j].x) / 2;
        const midY = (nodes[i].y + nodes[j].y) / 2;
        const distToCenter = Math.sqrt((midX - bombCx) ** 2 + (midY - bombCy) ** 2);
        const centerBoost = distToCenter < bombRadius * 1.5 ? 0.15 : 0;

        if (dist < spacing * 1.4 && Math.random() < 0.35 + centerBoost) {
          // Circuit-style: either straight or L-shaped
          const bend = Math.random() < 0.5;
          wires.push({
            a: i, b: j, dist,
            bend,
            bendAxis: Math.random() < 0.5 ? 'x' : 'y',
            alpha: 0.04 + Math.random() * 0.04,
            active: false,
            activeTimer: 0,
          });
        }
      }
    }

    // Pulses: traveling lights along wires
    pulses = [];

    // Sparks: occasional bright flashes at nodes
    sparks = [];
  }

  function drawBombSilhouette() {
    const cx = bombCx;
    const cy = bombCy;
    const r = bombRadius;

    ctx.save();

    // Outer glow
    const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.6);
    glow.addColorStop(0, 'rgba(240,136,62,0.02)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);

    // Bomb body circle
    ctx.strokeStyle = 'rgba(230,237,243,0.04)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Inner circle (subtle)
    ctx.strokeStyle = 'rgba(240,136,62,0.025)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
    ctx.stroke();

    // Fuse neck
    const neckW = r * 0.2;
    const neckH = r * 0.22;
    ctx.strokeStyle = 'rgba(230,237,243,0.035)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(cx - neckW / 2, cy - r - neckH, neckW, neckH);
    ctx.stroke();

    // Fuse line (curved)
    ctx.strokeStyle = 'rgba(230,237,243,0.03)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r - neckH);
    ctx.quadraticCurveTo(cx + r * 0.3, cy - r - neckH - r * 0.3, cx + r * 0.5, cy - r - neckH - r * 0.5);
    ctx.stroke();

    ctx.restore();
  }

  function spawnPulse() {
    if (wires.length === 0) return;
    const wi = Math.floor(Math.random() * wires.length);
    const wire = wires[wi];
    pulses.push({
      wireIdx: wi,
      t: 0,
      speed: 0.3 + Math.random() * 0.5,
      forward: Math.random() < 0.5,
      size: 2 + Math.random() * 2,
      alpha: 0.4 + Math.random() * 0.3,
    });
    // Light up the wire
    wire.active = true;
    wire.activeTimer = 2;
  }

  function spawnSpark() {
    if (nodes.length === 0) return;
    const ni = Math.floor(Math.random() * nodes.length);
    const node = nodes[ni];
    node.active = true;
    node.activeTimer = 1.5;
    sparks.push({
      x: node.x, y: node.y,
      alpha: 0.6,
      radius: 3,
      maxRadius: 15 + Math.random() * 10,
    });
  }

  let lastTime = 0;
  let pulseTimer = 0;
  let sparkTimer = 0;

  function draw(time) {
    raf = requestAnimationFrame(draw);
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    const w = W;
    const h = H;
    ctx.clearRect(0, 0, w, h);

    // Center glow
    const grd = ctx.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, w * 0.5);
    grd.addColorStop(0, COLORS.centerGlow1);
    grd.addColorStop(0.5, COLORS.centerGlow2);
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);

    // Draw bomb silhouette (behind everything)
    drawBombSilhouette();

    // Draw grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    const gridSize = 60;
    for (let x = 0; x < w; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Draw wires
    wires.forEach(wire => {
      const na = nodes[wire.a];
      const nb = nodes[wire.b];

      if (wire.activeTimer > 0) {
        wire.activeTimer -= dt;
        if (wire.activeTimer <= 0) wire.active = false;
      }

      const alpha = wire.active
        ? wire.alpha + 0.08 * (wire.activeTimer / 2)
        : wire.alpha;

      ctx.strokeStyle = wire.active
        ? `rgba(240,136,62,${alpha})`
        : `rgba(88,166,255,${alpha})`;
      ctx.lineWidth = wire.active ? 1.2 : 0.8;

      ctx.beginPath();
      if (wire.bend) {
        const mx = wire.bendAxis === 'x' ? nb.x : na.x;
        const my = wire.bendAxis === 'x' ? na.y : nb.y;
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(mx, my);
        ctx.lineTo(nb.x, nb.y);
      } else {
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
      }
      ctx.stroke();
    });

    // Draw nodes
    nodes.forEach(node => {
      if (node.activeTimer > 0) {
        node.activeTimer -= dt;
        if (node.activeTimer <= 0) node.active = false;
      }

      node.alpha = node.baseAlpha + Math.sin(time * 0.001 * node.pulseSpeed + node.phase) * 0.04;

      if (node.active) {
        // Glowing active node
        const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, 12);
        glow.addColorStop(0, `rgba(240,136,62,${0.25 * (node.activeTimer / 1.5)})`);
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(node.x - 12, node.y - 12, 24, 24);

        ctx.fillStyle = `rgba(240,136,62,${0.5 * (node.activeTimer / 1.5)})`;
      } else {
        ctx.fillStyle = `rgba(88,166,255,${node.alpha})`;
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw & update pulses
    pulses = pulses.filter(p => {
      p.t += dt * p.speed;
      if (p.t > 1) return false;

      const wire = wires[p.wireIdx];
      const na = nodes[wire.a];
      const nb = nodes[wire.b];
      const t = p.forward ? p.t : 1 - p.t;

      let px, py;
      if (wire.bend) {
        const mx = wire.bendAxis === 'x' ? nb.x : na.x;
        const my = wire.bendAxis === 'x' ? na.y : nb.y;
        if (t < 0.5) {
          const lt = t * 2;
          px = na.x + (mx - na.x) * lt;
          py = na.y + (my - na.y) * lt;
        } else {
          const lt = (t - 0.5) * 2;
          px = mx + (nb.x - mx) * lt;
          py = my + (nb.y - my) * lt;
        }
      } else {
        px = na.x + (nb.x - na.x) * t;
        py = na.y + (nb.y - na.y) * t;
      }

      // Glow
      const pglow = ctx.createRadialGradient(px, py, 0, px, py, p.size * 4);
      pglow.addColorStop(0, `rgba(240,136,62,${p.alpha * 0.3})`);
      pglow.addColorStop(1, 'transparent');
      ctx.fillStyle = pglow;
      ctx.fillRect(px - p.size * 4, py - p.size * 4, p.size * 8, p.size * 8);

      // Core
      ctx.fillStyle = `rgba(240,136,62,${p.alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, p.size, 0, Math.PI * 2);
      ctx.fill();

      return true;
    });

    // Draw & update sparks (expanding rings)
    sparks = sparks.filter(s => {
      s.alpha -= dt * 0.5;
      s.radius += dt * 20;
      if (s.alpha <= 0) return false;

      ctx.strokeStyle = `rgba(248,81,73,${s.alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.stroke();

      return true;
    });

    // Spawn pulses and sparks
    pulseTimer += dt;
    sparkTimer += dt;
    if (pulseTimer > 0.4) {
      pulseTimer = 0;
      if (Math.random() < 0.6) spawnPulse();
    }
    if (sparkTimer > 2.5) {
      sparkTimer = 0;
      if (Math.random() < 0.4) spawnSpark();
    }
  }

  window.addEventListener('resize', resize);
  resize();
  raf = requestAnimationFrame(draw);

  // Cleanup when leaving landing (called externally if needed)
  window._stopLandingBg = function() {
    if (raf) cancelAnimationFrame(raf);
  };
  window._startLandingBg = function() {
    resize();
    raf = requestAnimationFrame(draw);
  };
})();
