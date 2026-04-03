/* ════════════════════════════════════════
   حسّاب v2 — app.js
   - All modals hidden until explicitly opened
   - English (Western) digits everywhere
   - Optional Google Sign-In
════════════════════════════════════════ */
'use strict';

// ── CONSTANTS ──────────────────────────
const COLORS = ['#f5c842','#f5904a','#f76e6e','#3ddba8','#5b9cf6','#b07ef8','#f472b6','#3dd6f5','#a3e635','#fb923c'];
const ICONS  = ['🛒','💼','🏠','✈️','🍔','💊','📚','⛽','🎮','💡','🎁','💰','🏋️','🧾','🔧','📱','🎓','🌿','🎵','🚗'];
const STORAGE_KEY     = 'hassab_v2_data';
const STORAGE_THEME   = 'hassab_v2_theme';
const STORAGE_AUTH    = 'hassab_v2_auth';   // stores Google user info locally

// ── STATE ──────────────────────────────
let state = {
  sections:       [],
  activeId:       null,
  theme:          'dark',
  sidebarOpen:    true,
  searchQuery:    '',
  selectedOp:     '+',
  editingRecord:  null,
  editingSection: null,
  pendingDelete:  null,
  user:           null,   // { name, email, picture, sub }
  authDropOpen:   false,
};

// ── HELPERS ────────────────────────────
const $  = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);

/* Force English (Western) digits — no Arabic-Indic */
function fmt(n) {
  if (n === undefined || n === null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  let str;
  if (abs >= 1_000_000) str = (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  else if (abs >= 10_000) str = (n / 1_000).toFixed(1).replace(/\.?0+$/, '') + 'K';
  else str = (+n.toFixed(4)).toString();
  // ensure Western digits
  return toWestern(str);
}

function toWestern(str) {
  // Replace Arabic-Indic digits ٠١٢٣٤٥٦٧٨٩ with 0-9
  return String(str).replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660)
                    .replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x06F0);
}

function fmtDate(ts) {
  const d = new Date(ts || Date.now());
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const dd = d.getDate();
  const mo = d.getMonth() + 1;
  const yy = d.getFullYear();
  return `${hh}:${mm} — ${dd}/${mo}/${yy}`;
}

function opClass(op) {
  return { '+':'op-plus-bg', '-':'op-minus-bg', '×':'op-times-bg', '÷':'op-divide-bg' }[op] || 'op-plus-bg';
}
function opPillClass(op) {
  return { '+':'plus', '-':'minus', '×':'times', '÷':'divide' }[op] || 'plus';
}

function calcRunning(records, upToIndex) {
  if (!records.length || upToIndex < 0) return 0;
  let total = records[0].num;
  for (let i = 1; i <= upToIndex; i++) {
    const r = records[i];
    if      (r.op === '+') total += r.num;
    else if (r.op === '-') total -= r.num;
    else if (r.op === '×') total *= r.num;
    else if (r.op === '÷') total = r.num !== 0 ? total / r.num : total;
  }
  return Math.round(total * 1e6) / 1e6;
}

function calcTotal(records) {
  return records.length ? calcRunning(records, records.length - 1) : 0;
}

function buildEquation(records, unit) {
  if (!records.length) return '—';
  const u = unit ? ` ${unit}` : '';
  return records.map((r, i) => {
    const lbl = r.label ? `(${r.label})` : '';
    return i === 0
      ? `${r.num}${u} ${lbl}`.trim()
      : `${r.op} ${r.num}${u} ${lbl}`.trim();
  }).join(' ');
}

function sectionById(id) { return state.sections.find(s => s.id === id); }

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

function highlight(text, query) {
  if (!query || !text) return escHtml(text || '');
  const re = new RegExp(`(${escRegex(query)})`, 'gi');
  return escHtml(text).replace(re, '<mark class="highlight">$1</mark>');
}

// ── PERSISTENCE ────────────────────────
function save() {
  try {
    localStorage.setItem(STORAGE_KEY,   JSON.stringify({ sections: state.sections, activeId: state.activeId }));
    localStorage.setItem(STORAGE_THEME, state.theme);
    if (state.user) localStorage.setItem(STORAGE_AUTH, JSON.stringify(state.user));
  } catch(e) { console.warn('save:', e); }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d.sections) state.sections = d.sections;
      if (d.activeId)  state.activeId  = d.activeId;
    }
    const th = localStorage.getItem(STORAGE_THEME);
    if (th) state.theme = th;
    const au = localStorage.getItem(STORAGE_AUTH);
    if (au) state.user = JSON.parse(au);
  } catch(e) { console.warn('load:', e); }
}

