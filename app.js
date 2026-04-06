import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as firebaseSignOut, onAuthStateChanged, updatePassword, reauthenticateWithCredential, EmailAuthProvider, deleteUser } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, deleteDoc, query, collection, where, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

// حماية من فشل تحميل Firebase
if (!window.__firebase) {
  console.error('[حسّاب] window.__firebase غير معرّف — Firebase لم يُحمَّل');
}
const auth = window.__firebase?.auth;
const db   = window.__firebase?.db;

// ===================== ثوابت التطبيق =====================
const COLORS = ['#f5c842','#f5904a','#f76e6e','#3ddba8','#5b9cf6','#b07ef8','#f472b6','#3dd6f5','#a3e635','#fb923c'];
const ICONS  = ['🛒','💼','🏠','✈️','🍔','💊','📚','⛽','🎮','💡','🎁','💰','🏋️','🧾','🔧','📱','🎓','🌿','🎵','🚗'];

const STORAGE_THEME = 'hassab_theme_v5';

// ===================== الحالة العامة =====================
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
  sectionsSortBy: 'name-asc',
  recordsSortBy: 'date-desc',
  focusMode: false,
  _modalColor: null,
  _modalIcon: null,
};

let currentUserId = null;
let unsubscribeSnapshot = null;
let isSyncing = false;
let usernameCheckTimeout = null;

// ===================== دوال مساعدة عامة =====================
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function escRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
}

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

function opClass(op) {
  return { '+':'op-plus-bg', '-':'op-minus-bg', '×':'op-times-bg', '÷':'op-divide-bg' }[op] || 'op-plus-bg';
}

function opPillClass(op) {
  return { '+':'plus', '-':'minus', '×':'times', '÷':'divide' }[op] || 'plus';
}

function highlight(text, query) {
  if (!query || !text) return escHtml(text || '');
  const re = new RegExp(`(${escRegex(query)})`, 'gi');
  return escHtml(text).replace(re, '<mark class="highlight">$1</mark>');
}

function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

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

function calcTotal(records) {
  return records.length ? calcRunning(records, records.length - 1) : 0;
}

function buildEquation(records, unit) {
  if (!records.length) return '—';
  const u = unit ? ` ${unit}` : '';
  return records.map((r, i) => {
    const lbl = r.label ? `(${r.label})` : '';
    return i === 0 ? `${formatNumber(r.num)}${u} ${lbl}`.trim() : `${r.op} ${formatNumber(r.num)}${u} ${lbl}`.trim();
  }).join(' ');
}

function sectionById(id) {
  return state.sections.find(s => s.id === id);
}

function toast(msg, type = '') {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function setSyncStatus(syncing, text) {
  const dot = $('#syncDot');
  const txt = $('#syncText');
  if (dot) {
    if (syncing) dot.classList.add('syncing');
    else dot.classList.remove('syncing');
  }
  if (txt) txt.textContent = text || (syncing ? 'جارِ المزامنة...' : 'متزامن');
}

// ===================== إدارة الحالة والمزامنة =====================
function currentPayload() {
  return {
    sections: state.sections,
    activeId: state.activeId,
    selectedOp: state.selectedOp,
    theme: state.theme,
    sidebarOpen: state.sidebarOpen,
    sectionsSortBy: state.sectionsSortBy,
    recordsSortBy: state.recordsSortBy,
    focusMode: state.focusMode,
  };
}

function applyPayload(payload = {}) {
  state.sections = Array.isArray(payload.sections) ? payload.sections : [];
  state.activeId = payload.activeId || (state.sections[0]?.id || null);
  state.selectedOp = payload.selectedOp || '+';
  state.theme = payload.theme || 'dark';
  state.sidebarOpen = payload.sidebarOpen !== undefined ? !!payload.sidebarOpen : true;
  state.sectionsSortBy = payload.sectionsSortBy || 'name-asc';
  state.recordsSortBy = payload.recordsSortBy || 'date-desc';
  state.focusMode = payload.focusMode === true;
  applyTheme();
}

async function saveToCloud() {
  if (!currentUserId || isSyncing) return;
  try {
    setSyncStatus(true, 'جاري الحفظ...');
    await setDoc(doc(db, "users", currentUserId, "data", "appData"), currentPayload());
    setSyncStatus(false, 'تم الحفظ');
  } catch (err) {
    console.error(err);
    setSyncStatus(false, 'خطأ');
    toast("فشل الحفظ في السحابة", "error");
  }
}

async function loadFromCloud(userId) {
  try {
    setSyncStatus(true, 'جاري التحميل...');
    const docRef = doc(db, "users", userId, "data", "appData");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      applyPayload(docSnap.data());
    } else {
      seedDemoForUser();
      await saveToCloud();
    }
    renderSidebar();
    renderMain();
    setSyncStatus(false, 'متزامن');
  } catch (err) {
    console.error(err);
    setSyncStatus(false, 'خطأ');
    toast("فشل تحميل البيانات", "error");
  }
}

// ===================== دوال المصادقة =====================
function closeAuthGate() {
  $('authGate')?.classList.add('modal-hidden');
}

function openAuthGate(mode = 'choose') {
  state.authGateMode = mode;
  renderAuthGate();
  $('authGate')?.classList.remove('modal-hidden');
  closeRecordSearch();
  closeAuthMenu();
}

