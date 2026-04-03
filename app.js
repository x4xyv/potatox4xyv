/* ════════════════════════════════════════
   حسّاب v3 — app.js
   - Internal multi-account auth
   - Guest mode available only at start
   - Full numbers with commas, no K/M
════════════════════════════════════════ */
'use strict';

// ── CONSTANTS ──────────────────────────
const COLORS = ['#f5c842','#f5904a','#f76e6e','#3ddba8','#5b9cf6','#b07ef8','#f472b6','#3dd6f5','#a3e635','#fb923c'];
const ICONS  = ['🛒','💼','🏠','✈️','🍔','💊','📚','⛽','🎮','💡','🎁','💰','🏋️','🧾','🔧','📱','🎓','🌿','🎵','🚗'];

const STORAGE_THEME   = 'hassab_v3_theme';
const STORAGE_ACCOUNTS = 'hassab_v3_accounts';
const STORAGE_ACTIVE   = 'hassab_v3_active';
const STORAGE_GUEST    = 'hassab_v3_guest';
const STORAGE_USER_PREFIX = 'hassab_v3_user_';

// ── STATE ──────────────────────────────
let state = {
  sections: [],
  activeId: null,
  theme: 'dark',
  sidebarOpen: true,
  sectionSearchQuery: '',
  recordSearchQuery: '',
  recordSearchOpen: false,
  selectedOp: '+',
  editingRecord: null,
  editingSection: null,
  pendingDelete: null,
  accounts: [],
  currentUser: null, // { username, code, createdAt }
  sessionType: null,  // 'guest' | 'account'
  authMenuOpen: false,
  authGateMode: 'choose',
  allowGuestEntry: true,
};

// ── DOM HELPERS ────────────────────────
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const numFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 12, useGrouping: true });

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

function highlight(text, query) {
  if (!query || !text) return escHtml(text || '');
  const re = new RegExp(`(${escRegex(query)})`, 'gi');
  return escHtml(text).replace(re, '<mark class="highlight">$1</mark>');
}

function normalizeUsername(v) {
  return String(v || '').trim().toLowerCase();
}

function accountStorageKey(username) {
  return STORAGE_USER_PREFIX + normalizeUsername(username);
}

function toWestern(str) {
  return String(str)
    .replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660)
    .replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x06F0);
}

function fmt(n) {
  if (n === undefined || n === null || n === '' || Number.isNaN(Number(n))) return '—';
  const value = Number(n);
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  let str;
  if (Number.isInteger(value) || abs >= 1000) str = numFmt.format(value);
  else {
    str = String(Math.round(value * 1e12) / 1e12)
      .replace(/\.0+$/, '')
      .replace(/(\.\d*[1-9])0+$/, '$1');
  }
  return toWestern(str);
}

function fmtDate(ts) {
  const d = new Date(ts || Date.now());
  const h24 = d.getHours();
  const h12 = h24 % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const period = h24 < 12 ? 'صباحًا' : 'مساءً';
  const dd = d.getDate();
  const mo = d.getMonth() + 1;
  const yy = d.getFullYear();
  return `${String(h12).padStart(2, '0')}:${mm} ${period} — ${dd}/${mo}/${yy}`;
}

function opClass(op) {
  return { '+':'op-plus-bg', '-':'op-minus-bg', '×':'op-times-bg', '÷':'op-divide-bg' }[op] || 'op-plus-bg';
}
function opPillClass(op) {
  return { '+':'plus', '-':'minus', '×':'times', '÷':'divide' }[op] || 'plus';
}

function sectionById(id) { return state.sections.find(s => s.id === id); }

function _mulPrecise(a, b) {
  const sa = String(Number(a) || 0);
  const sb = String(Number(b) || 0);
  const neg = (sa.startsWith('-') ? 1 : 0) ^ (sb.startsWith('-') ? 1 : 0);
  const [ai, af = ''] = sa.replace('-', '').split('.');
  const [bi, bf = ''] = sb.replace('-', '').split('.');
  const da = (ai + af).replace(/^0+(?=\d)/, '') || '0';
  const db = (bi + bf).replace(/^0+(?=\d)/, '') || '0';
  const scale = af.length + bf.length;
  let prod = (BigInt(da) * BigInt(db)).toString();
  if (scale > 0) {
    prod = prod.padStart(scale + 1, '0');
    const cut = prod.length - scale;
    prod = prod.slice(0, cut) + '.' + prod.slice(cut);
    prod = prod.replace(/\.?0+$/, '');
  }
  if (neg && prod !== '0') prod = '-' + prod;
  return Number(prod);
}

function _divPrecise(a, b) {
  const divisor = Number(b) || 0;
  if (divisor === 0) return Number(a) || 0;
  return Math.round((Number(a) / divisor) * 1e12) / 1e12;
}