// ── TOAST ──────────────────────────────
let _toastTimer;
function toast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ── MODALS ─────────────────────────────
// Open: remove modal-hidden. Close: add modal-hidden.
function openModal(id)  { $(id).classList.remove('modal-hidden'); }
function closeModal(id) { $(id).classList.add('modal-hidden'); }

// Wire [data-close] buttons
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

// Click outside modal inner div to close
document.querySelectorAll('.overlay').forEach(ov => {
  ov.addEventListener('click', e => {
    if (e.target === ov) closeModal(ov.id);
  });
});

// ESC key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['sectionModal','editModal','confirmModal','exportModal'].forEach(closeModal);
    $('searchBar').classList.remove('open');
    closeAuthDropdown();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    $('searchBar').classList.toggle('open');
    if ($('searchBar').classList.contains('open')) $('searchInput').focus();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    openSectionModal(null);
  }
});

// ── THEME ──────────────────────────────
function applyTheme() {
  document.body.classList.toggle('light', state.theme === 'light');
  const icon = $('themeIcon');
  if (state.theme === 'light') {
    icon.innerHTML = `<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  } else {
    icon.innerHTML = `<circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
  }
}

$('themeToggleBtn').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(); save();
  toast(state.theme === 'light' ? '☀️ المظهر الفاتح' : '🌙 المظهر الداكن');
});

// ── SIDEBAR ────────────────────────────
$('sidebarToggle').addEventListener('click', () => {
  state.sidebarOpen = !state.sidebarOpen;
  $('sidebar').classList.toggle('collapsed', !state.sidebarOpen);
  $('sidebarToggle').classList.toggle('active', !state.sidebarOpen);
});

// ── SEARCH ─────────────────────────────
$('searchToggleBtn').addEventListener('click', () => {
  $('searchBar').classList.toggle('open');
  if ($('searchBar').classList.contains('open')) $('searchInput').focus();
  else { state.searchQuery = ''; renderMain(); }
});
$('searchInput').addEventListener('input', e => {
  state.searchQuery = e.target.value.trim().toLowerCase();
  renderMain();
});
$('clearSearch').addEventListener('click', () => {
  $('searchInput').value = '';
  state.searchQuery = '';
  renderMain();
});

// ════════════════════════════════════════
//  GOOGLE AUTH
// ════════════════════════════════════════
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID'; // ← ضع هنا Client ID من Google Console

function renderAuthArea() {
  const area = $('authArea');
  if (!area) return;

  if (!state.user) {
    // Show "تسجيل الدخول" button
    area.innerHTML = `
      <button class="auth-google-btn" id="googleSignInBtn">
        <svg width="16" height="16" viewBox="0 0 48 48">
          <path fill="#EA4335" d="M24 9.5c3.2 0 5.9 1.1 8.1 2.9l6-6C34.5 3.1 29.6 1 24 1 14.8 1 6.9 6.5 3.4 14.3l7 5.4C12.1 13.5 17.6 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.8c4.3-4 6.8-9.9 7.2-17z"/>
          <path fill="#FBBC05" d="M10.4 28.3A14.5 14.5 0 019.5 24c0-1.5.3-2.9.7-4.3l-7-5.4A23 23 0 001 24c0 3.7.9 7.2 2.4 10.3l7-5.4z"/>
          <path fill="#34A853" d="M24 47c5.5 0 10.2-1.8 13.6-4.9l-7.4-5.8c-1.9 1.3-4.3 2-6.2 2-6.4 0-11.9-4-13.9-9.7l-7 5.4C6.9 41.5 14.8 47 24 47z"/>
        </svg>
        تسجيل الدخول
      </button>`;

    // Init Google One-Tap
    if (window.google && GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID') {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      $('googleSignInBtn').addEventListener('click', () => {
        google.accounts.id.prompt();
      });
    } else {
      // Demo mode: simulate login
      $('googleSignInBtn').addEventListener('click', () => {
        toast('⚠️ أضف Google Client ID في app.js لتفعيل تسجيل الدخول الحقيقي', 'error');
      });
    }
  } else {
    // Show avatar + name
    const initial = (state.user.name || 'U')[0].toUpperCase();
    area.innerHTML = `
      <button class="auth-user-btn" id="authUserBtn">
        ${state.user.picture
          ? `<img class="auth-avatar" src="${escHtml(state.user.picture)}" alt="" />`
          : `<div class="auth-avatar-placeholder">${initial}</div>`}
        <span class="auth-name">${escHtml(state.user.name || 'المستخدم')}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        <div class="auth-dropdown modal-hidden" id="authDropdown">
          <div class="auth-dd-info">
            <div class="auth-dd-name">${escHtml(state.user.name || '')}</div>
            <div class="auth-dd-email">${escHtml(state.user.email || '')}</div>
          </div>
          <div style="padding:8px">
            <div class="sync-badge">
              <div class="sync-dot"></div>
              البيانات محفوظة محلياً
            </div>
          </div>
          <button class="auth-dd-item danger" id="signOutBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            تسجيل الخروج
          </button>
        </div>
      </button>`;

    $('authUserBtn').addEventListener('click', e => {
      e.stopPropagation();
      const dd = $('authDropdown');
      if (dd) {
        state.authDropOpen = !state.authDropOpen;
        dd.classList.toggle('modal-hidden', !state.authDropOpen);
      }
    });

    const signOutBtn = $('signOutBtn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', e => {
        e.stopPropagation();
        signOut();
      });
    }
  }
}

