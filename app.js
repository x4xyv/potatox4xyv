import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as firebaseSignOut, onAuthStateChanged, updatePassword, reauthenticateWithCredential, EmailAuthProvider, deleteUser } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, deleteDoc, query, collection, where, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const { auth, db } = window.__firebase;

// ===================== ثوابت =====================
const COLORS = ['#f5c842','#f5904a','#f76e6e','#3ddba8','#5b9cf6','#b07ef8','#f472b6','#3dd6f5','#a3e635','#fb923c'];
const ICONS  = ['🛒','💼','🏠','✈️','🍔','💊','📚','⛽','🎮','💡','🎁','💰','🏋️','🧾','🔧','📱','🎓','🌿','🎵','🚗'];
const STORAGE_THEME = 'hassab_theme_v5';

// ===================== الحالة =====================
let state = {
  theme: 'dark', sidebarOpen: true, sections: [], activeId: null,
  selectedOp: '+', pendingDelete: null, editingSection: null,
  editingRecord: null, searchQuery: '', sectionSearchQuery: '',
  recordSearchOpen: false, authGateMode: 'choose', authMenuOpen: false,
  sectionsSortBy: 'name-asc', recordsSortBy: 'date-desc',
  focusMode: false, _modalColor: null, _modalIcon: null, currentUser: null,
};

let currentUserId = null;
let unsubscribeSnapshot = null;
let isSyncing = false;
let usernameCheckTimeout = null;

