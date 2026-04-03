/* ════════════════════════════════════════
   حسّاب — app.js
   Full application logic
════════════════════════════════════════ */

'use strict';

// ── CONSTANTS ──────────────────────────────────────────────
const COLORS  = ['#f5c842','#f5904a','#f76e6e','#3ddba8','#5b9cf6','#b07ef8','#f472b6','#3dd6f5','#a3e635','#fb923c'];
const ICONS   = ['🛒','💼','🏠','✈️','🍔','💊','📚','⛽','🎮','💡','🎁','💰','🏋️','🧾','🔧','📱','🎓','🌿','🎵','🚗'];
const STORAGE_KEY = 'hassab_v2';

// ── STATE ──────────────────────────────────────────────────
let state = {
  sections:      [],   // [{id, name, color, icon, unit, records:[…]}]
  activeId:      null,
  theme:         'dark',
  sidebarOpen:   true,
  searchQuery:   '',
  selectedOp:    '+',
  editingRecord: null,  // {sectionId, recordId}
  editingSection: null, // id | null = new
  pendingDelete: null,  // {type:'section'|'record'|'all', id, sectionId}
};

// ── PERSISTENCE ────────────────────────────────────────────
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ sections: state.sections, theme: state.theme })); }
  catch(e) { console.warn('save failed', e); }
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.sections) state.sections = d.sections;
    if (d.theme)    state.theme    = d.theme;
  } catch(e) { console.warn('load failed', e); }
}

// ── HELPERS ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const fmt  = n  => {
  if (isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n/1_000_000).toFixed(2).replace(/\.?0+$/,'') + 'M';
  if (abs >= 10_000)    return (n/1_000).toFixed(1).replace(/\.?0+$/,'') + 'K';
  return (+n.toFixed(4)).toLocaleString('ar-SA');
};
const fmtDate = ts => {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')} — ${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
};
function opClass(op) {
  return { '+':'op-plus-bg', '-':'op-minus-bg', '×':'op-times-bg', '÷':'op-divide-bg' }[op] || '';
}
function opPillClass(op) {
  return { '+':'plus', '-':'minus', '×':'times', '÷':'divide' }[op] || '';
}

function calcRunning(records, upToIndex) {
  if (!records.length) return 0;
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

function buildEquation(records, unit='') {
  if (!records.length) return '—';
  const u = unit ? ` ${unit}` : '';
  return records.map((r, i) => {
    const lbl = r.label ? `(${r.label})` : '';
    if (i === 0) return `${r.num}${u} ${lbl}`.trim();
    return `${r.op} ${r.num}${u} ${lbl}`.trim();
  }).join(' ');
}

function sectionById(id) { return state.sections.find(s => s.id === id); }

// ── TOAST ──────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── MODAL HELPERS ──────────────────────────────────────────
function openModal(id)  { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.overlay').forEach(ov => {
  ov.addEventListener('click', e => {
    if (e.target === ov) closeModal(ov.id);
  });
});

// ── THEME ──────────────────────────────────────────────────
function applyTheme() {
  document.body.classList.toggle('light', state.theme === 'light');
  const icon = $('themeIcon');
  if (state.theme === 'light') {
    icon.innerHTML = `<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  } else {
    icon.innerHTML = `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
  }
}
$('themeToggleBtn').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(); save();
  toast(state.theme === 'light' ? '☀️ المظهر الفاتح' : '🌙 المظهر الداكن');
});

// ── SIDEBAR TOGGLE ─────────────────────────────────────────
$('sidebarToggle').addEventListener('click', () => {
  state.sidebarOpen = !state.sidebarOpen;
  $('sidebar').classList.toggle('collapsed', !state.sidebarOpen);
  $('sidebarToggle').classList.toggle('active', !state.sidebarOpen);
});

