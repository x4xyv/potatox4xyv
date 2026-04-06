'use strict';

const COLORS = ['#f5c842','#f5904a','#f76e6e','#3ddba8','#5b9cf6','#b07ef8','#f472b6','#3dd6f5','#a3e635','#fb923c'];
const ICONS  = ['🛒','💼','🏠','✈️','🍔','💊','📚','⛽','🎮','💡','🎁','💰','🏋️','🧾','🔧','📱','🎓','🌿','🎵','🚗'];

const STORAGE_ACCOUNTS = 'hassab_accounts_v5';
const STORAGE_ACTIVE   = 'hassab_active_v5';
const STORAGE_THEME    = 'hassab_theme_v5';

const accountKey = u => `hassab_data_${normalizeUsername(u)}`;

let state = {
  theme: 'dark',
  sidebarOpen: true,
  sections: [],
  activeId: null,
  selectedOp: '+',
  pendingDelete: null,
  editingSection: null,
  editingRecord: null,
  searchQuery: '',
  sectionSearchQuery: '',
  recordSearchOpen: false,
  authGateMode: 'choose',
  authMenuOpen: false,
  accounts: [],
  currentUser: null,
  // إعدادات الفرز
  sectionsSortBy: 'name-asc', // name-asc, name-desc, count-desc
  recordsSortBy: 'date-desc', // date-asc, date-desc, value-asc, value-desc, manual
  recordDragSourceId: null,
};

const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
function escRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

function normalizeUsername(u) { return String(u || '').trim().toLowerCase(); }

function formatNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const rounded = Math.round(num * 1e6) / 1e6;
  const s = String(rounded);
  const [intPart, fracPart] = s.split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const digits = sign ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fracPart ? `${sign}${grouped}.${fracPart.replace(/0+$/,'')}`.replace(/\.$/, '') : `${sign}${grouped}`;
}

function fmtDate(ts) {
  const d = new Date(ts || Date.now());
  const h24 = d.getHours();
  const h12 = h24 % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const dd = d.getDate();
  const mo = d.getMonth() + 1;
  const yy = d.getFullYear();
  const ampm = h24 < 12 ? 'صباحًا' : 'مساءً';
  return `${h12}:${mm} ${ampm} — ${dd}/${mo}/${yy}`;
}

function opClass(op) { return { '+':'op-plus-bg', '-':'op-minus-bg', '×':'op-times-bg', '÷':'op-divide-bg' }[op] || 'op-plus-bg'; }
function opPillClass(op) { return { '+':'plus', '-':'minus', '×':'times', '÷':'divide' }[op] || 'plus'; }

function highlight(text, query) {
  if (!query || !text) return escHtml(text || '');
  const re = new RegExp(`(${escRegex(query)})`, 'gi');
  return escHtml(text).replace(re, '<mark class="highlight">$1</mark>');
}

function round6(v) { return Math.round(v * 1e6) / 1e6; }

function calcRunning(records, upto) {
  if (!records.length || upto < 0) return 0;
  let total = Number(records[0].num) || 0;
  for (let i = 1; i <= upto; i++) {
    const r = records[i];
    const num = Number(r.num) || 0;
    if (r.op === '+') total += num;
    else if (r.op === '-') total -= num;
    else if (r.op === '×') total *= num;
    else if (r.op === '÷') total = num !== 0 ? total / num : total;
  }
  return round6(total);
}

function calcTotal(records) { return records.length ? calcRunning(records, records.length - 1) : 0; }

function buildEquation(records, unit) {
  if (!records.length) return '—';
  const u = unit ? ` ${unit}` : '';
  return records.map((r, i) => {
    const lbl = r.label ? `(${r.label})` : '';
    return i === 0 ? `${formatNumber(r.num)}${u} ${lbl}`.trim() : `${r.op} ${formatNumber(r.num)}${u} ${lbl}`.trim();
  }).join(' ');
}

function sectionById(id) { return state.sections.find(s => s.id === id); }
function safeJson(raw, fallback) { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }

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