// ===================== مساعدات =====================
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
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
  const h24 = d.getHours(), h12 = h24 % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ampm = h24 < 12 ? 'صباحًا' : 'مساءً';
  return `${h12}:${mm} ${ampm} — ${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
}
function opClass(op) { return {'+':'op-plus-bg','-':'op-minus-bg','×':'op-times-bg','÷':'op-divide-bg'}[op]||'op-plus-bg'; }
function opPillClass(op) { return {'+':'plus','-':'minus','×':'times','÷':'divide'}[op]||'plus'; }
function highlight(text, query) {
  if (!query || !text) return escHtml(text || '');
  return escHtml(text).replace(new RegExp(`(${escRegex(query)})`,'gi'),'<mark class="highlight">$1</mark>');
}
function round6(v) { return Math.round(v * 1e6) / 1e6; }
function calcRunning(records, upto) {
  if (!records.length || upto < 0) return 0;
  let total = Number(records[0].num) || 0;
  for (let i = 1; i <= upto; i++) {
    const r = records[i], num = Number(r.num) || 0;
    if (r.op==='+') total += num;
    else if (r.op==='-') total -= num;
    else if (r.op==='×') total *= num;
    else if (r.op==='÷') total = num !== 0 ? total / num : total;
  }
  return round6(total);
}
function calcTotal(records) { return records.length ? calcRunning(records, records.length - 1) : 0; }
function buildEquation(records, unit) {
  if (!records.length) return '—';
  const u = unit ? ` ${unit}` : '';
  return records.map((r,i) => {
    const lbl = r.label ? `(${r.label})` : '';
    return i===0 ? `${formatNumber(r.num)}${u} ${lbl}`.trim() : `${r.op} ${formatNumber(r.num)}${u} ${lbl}`.trim();
  }).join(' ');
}
function sectionById(id) { return state.sections.find(s => s.id === id); }
function toast(msg, type='') {
  const el = $('toast'); if (!el) return;
  el.textContent = msg; el.className = `toast show ${type}`;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
function setSyncStatus(syncing, text) {
  const dot = $('syncDot'), txt = $('syncText');
  if (dot) dot.classList.toggle('syncing', syncing);
  if (txt) txt.textContent = text || (syncing ? 'جارِ المزامنة...' : 'متزامن');
}
function shake(el) {
  if (!el) return;
  el.style.borderColor = 'var(--red)'; el.style.boxShadow = '0 0 0 3px var(--red-dim)';
  setTimeout(() => { el.style.borderColor=''; el.style.boxShadow=''; }, 700);
}

// ===================== كود القسم (نسخ/استيراد) =====================
function encodeSectionCode(sec) {
  try {
    const payload = {
      name: sec.name, unit: sec.unit||'', color: sec.color, icon: sec.icon,
      records: (sec.records||[]).map(r => ({
        op:r.op, num:r.num, label:r.label||'', note:r.note||'', ts:r.ts, pinned:r.pinned||false
      }))
    };
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  } catch { return null; }
}
function decodeSectionCode(code) {
  try {
    const json = decodeURIComponent(escape(atob(code.trim())));
    const p = JSON.parse(json);
    if (!p.name || !Array.isArray(p.records)) return null;
    return p;
  } catch { return null; }
}
function importSectionFromCode(code) {
  const payload = decodeSectionCode(code);
  if (!payload) { toast('الكود غير صحيح أو تالف ❌', 'error'); return false; }
  const newSec = {
    id: uid(), name: payload.name, unit: payload.unit||'',
    color: payload.color||COLORS[0], icon: payload.icon||ICONS[0], pinned: false,
    records: (payload.records||[]).map(r => ({
      id:uid(), op:r.op, num:r.num, label:r.label||'', note:r.note||'', ts:r.ts||Date.now(), pinned:r.pinned||false
    }))
  };
  state.sections.push(newSec);
  state.activeId = newSec.id;
  saveToCloud().then(() => { renderSidebar(); renderMain(); toast(`✅ تم استيراد قسم "${newSec.name}"`); });
  return true;
}
function showSectionCode(secId) {
  const sec = sectionById(secId); if (!sec) return;
  const code = encodeSectionCode(sec);
  if (!code) return toast('فشل توليد الكود', 'error');
  const nameEl = $('sectionCodeName'), textEl = $('sectionCodeText');
  if (nameEl) nameEl.textContent = sec.name;
  if (textEl) textEl.value = code;
  $('sectionCodeModal')?.classList.remove('modal-hidden');
}
function openSectionContextMenu(e, secId) {
  e.preventDefault(); e.stopPropagation();
  const sec = sectionById(secId); if (!sec) return;
  const menu = $('sectionContextMenu'); if (!menu) return;
  const pinBtn = $('sctxPin');
  if (pinBtn) pinBtn.innerHTML = sec.pinned ? '📌 إلغاء التثبيت' : '📌 تثبيت';
  menu.dataset.secId = secId;
  const vw = window.innerWidth, vh = window.innerHeight;
  const x = (e.clientX ?? (e.touches?.[0]?.clientX ?? vw/2));
  const y = (e.clientY ?? (e.touches?.[0]?.clientY ?? vh/2));
  menu.style.left = `${Math.min(x, vw-180)}px`;
  menu.style.top  = `${Math.min(y, vh-200)}px`;
  menu.classList.remove('modal-hidden');
  const close = () => { menu.classList.add('modal-hidden'); document.removeEventListener('click', onOut); };
  const onOut = ev => { if (!menu.contains(ev.target)) close(); };
  setTimeout(() => document.addEventListener('click', onOut), 10);
}

// ===================== Payload / Cloud =====================
function currentPayload() {
  return {
    sections: state.sections, activeId: state.activeId,
    selectedOp: state.selectedOp, theme: state.theme,
    sidebarOpen: state.sidebarOpen, sectionsSortBy: state.sectionsSortBy,
    recordsSortBy: state.recordsSortBy, focusMode: state.focusMode,
  };
}
function applyPayload(payload={}) {
  state.sections   = Array.isArray(payload.sections) ? payload.sections : [];
  state.activeId   = payload.activeId || state.sections[0]?.id || null;
  state.selectedOp = payload.selectedOp || '+';
  state.theme      = payload.theme || 'dark';
  state.sidebarOpen= payload.sidebarOpen !== undefined ? !!payload.sidebarOpen : true;
  state.sectionsSortBy = payload.sectionsSortBy || 'name-asc';
  state.recordsSortBy  = payload.recordsSortBy  || 'date-desc';
  state.focusMode  = payload.focusMode === true;
  applyTheme();
}
async function saveToCloud() {
  if (!currentUserId || isSyncing) return;
  isSyncing = true;
  try {
    setSyncStatus(true, 'جاري الحفظ...');
    await setDoc(doc(db,'users',currentUserId,'data','appData'), currentPayload());
    setSyncStatus(false, 'تم الحفظ ✓');
  } catch(err) {
    console.error(err); setSyncStatus(false,'خطأ');
    toast('فشل الحفظ — تحقق من الاتصال','error');
  } finally { isSyncing = false; }
}
async function loadFromCloud(userId) {
  // منع التنفيذ المتزامن — الدعامة الأساسية لمنع race conditions
  if (isSyncing) return;
  isSyncing = true;
  setSyncStatus(true,'جاري التحميل...');
  try {
    const snap = await getDoc(doc(db,'users',userId,'data','appData'));
    if (snap.exists()) {
      applyPayload(snap.data());
    } else {
      // حساب جديد: ابدأ بقائمة فارغة نظيفة
      applyPayload({ sections:[], activeId:null, selectedOp:'+',
        theme: state.theme||'dark', sidebarOpen:true,
        sectionsSortBy:'name-asc', recordsSortBy:'date-desc', focusMode:false });
    }
    renderSidebar(); renderMain();
    setSyncStatus(false,'متزامن');
  } catch(err) {
    console.error(err); setSyncStatus(false,'خطأ');
    toast('فشل تحميل البيانات — تحقق من الاتصال','error');
  } finally { isSyncing = false; }
}

// ===================== المصادقة =====================
function closeAuthGate() { $('authGate')?.classList.add('modal-hidden'); }
function openAuthGate(mode='choose') {
  state.authGateMode = mode; renderAuthGate();
  $('authGate')?.classList.remove('modal-hidden');
  closeRecordSearch(); closeAuthMenu();
}
function renderAuthGate() {
  const host=$('authGateBody'), title=$('authGateTitle');
  if (!host||!title) return;
  if (state.authGateMode==='register') {
    title.textContent='إنشاء حساب';
    host.innerHTML=`<div class="auth-card">
      <label class="field-label">اسم المستخدم <span style="color:var(--red)">(فريد)</span></label>
      <div style="position:relative">
        <input class="field-input" id="authRegUsername" maxlength="30" placeholder="مثال: john_doe" autocomplete="off"/>
        <span id="regUsernameStatus" class="username-status"></span>
      </div>
      <label class="field-label" style="margin-top:12px">البريد الإلكتروني</label>
      <div style="position:relative">
        <input class="field-input" id="authRegUser" type="email" placeholder="example@mail.com"/>
        <span id="regEmailStatus" class="username-status"></span>
      </div>
      <label class="field-label" style="margin-top:12px">اسم العرض</label>
      <input class="field-input" id="authRegDisplayName" maxlength="30" placeholder="الاسم الذي يظهر"/>
      <label class="field-label" style="margin-top:12px">كلمة المرور</label>
      <input class="field-input" id="authRegPass" type="password" placeholder="6+ أحرف"/>
      <label class="field-label" style="margin-top:12px">تأكيد كلمة المرور</label>
      <input class="field-input" id="authRegPass2" type="password" placeholder="أعد كتابة كلمة المرور"/>
      <div class="auth-rules">كلمة المرور: 6 أحرف على الأقل.</div>
      <div class="modal-actions auth-actions">
        <button class="btn-ghost" id="authBackBtn">رجوع</button>
        <button class="btn-primary" id="authCreateBtn">إنشاء الحساب</button>
      </div></div>`;
    $('authBackBtn').onclick = () => openAuthGate('choose');
    $('authCreateBtn').onclick = submitRegister;
    const uIn=$('authRegUsername'), eIn=$('authRegUser');
    uIn?.addEventListener('input',()=>checkUsernameAvailability(uIn.value,'regUsernameStatus'));
    eIn?.addEventListener('input',()=>checkEmailAvailability(eIn.value,'regEmailStatus'));
    ['authRegUser','authRegPass','authRegPass2','authRegDisplayName','authRegUsername'].forEach(id=>{
      $(id)?.addEventListener('keydown',e=>{ if(e.key==='Enter') submitRegister(); });
    });
    return;
  }
  if (state.authGateMode==='login') {
    title.textContent='تسجيل الدخول';
    host.innerHTML=`<div class="auth-card">
      <label class="field-label">البريد الإلكتروني أو اسم المستخدم</label>
      <input class="field-input" id="authLoginId" placeholder="example@mail.com أو اسم المستخدم" autocomplete="off"/>
      <label class="field-label" style="margin-top:12px">كلمة المرور</label>
      <input class="field-input" id="authLoginPass" type="password" placeholder="كلمة المرور"/>
      <div class="modal-actions auth-actions">
        <button class="btn-ghost" id="authBackBtn">رجوع</button>
        <button class="btn-primary" id="authLoginBtn">دخول</button>
      </div></div>`;
    $('authBackBtn').onclick = () => openAuthGate('choose');
    $('authLoginBtn').onclick = submitLogin;
    $('authLoginId')?.addEventListener('keydown',e=>{ if(e.key==='Enter') $('authLoginPass').focus(); });
    $('authLoginPass')?.addEventListener('keydown',e=>{ if(e.key==='Enter') submitLogin(); });
    return;
  }
  title.textContent='مرحبًا بك';
  host.innerHTML=`<div class="auth-card auth-chooser">
    <button class="auth-choice-btn primary" id="showRegisterBtn">إنشاء حساب جديد</button>
    <button class="auth-choice-btn" id="showLoginBtn">تسجيل الدخول لحساب موجود</button>
  </div>`;
  $('showRegisterBtn').onclick = () => openAuthGate('register');
  $('showLoginBtn').onclick    = () => openAuthGate('login');
}
async function checkUsernameAvailability(username, statusId) {
  const el=$(statusId);
  if (!username||username.length<3) { if(el) el.innerHTML=''; return false; }
  try {
    const snap = await getDocs(query(collection(db,'users'), where('username','==',username.toLowerCase())));
    const ok = snap.empty;
    if (el) { el.innerHTML = ok?'✓':'✗'; el.className = `username-status ${ok?'valid':'invalid'}`; }
    return ok;
  } catch { return false; }
}
async function checkEmailAvailability(email, statusId) {
  const el=$(statusId);
  if (!email||!email.includes('@')) { if(el) el.innerHTML=''; return false; }
  try {
    const snap = await getDocs(query(collection(db,'users'), where('email','==',email)));
    const ok = snap.empty;
    if (el) { el.innerHTML = ok?'✓':'✗'; el.className = `username-status ${ok?'valid':'invalid'}`; }
    return ok;
  } catch { return false; }
}

async function submitRegister() {
  const username    = $('authRegUsername')?.value.trim().toLowerCase();
  const email       = $('authRegUser')?.value.trim();
  const displayName = $('authRegDisplayName')?.value.trim();
  const password    = $('authRegPass')?.value;
  const confirm     = $('authRegPass2')?.value;
  if (!username)              return toast('أدخل اسم المستخدم','error');
  if (!email)                 return toast('أدخل البريد الإلكتروني','error');
  if (!displayName)           return toast('أدخل اسم العرض','error');
  if (!password)              return toast('أدخل كلمة المرور','error');
  if (password!==confirm)     return toast('كلمتا المرور غير متطابقتين','error');
  if (password.length<6)      return toast('كلمة المرور قصيرة جدًا (6+ أحرف)','error');
  if (!await checkUsernameAvailability(username,'regUsernameStatus')) return toast('اسم المستخدم موجود مسبقاً','error');
  if (!await checkEmailAvailability(email,'regEmailStatus'))          return toast('البريد الإلكتروني موجود مسبقاً','error');
  try {
    $('authCreateBtn').disabled = true;
    $('authCreateBtn').textContent = 'جارِ الإنشاء...';
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    const newUid = userCred.user.uid;
    // --- الحل الجذري: حفظ كلا المستندين بـ batch قبل أن يُفعَّل onAuthStateChanged ---
    const batch = writeBatch(db);
    batch.set(doc(db,'users',newUid), { username, displayName, email });
    batch.set(doc(db,'users',newUid,'data','appData'), {
      sections:[], activeId:null, selectedOp:'+', theme: state.theme||'dark',
      sidebarOpen:true, sectionsSortBy:'name-asc', recordsSortBy:'date-desc', focusMode:false
    });
    await batch.commit();
    // onAuthStateChanged سيتولى الباقي تلقائياً
    toast(`مرحبًا ${displayName} 🎉`);
  } catch(err) {
    console.error(err);
    let msg = err.message;
    if (msg.includes('email-already-in-use')) msg='البريد مستخدم بالفعل';
    toast(msg,'error');
    const btn=$('authCreateBtn');
    if (btn) { btn.disabled=false; btn.textContent='إنشاء الحساب'; }
  }
}

async function submitLogin() {
  const loginId  = $('authLoginId')?.value.trim().toLowerCase();
  const password = $('authLoginPass')?.value;
  if (!loginId||!password) return toast('أدخل البريد/اسم المستخدم وكلمة المرور','error');
  let email = loginId;
  if (!loginId.includes('@')) {
    const snap = await getDocs(query(collection(db,'users'), where('username','==',loginId)));
    if (snap.empty) return toast('اسم المستخدم غير موجود','error');
    email = snap.docs[0].data().email;
  }
  try {
    $('authLoginBtn').disabled=true; $('authLoginBtn').textContent='جارِ الدخول...';
    await signInWithEmailAndPassword(auth, email, password);
    // ✅ onAuthStateChanged يتولى كل شيء — لا نستدعي loadFromCloud هنا أبداً
  } catch(err) {
    console.error(err);
    toast('البريد/اسم المستخدم أو كلمة المرور غير صحيحة','error');
    const btn=$('authLoginBtn');
    if(btn){ btn.disabled=false; btn.textContent='دخول'; }
  }
}

function signOutApp() {
  firebaseSignOut(auth).then(()=>{
    // onAuthStateChanged (else branch) يُنظّف كل شيء تلقائياً
    toast('تم تسجيل الخروج');
  }).catch(err=>toast(err.message,'error'));
}

// ===================== حذف الحساب =====================
async function deleteAccountPermanently() {
  if (!currentUserId) return;
  const user = auth.currentUser; if (!user) return;
  try {
    setSyncStatus(true,'جاري حذف الحساب...');
    await deleteDoc(doc(db,'users',currentUserId,'data','appData'));
    await deleteDoc(doc(db,'users',currentUserId));
    await deleteUser(user);
    toast('تم حذف الحساب نهائياً');
  } catch(err) {
    console.error(err); toast('فشل حذف الحساب: '+err.message,'error');
    setSyncStatus(false,'خطأ');
  }
}

// ===================== ثيم =====================
function applyTheme() {
  document.body.classList.toggle('light', state.theme==='light');
  const icon=$('themeIcon'); if (!icon) return;
  if (state.theme==='light') {
    icon.innerHTML=`<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  } else {
    icon.innerHTML=`<circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
  }
}

// ===================== بحث / تمرير =====================
function closeRecordSearch() {
  state.recordSearchOpen=false; state.searchQuery='';
  $('searchBar')?.classList.remove('open');
  const inp=$('searchInput'); if(inp) inp.value='';
}
function openRecordSearch() {
  if (!sectionById(state.activeId)) return toast('اختر قسماً أولاً','error');
  state.recordSearchOpen=true; $('searchBar')?.classList.add('open'); $('searchInput')?.focus();
}

// ===================== عمليات =====================
function addRecord() {
  const sec=sectionById(state.activeId); if (!sec) return;
  const num=Number(String($('recNum').value||'').replace(/,/g,'').trim());
  if (!Number.isFinite(num)||num===0) return shake($('recNum'));
  const label=$('recLabel').value.trim(), note=$('recNote').value.trim();
  sec.records.push({ id:uid(), op:state.selectedOp, num, label, note, ts:Date.now(), pinned:false });
  $('recNum').value=''; $('recLabel').value=''; $('recNote').value=''; $('recNum').focus();
  saveToCloud().then(()=>{ renderSidebar(); renderMain(); toast(`${state.selectedOp} ${formatNumber(num)}${label?' ('+label+')':''} ✓`); });
}
function deleteRecord(secId,recId) {
  const sec=sectionById(secId); if (!sec) return;
  sec.records=sec.records.filter(r=>r.id!==recId);
  saveToCloud().then(()=>{ renderSidebar(); renderMain(); toast('🗑 تم حذف العملية'); });
}
function togglePin(secId,recId) {
  const sec=sectionById(secId), rec=sec?.records.find(r=>r.id===recId); if (!rec) return;
  rec.pinned=!rec.pinned;
  saveToCloud().then(()=>{ renderMain(); toast(rec.pinned?'📌 تم تثبيت العملية':'📌 تم إلغاء التثبيت'); });
}
function togglePinSection(secId) {
  const sec=sectionById(secId); if (!sec) return;
  sec.pinned=!sec.pinned;
  saveToCloud().then(()=>{ renderSidebar(); toast(sec.pinned?'📌 تم تثبيت القسم':'📌 تم إلغاء تثبيت القسم'); });
}
function openEditModal(secId,recId) {
  const sec=sectionById(secId), rec=sec?.records.find(r=>r.id===recId); if (!rec) return;
  state.editingRecord={sectionId:secId, recordId:recId};
  $('editOp').value=rec.op; $('editNum').value=rec.num;
  $('editLabel').value=rec.label||''; $('editNote').value=rec.note||'';
  $('editModal')?.classList.remove('modal-hidden');
  setTimeout(()=>$('editNum')?.focus(),100);
}
function saveEditModal() {
  if (!state.editingRecord) return;
  const sec=sectionById(state.editingRecord.sectionId);
  const rec=sec?.records.find(r=>r.id===state.editingRecord.recordId); if (!rec) return;
  const num=Number(String($('editNum').value||'').replace(/,/g,'').trim());
  if (!Number.isFinite(num)||num===0) return shake($('editNum'));
  rec.op=$('editOp').value; rec.num=num;
  rec.label=$('editLabel').value.trim(); rec.note=$('editNote').value.trim();
  $('editModal')?.classList.add('modal-hidden');
  saveToCloud().then(()=>{ renderSidebar(); renderMain(); toast('✅ تم حفظ التعديل'); });
}
function confirmClearAll(secId) {
  const sec=sectionById(secId); if (!sec) return;
  state.pendingDelete={type:'all',sectionId:secId};
  $('confirmTitle').textContent='مسح جميع العمليات';
  $('confirmText').textContent=`هل تريد مسح جميع العمليات في "${sec.name}"؟ (${sec.records.length} عملية)`;
  $('confirmModal')?.classList.remove('modal-hidden');
}
function applyDelete() {
  const p=state.pendingDelete; if (!p) return;
  if (p.type==='section') {
    state.sections=state.sections.filter(s=>s.id!==p.id);
    if (state.activeId===p.id) state.activeId=state.sections[0]?.id||null;
    toast('🗑 تم حذف القسم');
  } else if (p.type==='all') {
    const sec=sectionById(p.sectionId); if (sec) sec.records=[];
    toast('🗑 تم مسح جميع العمليات');
  }
  state.pendingDelete=null;
  $('confirmModal')?.classList.add('modal-hidden');
  saveToCloud().then(()=>{ renderSidebar(); renderMain(); });
}
function confirmDeleteSection(id) {
  const sec=sectionById(id); if (!sec) return;
  state.pendingDelete={type:'section',id};
  $('confirmTitle').textContent='حذف القسم';
  $('confirmText').textContent=`هل تريد حذف قسم "${sec.name}" وجميع عملياته (${sec.records.length} عملية)؟`;
  $('confirmModal')?.classList.remove('modal-hidden');
}

// ===================== فرز =====================
function sortRecords(records,sortBy) {
  if (!records.length) return records;
  const pinned=records.filter(r=>r.pinned), unpinned=records.filter(r=>!r.pinned);
  const fn=(a,b)=>{
    if(sortBy==='date-asc')   return a.ts-b.ts;
    if(sortBy==='date-desc')  return b.ts-a.ts;
    if(sortBy==='value-asc')  return a.num-b.num;
    if(sortBy==='value-desc') return b.num-a.num;
    return 0;
  };
  return [...pinned,...unpinned.sort(fn)];
}
function setRecordsSort(sortBy) { state.recordsSortBy=sortBy; saveToCloud(); renderMain(); }
function sortSections(sections,sortBy) {
  const s=[...sections];
  if(sortBy==='name-asc')   s.sort((a,b)=>a.name.localeCompare(b.name));
  else if(sortBy==='name-desc') s.sort((a,b)=>b.name.localeCompare(a.name));
  else if(sortBy==='count-desc') s.sort((a,b)=>(b.records?.length||0)-(a.records?.length||0));
  return s;
}
function toggleFocusMode() { state.focusMode=!state.focusMode; saveToCloud(); renderMain(); }

// ===================== أقسام =====================
function openSectionModal(sectionId) {
  closeRecordSearch(); state.editingSection=sectionId||null;
  const sec=sectionId?sectionById(sectionId):null;
  $('sectionModalTitle').textContent=sec?'تعديل القسم':'قسم جديد';
  $('sectionNameInput').value=sec?sec.name:'';
  $('sectionUnitInput').value=sec?(sec.unit||''):'';
  state._modalColor=sec?sec.color:COLORS[Math.floor(Math.random()*COLORS.length)];
  state._modalIcon=sec?sec.icon:ICONS[0];
  renderColorGrid(); renderIconGrid();
  $('sectionModal')?.classList.remove('modal-hidden');
  setTimeout(()=>$('sectionNameInput')?.focus(),100);
}
function renderColorGrid() {
  const grid=$('colorGrid'); if (!grid) return; grid.innerHTML='';
  COLORS.forEach(c=>{
    const d=document.createElement('div');
    d.className='color-dot'+(c===state._modalColor?' selected':''); d.style.background=c;
    d.onclick=()=>{ state._modalColor=c; grid.querySelectorAll('.color-dot').forEach(x=>x.classList.remove('selected')); d.classList.add('selected'); };
    grid.appendChild(d);
  });
}
function renderIconGrid() {
  const grid=$('iconGrid'); if (!grid) return; grid.innerHTML='';
  ICONS.forEach(ic=>{
    const d=document.createElement('div');
    d.className='icon-option'+(ic===state._modalIcon?' selected':''); d.textContent=ic;
    d.onclick=()=>{ state._modalIcon=ic; grid.querySelectorAll('.icon-option').forEach(x=>x.classList.remove('selected')); d.classList.add('selected'); };
    grid.appendChild(d);
  });
}
function saveSectionModal() {
  const name=$('sectionNameInput').value.trim(); if (!name) return $('sectionNameInput').focus();
  const unit=$('sectionUnitInput').value.trim();
  if (state.editingSection) {
    const sec=sectionById(state.editingSection);
    if (sec) { sec.name=name; sec.unit=unit; sec.color=state._modalColor; sec.icon=state._modalIcon; }
    toast('✅ تم تعديل القسم');
  } else {
    const sec={id:uid(),name,unit,color:state._modalColor,icon:state._modalIcon,pinned:false,records:[]};
    state.sections.push(sec); state.activeId=sec.id; toast('✅ تم إنشاء القسم');
  }
  $('sectionModal')?.classList.add('modal-hidden');
  saveToCloud().then(()=>{ renderSidebar(); renderMain(); });
}

// ===================== تعديل الحساب =====================
async function openEditAccountModal() {
  if (!currentUserId) return;
  const userDoc=await getDoc(doc(db,'users',currentUserId));
  const ud=userDoc.data()||{};
  $('currentPassword').value=''; $('editDisplayName').value=ud.displayName||'';
  $('editUsername').value=ud.username||''; $('editNewPassword').value=''; $('editConfirmPassword').value='';
  const st=$('usernameStatus'); if(st){st.innerHTML='';st.className='username-status';}
  $('editAccountModal')?.classList.remove('modal-hidden');
  const uIn=$('editUsername');
  if (!uIn?.getAttribute('data-listener')) {
    uIn?.addEventListener('input',()=>{
      const v=uIn.value.trim().toLowerCase();
      if(!v||v===ud.username){if(st)st.innerHTML='';return;}
      clearTimeout(usernameCheckTimeout);
      usernameCheckTimeout=setTimeout(()=>checkUsernameAvailability(v,'usernameStatus'),500);
    });
    uIn?.setAttribute('data-listener','true');
  }
}
async function saveAccountChanges() {
  if (!currentUserId) return;
  const currentPass=$('currentPassword').value; if (!currentPass) return toast('أدخل كلمة المرور الحالية','error');
  const newDisplayName=$('editDisplayName').value.trim();
  const newUsername=$('editUsername').value.trim().toLowerCase();
  const newPassword=$('editNewPassword').value;
  const confirmPassword=$('editConfirmPassword').value;
  const user=auth.currentUser; if (!user) return toast('يجب تسجيل الدخول أولاً','error');
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email,currentPass));
  } catch { return toast('كلمة المرور الحالية غير صحيحة','error'); }
  const updates={}; let usernameChanged=false;
  if (newDisplayName&&newDisplayName!==state.currentUser?.displayName) updates.displayName=newDisplayName;
  if (newUsername) {
    const ud=(await getDoc(doc(db,'users',currentUserId))).data();
    if (newUsername!==ud?.username) {
      const snap=await getDocs(query(collection(db,'users'),where('username','==',newUsername)));
      if (!snap.empty&&snap.docs[0].id!==currentUserId) return toast('اسم المستخدم موجود مسبقاً','error');
      updates.username=newUsername; usernameChanged=true;
    }
  }
  if (Object.keys(updates).length) { await setDoc(doc(db,'users',currentUserId),updates,{merge:true}); toast('✅ تم تحديث البيانات'); }
  let passwordChanged=false;
  if (newPassword) {
    if(newPassword!==confirmPassword) return toast('كلمتا المرور غير متطابقتين','error');
    if(newPassword.length<6) return toast('كلمة المرور قصيرة جدًا','error');
    await updatePassword(user,newPassword); passwordChanged=true;
    toast('✅ تم تغيير كلمة المرور');
  }
  $('editAccountModal')?.classList.add('modal-hidden');
  if (passwordChanged||usernameChanged) {
    await firebaseSignOut(auth); // onAuthStateChanged (else) يُنظّف
    toast(passwordChanged?'تم تسجيل الخروج بسبب تغيير كلمة المرور':'تم تسجيل الخروج بسبب تغيير اسم المستخدم');
  } else {
    const ud=(await getDoc(doc(db,'users',currentUserId))).data();
    state.currentUser={email:user.email, displayName:ud?.displayName||user.email};
    renderAuthArea();
  }
}

// ===================== تصدير =====================
function exportTxt(sec) {
  let txt=`حسّاب — ${sec.name}\n${'═'.repeat(28)}\n`;
  sec.records.forEach((r,i)=>{ txt+=`${i+1}. ${i===0?'بداية':r.op} ${formatNumber(r.num)}${sec.unit?' '+sec.unit:''}${r.label?' ('+r.label+')':''}${r.note?' ['+r.note+']':''}\n`; });
  txt+=`\nالإجمالي: ${formatNumber(calcTotal(sec.records))}${sec.unit?' '+sec.unit:''}`;
  downloadFile(`${sec.name}.txt`,txt,'text/plain');
}
function exportCsv(sec) {
  let csv='الترتيب,العملية,الرقم,التسمية,الملاحظة,المجموع التراكمي,الوقت\n';
  sec.records.forEach((r,i)=>{ csv+=`${i+1},${i===0?'بداية':r.op},${r.num},"${(r.label||'').replace(/"/g,'""')}","${(r.note||'').replace(/"/g,'""')}",${calcRunning(sec.records,i)},"${fmtDate(r.ts)}"\n`; });
  downloadFile(`${sec.name}.csv`,'\uFEFF'+csv,'text/csv');
}
function copyToClipboard(sec) {
  const text=`${sec.icon} ${sec.name}\n${'─'.repeat(24)}\n`+
    sec.records.map((r,i)=>`${i===0?' ':r.op} ${formatNumber(r.num)}${sec.unit?' '+sec.unit:''}${r.label?' ('+r.label+')':''}`).join('\n')+
    `\n${'─'.repeat(24)}\n= ${formatNumber(calcTotal(sec.records))}${sec.unit?' '+sec.unit:''}`;
  navigator.clipboard.writeText(text).then(()=>toast('📋 تم النسخ للحافظة')).catch(()=>toast('فشل النسخ','error'));
}
function printSection(sec) {
  const unit=sec.unit||'';
  const rows=sec.records.map((r,i)=>`<tr><td>${i+1}</td><td>${i===0?'—':r.op}</td><td><b>${formatNumber(r.num)}${unit?' '+unit:''}</b></td><td>${escHtml(r.label||'')}</td><td>${escHtml(r.note||'')}</td><td>${formatNumber(calcRunning(sec.records,i))}${unit?' '+unit:''}</td></tr>`).join('');
  const w=window.open('','_blank'); if (!w) return toast('تعذر فتح نافذة الطباعة','error');
  w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>${escHtml(sec.name)}</title><style>body{font-family:sans-serif;padding:32px;direction:rtl}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:right}</style></head><body><h1>${escHtml(sec.name)}</h1><p>الوحدة: ${escHtml(unit||'—')}</p><table><thead><tr><th>#</th><th>العملية</th><th>الرقم</th><th>التسمية</th><th>ملاحظة</th><th>تراكمي</th></tr></thead><tbody>${rows}</tbody></table><p><b>الإجمالي: ${formatNumber(calcTotal(sec.records))}${unit?' '+unit:''}</b></p></body></html>`);
  w.document.close(); w.print();
}
function downloadFile(filename,content,type) {
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type})); a.download=filename; a.click();
}