function renderAuthGate() {
  const host = $('authGateBody');
  const title = $('authGateTitle');
  if (!host || !title) return;
  
  if (state.authGateMode === 'register') {
    title.textContent = 'إنشاء حساب';
    host.innerHTML = `
      <div class="auth-card">
        <label class="field-label">اسم المستخدم <span style="color: var(--red);">(فريد)</span></label>
        <div style="position: relative;">
          <input class="field-input" id="authRegUsername" maxlength="30" placeholder="مثال: john_doe" />
          <span id="regUsernameStatus" class="username-status"></span>
        </div>
        <label class="field-label" style="margin-top:12px">البريد الإلكتروني</label>
        <div style="position: relative;">
          <input class="field-input" id="authRegUser" type="email" placeholder="example@mail.com" />
          <span id="regEmailStatus" class="username-status"></span>
        </div>
        <label class="field-label" style="margin-top:12px">اسم العرض</label>
        <input class="field-input" id="authRegDisplayName" maxlength="30" placeholder="الاسم الذي يظهر" />
        <label class="field-label" style="margin-top:12px">كلمة المرور</label>
        <input class="field-input" id="authRegPass" type="password" placeholder="6+ أحرف مع كبير وصغير" />
        <label class="field-label" style="margin-top:12px">تأكيد كلمة المرور</label>
        <input class="field-input" id="authRegPass2" type="password" placeholder="أعد كتابة كلمة المرور" />
        <div class="auth-rules">كلمة المرور يجب أن تحتوي على حرف كبير وحرف صغير و6 أحرف على الأقل.</div>
        <div class="modal-actions auth-actions">
          <button class="btn-ghost" id="authBackBtn">رجوع</button>
          <button class="btn-primary" id="authCreateBtn">إنشاء الحساب</button>
        </div>
      </div>`;
    $('authBackBtn').onclick = () => openAuthGate('choose');
    $('authCreateBtn').onclick = () => submitRegister();
    
    const usernameInput = $('authRegUsername');
    const emailInput = $('authRegUser');
    usernameInput?.addEventListener('input', () => checkUsernameAvailability(usernameInput.value, 'regUsernameStatus'));
    emailInput?.addEventListener('input', () => checkEmailAvailability(emailInput.value, 'regEmailStatus'));
    
    ['authRegUser','authRegPass','authRegPass2','authRegDisplayName','authRegUsername'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') submitRegister(); });
    });
    return;
  }
  
  if (state.authGateMode === 'login') {
    title.textContent = 'تسجيل الدخول';
    host.innerHTML = `
      <div class="auth-card">
        <label class="field-label">البريد الإلكتروني أو اسم المستخدم</label>
        <input class="field-input" id="authLoginId" placeholder="example@mail.com أو اسم المستخدم" />
        <label class="field-label" style="margin-top:12px">كلمة المرور</label>
        <input class="field-input" id="authLoginPass" type="password" placeholder="كلمة المرور" />
        <div class="modal-actions auth-actions">
          <button class="btn-ghost" id="authBackBtn">رجوع</button>
          <button class="btn-primary" id="authLoginBtn">دخول</button>
        </div>
      </div>`;
    $('authBackBtn').onclick = () => openAuthGate('choose');
    $('authLoginBtn').onclick = () => submitLogin();
    $('authLoginId').addEventListener('keydown', e => { if (e.key === 'Enter') $('authLoginPass').focus(); });
    $('authLoginPass').addEventListener('keydown', e => { if (e.key === 'Enter') submitLogin(); });
    return;
  }
  
  title.textContent = 'مرحبًا بك';
  host.innerHTML = `
    <div class="auth-card auth-chooser">
      <button class="auth-choice-btn primary" id="showRegisterBtn">إنشاء حساب جديد</button>
      <button class="auth-choice-btn" id="showLoginBtn">تسجيل الدخول لحساب موجود</button>
    </div>`;
  $('showRegisterBtn').onclick = () => openAuthGate('register');
  $('showLoginBtn').onclick = () => openAuthGate('login');
}

async function checkUsernameAvailability(username, statusId) {
  const statusSpan = $(statusId);
  if (!username || username.length < 3) {
    if (statusSpan) statusSpan.innerHTML = '';
    return false;
  }
  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("username", "==", username.toLowerCase()));
    const querySnap = await getDocs(q);
    if (!querySnap.empty) {
      if (statusSpan) statusSpan.innerHTML = '✗';
      if (statusSpan) statusSpan.className = 'username-status invalid';
      return false;
    } else {
      if (statusSpan) statusSpan.innerHTML = '✓';
      if (statusSpan) statusSpan.className = 'username-status valid';
      return true;
    }
  } catch (err) {
    return false;
  }
}

async function checkEmailAvailability(email, statusId) {
  const statusSpan = $(statusId);
  if (!email || !email.includes('@')) {
    if (statusSpan) statusSpan.innerHTML = '';
    return false;
  }
  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("email", "==", email));
    const querySnap = await getDocs(q);
    if (!querySnap.empty) {
      if (statusSpan) statusSpan.innerHTML = '✗';
      if (statusSpan) statusSpan.className = 'username-status invalid';
      return false;
    } else {
      if (statusSpan) statusSpan.innerHTML = '✓';
      if (statusSpan) statusSpan.className = 'username-status valid';
      return true;
    }
  } catch (err) {
    return false;
  }
}

