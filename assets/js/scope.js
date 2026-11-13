/*
 * scope.js — the hero "bus capture".
 *
 * Builds a J1939 broadcast announce message (BAM) that carries PGN 65259,
 * Component Identification, from source address 0xF9 (off-board diagnostic
 * service tool #1). Every frame is encoded bit by bit as a CAN 2.0B extended
 * data frame: SOF, 29-bit identifier with SRR/IDE, RTR, r1/r0, DLC, data,
 * CRC-15 (polynomial 0x4599), bit stuffing from SOF through the CRC sequence,
 * then the CRC delimiter, ACK slot, ACK delimiter, EOF, and intermission.
 *
 * The waveform shows CAN_H and CAN_L at 500 mV/div around 2.5 V recessive,
 * 250 kbit/s (4 µs per bit), 14 divisions at 50 µs/div = 175 bit times.
 */
(() => {
  'use strict';

  const root = document.querySelector('[data-scope]');
  if (!root) return;

  const canvas = root.querySelector('.scope-canvas');
  const ctx = canvas.getContext('2d');
  const rowsEl = root.querySelector('[data-frame-rows]');
  const reasmWrap = root.querySelector('[data-reassembly-wrap]');
  const reasmEl = root.querySelector('[data-reassembly]');
  const toggle = root.querySelector('[data-scope-toggle]');
  const toggleLabel = root.querySelector('[data-scope-toggle-label]');
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ------------------------------------------------------------------
   * 1. J1939 transport frames
   * ------------------------------------------------------------------ */
  const SA = 0xf9; // Off-board diagnostic-service tool #1
  const PGN_CI = 65259; // 0x00FEEB Component Identification
  const TEXT = 'LEWIS*JACK*EMBEDDED SW*ST PAUL MN*'; // Make*Model*Serial*Unit*
  const payload = Array.from(TEXT, (c) => c.charCodeAt(0));
  const packetCount = Math.ceil(payload.length / 7);

  // Priority 7, EDP 0, DP 0, PDU1 format: PF, PS (destination), SA
  const j1939Id = (pf, ps) => ((7 << 26) | (pf << 16) | (ps << 8) | SA) >>> 0;

  const frames = [
    {
      kind: 'TP.CM',
      id: j1939Id(0xec, 0xff), // TP.CM, PGN 60416, to global
      data: [
        0x20, // control byte 32 = BAM
        payload.length & 0xff,
        (payload.length >> 8) & 0xff,
        packetCount,
        0xff, // reserved
        PGN_CI & 0xff,
        (PGN_CI >> 8) & 0xff,
        (PGN_CI >> 16) & 0xff,
      ],
    },
  ];
  for (let i = 0; i < packetCount; i++) {
    const chunk = payload.slice(i * 7, i * 7 + 7);
    while (chunk.length < 7) chunk.push(0xff); // pad the last packet
    frames.push({ kind: 'TP.DT', seq: i + 1, id: j1939Id(0xeb, 0xff), data: [i + 1, ...chunk] });
  }

  /* ------------------------------------------------------------------
   * 2. CAN 2.0B bit encoding
   * ------------------------------------------------------------------ */
  const bitsOf = (value, n) => {
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push((value >>> i) & 1);
    return out;
  };

  function crc15(seq) {
    let crc = 0;
    for (const { b } of seq) {
      const next = b ^ ((crc >>> 14) & 1);
      crc = (crc << 1) & 0x7fff;
      if (next) crc ^= 0x4599;
    }
    return crc;
  }

  function encode(frame) {
    const seq = [];
    const add = (bits, f) => bits.forEach((b) => seq.push({ b, f }));
    add([0], 'SOF');
    add(bitsOf(frame.id >>> 18, 11), 'ID'); // ID28..ID18
    add([1], 'SRR');
    add([1], 'IDE');
    add(bitsOf(frame.id & 0x3ffff, 18), 'ID'); // ID17..ID0
    add([0], 'RTR');
    add([0], 'R1');
    add([0], 'R0');
    add(bitsOf(frame.data.length, 4), 'DLC');
    frame.data.forEach((v, i) => add(bitsOf(v, 8), 'B' + i));
    const crc = crc15(seq);
    add(bitsOf(crc, 15), 'CRC');

    // Bit stuffing: after five identical bits insert the complement.
    // Stuff bits count toward the next run.
    const out = [];
    let last = -1;
    let run = 0;
    for (const bit of seq) {
      out.push({ b: bit.b, f: bit.f, s: false });
      if (bit.b === last) run++;
      else {
        last = bit.b;
        run = 1;
      }
      if (run === 5) {
        const sb = 1 - last;
        out.push({ b: sb, f: bit.f, s: true });
        last = sb;
        run = 1;
      }
    }
    // Fixed-form tail (not stuffed)
    out.push({ b: 1, f: 'CRCDEL', s: false });
    out.push({ b: 0, f: 'ACK', s: false }); // a receiver drives the slot dominant
    out.push({ b: 1, f: 'ACKDEL', s: false });
    for (let i = 0; i < 7; i++) out.push({ b: 1, f: 'EOF', s: false });
    for (let i = 0; i < 3; i++) out.push({ b: 1, f: 'IFS', s: false });
    return { bits: out, crc };
  }

  const hex = (v, w) => v.toString(16).toUpperCase().padStart(w, '0');

  const GROUP = {
    SOF: null,
    ID: 'ID',
    SRR: 'ID',
    IDE: 'ID',
    RTR: 'CTL',
    R1: 'CTL',
    R0: 'CTL',
    DLC: 'CTL',
    CRC: 'CRC',
    CRCDEL: null,
    ACK: 'ACK',
    ACKDEL: null,
    EOF: 'EOF',
    IFS: null,
  };

  function segmentsFor(frame, enc) {
    const segs = [];
    let cur = null;
    enc.bits.forEach((bit, i) => {
      const g = bit.f.startsWith('B') ? bit.f : GROUP[bit.f];
      if (!cur || cur.g !== g) {
        if (cur) segs.push(cur);
        cur = { g, start: i, end: i };
      } else {
        cur.end = i;
      }
    });
    if (cur) segs.push(cur);
    return segs
      .filter((s) => s.g)
      .map((s) => {
        // Long label first, then shorter fallbacks for narrow screens
        let labels = [];
        let tone = 'neutral';
        if (s.g === 'ID') {
          labels = ['ID ' + hex(frame.id, 8), hex(frame.id, 8), 'ID'];
          tone = 'ch1';
        } else if (s.g === 'CTL') labels = ['DLC ' + frame.data.length, String(frame.data.length)];
        else if (s.g === 'CRC') labels = ['CRC ' + hex(enc.crc, 4), hex(enc.crc, 4), 'CRC'];
        else if (s.g === 'ACK') labels = ['A'];
        else if (s.g === 'EOF') labels = ['EOF'];
        else {
          labels = [hex(frame.data[Number(s.g.slice(1))], 2)];
          tone = 'ch2';
        }
        return { ...s, labels, tone };
      });
  }

  const encoded = frames.map((f) => {
    const enc = encode(f);
    return { frame: f, enc, segs: segmentsFor(f, enc) };
  });

  /* ------------------------------------------------------------------
   * 3. Rendering
   * ------------------------------------------------------------------ */
  const css = getComputedStyle(document.documentElement);
  const C = {
    ch1: css.getPropertyValue('--color-primary').trim() || '#f2cf4a',
    ch2: css.getPropertyValue('--color-ch2').trim() || '#6cd49a',
    text: css.getPropertyValue('--color-text').trim() || '#ecebe6',
    muted: css.getPropertyValue('--color-text-muted').trim() || '#a8aaa8',
  };
  const FONT = '500 12px "JetBrains Mono", ui-monospace, monospace';
  const WINDOW_BITS = 175;
  const PRE_TRIGGER_BITS = 6;
  const DIV_X = 14;
  const DIV_Y = 8;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let plot = { x: 0, y: 0, w: 0, h: 0 };
  let decodeY = 0;
  const decodeH = 24;
  let bitW = 0;
  let x0 = 0;
  let grid = null;
  let traces = [];

  // Deterministic noise so the trace looks analog without flicker.
  const noise = new Float32Array(4096);
  {
    let seed = 1979;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      noise[i] = (seed / 4294967296 - 0.5) * 2;
    }
  }

  function measure() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const padX = W < 520 ? 8 : 12;
    plot = { x: padX, y: 10, w: W - padX * 2, h: Math.max(60, H - 10 - decodeH - 22) };
    decodeY = plot.y + plot.h + 10;
    bitW = plot.w / WINDOW_BITS;
    x0 = plot.x + bitW * PRE_TRIGGER_BITS;
    grid = buildGrid();
    traces = encoded.map((e) => buildTrace(e.enc.bits));
  }

  function buildGrid() {
    const g = document.createElement('canvas');
    g.width = canvas.width;
    g.height = canvas.height;
    const c = g.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { x, y, w, h } = plot;
    const dx = w / DIV_X;
    const dy = h / DIV_Y;

    c.strokeStyle = 'rgba(255,255,255,0.055)';
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i <= DIV_X; i++) {
      const px = Math.round(x + i * dx) + 0.5;
      c.moveTo(px, y);
      c.lineTo(px, y + h);
    }
    for (let j = 0; j <= DIV_Y; j++) {
      const py = Math.round(y + j * dy) + 0.5;
      c.moveTo(x, py);
      c.lineTo(x + w, py);
    }
    c.stroke();

    // Center axes with minor ticks
    const cx = Math.round(x + w / 2) + 0.5;
    const cy = Math.round(y + h / 2) + 0.5;
    c.strokeStyle = 'rgba(255,255,255,0.13)';
    c.beginPath();
    c.moveTo(x, cy);
    c.lineTo(x + w, cy);
    c.moveTo(cx, y);
    c.lineTo(cx, y + h);
    for (let i = 0; i <= DIV_X * 5; i++) {
      const px = Math.round(x + (i * dx) / 5) + 0.5;
      c.moveTo(px, cy - 3);
      c.lineTo(px, cy + 3);
    }
    for (let j = 0; j <= DIV_Y * 5; j++) {
      const py = Math.round(y + (j * dy) / 5) + 0.5;
      c.moveTo(cx - 3, py);
      c.lineTo(cx + 3, py);
    }
    c.stroke();

    // Voltage references at the right edge
    c.font = FONT;
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(168,170,168,0.75)';
    const lvl = h / 4; // 1.0 V at 500 mV/div
    if (h > 120) {
      c.fillText('3.5 V', x + w - 6, y + h / 2 - lvl - 9);
      c.fillText('2.5 V', x + w - 6, y + h / 2 - 9);
      c.fillText('1.5 V', x + w - 6, y + h / 2 + lvl + 9);
    }

    // Trigger marker at SOF
    c.fillStyle = C.ch1;
    c.beginPath();
    c.moveTo(x0 - 5, y);
    c.lineTo(x0 + 5, y);
    c.lineTo(x0, y + 7);
    c.closePath();
    c.fill();
    return g;
  }

  // Returns per-channel y arrays sampled across the plot width.
  function buildTrace(bits) {
    const pts = []; // [x, dominance]
    const push = (px, d) => pts.push([px, d]);
    push(plot.x, 0);
    let prev = 1; // idle recessive
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i].b;
      const bx = x0 + i * bitW;
      if (b !== prev) {
        const toDominant = b === 0;
        const ramp = bitW * (toDominant ? 0.1 : 0.2);
        const from = prev === 0 ? 1 : 0;
        const to = toDominant ? 1 : 0;
        push(bx, from);
        push(bx + ramp, to + (toDominant ? 0.05 : -0.07));
        push(bx + ramp * 1.9, to);
        prev = b;
      }
    }
    push(plot.x + plot.w, prev === 0 ? 1 : 0);

    const step = 1.25;
    const n = Math.ceil(plot.w / step) + 1;
    const xs = new Float32Array(n);
    const hY = new Float32Array(n);
    const lY = new Float32Array(n);
    const cy = plot.y + plot.h / 2;
    const lvl = plot.h / 4;
    let k = 0;
    for (let s = 0; s < n; s++) {
      const px = Math.min(plot.x + s * step, plot.x + plot.w);
      while (k < pts.length - 2 && pts[k + 1][0] < px) k++;
      const [ax, ad] = pts[k];
      const [bx, bd] = pts[k + 1];
      const t = bx === ax ? 0 : Math.min(1, Math.max(0, (px - ax) / (bx - ax)));
      const d = ad + (bd - ad) * t;
      const nz = noise[s % noise.length] * 0.55;
      const nz2 = noise[(s * 7 + 13) % noise.length] * 0.55;
      xs[s] = px;
      hY[s] = cy - d * lvl + nz;
      lY[s] = cy + d * lvl + 1.2 + nz2;
    }
    return { xs, hY, lY, n };
  }

  function strokeChannel(tr, ys, color, upto, alpha) {
    const last = Math.min(tr.n - 1, Math.floor((upto - plot.x) / 1.25));
    if (last < 1) return;
    ctx.beginPath();
    ctx.moveTo(tr.xs[0], ys[0]);
    for (let s = 1; s <= last; s++) ctx.lineTo(tr.xs[s], ys[s]);
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha * 0.16;
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function segPath(xa, xb, y, h) {
    const tip = Math.min(4, (xb - xa) / 2);
    ctx.beginPath();
    ctx.moveTo(xa, y + h / 2);
    ctx.lineTo(xa + tip, y);
    ctx.lineTo(xb - tip, y);
    ctx.lineTo(xb, y + h / 2);
    ctx.lineTo(xb - tip, y + h);
    ctx.lineTo(xa + tip, y + h);
    ctx.closePath();
  }

  function drawDecode(entry, upto) {
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of entry.segs) {
      const xa = x0 + s.start * bitW + 0.5;
      const xbFull = x0 + (s.end + 1) * bitW - 0.5;
      if (xa >= upto) break;
      const xb = Math.min(xbFull, upto);
      const fill = s.tone === 'ch1' ? 'rgba(242,207,74,0.14)' : s.tone === 'ch2' ? 'rgba(108,212,154,0.13)' : 'rgba(236,234,228,0.07)';
      const stroke = s.tone === 'ch1' ? 'rgba(242,207,74,0.6)' : s.tone === 'ch2' ? 'rgba(108,212,154,0.5)' : 'rgba(236,234,228,0.25)';
      segPath(xa, xb, decodeY, decodeH);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
      if (xb >= xbFull - 0.5) {
        const room = xbFull - xa - 6;
        const label = s.labels.find((t) => ctx.measureText(t).width <= room);
        if (label) {
          ctx.fillStyle = s.tone === 'ch1' ? C.ch1 : s.tone === 'ch2' ? C.ch2 : C.muted;
          ctx.fillText(label, (xa + xbFull) / 2, decodeY + decodeH / 2 + 0.5);
        }
      }
    }
  }

  function drawStuffMarks(entry, upto) {
    const y = plot.y + plot.h / 2 - plot.h / 4 - 9;
    ctx.fillStyle = 'rgba(236,234,228,0.6)';
    entry.enc.bits.forEach((bit, i) => {
      if (!bit.s) return;
      const cx = x0 + (i + 0.5) * bitW;
      if (cx > upto) return;
      ctx.beginPath();
      ctx.arc(cx, y, 1.7, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function render(index, progress, ghostIndex, ghostAlpha) {
    ctx.clearRect(0, 0, W, H);
    if (grid) ctx.drawImage(grid, 0, 0, W, H);
    const upto = plot.x + plot.w * progress;

    if (ghostIndex != null && ghostAlpha > 0.01) {
      const g = traces[ghostIndex];
      strokeChannel(g, g.lY, C.ch2, plot.x + plot.w, ghostAlpha);
      strokeChannel(g, g.hY, C.ch1, plot.x + plot.w, ghostAlpha);
    }
    const tr = traces[index];
    strokeChannel(tr, tr.lY, C.ch2, upto, 1);
    strokeChannel(tr, tr.hY, C.ch1, upto, 1);
    drawStuffMarks(encoded[index], upto);
    drawDecode(encoded[index], upto);

    if (progress < 1) {
      // Faint acquisition cursor at the sweep head
      ctx.fillStyle = 'rgba(236,234,228,0.08)';
      ctx.fillRect(upto - 1, plot.y, 2, plot.h);
    }
  }

  /* ------------------------------------------------------------------
   * 4. Event table and reassembly
   * ------------------------------------------------------------------ */
  function asciiFor(frame) {
    if (frame.kind === 'TP.CM') return 'BAM · ' + PGN_CI;
    const chars = frame.data
      .slice(1)
      .filter((b) => b !== 0xff)
      .map((b) => String.fromCharCode(b))
      .join('');
    return '“' + chars + '”';
  }

  function addRow(index, animate) {
    const f = frames[index];
    const tr = document.createElement('tr');
    tr.dataset.kind = f.kind;
    if (animate) tr.className = 'is-new';
    const bytes = f.data.map((b) => hex(b, 2));
    const cells = [
      ['t-type', f.kind + (f.seq ? ' ' + f.seq : '')],
      ['t-id', hex(f.id, 8)],
      ['t-data', null],
      ['t-ascii', asciiFor(f)],
    ];
    for (const [cls, txt] of cells) {
      const td = document.createElement('td');
      td.className = cls;
      if (txt === null) {
        // Two halves so narrow panels can wrap the payload onto two lines
        const lo = document.createElement('span');
        const hi = document.createElement('span');
        lo.textContent = bytes.slice(0, 4).join(' ');
        hi.textContent = bytes.slice(4).join(' ');
        td.append(lo, ' ', hi);
      } else {
        td.textContent = txt;
      }
      tr.appendChild(td);
    }
    const placeholder = rowsEl.querySelector('.is-placeholder');
    if (placeholder) placeholder.remove();
    rowsEl.appendChild(tr);
  }

  function reassembled(upToPacket) {
    return payload
      .slice(0, upToPacket * 7)
      .map((b) => String.fromCharCode(b))
      .join('');
  }

  function updateReassembly(index) {
    const f = frames[index];
    if (f.kind === 'TP.CM') {
      reasmEl.textContent = `Expecting ${payload.length} bytes in ${packetCount} packets…`;
      return;
    }
    reasmEl.textContent = reassembled(f.seq);
    if (f.seq === packetCount) reasmWrap.classList.add('is-complete');
  }

  function resetPanel() {
    const tr = document.createElement('tr');
    tr.className = 'is-placeholder';
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = 'Listening on the bus…';
    tr.appendChild(td);
    rowsEl.replaceChildren(tr);
    reasmEl.textContent = 'Waiting for TP.CM…';
    reasmWrap.classList.remove('is-complete');
  }

  function fillPanelComplete() {
    rowsEl.textContent = '';
    frames.forEach((_, i) => addRow(i, false));
    reasmEl.textContent = TEXT;
    reasmWrap.classList.add('is-complete');
  }

  /* ------------------------------------------------------------------
   * 5. Playback state machine
   * ------------------------------------------------------------------ */
  const T_SWEEP = 1750;
  const T_HOLD = 950;
  const T_FINAL = 3800;

  let index = 0;
  let phase = 'sweep';
  let phaseStart = 0;
  let pausedAt = 0;
  let userPaused = false;
  let offscreen = false;
  let hidden = document.hidden;
  let raf = 0;
  let staticMode = motionQuery.matches;
  let ready = false;

  const suspended = () => userPaused || offscreen || hidden;

  function frameTick(now) {
    raf = 0;
    if (staticMode || suspended()) return;
    const elapsed = now - phaseStart;

    if (phase === 'sweep') {
      const p = Math.min(1, elapsed / T_SWEEP);
      const ghost = index > 0 ? index - 1 : null;
      render(index, p, ghost, 0.2 * (1 - p));
      if (p >= 1) {
        addRow(index, true);
        updateReassembly(index);
        phase = 'hold';
        phaseStart = now;
      }
    } else {
      const holdFor = index === frames.length - 1 ? T_FINAL : T_HOLD;
      if (elapsed >= holdFor) {
        if (index === frames.length - 1) {
          index = 0;
          resetPanel();
        } else {
          index++;
        }
        phase = 'sweep';
        phaseStart = now;
      }
    }
    raf = requestAnimationFrame(frameTick);
  }

  function start() {
    if (!ready || staticMode || suspended() || raf) return;
    raf = requestAnimationFrame(frameTick);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function suspend() {
    if (!pausedAt) pausedAt = performance.now();
    stop();
  }

  function resume() {
    if (suspended() || staticMode) return;
    if (pausedAt) {
      phaseStart += performance.now() - pausedAt;
      pausedAt = 0;
    }
    start();
  }

  function renderStatic() {
    stop();
    index = 1;
    render(1, 1, null, 0);
    fillPanelComplete();
  }

  function setUserPaused(value) {
    userPaused = value;
    toggle.setAttribute('aria-pressed', String(value));
    toggleLabel.textContent = value ? 'Resume capture' : 'Pause capture';
    if (value) suspend();
    else resume();
  }

  toggle.addEventListener('click', () => setUserPaused(!userPaused));

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      (entries) => {
        offscreen = !entries[0].isIntersecting;
        if (offscreen) suspend();
        else resume();
      },
      { threshold: 0.05 },
    ).observe(root);
  }

  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (hidden) suspend();
    else resume();
  });

  function redrawCurrent() {
    if (!ready) return;
    if (staticMode) {
      render(1, 1, null, 0);
      return;
    }
    const p = phase === 'sweep' ? Math.min(1, (performance.now() - phaseStart) / T_SWEEP) : 1;
    render(index, suspended() && phase === 'sweep' ? Math.min(1, ((pausedAt || performance.now()) - phaseStart) / T_SWEEP) : p, null, 0);
  }

  const ro = new ResizeObserver(() => {
    measure();
    redrawCurrent();
  });

  function applyMotionPreference() {
    staticMode = motionQuery.matches;
    toggle.hidden = staticMode;
    if (staticMode) {
      renderStatic();
    } else {
      resetPanel();
      index = 0;
      phase = 'sweep';
      phaseStart = performance.now();
      pausedAt = suspended() ? phaseStart : 0;
      start();
    }
  }

  const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  fontsReady.then(() => {
    measure();
    ready = true;
    ro.observe(canvas);
    applyMotionPreference();
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', applyMotionPreference);
  });

  // Exposed for tests and inspection.
  window.__busCapture = {
    frames: encoded.map((e) => ({
      kind: e.frame.kind,
      id: hex(e.frame.id, 8),
      data: e.frame.data.map((b) => hex(b, 2)).join(' '),
      crc: hex(e.enc.crc, 4),
      bits: e.enc.bits.length,
      stuffBits: e.enc.bits.filter((b) => b.s).length,
    })),
    payload: TEXT,
  };
})();
