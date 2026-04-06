import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as firebaseSignOut, onAuthStateChanged, updatePassword, EmailAuthProvider, reauthenticateWithCredential, deleteUser } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, deleteDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const { auth, db } = window.__firebase;

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

// ===================== دوال مساعدة عامة =====================
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
  state.activeId = payload.activeId || state.sections[0]?.id || null;
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

async function isUsernameTaken(username) {
  if (!username) return false;
  const q = query(collection(db, "users"), where("username", "==", username));
  const snap = await getDocs(q);
  return !snap.empty;
}

async function isEmailTaken(email) {
  // يتم التحقق من Firebase Auth تلقائياً، لكننا نتحقق أيضاً من Firestore
  const q = query(collection(db, "users"), where("email", "==", email));
  const snap = await getDocs(q);
  return !snap.empty;
}

function renderAuthGate() {
  const host = $('authGateBody');
  const title = $('authGateTitle');
  if (!host || !title) return;
  
  if (state.authGateMode === 'register') {
    title.textContent = 'إنشاء حساب';
    host.innerHTML = `
      <div class="auth-card">
        <label class="field-label">اسم المستخدم (فريد)</label>
        <div class="username-input-wrapper" style="position: relative;">
          <input class="field-input" id="authRegUsername" maxlength="30" placeholder="اسم المستخدم" style="padding-left: 36px;" />
          <span id="regUsernameStatus" class="username-status"></span>
        </div>
        <label class="field-label" style="margin-top:12px">البريد الإلكتروني</label>
        <input class="field-input" id="authRegUser" type="email" placeholder="example@mail.com" />
        <label class="field-label" style="margin-top:12px">اسم العرض</label>
        <input class="field-input" id="authRegDisplayName" maxlength="30" placeholder="الاسم الذي يظهر" />
        <label class="field-label" style="margin-top:12px">كلمة المرور</label>
        <input class="field-input" id="authRegPass" type="password" placeholder="6+ أحرف" />
        <label class="field-label" style="margin-top:12px">تأكيد كلمة المرور</label>
        <input class="field-input" id="authRegPass2" type="password" placeholder="أعد كتابة كلمة المرور" />
        <div class="auth-rules">كلمة المرور يجب أن تحتوي على 6 أحرف على الأقل.</div>
        <div class="modal-actions auth-actions">
          <button class="btn-ghost" id="authBackBtn">رجوع</button>
          <button class="btn-primary" id="authCreateBtn">إنشاء الحساب</button>
        </div>
      </div>`;
    
    // التحقق من توفر اسم المستخدم في الوقت الفعلي
    const usernameInput = $('#authRegUsername');
    const statusSpan = $('#regUsernameStatus');
    let checkTimeout;
    usernameInput.addEventListener('input', async () => {
      clearTimeout(checkTimeout);
      const val = usernameInput.value.trim();
      if (val.length < 3) {
        statusSpan.innerHTML = '';
        statusSpan.className = 'username-status';
        return;
      }
      checkTimeout = setTimeout(async () => {
        const taken = await isUsernameTaken(val);
        if (taken) {
          statusSpan.innerHTML = '❌';
          statusSpan.className = 'username-status invalid';
        } else {
          statusSpan.innerHTML = '✅';
          statusSpan.className = 'username-status valid';
        }
      }, 500);
    });
    
    $('authBackBtn').onclick = () => openAuthGate('choose');
    $('authCreateBtn').onclick = () => submitRegister();
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
        <input class="field-input" id="authLoginId" placeholder="example@mail.com أو username" />
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

async function submitRegister() {
  const username = $('#authRegUsername')?.value.trim().toLowerCase();
  const email = $('#authRegUser')?.value.trim();
  const displayName = $('#authRegDisplayName')?.value.trim();
  const password = $('#authRegPass')?.value;
  const confirm = $('#authRegPass2')?.value;
  
  if (!username) return toast('أدخل اسم المستخدم', 'error');
  if (username.length < 3) return toast('اسم المستخدم يجب أن يكون 3 أحرف على الأقل', 'error');
  if (!email) return toast('أدخل البريد الإلكتروني', 'error');
  if (!displayName) return toast('أدخل اسم العرض', 'error');
  if (!password) return toast('أدخل كلمة المرور', 'error');
  if (password !== confirm) return toast('كلمتا المرور غير متطابقتين', 'error');
  if (password.length < 6) return toast('كلمة المرور قصيرة جدًا (6+ أحرف)', 'error');
  
  // التحقق من أن اسم المستخدم غير مستخدم
  const usernameTaken = await isUsernameTaken(username);
  if (usernameTaken) return toast('اسم المستخدم مستخدم بالفعل', 'error');
  
  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    currentUserId = userCred.user.uid;
    await setDoc(doc(db, "users", currentUserId), { 
      username, 
      displayName, 
      email 
    });
    applyPayload({ sections: [], activeId: null, selectedOp: '+', theme: state.theme, sidebarOpen: true });
    await saveToCloud();
    closeAuthGate();
    renderAuthArea();
    renderSidebar();
    renderMain();
    toast(`مرحبًا ${displayName}`);
  } catch (err) {
    console.error(err);
    let msg = err.message;
    if (msg.includes('email-already-in-use')) msg = 'البريد مستخدم بالفعل';
    toast(msg, 'error');
  }
}

async function submitLogin() {
  const loginId = $('#authLoginId')?.value.trim();
  const password = $('#authLoginPass')?.value;
  if (!loginId || !password) return toast('أدخل البريد/اسم المستخدم وكلمة المرور', 'error');
  
  // تحديد ما إذا كان المدخل بريداً إلكترونياً أم اسم مستخدم
  const isEmail = loginId.includes('@') && loginId.includes('.');
  let email = loginId;
  
  if (!isEmail) {
    // البحث عن البريد الإلكتروني المرتبط باسم المستخدم
    const q = query(collection(db, "users"), where("username", "==", loginId.toLowerCase()));
    const snap = await getDocs(q);
    if (snap.empty) return toast("اسم المستخدم غير موجود", "error");
    email = snap.docs[0].data().email;
  }
  
  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    currentUserId = userCred.user.uid;
    await loadFromCloud(currentUserId);
    closeAuthGate();
    renderAuthArea();
    renderSidebar();
    renderMain();
    toast("تم تسجيل الدخول بنجاح");
  } catch (err) {
    console.error(err);
    toast("البريد/اسم المستخدم أو كلمة المرور غير صحيحة", "error");
  }
}