async function submitRegister() {
  const username = $('authRegUsername')?.value.trim().toLowerCase();
  const email = $('authRegUser')?.value.trim();
  const displayName = $('authRegDisplayName')?.value.trim();
  const password = $('authRegPass')?.value;
  const confirm = $('authRegPass2')?.value;
  
  if (!username) return toast('أدخل اسم المستخدم', 'error');
  if (!email) return toast('أدخل البريد الإلكتروني', 'error');
  if (!displayName) return toast('أدخل اسم العرض', 'error');
  if (!password) return toast('أدخل كلمة المرور', 'error');
  if (password !== confirm) return toast('كلمتا المرور غير متطابقتين', 'error');
  if (password.length < 6) return toast('كلمة المرور قصيرة جدًا (6+ أحرف)', 'error');
  
  const usernameAvailable = await checkUsernameAvailability(username, 'regUsernameStatus');
  if (!usernameAvailable) return toast('اسم المستخدم موجود مسبقاً', 'error');
  const emailAvailable = await checkEmailAvailability(email, 'regEmailStatus');
  if (!emailAvailable) return toast('البريد الإلكتروني موجود مسبقاً', 'error');
  
  const createBtn = $('authCreateBtn');
  if (createBtn) { createBtn.disabled = true; createBtn.textContent = 'جارِ الإنشاء...'; }

  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", userCred.user.uid), { username, displayName, email });
    applyPayload({ sections: [], activeId: null, selectedOp: '+', theme: state.theme, sidebarOpen: true });
    await saveToCloud();
    toast(`مرحبًا ${displayName} — جارِ تحميل التطبيق...`);
    // onAuthStateChanged يتولى إظهار التطبيق تلقائياً
  } catch (err) {
    console.error(err);
    if (createBtn) { createBtn.disabled = false; createBtn.textContent = 'إنشاء الحساب'; }
    let msg = err.message;
    if (msg.includes('email-already-in-use')) msg = 'البريد مستخدم بالفعل';
    toast(msg, 'error');
  }
}

async function submitLogin() {
  const loginId = $('authLoginId')?.value.trim().toLowerCase();
  const password = $('authLoginPass')?.value;
  if (!loginId || !password) return toast('أدخل البريد/اسم المستخدم وكلمة المرور', 'error');

  const btn = $('authLoginBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'جارِ الدخول...'; }

  let email = loginId;
  if (!loginId.includes('@')) {
    try {
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("username", "==", loginId));
      const querySnap = await getDocs(q);
      if (querySnap.empty) {
        if (btn) { btn.disabled = false; btn.textContent = 'دخول'; }
        return toast("اسم المستخدم غير موجود", "error");
      }
      email = querySnap.docs[0].data().email;
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'دخول'; }
      return toast("خطأ في الاتصال، حاول مرة أخرى", "error");
    }
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged يتولى إظهار التطبيق تلقائياً — لا نحتاج شيئاً هنا
  } catch (err) {
    console.error(err);
    if (btn) { btn.disabled = false; btn.textContent = 'دخول'; }
    toast("البريد/اسم المستخدم أو كلمة المرور غير صحيحة", "error");
  }
}

function signOutApp() {
  // onAuthStateChanged يتولى إظهار بوابة الدخول تلقائياً بعد signOut
  firebaseSignOut(auth)
    .then(() => toast("تم تسجيل الخروج"))
    .catch(err => toast(err.message, 'error'));
}

async function deleteAccountPermanently() {
  if (!currentUserId) return;
  const user = auth.currentUser;
  if (!user) return;
  
  try {
    setSyncStatus(true, 'جاري حذف الحساب...');
    const userDocRef = doc(db, "users", currentUserId);
    const dataDocRef = doc(db, "users", currentUserId, "data", "appData");
    await deleteDoc(dataDocRef);
    await deleteDoc(userDocRef);
    await deleteUser(user);
    currentUserId = null;
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    state.sections = [];
    state.activeId = null;
    renderSidebar();
    renderMain();
    renderAuthArea();
    openAuthGate('choose');
    toast("تم حذف الحساب نهائياً");
  } catch (err) {
    console.error(err);
    toast("فشل حذف الحساب: " + err.message, "error");
    setSyncStatus(false, 'خطأ');
  }
}

// ===================== دوال التطبيق الأساسية =====================
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

function shake(el) {
  if (!el) return;
  el.style.borderColor = 'var(--red)';
  el.style.boxShadow = '0 0 0 3px var(--red-dim)';
  setTimeout(() => {
    el.style.borderColor = '';
    el.style.boxShadow = '';
  }, 700);
}

function addRecord() {
  const sec = sectionById(state.activeId);
  if (!sec) return;
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
  saveToCloud().then(() => {
    renderSidebar();
    renderMain();
    toast(`${state.selectedOp} ${formatNumber(num)}${label ? ' (' + label + ')' : ''} ✓`);
  });
}

function deleteRecord(secId, recId) {
  const sec = sectionById(secId);
  if (!sec) return;
  sec.records = sec.records.filter(r => r.id !== recId);
  saveToCloud().then(() => {
    renderSidebar();
    renderMain();
    toast('🗑 تم حذف العملية');
  });
}

function togglePin(secId, recId) {
  const sec = sectionById(secId);
  const rec = sec?.records.find(r => r.id === recId);
  if (!rec) return;
  rec.pinned = !rec.pinned;
  saveToCloud().then(() => {
    renderMain();
    toast(rec.pinned ? '📌 تم تثبيت العملية' : '📌 تم إلغاء التثبيت');
  });
}

function openEditModal(secId, recId) {
  const sec = sectionById(secId);
  const rec = sec?.records.find(r => r.id === recId);
  if (!rec) return;
  state.editingRecord = { sectionId: secId, recordId: recId };
  $('editOp').value = rec.op;
  $('editNum').value = rec.num;
  $('editLabel').value = rec.label || '';
  $('editNote').value = rec.note || '';
  $('editModal')?.classList.remove('modal-hidden');
  setTimeout(() => $('editNum')?.focus(), 100);
}