// ── SEARCH ─────────────────────────────────────────────────
$('searchToggleBtn').addEventListener('click', () => {
  const bar = $('searchBar');
  bar.classList.toggle('open');
  if (bar.classList.contains('open')) $('searchInput').focus();
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

// ── SECTION MODAL ──────────────────────────────────────────
let modalSelectedColor = COLORS[0];
let modalSelectedIcon  = ICONS[0];

function buildColorGrid() {
  const grid = $('colorGrid');
  grid.innerHTML = '';
  COLORS.forEach(c => {
    const d = document.createElement('div');
    d.className = 'color-dot' + (c === modalSelectedColor ? ' selected' : '');
    d.style.background = c;
    d.onclick = () => {
      modalSelectedColor = c;
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
    d.className = 'icon-option' + (ic === modalSelectedIcon ? ' selected' : '');
    d.textContent = ic;
    d.onclick = () => {
      modalSelectedIcon = ic;
      grid.querySelectorAll('.icon-option').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
    };
    grid.appendChild(d);
  });
}

function openSectionModal(sectionId = null) {
  state.editingSection = sectionId;
  const sec = sectionId ? sectionById(sectionId) : null;
  $('sectionModalTitle').textContent = sec ? 'تعديل القسم' : 'قسم جديد';
  $('sectionNameInput').value  = sec ? sec.name  : '';
  $('sectionUnitInput').value  = sec ? (sec.unit || '') : '';
  modalSelectedColor = sec ? sec.color : COLORS[Math.floor(Math.random() * COLORS.length)];
  modalSelectedIcon  = sec ? sec.icon  : ICONS[0];
  buildColorGrid();
  buildIconGrid();
  openModal('sectionModal');
  setTimeout(() => $('sectionNameInput').focus(), 100);
}

$('newSectionBtn').addEventListener('click', () => openSectionModal());

$('saveSectionBtn').addEventListener('click', () => {
  const name = $('sectionNameInput').value.trim();
  if (!name) { $('sectionNameInput').focus(); return; }
  const unit = $('sectionUnitInput').value.trim();

  if (state.editingSection) {
    const sec = sectionById(state.editingSection);
    if (sec) { sec.name = name; sec.color = modalSelectedColor; sec.icon = modalSelectedIcon; sec.unit = unit; }
    toast('✅ تم تعديل القسم');
  } else {
    const sec = { id: uid(), name, color: modalSelectedColor, icon: modalSelectedIcon, unit, records: [] };
    state.sections.push(sec);
    state.activeId = sec.id;
    toast('✅ تم إنشاء القسم');
  }
  closeModal('sectionModal');
  save();
  renderSidebar();
  renderMain();
});

$('sectionNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('saveSectionBtn').click(); });

// ── SECTION DELETE ─────────────────────────────────────────
function confirmDeleteSection(id) {
  const sec = sectionById(id);
  if (!sec) return;
  state.pendingDelete = { type: 'section', id };
  $('confirmTitle').textContent = 'حذف القسم';
  $('confirmText').textContent  = `هل تريد حذف قسم "${sec.name}" وجميع عملياته (${sec.records.length} عملية)؟ لا يمكن التراجع.`;
  openModal('confirmModal');
}

// ── RECORD ─────────────────────────────────────────────────
function addRecord() {
  const sec = sectionById(state.activeId);
  if (!sec) return;
  const numStr = $('recNum').value;
  const num = parseFloat(numStr);
  if (isNaN(num) || numStr === '') { $('recNum').focus(); shake($('recNum')); return; }
  const label = $('recLabel').value.trim();
  const note  = $('recNote').value.trim();
  const rec = { id: uid(), op: state.selectedOp, num, label, note, ts: Date.now(), pinned: false };
  sec.records.push(rec);
  $('recNum').value   = '';
  $('recLabel').value = '';
  $('recNote').value  = '';
  $('recNum').focus();
  save();
  renderSidebar();
  renderTotalCard(sec);
  renderRecords(sec);
  toast(`${state.selectedOp} ${fmt(num)} ${label ? `(${label})` : ''} تمت الإضافة ✓`);
}

function shake(el) {
  el.style.animation = 'none';
  el.style.borderColor = 'var(--red)';
  el.style.boxShadow = '0 0 0 3px var(--red-dim)';
  setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 800);
}

function deleteRecord(secId, recId) {
  state.pendingDelete = { type: 'record', id: recId, sectionId: secId };
  const sec = sectionById(secId);
  const rec = sec?.records.find(r => r.id === recId);
  $('confirmTitle').textContent = 'حذف العملية';
  $('confirmText').textContent  = `هل تريد حذف "${rec?.label || fmt(rec?.num) || 'هذه العملية'}"؟`;
  openModal('confirmModal');
}

function togglePin(secId, recId) {
  const sec = sectionById(secId);
  const rec = sec?.records.find(r => r.id === recId);
  if (!rec) return;
  rec.pinned = !rec.pinned;
  save();
  renderRecords(sec);
  toast(rec.pinned ? '📌 تم تثبيت العملية' : '📌 تم إلغاء التثبيت');
}

function openEditModal(secId, recId) {
  const sec = sectionById(secId);
  const rec = sec?.records.find(r => r.id === recId);
  if (!rec) return;
  state.editingRecord = { sectionId: secId, recordId: recId };
  $('editOp').value    = rec.op;
  $('editNum').value   = rec.num;
  $('editLabel').value = rec.label || '';
  $('editNote').value  = rec.note || '';
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
  if (isNaN(num)) { $('editNum').focus(); return; }
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

function confirmClearAll(secId) {
  state.pendingDelete = { type: 'all', sectionId: secId };
  const sec = sectionById(secId);
  $('confirmTitle').textContent = 'حذف جميع العمليات';
  $('confirmText').textContent  = `هل تريد حذف جميع العمليات في "${sec?.name}"؟ (${sec?.records.length} عملية)`;
  openModal('confirmModal');
}

$('confirmOkBtn').addEventListener('click', () => {
  const p = state.pendingDelete;
  if (!p) return;
  if (p.type === 'section') {
    state.sections = state.sections.filter(s => s.id !== p.id);
    if (state.activeId === p.id) state.activeId = state.sections[0]?.id || null;
    toast('🗑 تم حذف القسم');
  } else if (p.type === 'record') {
    const sec = sectionById(p.sectionId);
    if (sec) {
      const card = document.querySelector(`[data-rec-id="${p.id}"]`);
      if (card) { card.classList.add('removing'); setTimeout(() => doDeleteRecord(sec, p.id), 200); }
      else doDeleteRecord(sec, p.id);
    }
  } else if (p.type === 'all') {
    const sec = sectionById(p.sectionId);
    if (sec) { sec.records = []; toast('🗑 تم مسح جميع العمليات'); }
  }
  state.pendingDelete = null;
  closeModal('confirmModal');
  save();
  renderSidebar();
  renderMain();
});

function doDeleteRecord(sec, id) {
  sec.records = sec.records.filter(r => r.id !== id);
  save();
  renderSidebar();
  renderTotalCard(sec);
  renderRecords(sec);
  toast('🗑 تم حذف العملية');
}

// ── EXPORT ─────────────────────────────────────────────────
$('exportBtn').addEventListener('click', () => {
  const sec = sectionById(state.activeId);
  const opts = $('exportOptions');
  opts.innerHTML = '';

  const options = [
    { icon: '📄', title: 'نص عادي (.txt)', desc: 'ملف نصي بسيط بجميع العمليات', fn: () => exportTxt(sec) },
    { icon: '📊', title: 'CSV للجدول', desc: 'مناسب لـ Excel أو Google Sheets', fn: () => exportCsv(sec) },
    { icon: '📋', title: 'نسخ للحافظة', desc: 'انسخ الملخص ولصقه في أي مكان', fn: () => copyToClipboard(sec) },
    { icon: '🖨️', title: 'طباعة / PDF', desc: 'اطبع القسم الحالي أو احفظه PDF', fn: () => printSection(sec) },
  ];

  options.forEach(o => {
    const div = document.createElement('div');
    div.className = 'export-opt';
    div.innerHTML = `<div class="e-icon">${o.icon}</div><div><h4>${o.title}</h4><p>${o.desc}</p></div>`;
    div.onclick = () => { o.fn(); closeModal('exportModal'); };
    opts.appendChild(div);
  });

  if (!sec) { toast('اختر قسماً أولاً', 'error'); return; }
  openModal('exportModal');
});

function exportTxt(sec) {
  if (!sec) return;
  const unit = sec.unit || '';
  let txt = `═══════════════════════════\nحسّاب — ${sec.name}\n═══════════════════════════\n\n`;
  sec.records.forEach((r, i) => {
    const running = calcRunning(sec.records, i);
    txt += `${i + 1}. ${i === 0 ? ' ' : r.op} ${r.num}${unit ? ' '+unit : ''}${r.label ? ' (' + r.label + ')' : ''}${r.note ? ' [' + r.note + ']' : ''}\n`;
    txt += `   ← المجموع حتى الآن: ${fmt(running)}${unit ? ' '+unit : ''}\n`;
  });
  txt += `\n═══════════════════════════\nالإجمالي: ${fmt(calcTotal(sec.records))}${unit ? ' '+unit : ''}\n`;
  downloadFile(`${sec.name}.txt`, txt, 'text/plain');
  toast('📄 تم تصدير الملف');
}

function exportCsv(sec) {
  if (!sec) return;
  let csv = 'الترتيب,العملية,الرقم,التسمية,الملاحظة,المجموع التراكمي,الوقت\n';
  sec.records.forEach((r, i) => {
    const running = calcRunning(sec.records, i);
    csv += `${i+1},${i===0?'بداية':r.op},${r.num},"${r.label||''}","${r.note||''}",${running},"${fmtDate(r.ts)}"\n`;
  });
  downloadFile(`${sec.name}.csv`, '\uFEFF'+csv, 'text/csv');
  toast('📊 تم تصدير CSV');
}

function copyToClipboard(sec) {
  if (!sec) return;
  const unit = sec.unit || '';
  let txt = `${sec.icon} ${sec.name}\n`;
  txt += `━━━━━━━━━━━━━━━━━━━━\n`;
  sec.records.forEach((r, i) => {
    txt += `${i === 0 ? ' ' : r.op} ${r.num}${unit ? ' '+unit : ''}${r.label ? ' (' + r.label + ')' : ''}\n`;
  });
  txt += `━━━━━━━━━━━━━━━━━━━━\n= ${fmt(calcTotal(sec.records))}${unit ? ' '+unit : ''}`;
  navigator.clipboard.writeText(txt).then(() => toast('📋 تم النسخ للحافظة')).catch(() => toast('فشل النسخ', 'error'));
}

function printSection(sec) {
  if (!sec) return;
  const unit = sec.unit || '';
  const rows = sec.records.map((r, i) => {
    const running = calcRunning(sec.records, i);
    return `<tr><td>${i+1}</td><td>${i===0?'—':r.op}</td><td><b>${r.num}${unit?' '+unit:''}</b></td><td>${r.label||''}</td><td>${r.note||''}</td><td>${fmt(running)}${unit?' '+unit:''}</td></tr>`;
  }).join('');
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>${sec.name}</title><style>
    body{font-family:sans-serif;padding:32px;direction:rtl}
    h1{font-size:22px;margin-bottom:4px}p{color:#666;font-size:13px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;font-size:14px}
    th,td{border:1px solid #ddd;padding:8px 12px;text-align:right}
    th{background:#f5f5f5;font-weight:600}tr:nth-child(even){background:#fafafa}
    .total{margin-top:16px;font-size:18px;font-weight:700}
  </style></head><body>
    <h1>${sec.icon} ${sec.name}</h1>
    <p>الوحدة: ${unit||'—'} | العمليات: ${sec.records.length}</p>
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

// ── RENDER: SIDEBAR ────────────────────────────────────────
function renderSidebar() {
  const list = $('sectionsList');
  list.innerHTML = '';

  if (!state.sections.length) {
    list.innerHTML = `<div style="padding:20px 14px;text-align:center;color:var(--text3);font-size:13px">لا توجد أقسام بعد<br>اضغط "جديد" للبدء</div>`;
  } else {
    state.sections.forEach(s => {
      const total = calcTotal(s.records);
      const div = document.createElement('div');
      div.className = 'section-item' + (s.id === state.activeId ? ' active' : '');
      div.style.setProperty('--item-color', s.color);
      div.innerHTML = `
        <div class="sec-icon">${s.icon}</div>
        <div class="sec-body">
          <div class="sec-name">${escHtml(s.name)}</div>
          <div class="sec-meta">${fmt(total)}${s.unit ? ' '+s.unit : ''} · ${s.records.length} عملية</div>
        </div>
        <div class="sec-actions">
          <button class="sec-act-btn edit" title="تعديل">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="sec-act-btn" title="حذف">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>`;
      div.querySelector('.sec-act-btn.edit').onclick = e => { e.stopPropagation(); openSectionModal(s.id); };
      div.querySelector('.sec-act-btn:not(.edit)').onclick = e => { e.stopPropagation(); confirmDeleteSection(s.id); };
      div.onclick = () => { state.activeId = s.id; renderSidebar(); renderMain(); };
      list.appendChild(div);
    });
  }

  // global stats
  const total = state.sections.reduce((a, s) => a + s.records.length, 0);
  $('globalStats').innerHTML = `
    <div class="g-stat"><span>إجمالي الأقسام</span><strong>${state.sections.length}</strong></div>
    <div class="g-stat"><span>إجمالي العمليات</span><strong>${total}</strong></div>`;
}

// ── RENDER: MAIN ───────────────────────────────────────────
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
    $('wcBtn').onclick = () => openSectionModal();
    return;
  }

  main.innerHTML = `
    <div class="section-view" style="--s-color:${sec.color}">
      <div class="top-panel">
        <div class="section-title-row">
          <div class="section-title-icon">${sec.icon}</div>
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
            <button class="btn-ghost-sm" id="sortBtn" title="ترتيب">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="9" y2="18"/></svg>
              فرز
            </button>
            <button class="btn-ghost-sm danger" id="clearAllBtn">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
              مسح الكل
            </button>
          </div>
        </div>
        <div id="recordsList"></div>
      </div>
    </div>`;

  // op pills
  buildOpPills();

  // events
  $('addRecBtn').onclick = addRecord;
  $('clearAllBtn').onclick = () => confirmClearAll(sec.id);
  $('recNum').addEventListener('keydown', e => { if (e.key === 'Enter') $('recLabel').focus(); });
  $('recLabel').addEventListener('keydown', e => { if (e.key === 'Enter') $('recNote').focus(); });
  $('recNote').addEventListener('keydown', e => { if (e.key === 'Enter') addRecord(); });

  let sortAsc = false;
  $('sortBtn').onclick = () => {
    sortAsc = !sortAsc;
    const sorted = [...sec.records].sort((a, b) => sortAsc ? a.num - b.num : b.num - a.num);
    renderRecordsList(sec, sorted);
    toast(sortAsc ? '↑ مرتب تصاعدياً' : '↓ مرتب تنازلياً');
  };

  renderTotalCard(sec);
  renderRecords(sec);
}

function buildOpPills() {
  const pills = $('opPills');
  if (!pills) return;
  pills.innerHTML = '';
  ['+', '-', '×', '÷'].forEach(op => {
    const b = document.createElement('button');
    b.className = `op-pill ${opPillClass(op)}` + (op === state.selectedOp ? ' active' : '');
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

  // stats
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
      <div class="total-left">
        <div class="total-label">المجموع الكلي</div>
        <div class="total-number">
          ${unit ? `<span class="total-unit">${escHtml(unit)}</span>` : ''}
          ${fmt(total)}
        </div>
        <div class="total-equation">${escHtml(eq)}</div>
      </div>
    </div>`;

  const stats = $('statsGrid');
  if (!stats) return;
  stats.innerHTML = `
    <div class="stat-chip green"><span class="s-label">إضافات</span><span class="s-val">+${fmt(addSum)}</span></div>
    <div class="stat-chip red"><span class="s-label">طرح</span><span class="s-val">−${fmt(subSum)}</span></div>
    <div class="stat-chip blue"><span class="s-label">عمليات</span><span class="s-val">${sec.records.length}</span></div>
    ${mulCnt || divCnt ? `<div class="stat-chip orange"><span class="s-label">ضرب/قسمة</span><span class="s-val">${mulCnt + divCnt}</span></div>` : ''}`;
}

function renderRecords(sec) {
  let records = sec.records;

  // search filter
  if (state.searchQuery) {
    records = records.filter(r =>
      r.label?.toLowerCase().includes(state.searchQuery) ||
      r.note?.toLowerCase().includes(state.searchQuery) ||
      String(r.num).includes(state.searchQuery)
    );
  }

  renderRecordsList(sec, records);
}

function renderRecordsList(sec, records) {
  const list = $('recordsList');
  const count = $('recCount');
  if (!list) return;

  if (count) {
    count.textContent = state.searchQuery
      ? `${records.length} نتيجة من ${sec.records.length} عملية`
      : `${sec.records.length} عملية محفوظة`;
  }

  if (!records.length) {
    list.innerHTML = `
      <div class="empty-records">
        <div class="e-icon">${state.searchQuery ? '🔍' : '📋'}</div>
        <p>${state.searchQuery ? `لا توجد نتائج للبحث عن "${state.searchQuery}"` : 'لا توجد عمليات بعد<br>أضف أول عملية من الحقول أعلاه'}</p>
      </div>`;
    return;
  }

  // pinned first
  const pinned   = records.filter(r => r.pinned);
  const unpinned = records.filter(r => !r.pinned);
  const sorted   = [...pinned, ...unpinned];

  list.innerHTML = sorted.map((r, i) => {
    // find true index for running calc
    const trueIdx = sec.records.findIndex(x => x.id === r.id);
    const running = calcRunning(sec.records, trueIdx);
    const lbl = state.searchQuery ? highlight(r.label || '', state.searchQuery) : escHtml(r.label || '');
    const isFirst = sec.records[0]?.id === r.id;

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
          <div class="rec-running">الإجمالي: <span>${fmt(running)}${sec.unit ? ' '+sec.unit : ''}</span></div>
        </div>
        <div class="rec-actions">
          <button class="rec-act" title="${r.pinned ? 'إلغاء التثبيت' : 'تثبيت'}" onclick="togglePin('${sec.id}','${r.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="${r.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          </button>
          <button class="rec-act edit" title="تعديل" onclick="openEditModal('${sec.id}','${r.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="rec-act del" title="حذف" onclick="deleteRecord('${sec.id}','${r.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/>
            </svg>
          </button>
        </div>
        <div class="rec-timestamp">${fmtDate(r.ts || Date.now())}</div>
      </div>`;
  }).join('');
}

function highlight(text, query) {
  if (!query || !text) return escHtml(text);
  const re = new RegExp(`(${escRegex(query)})`, 'gi');
  return escHtml(text).replace(re, '<mark class="highlight">$1</mark>');
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── KEYBOARD SHORTCUTS ─────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['sectionModal','editModal','confirmModal','exportModal'].forEach(closeModal);
    $('searchBar').classList.remove('open');
  }
  // Ctrl/Cmd + K = search
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    $('searchBar').classList.toggle('open');
    if ($('searchBar').classList.contains('open')) $('searchInput').focus();
  }
  // Ctrl/Cmd + N = new section
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    openSectionModal();
  }
});

// ── DEMO DATA ──────────────────────────────────────────────
function seedDemo() {
  const now = Date.now();
  const h = 3_600_000;
  state.sections = [
    {
      id: 'demo1', name: 'السوق الأسبوعي', color: '#f5c842',
      icon: '🛒', unit: 'ريال',
      records: [
        { id: 'r1', op: '+', num: 5,   label: 'خبز',    note: '',            ts: now - 5*h, pinned: false },
        { id: 'r2', op: '+', num: 16,  label: 'جبن',    note: 'ماركة ألمعية', ts: now - 4*h, pinned: true },
        { id: 'r3', op: '-', num: 5,   label: 'خصم موز', note: '',           ts: now - 3*h, pinned: false },
        { id: 'r4', op: '+', num: 12,  label: 'لحم',    note: '',            ts: now - 2*h, pinned: false },
        { id: 'r5', op: '+', num: 8,   label: 'بيض',    note: '12 حبة',      ts: now - 1*h, pinned: false },
        { id: 'r6', op: '-', num: 3,   label: 'كوبون',  note: '',            ts: now,       pinned: false },
      ]
    },
    {
      id: 'demo2', name: 'مصاريف العمل', color: '#5b9cf6',
      icon: '💼', unit: 'ريال',
      records: [
        { id: 'r7',  op: '+', num: 150, label: 'وقود',   note: '',          ts: now - 10*h, pinned: false },
        { id: 'r8',  op: '+', num: 80,  label: 'غداء',   note: 'مطعم الملز', ts: now - 9*h, pinned: false },
        { id: 'r9',  op: '-', num: 30,  label: 'استرداد', note: '',          ts: now - 8*h, pinned: false },
        { id: 'r10', op: '×', num: 2,   label: 'مضاعفة بدل سفر', note: '',  ts: now - 7*h, pinned: true },
      ]
    },
    {
      id: 'demo3', name: 'رحلة الإجازة', color: '#3ddba8',
      icon: '✈️', unit: 'دولار',
      records: [
        { id: 'r11', op: '+', num: 800, label: 'تذاكر الطيران', note: '',    ts: now - 20*h, pinned: true },
        { id: 'r12', op: '+', num: 400, label: 'الفندق',        note: '3 ليالي', ts: now - 19*h, pinned: false },
        { id: 'r13', op: '+', num: 200, label: 'المصاريف',      note: '',    ts: now - 18*h, pinned: false },
        { id: 'r14', op: '-', num: 150, label: 'رصيد قديم',     note: '',    ts: now - 17*h, pinned: false },
      ]
    }
  ];
  state.activeId = 'demo1';
}

// ── INIT ───────────────────────────────────────────────────
function init() {
  load();
  if (!state.sections.length) seedDemo();
  applyTheme();

  // sidebar state
  if (window.innerWidth < 700) state.sidebarOpen = false;
  $('sidebar').classList.toggle('collapsed', !state.sidebarOpen);

  renderSidebar();
  renderMain();

  // hide splash
  setTimeout(() => {
    $('splash').classList.add('hidden');
    $('app').classList.remove('hidden');
  }, 1500);
}

init();