function calcRunning(records, upToIndex) {
  if (!records.length || upToIndex < 0) return 0;
  let total = Number(records[0].num) || 0;
  for (let i = 1; i <= upToIndex; i++) {
    const r = records[i];
    const num = Number(r.num) || 0;
    if (r.op === '+') total += num;
    else if (r.op === '-') total -= num;
    else if (r.op === '×') total = _mulPrecise(total, num);
    else if (r.op === '÷') total = _divPrecise(total, num);
    total = Math.round(total * 1e12) / 1e12;
  }
  return Math.round(total * 1e12) / 1e12;
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
      ? `${fmt(r.num)}${u} ${lbl}`.trim()
      : `${r.op} ${fmt(r.num)}${u} ${lbl}`.trim();
  }).join(' ');
}

function safeJsonParse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}

function currentPayload() {
  return {
    sections: state.sections,
    activeId: state.activeId,
    theme: state.theme,
    sidebarOpen: state.sidebarOpen,
    selectedOp: state.selectedOp,
  };
}

function applyPayload(payload = {}) {
  state.sections = Array.isArray(payload.sections) ? payload.sections : [];
  state.activeId = payload.activeId || (state.sections[0]?.id || null);
  state.theme = payload.theme || 'dark';
  state.sidebarOpen = payload.sidebarOpen !== undefined ? !!payload.sidebarOpen : true;
  state.selectedOp = payload.selectedOp || '+';
}

function loadAccounts() {
  state.accounts = safeJsonParse(localStorage.getItem(STORAGE_ACCOUNTS), []);
  if (!Array.isArray(state.accounts)) state.accounts = [];
}

function saveAccounts() {
  localStorage.setItem(STORAGE_ACCOUNTS, JSON.stringify(state.accounts));
}

function setCurrentThemeFromStorage() {
  const th = localStorage.getItem(STORAGE_THEME);
  if (th) state.theme = th;
}

function clearGuestSession() {
  localStorage.removeItem(STORAGE_GUEST);
}

function saveCurrentSession() {
  try {
    localStorage.setItem(STORAGE_THEME, state.theme);
    if (state.sessionType === 'guest') {
      localStorage.setItem(STORAGE_GUEST, JSON.stringify(currentPayload()));
    } else if (state.sessionType === 'account' && state.currentUser?.username) {
      localStorage.setItem(accountStorageKey(state.currentUser.username), JSON.stringify(currentPayload()));
    }
    if (state.currentUser) {
      localStorage.setItem(STORAGE_ACTIVE, JSON.stringify({ type: state.sessionType, username: state.currentUser.username }));
    }
  } catch (e) {
    console.warn('save:', e);
  }
}

function loadGuestSession() {
  const raw = localStorage.getItem(STORAGE_GUEST);
  if (raw) {
    applyPayload(safeJsonParse(raw, {}));
  } else {
    applyPayload({ sections: [], activeId: null, theme: localStorage.getItem(STORAGE_THEME) || 'dark', sidebarOpen: true, selectedOp: '+' });
    seedDemo();
  }
  state.sessionType = 'guest';
  state.currentUser = { username: 'ضيف', code: '', createdAt: Date.now() };
}

function loadAccountSession(username) {
  const raw = localStorage.getItem(accountStorageKey(username));
  if (!raw) return false;
  applyPayload(safeJsonParse(raw, {}));
  state.sessionType = 'account';
  const acc = state.accounts.find(a => normalizeUsername(a.username) === normalizeUsername(username));
  state.currentUser = acc ? { username: acc.username, code: acc.code || '', createdAt: acc.createdAt || Date.now() } : { username, code: '', createdAt: Date.now() };
  return true;
}

function validateUsername(username) {
  const value = String(username || '').trim();
  if (!value) return 'اكتب اسم المستخدم';
  if (value.length < 3) return 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل';
  if (state.accounts.some(a => normalizeUsername(a.username) === normalizeUsername(value))) return 'اسم المستخدم مستخدم بالفعل';
  return '';
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 6) return 'كلمة المرور يجب ألا تقل عن 6 أحرف';
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value)) return 'يجب أن تحتوي كلمة المرور على حرف كبير وحرف صغير باللغة الإنجليزية';
  return '';
}

function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  if (crypto?.subtle?.digest) {
    return crypto.subtle.digest('SHA-256', data).then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
  }
  // fallback non-cryptographic hash
  let h = 0;
  for (let i = 0; i < password.length; i++) h = ((h << 5) - h + password.charCodeAt(i)) | 0;
  return Promise.resolve(String(h));
}

function closeRecordSearch() {
  state.recordSearchOpen = false;
  state.recordSearchQuery = '';
  const bar = $('searchBar');
  if (bar) bar.classList.remove('open');
  const input = $('searchInput');
  if (input) input.value = '';
}

function openRecordSearch() {
  if (!sectionById(state.activeId)) {
    toast('اختر قسماً أولاً', 'error');
    return;
  }
  state.recordSearchOpen = true;
  const bar = $('searchBar');
  if (bar) bar.classList.add('open');
  const input = $('searchInput');
  if (input) input.focus();
}

function closeAuthMenu() {
  state.authMenuOpen = false;
  const dd = $('authDropdown');
  if (dd) dd.classList.add('modal-hidden');
}

function hideAuthGate() {
  const gate = $('authGate');
  if (gate) gate.classList.add('modal-hidden');
}