function saveEditModal() {
  if (!state.editingRecord) return;
  const sec = sectionById(state.editingRecord.sectionId);
  const rec = sec?.records.find(r => r.id === state.editingRecord.recordId);
  if (!rec) return;
  const num = Number(String($('editNum').value || '').replace(/,/g, '').trim());
  if (!Number.isFinite(num) || num === 0) return shake($('editNum'));
  rec.op = $('editOp').value;
  rec.num = num;
  rec.label = $('editLabel').value.trim();
  rec.note = $('editNote').value.trim();
  $('editModal')?.classList.add('modal-hidden');
  saveToCloud().then(() => {
    renderSidebar();
    renderMain();
    toast('✅ تم حفظ التعديل');
  });
}

function confirmClearAll(secId) {
  state.pendingDelete = { type: 'all', sectionId: secId };
  const sec = sectionById(secId);
  if (!sec) return;
  $('confirmTitle').textContent = 'مسح جميع العمليات';
  $('confirmText').textContent = `هل تريد مسح جميع العمليات في "${sec.name}"؟ (${sec.records.length} عملية)`;
  $('confirmModal')?.classList.remove('modal-hidden');
}

function applyDelete() {
  const p = state.pendingDelete;
  if (!p) return;
  if (p.type === 'section') {
    state.sections = state.sections.filter(s => s.id !== p.id);
    if (state.activeId === p.id) state.activeId = state.sections[0]?.id || null;
    toast('🗑 تم حذف القسم');
  } else if (p.type === 'all') {
    const sec = sectionById(p.sectionId);
    if (sec) sec.records = [];
    toast('🗑 تم مسح جميع العمليات');
  }
  state.pendingDelete = null;
  $('confirmModal')?.classList.add('modal-hidden');
  saveToCloud().then(() => {
    renderSidebar();
    renderMain();
  });
}

function confirmDeleteSection(id) {
  const sec = sectionById(id);
  if (!sec) return;
  state.pendingDelete = { type: 'section', id };
  $('confirmTitle').textContent = 'حذف القسم';
  $('confirmText').textContent = `هل تريد حذف قسم "${sec.name}" وجميع عملياته (${sec.records.length} عملية)؟`;
  $('confirmModal')?.classList.remove('modal-hidden');
}

// ===================== دوال الفرز =====================
function sortRecords(records, sortBy) {
  if (!records.length) return records;
  const pinned = records.filter(r => r.pinned);
  const unpinned = records.filter(r => !r.pinned);
  const sortFn = (a, b) => {
    if (sortBy === 'date-asc') return a.ts - b.ts;
    if (sortBy === 'date-desc') return b.ts - a.ts;
    if (sortBy === 'value-asc') return a.num - b.num;
    if (sortBy === 'value-desc') return b.num - a.num;
    return 0;
  };
  return [...pinned, ...unpinned.sort(sortFn)];
}

function setRecordsSort(sortBy) {
  state.recordsSortBy = sortBy;
  saveToCloud();
  renderMain();
}

function sortSections(sections, sortBy) {
  const sorted = [...sections];
  if (sortBy === 'name-asc') sorted.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortBy === 'name-desc') sorted.sort((a, b) => b.name.localeCompare(a.name));
  else if (sortBy === 'count-desc') sorted.sort((a, b) => (b.records?.length || 0) - (a.records?.length || 0));
  return sorted;
}

function setSectionsSort(sortBy) {
  state.sectionsSortBy = sortBy;
  saveToCloud();
  renderSidebar();
}

function toggleFocusMode() {
  state.focusMode = !state.focusMode;
  saveToCloud();
  renderMain();
}

// ===================== دوال إدارة الأقسام =====================
function openSectionModal(sectionId) {
  closeRecordSearch();
  state.editingSection = sectionId || null;
  const sec = sectionId ? sectionById(sectionId) : null;
  $('sectionModalTitle').textContent = sec ? 'تعديل القسم' : 'قسم جديد';
  $('sectionNameInput').value = sec ? sec.name : '';
  $('sectionUnitInput').value = sec ? (sec.unit || '') : '';
  state._modalColor = sec ? sec.color : COLORS[Math.floor(Math.random() * COLORS.length)];
  state._modalIcon = sec ? sec.icon : ICONS[0];
  renderColorGrid();
  renderIconGrid();
  $('sectionModal')?.classList.remove('modal-hidden');
  setTimeout(() => $('sectionNameInput')?.focus(), 100);
}

function renderColorGrid() {
  const grid = $('colorGrid');
  if (!grid) return;
  grid.innerHTML = '';
  COLORS.forEach(c => {
    const d = document.createElement('div');
    d.className = 'color-dot' + (c === state._modalColor ? ' selected' : '');
    d.style.background = c;
    d.onclick = () => {
      state._modalColor = c;
      grid.querySelectorAll('.color-dot').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
    };
    grid.appendChild(d);
  });
}

function renderIconGrid() {
  const grid = $('iconGrid');
  if (!grid) return;
  grid.innerHTML = '';
  ICONS.forEach(ic => {
    const d = document.createElement('div');
    d.className = 'icon-option' + (ic === state._modalIcon ? ' selected' : '');
    d.textContent = ic;
    d.onclick = () => {
      state._modalIcon = ic;
      grid.querySelectorAll('.icon-option').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
    };
    grid.appendChild(d);
  });
}