function toast(msg, type = '') {
  const el = $('toast'); if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function currentPayload() {
  return {
    sections: state.sections,
    activeId: state.activeId,
    selectedOp: state.selectedOp,
    theme: state.theme,
    sidebarOpen: state.sidebarOpen,
    sectionsSortBy: state.sectionsSortBy,
    recordsSortBy: state.recordsSortBy,
  };
}

function applyPayload(payload = {}) {
  state.sections = Array.isArray(payload.sections) ? payload.sections : [];
  state.activeId = payload.activeId || state.sections[0]?.id || null;
  state.selectedOp = payload.selectedOp || '+';
  state.theme = payload.theme || 'dark';
  state.sidebarOpen = payload.sidebarOpen !== undefined ? !!payload.sidebarOpen : true;
  state.sectionsSortBy = payload.sectionsSortBy || 'name-asc';
  state.recordsSortBy = payload.recordsSortBy || 'date-desc';
}

function loadAccounts() {
  state.accounts = safeJson(localStorage.getItem(STORAGE_ACCOUNTS), []);
  if (!Array.isArray(state.accounts)) state.accounts = [];
}
function saveAccounts() { localStorage.setItem(STORAGE_ACCOUNTS, JSON.stringify(state.accounts)); }

function saveSession() {
  localStorage.setItem(STORAGE_THEME, state.theme);
  if (state.currentUser?.username) {
    localStorage.setItem(accountKey(state.currentUser.username), JSON.stringify(currentPayload()));
    localStorage.setItem(STORAGE_ACTIVE, JSON.stringify({ username: state.currentUser.username }));
  }
}

function loadAccount(username) {
  const raw = localStorage.getItem(accountKey(username));
  if (!raw) return false;
  applyPayload(safeJson(raw, {}));
  const acc = state.accounts.find(a => normalizeUsername(a.username) === normalizeUsername(username));
  if (acc) {
    state.currentUser = { username: acc.username, displayName: acc.displayName, code: acc.code };
  } else {
    state.currentUser = { username, displayName: username, code: '' };
  }
  return true;
}

function validateUsername(username) {
  const u = String(username || '').trim();
  if (!u) return 'اكتب اسم المستخدم';
  if (u.length < 3) return 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل';
  if (!/^[A-Za-z0-9_.-]+$/.test(u)) return 'اسم المستخدم يجب أن يكون إنجليزيًا أو أرقامًا فقط';
  if (state.accounts.some(a => normalizeUsername(a.username) === normalizeUsername(u) && a.username !== state.currentUser?.username)) return 'اسم المستخدم مستخدم بالفعل';
  return '';
}

function validatePassword(pw) {
  const v = String(pw || '');
  if (v.length < 6) return 'كلمة المرور يجب ألا تقل عن 6 أحرف';
  if (!/[A-Z]/.test(v) || !/[a-z]/.test(v)) return 'يجب أن تحتوي كلمة المرور على حرف كبير وحرف صغير إنجليزيين على الأقل';
  return '';
}

async function hashPassword(pw) {
  if (window.crypto?.subtle?.digest) {
    const bytes = new TextEncoder().encode(pw);
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }
  let h = 0; for (let i = 0; i < pw.length; i++) h = ((h << 5) - h + pw.charCodeAt(i)) | 0;
  return String(h);
}

// --- واجهة المصادقة (بدون ضيف) ---
function closeAuthGate() { $('authGate')?.classList.add('modal-hidden'); }
function openAuthGate(mode = 'choose') {
  state.authGateMode = mode;
  renderAuthGate();
  $('authGate')?.classList.remove('modal-hidden');
  closeRecordSearch();
  closeAuthMenu();
}
function closeAuthMenu() {
  state.authMenuOpen = false;
  $('authDropdown')?.classList.add('modal-hidden');
}
function openLogoutConfirm() {
  closeAuthMenu();
  $('logoutConfirmModal')?.classList.remove('modal-hidden');
}
function closeLogoutConfirm() { $('logoutConfirmModal')?.classList.add('modal-hidden'); }

function renderAuthGate() {
  const host = $('authGateBody');
  const title = $('authGateTitle');
  if (!host || !title) return;
  if (state.authGateMode === 'register') {
    title.textContent = 'إنشاء حساب';
    host.innerHTML = `
      <div class="auth-card">
        <label class="field-label">اسم المستخدم (إنجليزي/أرقام)</label>
        <input class="field-input" id="authRegUser" maxlength="24" placeholder="مثال: ali_1" autocomplete="off" />
        <label class="field-label" style="margin-top:12px">اسم العرض (الاسم الظاهر)</label>
        <input class="field-input" id="authRegDisplayName" maxlength="30" placeholder="مثال: علي أحمد" />
        <label class="field-label" style="margin-top:12px">كلمة المرور</label>
        <input class="field-input" id="authRegPass" type="password" placeholder="6+ أحرف مع كبير وصغير" />
        <label class="field-label" style="margin-top:12px">تأكيد كلمة المرور</label>
        <input class="field-input" id="authRegPass2" type="password" placeholder="أعد كتابة كلمة المرور" />
        <div class="auth-rules">يجب أن تحتوي كلمة المرور على حرف كبير وحرف صغير إنجليزيين، وأن تكون 6 أحرف أو أكثر.</div>
        <div class="modal-actions auth-actions">
          <button class="btn-ghost" id="authBackBtn">رجوع</button>
          <button class="btn-primary" id="authCreateBtn">إنشاء الحساب</button>
        </div>
      </div>`;
    const userInput = $('authRegUser');
    if (userInput) {
      userInput.addEventListener('input', (e) => { e.target.value = e.target.value.toLowerCase(); });
    }
    $('authBackBtn').onclick = () => openAuthGate('choose');
    $('authCreateBtn').onclick = () => submitRegister();
    ['authRegUser','authRegPass','authRegPass2','authRegDisplayName'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') submitRegister(); });
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
        <div class="modal-actions auth-actions">
          <button class="btn-ghost" id="authBackBtn">رجوع</button>
          <button class="btn-primary" id="authLoginBtn">دخول</button>
        </div>
      </div>`;
    $('authBackBtn').onclick = () => openAuthGate('choose');
    $('authLoginBtn').onclick = () => submitLogin();
    $('authLoginUser').addEventListener('keydown', e => { if (e.key === 'Enter') $('authLoginPass').focus(); });
    $('authLoginPass').addEventListener('keydown', e => { if (e.key === 'Enter') submitLogin(); });
    return;
  }
  // وضع الاختيار
  title.textContent = 'مرحبًا بك';
  host.innerHTML = `
    <div class="auth-card auth-chooser">
      <button class="auth-choice-btn primary" id="showRegisterBtn">إنشاء حساب جديد</button>
      <button class="auth-choice-btn" id="showLoginBtn">تسجيل الدخول لحساب موجود</button>
    </div>`;
  $('showRegisterBtn').onclick = () => openAuthGate('register');
  $('showLoginBtn').onclick = () => openAuthGate('login');
}

async function submitRegister() {
  const username = $('authRegUser')?.value.trim().toLowerCase() || '';
  const displayName = $('authRegDisplayName')?.value.trim() || '';
  const password = $('authRegPass')?.value || '';
  const confirm = $('authRegPass2')?.value || '';
  const uErr = validateUsername(username); if (uErr) return toast(uErr, 'error');
  if (!displayName) return toast('يرجى إدخال اسم العرض', 'error');
  const pErr = validatePassword(password); if (pErr) return toast(pErr, 'error');
  if (password !== confirm) return toast('كلمتا المرور غير متطابقتين', 'error');
  const code = `HS-${uid().slice(0,6).toUpperCase()}`;
  const hash = await hashPassword(password);
  state.accounts.push({ username, displayName, code, passwordHash: hash, createdAt: Date.now() });
  saveAccounts();
  state.currentUser = { username, displayName, code };
  applyPayload({ sections: [], activeId: null, selectedOp: '+', theme: state.theme, sidebarOpen: true });
  saveSession();
  closeAuthGate();
  renderAuthArea(); renderSidebar(); renderMain();
  toast(`✅ تم إنشاء الحساب: ${displayName}`);
}

async function submitLogin() {
  const username = $('authLoginUser')?.value.trim().toLowerCase() || '';
  const password = $('authLoginPass')?.value || '';
  const acc = state.accounts.find(a => normalizeUsername(a.username) === username);
  if (!acc) return toast('اسم المستخدم أو كلمة المرور غير صحيحة', 'error');
  const hash = await hashPassword(password);
  if (hash !== acc.passwordHash) return toast('اسم المستخدم أو كلمة المرور غير صحيحة', 'error');
  if (!loadAccount(acc.username)) applyPayload({ sections: [], activeId: null, selectedOp: '+', theme: state.theme, sidebarOpen: true });
  saveSession();
  closeAuthGate();
  renderAuthArea(); renderSidebar(); renderMain();
  toast(`👋 مرحبًا ${acc.displayName || acc.username}`);
}

function signOut() {
  saveSession();
  localStorage.removeItem(STORAGE_ACTIVE);
  state.currentUser = null;
  state.sections = [];
  state.activeId = null;
  state.searchQuery = '';
  state.recordSearchOpen = false;
  state.authMenuOpen = false;
  closeLogoutConfirm();
  renderAuthArea(); renderSidebar(); renderMain();
  openAuthGate('choose');
  toast('👋 تم تسجيل الخروج');
}

function switchAccount() {
  saveSession();
  localStorage.removeItem(STORAGE_ACTIVE);
  state.currentUser = null;
  state.sections = [];
  state.activeId = null;
  state.searchQuery = '';
  state.recordSearchOpen = false;
  closeAuthMenu();
  renderAuthArea(); renderSidebar(); renderMain();
  openAuthGate('choose');
}

// --- تعديل معلومات الحساب ---
function openEditAccountModal() {
  if (!state.currentUser) return;
  const acc = state.accounts.find(a => a.username === state.currentUser.username);
  if (!acc) return;
  $('editUsername').value = acc.username;
  $('editDisplayName').value = acc.displayName || '';
  $('editAccountCode').value = acc.code || '';
  $('editAccountModal')?.classList.remove('modal-hidden');
}

async function saveAccountChanges() {
  const newUsername = $('editUsername').value.trim().toLowerCase();
  const newDisplayName = $('editDisplayName').value.trim();
  if (!newUsername) return toast('اسم المستخدم مطلوب', 'error');
  if (!newDisplayName) return toast('اسم العرض مطلوب', 'error');
  const usernameErr = validateUsername(newUsername);
  if (usernameErr) return toast(usernameErr, 'error');
  
  const oldUsername = state.currentUser.username;
  const accIndex = state.accounts.findIndex(a => a.username === oldUsername);
  if (accIndex === -1) return toast('حدث خطأ في الحساب', 'error');
  
  // نقل البيانات من المفتاح القديم إلى الجديد إذا تغير اسم المستخدم
  if (newUsername !== oldUsername) {
    const oldData = localStorage.getItem(accountKey(oldUsername));
    if (oldData) localStorage.setItem(accountKey(newUsername), oldData);
    localStorage.removeItem(accountKey(oldUsername));
    state.accounts[accIndex].username = newUsername;
  }
  state.accounts[accIndex].displayName = newDisplayName;
  saveAccounts();
  
  // تحديث currentUser
  state.currentUser.username = newUsername;
  state.currentUser.displayName = newDisplayName;
  // تحديث active session
  localStorage.setItem(STORAGE_ACTIVE, JSON.stringify({ username: newUsername }));
  saveSession();
  
  $('editAccountModal')?.classList.add('modal-hidden');
  renderAuthArea();
  toast('✅ تم تحديث معلومات الحساب');
}

// --- إدارة العمليات (إضافة، تعديل، حذف، تثبيت، فرز، سحب) ---
function addRecord() {
  const sec = sectionById(state.activeId); if (!sec) return;
  const numStr = String($('recNum').value || '').replace(/,/g,'').trim();
  const num = Number(numStr);
  if (!Number.isFinite(num) || num === 0) return shake($('recNum'));
  const label = $('recLabel').value.trim();
  const note = $('recNote').value.trim();
  const rec = { id: uid(), op: state.selectedOp, num, label, note, ts: Date.now(), pinned: false };
  sec.records.push(rec);
  $('recNum').value = '';
  $('recLabel').value = '';
  $('recNote').value = '';
  $('recNum').focus();
  saveSession(); renderSidebar(); renderMain();
  toast(`${state.selectedOp} ${formatNumber(num)}${label ? ' (' + label + ')' : ''} ✓`);
}

function shake(el) { if (!el) return; el.style.borderColor = 'var(--red)'; el.style.boxShadow = '0 0 0 3px var(--red-dim)'; setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 700); }

function openEditModal(secId, recId) {
  const sec = sectionById(secId); const rec = sec?.records.find(r => r.id === recId); if (!rec) return;
  state.editingRecord = { sectionId: secId, recordId: recId };
  $('editOp').value = rec.op; $('editNum').value = rec.num; $('editLabel').value = rec.label || ''; $('editNote').value = rec.note || '';
  $('editModal')?.classList.remove('modal-hidden'); setTimeout(() => $('editNum')?.focus(), 100);
}

function saveEditModal() {
  if (!state.editingRecord) return;
  const sec = sectionById(state.editingRecord.sectionId); const rec = sec?.records.find(r => r.id === state.editingRecord.recordId); if (!rec) return;
  const num = Number(String($('editNum').value || '').replace(/,/g, '').trim()); if (!Number.isFinite(num) || num === 0) return shake($('editNum'));
  rec.op = $('editOp').value; rec.num = num; rec.label = $('editLabel').value.trim(); rec.note = $('editNote').value.trim();
  $('editModal')?.classList.add('modal-hidden');
  saveSession(); renderSidebar(); renderMain();
  toast('✅ تم حفظ التعديل');
}

function deleteRecord(secId, recId) {
  const sec = sectionById(secId); if (!sec) return;
  sec.records = sec.records.filter(r => r.id !== recId);
  saveSession(); renderSidebar(); renderMain();
  toast('🗑 تم حذف العملية');
}

function togglePin(secId, recId) {
  const sec = sectionById(secId); const rec = sec?.records.find(r => r.id === recId); if (!rec) return;
  rec.pinned = !rec.pinned; saveSession(); renderMain(); toast(rec.pinned ? '📌 تم تثبيت العملية' : '📌 تم إلغاء التثبيت');
}

function confirmClearAll(secId) {
  state.pendingDelete = { type: 'all', sectionId: secId };
  const sec = sectionById(secId); if (!sec) return;
  $('confirmTitle').textContent = 'مسح جميع العمليات';
  $('confirmText').textContent = `هل تريد مسح جميع العمليات في "${sec.name}"؟ (${sec.records.length} عملية)`;
  $('confirmModal')?.classList.remove('modal-hidden');
}

function applyDelete() {
  const p = state.pendingDelete; if (!p) return;
  if (p.type === 'section') {
    state.sections = state.sections.filter(s => s.id !== p.id);
    if (state.activeId === p.id) state.activeId = state.sections[0]?.id || null;
    toast('🗑 تم حذف القسم');
  } else if (p.type === 'all') {
    const sec = sectionById(p.sectionId); if (sec) sec.records = [];
    toast('🗑 تم مسح جميع العمليات');
  }
  state.pendingDelete = null;
  $('confirmModal')?.classList.add('modal-hidden');
  saveSession(); renderSidebar(); renderMain();
}

// --- فرز العمليات ---
function sortRecords(records, sortBy) {
  if (!records.length) return records;
  const pinned = records.filter(r => r.pinned);
  const unpinned = records.filter(r => !r.pinned);
  const sortFn = (a, b) => {
    if (sortBy === 'date-asc') return a.ts - b.ts;
    if (sortBy === 'date-desc') return b.ts - a.ts;
    if (sortBy === 'value-asc') return a.num - b.num;
    if (sortBy === 'value-desc') return b.num - a.num;
    return 0; // manual
  };
  const sortedUnpinned = [...unpinned].sort(sortFn);
  return [...pinned, ...sortedUnpinned];
}

function setRecordsSort(sortBy) {
  state.recordsSortBy = sortBy;
  saveSession();
  renderMain();
}

// --- فرز الأقسام ---
function sortSections(sections, sortBy) {
  const sorted = [...sections];
  if (sortBy === 'name-asc') sorted.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortBy === 'name-desc') sorted.sort((a, b) => b.name.localeCompare(a.name));
  else if (sortBy === 'count-desc') sorted.sort((a, b) => (b.records?.length || 0) - (a.records?.length || 0));
  return sorted;
}

function setSectionsSort(sortBy) {
  state.sectionsSortBy = sortBy;
  saveSession();
  renderSidebar();
}

// --- عرض الواجهات ---
function renderAuthArea() {
  const area = $('authArea'); if (!area) return;
  if (!state.currentUser) {
    area.innerHTML = `<button class="auth-open-btn" id="openAuthBtn">الحساب</button>`;
    $('openAuthBtn').onclick = () => openAuthGate('choose');
    return;
  }
  const displayName = state.currentUser.displayName || state.currentUser.username;
  area.innerHTML = `
    <button class="auth-user-btn" id="authUserBtn">
      <div class="auth-avatar-placeholder">${escHtml(displayName.slice(0,1).toUpperCase())}</div>
      <span class="auth-name">${escHtml(displayName)}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      <div class="auth-dropdown modal-hidden" id="authDropdown">
        <div class="auth-dd-info">
          <div class="auth-dd-name">${escHtml(displayName)}</div>
          <div class="auth-dd-email">${escHtml(state.currentUser.code || '')}</div>
        </div>
        <button class="auth-dd-item" id="switchAccountBtn">تبديل الحساب</button>
        <button class="auth-dd-item danger" id="signOutBtn">تسجيل الخروج</button>
      </div>
    </button>`;
  $('authUserBtn').onclick = e => {
    e.stopPropagation();
    state.authMenuOpen = !state.authMenuOpen;
    $('authDropdown')?.classList.toggle('modal-hidden', !state.authMenuOpen);
  };
  $('switchAccountBtn').onclick = e => { e.stopPropagation(); switchAccount(); };
  $('signOutBtn').onclick = e => { e.stopPropagation(); openLogoutConfirm(); };
}

function renderSidebar() {
  const list = $('sectionsList');
  if (!list) return;
  const q = state.sectionSearchQuery.trim().toLowerCase();
  let sections = q ? state.sections.filter(s => (s.name || '').toLowerCase().includes(q)) : state.sections;
  sections = sortSections(sections, state.sectionsSortBy);
  
  list.innerHTML = '';
  if (!sections.length) {
    list.innerHTML = `<div style="padding:24px 16px;text-align:center;color:var(--text3);font-size:13px;line-height:1.7">لا توجد أقسام بعد<br>اضغط "جديد" للبدء</div>`;
  } else {
    sections.forEach(s => {
      const total = calcTotal(s.records || []);
      const div = document.createElement('div');
      div.className = 'section-item' + (s.id === state.activeId ? ' active' : '');
      div.style.setProperty('--item-color', s.color);
      div.innerHTML = `
        <div class="sec-icon" style="background:${s.color}22">${s.icon}</div>
        <div class="sec-body">
          <div class="sec-name">${escHtml(s.name)}</div>
          <div class="sec-meta">${formatNumber(total)}${s.unit ? ' ' + escHtml(s.unit) : ''} · ${formatNumber((s.records || []).length)}</div>
        </div>
        <div class="sec-actions">
          <button class="sec-act-btn edit" title="تعديل">✎</button>
          <button class="sec-act-btn" title="حذف">🗑</button>
        </div>`;
      div.querySelector('.sec-act-btn.edit').onclick = e => { e.stopPropagation(); openSectionModal(s.id); };
      div.querySelector('.sec-act-btn:not(.edit)').onclick = e => { e.stopPropagation(); confirmDeleteSection(s.id); };
      div.onclick = () => { state.activeId = s.id; closeRecordSearch(); renderSidebar(); renderMain(); };
      list.appendChild(div);
    });
  }
  
  const totalOps = state.sections.reduce((a, s) => a + (s.records || []).length, 0);
  $('globalStats').innerHTML = `
    <div class="g-stat"><span>الأقسام</span><strong>${formatNumber(state.sections.length)}</strong></div>
    <div class="g-stat"><span>إجمالي العمليات</span><strong>${formatNumber(totalOps)}</strong></div>`;
  $('sidebar')?.classList.toggle('collapsed', !state.sidebarOpen);
}

function renderMain() {
  const main = $('mainContent');
  if (!main) return;
  const sec = sectionById(state.activeId);
  if (!sec) {
    closeRecordSearch();
    main.innerHTML = `
      <div class="welcome">
        <div class="welcome-icon">🧮</div>
        <h2>مرحباً بك في حسّاب</h2>
        <p>دفتر الحساب الذكي الذي يحفظ أسماء كل بند<br>وتاريخ كل عملية — منظم ودقيق.</p>
        <div class="welcome-features">
          <div class="feat-chip">📋 أقسام متعددة</div>
          <div class="feat-chip">🏷 تسميات</div>
          <div class="feat-chip">🔍 بحث</div>
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
          <button class="exit-section-btn" id="exitSectionBtn" title="الخروج من القسم">✕</button>
        </div>
        <div id="totalCardSlot"></div>
        <div class="stats-grid" id="statsGrid" style="margin-top:10px"></div>
      </div>

      <div class="input-area">
        <div class="input-stack">
          <div class="input-row input-row-top">
            <div class="op-pills" id="opPills"></div>
            <input type="number" class="inp inp-num" id="recNum" placeholder="0" step="any" />
          </div>
          <div class="input-row input-row-bottom">
            <input type="text" class="inp inp-label" id="recLabel" placeholder="التسمية (مثال: خبز، وقود...)" maxlength="40" />
            <input type="text" class="inp inp-note" id="recNote" placeholder="ملاحظة (اختياري)" maxlength="80" />
          </div>
          <div class="input-row input-row-add">
            <button class="btn-add" id="addRecBtn">إضافة ＋</button>
          </div>
        </div>
      </div>

      <div class="records-area">
        <div class="records-toolbar">
          <span class="rec-count" id="recCount"></span>
          <div class="toolbar-actions">
            <button class="btn-ghost-sm" id="sortBtn">فرز ▼</button>
            <button class="btn-ghost-sm danger" id="clearAllBtn">مسح الكل</button>
          </div>
        </div>
        <div id="recordsList"></div>
      </div>
    </div>`;

  buildOpPills();
  $('addRecBtn').onclick = addRecord;
  $('clearAllBtn').onclick = () => confirmClearAll(sec.id);
  $('exitSectionBtn').onclick = () => { state.activeId = null; renderMain(); renderSidebar(); };
  $('recNum').addEventListener('keydown', e => { if (e.key === 'Enter') $('recLabel').focus(); });
  $('recLabel').addEventListener('keydown', e => { if (e.key === 'Enter') $('recNote').focus(); });
  $('recNote').addEventListener('keydown', e => { if (e.key === 'Enter') addRecord(); });
  
  // قائمة فرز متقدمة
  const sortBtn = $('sortBtn');
  if (sortBtn) {
    sortBtn.onclick = (e) => {
      e.stopPropagation();
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      menu.style.position = 'fixed';
      menu.style.top = `${e.clientY}px`;
      menu.style.left = `${e.clientX}px`;
      menu.innerHTML = `
        <div class="context-menu-item ${state.recordsSortBy === 'date-desc' ? 'active' : ''}" data-sort="date-desc">📅 الأحدث أولاً</div>
        <div class="context-menu-item ${state.recordsSortBy === 'date-asc' ? 'active' : ''}" data-sort="date-asc">📅 الأقدم أولاً</div>
        <div class="context-menu-item ${state.recordsSortBy === 'value-desc' ? 'active' : ''}" data-sort="value-desc">🔽 الأكبر قيمة</div>
        <div class="context-menu-item ${state.recordsSortBy === 'value-asc' ? 'active' : ''}" data-sort="value-asc">🔼 الأصغر قيمة</div>
      `;
      document.body.appendChild(menu);
      const closeMenu = () => { if (menu && menu.remove) menu.remove(); document.removeEventListener('click', closeMenu); };
      setTimeout(() => document.addEventListener('click', closeMenu), 10);
      menu.querySelectorAll('[data-sort]').forEach(el => {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          setRecordsSort(el.dataset.sort);
          closeMenu();
        });
      });
    };
  }

  renderTotalCard(sec);
  renderRecords(sec);
  initDragAndDrop(sec.id);
}

function buildOpPills() {
  const pills = $('opPills'); if (!pills) return;
  pills.innerHTML = '';
  ['+','-','×','÷'].forEach(op => {
    const b = document.createElement('button');
    b.className = `op-pill ${opPillClass(op)}${op === state.selectedOp ? ' active' : ''}`;
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
  const slot = $('totalCardSlot'); if (!slot) return;
  const total = calcTotal(sec.records || []);
  const unit = sec.unit || '';
  const eq = buildEquation(sec.records || [], unit);
  let addSum = 0, subSum = 0, mulCnt = 0, divCnt = 0;
  (sec.records || []).forEach((r, i) => {
    if (i === 0) return;
    if (r.op === '+') addSum += Number(r.num) || 0;
    if (r.op === '-') subSum += Number(r.num) || 0;
    if (r.op === '×') mulCnt++;
    if (r.op === '÷') divCnt++;
  });
  slot.innerHTML = `
    <div class="total-card" style="--s-color:${sec.color}">
      <div>
        <div class="total-label">المجموع الكلي</div>
        <div class="total-number">${formatNumber(total)}${unit ? ` <span class="total-unit">${escHtml(unit)}</span>` : ''}</div>
        <div class="total-equation">${escHtml(eq)}</div>
      </div>
    </div>`;
  const sg = $('statsGrid'); if (!sg) return;
  sg.innerHTML = `
    <div class="stat-chip green"><span class="s-label">إضافات</span><span class="s-val">${formatNumber(addSum)}</span></div>
    <div class="stat-chip red"><span class="s-label">طرح</span><span class="s-val">${formatNumber(subSum)}</span></div>
    <div class="stat-chip blue"><span class="s-label">عمليات</span><span class="s-val">${formatNumber((sec.records || []).length)}</span></div>
    ${(mulCnt + divCnt) ? `<div class="stat-chip orange"><span class="s-label">ضرب/قسمة</span><span class="s-val">${formatNumber(mulCnt + divCnt)}</span></div>` : ''}`;
}

function renderRecords(sec) {
  let records = sec.records || [];
  const q = state.searchQuery.trim().toLowerCase();
  if (state.recordSearchOpen && q) {
    records = records.filter(r => (r.label || '').toLowerCase().includes(q) || (r.note || '').toLowerCase().includes(q) || String(r.num).includes(q));
  }
  records = sortRecords(records, state.recordsSortBy);
  _renderList(sec, records);
}

function _renderList(sec, records) {
  const list = $('recordsList'); const count = $('recCount'); if (!list) return;
  if (count) count.textContent = state.recordSearchOpen && state.searchQuery ? `${records.length} نتيجة من ${sec.records.length}` : `${sec.records.length} عملية`;
  if (!records.length) {
    list.innerHTML = `<div class="empty-records"><div class="e-icon">${state.recordSearchOpen && state.searchQuery ? '🔍' : '📋'}</div><p>${state.recordSearchOpen && state.searchQuery ? `لا توجد نتائج لـ "${escHtml(state.searchQuery)}"` : 'لا توجد عمليات بعد<br>أضف أول عملية من الحقول أعلاه'}</p></div>`;
    return;
  }
  
  list.innerHTML = records.map((r, idx) => {
    const trueIdx = sec.records.findIndex(x => x.id === r.id);
    const running = calcRunning(sec.records, trueIdx);
    const isFirst = trueIdx === 0;
    const lbl = state.recordSearchOpen && state.searchQuery ? highlight(r.label || '', state.searchQuery) : escHtml(r.label || '');
    return `
      <div class="record-card${r.pinned ? ' pinned' : ''}" data-rec-id="${r.id}" data-rec-index="${trueIdx}">
        ${r.pinned ? '<div class="pin-dot"></div>' : ''}
        <div class="rec-index">${formatNumber(trueIdx + 1)}</div>
        <div class="rec-op-badge ${opClass(isFirst ? '+' : r.op)}">${isFirst ? '①' : r.op}</div>
        <div class="rec-body">
          <div class="rec-main-line">
            <span class="rec-num">${formatNumber(r.num)}</span>
            ${r.label ? `<span class="rec-label-text">${lbl}</span>` : ''}
          </div>
          ${r.note ? `<div class="rec-note">📝 ${escHtml(r.note)}</div>` : ''}
          <div class="rec-running">= <span>${formatNumber(running)}${sec.unit ? ' ' + escHtml(sec.unit) : ''}</span></div>
          <div class="rec-timestamp">${fmtDate(r.ts)}</div>
        </div>
      </div>`;
  }).join('');
  
  // إضافة مستمعات الضغط الطويل لإظهار قائمة السياق
  document.querySelectorAll('.record-card').forEach(card => {
    let pressTimer;
    card.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      pressTimer = setTimeout(() => {
        showContextMenu(e, card.dataset.recId);
      }, 500);
    });
    card.addEventListener('mouseup', () => clearTimeout(pressTimer));
    card.addEventListener('mouseleave', () => clearTimeout(pressTimer));
    // منع القائمة الافتراضية للمتصفح
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, card.dataset.recId);
    });
  });
}

function showContextMenu(event, recId) {
  const sec = sectionById(state.activeId);
  if (!sec) return;
  const existingMenu = $('recordContextMenu');
  if (!existingMenu) return;
  
  existingMenu.style.top = `${event.clientY}px`;
  existingMenu.style.left = `${event.clientX}px`;
  existingMenu.classList.remove('modal-hidden');
  
  const closeMenu = () => existingMenu.classList.add('modal-hidden');
  const onClickOutside = (e) => {
    if (!existingMenu.contains(e.target)) closeMenu();
    document.removeEventListener('click', onClickOutside);
  };
  setTimeout(() => document.addEventListener('click', onClickOutside), 10);
  
  const ctxEdit = $('ctxEdit');
  const ctxPin = $('ctxPin');
  const ctxDelete = $('ctxDelete');
  
  const rec = sec.records.find(r => r.id === recId);
  if (!rec) return;
  
  ctxEdit.onclick = () => { openEditModal(sec.id, recId); closeMenu(); };
  ctxPin.onclick = () => { togglePin(sec.id, recId); closeMenu(); };
  ctxDelete.onclick = () => { deleteRecord(sec.id, recId); closeMenu(); };
}

// --- السحب والإفلات لإعادة ترتيب العمليات ---
function initDragAndDrop(sectionId) {
  const cards = document.querySelectorAll('.record-card');
  let dragSrc = null;
  
  cards.forEach(card => {
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', (e) => {
      dragSrc = card;
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', (e) => {
      card.classList.remove('dragging');
      dragSrc = null;
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    card.addEventListener('dragenter', (e) => {
      if (dragSrc !== card) card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', (e) => {
      card.classList.remove('drag-over');
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (!dragSrc || dragSrc === card) return;
      const srcId = dragSrc.dataset.recId;
      const destId = card.dataset.recId;
      const sec = sectionById(sectionId);
      if (!sec) return;
      const srcIndex = sec.records.findIndex(r => r.id === srcId);
      const destIndex = sec.records.findIndex(r => r.id === destId);
      if (srcIndex === -1 || destIndex === -1) return;
      const [moved] = sec.records.splice(srcIndex, 1);
      sec.records.splice(destIndex, 0, moved);
      saveSession();
      renderMain();
      toast('تم إعادة ترتيب العمليات');
    });
  });
}

// --- إدارة الأقسام ---
function openSectionModal(sectionId) {
  closeRecordSearch();
  state.editingSection = sectionId || null;
  const sec = sectionId ? sectionById(sectionId) : null;
  $('sectionModalTitle').textContent = sec ? 'تعديل القسم' : 'قسم جديد';
  $('sectionNameInput').value = sec ? sec.name : '';
  $('sectionUnitInput').value = sec ? (sec.unit || '') : '';
  state._modalColor = sec ? sec.color : COLORS[Math.floor(Math.random() * COLORS.length)];
  state._modalIcon = sec ? sec.icon : ICONS[0];
  renderColorGrid(); renderIconGrid();
  $('sectionModal')?.classList.remove('modal-hidden');
  setTimeout(() => $('sectionNameInput')?.focus(), 100);
}

function renderColorGrid() {
  const grid = $('colorGrid'); if (!grid) return;
  grid.innerHTML = '';
  COLORS.forEach(c => {
    const d = document.createElement('div');
    d.className = 'color-dot' + (c === state._modalColor ? ' selected' : '');
    d.style.background = c;
    d.onclick = () => { state._modalColor = c; grid.querySelectorAll('.color-dot').forEach(x => x.classList.remove('selected')); d.classList.add('selected'); };
    grid.appendChild(d);
  });
}

function renderIconGrid() {
  const grid = $('iconGrid'); if (!grid) return;
  grid.innerHTML = '';
  ICONS.forEach(ic => {
    const d = document.createElement('div');
    d.className = 'icon-option' + (ic === state._modalIcon ? ' selected' : '');
    d.textContent = ic;
    d.onclick = () => { state._modalIcon = ic; grid.querySelectorAll('.icon-option').forEach(x => x.classList.remove('selected')); d.classList.add('selected'); };
    grid.appendChild(d);
  });
}

function saveSectionModal() {
  const name = $('sectionNameInput').value.trim(); if (!name) return $('sectionNameInput').focus();
  const unit = $('sectionUnitInput').value.trim();
  if (state.editingSection) {
    const sec = sectionById(state.editingSection);
    if (sec) { sec.name = name; sec.unit = unit; sec.color = state._modalColor; sec.icon = state._modalIcon; }
    toast('✅ تم تعديل القسم');
  } else {
    const sec = { id: uid(), name, unit, color: state._modalColor, icon: state._modalIcon, records: [] };
    state.sections.push(sec);
    state.activeId = sec.id;
    toast('✅ تم إنشاء القسم');
  }
  $('sectionModal')?.classList.add('modal-hidden');
  saveSession(); renderSidebar(); renderMain();
}

function confirmDeleteSection(id) {
  const sec = sectionById(id); if (!sec) return;
  state.pendingDelete = { type: 'section', id };
  $('confirmTitle').textContent = 'حذف القسم';
  $('confirmText').textContent = `هل تريد حذف قسم "${sec.name}" وجميع عملياته (${sec.records.length} عملية)؟`;
  $('confirmModal')?.classList.remove('modal-hidden');
}

// --- تصدير ---
function exportTxt(sec) {
  const unit = sec.unit || '';
  let txt = `حسّاب — ${sec.name}\n${'═'.repeat(28)}\n`;
  sec.records.forEach((r, i) => { txt += `${i+1}. ${i===0?'بداية':r.op} ${formatNumber(r.num)}${unit ? ' '+unit : ''}${r.label ? ' (' + r.label + ')' : ''}${r.note ? ' [' + r.note + ']' : ''}\n`; });
  txt += `\nالإجمالي: ${formatNumber(calcTotal(sec.records))}${unit ? ' '+unit : ''}`;
  downloadFile(`${sec.name}.txt`, txt, 'text/plain');
}

function exportCsv(sec) {
  let csv = 'الترتيب,العملية,الرقم,التسمية,الملاحظة,المجموع التراكمي,الوقت\n';
  sec.records.forEach((r, i) => { csv += `${i+1},${i===0?'بداية':r.op},${r.num},"${(r.label||'').replace(/"/g,'""')}","${(r.note||'').replace(/"/g,'""')}",${calcRunning(sec.records, i)},"${fmtDate(r.ts)}"\n`; });
  downloadFile(`${sec.name}.csv`, '\uFEFF' + csv, 'text/csv');
}

function copyToClipboard(sec) {
  const text = `${sec.icon} ${sec.name}\n${'─'.repeat(24)}\n` + sec.records.map((r, i) => `${i===0?' ':r.op} ${formatNumber(r.num)}${sec.unit ? ' '+sec.unit : ''}${r.label ? ' ('+r.label+')' : ''}`).join('\n') + `\n${'─'.repeat(24)}\n= ${formatNumber(calcTotal(sec.records))}${sec.unit ? ' '+sec.unit : ''}`;
  navigator.clipboard.writeText(text).then(() => toast('📋 تم النسخ للحافظة')).catch(() => toast('فشل النسخ', 'error'));
}

function printSection(sec) {
  const unit = sec.unit || '';
  const rows = sec.records.map((r, i) => `<tr><td>${i+1}</td><td>${i===0?'—':r.op}</td><td><b>${formatNumber(r.num)}${unit ? ' '+unit : ''}</b></td><td>${escHtml(r.label||'')}</td><td>${escHtml(r.note||'')}</td><td>${formatNumber(calcRunning(sec.records, i))}${unit ? ' '+unit : ''}</td></tr>`).join('');
  const w = window.open('', '_blank');
  if (!w) return toast('تعذر فتح نافذة الطباعة', 'error');
  w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>${escHtml(sec.name)}</title><style>body{font-family:sans-serif;padding:32px;direction:rtl}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:right}</style></head><body><h1>${escHtml(sec.name)}</h1><p>الوحدة: ${escHtml(unit || '—')}</p><table><thead><tr><th>#</th><th>العملية</th><th>الرقم</th><th>التسمية</th><th>ملاحظة</th><th>تراكمي</th></tr></thead><tbody>${rows}</tbody></table><p><b>الإجمالي: ${formatNumber(calcTotal(sec.records))}${unit ? ' '+unit : ''}</b></p></body></html>`);
  w.document.close(); w.print();
}

function downloadFile(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename; a.click();
}

// --- بيانات تجريبية للمستخدم الجديد ---
function seedDemoForUser() {
  const now = Date.now(); const h = 3600000;
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

// --- إغلاق البحث ---
function closeRecordSearch() {
  state.recordSearchOpen = false;
  state.searchQuery = '';
  const bar = $('searchBar'); if (bar) bar.classList.remove('open');
  const input = $('searchInput'); if (input) input.value = '';
}

function openRecordSearch() {
  if (!sectionById(state.activeId)) return toast('اختر قسماً أولاً', 'error');
  state.recordSearchOpen = true;
  $('searchBar')?.classList.add('open');
  $('searchInput')?.focus();
}

// --- تهيئة التطبيق ---
function init() {
  loadAccounts();
  const th = localStorage.getItem(STORAGE_THEME); if (th) state.theme = th;
  const active = safeJson(localStorage.getItem(STORAGE_ACTIVE), null);
  if (active?.username && loadAccount(active.username)) {
    // تم تحميل الحساب
  } else {
    state.currentUser = null;
    state.sections = [];
    state.activeId = null;
  }
  if (!state.sections.length && state.currentUser) {
    seedDemoForUser();
    saveSession();
  }
  if (window.innerWidth < 700) state.sidebarOpen = false;
  applyTheme();
  $('sidebar')?.classList.toggle('collapsed', !state.sidebarOpen);
  renderAuthArea(); renderSidebar(); renderMain();
  if (!state.currentUser) openAuthGate('choose');
  setTimeout(() => { $('splash')?.classList.add('done'); $('app')?.classList.remove('app-hidden'); }, 1000);
}

// --- مستمعات الأحداث ---
$('themeToggleBtn')?.addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(); saveSession(); toast(state.theme === 'light' ? '☀️ المظهر الفاتح' : '🌙 المظهر الداكن'); });
$('sidebarToggle')?.addEventListener('click', () => { state.sidebarOpen = !state.sidebarOpen; $('sidebar')?.classList.toggle('collapsed', !state.sidebarOpen); saveSession(); });
$('searchToggleBtn')?.addEventListener('click', () => { if (!sectionById(state.activeId)) return toast('اختر قسماً أولاً', 'error'); state.recordSearchOpen ? closeRecordSearch() : openRecordSearch(); renderMain(); });
$('searchInput')?.addEventListener('input', e => { state.searchQuery = e.target.value.trim().toLowerCase(); renderMain(); });
$('clearSearch')?.addEventListener('click', () => { closeRecordSearch(); renderMain(); });
$('sectionSearchInput')?.addEventListener('input', e => { state.sectionSearchQuery = e.target.value.trim().toLowerCase(); renderSidebar(); });
$('newSectionBtn')?.addEventListener('click', () => openSectionModal(null));
$('saveSectionBtn')?.addEventListener('click', saveSectionModal);
$('sectionNameInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveSectionModal(); });
$('saveEditBtn')?.addEventListener('click', saveEditModal);
$('confirmOkBtn')?.addEventListener('click', applyDelete);
$('confirmLogoutBtn')?.addEventListener('click', () => { closeLogoutConfirm(); signOut(); });
$('cancelLogoutBtn')?.addEventListener('click', closeLogoutConfirm);
$('settingsBtn')?.addEventListener('click', () => $('settingsModal')?.classList.remove('modal-hidden'));
$('editAccountBtn')?.addEventListener('click', () => { $('settingsModal')?.classList.add('modal-hidden'); openEditAccountModal(); });
$('logoutSettingsBtn')?.addEventListener('click', () => { $('settingsModal')?.classList.add('modal-hidden'); openLogoutConfirm(); });
$('saveAccountChangesBtn')?.addEventListener('click', saveAccountChanges);
$('cancelEditAccountBtn')?.addEventListener('click', () => $('editAccountModal')?.classList.add('modal-hidden'));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['sectionModal','editModal','confirmModal','exportModal','logoutConfirmModal','authGate','settingsModal','editAccountModal'].forEach(id => $(id)?.classList.add('modal-hidden'));
    closeAuthMenu(); closeRecordSearch();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (sectionById(state.activeId)) state.recordSearchOpen ? closeRecordSearch() : openRecordSearch(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); openSectionModal(null); }
});