// ===================== واجهة المستخدم =====================
function closeAuthMenu() { state.authMenuOpen=false; $('authDropdown')?.classList.add('modal-hidden'); }
function openLogoutConfirm() { closeAuthMenu(); $('logoutConfirmModal')?.classList.remove('modal-hidden'); }
function closeLogoutConfirm() { $('logoutConfirmModal')?.classList.add('modal-hidden'); }
function openDeleteAccountConfirm() { $('deleteAccountConfirmModal')?.classList.remove('modal-hidden'); }

function renderAuthArea() {
  const area=$('authArea'); if (!area) return;
  if (!state.currentUser) {
    area.innerHTML=`<button class="auth-open-btn" id="openAuthBtn">الحساب</button>`;
    $('openAuthBtn').onclick=()=>openAuthGate('choose'); return;
  }
  const displayName=state.currentUser.displayName||state.currentUser.email||'مستخدم';
  const email=state.currentUser.email||'';
  area.innerHTML=`
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
  $('authUserBtn').onclick=e=>{ e.stopPropagation(); state.authMenuOpen=!state.authMenuOpen; $('authDropdown')?.classList.toggle('modal-hidden',!state.authMenuOpen); };
}
document.addEventListener('click',e=>{ if (!e.target.closest('#authArea')) closeAuthMenu(); });

function renderSidebar() {
  const list=$('sectionsList'); if (!list) return;
  const q=state.sectionSearchQuery.trim().toLowerCase();
  let secs=q?state.sections.filter(s=>(s.name||'').toLowerCase().includes(q)):state.sections;
  const pinned=secs.filter(s=>s.pinned);
  const unpinned=sortSections(secs.filter(s=>!s.pinned),state.sectionsSortBy);
  secs=[...pinned,...unpinned];
  list.innerHTML='';
  if (!secs.length) {
    list.innerHTML=`<div style="padding:24px 16px;text-align:center;color:var(--text3);font-size:13px;">لا توجد أقسام بعد<br>اضغط "جديد" للبدء</div>`;
  } else {
    secs.forEach(s=>{
      const total=calcTotal(s.records||[]);
      const div=document.createElement('div');
      div.className='section-item'+(s.id===state.activeId?' active':'')+(s.pinned?' sec-pinned':'');
      div.style.setProperty('--item-color',s.color);
      div.innerHTML=`
        ${s.pinned?'<span class="sec-pin-indicator">📌</span>':''}
        <div class="sec-icon" style="background:${s.color}22">${s.icon}</div>
        <div class="sec-body">
          <div class="sec-name">${escHtml(s.name)}</div>
          <div class="sec-meta">${formatNumber(total)}${s.unit?' '+escHtml(s.unit):''} · ${formatNumber((s.records||[]).length)} عملية</div>
        </div>`;
      // Long-press للهاتف
      let pressTimer;
      div.addEventListener('touchstart',e=>{ pressTimer=setTimeout(()=>openSectionContextMenu(e,s.id),500); },{passive:true});
      div.addEventListener('touchend',()=>clearTimeout(pressTimer));
      div.addEventListener('touchmove',()=>clearTimeout(pressTimer));
      // Right-click للحاسوب
      div.addEventListener('contextmenu',e=>openSectionContextMenu(e,s.id));
      div.onclick=()=>{ state.activeId=s.id; closeRecordSearch(); renderSidebar(); renderMain(); };
      list.appendChild(div);
    });
  }
  const totalOps=state.sections.reduce((a,s)=>a+(s.records||[]).length,0);
  $('globalStats').innerHTML=`
    <div class="g-stat"><span>الأقسام</span><strong>${formatNumber(state.sections.length)}</strong></div>
    <div class="g-stat"><span>إجمالي العمليات</span><strong>${formatNumber(totalOps)}</strong></div>`;
  $('sidebar')?.classList.toggle('collapsed',!state.sidebarOpen);
}

function buildOpPills() {
  const pills=$('opPills'); if (!pills) return; pills.innerHTML='';
  ['+','-','×','÷'].forEach(op=>{
    const b=document.createElement('button');
    b.className=`op-pill ${opPillClass(op)}${op===state.selectedOp?' active':''}`;
    b.textContent=op;
    b.onclick=()=>{ state.selectedOp=op; pills.querySelectorAll('.op-pill').forEach(p=>p.classList.remove('active')); b.classList.add('active'); };
    pills.appendChild(b);
  });
}

function renderTotalCard(sec) {
  const slot=$('totalCardSlot'); if (!slot) return;
  const total=calcTotal(sec.records||[]), unit=sec.unit||'', eq=buildEquation(sec.records||[],unit);
  let addSum=0,subSum=0,mulCnt=0,divCnt=0;
  (sec.records||[]).forEach((r,i)=>{
    if(i===0)return;
    if(r.op==='+')addSum+=Number(r.num)||0;
    if(r.op==='-')subSum+=Number(r.num)||0;
    if(r.op==='×')mulCnt++;
    if(r.op==='÷')divCnt++;
  });
  slot.innerHTML=`<div class="total-card" style="--s-color:${sec.color}">
    <div>
      <div class="total-label">المجموع الكلي</div>
      <div class="total-number">${formatNumber(total)}${unit?` <span class="total-unit">${escHtml(unit)}</span>`:''}</div>
      <div class="total-equation">${escHtml(eq)}</div>
    </div></div>`;
  const sg=$('statsGrid'); if (!sg) return;
  sg.innerHTML=`
    <div class="stat-chip green"><span class="s-label">إضافات</span><span class="s-val">${formatNumber(addSum)}</span></div>
    <div class="stat-chip red"><span class="s-label">طرح</span><span class="s-val">${formatNumber(subSum)}</span></div>
    <div class="stat-chip blue"><span class="s-label">عمليات</span><span class="s-val">${formatNumber((sec.records||[]).length)}</span></div>
    ${(mulCnt+divCnt)?`<div class="stat-chip orange"><span class="s-label">ضرب/قسمة</span><span class="s-val">${formatNumber(mulCnt+divCnt)}</span></div>`:''}`;
}

function renderRecords(sec) {
  let records=sec.records||[];
  const q=state.searchQuery.trim().toLowerCase();
  if (state.recordSearchOpen&&q) {
    records=records.filter(r=>(r.label||'').toLowerCase().includes(q)||(r.note||'').toLowerCase().includes(q)||String(r.num).includes(q));
  }
  records=sortRecords(records,state.recordsSortBy);
  const list=$('recordsList'), count=$('recCount'); if (!list) return;
  if (count) count.textContent=state.recordSearchOpen&&state.searchQuery?`${records.length} نتيجة من ${sec.records.length}`:`${sec.records.length} عملية`;
  if (!records.length) {
    list.innerHTML=`<div class="empty-records"><div class="e-icon">${state.recordSearchOpen&&state.searchQuery?'🔍':'📋'}</div><p>${state.recordSearchOpen&&state.searchQuery?`لا توجد نتائج لـ "${escHtml(state.searchQuery)}"`:' لا توجد عمليات بعد<br>أضف أول عملية من الحقول أعلاه'}</p></div>`;
    return;
  }
  list.innerHTML=records.map(r=>{
    const trueIdx=sec.records.findIndex(x=>x.id===r.id);
    const running=calcRunning(sec.records,trueIdx);
    const isFirst=trueIdx===0;
    const lbl=state.recordSearchOpen&&state.searchQuery?highlight(r.label||'',state.searchQuery):escHtml(r.label||'');
    return `<div class="record-card${r.pinned?' pinned':''}" data-rec-id="${r.id}" data-rec-index="${trueIdx}">
        ${r.pinned?'<div class="pin-dot"></div>':''}
        <div class="rec-index">${formatNumber(trueIdx+1)}</div>
        <div class="rec-op-badge ${opClass(isFirst?'+':r.op)}">${isFirst?'①':r.op}</div>
        <div class="rec-body">
          <div class="rec-main-line"><span class="rec-num">${formatNumber(r.num)}</span>${r.label?`<span class="rec-label-text">${lbl}</span>`:''}</div>
          ${r.note?`<div class="rec-note">📝 ${escHtml(r.note)}</div>`:''}
          <div class="rec-running">= <span>${formatNumber(running)}${sec.unit?' '+escHtml(sec.unit):''}</span></div>
          <div class="rec-timestamp">${fmtDate(r.ts)}</div>
        </div></div>`;
  }).join('');
  document.querySelectorAll('.record-card').forEach(card=>{
    let timer;
    card.addEventListener('touchstart',e=>{ timer=setTimeout(()=>showContextMenu(e.touches[0],card.dataset.recId),500); },{passive:true});
    card.addEventListener('touchend',()=>clearTimeout(timer));
    card.addEventListener('touchmove',()=>clearTimeout(timer));
    card.addEventListener('mousedown',e=>{ if(e.button!==0)return; timer=setTimeout(()=>showContextMenu(e,card.dataset.recId),500); });
    card.addEventListener('mouseup',()=>clearTimeout(timer));
    card.addEventListener('mouseleave',()=>clearTimeout(timer));
    card.addEventListener('contextmenu',e=>{ e.preventDefault(); showContextMenu(e,card.dataset.recId); });
  });
}

function showContextMenu(event,recId) {
  const sec=sectionById(state.activeId); if (!sec) return;
  const menu=$('recordContextMenu'); if (!menu) return;
  const rec=sec.records.find(r=>r.id===recId);
  const pinBtn=$('ctxPin'); if(pinBtn) pinBtn.textContent=rec?.pinned?'📌 إلغاء التثبيت':'📌 تثبيت';
  const vw=window.innerWidth, vh=window.innerHeight;
  menu.style.top=`${Math.min(event.clientY,vh-150)}px`;
  menu.style.left=`${Math.min(event.clientX,vw-160)}px`;
  menu.classList.remove('modal-hidden');
  const close=()=>menu.classList.add('modal-hidden');
  const onOut=e=>{ if(!menu.contains(e.target)){close();document.removeEventListener('click',onOut);} };
  setTimeout(()=>document.addEventListener('click',onOut),10);
  $('ctxEdit').onclick=()=>{ openEditModal(sec.id,recId); close(); };
  $('ctxPin').onclick=()=>{ togglePin(sec.id,recId); close(); };
  $('ctxDelete').onclick=()=>{ deleteRecord(sec.id,recId); close(); };
}

function initDragAndDrop(sectionId) {
  if ('ontouchstart' in window||navigator.maxTouchPoints>0) return;
  const cards=document.querySelectorAll('.record-card'); let dragSrc=null;
  cards.forEach(card=>{
    card.setAttribute('draggable','true');
    card.addEventListener('dragstart',e=>{ dragSrc=card; e.dataTransfer.effectAllowed='move'; card.classList.add('dragging'); });
    card.addEventListener('dragend',()=>{ card.classList.remove('dragging'); dragSrc=null; });
    card.addEventListener('dragover',e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; });
    card.addEventListener('dragenter',e=>{ if(dragSrc!==card) card.classList.add('drag-over'); });
    card.addEventListener('dragleave',()=>card.classList.remove('drag-over'));
    card.addEventListener('drop',e=>{
      e.preventDefault(); card.classList.remove('drag-over');
      if (!dragSrc||dragSrc===card) return;
      const sec=sectionById(sectionId); if (!sec) return;
      const si=sec.records.findIndex(r=>r.id===dragSrc.dataset.recId);
      const di=sec.records.findIndex(r=>r.id===card.dataset.recId);
      if (si===-1||di===-1) return;
      const [moved]=sec.records.splice(si,1); sec.records.splice(di,0,moved);
      saveToCloud().then(()=>renderMain()); toast('تم إعادة ترتيب العمليات');
    });
  });
}

function renderMain() {
  const main=$('mainContent'); if (!main) return;
  const sec=sectionById(state.activeId);
  if (!sec) {
    closeRecordSearch();
    main.innerHTML=`<div class="welcome">
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
    $('wcBtn').onclick=()=>openSectionModal(null); return;
  }
  main.innerHTML=`<div class="section-view ${state.focusMode?'focus-mode':''}" style="--s-color:${sec.color}">
    <div class="top-panel">
      <div class="section-title-row">
        <div class="section-title-icon" style="background:${sec.color}22">${sec.icon}</div>
        <h2>${escHtml(sec.name)}</h2>
        ${sec.unit?`<span class="section-unit-badge">${escHtml(sec.unit)}</span>`:''}
        <button class="exit-section-btn" id="exitSectionBtn" title="الخروج من القسم">✕</button>
      </div>
      <div id="totalCardSlot"></div>
      <div class="stats-grid" id="statsGrid" style="margin-top:10px"></div>
    </div>
    <div class="input-area">
      <div class="input-stack">
        <div class="input-row input-row-top">
          <div class="op-pills" id="opPills"></div>
          <input type="number" class="inp inp-num" id="recNum" placeholder="0" step="any"/>
        </div>
        <div class="input-row input-row-bottom">
          <input type="text" class="inp inp-label" id="recLabel" placeholder="التسمية (مثال: خبز، وقود...)" maxlength="40"/>
          <input type="text" class="inp inp-note"  id="recNote"  placeholder="ملاحظة (اختياري)" maxlength="80"/>
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
  $('addRecBtn').onclick=addRecord;
  $('clearAllBtn').onclick=()=>confirmClearAll(sec.id);
  $('exitSectionBtn').onclick=()=>{ state.activeId=null; renderMain(); renderSidebar(); };
  $('recNum').addEventListener('keydown',e=>{ if(e.key==='Enter') $('recLabel').focus(); });
  $('recLabel').addEventListener('keydown',e=>{ if(e.key==='Enter') $('recNote').focus(); });
  $('recNote').addEventListener('keydown',e=>{ if(e.key==='Enter') addRecord(); });
  const sortBtn=$('sortBtn');
  if (sortBtn) {
    sortBtn.onclick=e=>{
      e.stopPropagation();
      const menu=document.createElement('div');
      menu.className='context-menu'; menu.style.position='fixed';
      menu.style.top=`${e.clientY}px`; menu.style.left=`${e.clientX}px`;
      menu.innerHTML=`
        <div class="context-menu-item ${state.recordsSortBy==='date-desc'?'active':''}" data-sort="date-desc">📅 الأحدث أولاً</div>
        <div class="context-menu-item ${state.recordsSortBy==='date-asc'?'active':''}" data-sort="date-asc">📅 الأقدم أولاً</div>
        <div class="context-menu-item ${state.recordsSortBy==='value-desc'?'active':''}" data-sort="value-desc">🔽 الأكبر قيمة</div>
        <div class="context-menu-item ${state.recordsSortBy==='value-asc'?'active':''}" data-sort="value-asc">🔼 الأصغر قيمة</div>`;
      document.body.appendChild(menu);
      const close=()=>{ menu.remove(); document.removeEventListener('click',close); };
      setTimeout(()=>document.addEventListener('click',close),10);
      menu.querySelectorAll('[data-sort]').forEach(el=>el.addEventListener('click',ev=>{ ev.stopPropagation(); setRecordsSort(el.dataset.sort); close(); }));
    };
  }
  renderTotalCard(sec); renderRecords(sec); initDragAndDrop(sec.id);
}

// ===================== مستمعات الأحداث =====================
function initEventListeners() {
  $('themeToggleBtn')?.addEventListener('click',()=>{
    state.theme=state.theme==='dark'?'light':'dark'; applyTheme(); saveToCloud();
    toast(state.theme==='light'?'☀️ المظهر الفاتح':'🌙 المظهر الداكن');
  });
  $('sidebarToggle')?.addEventListener('click',()=>{
    state.sidebarOpen=!state.sidebarOpen; $('sidebar')?.classList.toggle('collapsed',!state.sidebarOpen); saveToCloud();
  });
  $('searchToggleBtn')?.addEventListener('click',()=>{
    if (!sectionById(state.activeId)) return toast('اختر قسماً أولاً','error');
    state.recordSearchOpen?closeRecordSearch():openRecordSearch(); renderMain();
  });
  $('searchInput')?.addEventListener('input',e=>{ state.searchQuery=e.target.value.trim().toLowerCase(); renderMain(); });
  $('clearSearch')?.addEventListener('click',()=>{ closeRecordSearch(); renderMain(); });
  $('sectionSearchInput')?.addEventListener('input',e=>{ state.sectionSearchQuery=e.target.value.trim().toLowerCase(); renderSidebar(); });
  $('newSectionBtn')?.addEventListener('click',()=>openSectionModal(null));
  // زر استيراد قسم
  $('importSectionBtn')?.addEventListener('click',()=>{
    $('importCodeInput').value=''; $('importSectionModal')?.classList.remove('modal-hidden');
    setTimeout(()=>$('importCodeInput')?.focus(),100);
  });
  $('confirmImportBtn')?.addEventListener('click',()=>{
    const code=$('importCodeInput')?.value.trim();
    if (!code) return toast('أدخل الكود أولاً','error');
    if (importSectionFromCode(code)) $('importSectionModal')?.classList.add('modal-hidden');
  });
  $('copySectionCodeBtn')?.addEventListener('click',()=>{
    const code=$('sectionCodeText')?.value; if (!code) return;
    navigator.clipboard.writeText(code).then(()=>toast('📋 تم نسخ الكود')).catch(()=>{ $('sectionCodeText').select(); document.execCommand('copy'); toast('📋 تم نسخ الكود'); });
  });
  // قائمة سياق الأقسام
  $('sctxPin')?.addEventListener('click',()=>{ const id=$('sectionContextMenu')?.dataset.secId; if(id) togglePinSection(id); $('sectionContextMenu')?.classList.add('modal-hidden'); });
  $('sctxEdit')?.addEventListener('click',()=>{ const id=$('sectionContextMenu')?.dataset.secId; if(id) openSectionModal(id); $('sectionContextMenu')?.classList.add('modal-hidden'); });
  $('sctxCode')?.addEventListener('click',()=>{ const id=$('sectionContextMenu')?.dataset.secId; if(id) showSectionCode(id); $('sectionContextMenu')?.classList.add('modal-hidden'); });
  $('sctxDelete')?.addEventListener('click',()=>{ const id=$('sectionContextMenu')?.dataset.secId; if(id) confirmDeleteSection(id); $('sectionContextMenu')?.classList.add('modal-hidden'); });
  $('saveSectionBtn')?.addEventListener('click',saveSectionModal);
  $('sectionNameInput')?.addEventListener('keydown',e=>{ if(e.key==='Enter') saveSectionModal(); });
  $('saveEditBtn')?.addEventListener('click',saveEditModal);
  $('confirmOkBtn')?.addEventListener('click',applyDelete);
  $('confirmLogoutBtn')?.addEventListener('click',()=>{ closeLogoutConfirm(); signOutApp(); });
  $('cancelLogoutBtn')?.addEventListener('click',closeLogoutConfirm);
  $('settingsBtn')?.addEventListener('click',()=>$('settingsModal')?.classList.remove('modal-hidden'));
  $('editAccountBtn')?.addEventListener('click',()=>{ $('settingsModal')?.classList.add('modal-hidden'); openEditAccountModal(); });
  $('logoutSettingsBtn')?.addEventListener('click',()=>{ $('settingsModal')?.classList.add('modal-hidden'); openLogoutConfirm(); });
  $('deleteAccountBtn')?.addEventListener('click',()=>{ $('settingsModal')?.classList.add('modal-hidden'); openDeleteAccountConfirm(); });
  $('confirmDeleteAccountBtn')?.addEventListener('click',async()=>{ $('deleteAccountConfirmModal')?.classList.add('modal-hidden'); await deleteAccountPermanently(); });
  $('focusModeBtn')?.addEventListener('click',toggleFocusMode);
  $('saveAccountChangesBtn')?.addEventListener('click',saveAccountChanges);
  $('cancelEditAccountBtn')?.addEventListener('click',()=>$('editAccountModal')?.classList.add('modal-hidden'));
  $('exportBtn')?.addEventListener('click',()=>{
    const sec=sectionById(state.activeId); if (!sec) return toast('اختر قسماً أولاً','error');
    const opts=$('exportOptions'); if (!opts) return; opts.innerHTML='';
    [{icon:'📄',title:'نص عادي (.txt)',desc:'ملف نصي بسيط',fn:()=>exportTxt(sec)},
     {icon:'📊',title:'CSV للجدول',desc:'مناسب لـ Excel',fn:()=>exportCsv(sec)},
     {icon:'📋',title:'نسخ للحافظة',desc:'انسخ الملخص',fn:()=>copyToClipboard(sec)},
     {icon:'🖨️',title:'طباعة / PDF',desc:'اطبع أو احفظ PDF',fn:()=>printSection(sec)},
    ].forEach(o=>{
      const d=document.createElement('div'); d.className='export-opt';
      d.innerHTML=`<div class="e-icon">${o.icon}</div><div><h4>${o.title}</h4><p>${o.desc}</p></div>`;
      d.onclick=()=>{ o.fn(); $('exportModal')?.classList.add('modal-hidden'); };
      opts.appendChild(d);
    });
    $('exportModal')?.classList.remove('modal-hidden');
  });
  document.addEventListener('keydown',e=>{
    if (e.key==='Escape') {
      ['sectionModal','editModal','confirmModal','exportModal','logoutConfirmModal','settingsModal',
       'editAccountModal','deleteAccountConfirmModal','importSectionModal','sectionCodeModal','sectionContextMenu'
      ].forEach(id=>$(id)?.classList.add('modal-hidden'));
      closeAuthMenu(); closeRecordSearch();
    }
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){ e.preventDefault(); if(sectionById(state.activeId)){state.recordSearchOpen?closeRecordSearch():openRecordSearch();} }
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='n'){ e.preventDefault(); openSectionModal(null); }
  });
  document.querySelectorAll('.overlay').forEach(ov=>ov.addEventListener('click',e=>{ if(e.target===ov) ov.classList.add('modal-hidden'); }));
  document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>$(btn.dataset.close)?.classList.add('modal-hidden')));
}

// ===================== مراقبة المصادقة — نقطة التحكم الوحيدة =====================
onAuthStateChanged(auth, async(user)=>{
  if (user) {
    currentUserId = user.uid;
    // إلغاء أي مستمع قديم فوراً
    if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot=null; }
    // جلب بيانات الملف الشخصي
    try {
      const userDoc=await getDoc(doc(db,'users',currentUserId));
      const displayName=userDoc.data()?.displayName||user.email;
      state.currentUser={email:user.email, displayName};
    } catch { state.currentUser={email:user.email, displayName:user.email}; }
    // ✅ تحميل البيانات (مع الحارس isSyncing يمنع أي تداخل)
    await loadFromCloud(currentUserId);
    closeAuthGate();
    renderAuthArea();
    toast(`مرحباً ${state.currentUser.displayName} ✓`);
    // ✅ تفعيل المستمع بعد اكتمال التحميل — التزامن الفوري مع الأجهزة الأخرى
    const docRef=doc(db,'users',currentUserId,'data','appData');
    unsubscribeSnapshot=onSnapshot(docRef,snap=>{
      if (!snap.exists()||isSyncing) return;
      const newData=snap.data();
      // مقارنة دقيقة للأقسام فقط لتجنب التحديثات غير الضرورية
      if (JSON.stringify(newData.sections)!==JSON.stringify(state.sections)) {
        applyPayload(newData); renderSidebar(); renderMain();
        setSyncStatus(false,'تم التحديث من جهاز آخر ✓');
      }
    });
  } else {
    // ✅ تنظيف كامل عند تسجيل الخروج
    currentUserId=null; state.currentUser=null;
    if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot=null; }
    state.sections=[]; state.activeId=null;
    renderSidebar(); renderMain(); renderAuthArea();
    openAuthGate('choose');
  }
});

// ===================== بدء التطبيق =====================
function init() {
  const th=localStorage.getItem(STORAGE_THEME); if (th) state.theme=th;
  if (window.innerWidth<700) state.sidebarOpen=false;
  applyTheme();
  $('sidebar')?.classList.toggle('collapsed',!state.sidebarOpen);
  initEventListeners();
  setTimeout(()=>{ $('splash')?.classList.add('done'); $('app')?.classList.remove('app-hidden'); },1200);
}

window.openEditModal=openEditModal;
window.deleteRecord=deleteRecord;
window.togglePin=togglePin;
window.openSectionModal=openSectionModal;
window.signOutApp=signOutApp;

init();