function closeAuthDropdown() {
  state.authDropOpen = false;
  const dd = $('authDropdown');
  if (dd) dd.classList.add('modal-hidden');
}

// Close dropdown when clicking elsewhere
document.addEventListener('click', e => {
  if (!e.target.closest('#authArea')) closeAuthDropdown();
});

function handleGoogleCredential(response) {
  try {
    // Decode JWT payload (no verification needed on client)
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    state.user = {
      name:    payload.name    || '',
      email:   payload.email   || '',
      picture: payload.picture || '',
      sub:     payload.sub     || '',
    };
    save();
    renderAuthArea();
    toast(`👋 مرحباً ${state.user.name}!`, 'success');
  } catch(e) {
    console.error('Google auth error:', e);
    toast('فشل تسجيل الدخول', 'error');
  }
}

function signOut() {
  state.user = null;
  localStorage.removeItem(STORAGE_AUTH);
  if (window.google && GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID') {
    google.accounts.id.disableAutoSelect();
  }
  renderAuthArea();
  toast('👋 تم تسجيل الخروج');
}

// ════════════════════════════════════════
//  SECTION MODAL
// ════════════════════════════════════════
let _modalColor = COLORS[0];
let _modalIcon  = ICONS[0];

function buildColorGrid() {
  const grid = $('colorGrid');
  grid.innerHTML = '';
  COLORS.forEach(c => {
    const d = document.createElement('div');
    d.className = 'color-dot' + (c === _modalColor ? ' selected' : '');
    d.style.background = c;
    d.onclick = () => {
      _modalColor = c;
      grid.querySelectorAll('.color-dot').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
    };
    grid.appendChild(d);
  });
}

function buildIconGrid() {
  const grid = $('iconGrid');
  grid.innerHTML = '';
  ICONS.forEach(ic => {
    const d = document.createElement('div');
    d.className = 'icon-option' + (ic === _modalIcon ? ' selected' : '');
    d.textContent = ic;
    d.onclick = () => {
      _modalIcon = ic;
      grid.querySelectorAll('.icon-option').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
    };
    grid.appendChild(d);
  });
}

function openSectionModal(sectionId) {
  state.editingSection = sectionId || null;
  const sec = sectionId ? sectionById(sectionId) : null;
  $('sectionModalTitle').textContent = sec ? 'تعديل القسم' : 'قسم جديد';
  $('sectionNameInput').value  = sec ? sec.name        : '';
  $('sectionUnitInput').value  = sec ? (sec.unit || '') : '';
  _modalColor = sec ? sec.color : COLORS[Math.floor(Math.random() * COLORS.length)];
  _modalIcon  = sec ? sec.icon  : ICONS[0];
  buildColorGrid();
  buildIconGrid();
  openModal('sectionModal');
  setTimeout(() => $('sectionNameInput').focus(), 100);
}

$('newSectionBtn').addEventListener('click', () => openSectionModal(null));

$('saveSectionBtn').addEventListener('click', saveSectionModal);
$('sectionNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') saveSectionModal(); });

function saveSectionModal() {
  const name = $('sectionNameInput').value.trim();
  if (!name) { $('sectionNameInput').focus(); return; }
  const unit = $('sectionUnitInput').value.trim();

  if (state.editingSection) {
    const sec = sectionById(state.editingSection);
    if (sec) { sec.name = name; sec.color = _modalColor; sec.icon = _modalIcon; sec.unit = unit; }
    toast('✅ تم تعديل القسم');
  } else {
    const sec = { id: uid(), name, color: _modalColor, icon: _modalIcon, unit, records: [] };
    state.sections.push(sec);
    state.activeId = sec.id;
    toast('✅ تم إنشاء القسم');
  }
  closeModal('sectionModal');
  save();
  renderSidebar();
  renderMain();
}