function openAuthGate(mode = 'choose') {
  state.authGateMode = mode;
  renderAuthGate();
  const gate = $('authGate');
  if (gate) gate.classList.remove('modal-hidden');
  closeAuthMenu();
  closeRecordSearch();
}

function toast(msg, type = '') {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ── MODALS ─────────────────────────────
function openModal(id) { $(id).classList.remove('modal-hidden'); }
function closeModal(id) { $(id).classList.add('modal-hidden'); }

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.overlay').forEach(ov => {
  ov.addEventListener('click', e => {
    if (e.target === ov) closeModal(ov.id);
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['sectionModal', 'editModal', 'confirmModal', 'exportModal', 'authGate', 'logoutConfirmModal'].forEach(closeModal);
    closeAuthMenu();
    closeLogoutConfirm();
    closeRecordSearch();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (state.recordSearchOpen) closeRecordSearch();
    else openRecordSearch();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    openSectionModal(null);
  }
});

// ── THEME ──────────────────────────────
function applyTheme() {
  document.body.classList.toggle('light', state.theme === 'light');
  const icon = $('themeIcon');
  if (!icon) return;
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
  applyTheme();
  saveCurrentSession();
  toast(state.theme === 'light' ? '☀️ المظهر الفاتح' : '🌙 المظهر الداكن');
});

// ── SIDEBAR ────────────────────────────
$('sidebarToggle').addEventListener('click', () => {
  state.sidebarOpen = !state.sidebarOpen;
  $('sidebar').classList.toggle('collapsed', !state.sidebarOpen);
  $('sidebarToggle').classList.toggle('active', !state.sidebarOpen);
  saveCurrentSession();
});

// ── SEARCH ─────────────────────────────
$('searchToggleBtn').addEventListener('click', () => {
  if (!sectionById(state.activeId)) return;
  if (state.recordSearchOpen) closeRecordSearch();
  else openRecordSearch();
});
$('searchInput').addEventListener('input', e => {
  state.recordSearchQuery = e.target.value.trim().toLowerCase();
  renderMain();
});
$('clearSearch').addEventListener('click', () => {
  closeRecordSearch();
  renderMain();
});
const sectionSearchInput = $('sectionSearchInput');
if (sectionSearchInput) {
  sectionSearchInput.addEventListener('input', e => {
    state.sectionSearchQuery = e.target.value.trim().toLowerCase();
    renderSidebar();
  });
}

// ── INTERNAL AUTH ──────────────────────
function renderAuthGate() {
  const host = $('authGateBody');
  const title = $('authGateTitle');
  if (!host || !title) return;

  const canGuest = state.allowGuestEntry && state.authGateMode !== 'locked';

  if (state.authGateMode === 'register') {
    title.textContent = 'إنشاء حساب';
    host.innerHTML = `
      <div class="auth-card">
        <label class="field-label">اسم المستخدم</label>
        <input class="field-input" id="authRegUser" maxlength="24" placeholder="مثال: ali_1" />
        <label class="field-label" style="margin-top:12px">كلمة المرور</label>
        <input class="field-input" id="authRegPass" type="password" placeholder="6+ أحرف مع كبير وصغير" />
        <label class="field-label" style="margin-top:12px">تأكيد كلمة المرور</label>
        <input class="field-input" id="authRegPass2" type="password" placeholder="أعد كتابة كلمة المرور" />
        <div class="auth-rules">يجب أن تحتوي على حرف كبير وحرف صغير إنجليزيين، وطولها 6 أحرف أو أكثر.</div>
        <div class="modal-actions auth-actions">
          <button class="btn-ghost" id="authBackBtn">رجوع</button>
          <button class="btn-primary" id="authCreateBtn">إنشاء الحساب</button>
        </div>
      </div>`;
    $('authBackBtn').onclick = () => openAuthGate(state.allowGuestEntry ? 'choose' : 'locked');
    $('authCreateBtn').onclick = () => submitRegister();
    ['authRegUser', 'authRegPass', 'authRegPass2'].forEach(id => {
      $(id).addEventListener('keydown', e => { if (e.key === 'Enter') submitRegister(); });
    });
    return;
  }

  if (state.authGateMode === 'login') {
    title.textContent = 'تسجيل الدخول';
    host.innerHTML = `
      <div class="auth-card">
        <label class="field-label">اسم المستخدم</label>
        <input class="field-input" id="authLoginUser" maxlength="24" placeholder="اسم المستخدم" />
        <label class="field-label" style="margin-top:12px">كلمة المرور</label>
        <input class="field-input" id="authLoginPass" type="password" placeholder="كلمة المرور" />
        <div class="auth-rules">اكتب اسم المستخدم ثم كلمة المرور.</div>
        <div class="modal-actions auth-actions">
          <button class="btn-ghost" id="authBackBtn">رجوع</button>
          <button class="btn-primary" id="authLoginBtn">دخول</button>
        </div>
      </div>`;
    $('authBackBtn').onclick = () => openAuthGate(state.allowGuestEntry ? 'choose' : 'locked');
    $('authLoginBtn').onclick = () => submitLogin();
    $('authLoginUser').addEventListener('keydown', e => { if (e.key === 'Enter') $('authLoginPass').focus(); });
    $('authLoginPass').addEventListener('keydown', e => { if (e.key === 'Enter') submitLogin(); });
    return;
  }

  title.textContent = state.authGateMode === 'locked' ? 'اختر حسابًا للمتابعة' : 'مرحبًا بك';
  host.innerHTML = `
    <div class="auth-card auth-chooser">
      <button class="auth-choice-btn primary" id="showRegisterBtn">إنشاء حساب جديد</button>
      <button class="auth-choice-btn" id="showLoginBtn">تسجيل الدخول لحساب موجود</button>
      ${canGuest ? `<button class="auth-choice-btn ghost" id="guestBtn">الدخول كضيف</button>` : ''}
    </div>`;
  $('showRegisterBtn').onclick = () => openAuthGate('register');
  $('showLoginBtn').onclick = () => openAuthGate('login');
  const guestBtn = $('guestBtn');
  if (guestBtn) guestBtn.onclick = () => enterGuestMode();
}