function saveSectionModal() {
  const name = $('sectionNameInput').value.trim();
  if (!name) return $('sectionNameInput').focus();
  const unit = $('sectionUnitInput').value.trim();
  if (state.editingSection) {
    const sec = sectionById(state.editingSection);
    if (sec) {
      sec.name = name;
      sec.unit = unit;
      sec.color = state._modalColor;
      sec.icon = state._modalIcon;
    }
    toast('✅ تم تعديل القسم');
  } else {
    const sec = { id: uid(), name, unit, color: state._modalColor, icon: state._modalIcon, records: [] };
    state.sections.push(sec);
    state.activeId = sec.id;
    toast('✅ تم إنشاء القسم');
  }
  $('sectionModal')?.classList.add('modal-hidden');
  saveToCloud().then(() => {
    renderSidebar();
    renderMain();
  });
}

// ===================== دوال تعديل معلومات الحساب =====================
async function openEditAccountModal() {
  if (!currentUserId) return;
  const userDoc = await getDoc(doc(db, "users", currentUserId));
  const userData = userDoc.data();
  const currentDisplayName = userData?.displayName || '';
  const currentUsername = userData?.username || '';
  
  $('currentPassword').value = '';
  $('editDisplayName').value = currentDisplayName;
  $('editUsername').value = currentUsername;
  $('editNewPassword').value = '';
  $('editConfirmPassword').value = '';
  
  const statusSpan = $('#usernameStatus');
  if (statusSpan) {
    statusSpan.innerHTML = '';
    statusSpan.className = 'username-status';
  }
  
  $('editAccountModal')?.classList.remove('modal-hidden');
  
  const usernameInput = $('editUsername');
  const oldCheck = usernameInput?.getAttribute('data-listener');
  if (!oldCheck && usernameInput) {
    usernameInput.addEventListener('input', () => {
      const newUsername = usernameInput.value.trim().toLowerCase();
      if (!newUsername || newUsername === currentUsername) {
        if (statusSpan) statusSpan.innerHTML = '';
        return;
      }
      clearTimeout(usernameCheckTimeout);
      usernameCheckTimeout = setTimeout(async () => {
        const available = await checkUsernameAvailability(newUsername, 'usernameStatus');
        if (!available && statusSpan) {
          statusSpan.innerHTML = '✗';
          statusSpan.className = 'username-status invalid';
        } else if (available && statusSpan) {
          statusSpan.innerHTML = '✓';
          statusSpan.className = 'username-status valid';
        }
      }, 500);
    });
    usernameInput.setAttribute('data-listener', 'true');
  }
}

async function saveAccountChanges() {
  if (!currentUserId) return;
  const currentPass = $('currentPassword').value;
  if (!currentPass) return toast('يجب إدخال كلمة المرور الحالية لتأكيد التغييرات', 'error');
  
  const newDisplayName = $('editDisplayName').value.trim();
  const newUsernameRaw = $('editUsername').value.trim();
  const newUsername = newUsernameRaw ? newUsernameRaw.toLowerCase() : '';
  const newPassword = $('editNewPassword').value;
  const confirmPassword = $('editConfirmPassword').value;
  const user = auth.currentUser;
  if (!user) return toast('يجب تسجيل الدخول أولاً', 'error');
  const userEmail = user.email;
  
  try {
    const credential = EmailAuthProvider.credential(userEmail, currentPass);
    await reauthenticateWithCredential(user, credential);
  } catch (err) {
    console.error(err);
    return toast('كلمة المرور الحالية غير صحيحة', 'error');
  }
  
  const updates = {};
  let usernameChanged = false;
  
  if (newDisplayName && newDisplayName !== state.currentUser?.displayName) {
    updates.displayName = newDisplayName;
  }
  
  if (newUsername) {
    const userDoc = await getDoc(doc(db, "users", currentUserId));
    const oldUsername = userDoc.data()?.username;
    if (newUsername !== oldUsername) {
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("username", "==", newUsername));
      const querySnap = await getDocs(q);
      if (!querySnap.empty && querySnap.docs[0].id !== currentUserId) {
        return toast('اسم المستخدم موجود مسبقاً', 'error');
      }
      updates.username = newUsername;
      usernameChanged = true;
    }
  }
  
  if (Object.keys(updates).length) {
    await setDoc(doc(db, "users", currentUserId), updates, { merge: true });
    toast('✅ تم تحديث بيانات الحساب');
  }
  
  let passwordChanged = false;
  if (newPassword) {
    if (newPassword !== confirmPassword) return toast('كلمتا المرور الجديدة غير متطابقتين', 'error');
    if (newPassword.length < 6) return toast('كلمة المرور قصيرة جدًا (6+ أحرف)', 'error');
    await updatePassword(user, newPassword);
    toast('✅ تم تغيير كلمة المرور. سيتم تسجيل الخروج من جميع الأجهزة.');
    passwordChanged = true;
  }
  
  $('editAccountModal')?.classList.add('modal-hidden');
  
  if (passwordChanged || usernameChanged) {
    await firebaseSignOut(auth);
    currentUserId = null;
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    state.sections = [];
    state.activeId = null;
    renderSidebar();
    renderMain();
    renderAuthArea();
    openAuthGate('choose');
    toast(passwordChanged ? 'تم تسجيل الخروج بسبب تغيير كلمة المرور' : 'تم تسجيل الخروج بسبب تغيير اسم المستخدم');
  } else {
    const userDoc = await getDoc(doc(db, "users", currentUserId));
    const displayName = userDoc.data()?.displayName || user.email;
    state.currentUser = { email: user.email, displayName };
    renderAuthArea();
  }
}