document.querySelectorAll('.overlay').forEach(ov => { ov.addEventListener('click', e => { if (e.target === ov) ov.classList.add('modal-hidden'); }); });
document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => $(btn.dataset.close)?.classList.add('modal-hidden')));

$('exportBtn')?.addEventListener('click', () => {
  const sec = sectionById(state.activeId); if (!sec) return toast('اختر قسماً أولاً', 'error');
  const opts = $('exportOptions'); if (!opts) return;
  opts.innerHTML = '';
  [
    { icon:'📄', title:'نص عادي (.txt)', desc:'ملف نصي بسيط', fn:() => exportTxt(sec) },
    { icon:'📊', title:'CSV للجدول', desc:'مناسب لـ Excel', fn:() => exportCsv(sec) },
    { icon:'📋', title:'نسخ للحافظة', desc:'انسخ الملخص', fn:() => copyToClipboard(sec) },
    { icon:'🖨️', title:'طباعة / PDF', desc:'اطبع أو احفظ PDF', fn:() => printSection(sec) },
  ].forEach(o => { const d = document.createElement('div'); d.className = 'export-opt'; d.innerHTML = `<div class="e-icon">${o.icon}</div><div><h4>${o.title}</h4><p>${o.desc}</p></div>`; d.onclick = () => { o.fn(); $('exportModal')?.classList.add('modal-hidden'); }; opts.appendChild(d); });
  $('exportModal')?.classList.remove('modal-hidden');
});

// تعريف الدوال العامة للاستخدام في onclicks المضمنة
window.openEditModal = openEditModal;
window.deleteRecord = deleteRecord;
window.togglePin = togglePin;
window.openSectionModal = openSectionModal;
window.signOut = signOut;

init();