async function submitRegister() { {
  const username = $('authRegUser').value.trim();
  const password = $('authRegPass').value;
  const confirm = $('authRegPass2').value;
  const userErr = validateUsername(username);
  if (userErr) return toast(userErr, 'error');
  const passErr = validatePassword(password);
  if (passErr) return toast(passErr, 'error');
  if (password !== confirm) return toast('كلمتا المرور غير متطابقتين', 'error');

  const code = `HS-${uid().slice(0, 6).toUpperCase()}`;
  const hash = await hashPassword(password);
  state.accounts.push({ username, code, passwordHash: hash, createdAt: Date.now() });
  saveAccounts();

  if (state.sessionType === 'guest') clearGuestSession();
  state.currentUser = { username, code, createdAt: Date.now() };
  state.sessionType = 'account';
  applyPayload({ sections: [], activeId: null, theme: state.theme, sidebarOpen: true, selectedOp: '+' });
  saveCurrentSession();
  hideAuthGate();
  renderAuthArea();
  renderSidebar();
  renderMain();
  toast(`✅ تم إنشاء الحساب: ${username}`);
}

async function submitLogin() {
  const username = $('authLoginUser').value.trim();
  const password = $('authLoginPass').value;
  const account = state.accounts.find(a => normalizeUsername(a.username) === normalizeUsername(username));
  if (!account) return toast('اسم المستخدم أو كلمة المرور غير صحيحة', 'error');
  const hash = await hashPassword(password);
  if (hash !== account.passwordHash) return toast('اسم المستخدم أو كلمة المرور غير صحيحة', 'error');

  saveCurrentSession();
  if (state.sessionType === 'guest') clearGuestSession();
  const ok = loadAccountSession(account.username);
  if (!ok) applyPayload({ sections: [], activeId: null, theme: state.theme, sidebarOpen: true, selectedOp: '+' });
  hideAuthGate();
  renderAuthArea();
  renderSidebar();
  renderMain();
  toast(`👋 مرحبًا ${account.username}`);
}

function enterGuestMode() {
  state.sessionType = 'guest';
  state.currentUser = { username: 'ضيف', code: '', createdAt: Date.now() };
  const raw = localStorage.getItem(STORAGE_GUEST);
  if (raw) applyPayload(safeJsonParse(raw, {}));
  else {
    applyPayload({ sections: [], activeId: null, theme: state.theme, sidebarOpen: true, selectedOp: '+' });
    seedDemo();
  }
  hideAuthGate();
  renderAuthArea();
  renderSidebar();
  renderMain();
  saveCurrentSession();
  toast('👤 تم الدخول كضيف');
}

function switchAccount() {
  saveCurrentSession();
  localStorage.removeItem(STORAGE_ACTIVE);
  state.currentUser = null;
  state.sessionType = null;
  state.allowGuestEntry = false;
  state.sections = [];
  state.activeId = null;
  state.recordSearchQuery = '';
  state.recordSearchOpen = false;
  closeAuthMenu();
  renderAuthArea();
  renderSidebar();
  renderMain();
  openAuthGate('locked');
}

function openLogoutConfirm() {
  closeAuthMenu();
  const modal = $('logoutConfirmModal');
  if (!modal) {
    signOut();
    return;
  }
  modal.classList.remove('modal-hidden');
}

function closeLogoutConfirm() {
  const modal = $('logoutConfirmModal');
  if (modal) modal.classList.add('modal-hidden');
}

function signOut() {
  saveCurrentSession();
  if (state.sessionType === 'guest') clearGuestSession();
  localStorage.removeItem(STORAGE_ACTIVE);
  state.currentUser = null;
  state.sessionType = null;
  state.allowGuestEntry = false;
  state.sections = [];
  state.activeId = null;
  state.recordSearchQuery = '';
  state.recordSearchOpen = false;
  closeAuthMenu();
  renderAuthArea();
  renderSidebar();
  renderMain();
  openAuthGate('locked');
  toast('👋 تم تسجيل الخروج');
}

function renderAuthArea() { {
  const area = $('authArea');
  if (!area) return;

  if (!state.currentUser) {
    area.innerHTML = `<button class="auth-open-btn" id="openAuthBtn">الحساب</button>`;
    $('openAuthBtn').onclick = () => openAuthGate('choose');
    return;
  }

  const isGuest = state.sessionType === 'guest';
  const label = isGuest ? 'ضيف' : state.currentUser.username;
  const code = isGuest ? 'وضع الضيف' : (state.currentUser.code || '');
  area.innerHTML = `
    <button class="auth-user-btn" id="authUserBtn">
      <div class="auth-avatar-placeholder">${escHtml(label.slice(0, 1).toUpperCase())}</div>
      <span class="auth-name">${escHtml(label)}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      <div class="auth-dropdown modal-hidden" id="authDropdown">
        <div class="auth-dd-info">
          <div class="auth-dd-name">${escHtml(label)}</div>
          <div class="auth-dd-email">${escHtml(code)}</div>
        </div>
        <button class="auth-dd-item" id="switchAccountBtn">تبديل الحساب</button>
        <button class="auth-dd-item danger" id="signOutBtn">تسجيل الخروج</button>
      </div>
    </button>`;

  $('authUserBtn').addEventListener('click', e => {
    e.stopPropagation();
    state.authMenuOpen = !state.authMenuOpen;
    const dd = $('authDropdown');
    if (dd) dd.classList.toggle('modal-hidden', !state.authMenuOpen);
  });
  $('switchAccountBtn').onclick = e => { e.stopPropagation(); switchAccount(); };
  $('signOutBtn').onclick = e => { e.stopPropagation(); openLogoutConfirm(); };
}

document.addEventListener('click', e => {
  if (!e.target.closest('#authArea')) closeAuthMenu();
});

$('confirmLogoutBtn')?.addEventListener('click', () => {
  closeLogoutConfirm();
  signOut();
});
$('cancelLogoutBtn')?.addEventListener('click', () => closeLogoutConfirm());

// ── SECTION MODAL ──────────────────────
let _modalColor = COLORS[0];
let _modalIcon = ICONS[0];

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
  closeRecordSearch();
  closeAuthMenu();
  state.editingSection = sectionId || null;
  const sec = sectionId ? sectionById(sectionId) : null;
  $('sectionModalTitle').textContent = sec ? 'تعديل القسم' : 'قسم جديد';
  $('sectionNameInput').value = sec ? sec.name : '';
  $('sectionUnitInput').value = sec ? (sec.unit || '') : '';
  _modalColor = sec ? sec.color : COLORS[Math.floor(Math.random() * COLORS.length)];
  _modalIcon = sec ? sec.icon : ICONS[0];
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
  saveCurrentSession();
  renderSidebar();
  renderMain();
}

function confirmDeleteSection(id) {
  const sec = sectionById(id);
  if (!sec) return;
  state.pendingDelete = { type: 'section', id };
  $('confirmTitle').textContent = 'حذف القسم';
  $('confirmText').textContent = `هل تريد حذف قسم "${sec.name}" وجميع عملياته (${sec.records.length} عملية)؟`;
  openModal('confirmModal');
}

// ── ADD RECORD ──────────────────────────
function addRecord() {
  const sec = sectionById(state.activeId);
  if (!sec) return;
  const numStr = String($('recNum').value || '').replace(/,/g, '').trim();
  const num = Number(numStr);
  if (!Number.isFinite(num) || numStr === '') { shake($('recNum')); return; }
  const label = $('recLabel').value.trim();
  const note = $('recNote') ? $('recNote').value.trim() : '';
  const rec = { id: uid(), op: state.selectedOp, num, label, note, ts: Date.now(), pinned: false };
  sec.records.push(rec);
  $('recNum').value = '';
  $('recLabel').value = '';
  if ($('recNote')) $('recNote').value = '';
  $('recNum').focus();
  saveCurrentSession();
  renderSidebar();
  renderTotalCard(sec);
  renderRecords(sec);
  toast(`${state.selectedOp} ${fmt(num)}${label ? ' (' + label + ')' : ''} ✓`);
}

function shake(el) {
  el.style.borderColor = 'var(--red)';
  el.style.boxShadow = '0 0 0 3px var(--red-dim)';
  setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 700);
}