// ===================== دوال التصدير =====================
function exportTxt(sec) {
  const unit = sec.unit || '';
  let txt = `حسّاب — ${sec.name}\n${'═'.repeat(28)}\n`;
  sec.records.forEach((r, i) => {
    txt += `${i+1}. ${i===0?'بداية':r.op} ${formatNumber(r.num)}${unit ? ' '+unit : ''}${r.label ? ' (' + r.label + ')' : ''}${r.note ? ' [' + r.note + ']' : ''}\n`;
  });
  txt += `\nالإجمالي: ${formatNumber(calcTotal(sec.records))}${unit ? ' '+unit : ''}`;
  downloadFile(`${sec.name}.txt`, txt, 'text/plain');
}

function exportCsv(sec) {
  let csv = 'الترتيب,العملية,الرقم,التسمية,الملاحظة,المجموع التراكمي,الوقت\n';
  sec.records.forEach((r, i) => {
    csv += `${i+1},${i===0?'بداية':r.op},${r.num},"${(r.label||'').replace(/"/g,'""')}","${(r.note||'').replace(/"/g,'""')}",${calcRunning(sec.records, i)},"${fmtDate(r.ts)}"\n`;
  });
  downloadFile(`${sec.name}.csv`, '\uFEFF' + csv, 'text/csv');
}

function copyToClipboard(sec) {
  const text = `${sec.icon} ${sec.name}\n${'─'.repeat(24)}\n` + 
    sec.records.map((r, i) => `${i===0?' ':r.op} ${formatNumber(r.num)}${sec.unit ? ' '+sec.unit : ''}${r.label ? ' ('+r.label+')' : ''}`).join('\n') + 
    `\n${'─'.repeat(24)}\n= ${formatNumber(calcTotal(sec.records))}${sec.unit ? ' '+sec.unit : ''}`;
  navigator.clipboard.writeText(text).then(() => toast('📋 تم النسخ للحافظة')).catch(() => toast('فشل النسخ', 'error'));
}

function printSection(sec) {
  const unit = sec.unit || '';
  const rows = sec.records.map((r, i) => {
    return `<tr>
        <td>${i+1}</td>
        <td>${i===0?'—':r.op}</td>
        <td><b>${formatNumber(r.num)}${unit ? ' '+unit : ''}</b></td>
        <td>${escHtml(r.label||'')}</td>
        <td>${escHtml(r.note||'')}</td>
        <td>${formatNumber(calcRunning(sec.records, i))}${unit ? ' '+unit : ''}</td>
     </td>`;
  }).join('');
  const w = window.open('', '_blank');
  if (!w) return toast('تعذر فتح نافذة الطباعة', 'error');
  w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>${escHtml(sec.name)}</title><style>body{font-family:sans-serif;padding:32px;direction:rtl}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:right}</style></head><body><h1>${escHtml(sec.name)}</h1><p>الوحدة: ${escHtml(unit || '—')}</p><table><thead><tr><th>#</th><th>العملية</th><th>الرقم</th><th>التسمية</th><th>ملاحظة</th><th>تراكمي</th></tr></thead><tbody>${rows}</tbody></table><p><b>الإجمالي: ${formatNumber(calcTotal(sec.records))}${unit ? ' '+unit : ''}</b></p></body></html>`);
  w.document.close();
  w.print();
}

function downloadFile(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
}

// ===================== دوال عرض الواجهات =====================
function closeAuthMenu() {
  state.authMenuOpen = false;
  $('authDropdown')?.classList.add('modal-hidden');
}

function openLogoutConfirm() {
  closeAuthMenu();
  $('logoutConfirmModal')?.classList.remove('modal-hidden');
}

function closeLogoutConfirm() {
  $('logoutConfirmModal')?.classList.add('modal-hidden');
}

function openDeleteAccountConfirm() {
  $('deleteAccountConfirmModal')?.classList.remove('modal-hidden');
}

function renderAuthArea() {
  const area = $('authArea');
  if (!area) return;
  if (!state.currentUser) {
    area.innerHTML = `<button class="auth-open-btn" id="openAuthBtn">الحساب</button>`;
    $('openAuthBtn').onclick = () => openAuthGate('choose');
    return;
  }
  const displayName = state.currentUser.displayName || state.currentUser.email || 'مستخدم';
  const email = state.currentUser.email || '';
  area.innerHTML = `
    <button class="auth-user-btn" id="authUserBtn">
      <div class="auth-avatar-placeholder">${escHtml(displayName.slice(0,1).toUpperCase())}</div>
      <span class="auth-name">${escHtml(displayName)}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      <div class="auth-dropdown modal-hidden" id="authDropdown">
        <div class="auth-dd-info">
          <div class="auth-dd-name">${escHtml(displayName)}</div>
          <div class="auth-dd-username">${escHtml(email)}</div>
        </div>
      </div>
    </button>`;
  $('authUserBtn').onclick = e => {
    e.stopPropagation();
    state.authMenuOpen = !state.authMenuOpen;
    $('authDropdown')?.classList.toggle('modal-hidden', !state.authMenuOpen);
  };
}

document.addEventListener('click', e => {
  if (!e.target.closest('#authArea')) closeAuthMenu();
});