// ── DELETE SECTION ──────────────────────
function confirmDeleteSection(id) {
  const sec = sectionById(id);
  if (!sec) return;
  state.pendingDelete = { type: 'section', id };
  $('confirmTitle').textContent = 'حذف القسم';
  $('confirmText').textContent  = `هل تريد حذف قسم "${sec.name}" وجميع عملياته (${sec.records.length} عملية)؟`;
  openModal('confirmModal');
}

// ── ADD RECORD ──────────────────────────
function addRecord() {
  const sec = sectionById(state.activeId);
  if (!sec) return;
  const numStr = $('recNum').value;
  const num    = parseFloat(numStr);
  if (isNaN(num) || numStr === '') { shake($('recNum')); return; }
  const label = $('recLabel').value.trim();
  const note  = $('recNote') ? $('recNote').value.trim() : '';
  const rec   = { id: uid(), op: state.selectedOp, num, label, note, ts: Date.now(), pinned: false };
  sec.records.push(rec);
  $('recNum').value   = '';
  $('recLabel').value = '';
  if ($('recNote')) $('recNote').value = '';
  $('recNum').focus();
  save();
  renderSidebar();
  renderTotalCard(sec);
  renderRecords(sec);
  toast(`${state.selectedOp} ${fmt(num)}${label ? ' (' + label + ')' : ''} ✓`);
}

function shake(el) {
  el.style.borderColor = 'var(--red)';
  el.style.boxShadow   = '0 0 0 3px var(--red-dim)';
  setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 700);
}

// ── EDIT RECORD ─────────────────────────
function openEditModal(secId, recId) {
  const sec = sectionById(secId);
  const rec = sec?.records.find(r => r.id === recId);
  if (!rec) return;
  state.editingRecord = { sectionId: secId, recordId: recId };
  $('editOp').value    = rec.op;
  $('editNum').value   = rec.num;
  $('editLabel').value = rec.label || '';
  $('editNote').value  = rec.note  || '';
  openModal('editModal');
  setTimeout(() => $('editNum').focus(), 100);
}

$('saveEditBtn').addEventListener('click', () => {
  if (!state.editingRecord) return;
  const { sectionId, recordId } = state.editingRecord;
  const sec = sectionById(sectionId);
  const rec = sec?.records.find(r => r.id === recordId);
  if (!rec) return;
  const num = parseFloat($('editNum').value);
  if (isNaN(num)) { shake($('editNum')); return; }
  rec.op    = $('editOp').value;
  rec.num   = num;
  rec.label = $('editLabel').value.trim();
  rec.note  = $('editNote').value.trim();
  closeModal('editModal');
  save();
  renderSidebar();
  renderTotalCard(sec);
  renderRecords(sec);
  toast('✅ تم حفظ التعديل');
});

// ── DELETE RECORD ───────────────────────
function deleteRecord(secId, recId) {
  state.pendingDelete = { type: 'record', id: recId, sectionId: secId };
  const sec = sectionById(secId);
  const rec = sec?.records.find(r => r.id === recId);
  if (!rec) return;
  $('confirmTitle').textContent = 'حذف العملية';
  $('confirmText').textContent  = `هل تريد حذف "${rec.label || fmt(rec.num)}"؟`;
  openModal('confirmModal');
}

// ── CLEAR ALL ───────────────────────────
function confirmClearAll(secId) {
  state.pendingDelete = { type: 'all', sectionId: secId };
  const sec = sectionById(secId);
  $('confirmTitle').textContent = 'مسح جميع العمليات';
  $('confirmText').textContent  = `هل تريد مسح جميع العمليات في "${sec?.name}"؟ (${sec?.records.length} عملية)`;
  openModal('confirmModal');
}

// ── CONFIRM OK ──────────────────────────
$('confirmOkBtn').addEventListener('click', () => {
  const p = state.pendingDelete;
  if (!p) return;

  if (p.type === 'section') {
    state.sections = state.sections.filter(s => s.id !== p.id);
    if (state.activeId === p.id) state.activeId = state.sections[0]?.id || null;
    toast('🗑 تم حذف القسم');
    closeModal('confirmModal');
    save(); renderSidebar(); renderMain();

  } else if (p.type === 'record') {
    const sec  = sectionById(p.sectionId);
    const card = document.querySelector(`[data-rec-id="${p.id}"]`);
    closeModal('confirmModal');
    if (card) {
      card.classList.add('removing');
      setTimeout(() => { _doDeleteRecord(sec, p.id); }, 210);
    } else { _doDeleteRecord(sec, p.id); }

  } else if (p.type === 'all') {
    const sec = sectionById(p.sectionId);
    if (sec) sec.records = [];
    closeModal('confirmModal');
    toast('🗑 تم مسح جميع العمليات');
    save(); renderSidebar(); renderMain();
  }

  state.pendingDelete = null;
});