// ── EDIT RECORD ─────────────────────────
function openEditModal(secId, recId) {
  const sec = sectionById(secId);
  const rec = sec?.records.find(r => r.id === recId);
  if (!rec) return;
  state.editingRecord = { sectionId: secId, recordId: recId };
  $('editOp').value = rec.op;
  $('editNum').value = rec.num;
  $('editLabel').value = rec.label || '';
  $('editNote').value = rec.note || '';
  openModal('editModal');
  setTimeout(() => $('editNum').focus(), 100);
}

$('saveEditBtn').addEventListener('click', () => {
  if (!state.editingRecord) return;
  const { sectionId, recordId } = state.editingRecord;
  const sec = sectionById(sectionId);
  const rec = sec?.records.find(r => r.id === recordId);
  if (!rec) return;
  const num = Number(String($('editNum').value || '').replace(/,/g, ''));
  if (!Number.isFinite(num)) { shake($('editNum')); return; }
  rec.op = $('editOp').value;
  rec.num = num;
  rec.label = $('editLabel').value.trim();
  rec.note = $('editNote').value.trim();
  closeModal('editModal');
  saveCurrentSession();
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
  $('confirmText').textContent = `هل تريد حذف "${rec.label || fmt(rec.num)}"؟`;
  openModal('confirmModal');
}

// ── CLEAR ALL ───────────────────────────
function confirmClearAll(secId) {
  state.pendingDelete = { type: 'all', sectionId: secId };
  const sec = sectionById(secId);
  $('confirmTitle').textContent = 'مسح جميع العمليات';
  $('confirmText').textContent = `هل تريد مسح جميع العمليات في "${sec?.name}"؟ (${sec?.records.length} عملية)`;
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
    saveCurrentSession();
    renderSidebar();
    renderMain();

  } else if (p.type === 'record') {
    const sec = sectionById(p.sectionId);
    const card = document.querySelector(`[data-rec-id="${p.id}"]`);
    closeModal('confirmModal');
    if (card) {
      card.classList.add('removing');
      setTimeout(() => { _doDeleteRecord(sec, p.id); }, 210);
    } else {
      _doDeleteRecord(sec, p.id);
    }

  } else if (p.type === 'all') {
    const sec = sectionById(p.sectionId);
    if (sec) sec.records = [];
    closeModal('confirmModal');
    toast('🗑 تم مسح جميع العمليات');
    saveCurrentSession();
    renderSidebar();
    renderMain();
  }

  state.pendingDelete = null;
});

