/* ════════════════════════════════════════
   حسّاب v3 — app.js
   - Internal local accounts and guest mode
   - Separate saved profile for each user
   - English (Western) digits everywhere
════════════════════════════════════════ */
'use strict';

// ── CONSTANTS ──────────────────────────
const COLORS = ['#f5c842','#f5904a','#f76e6e','#3ddba8','#5b9cf6','#b07ef8','#f472b6','#3dd6f5','#a3e635','#fb923c'];
const ICONS  = ['🛒','💼','🏠','✈️','🍔','💊','📚','⛽','🎮','💡','🎁','💰','🏋️','🧾','🔧','📱','🎓','🌿','🎵','🚗'];
const STORAGE_USERS   = 'hassab_v3_users';
const STORAGE_GUEST   = 'hassab_v3_guest';
const STORAGE_PROFILE = 'hassab_v3_profile';

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
  user:           { kind: 'guest', username: 'guest', name: 'ضيف' },
  authDropOpen:   false,
  authMode:       'login',
  sectionSearchQuery: '',
};

// ── HELPERS ────────────────────────────
const $  = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);

/* Force English (Western) digits — no Arabic-Indic */
function fmt(n) {
  if (n === undefined || n === null || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const rounded = Math.round(num * 1e4) / 1e4;
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 4,
    useGrouping: true,
  }).format(rounded);
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
function emptyProfile() {
  return { sections: [], activeId: null, theme: 'dark', sidebarOpen: true };
}

function usersDb() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_USERS) || '{}') || {};
  } catch {
    return {};
  }
}

function saveUsersDb(db) {
  localStorage.setItem(STORAGE_USERS, JSON.stringify(db));
}

function save() {
  saveProfileData(state.user);
}

function loadProfileData(profile = state.user) {
  try {
    if (!profile || profile.kind === 'guest') {
      const raw = localStorage.getItem(STORAGE_GUEST);
      return raw ? JSON.parse(raw) : emptyProfile();
    }
    const db = usersDb();
    return db[profile.username]?.profile ? db[profile.username].profile : emptyProfile();
  } catch (e) {
    console.warn('loadProfileData:', e);
    return emptyProfile();
  }
}

function saveProfileData(profile = state.user) {
  const payload = {
    sections: state.sections,
    activeId: state.activeId,
    theme: state.theme,
    sidebarOpen: state.sidebarOpen,
  };
  try {
    if (!profile || profile.kind === 'guest') {
      localStorage.setItem(STORAGE_GUEST, JSON.stringify(payload));
    } else {
      const db = usersDb();
      if (!db[profile.username]) return;
      db[profile.username].profile = payload;
      db[profile.username].updatedAt = Date.now();
      saveUsersDb(db);
    }
    localStorage.setItem(STORAGE_PROFILE, JSON.stringify({
      kind: profile?.kind || 'guest',
      username: profile?.username || 'guest',
      name: profile?.name || 'ضيف',
    }));
  } catch(e) { console.warn('saveProfileData:', e); }
}

function load() {
  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_PROFILE) || 'null');
    if (current && current.kind === 'account' && current.username) {
      const db = usersDb();
      if (db[current.username]) {
        state.user = { kind: 'account', username: current.username, name: db[current.username].name || current.name || current.username };
      } else {
        state.user = { kind: 'guest', username: 'guest', name: 'ضيف' };
      }
    } else {
      state.user = { kind: 'guest', username: 'guest', name: 'ضيف' };
    }

    const data = loadProfileData(state.user);
    if (data && typeof data === 'object') {
      if (Array.isArray(data.sections)) state.sections = data.sections;
      if (data.activeId !== undefined)  state.activeId = data.activeId;
      if (data.theme) state.theme = data.theme;
      if (typeof data.sidebarOpen === 'boolean') state.sidebarOpen = data.sidebarOpen;
    }
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
    ['sectionModal','editModal','confirmModal','exportModal','authModal'].forEach(closeModal);
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

const sectionSearchInput = $('sectionSearchInput');
if (sectionSearchInput) {
  sectionSearchInput.addEventListener('input', e => {
    state.sectionSearchQuery = e.target.value.trim().toLowerCase();
    renderSidebar();
  });
}

// ════════════════════════════════════════
//  INTERNAL AUTH
// ════════════════════════════════════════
const MIN_USERNAME_LEN = 3;
const MIN_CODE_LEN = 4;