function _doDeleteRecord(sec, id) {
  if (!sec) return;
  sec.records = sec.records.filter(r => r.id !== id);
  save();
  renderSidebar();
  renderTotalCard(sec);
  renderRecords(sec);
  toast('🗑 تم حذف العملية');
}

// ── PIN ──────────────────────────────────
function togglePin(secId, recId) {
  const sec = sectionById(secId);
  const rec = sec?.records.find(r => r.id === recId);
  if (!rec) return;
  rec.pinned = !rec.pinned;
  save();
  renderRecords(sec);
  toast(rec.pinned ? '📌 تم تثبيت العملية' : '📌 تم إلغاء التثبيت');
}

// ── EXPORT ───────────────────────────────
$('exportBtn').addEventListener('click', () => {
  const sec = sectionById(state.activeId);
  if (!sec) { toast('اختر قسماً أولاً', 'error'); return; }

  const opts = $('exportOptions');
  opts.innerHTML = '';
  const options = [
    { icon:'📄', title:'نص عادي (.txt)',   desc:'ملف نصي بسيط',          fn:() => exportTxt(sec)        },
    { icon:'📊', title:'CSV للجدول',        desc:'مناسب لـ Excel',         fn:() => exportCsv(sec)        },
    { icon:'📋', title:'نسخ للحافظة',       desc:'الصق الملخص في أي مكان', fn:() => copyToClipboard(sec)  },
    { icon:'🖨️', title:'طباعة / PDF',      desc:'اطبع أو احفظ PDF',       fn:() => printSection(sec)     },
  ];
  options.forEach(o => {
    const div = document.createElement('div');
    div.className = 'export-opt';
    div.innerHTML = `<div class="e-icon">${o.icon}</div><div><h4>${o.title}</h4><p>${o.desc}</p></div>`;
    div.onclick = () => { o.fn(); closeModal('exportModal'); };
    opts.appendChild(div);
  });

  openModal('exportModal');
});

function exportTxt(sec) {
  const unit = sec.unit || '';
  let txt = `${'═'.repeat(32)}\nحسّاب — ${sec.name}\n${'═'.repeat(32)}\n\n`;
  sec.records.forEach((r, i) => {
    const run = calcRunning(sec.records, i);
    txt += `${i+1}. ${i===0?'  ':r.op} ${r.num}${unit?' '+unit:''}${r.label?' ('+r.label+')':''}${r.note?' ['+r.note+']':''}\n`;
    txt += `      → ${fmt(run)}${unit?' '+unit:''}\n`;
  });
  txt += `\n${'═'.repeat(32)}\nالإجمالي: ${fmt(calcTotal(sec.records))} ${unit}\n`;
  _downloadFile(`${sec.name}.txt`, txt, 'text/plain');
  toast('📄 تم تصدير الملف');
}

function exportCsv(sec) {
  let csv = 'الترتيب,العملية,الرقم,التسمية,الملاحظة,المجموع التراكمي,الوقت\n';
  sec.records.forEach((r, i) => {
    const run = calcRunning(sec.records, i);
    csv += `${i+1},${i===0?'بداية':r.op},${r.num},"${r.label||''}","${r.note||''}",${run},"${fmtDate(r.ts)}"\n`;
  });
  _downloadFile(`${sec.name}.csv`, '\uFEFF'+csv, 'text/csv');
  toast('📊 تم تصدير CSV');
}

function copyToClipboard(sec) {
  const unit = sec.unit || '';
  let txt = `${sec.icon} ${sec.name}\n${'─'.repeat(24)}\n`;
  sec.records.forEach((r, i) => {
    txt += `${i===0?' ':r.op} ${r.num}${unit?' '+unit:''}${r.label?' ('+r.label+')':''}\n`;
  });
  txt += `${'─'.repeat(24)}\n= ${fmt(calcTotal(sec.records))} ${unit}`;
  navigator.clipboard.writeText(txt)
    .then(()  => toast('📋 تم النسخ للحافظة'))
    .catch(()  => toast('فشل النسخ', 'error'));
}