function _doDeleteRecord(sec, id) {
  if (!sec) return;
  sec.records = sec.records.filter(r => r.id !== id);
  saveCurrentSession();
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
  saveCurrentSession();
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
    { icon:'📄', title:'نص عادي (.txt)', desc:'ملف نصي بسيط', fn:() => exportTxt(sec) },
    { icon:'📊', title:'CSV للجدول', desc:'مناسب لـ Excel', fn:() => exportCsv(sec) },
    { icon:'📋', title:'نسخ للحافظة', desc:'الصق الملخص في أي مكان', fn:() => copyToClipboard(sec) },
    { icon:'🖨️', title:'طباعة / PDF', desc:'اطبع أو احفظ PDF', fn:() => printSection(sec) },
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
  downloadFile(`${sec.name}.txt`, txt, 'text/plain');
  toast('📄 تم تصدير الملف');
}

function exportCsv(sec) {
  let csv = 'الترتيب,العملية,الرقم,التسمية,الملاحظة,المجموع التراكمي,الوقت\n';
  sec.records.forEach((r, i) => {
    const run = calcRunning(sec.records, i);
    csv += `${i+1},${i===0?'بداية':r.op},${r.num},"${r.label||''}","${r.note||''}",${run},"${fmtDate(r.ts)}"\n`;
  });
  downloadFile(`${sec.name}.csv`, '\uFEFF' + csv, 'text/csv');
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
    .then(() => toast('📋 تم النسخ للحافظة'))
    .catch(() => toast('فشل النسخ', 'error'));
}

function printSection(sec) {
  const unit = sec.unit || '';
  const rows = sec.records.map((r, i) => {
    const run = calcRunning(sec.records, i);
    return `<tr><td>${i+1}</td><td>${i===0?'—':r.op}</td><td><b>${fmt(r.num)}${unit?' '+unit:''}</b></td><td>${r.label||''}</td><td>${r.note||''}</td><td>${fmt(run)} ${unit}</td></tr>`;
  }).join('');
  const w = window.open('', '_blank');
  if (!w) return toast('تعذر فتح نافذة الطباعة', 'error');
  w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>${escHtml(sec.name)}</title>
    <style>body{font-family:sans-serif;padding:32px;direction:rtl}h1{font-size:22px;margin-bottom:4px}
    p{color:#666;font-size:13px;margin-bottom:20px}table{width:100%;border-collapse:collapse;font-size:14px}
    th,td{border:1px solid #ddd;padding:8px 12px;text-align:right}th{background:#f5f5f5}
    tr:nth-child(even){background:#fafafa}.total{margin-top:16px;font-size:18px;font-weight:700}</style>
    </head><body>
    <h1>${escHtml(sec.icon)} ${escHtml(sec.name)}</h1>
    <p>الوحدة: ${escHtml(unit||'—')} | العمليات: ${sec.records.length}</p>
    <table><thead><tr><th>#</th><th>العملية</th><th>الرقم</th><th>التسمية</th><th>ملاحظة</th><th>تراكمي</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="total">الإجمالي: ${fmt(calcTotal(sec.records))} ${unit}</p>
    </body></html>`);
  w.document.close();
  w.print();
}

function downloadFile(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
}

// ── RENDER ─────────────────────────────
function renderSidebar() {
  const list = $('sectionsList');
  if (!list) return;
  list.innerHTML = '';

  const q = state.sectionSearchQuery;
  const visibleSections = q
    ? state.sections.filter(s => [s.name, s.unit, s.icon].join(' ').toLowerCase().includes(q))
    : state.sections;

  if (!visibleSections.length) {
    list.innerHTML = `<div style="padding:24px 16px;text-align:center;color:var(--text3);font-size:13px;line-height:1.7">${q ? 'لا توجد أقسام مطابقة' : 'لا توجد أقسام بعد<br>اضغط "جديد" للبدء'}</div>`;
  } else {
    visibleSections.forEach(s => {
      const total = calcTotal(s.records);
      const div = document.createElement('div');
      div.className = 'section-item' + (s.id === state.activeId ? ' active' : '');
      div.style.setProperty('--item-color', s.color);
      div.innerHTML = `
        <div class="sec-icon" style="background:${s.color}22">${s.icon}</div>
        <div class="sec-body">
          <div class="sec-name">${q ? highlight(s.name, q) : escHtml(s.name)}</div>
          <div class="sec-meta">${fmt(total)}${s.unit ? ' ' + escHtml(s.unit) : ''} · ${fmt(s.records.length)}</div>
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
      div.onclick = () => { state.activeId = s.id; closeRecordSearch(); renderSidebar(); renderMain(); };
      list.appendChild(div);
    });
  }

  const totalOps = state.sections.reduce((a, s) => a + s.records.length, 0);
  $('globalStats').innerHTML = `
    <div class="g-stat"><span>الأقسام</span><strong>${fmt(state.sections.length)}</strong></div>
    <div class="g-stat"><span>إجمالي العمليات</span><strong>${fmt(totalOps)}</strong></div>`;
}