function normalizeUsername(name) {
  return String(name || '')
    .trim()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function hashCode(code) {
  const data = new TextEncoder().encode(String(code));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function showAuthFields(mode = 'login') {
  state.authMode = mode;
  const form = $('authForm');
  if (!form) return;
  form.dataset.mode = mode;
  $('authModalTitle').textContent = mode === 'register' ? 'إنشاء حساب داخلي' : 'تسجيل الدخول';
  $('authSubmitBtn').textContent = mode === 'register' ? 'إنشاء الحساب' : 'دخول';
  $('authSwitchText').textContent = mode === 'register'
    ? 'لديك حساب بالفعل؟'
    : 'لا تملك حسابًا بعد؟';
  $('authSwitchBtn').textContent = mode === 'register' ? 'تسجيل الدخول' : 'إنشاء حساب';
  const confirmRow = $('authConfirmRow');
  if (confirmRow) confirmRow.style.display = mode === 'register' ? 'block' : 'none';
  $('authCodeConfirm').required = mode === 'register';
  $('authCode').value = '';
  $('authCodeConfirm').value = '';
}

function openAuthModal(mode = 'login') {
  showAuthFields(mode);
  openModal('authModal');
  setTimeout(() => $('authUsername').focus(), 80);
}

function closeAuthModal() {
  closeModal('authModal');
}

function renderAuthArea() {
  const area = $('authArea');
  if (!area) return;

  const isGuest = !state.user || state.user.kind === 'guest';
  const label = isGuest ? 'ضيف' : (state.user.name || state.user.username || 'مستخدم');
  const badge = isGuest ? 'G' : (label[0] || 'U').toUpperCase();

  area.innerHTML = `
    <button class="auth-local-btn" id="authUserBtn" type="button">
      <span class="auth-badge">${escHtml(badge)}</span>
      <span class="auth-name">${escHtml(label)}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      <div class="auth-dropdown modal-hidden" id="authDropdown">
        <div class="auth-dd-info">
          <div class="auth-dd-name">${escHtml(label)}</div>
          <div class="auth-dd-email">${isGuest ? 'العمل في وضع الضيف' : escHtml(state.user.username)}</div>
        </div>
        <div style="padding:8px">
          <div class="sync-badge">
            <div class="sync-dot"></div>
            ${isGuest ? 'البيانات محفوظة على هذا الجهاز فقط' : 'البيانات محفوظة داخل الحساب'}
          </div>
        </div>
        <button class="auth-dd-item" id="switchAccountBtn" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
          ${isGuest ? 'تسجيل / إنشاء حساب' : 'تبديل الحساب'}
        </button>
        <button class="auth-dd-item danger" id="signOutBtn" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          ${isGuest ? 'إغلاق' : 'العودة إلى الضيف'}
        </button>
      </div>
    </button>`;

  $('authUserBtn').addEventListener('click', e => {
    e.stopPropagation();
    const dd = $('authDropdown');
    if (!dd) return;
    state.authDropOpen = !state.authDropOpen;
    dd.classList.toggle('modal-hidden', !state.authDropOpen);
  });

  const switchBtn = $('switchAccountBtn');
  if (switchBtn) {
    switchBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeAuthDropdown();
      openAuthModal('login');
    });
  }

  const signOutBtn = $('signOutBtn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeAuthDropdown();
      signOut();
    });
  }
}

function closeAuthDropdown() {
  state.authDropOpen = false;
  const dd = $('authDropdown');
  if (dd) dd.classList.add('modal-hidden');
}

async function submitAuth() {
  const username = normalizeUsername($('authUsername').value);
  const code = String($('authCode').value || '');
  const confirm = String($('authCodeConfirm')?.value || '');

  if (username.length < MIN_USERNAME_LEN) {
    toast(`اسم المستخدم يجب أن يكون ${MIN_USERNAME_LEN} أحرف على الأقل`, 'error');
    $('authUsername').focus();
    return;
  }
  if (code.length < MIN_CODE_LEN) {
    toast(`الرمز يجب أن يكون ${MIN_CODE_LEN} أحرف على الأقل`, 'error');
    $('authCode').focus();
    return;
  }

  const db = usersDb();

  if (state.authMode === 'register') {
    if (code !== confirm) {
      toast('الرمزان غير متطابقين', 'error');
      $('authCodeConfirm').focus();
      return;
    }
    if (db[username]) {
      toast('اسم المستخدم غير صالح أو مستخدم مسبقًا', 'error');
      $('authUsername').focus();
      return;
    }
    const codeHash = await hashCode(code);
    db[username] = {
      username,
      name: $('authDisplayName')?.value.trim() || username,
      codeHash,
      createdAt: Date.now(),
      profile: emptyProfile(),
    };
    saveUsersDb(db);
    state.user = { kind: 'account', username, name: db[username].name || username };
    const data = loadProfileData(state.user);
    state.sections = data.sections || [];
    state.activeId = data.activeId || null;
    state.theme = data.theme || 'dark';
    state.sidebarOpen = typeof data.sidebarOpen === 'boolean' ? data.sidebarOpen : true;
    saveProfileData(state.user);
    closeModal('authModal');
    renderAuthArea();
    applyTheme();
    $('sidebar').classList.toggle('collapsed', !state.sidebarOpen);
    renderSidebar();
    renderMain();
    toast('✅ تم إنشاء الحساب');
    return;
  }

  const user = db[username];
  if (!user) {
    toast('اسم المستخدم غير موجود', 'error');
    $('authUsername').focus();
    return;
  }
  const codeHash = await hashCode(code);
  if (user.codeHash !== codeHash) {
    toast('الرمز غير صحيح', 'error');
    $('authCode').focus();
    return;
  }

  state.user = { kind: 'account', username, name: user.name || username };
  const data = user.profile || emptyProfile();
  state.sections = data.sections || [];
  state.activeId = data.activeId || null;
  state.theme = data.theme || 'dark';
  state.sidebarOpen = typeof data.sidebarOpen === 'boolean' ? data.sidebarOpen : true;
  saveProfileData(state.user);
  closeModal('authModal');
  renderAuthArea();
  applyTheme();
  $('sidebar').classList.toggle('collapsed', !state.sidebarOpen);
  renderSidebar();
  renderMain();
  toast(`👋 مرحباً ${state.user.name}!`, 'success');
}