function signOutApp() {
  firebaseSignOut(auth).then(() => {
    currentUserId = null;
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    state.sections = [];
    state.activeId = null;
    renderSidebar();
    renderMain();
    renderAuthArea();
    openAuthGate('choose');
    toast("تم تسجيل الخروج");
  }).catch(err => toast(err.message, 'error'));
}

// ===================== حذف الحساب نهائياً =====================
async function deleteAccountPermanently() {
  if (!currentUserId) return;
  const user = auth.currentUser;
  if (!user) return toast('لا يوجد مستخدم مسجل دخول', 'error');
  
  // تأكيد إضافي
  const confirmed = confirm("⚠️ تحذير: أنت على وشك حذف حسابك نهائياً! سيتم حذف جميع بياناتك (الأقسام والعمليات) بشكل دائم. لا يمكن التراجع عن هذا الإجراء. هل أنت متأكد؟");
  if (!confirmed) return;
  
  try {
    setSyncStatus(true, 'جاري حذف الحساب...');
    // 1. حذف بيانات التطبيق من Firestore
    await deleteDoc(doc(db, "users", currentUserId, "data", "appData"));
    // 2. حذف وثيقة المستخدم الرئيسية
    await deleteDoc(doc(db, "users", currentUserId));
    // 3. حذف حساب المصادقة
    await deleteUser(user);
    // 4. تسجيل الخروج
    await firebaseSignOut(auth);
    currentUserId = null;
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    state.sections = [];
    state.activeId = null;
    renderSidebar();
    renderMain();
    renderAuthArea();
    openAuthGate('choose');
    toast("تم حذف الحساب بنجاح");
  } catch (err) {
    console.error(err);
    // قد يحتاج المستخدم إلى إعادة المصادقة إذا كان الحساب قديماً
    if (err.code === 'auth/requires-recent-login') {
      toast("لأسباب أمنية، يرجى تسجيل الخروج ثم تسجيل الدخول مرة أخرى قبل حذف الحساب", "error");
    } else {
      toast("فشل حذف الحساب: " + err.message, "error");
    }
  } finally {
    setSyncStatus(false);
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

// ===================== دوال تعديل معلومات الحساب المتقدمة =====================
let editAccountState = {
  originalUsername: '',
  originalDisplayName: '',
  newUsername: '',
  newDisplayName: '',
  newPassword: '',
  confirmPassword: '',
  currentPassword: '',
  passwordChangeRequested: false,
  usernameAvailable: true
};

async function openEditAccountModal() {
  if (!currentUserId) return;
  const userDoc = await getDoc(doc(db, "users", currentUserId));
  const userData = userDoc.data() || {};
  editAccountState.originalUsername = userData.username || '';
  editAccountState.originalDisplayName = userData.displayName || '';
  editAccountState.newUsername = editAccountState.originalUsername;
  editAccountState.newDisplayName = editAccountState.originalDisplayName;
  editAccountState.newPassword = '';
  editAccountState.confirmPassword = '';
  editAccountState.currentPassword = '';
  editAccountState.passwordChangeRequested = false;
  editAccountState.usernameAvailable = true;
  
  renderEditAccountForm();
  $('editAccountModal')?.classList.remove('modal-hidden');
}

function renderEditAccountForm() {
  const container = $('#editAccountForm');
  if (!container) return;
  
  container.innerHTML = `
    <label class="field-label">اسم العرض الحالي</label>
    <input type="text" class="field-input" id="editDisplayName" maxlength="30" value="${escHtml(editAccountState.newDisplayName)}" placeholder="اسم العرض" />
    
    <label class="field-label" style="margin-top:14px">اسم المستخدم الحالي (فريد)</label>
    <div class="username-input-wrapper" style="position: relative;">
      <input type="text" class="field-input" id="editUsername" maxlength="30" value="${escHtml(editAccountState.newUsername)}" placeholder="اسم المستخدم" style="padding-left: 36px;" />
      <span id="editUsernameStatus" class="username-status ${editAccountState.usernameAvailable ? 'valid' : 'invalid'}">${editAccountState.usernameAvailable ? '✅' : '❌'}</span>
    </div>
    
    <label class="field-label" style="margin-top:14px">تغيير كلمة المرور</label>
    <button class="btn-ghost-sm" id="togglePasswordChangeBtn" style="width:100%; margin-bottom:8px;">${editAccountState.passwordChangeRequested ? 'إلغاء تغيير كلمة المرور' : 'تغيير كلمة المرور'}</button>
    
    <div id="passwordChangeFields" style="display: ${editAccountState.passwordChangeRequested ? 'block' : 'none'};">
      <label class="field-label" style="margin-top:8px">كلمة المرور الحالية</label>
      <input type="password" class="field-input" id="editCurrentPassword" placeholder="أدخل كلمة المرور الحالية" />
      <label class="field-label" style="margin-top:12px">كلمة المرور الجديدة</label>
      <input type="password" class="field-input" id="editNewPassword" placeholder="6+ أحرف" />
      <label class="field-label" style="margin-top:12px">تأكيد كلمة المرور الجديدة</label>
      <input type="password" class="field-input" id="editConfirmPassword" placeholder="أعد كتابة كلمة المرور الجديدة" />
    </div>
    
    <div class="modal-actions" style="margin-top:22px;">
      <button class="btn-ghost" id="cancelEditAccountBtn">إلغاء</button>
      <button class="btn-primary" id="saveAccountChangesBtn">حفظ التغييرات</button>
    </div>
  `;
  
  // ربط الأحداث
  $('#editDisplayName').addEventListener('input', (e) => {
    editAccountState.newDisplayName = e.target.value.trim();
  });
  
  const usernameInput = $('#editUsername');
  const statusSpan = $('#editUsernameStatus');
  let checkTimeout;
  usernameInput.addEventListener('input', async (e) => {
    const val = e.target.value.trim().toLowerCase();
    editAccountState.newUsername = val;
    clearTimeout(checkTimeout);
    if (val === editAccountState.originalUsername) {
      editAccountState.usernameAvailable = true;
      statusSpan.innerHTML = '✅';
      statusSpan.className = 'username-status valid';
      return;
    }
    if (val.length < 3) {
      editAccountState.usernameAvailable = false;
      statusSpan.innerHTML = '❌';
      statusSpan.className = 'username-status invalid';
      return;
    }
    checkTimeout = setTimeout(async () => {
      const taken = await isUsernameTaken(val);
      editAccountState.usernameAvailable = !taken;
      if (taken) {
        statusSpan.innerHTML = '❌';
        statusSpan.className = 'username-status invalid';
      } else {
        statusSpan.innerHTML = '✅';
        statusSpan.className = 'username-status valid';
      }
    }, 500);
  });
  
  $('#togglePasswordChangeBtn').onclick = () => {
    editAccountState.passwordChangeRequested = !editAccountState.passwordChangeRequested;
    renderEditAccountForm();
  };
  
  $('#cancelEditAccountBtn').onclick = () => {
    $('editAccountModal')?.classList.add('modal-hidden');
  };
  
  $('#saveAccountChangesBtn').onclick = async () => {
    await saveAccountChanges();
  };
}

async function saveAccountChanges() {
  if (!currentUserId) return;
  const user = auth.currentUser;
  if (!user) return toast('يجب تسجيل الدخول أولاً', 'error');
  
  const newDisplayName = editAccountState.newDisplayName;
  const newUsername = editAccountState.newUsername.toLowerCase();
  const originalUsername = editAccountState.originalUsername;
  const passwordChangeRequested = editAccountState.passwordChangeRequested;
  
  // التحقق من صحة اسم المستخدم الجديد إذا تم تغييره
  if (newUsername !== originalUsername) {
    if (newUsername.length < 3) return toast('اسم المستخدم يجب أن يكون 3 أحرف على الأقل', 'error');
    if (!editAccountState.usernameAvailable) return toast('اسم المستخدم غير متوفر', 'error');
    const taken = await isUsernameTaken(newUsername);
    if (taken) return toast('اسم المستخدم مستخدم بالفعل', 'error');
  }
  
  // إذا كان هناك طلب لتغيير كلمة المرور
  if (passwordChangeRequested) {
    const currentPassword = $('#editCurrentPassword')?.value;
    const newPassword = $('#editNewPassword')?.value;
    const confirmPassword = $('#editConfirmPassword')?.value;
    
    if (!currentPassword) return toast('أدخل كلمة المرور الحالية', 'error');
    if (!newPassword) return toast('أدخل كلمة المرور الجديدة', 'error');
    if (newPassword !== confirmPassword) return toast('كلمتا المرور الجديدة غير متطابقتين', 'error');
    if (newPassword.length < 6) return toast('كلمة المرور الجديدة قصيرة جدًا (6+ أحرف)', 'error');
    
    // إعادة المصادقة قبل تغيير كلمة المرور
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      toast('✅ تم تغيير كلمة المرور');
      // تسجيل الخروج من جميع الأجهزة (سيحدث تلقائياً عند تغيير كلمة المرور)
      // نعيد توجيه المستخدم إلى شاشة تسجيل الدخول
      setTimeout(() => {
        signOutApp();
      }, 1500);
      $('editAccountModal')?.classList.add('modal-hidden');
      return;
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/wrong-password') {
        return toast('كلمة المرور الحالية غير صحيحة', 'error');
      }
      return toast('فشل تغيير كلمة المرور: ' + err.message, 'error');
    }
  }
  
  // تحديث اسم العرض واسم المستخدم في Firestore
  const updates = {};
  if (newDisplayName !== editAccountState.originalDisplayName && newDisplayName) {
    updates.displayName = newDisplayName;
  }
  if (newUsername !== originalUsername && newUsername) {
    updates.username = newUsername;
  }
  
  if (Object.keys(updates).length > 0) {
    await setDoc(doc(db, "users", currentUserId), updates, { merge: true });
    toast('✅ تم تحديث معلومات الحساب');
    // تحديث حالة المستخدم الحالية
    if (state.currentUser) {
      state.currentUser.displayName = newDisplayName || state.currentUser.displayName;
    }
    renderAuthArea();
  }
  
  $('editAccountModal')?.classList.add('modal-hidden');
  renderAuthArea();
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
    </tr>`;
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
        <!-- تم إزالة زر تسجيل الخروج من هنا -->
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

// ===================== منع Pull-to-Refresh نهائياً مع الحفاظ على التمرير =====================
function preventPullToRefresh() {
  let touchStartY = 0;
  document.body.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: false });
  
  document.body.addEventListener('touchmove', (e) => {
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
    if (scrollTop === 0 && e.touches[0].clientY > touchStartY) {
      e.preventDefault();
    }
  }, { passive: false });
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
    deleteAccountPermanently();
  });
  $('focusModeBtn')?.addEventListener('click', toggleFocusMode);
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
      ['sectionModal','editModal','confirmModal','exportModal','logoutConfirmModal','settingsModal','editAccountModal'].forEach(id => $(id)?.classList.add('modal-hidden'));
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

// ===================== مراقبة حالة المصادقة =====================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUserId = user.uid;
    const userDoc = await getDoc(doc(db, "users", currentUserId));
    const userData = userDoc.data() || {};
    const displayName = userData.displayName || user.email;
    state.currentUser = { email: user.email, displayName, username: userData.username };
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
    await loadFromCloud(currentUserId);
  } else {
    currentUserId = null;
    state.currentUser = null;
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    state.sections = [];
    state.activeId = null;
    renderSidebar();
    renderMain();
    renderAuthArea();
    if (!$('authGate')?.classList.contains('modal-hidden')) {
      openAuthGate('choose');
    }
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
  preventPullToRefresh(); // منع السحب للتحديث
  setTimeout(() => {
    $('splash')?.classList.add('done');
    $('app')?.classList.remove('app-hidden');
  }, 1000);
}

window.openEditModal = openEditModal;
window.deleteRecord = deleteRecord;
window.togglePin = togglePin;
window.openSectionModal = openSectionModal;
window.signOutApp = signOutApp;

init();