function renderMain() {
  const main = $('mainContent');
  const sec = sectionById(state.activeId);

  if (!sec) {
    closeRecordSearch();
    main.innerHTML = `
      <div class="welcome">
        <div class="welcome-icon">🧮</div>
        <h2>مرحباً بك في حسّاب</h2>
        <p>دفتر الحساب الذكي الذي يحفظ الأقسام والعمليات بدقة، مع حسابات داخلية للضيف والمستخدمين.</p>
        <div class="welcome-features">
          <div class="feat-chip">📋 أقسام متعددة</div>
          <div class="feat-chip">🏷 تسميات للأرقام</div>
          <div class="feat-chip">📌 تثبيت العمليات</div>
          <div class="feat-chip">🔍 بحث مستقل</div>
          <div class="feat-chip">🌗 مظهران</div>
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
        <div class="input-row input-row-stack">
          <div class="op-pills" id="opPills"></div>
          <div class="label-note-row">
            <input type="text" class="inp inp-label" id="recLabel" placeholder="التسمية (مثال: خبز، وقود...)" maxlength="40" />
            <input type="text" class="inp inp-note" id="recNote" placeholder="الملاحظة (اختياري)" maxlength="80" />
          </div>
          <button class="btn-add btn-add-wide" id="addRecBtn">＋</button>
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
  $('recLabel').addEventListener('keydown', e => { if (e.key === 'Enter') $('recNote').focus(); });
  $('recNote').addEventListener('keydown', e => { if (e.key === 'Enter') addRecord(); });

  let _sortAsc = false;
  $('sortBtn').onclick = () => {
    _sortAsc = !_sortAsc;
    const sorted = [...sec.records].sort((a, b) => _sortAsc ? a.num - b.num : b.num - a.num);
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
    b.className = `op-pill ${opPillClass(op)}${op === state.selectedOp ? ' active' : ''}`;
    b.textContent = op;
    b.onclick = () => {
      state.selectedOp = op;
      pills.querySelectorAll('.op-pill').forEach(p => p.classList.remove('active'));
      b.classList.add('active');
      saveCurrentSession();
    };
    pills.appendChild(b);
  });
}

function renderTotalCard(sec) {
  const slot = $('totalCardSlot');
  if (!slot) return;
  const total = calcTotal(sec.records);
  const unit = sec.unit || '';
  const eq = buildEquation(sec.records, unit);
  let addSum = 0, subSum = 0, mulCnt = 0, divCnt = 0;
  sec.records.forEach((r, i) => {
    if (i === 0) return;
    if (r.op === '+') addSum += r.num;
    if (r.op === '-') subSum += r.num;
    if (r.op === '×') mulCnt++;
    if (r.op === '÷') divCnt++;
  });

  slot.innerHTML = `
    <div class="total-card" style="--s-color:${sec.color}">
      <div>
        <div class="total-label">المجموع الكلي</div>
        <div class="total-number">${fmt(total)}${unit ? ` <span class="total-unit">${escHtml(unit)}</span>` : ''}</div>
        <div class="total-equation">${escHtml(eq)}</div>
      </div>
    </div>`;

  const sg = $('statsGrid');
  if (!sg) return;
  sg.innerHTML = `
    <div class="stat-chip green"><span class="s-label">إضافات</span><span class="s-val">+${fmt(addSum)}</span></div>
    <div class="stat-chip red"><span class="s-label">طرح</span><span class="s-val">−${fmt(subSum)}</span></div>
    <div class="stat-chip blue"><span class="s-label">عمليات</span><span class="s-val">${fmt(sec.records.length)}</span></div>
    ${mulCnt + divCnt ? `<div class="stat-chip orange"><span class="s-label">ضرب/قسمة</span><span class="s-val">${fmt(mulCnt + divCnt)}</span></div>` : ''}`;
}

function renderRecords(sec) {
  let records = sec.records;
  const q = state.recordSearchQuery;
  if (q) {
    records = records.filter(r =>
      (r.label || '').toLowerCase().includes(q) ||
      (r.note || '').toLowerCase().includes(q) ||
      String(r.num).includes(q)
    );
  }
  _renderList(sec, records);
}

function _renderList(sec, records) {
  const list = $('recordsList');
  const count = $('recCount');
  if (!list) return;

  if (count) {
    count.textContent = state.recordSearchQuery
      ? `${fmt(records.length)} نتيجة من ${fmt(sec.records.length)}`
      : `${fmt(sec.records.length)} عملية`;
  }

  if (!records.length) {
    list.innerHTML = `
      <div class="empty-records">
        <div class="e-icon">${state.recordSearchQuery ? '🔍' : '📋'}</div>
        <p>${state.recordSearchQuery
          ? `لا توجد نتائج لـ "${escHtml(state.recordSearchQuery)}"`
          : 'لا توجد عمليات بعد<br>أضف أول عملية من الحقول أعلاه'}</p>
      </div>`;
    return;
  }

  const pinned = records.filter(r => r.pinned);
  const unpinned = records.filter(r => !r.pinned);
  const sorted = [...pinned, ...unpinned];

  list.innerHTML = sorted.map(r => {
    const trueIdx = sec.records.findIndex(x => x.id === r.id);
    const running = calcRunning(sec.records, trueIdx);
    const isFirst = trueIdx === 0;
    const lbl = state.recordSearchQuery ? highlight(r.label || '', state.recordSearchQuery) : escHtml(r.label || '');

    return `
      <div class="record-card${r.pinned ? ' pinned' : ''}" data-rec-id="${r.id}">
        ${r.pinned ? '<div class="pin-dot"></div>' : ''}
        <div class="rec-index">${trueIdx + 1}</div>
        <div class="rec-op-badge ${opClass(isFirst ? '+' : r.op)}">${isFirst ? '①' : r.op}</div>
        <div class="rec-body">
          <div class="rec-main-line">
            <span class="rec-num">${fmt(r.num)}</span>
            ${r.label ? `<span class="rec-label-text">${lbl}</span>` : ''}
          </div>
          ${r.note ? `<div class="rec-note">📝 ${escHtml(r.note)}</div>` : ''}
          <div class="rec-running">= <span>${fmt(running)}${sec.unit ? ' ' + escHtml(sec.unit) : ''}</span></div>
        </div>
        <div class="rec-actions">
          <button class="rec-act" title="${r.pinned ? 'إلغاء التثبيت' : 'تثبيت'}" onclick="togglePin('${sec.id}','${r.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="${r.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round">
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
      { id:'r1', op:'+', num:5, label:'خبز', note:'', ts:now-5*h, pinned:false },
      { id:'r2', op:'+', num:16, label:'جبن', note:'ماركة ألمعية', ts:now-4*h, pinned:true },
      { id:'r3', op:'-', num:5, label:'خصم موز', note:'', ts:now-3*h, pinned:false },
      { id:'r4', op:'+', num:12, label:'لحم', note:'', ts:now-2*h, pinned:false },
      { id:'r5', op:'+', num:8, label:'بيض', note:'12 حبة', ts:now-1*h, pinned:false },
    ]},
    { id:'demo2', name:'مصاريف العمل', color:'#5b9cf6', icon:'💼', unit:'ريال', records:[
      { id:'r6', op:'+', num:150, label:'وقود', note:'', ts:now-10*h, pinned:false },
      { id:'r7', op:'+', num:80, label:'غداء', note:'مطعم الملز', ts:now-9*h, pinned:false },
      { id:'r8', op:'-', num:30, label:'استرداد', note:'', ts:now-8*h, pinned:false },
      { id:'r9', op:'×', num:2, label:'بدل سفر ×2', note:'', ts:now-7*h, pinned:true },
    ]},
  ];
  state.activeId = 'demo1';
}

// ── INIT ─────────────────────────────────
function init() {
  loadAccounts();
  setCurrentThemeFromStorage();

  const active = safeJsonParse(localStorage.getItem(STORAGE_ACTIVE), null);
  if (active?.type === 'guest') {
    loadGuestSession();
  } else if (active?.type === 'account' && active?.username && loadAccountSession(active.username)) {
    // loaded
  } else {
    state.currentUser = null;
    state.sessionType = null;
    state.sections = [];
    state.activeId = null;
  }

  if (window.innerWidth < 700) state.sidebarOpen = false;
  applyTheme();
  $('sidebar').classList.toggle('collapsed', !state.sidebarOpen);
  $('sidebarToggle').classList.toggle('active', !state.sidebarOpen);

  renderAuthArea();
  renderSidebar();
  renderMain();

  if (!state.currentUser) openAuthGate(state.allowGuestEntry ? 'choose' : 'locked');

  setTimeout(() => {
    $('splash').classList.add('done');
    $('app').style.display = 'flex';
    $('app').style.flexDirection = 'column';
    $('app').style.height = '100vh';
    $('app').classList.remove('app-hidden');
  }, 1500);
}

init();
