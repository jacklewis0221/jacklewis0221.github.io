/*
 * main.js — page interactions.
 * Header state, mobile menu, section highlighting, case-file expansion,
 * the architecture explorer, and the J1939 DTC byte builder.
 */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ------------------------------------------------------------------
   * Header: border once the page scrolls
   * ------------------------------------------------------------------ */
  const header = $('[data-header]');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ------------------------------------------------------------------
   * Mobile menu
   * ------------------------------------------------------------------ */
  const menuToggle = $('[data-menu-toggle]');
  const navList = $('#nav-list');
  const menuLabel = $('[data-menu-label]');
  const wideNav = window.matchMedia('(min-width: 861px)');

  function setMenu(open, { focusToggle = false } = {}) {
    if (!menuToggle || !navList) return;
    navList.classList.toggle('is-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    if (menuLabel) menuLabel.textContent = open ? 'Close menu' : 'Open menu';
    if (!open && focusToggle) menuToggle.focus();
  }

  if (menuToggle && navList) {
    menuToggle.addEventListener('click', () => {
      const open = menuToggle.getAttribute('aria-expanded') !== 'true';
      setMenu(open);
      if (open) {
        const first = $('a', navList);
        if (first) first.focus({ preventScroll: true });
      }
    });
    navList.addEventListener('click', (e) => {
      if (e.target.closest('a')) setMenu(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navList.classList.contains('is-open')) setMenu(false, { focusToggle: true });
    });
    document.addEventListener('click', (e) => {
      if (!navList.classList.contains('is-open')) return;
      if (e.target.closest('#nav-list') || e.target.closest('[data-menu-toggle]')) return;
      setMenu(false);
    });
    const onWide = () => {
      if (wideNav.matches) setMenu(false);
    };
    if (wideNav.addEventListener) wideNav.addEventListener('change', onWide);
  }

  /* ------------------------------------------------------------------
   * Current section in the nav
   * ------------------------------------------------------------------ */
  const navLinks = $$('#nav-list a[href^="#"]');
  const sections = navLinks.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    const visible = new Map();
    const setCurrent = () => {
      let best = null;
      for (const s of sections) {
        if (visible.get(s)) best = s;
      }
      navLinks.forEach((a) => {
        const on = best && a.getAttribute('href') === '#' + best.id;
        if (on) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    };
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => visible.set(en.target, en.isIntersecting));
        setCurrent();
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    sections.forEach((s) => io.observe(s));
  }

  /* ------------------------------------------------------------------
   * Case files: expand / collapse all
   * ------------------------------------------------------------------ */
  const expandAll = $('[data-expand-all]');
  const casefiles = $$('details.casefile');

  function syncExpandAll() {
    if (!expandAll) return;
    const allOpen = casefiles.length > 0 && casefiles.every((d) => d.open);
    expandAll.setAttribute('aria-pressed', String(allOpen));
    expandAll.textContent = allOpen ? 'Collapse all case files' : 'Expand all case files';
  }

  if (expandAll && casefiles.length) {
    expandAll.addEventListener('click', () => {
      const open = expandAll.getAttribute('aria-pressed') !== 'true';
      casefiles.forEach((d) => {
        d.open = open;
      });
      syncExpandAll();
    });
    casefiles.forEach((d) => d.addEventListener('toggle', syncExpandAll));
    syncExpandAll();
  }

  // Printing should include every case file.
  let printState = null;
  window.addEventListener('beforeprint', () => {
    printState = casefiles.map((d) => d.open);
    casefiles.forEach((d) => {
      d.open = true;
    });
  });
  window.addEventListener('afterprint', () => {
    if (!printState) return;
    casefiles.forEach((d, i) => {
      d.open = printState[i];
    });
    printState = null;
    syncExpandAll();
  });

  /* ------------------------------------------------------------------
   * Architecture explorer
   * ------------------------------------------------------------------ */
  const arch = $('[data-arch]');
  if (arch) {
    const panel = $('[data-arch-panel]', arch);
    const panelHome = panel.parentElement;
    const panelNext = panel.nextElementSibling;
    const kicker = $('[data-panel-kicker]', panel);
    const title = $('[data-panel-title]', panel);
    const own = $('[data-panel-own]', panel);
    const body = $('[data-panel-body]', panel);
    const nodes = $$('.arch-node', arch);
    const notes = new Map($$('[data-note]', arch).map((n) => [n.dataset.note, n]));
    const stacked = window.matchMedia('(max-width: 760px)');
    const OWN_LABEL = {
      mine: 'My direct work',
      team: 'Team effort',
      inherited: 'Inherited or vendor',
    };
    let selected = null;

    function placePanel() {
      if (stacked.matches && selected) {
        selected.insertAdjacentElement('afterend', panel);
        panel.classList.add('is-inline');
      } else if (panel.parentElement !== panelHome) {
        panelHome.insertBefore(panel, panelNext);
        panel.classList.remove('is-inline');
      }
    }

    function select(node, { animate = true, reveal = false } = {}) {
      const key = node.dataset.node;
      const note = notes.get(key);
      if (!note) return;
      nodes.forEach((n) => {
        const on = n === node;
        n.classList.toggle('is-selected', on);
        if (on) n.setAttribute('aria-current', 'true');
        else n.removeAttribute('aria-current');
      });
      selected = node;

      const ownKey = note.dataset.own;
      kicker.textContent = ownKey === 'none' ? (key === 'targets' ? 'What gets serviced' : 'Who it serves') : 'Selected component';
      title.textContent = note.dataset.title;
      own.dataset.own = ownKey;
      own.textContent = '';
      if (OWN_LABEL[ownKey]) {
        own.append(document.createElement('i'), OWN_LABEL[ownKey]);
      }
      body.replaceChildren(...$$('p', note).map((p) => p.cloneNode(true)));

      placePanel();

      if (animate) {
        panel.classList.remove('is-updating');
        void panel.offsetWidth; // restart the fade
        panel.classList.add('is-updating');
      }
      if (reveal && stacked.matches) {
        const r = panel.getBoundingClientRect();
        if (r.bottom > window.innerHeight || r.top < 64) {
          panel.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
        }
      }
    }

    nodes.forEach((n) => n.addEventListener('click', () => select(n, { reveal: true })));
    if (stacked.addEventListener) stacked.addEventListener('change', placePanel);

    const initial = nodes.find((n) => n.dataset.node === 'comms') || nodes[0];
    if (initial) select(initial, { animate: false });
  }

  /* ------------------------------------------------------------------
   * J1939 DTC builder (SPN conversion method 0, the current layout)
   * ------------------------------------------------------------------ */
  const dtc = $('[data-dtc]');
  if (dtc) {
    const spnSel = $('[data-dtc-spn]', dtc);
    const fmiSel = $('[data-dtc-fmi]', dtc);
    const ocInput = $('[data-dtc-oc]', dtc);
    const hexOut = $('[data-dtc-hex]', dtc);
    const bitsOut = $('[data-dtc-bits]', dtc);
    const readout = $('[data-dtc-readout]', dtc);
    const hex2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');
    const BYTE_LABELS = [
      ['Byte 1', 'SPN bits 1–8'],
      ['Byte 2', 'SPN bits 9–16'],
      ['Byte 3', 'SPN 17–19 + FMI'],
      ['Byte 4', 'CM + OC'],
    ];
    // Field for each bit, most significant bit first
    const FIELD = [
      Array(8).fill('spn'),
      Array(8).fill('spn'),
      ['spn', 'spn', 'spn', 'fmi', 'fmi', 'fmi', 'fmi', 'fmi'],
      ['cm', 'oc', 'oc', 'oc', 'oc', 'oc', 'oc', 'oc'],
    ];

    const optionText = (sel) => {
      const t = sel.options[sel.selectedIndex].textContent;
      const i = t.indexOf('·');
      return i >= 0 ? t.slice(i + 1).trim() : t;
    };

    const clampOc = (v) => {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n)) return 0;
      return Math.min(126, Math.max(0, n));
    };

    function encodeDtc(spn, fmi, oc, cm = 0) {
      return [spn & 0xff, (spn >> 8) & 0xff, (((spn >> 16) & 0x07) << 5) | (fmi & 0x1f), ((cm & 1) << 7) | (oc & 0x7f)];
    }

    function render() {
      const spn = Number(spnSel.value);
      const fmi = Number(fmiSel.value);
      const oc = clampOc(ocInput.value);
      const bytes = encodeDtc(spn, fmi, oc);

      hexOut.replaceChildren();
      const spnSpan = document.createElement('span');
      spnSpan.className = 'hx-spn';
      spnSpan.textContent = hex2(bytes[0]) + ' ' + hex2(bytes[1]);
      hexOut.append(spnSpan, ' ' + hex2(bytes[2]) + ' ' + hex2(bytes[3]));

      const frag = document.createDocumentFragment();
      bytes.forEach((b, bi) => {
        const wrap = document.createElement('div');
        wrap.className = 'dtc-byte';
        const cells = document.createElement('div');
        cells.className = 'dtc-cells';
        for (let bit = 7; bit >= 0; bit--) {
          const v = (b >> bit) & 1;
          const cell = document.createElement('span');
          cell.className = `dtc-cell f-${FIELD[bi][7 - bit]} ${v ? 'is-one' : 'is-zero'}`;
          cell.textContent = String(v);
          cells.appendChild(cell);
        }
        const label = document.createElement('p');
        label.className = 'dtc-byte-label';
        const strong = document.createElement('b');
        strong.textContent = `${BYTE_LABELS[bi][0]} · ${hex2(b)}`;
        label.append(strong, BYTE_LABELS[bi][1]);
        wrap.append(cells, label);
        frag.appendChild(wrap);
      });
      bitsOut.replaceChildren(frag);

      const s = (t) => {
        const el = document.createElement('strong');
        el.textContent = t;
        return el;
      };
      const name = optionText(spnSel);
      const mode = optionText(fmiSel);
      readout.replaceChildren(
        s(`SPN ${spn}`),
        ` (${name.charAt(0).toLowerCase() + name.slice(1)}) with `,
        s(`FMI ${fmi}`),
        `: ${mode.charAt(0).toLowerCase() + mode.slice(1)}. `,
        s(`OC ${oc}`),
        oc === 0
          ? ' means no occurrences have been counted yet. It is a count, not a timestamp. '
          : oc === 1
            ? ' means the fault has occurred once. It is a count, not a timestamp. '
            : ` means the fault has occurred ${oc} times. It is a count, not a timestamp. `,
        'The conversion-method bit is 0, the current SPN layout.',
      );
    }

    spnSel.addEventListener('change', render);
    fmiSel.addEventListener('change', render);
    ocInput.addEventListener('input', render);
    ocInput.addEventListener('change', () => {
      ocInput.value = String(clampOc(ocInput.value));
      render();
    });
    $$('[data-oc-step]', dtc).forEach((btn) =>
      btn.addEventListener('click', () => {
        ocInput.value = String(clampOc(Number(ocInput.value) + Number(btn.dataset.ocStep)));
        render();
      }),
    );
    render();

    window.__dtc = { encode: (spn, fmi, oc) => encodeDtc(spn, fmi, oc).map(hex2).join(' ') };
  }

  /* ------------------------------------------------------------------
   * Copy email address
   * ------------------------------------------------------------------ */
  $$('[data-copy]').forEach((btn) => {
    const label = $('[data-copy-label]', btn);
    const source = btn.parentElement ? $('[data-copy-source]', btn.parentElement) : null;
    let timer = 0;

    const flash = (text, done) => {
      label.textContent = text;
      btn.classList.toggle('is-done', done);
      clearTimeout(timer);
      timer = setTimeout(() => {
        label.textContent = 'Copy';
        btn.classList.remove('is-done');
      }, 2200);
    };

    // Without clipboard access, select the address so it can be copied by hand.
    const selectSource = () => {
      if (!source) return false;
      const range = document.createRange();
      range.selectNodeContents(source);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    };

    btn.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard || !window.isSecureContext) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(btn.dataset.copy);
        flash('Copied', true);
      } catch (err) {
        flash(selectSource() ? 'Selected' : 'Copy', false);
      }
    });
  });
})();