function renderSidebar() {
  const list = $('sectionsList');
  if (!list) return;
  const q = state.sectionSearchQuery.trim().toLowerCase();
  let sections = q ? state.sections.filter(s => (s.name || '').toLowerCase().includes(q)) : state.sections;
  sections = sortSections(sections, state.sectionsSortBy);
  list.innerHTML = '';
  if (!sections.length) {
    list.innerHTML = `<div style="padding:24px 16px;text-align:center;color:var(--text3);font-size:13px;">لا توجد أقسام بعد<br>اضغط "جديد" للبدء</div>`;
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
      div.querySelector('.sec-act-btn.edit').onclick = e => {
        e.stopPropagation();
        openSectionModal(s.id);
      };
      div.querySelector('.sec-act-btn:not(.edit)').onclick = e => {
        e.stopPropagation();
        confirmDeleteSection(s.id);
      };
      div.onclick = () => {
        state.activeId = s.id;
        closeRecordSearch();
        renderSidebar();
        renderMain();
      };
      list.appendChild(div);
    });
  }
  const totalOps = state.sections.reduce((a, s) => a + (s.records || []).length, 0);
  $('globalStats').innerHTML = `
    <div class="g-stat"><span>الأقسام</span><strong>${formatNumber(state.sections.length)}</strong></div>
    <div class="g-stat"><span>إجمالي العمليات</span><strong>${formatNumber(totalOps)}</strong></div>`;
  $('sidebar')?.classList.toggle('collapsed', !state.sidebarOpen);
}

function buildOpPills() {
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
    };
    pills.appendChild(b);
  });
}

function renderTotalCard(sec) {
  const slot = $('totalCardSlot');
  if (!slot) return;
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
  const sg = $('statsGrid');
  if (!sg) return;
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
  const list = $('recordsList');
  const count = $('recCount');
  if (!list) return;
  if (count) {
    count.textContent = state.recordSearchOpen && state.searchQuery ? `${records.length} نتيجة من ${sec.records.length}` : `${sec.records.length} عملية`;
  }
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
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, card.dataset.recId);
    });
  });
}

function showContextMenu(event, recId) {
  const sec = sectionById(state.activeId);
  if (!sec) return;
  const menu = $('recordContextMenu');
  if (!menu) return;
  menu.style.top = `${event.clientY}px`;
  menu.style.left = `${event.clientX}px`;
  menu.classList.remove('modal-hidden');
  const closeMenu = () => menu.classList.add('modal-hidden');
  const onClickOutside = (e) => {
    if (!menu.contains(e.target)) closeMenu();
    document.removeEventListener('click', onClickOutside);
  };
  setTimeout(() => document.addEventListener('click', onClickOutside), 10);
  $('ctxEdit').onclick = () => {
    openEditModal(sec.id, recId);
    closeMenu();
  };
  $('ctxPin').onclick = () => {
    togglePin(sec.id, recId);
    closeMenu();
  };
  $('ctxDelete').onclick = () => {
    deleteRecord(sec.id, recId);
    closeMenu();
  };
}

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
      saveToCloud().then(() => renderMain());
      toast('تم إعادة ترتيب العمليات');
    });
  });
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
    <div class="section-view ${state.focusMode ? 'focus-mode' : ''}" style="--s-color:${sec.color}">
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
  $('exitSectionBtn').onclick = () => {
    state.activeId = null;
    renderMain();
    renderSidebar();
  };
  $('recNum').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('recLabel').focus();
  });
  $('recLabel').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('recNote').focus();
  });
  $('recNote').addEventListener('keydown', e => {
    if (e.key === 'Enter') addRecord();
  });
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
      const closeMenu = () => {
        if (menu && menu.remove) menu.remove();
        document.removeEventListener('click', closeMenu);
      };
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

