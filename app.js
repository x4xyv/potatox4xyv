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
const STORAGE_FIRST_RUN = 'hassab_v3_first_run_done';

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
  user:           { kind: 'none', username: '', name: '' },
  sessionPromptOpen: false,
  allowGuestEntry: false,
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
  let hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const dd = d.getDate();
  const mo = d.getMonth() + 1;
  const yy = d.getFullYear();
  const period = hh < 12 ? 'صباحاً' : 'مساءً';
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${String(hh).padStart(2, '0')}:${mm} ${period} — ${dd}/${mo}/${yy}`;
}

function opClass(op) {
  return { '+':'op-plus-bg', '-':'op-minus-bg', '×':'op-times-bg', '÷':'op-divide-bg' }[op] || 'op-plus-bg';
}
function opPillClass(op) {
  return { '+':'plus', '-':'minus', '×':'times', '÷':'divide' }[op] || 'plus';
}

function roundNumber(value, places = 12) {
  if (!Number.isFinite(value)) return 0;
  return Number.parseFloat(Number(value).toFixed(places));
}

function applyOperation(total, value, op) {
  switch (op) {
    case '+': return roundNumber(total + value);
    case '-': return roundNumber(total - value);
    case '×': return roundNumber(total * value);
    case '÷': return value !== 0 ? roundNumber(total / value) : total;
    default:  return roundNumber(value);
  }
}

function calcRunning(records, upToIndex) {
  if (!records.length || upToIndex < 0) return 0;
  let total = Number(records[0].num) || 0;
  for (let i = 1; i <= upToIndex; i++) {
    const r = records[i];
    total = applyOperation(total, Number(r.num) || 0, r.op);
  }
  return roundNumber(total);
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
    ['sectionModal','editModal','confirmModal','exportModal','authModal','sessionModal'].forEach(closeModal);
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
  if (!sectionById(state.activeId)) {
    toast('البحث متاح داخل قسم العمليات فقط', 'error');
    return;
  }
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
const MIN_CODE_LEN = 6;

function normalizeUsername(name) {
  return String(name || '')
    .trim()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isStrongPassword(code) {
  const value = String(code || '');
  return value.length >= MIN_CODE_LEN && /[A-Z]/.test(value) && /[a-z]/.test(value);
}

function passwordRulesText() {
  return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل، وتحتوي على حرف إنكليزي كبير وحرف إنكليزي صغير على الأقل.';
}

async function hashCode(code) {
  const data = new TextEncoder().encode(String(code));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function profilesDb() {
  return usersDb();
}

function getSavedAccounts() {
  const db = profilesDb();
  return Object.values(db)
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
}

function loadProfileData(profile = state.user) {
  try {
    if (!profile || profile.kind === 'none') {
      return emptyProfile();
    }
    if (profile.kind === 'guest') {
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

function applyProfileData(profile, data) {
  const profileData = data || emptyProfile();
  state.sections = Array.isArray(profileData.sections) ? profileData.sections : [];
  state.activeId = profileData.activeId || state.sections[0]?.id || null;
  state.theme = profileData.theme || 'dark';
  state.sidebarOpen = typeof profileData.sidebarOpen === 'boolean' ? profileData.sidebarOpen : true;
  if (profile?.kind !== 'account' && profile?.kind !== 'guest') {
    state.sidebarOpen = true;
  }
}

function saveProfileData(profile = state.user) {
  if (!profile || profile.kind === 'none') return;

  const payload = {
    sections: state.sections,
    activeId: state.activeId,
    theme: state.theme,
    sidebarOpen: state.sidebarOpen,
  };

  try {
    if (profile.kind === 'guest') {
      localStorage.setItem(STORAGE_GUEST, JSON.stringify(payload));
      localStorage.setItem(STORAGE_PROFILE, JSON.stringify({ kind: 'guest', username: 'guest', name: 'ضيف' }));
    } else {
      const db = usersDb();
      if (!db[profile.username]) return;
      db[profile.username].profile = payload;
      db[profile.username].name = db[profile.username].name || profile.name || profile.username;
      db[profile.username].updatedAt = Date.now();
      saveUsersDb(db);
      localStorage.setItem(STORAGE_PROFILE, JSON.stringify({
        kind: 'account',
        username: profile.username,
        name: profile.name || db[profile.username].name || profile.username,
      }));
    }
    localStorage.setItem(STORAGE_FIRST_RUN, '1');
  } catch(e) { console.warn('saveProfileData:', e); }
}

function clearGuestData() {
  localStorage.removeItem(STORAGE_GUEST);
  const current = JSON.parse(localStorage.getItem(STORAGE_PROFILE) || 'null');
  if (current?.kind === 'guest') {
    localStorage.removeItem(STORAGE_PROFILE);
  }
}

function load() {
  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_PROFILE) || 'null');

    if (current && current.kind === 'account' && current.username) {
      const db = usersDb();
      if (db[current.username]) {
        state.user = { kind: 'account', username: current.username, name: db[current.username].name || current.name || current.username };
        const data = loadProfileData(state.user);
        applyProfileData(state.user, data);
      } else {
        state.user = { kind: 'none', username: '', name: '' };
        applyProfileData(state.user, emptyProfile());
      }
    } else if (current && current.kind === 'guest') {
      state.user = { kind: 'guest', username: 'guest', name: 'ضيف' };
      const data = loadProfileData(state.user);
      applyProfileData(state.user, data);
    } else {
      state.user = { kind: 'none', username: '', name: '' };
      applyProfileData(state.user, emptyProfile());
    }

    state.allowGuestEntry = !localStorage.getItem(STORAGE_FIRST_RUN);
  } catch(e) { console.warn('load:', e); }
}

function syncSearchVisibility() {
  const hasSection = !!sectionById(state.activeId);
  const bar = $('searchBar');
  const btn = $('searchToggleBtn');
  if (!bar || !btn) return;
  if (!hasSection) {
    bar.classList.remove('open');
    state.searchQuery = '';
    const input = $('searchInput');
    if (input) input.value = '';
    btn.disabled = true;
    btn.title = 'البحث متاح داخل قسم العمليات فقط';
  } else {
    btn.disabled = false;
    btn.title = 'بحث';
  }
}

// ── MODALS ─────────────────────────────
// Open: remove modal-hidden. Close: add modal-hidden.
function openModal(id)  { $(id).classList.remove('modal-hidden'); }
function closeModal(id) { $(id).classList.add('modal-hidden'); }

function openSessionPrompt({ allowGuest = false } = {}) {
  state.sessionPromptOpen = true;
  state.allowGuestEntry = !!allowGuest;
  renderSessionModal();
  openModal('sessionModal');
}

function closeSessionPrompt() {
  state.sessionPromptOpen = false;
  closeModal('sessionModal');
}

function openAuthModal(mode = 'login', presetUsername = '') {
  showAuthFields(mode);
  openModal('authModal');
  if (presetUsername) {
    $('authUsername').value = presetUsername;
  }
  setTimeout(() => {
    const target = presetUsername ? $('authCode') : $('authUsername');
    if (target) target.focus();
  }, 80);
}

function closeAuthModal() {
  closeModal('authModal');
}

function showAuthFields(mode = 'login') {
  state.authMode = mode;
  const form = $('authForm');
  if (!form) return;
  form.dataset.mode = mode;
  $('authModalTitle').textContent = mode === 'register' ? 'إنشاء حساب' : 'تسجيل الدخول';
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
  if (mode === 'register') {
    $('authCode').placeholder = 'مثال: Aq1234!';
  } else {
    $('authCode').placeholder = 'أدخل كلمة المرور';
  }
  const help = $('authHelpText');
  if (help) help.textContent = passwordRulesText();
}

function renderSessionModal() {
  const list = $('sessionAccountsList');
  const guestBtn = $('sessionGuestBtn');
  const guestWrap = $('sessionGuestWrap');
  const accounts = getSavedAccounts();

  if (list) {
    if (!accounts.length) {
      list.innerHTML = `
        <div class="session-empty">
          لا توجد حسابات محفوظة بعد.
        </div>`;
    } else {
      list.innerHTML = accounts.map(acc => `
        <button type="button" class="session-account" data-username="${escHtml(acc.username)}">
          <div class="session-account-main">
            <strong>${escHtml(acc.name || acc.username)}</strong>
            <span>${escHtml(acc.username)}</span>
          </div>
          <span class="session-account-action">دخول</span>
        </button>`).join('');

      list.querySelectorAll('.session-account').forEach(btn => {
        btn.addEventListener('click', () => {
          const username = btn.dataset.username;
          closeSessionPrompt();
          openAuthModal('login', username);
        });
      });
    }
  }

  if (guestWrap) {
    guestWrap.style.display = state.allowGuestEntry ? 'block' : 'none';
  }
  if (guestBtn) {
    guestBtn.disabled = false;
    guestBtn.textContent = state.allowGuestEntry ? 'الدخول كضيف' : 'وضع الضيف غير متاح الآن';
  }
}

function renderAuthArea() {
  const area = $('authArea');
  if (!area) return;

  const isAccount = state.user && state.user.kind === 'account';
  const isGuest = state.user && state.user.kind === 'guest';
  const label = isAccount ? (state.user.name || state.user.username || 'مستخدم') : (isGuest ? 'ضيف' : 'اختيار حساب');
  const badge = isAccount ? (label[0] || 'U').toUpperCase() : (isGuest ? 'G' : '؟');
  const accounts = getSavedAccounts();

  area.innerHTML = `
    <div class="auth-local-wrap">
      <button class="auth-local-btn" id="authUserBtn" type="button">
        <span class="auth-badge">${escHtml(badge)}</span>
        <span class="auth-name">${escHtml(label)}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="auth-dropdown modal-hidden" id="authDropdown">
        <div class="auth-dd-info">
          <div class="auth-dd-name">${escHtml(label)}</div>
          <div class="auth-dd-email">${isAccount ? escHtml(state.user.username) : (isGuest ? 'العمل في وضع الضيف' : 'لم يتم اختيار حساب بعد')}</div>
        </div>
        <div style="padding:8px">
          <div class="sync-badge">
            <div class="sync-dot"></div>
            ${isGuest ? 'البيانات محفوظة محليًا للضيف' : (isAccount ? 'البيانات محفوظة داخل الحساب' : 'اختر حسابًا أو أنشئ واحدًا')}
          </div>
        </div>
        <button class="auth-dd-item" id="switchAccountBtn" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
          ${isAccount ? 'تبديل الحساب' : 'فتح شاشة الحسابات'}
        </button>
        <button class="auth-dd-item" id="createAccountBtn" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          إنشاء حساب جديد
        </button>
        ${state.allowGuestEntry ? `
        <button class="auth-dd-item" id="guestEntryBtn" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M12 8v4l3 2"/></svg>
          الدخول كضيف
        </button>` : ''}
        <div class="auth-dd-divider"></div>
        ${accounts.length ? `
          <div class="auth-dd-mini-title">الحسابات السريعة</div>
          ${accounts.map(acc => `
            <button class="auth-dd-item auth-dd-account" type="button" data-account="${escHtml(acc.username)}">
              <span>${escHtml(acc.name || acc.username)}</span>
              <small>${escHtml(acc.username)}</small>
            </button>`).join('')}
        ` : ''}
        <button class="auth-dd-item danger" id="signOutBtn" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          ${isAccount ? 'تسجيل الخروج' : (isGuest ? 'الخروج من الضيف' : 'إغلاق')}
        </button>
      </div>
    </div>`;

  const userBtn = $('authUserBtn');
  if (userBtn) {
    userBtn.addEventListener('click', e => {
      e.stopPropagation();
      const dd = $('authDropdown');
      if (!dd) return;
      state.authDropOpen = !state.authDropOpen;
      dd.classList.toggle('modal-hidden', !state.authDropOpen);
    });
  }

  const switchBtn = $('switchAccountBtn');
  if (switchBtn) {
    switchBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeAuthDropdown();
      openSessionPrompt({ allowGuest: state.allowGuestEntry });
    });
  }

  const createBtn = $('createAccountBtn');
  if (createBtn) {
    createBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeAuthDropdown();
      closeSessionPrompt();
      openAuthModal('register');
    });
  }

  const guestBtn = $('guestEntryBtn');
  if (guestBtn) {
    guestBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeAuthDropdown();
      closeSessionPrompt();
      enterGuestMode();
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

  area.querySelectorAll('[data-account]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const username = btn.dataset.account;
      closeAuthDropdown();
      openAuthModal('login', username);
    });
  });
}

function closeAuthDropdown() {
  state.authDropOpen = false;
  const dd = $('authDropdown');
  if (dd) dd.classList.add('modal-hidden');
}

function enterGuestMode() {
  state.user = { kind: 'guest', username: 'guest', name: 'ضيف' };
  const data = loadProfileData(state.user);
  applyProfileData(state.user, data);
  saveProfileData(state.user);
  localStorage.setItem(STORAGE_FIRST_RUN, '1');
  closeSessionPrompt();
  renderAuthArea();
  applyTheme();
  $('sidebar').classList.toggle('collapsed', !state.sidebarOpen);
  renderSidebar();
  renderMain();
  toast('تم الدخول كضيف');
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

  if (!isStrongPassword(code)) {
    toast(passwordRulesText(), 'error');
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
      toast('اسم المستخدم مستخدم مسبقًا', 'error');
      $('authUsername').focus();
      return;
    }
    const codeHash = await hashCode(code);
    db[username] = {
      username,
      name: $('authDisplayName')?.value.trim() || username,
      codeHash,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      profile: emptyProfile(),
    };
    saveUsersDb(db);
    if (state.user && state.user.kind === 'guest') {
      clearGuestData();
    }
    state.user = { kind: 'account', username, name: db[username].name || username };
    applyProfileData(state.user, db[username].profile || emptyProfile());
    saveProfileData(state.user);
    closeAuthModal();
    closeSessionPrompt();
    renderAuthArea();
    applyTheme();
    $('sidebar').classList.toggle('collapsed', !state.sidebarOpen);
    renderSidebar();
    renderMain();
    localStorage.setItem(STORAGE_FIRST_RUN, '1');
    toast('✅ تم إنشاء الحساب', 'success');
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

  if (state.user && state.user.kind === 'guest') {
    clearGuestData();
  }

  state.user = { kind: 'account', username, name: user.name || username };
  applyProfileData(state.user, user.profile || emptyProfile());
  saveProfileData(state.user);
  closeAuthModal();
  closeSessionPrompt();
  renderAuthArea();
  applyTheme();
  $('sidebar').classList.toggle('collapsed', !state.sidebarOpen);
  renderSidebar();
  renderMain();
  localStorage.setItem(STORAGE_FIRST_RUN, '1');
  toast(`👋 مرحباً ${state.user.name}!`, 'success');
}

function resetToPrompt({ allowGuest = false } = {}) {
  state.user = { kind: 'none', username: '', name: '' };
  state.sections = [];
  state.activeId = null;
  state.searchQuery = '';
  const searchInput = $('searchInput');
  if (searchInput) searchInput.value = '';
  closeAuthModal();
  closeAuthDropdown();
  openSessionPrompt({ allowGuest });
  renderAuthArea();
  applyTheme();
  $('sidebar').classList.toggle('collapsed', !state.sidebarOpen);
  renderSidebar();
  renderMain();
}

function signOut() {
  if (state.user && state.user.kind === 'guest') {
    clearGuestData();
  } else if (state.user && state.user.kind === 'account') {
    saveProfileData(state.user);
  }

  localStorage.removeItem(STORAGE_PROFILE);
  state.user = { kind: 'none', username: '', name: '' };
  state.sections = [];
  state.activeId = null;
  state.searchQuery = '';
  const searchInput = $('searchInput');
  if (searchInput) searchInput.value = '';
  closeAuthModal();
  closeAuthDropdown();
  renderAuthArea();
  applyTheme();
  $('sidebar').classList.toggle('collapsed', !state.sidebarOpen);
  renderSidebar();
  renderMain();
  openSessionPrompt({ allowGuest: false });
  toast('تم تسجيل الخروج', 'success');
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

if ($('sessionLoginBtn')) $('sessionLoginBtn').addEventListener('click', () => { closeSessionPrompt(); openAuthModal('login'); });
if ($('sessionRegisterBtn')) $('sessionRegisterBtn').addEventListener('click', () => { closeSessionPrompt(); openAuthModal('register'); });
if ($('sessionGuestBtn')) $('sessionGuestBtn').addEventListener('click', () => { if (state.allowGuestEntry) enterGuestMode(); });
if ($('sessionCloseBtn')) $('sessionCloseBtn').addEventListener('click', () => { closeSessionPrompt(); });

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

  syncSearchVisibility();

  if (!sec) {
    main.innerHTML = `
      <div class="welcome">
        <div class="welcome-icon">🧮</div>
        <h2>${state.user && state.user.kind === 'none' ? 'اختر حسابًا للبدء' : 'مرحباً بك في حسّاب'}</h2>
        <p>${state.user && state.user.kind === 'none'
          ? 'يمكنك تسجيل الدخول أو إنشاء حساب جديد من شاشة البداية. وضع الضيف متاح فقط في البداية.'
          : 'دفتر الحساب الذكي الذي يحفظ أسماء كل بند<br>وتاريخ كل عملية — منظم ودقيق.'}</p>
        <div class="welcome-features">
          <div class="feat-chip">📋 أقسام متعددة</div>
          <div class="feat-chip">🏷 تسميات للأرقام</div>
          <div class="feat-chip">📌 تثبيت العمليات</div>
          <div class="feat-chip">📤 تصدير متعدد</div>
          <div class="feat-chip">🌗 مظهران</div>
          <div class="feat-chip">🔍 بحث سريع</div>
        </div>
        ${state.user && state.user.kind === 'none' ? `
          <button class="btn-create-first" id="chooseAccountBtn">اختيار حساب</button>
          ${state.allowGuestEntry ? `<button class="btn-ghost" id="guestStartBtn" style="margin-top:10px">الدخول كضيف</button>` : ''}
        ` : `<button class="btn-create-first" id="wcBtn">+ أنشئ قسمك الأول</button>`}
      </div>`;

    if (state.user && state.user.kind === 'none') {
      const chooseBtn = $('chooseAccountBtn');
      if (chooseBtn) chooseBtn.onclick = () => openSessionPrompt({ allowGuest: state.allowGuestEntry });
      const guestBtn = $('guestStartBtn');
      if (guestBtn) guestBtn.onclick = () => enterGuestMode();
    } else {
      const wcBtn = $('wcBtn');
      if (wcBtn) wcBtn.onclick = () => openSectionModal(null);
    }
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
        <div class="entry-row entry-row-top">
          <div class="op-pills" id="opPills"></div>
          <input type="number" class="inp inp-num" id="recNum" placeholder="0" step="any" />
        </div>
        <div class="entry-row entry-row-fields">
          <input type="text" class="inp inp-label" id="recLabel" placeholder="التسمية (مثال: خبز، وقود...)" maxlength="40" />
          <input type="text" class="inp inp-note" id="recNote" placeholder="ملاحظة (اختياري)" maxlength="80" />
        </div>
        <div class="entry-row entry-row-action">
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

  if (state.user && state.user.kind === 'none') {
    openSessionPrompt({ allowGuest: state.allowGuestEntry });
  }

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