function signOut() {
  saveProfileData(state.user);
  state.user = { kind: 'guest', username: 'guest', name: 'ضيف' };
  const data = loadProfileData(state.user);
  state.sections = data.sections || [];
  state.activeId = data.activeId || null;
  state.theme = data.theme || 'dark';
  state.sidebarOpen = typeof data.sidebarOpen === 'boolean' ? data.sidebarOpen : true;
  localStorage.setItem(STORAGE_PROFILE, JSON.stringify({ kind: 'guest', username: 'guest', name: 'ضيف' }));
  renderAuthArea();
  applyTheme();
  $('sidebar').classList.toggle('collapsed', !state.sidebarOpen);
  renderSidebar();
  renderMain();
  toast('تم الانتقال إلى وضع الضيف');
}

$('authLoginTab').addEventListener('click', () => {
  $('authLoginTab').classList.add('active');
  $('authRegisterTab').classList.remove('active');
  showAuthFields('login');
});

$('authRegisterTab').addEventListener('click', () => {
  $('authRegisterTab').classList.add('active');
  $('authLoginTab').classList.remove('active');
  showAuthFields('register');
});

$('authSwitchBtn').addEventListener('click', () => {
  if (state.authMode === 'register') {
    $('authRegisterTab').classList.remove('active');
    $('authLoginTab').classList.add('active');
    showAuthFields('login');
  } else {
    $('authLoginTab').classList.remove('active');
    $('authRegisterTab').classList.add('active');
    showAuthFields('register');
  }
});

$('authSubmitBtn').addEventListener('click', () => { submitAuth(); });
$('authUsername').addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
$('authCode').addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
$('authCodeConfirm').addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });

// ════════════════════════════════════════
//  SECTION MODAL// ════════════════════════════════════════
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

  const q = state.sectionSearchQuery.trim().toLowerCase();
  let visibleSections = state.sections;
  if (q) {
    visibleSections = state.sections.filter(s => {
      const hay = [s.name, s.unit, ...(s.records || []).flatMap(r => [r.label, r.note, String(r.num)])]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  if (!visibleSections.length) {
    list.innerHTML = `<div style="padding:24px 16px;text-align:center;color:var(--text3);font-size:13px;line-height:1.7">${q ? 'لا توجد نتائج مطابقة' : 'لا توجد أقسام بعد<br>اضغط "جديد" للبدء'}</div>`;
  } else {
    visibleSections.forEach(s => {
      const total = calcTotal(s.records);
      const div   = document.createElement('div');
      div.className = 'section-item' + (s.id === state.activeId ? ' active' : '');
      div.style.setProperty('--item-color', s.color);
      div.innerHTML = `
        <div class="sec-icon" style="background:${s.color}22">${s.icon}</div>
        <div class="sec-body">
          <div class="sec-name">${q ? highlight(s.name, q) : escHtml(s.name)}</div>
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
          <div class="text-stack">
            <input type="text"   class="inp inp-label" id="recLabel" placeholder="التسمية (مثال: خبز، وقود...)" maxlength="40" />
            <input type="text"   class="inp inp-note"  id="recNote"  placeholder="ملاحظة (اختياري)" maxlength="80" />
          </div>
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
      String(r.num).toLowerCase().includes(q) ||
      fmt(r.num).toLowerCase().includes(q)
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
  if (window.innerWidth < 700 && typeof state.sidebarOpen !== 'boolean') state.sidebarOpen = false;

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