function printSection(sec) {
  const unit = sec.unit || '';
  const rows = sec.records.map((r,i) => {
    const run = calcRunning(sec.records, i);
    return `<tr><td>${i+1}</td><td>${i===0?'—':r.op}</td><td><b>${r.num}${unit?' '+unit:''}</b></td><td>${r.label||''}</td><td>${r.note||''}</td><td>${fmt(run)} ${unit}</td></tr>`;
  }).join('');
  const w = window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>${sec.name}</title>
    <style>body{font-family:sans-serif;padding:32px;direction:rtl}h1{font-size:22px;margin-bottom:4px}
    p{color:#666;font-size:13px;margin-bottom:20px}table{width:100%;border-collapse:collapse;font-size:14px}
    th,td{border:1px solid #ddd;padding:8px 12px;text-align:right}th{background:#f5f5f5}
    tr:nth-child(even){background:#fafafa}.total{margin-top:16px;font-size:18px;font-weight:700}</style>
    </head><body>
    <h1>${sec.icon} ${sec.name}</h1>
    <p>الوحدة: ${unit||'—'} | العمليات: ${sec.records.length}</p>
    <table><thead><tr><th>#</th><th>العملية</th><th>الرقم</th><th>التسمية</th><th>ملاحظة</th><th>تراكمي</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="total">الإجمالي: ${fmt(calcTotal(sec.records))} ${unit}</p>
    </body></html>`);
  w.document.close(); w.print();
}

function _downloadFile(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename; a.click();
}

// ════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════

function renderSidebar() {
  const list = $('sectionsList');
  list.innerHTML = '';

  if (!state.sections.length) {
    list.innerHTML = `<div style="padding:24px 16px;text-align:center;color:var(--text3);font-size:13px;line-height:1.7">لا توجد أقسام بعد<br>اضغط "جديد" للبدء</div>`;
  } else {
    state.sections.forEach(s => {
      const total = calcTotal(s.records);
      const div   = document.createElement('div');
      div.className = 'section-item' + (s.id === state.activeId ? ' active' : '');
      div.style.setProperty('--item-color', s.color);
      div.innerHTML = `
        <div class="sec-icon" style="background:${s.color}22">${s.icon}</div>
        <div class="sec-body">
          <div class="sec-name">${escHtml(s.name)}</div>
          <div class="sec-meta">${fmt(total)}${s.unit?' '+s.unit:''} · ${s.records.length}</div>
        </div>
        <div class="sec-actions">
          <button class="sec-act-btn edit" title="تعديل">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="sec-act-btn" title="حذف">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
            </svg>
          </button>
        </div>`;
      div.querySelector('.sec-act-btn.edit').onclick = e => { e.stopPropagation(); openSectionModal(s.id); };
      div.querySelector('.sec-act-btn:not(.edit)').onclick = e => { e.stopPropagation(); confirmDeleteSection(s.id); };
      div.onclick = () => { state.activeId = s.id; renderSidebar(); renderMain(); };
      list.appendChild(div);
    });
  }

  const totalOps = state.sections.reduce((a, s) => a + s.records.length, 0);
  $('globalStats').innerHTML = `
    <div class="g-stat"><span>الأقسام</span><strong>${state.sections.length}</strong></div>
    <div class="g-stat"><span>إجمالي العمليات</span><strong>${totalOps}</strong></div>`;
}

function renderMain() {
  const main = $('mainContent');
  const sec  = sectionById(state.activeId);

  if (!sec) {
    main.innerHTML = `
      <div class="welcome">
        <div class="welcome-icon">🧮</div>
        <h2>مرحباً بك في حسّاب</h2>
        <p>دفتر الحساب الذكي الذي يحفظ أسماء كل بند<br>وتاريخ كل عملية — منظم ودقيق.</p>
        <div class="welcome-features">
          <div class="feat-chip">📋 أقسام متعددة</div>
          <div class="feat-chip">🏷 تسميات للأرقام</div>
          <div class="feat-chip">📌 تثبيت العمليات</div>
          <div class="feat-chip">📤 تصدير متعدد</div>
          <div class="feat-chip">🌗 مظهران</div>
          <div class="feat-chip">🔍 بحث سريع</div>
        </div>
        <button class="btn-create-first" id="wcBtn">+ أنشئ قسمك الأول</button>
      </div>`;
    $('wcBtn').onclick = () => openSectionModal(null);
    return;
  }

  main.innerHTML = `
    <div class="section-view" style="--s-color:${sec.color}">
      <div class="top-panel">
        <div class="section-title-row">
          <div class="section-title-icon" style="background:${sec.color}22">${sec.icon}</div>
          <h2>${escHtml(sec.name)}</h2>
          ${sec.unit ? `<span class="section-unit-badge">${escHtml(sec.unit)}</span>` : ''}
        </div>
        <div id="totalCardSlot"></div>
        <div class="stats-grid" id="statsGrid" style="margin-top:12px"></div>
      </div>

      <div class="input-area">
        <div class="input-row">
          <div class="op-pills" id="opPills"></div>
          <input type="number" class="inp inp-num" id="recNum" placeholder="0" step="any" />
          <input type="text"   class="inp inp-label" id="recLabel" placeholder="التسمية (مثال: خبز، وقود...)" maxlength="40" />
          <input type="text"   class="inp inp-note"  id="recNote"  placeholder="ملاحظة..." maxlength="80" />
          <button class="btn-add" id="addRecBtn">إضافة ＋</button>
        </div>
      </div>

      <div class="records-area">
        <div class="records-toolbar">
          <span class="rec-count" id="recCount"></span>
          <div class="toolbar-actions">
            <button class="btn-ghost-sm" id="sortBtn">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="9" y2="18"/>
              </svg>
              فرز
            </button>
            <button class="btn-ghost-sm danger" id="clearAllBtn">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              </svg>
              مسح الكل
            </button>
          </div>
        </div>
        <div id="recordsList"></div>
      </div>
    </div>`;

  _buildOpPills();

  $('addRecBtn').onclick = addRecord;
  $('clearAllBtn').onclick = () => confirmClearAll(sec.id);
  $('recNum').addEventListener('keydown',   e => { if (e.key==='Enter') $('recLabel').focus(); });
  $('recLabel').addEventListener('keydown', e => { if (e.key==='Enter') { $('recNote') ? $('recNote').focus() : addRecord(); } });
  if ($('recNote')) $('recNote').addEventListener('keydown', e => { if (e.key==='Enter') addRecord(); });

  let _sortAsc = false;
  $('sortBtn').onclick = () => {
    _sortAsc = !_sortAsc;
    const sorted = [...sec.records].sort((a,b) => _sortAsc ? a.num-b.num : b.num-a.num);
    _renderList(sec, sorted);
    toast(_sortAsc ? '↑ تصاعدي' : '↓ تنازلي');
  };

  renderTotalCard(sec);
  renderRecords(sec);
}

function _buildOpPills() {
  const pills = $('opPills');
  if (!pills) return;
  pills.innerHTML = '';
  ['+','-','×','÷'].forEach(op => {
    const b = document.createElement('button');
    b.className = `op-pill ${opPillClass(op)}${op===state.selectedOp?' active':''}`;
    b.textContent = op;
    b.onclick = () => {
      state.selectedOp = op;
      pills.querySelectorAll('.op-pill').forEach(p => p.classList.remove('active'));
      b.classList.add('active');
    };
    pills.appendChild(b);
  });
}

function renderTotalCard(sec) {
  const slot = $('totalCardSlot');
  if (!slot) return;
  const total = calcTotal(sec.records);
  const unit  = sec.unit || '';
  const eq    = buildEquation(sec.records, unit);
  let addSum=0, subSum=0, mulCnt=0, divCnt=0;
  sec.records.forEach((r,i) => {
    if (i===0) return;
    if (r.op==='+') addSum+=r.num;
    if (r.op==='-') subSum+=r.num;
    if (r.op==='×') mulCnt++;
    if (r.op==='÷') divCnt++;
  });

  slot.innerHTML = `
    <div class="total-card" style="--s-color:${sec.color}">
      <div>
        <div class="total-label">المجموع الكلي</div>
        <div class="total-number">${fmt(total)}${unit?` <span class="total-unit">${escHtml(unit)}</span>`:''}</div>
        <div class="total-equation">${escHtml(eq)}</div>
      </div>
    </div>`;

  const sg = $('statsGrid');
  if (!sg) return;
  sg.innerHTML = `
    <div class="stat-chip green"><span class="s-label">إضافات</span><span class="s-val">+${fmt(addSum)}</span></div>
    <div class="stat-chip red"  ><span class="s-label">طرح</span><span class="s-val">−${fmt(subSum)}</span></div>
    <div class="stat-chip blue" ><span class="s-label">عمليات</span><span class="s-val">${sec.records.length}</span></div>
    ${mulCnt+divCnt ? `<div class="stat-chip orange"><span class="s-label">ضرب/قسمة</span><span class="s-val">${mulCnt+divCnt}</span></div>` : ''}`;
}

function renderRecords(sec) {
  let records = sec.records;
  if (state.searchQuery) {
    const q = state.searchQuery;
    records = records.filter(r =>
      (r.label||'').toLowerCase().includes(q) ||
      (r.note||'').toLowerCase().includes(q)  ||
      String(r.num).includes(q)
    );
  }
  _renderList(sec, records);
}

function _renderList(sec, records) {
  const list  = $('recordsList');
  const count = $('recCount');
  if (!list) return;

  if (count) {
    count.textContent = state.searchQuery
      ? `${records.length} نتيجة من ${sec.records.length}`
      : `${sec.records.length} عملية`;
  }

  if (!records.length) {
    list.innerHTML = `
      <div class="empty-records">
        <div class="e-icon">${state.searchQuery ? '🔍' : '📋'}</div>
        <p>${state.searchQuery
          ? `لا توجد نتائج لـ "${state.searchQuery}"`
          : 'لا توجد عمليات بعد<br>أضف أول عملية من الحقول أعلاه'}</p>
      </div>`;
    return;
  }

  const pinned   = records.filter(r => r.pinned);
  const unpinned = records.filter(r => !r.pinned);
  const sorted   = [...pinned, ...unpinned];

  list.innerHTML = sorted.map(r => {
    const trueIdx = sec.records.findIndex(x => x.id === r.id);
    const running = calcRunning(sec.records, trueIdx);
    const isFirst = trueIdx === 0;
    const lbl     = state.searchQuery ? highlight(r.label||'', state.searchQuery) : escHtml(r.label||'');

    return `
      <div class="record-card${r.pinned?' pinned':''}" data-rec-id="${r.id}">
        ${r.pinned ? '<div class="pin-dot"></div>' : ''}
        <div class="rec-index">${trueIdx+1}</div>
        <div class="rec-op-badge ${opClass(isFirst?'+':r.op)}">${isFirst ? '①' : r.op}</div>
        <div class="rec-body">
          <div class="rec-main-line">
            <span class="rec-num">${fmt(r.num)}</span>
            ${r.label ? `<span class="rec-label-text">${lbl}</span>` : ''}
          </div>
          ${r.note  ? `<div class="rec-note">📝 ${escHtml(r.note)}</div>` : ''}
          <div class="rec-running">= <span>${fmt(running)}${sec.unit?' '+sec.unit:''}</span></div>
        </div>
        <div class="rec-actions">
          <button class="rec-act" title="${r.pinned?'إلغاء التثبيت':'تثبيت'}" onclick="togglePin('${sec.id}','${r.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="${r.pinned?'currentColor':'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          </button>
          <button class="rec-act edit" title="تعديل" onclick="openEditModal('${sec.id}','${r.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="rec-act del" title="حذف" onclick="deleteRecord('${sec.id}','${r.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
          </button>
        </div>
        <div class="rec-timestamp">${fmtDate(r.ts)}</div>
      </div>`;
  }).join('');
}

// ── DEMO DATA ────────────────────────────
function seedDemo() {
  const now = Date.now(), h = 3600000;
  state.sections = [
    { id:'demo1', name:'السوق الأسبوعي', color:'#f5c842', icon:'🛒', unit:'ريال', records:[
      { id:'r1', op:'+', num:5,   label:'خبز',        note:'',           ts:now-5*h, pinned:false },
      { id:'r2', op:'+', num:16,  label:'جبن',        note:'ماركة ألمعية',ts:now-4*h, pinned:true  },
      { id:'r3', op:'-', num:5,   label:'خصم موز',    note:'',           ts:now-3*h, pinned:false },
      { id:'r4', op:'+', num:12,  label:'لحم',        note:'',           ts:now-2*h, pinned:false },
      { id:'r5', op:'+', num:8,   label:'بيض',        note:'12 حبة',     ts:now-1*h, pinned:false },
    ]},
    { id:'demo2', name:'مصاريف العمل', color:'#5b9cf6', icon:'💼', unit:'ريال', records:[
      { id:'r6', op:'+', num:150, label:'وقود',       note:'',           ts:now-10*h, pinned:false },
      { id:'r7', op:'+', num:80,  label:'غداء',       note:'مطعم الملز', ts:now-9*h,  pinned:false },
      { id:'r8', op:'-', num:30,  label:'استرداد',    note:'',           ts:now-8*h,  pinned:false },
      { id:'r9', op:'×', num:2,   label:'بدل سفر ×2', note:'',           ts:now-7*h,  pinned:true  },
    ]},
  ];
  state.activeId = 'demo1';
}

// ── INIT ─────────────────────────────────
function init() {
  load();
  if (!state.sections.length) seedDemo();
  if (window.innerWidth < 700) state.sidebarOpen = false;

  applyTheme();
  $('sidebar').classList.toggle('collapsed', !state.sidebarOpen);

  renderSidebar();
  renderMain();
  renderAuthArea();

  // Hide splash → show app
  setTimeout(() => {
    $('splash').classList.add('done');
    $('app').style.display = 'flex';
    $('app').style.flexDirection = 'column';
    $('app').style.height = '100vh';
    $('app').classList.remove('app-hidden');
  }, 1500);
}

init();