// ===================== مستمعات الأحداث العامة =====================
function initEventListeners() {
  $('themeToggleBtn')?.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    saveToCloud();
    toast(state.theme === 'light' ? '☀️ المظهر الفاتح' : '🌙 المظهر الداكن');
  });
  $('sidebarToggle')?.addEventListener('click', () => {
    state.sidebarOpen = !state.sidebarOpen;
    $('sidebar')?.classList.toggle('collapsed', !state.sidebarOpen);
    saveToCloud();
  });
  $('searchToggleBtn')?.addEventListener('click', () => {
    if (!sectionById(state.activeId)) return toast('اختر قسماً أولاً', 'error');
    state.recordSearchOpen ? closeRecordSearch() : openRecordSearch();
    renderMain();
  });
  $('searchInput')?.addEventListener('input', e => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderMain();
  });
  $('clearSearch')?.addEventListener('click', () => {
    closeRecordSearch();
    renderMain();
  });
  $('sectionSearchInput')?.addEventListener('input', e => {
    state.sectionSearchQuery = e.target.value.trim().toLowerCase();
    renderSidebar();
  });
  $('newSectionBtn')?.addEventListener('click', () => openSectionModal(null));
  $('saveSectionBtn')?.addEventListener('click', saveSectionModal);
  $('sectionNameInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveSectionModal();
  });
  $('saveEditBtn')?.addEventListener('click', saveEditModal);
  $('confirmOkBtn')?.addEventListener('click', applyDelete);
  $('confirmLogoutBtn')?.addEventListener('click', () => {
    closeLogoutConfirm();
    signOutApp();
  });
  $('cancelLogoutBtn')?.addEventListener('click', closeLogoutConfirm);
  $('settingsBtn')?.addEventListener('click', () => $('settingsModal')?.classList.remove('modal-hidden'));
  $('editAccountBtn')?.addEventListener('click', () => {
    $('settingsModal')?.classList.add('modal-hidden');
    openEditAccountModal();
  });
  $('logoutSettingsBtn')?.addEventListener('click', () => {
    $('settingsModal')?.classList.add('modal-hidden');
    openLogoutConfirm();
  });
  $('deleteAccountBtn')?.addEventListener('click', () => {
    $('settingsModal')?.classList.add('modal-hidden');
    openDeleteAccountConfirm();
  });
  $('confirmDeleteAccountBtn')?.addEventListener('click', async () => {
    $('deleteAccountConfirmModal')?.classList.add('modal-hidden');
    await deleteAccountPermanently();
  });
  $('focusModeBtn')?.addEventListener('click', toggleFocusMode);
  $('saveAccountChangesBtn')?.addEventListener('click', saveAccountChanges);
  $('cancelEditAccountBtn')?.addEventListener('click', () => $('editAccountModal')?.classList.add('modal-hidden'));
  $('exportBtn')?.addEventListener('click', () => {
    const sec = sectionById(state.activeId);
    if (!sec) return toast('اختر قسماً أولاً', 'error');
    const opts = $('exportOptions');
    if (!opts) return;
    opts.innerHTML = '';
    [
      { icon:'📄', title:'نص عادي (.txt)', desc:'ملف نصي بسيط', fn:() => exportTxt(sec) },
      { icon:'📊', title:'CSV للجدول', desc:'مناسب لـ Excel', fn:() => exportCsv(sec) },
      { icon:'📋', title:'نسخ للحافظة', desc:'انسخ الملخص', fn:() => copyToClipboard(sec) },
      { icon:'🖨️', title:'طباعة / PDF', desc:'اطبع أو احفظ PDF', fn:() => printSection(sec) },
    ].forEach(o => {
      const d = document.createElement('div');
      d.className = 'export-opt';
      d.innerHTML = `<div class="e-icon">${o.icon}</div><div><h4>${o.title}</h4><p>${o.desc}</p></div>`;
      d.onclick = () => {
        o.fn();
        $('exportModal')?.classList.add('modal-hidden');
      };
      opts.appendChild(d);
    });
    $('exportModal')?.classList.remove('modal-hidden');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ['sectionModal','editModal','confirmModal','exportModal','logoutConfirmModal','settingsModal','editAccountModal','deleteAccountConfirmModal'].forEach(id => $(id)?.classList.add('modal-hidden'));
      closeAuthMenu();
      closeRecordSearch();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (sectionById(state.activeId)) {
        state.recordSearchOpen ? closeRecordSearch() : openRecordSearch();
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      openSectionModal(null);
    }
  });
  document.querySelectorAll('.overlay').forEach(ov => {
    ov.addEventListener('click', e => {
      if (e.target === ov) ov.classList.add('modal-hidden');
    });
  });
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => $(btn.dataset.close)?.classList.add('modal-hidden'));
  });
}

// ===================== مراقبة حالة المصادقة (المرجع الوحيد لكل انتقالات الـ UI) =====================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUserId = user.uid;

    // 1) إلغاء مهلة الـ Splash الاحتياطية فوراً
    if (window.__clearSplashTimer) window.__clearSplashTimer();

    // 2) إخفاء authGate وإظهار التطبيق فوراً (بدون انتظار تحميل البيانات)
    closeAuthGate();
    const splash = $('#splash');
    const appEl  = $('#app');
    if (splash) splash.classList.add('done');
    if (appEl)  appEl.classList.remove('app-hidden');

    // 3) جلب معلومات المستخدم
    try {
      const userDoc = await getDoc(doc(db, "users", currentUserId));
      const displayName = userDoc.data()?.displayName || user.email;
      state.currentUser = { email: user.email, displayName };
    } catch (e) {
      state.currentUser = { email: user.email, displayName: user.email };
    }

    // 4) تحديث الـ header وبدء الاستماع لتغييرات Firestore
    renderAuthArea();
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    const docRef = doc(db, "users", currentUserId, "data", "appData");
    unsubscribeSnapshot = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && !isSyncing) {
        const newData = docSnap.data();
        if (JSON.stringify(newData) !== JSON.stringify(currentPayload())) {
          applyPayload(newData);
          renderSidebar();
          renderMain();
        }
      }
    });

    // 5) تحميل البيانات ثم الرسم الكامل
    await loadFromCloud(currentUserId);
    renderSidebar();
    renderMain();

  } else {
    // المستخدم غير مسجّل (خروج أو لا يوجد جلسة محفوظة)
    currentUserId = null;
    state.currentUser = null;
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    state.sections = [];
    state.activeId = null;

    if (window.__clearSplashTimer) window.__clearSplashTimer();

    const splash = $('#splash');
    const appEl  = $('#app');
    if (splash) splash.classList.add('done');
    if (appEl)  appEl.classList.add('app-hidden');

    renderSidebar();
    renderMain();
    renderAuthArea();
    openAuthGate('choose');
  }
});

// ===================== بدء التطبيق =====================
function init() {
  const th = localStorage.getItem(STORAGE_THEME);
  if (th) state.theme = th;
  if (window.innerWidth < 700) state.sidebarOpen = false;
  applyTheme();
  $('sidebar')?.classList.toggle('collapsed', !state.sidebarOpen);
  renderAuthArea();
  renderSidebar();
  renderMain();
  initEventListeners();
  // المهلة الاحتياطية موجودة في index.html (9 ثوانٍ) وتعرض رسالة خطأ مع زر إعادة المحاولة
  // لا نضع مهلة هنا لأنها كانت تفتح بوابة الدخول للمستخدمين المسجّلين على الاتصالات البطيئة
}

// تعريف الدوال العامة
window.openEditModal = openEditModal;
window.deleteRecord = deleteRecord;
window.togglePin = togglePin;
window.openSectionModal = openSectionModal;
window.signOutApp = signOutApp;

init();