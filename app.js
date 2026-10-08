/* CBN FULL — static receipt billing app (no backend).
   Storage layers: localStorage (instant) → GitHub JSON file (cloud, optional) → WhatsApp log with restore link. */
(() => {
'use strict';

const LS_DATA = 'cbnfull.data.v1';
const LS_CFG  = 'cbnfull.cfg.v1';
const PUBLIC_JSON = 'data/cbn-data.json';

const DEFAULT_SETTINGS = { prefix: 'CBN', receiptStart: 1, memberStart: 1, defaultFee: 3500, waNumber: '919539637747', updatedAt: 0 };
const DEFAULT_CFG = { autoWa: true, ghOwner: '', ghRepo: '', ghBranch: 'main', ghPath: PUBLIC_JSON, ghToken: '' };

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------------- state ---------------- */
let db = loadJSON(LS_DATA, null) || emptyDb();
db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
let cfg = { ...DEFAULT_CFG, ...loadJSON(LS_CFG, {}) };
let editingId = null;          // id of record being edited (null = new)
let memberNoAuto = true;       // membership no. still the auto-suggested one
let receiptNoAuto = true;

function emptyDb() { return { app: 'CBN FULL', version: 1, settings: { ...DEFAULT_SETTINGS }, receipts: [], deleted: [] }; }
function loadJSON(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function saveLocal() { try { localStorage.setItem(LS_DATA, JSON.stringify(db)); } catch {} }
function saveCfg() { try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch {} }
const S = () => db.settings;

/* ---------------- helpers ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
const money = n => num(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyShort = n => Number.isInteger(num(n)) ? num(n).toLocaleString('en-IN') : money(n);
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function parseISO(s) { const [y, m, d] = String(s || todayISO()).split('-').map(Number); return { y, m, d }; }
function ordinal(d) { if (d % 100 >= 11 && d % 100 <= 13) return 'th'; return ['th','st','nd','rd'][d % 10] || 'th'; }
function longDate(s) { const { y, m, d } = parseISO(s); return `${String(d).padStart(2, '0')}<sup>${ordinal(d)}</sup> ${MONTHS[m - 1]} ${y}`; }
function shortDate(s) { const { y, m, d } = parseISO(s); return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`; }
function fyText(s) { const { y, m } = parseISO(s); const a = m >= 4 ? y : y - 1; return `For the year ${a} – ${a + 1}`; }
const seqOf = no => { const m = String(no || '').match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : 0; };
const total = r => (r.items || []).reduce((t, i) => t + num(i.amount), 0);
const fullName = r => [r.title, r.name].filter(Boolean).join(' ');

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = n => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
const three = n => { const h = Math.floor(n / 100), r = n % 100; return [h ? ONES[h] + ' Hundred' : '', r ? two(r) : ''].filter(Boolean).join(' '); };
function intWords(n) {
  if (n === 0) return 'Zero';
  const out = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const lk = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) out.push(intWords(cr) + ' Crore');
  if (lk) out.push(two(lk) + ' Lakh');
  if (th) out.push(two(th) + ' Thousand');
  if (n) out.push(three(n));
  return out.join(' ');
}
function amountWords(a) {
  a = Math.round(num(a) * 100) / 100;
  const r = Math.floor(a), p = Math.round((a - r) * 100);
  return `Rupees ${intWords(r)}${p ? ' and ' + two(p) + ' Paise' : ''} Only`;
}

/* ---------------- counters ---------------- */
function nextReceiptNo(dateISO) {
  const max = Math.max((+S().receiptStart || 1) - 1, ...db.receipts.map(r => seqOf(r.receiptNo)));
  return `${S().prefix}/${parseISO(dateISO).y}/${String(max + 1).padStart(5, '0')}`;
}
function nextMemberNo() {
  const max = Math.max((+S().memberStart || 1) - 1, ...db.receipts.map(r => parseInt(r.membershipNo, 10) || 0));
  return String(max + 1);
}
function members() { // latest record per membership no.
  const m = new Map();
  [...db.receipts].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach(r => m.set(String(r.membershipNo), r));
  return m;
}

/* ---------------- receipt template ---------------- */
const ICON_HAND = `<svg width="74" height="54" viewBox="0 0 74 54" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 14l12-6 10 4 8-3 10 1 6 3"/><path d="M72 14l-12-6-14 3-10 9a3 3 0 004 4l8-5 14 12"/><path d="M14 8l-8 22 6 4"/><path d="M60 8l8 22-6 6"/><path d="M12 34l5 4a3 3 0 004-4l-3-3"/><path d="M18 31l7 6a3 3 0 004-4l-6-6"/><path d="M24 27l8 8a3 3 0 004-4l-6-6"/><path d="M33 39l3 3a3 3 0 004-4l-2-2"/><path d="M62 36l-16 8"/></svg>`;
const ICON_NET = `<svg width="60" height="56" viewBox="0 0 60 56" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="30" cy="8" r="6"/><path d="M20 26a10 9 0 0120 0"/><circle cx="10" cy="38" r="5.5"/><path d="M1 54a9 8 0 0118 0"/><circle cx="50" cy="38" r="5.5"/><path d="M41 54a9 8 0 0118 0"/><path d="M30 29v8M30 37l-8 6M30 37l8 6"/><circle cx="30" cy="44" r="2"/></svg>`;
const ICON_GROW = `<svg width="46" height="56" viewBox="0 0 46 56" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="38" width="8" height="16" rx="1"/><rect x="14" y="30" width="8" height="24" rx="1"/><rect x="26" y="22" width="8" height="32" rx="1"/><rect x="38" y="14" width="7" height="40" rx="1"/><path d="M2 28l12-8 8 4 16-14"/><circle cx="40" cy="6" r="4.5" fill="#fff"/></svg>`;

function receiptHTML(r) {
  const items = (r.items && r.items.length) ? r.items : [{ particular: '', amount: 0, remarks: '' }];
  const t = total(r);
  const amtTxt = `${moneyShort(t)}/-`;
  const amtSize = Math.min(68, Math.round(68 * 8 / Math.max(8, amtTxt.length)));
  const dash = v => esc(v && String(v).trim() ? v : '-');
  const row = (k, v, cls = '') => `<tr><td>${k}</td><td class="c">:</td><td class="v ${cls}">${v}</td></tr>`;
  return `<div class="rc">
  <div class="rc-head">
    <svg class="rc-abs" width="1224" height="208" viewBox="0 0 1224 208">
      <polygon points="1122,0 1158,0 1224,72 1224,116" fill="#8cc63f"/>
      <polygon points="1158,0 1224,0 1224,72" fill="#17693a"/>
      <polygon points="1224,128 1224,166 1170,208 1132,208" fill="#8cc63f"/>
      <polygon points="1224,166 1224,208 1170,208" fill="#17693a"/>
    </svg>
    <div class="rc-logo">CBN</div><div class="rc-div"></div>
    <div class="rc-org">Chamber of<br>Business Network</div>
    <div class="rc-tag">CONNECT<i>·</i>COLLABORATE<i>·</i>CREATE OPPORTUNITIES<i>·</i>GROW TOGETHER</div>
    <div class="rc-vl"></div>
    <div class="rc-mng">Managed &amp; Operated by<b>Meridian Positive Commune LLP</b></div>
  </div>
  <div class="rc-band">
    <svg class="rc-abs" width="1224" height="110" viewBox="0 0 1224 110">
      <polygon points="0,0 772,0 714,110 0,110" fill="#17693a"/>
      <polygon points="772,0 790,0 732,110 714,110" fill="#8cc63f"/>
      <polygon points="796,0 1224,0 1224,110 738,110" fill="#e4f2e8"/>
    </svg>
    <div class="rc-ico">
      <svg width="74" height="72" viewBox="0 0 74 72" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
        <path d="M6 4h62v54l-7 6-7-6-7 6-7-6-7 6-7-6-7 6-6-6z"/>
        <path d="M20 46h34M24 53h26"/>
      </svg><span>₹</span>
    </div>
    <div class="rc-title">MEMBERSHIP FEE RECEIPT</div>
    <div class="rc-rno"><span>Receipt No. :</span><b>${esc(r.receiptNo)}</b></div>
  </div>
  <div class="rc-body">
    <table class="rc-det">
      ${row('Date', longDate(r.date))}
      ${row('Member Name', esc(fullName(r)))}
      ${row('Business Name', dash(r.business))}
      ${row('Membership No.', dash(r.membershipNo))}
      ${row('Membership Category', dash(r.category))}
      ${row('Council', dash(r.council), 'n')}
      ${row('Zone', dash(r.zone), 'n')}
      ${row('Region', dash(r.region))}
    </table>
    <div class="rc-card">
      <h4>Amount Received</h4>
      <div class="rc-amt" style="font-size:${amtSize}px"><i>₹</i>${esc(amtTxt)}</div>
      <div class="rc-hr"></div>
      <div class="rc-words">(${esc(amountWords(t))})</div>
      <div class="rc-cbar"></div>
    </div>
  </div>
  <div class="rc-tbl"><table>
    <colgroup><col style="width:466px"><col style="width:247px"><col></colgroup>
    <tr><th>Particulars</th><th>Amount (₹)</th><th>Remarks</th></tr>
    ${items.map(i => `<tr><td>${dash(i.particular)}</td><td>${money(i.amount)}</td><td>${dash(i.remarks)}</td></tr>`).join('')}
    <tr class="tot"><td>Total</td><td>${money(t)}</td><td>-</td></tr>
  </table></div>
  <div class="rc-pay">
    <div><span class="k">Payment Mode</span><span class="c">:</span><span>${dash(r.paymentMode)}</span></div>
    <div><span class="k">Transaction / Ref. No.</span><span class="c">:</span><span>${dash(r.refNo)}</span></div>
    <div class="rc-pdate"><span class="k">Date</span><span class="c">:</span><span>${shortDate(r.date)}</span></div>
  </div>
  <div class="rc-thx">Thank you for being a valued member of CBN.<b>Together, we create greater opportunities.</b></div>
  <div class="rc-foot">
    <svg class="rc-abs" width="750" height="103" viewBox="0 0 750 103">
      <polygon points="0,0 672,0 722,103 0,103" fill="#17693a"/>
      <polygon points="672,0 698,0 748,103 722,103" fill="#8cc63f"/>
    </svg>
    <div class="rc-fi" style="left:60px">${ICON_HAND}<span>Build<br>Relationships</span></div>
    <div class="rc-fsep" style="left:266px"></div>
    <div class="rc-fi" style="left:298px">${ICON_NET}<span>Share<br>Opportunities</span></div>
    <div class="rc-fsep" style="left:494px"></div>
    <div class="rc-fi" style="left:524px">${ICON_GROW}<span>Grow<br>Together</span></div>
    <div class="rc-sign">Authorised Signatory<br>For Meridian Positive Commune LLP</div>
  </div>
</div>`;
}

/* ---------------- PDF ---------------- */
async function renderCanvas(r) {
  if (!window.html2canvas || !window.jspdf) throw new Error('PDF library not loaded (check internet)');
  const host = $('#exportHost');
  host.innerHTML = receiptHTML(r);
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const el = host.firstElementChild;
  const canvas = await html2canvas(el, {
    scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
    windowWidth: 1300, scrollX: 0, scrollY: 0,
    onclone: doc => { const h = doc.getElementById('exportHost'); h.style.left = '0px'; }
  });
  host.innerHTML = '';
  return canvas;
}
async function makePdf(r) {
  const canvas = await renderCanvas(r);
  const w = 210, h = w * canvas.height / canvas.width;
  const pdf = new window.jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: [w, h], compress: true });
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, w, h);
  pdf.setProperties({ title: `CBN Receipt ${r.receiptNo}`, author: 'Meridian Positive Commune LLP' });
  return pdf.output('blob');
}
const pdfName = r => `CBN-Receipt-${String(r.receiptNo).replace(/[^\w]+/g, '-')}-${String(r.name || '').trim().replace(/[^\w]+/g, '-')}.pdf`;
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const pdfCache = new Map(); // id+updatedAt -> blob
async function getPdf(r) {
  const k = r.id + ':' + r.updatedAt;
  if (!pdfCache.has(k)) pdfCache.set(k, makePdf(r));
  try { return await pdfCache.get(k); } catch (e) { pdfCache.delete(k); throw e; }
}

/* ---------------- WhatsApp log ---------------- */
function b64urlEncode(str) { const b = new TextEncoder().encode(str); let s = ''; b.forEach(c => s += String.fromCharCode(c)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlDecode(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
const appUrl = () => location.origin + location.pathname;
function restoreLink(r) { return `${appUrl()}#r=${b64urlEncode(JSON.stringify(r))}`; }
function waText(r) {
  const lines = [
    `*CBN RECEIPT LOG*${r.createdAt !== r.updatedAt ? ' (edited)' : ''}`,
    `Receipt No: ${r.receiptNo}`,
    `Date: ${shortDate(r.date)}`,
    `Member: ${fullName(r)} (No. ${r.membershipNo})`,
    r.business ? `Business: ${r.business}` : null,
    r.category ? `Category: ${r.category}` : null,
    `Council/Zone/Region: ${[r.council, r.zone, r.region].map(v => v || '-').join(' / ')}`,
    ...(r.items || []).map(i => `• ${i.particular || '-'}: ₹${money(i.amount)}${i.remarks ? ' (' + i.remarks + ')' : ''}`),
    `*Total: ₹${money(total(r))}*`,
    `(${amountWords(total(r))})`,
    `Payment: ${r.paymentMode || '-'}${r.refNo ? ' / Ref ' + r.refNo : ''}`,
    ``,
    `Open / restore:`,
    restoreLink(r)
  ];
  return lines.filter(l => typeof l === 'string').join('\n');
}
function waUrl(r) { return `https://wa.me/${String(S().waNumber).replace(/\D/g, '')}?text=${encodeURIComponent(waText(r))}`; }
function openWa(r) { const w = window.open(waUrl(r), '_blank'); if (!w) location.href = waUrl(r); }

/* ---------------- merge & persistence ---------------- */
function mergeDb(a, b) {
  const deleted = [...new Set([...(a.deleted || []), ...(b.deleted || [])])];
  const del = new Set(deleted);
  const map = new Map();
  for (const r of [...(a.receipts || []), ...(b.receipts || [])]) {
    if (!r || !r.id || del.has(r.id)) continue;
    const ex = map.get(r.id);
    if (!ex || (r.updatedAt || 0) > (ex.updatedAt || 0)) map.set(r.id, r);
  }
  const sa = a.settings || {}, sb = b.settings || {};
  const settings = { ...DEFAULT_SETTINGS, ...((sb.updatedAt || 0) > (sa.updatedAt || 0) ? sb : sa) };
  const receipts = [...map.values()].sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
  return { app: 'CBN FULL', version: 1, settings, receipts, deleted };
}
const stable = d => JSON.stringify({ s: d.settings, r: d.receipts, x: [...(d.deleted || [])].sort() });

function upsert(r) {
  const i = db.receipts.findIndex(x => x.id === r.id);
  if (i >= 0) db.receipts[i] = r; else db.receipts.push(r);
  saveLocal(); refreshLists(); sync();
}
function removeRecord(id) {
  db.receipts = db.receipts.filter(r => r.id !== id);
  db.deleted = [...new Set([...(db.deleted || []), id])];
  saveLocal(); refreshLists(); sync();
}

/* ---------------- GitHub JSON sync ---------------- */
const ghReady = () => cfg.ghOwner && cfg.ghRepo && cfg.ghToken;
function ghUrl() { const p = String(cfg.ghPath || PUBLIC_JSON).split('/').map(encodeURIComponent).join('/'); return `https://api.github.com/repos/${encodeURIComponent(cfg.ghOwner)}/${encodeURIComponent(cfg.ghRepo)}/contents/${p}`; }
const ghHeaders = () => ({ Authorization: `Bearer ${cfg.ghToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
async function ghGet() {
  const res = await fetch(`${ghUrl()}?ref=${encodeURIComponent(cfg.ghBranch || 'main')}&t=${Date.now()}`, { headers: ghHeaders(), cache: 'no-store' });
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.json().catch(() => ({}))).message || ''}`);
  const j = await res.json();
  let content = j.content;
  if (!content && j.sha) { // >1 MB file: read the blob
    const b = await fetch(`https://api.github.com/repos/${encodeURIComponent(cfg.ghOwner)}/${encodeURIComponent(cfg.ghRepo)}/git/blobs/${j.sha}`, { headers: ghHeaders() });
    content = (await b.json()).content;
  }
  const txt = new TextDecoder().decode(Uint8Array.from(atob(String(content || '').replace(/\s/g, '')), c => c.charCodeAt(0)));
  return { data: txt.trim() ? JSON.parse(txt) : null, sha: j.sha };
}
async function ghPut(data, sha) {
  const bytes = new TextEncoder().encode(JSON.stringify(data, null, 1));
  let bin = ''; bytes.forEach(c => bin += String.fromCharCode(c));
  const body = { message: `CBN FULL: ${data.receipts.length} receipts`, content: btoa(bin), branch: cfg.ghBranch || 'main' };
  if (sha) body.sha = sha;
  const res = await fetch(ghUrl(), { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { const e = new Error(`GitHub ${res.status}: ${(await res.json().catch(() => ({}))).message || ''}`); e.status = res.status; throw e; }
}

let syncing = null, syncAgain = false;
function setPill(state, text) { const p = $('#syncPill'); p.className = 'pill ' + state; p.textContent = text; }
function sync() {
  if (syncing) { syncAgain = true; return syncing; }
  syncing = (async () => {
    try {
      if (ghReady()) {
        setPill('', '⟳ Syncing…');
        for (let attempt = 0; attempt < 3; attempt++) {
          const { data, sha } = await ghGet();
          const merged = mergeDb(db, data || emptyDb());
          db = merged; saveLocal();
          if (!data || stable(data) !== stable(merged)) {
            try { await ghPut(merged, sha); } catch (e) { if ((e.status === 409 || e.status === 422) && attempt < 2) continue; throw e; }
          }
          break;
        }
        setPill('ok', '✓ Cloud ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } else {
        // read-only: pick up data/cbn-data.json shipped with the site, if any
        try {
          const res = await fetch(`${PUBLIC_JSON}?t=${Date.now()}`, { cache: 'no-store' });
          if (res.ok) { db = mergeDb(db, await res.json()); saveLocal(); }
        } catch {}
        setPill('', '● Phone only');
      }
    } catch (e) {
      console.error(e); setPill('err', '⚠ Sync failed'); toast('Cloud sync failed — saved on this phone. ' + e.message);
    } finally {
      syncing = null; refreshLists();
      if (syncAgain) { syncAgain = false; sync(); }
    }
  })();
  return syncing;
}

/* ---------------- form ---------------- */
const F = () => $('#billForm');
function itemRow(i = {}) {
  const d = document.createElement('div');
  d.className = 'item';
  d.innerHTML = `<button type="button" class="del" title="Remove">×</button>
    <div class="grid2"><label>Particular<input data-i="particular" value="${esc(i.particular)}" placeholder="What is paid for"></label>
    <label>Amount (₹)<input data-i="amount" type="number" step="0.01" inputmode="decimal" value="${esc(i.amount)}" placeholder="0.00"></label></div>
    <label>Remarks<input data-i="remarks" value="${esc(i.remarks)}" placeholder="Remarks (optional)"></label>`;
  d.querySelector('.del').onclick = () => { if ($$('#items .item').length > 1) { d.remove(); onInput(); } };
  return d;
}
function readForm() {
  const f = F();
  const v = n => f.elements[n].value.trim();
  const base = editingId ? db.receipts.find(r => r.id === editingId) : null;
  return {
    id: base ? base.id : null,
    receiptNo: v('receiptNo'), date: v('date') || todayISO(), membershipNo: v('membershipNo'),
    title: f.elements.title.value, name: v('name'), business: v('business'), category: v('category'),
    council: v('council'), zone: v('zone'), region: v('region'),
    items: $$('#items .item').map(el => ({
      particular: $('[data-i=particular]', el).value.trim(),
      amount: num($('[data-i=amount]', el).value),
      remarks: $('[data-i=remarks]', el).value.trim()
    })),
    paymentMode: f.elements.paymentMode.value, refNo: v('refNo'),
    createdAt: base ? base.createdAt : 0, updatedAt: base ? base.updatedAt : 0
  };
}
function fillForm(r) {
  const f = F();
  ['receiptNo', 'date', 'membershipNo', 'name', 'business', 'category', 'council', 'zone', 'region', 'refNo'].forEach(k => f.elements[k].value = r[k] || '');
  f.elements.title.value = r.title ?? 'Mr.';
  f.elements.paymentMode.value = r.paymentMode || '-';
  const box = $('#items'); box.innerHTML = '';
  (r.items && r.items.length ? r.items : [{}]).forEach(i => box.appendChild(itemRow(i)));
  onInput();
}
function newForm() {
  editingId = null; memberNoAuto = true; receiptNoAuto = true;
  const last = db.receipts[db.receipts.length - 1] || {};
  const date = todayISO();
  fillForm({
    receiptNo: nextReceiptNo(date), date, membershipNo: nextMemberNo(), title: 'Mr.',
    council: last.council || 'Areekode', zone: last.zone || 'Malappuram Zone', region: last.region || 'Kerala Region',
    items: [{ particular: 'Annual Membership Fee', amount: S().defaultFee, remarks: fyText(date) }],
    paymentMode: '-'
  });
  $('#formHeading').textContent = 'New Receipt';
  $('#btnSave').textContent = 'Save & Generate PDF';
}
function editRecord(r) {
  editingId = r.id; memberNoAuto = false; receiptNoAuto = false;
  fillForm(r);
  $('#formHeading').textContent = 'Edit ' + r.receiptNo;
  $('#btnSave').textContent = 'Update & Generate PDF';
  showView('new'); window.scrollTo(0, 0);
}

function fitPreview() {
  const frame = $('#previewFrame'), p = $('#preview');
  const s = frame.clientWidth / 1224;
  p.style.transform = `scale(${s})`;
  frame.style.height = (p.firstElementChild ? p.firstElementChild.offsetHeight : 1285) * s + 'px';
}
function onInput() {
  const r = readForm();
  $('#formTotal').textContent = '₹ ' + money(total(r));
  $('#preview').innerHTML = receiptHTML(r);
  fitPreview();
}

function autofillMember(r) {
  const f = F();
  ['business', 'category', 'council', 'zone', 'region'].forEach(k => f.elements[k].value = r[k] || '');
  f.elements.title.value = r.title ?? 'Mr.';
}
function onFieldChange(e) {
  const f = F(), n = e.target.name;
  if (n === 'membershipNo') {
    memberNoAuto = false;
    const m = members().get(f.elements.membershipNo.value.trim());
    if (m && !editingId) { f.elements.name.value = m.name; autofillMember(m); }
  }
  if (n === 'name' && !editingId) {
    const nm = f.elements.name.value.trim().toLowerCase();
    const m = [...members().values()].reverse().find(x => (x.name || '').toLowerCase() === nm);
    if (m) { if (memberNoAuto) f.elements.membershipNo.value = m.membershipNo; autofillMember(m); }
  }
  if (n === 'receiptNo') receiptNoAuto = false;
  if (n === 'date') {
    if (receiptNoAuto && !editingId) f.elements.receiptNo.value = nextReceiptNo(f.elements.date.value);
    const first = $('#items [data-i=remarks]');
    if (first && /^For the year/.test(first.value)) first.value = fyText(f.elements.date.value);
  }
  onInput();
}

async function onSave(e) {
  e.preventDefault();
  const r = readForm();
  if (!r.name) return toast('Enter member name');
  if (!r.receiptNo) return toast('Enter receipt number');
  const dupe = db.receipts.find(x => x.receiptNo === r.receiptNo && x.id !== r.id);
  if (dupe && !confirm(`Receipt ${r.receiptNo} already exists (${fullName(dupe)}). Save anyway?`)) return;
  const now = Date.now();
  if (!r.id) { r.id = uid(); r.createdAt = now; }
  r.updatedAt = now;
  upsert(r);                                   // local save (instant) + cloud sync in background
  if (cfg.autoWa) openWa(r);                   // must run inside the tap, before any await
  getPdf(r).catch(() => {});                   // pre-render PDF while sheet opens
  showActions(r, editingId ? 'Receipt updated' : 'Receipt saved');
  newForm();
}

/* ---------------- action sheet ---------------- */
function showActions(r, title) {
  $('#sheetTitle').textContent = title || r.receiptNo;
  $('#sheetSub').textContent = `${r.receiptNo} · ${fullName(r)} · ₹${money(total(r))}`;
  const btns = $('#sheetBtns'); btns.innerHTML = '';
  const add = (label, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + cls; b.textContent = label; b.onclick = fn; btns.appendChild(b); return b; };
  const busy = async (b, fn) => { const t = b.textContent; b.disabled = true; b.textContent = 'Preparing PDF…'; try { await fn(); } catch (e) { toast(e.message); } finally { b.disabled = false; b.textContent = t; } };
  const dl = add('⬇ Download PDF', 'primary', () => busy(dl, async () => downloadBlob(await getPdf(r), pdfName(r))));
  const sh = add('↗ Share PDF (WhatsApp, etc.)', 'ghost', () => busy(sh, async () => {
    const file = new File([await getPdf(r)], pdfName(r), { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'CBN Receipt ' + r.receiptNo }); } catch (e) { if (e.name !== 'AbortError') throw e; }
    } else { downloadBlob(file, pdfName(r)); toast('Sharing files not supported here — downloaded instead'); }
  }));
  add('💬 Send WhatsApp log', 'wa', () => openWa(r));
  if (title === undefined) {
    add('✎ Edit', 'ghost', () => { closeSheet(); editRecord(r); });
    add('🗑 Delete', 'danger', () => { if (confirm(`Delete ${r.receiptNo}? This also removes it from the cloud JSON.`)) { removeRecord(r.id); closeSheet(); toast('Deleted'); } });
  }
  $('#sheet').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; }

/* ---------------- records ---------------- */
function refreshLists() {
  const q = ($('#search').value || '').toLowerCase();
  const list = [...db.receipts].reverse().filter(r => !q || [r.receiptNo, r.name, r.business, r.membershipNo, r.category, r.council].join(' ').toLowerCase().includes(q));
  $('#recSummary').textContent = `${list.length} receipt(s) · ₹${money(list.reduce((t, r) => t + total(r), 0))}`;
  const box = $('#recList'); box.innerHTML = '';
  if (!list.length) box.innerHTML = '<div class="card empty">No receipts yet.</div>';
  list.forEach(r => {
    const d = document.createElement('div');
    d.className = 'card rec';
    d.innerHTML = `<div class="l"><div class="n">${esc(fullName(r))}</div><div class="s">${esc(r.receiptNo)} · No. ${esc(r.membershipNo)} · ${shortDate(r.date)}</div><div class="s">${esc(r.business || '')}</div></div><div class="a">₹${money(total(r))}</div>`;
    d.onclick = () => showActions(r);
    box.appendChild(d);
  });
  // autocomplete lists
  const uniq = k => [...new Set(db.receipts.map(r => r[k]).filter(Boolean))];
  const fill = (id, vals) => { $(id).innerHTML = vals.map(v => `<option value="${esc(v)}">`).join(''); };
  fill('#dlNames', uniq('name')); fill('#dlBusiness', uniq('business')); fill('#dlCategory', uniq('category'));
  fill('#dlCouncil', uniq('council')); fill('#dlZone', uniq('zone')); fill('#dlRegion', uniq('region'));
  // keep suggested numbers fresh when other device data arrives
  if (!editingId) {
    const f = F();
    if (receiptNoAuto) f.elements.receiptNo.value = nextReceiptNo(f.elements.date.value);
    if (memberNoAuto) f.elements.membershipNo.value = nextMemberNo();
    onInput();
  }
  $('#nextInfo').textContent = `Next receipt: ${nextReceiptNo(todayISO())} · Next membership no.: ${nextMemberNo()}`;
}

/* ---------------- settings ---------------- */
function fillSettings() {
  const f = $('#setForm').elements;
  ['prefix', 'receiptStart', 'memberStart', 'defaultFee', 'waNumber'].forEach(k => f[k].value = S()[k]);
  ['ghOwner', 'ghRepo', 'ghBranch', 'ghPath', 'ghToken'].forEach(k => f[k].value = cfg[k] || '');
  f.autoWa.checked = !!cfg.autoWa;
}
function onSettings(e) {
  e.preventDefault();
  const f = $('#setForm').elements;
  db.settings = {
    prefix: f.prefix.value.trim() || 'CBN', receiptStart: Math.max(1, parseInt(f.receiptStart.value, 10) || 1),
    memberStart: Math.max(1, parseInt(f.memberStart.value, 10) || 1), defaultFee: num(f.defaultFee.value),
    waNumber: f.waNumber.value.replace(/\D/g, '') || DEFAULT_SETTINGS.waNumber, updatedAt: Date.now()
  };
  cfg = { autoWa: f.autoWa.checked, ghOwner: f.ghOwner.value.trim(), ghRepo: f.ghRepo.value.trim(), ghBranch: f.ghBranch.value.trim() || 'main', ghPath: f.ghPath.value.trim() || PUBLIC_JSON, ghToken: f.ghToken.value.trim() };
  saveLocal(); saveCfg(); toast('Settings saved');
  sync().then(() => { if (!editingId) newForm(); });
}

function importData(obj, label) {
  const before = db.receipts.length;
  db = mergeDb(db, obj); saveLocal(); refreshLists(); sync();
  toast(`${label}: ${db.receipts.length - before} new receipt(s) added`);
}
function recordsFromText(txt) {
  const out = [];
  for (const m of String(txt).matchAll(/#r=([A-Za-z0-9_-]+)/g)) { try { const r = JSON.parse(b64urlDecode(m[1])); if (r && r.id) out.push(r); } catch {} }
  return out;
}

/* ---------------- misc UI ---------------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }
function showView(v) {
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'new') fitPreview();
}

function handleHash() {
  const m = location.hash.match(/#r=([A-Za-z0-9_-]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const r = JSON.parse(b64urlDecode(m[1]));
    if (!r || !r.id) throw 0;
    if ((db.deleted || []).includes(r.id)) { toast('That receipt was deleted earlier'); return; }
    const ex = db.receipts.find(x => x.id === r.id);
    if (!ex || (r.updatedAt || 0) > (ex.updatedAt || 0)) upsert(r);
    showView('records'); showActions(db.receipts.find(x => x.id === r.id), 'Receipt loaded from link');
  } catch { toast('Invalid receipt link'); }
}

/* ---------------- wire up ---------------- */
function init() {
  const f = F();
  f.addEventListener('input', onInput);
  f.addEventListener('change', onFieldChange);
  f.addEventListener('submit', onSave);
  $('#btnReset').onclick = newForm;
  $('#btnAddItem').onclick = () => { $('#items').appendChild(itemRow({ particular: '', amount: '', remarks: '' })); onInput(); };
  $$('.tabbar button').forEach(b => b.onclick = () => showView(b.dataset.view));
  $('#search').oninput = refreshLists;
  $('#sheetClose').onclick = closeSheet;
  $('#sheet').onclick = e => { if (e.target.id === 'sheet') closeSheet(); };
  $('#syncPill').onclick = () => sync();
  $('#setForm').addEventListener('submit', onSettings);
  $('#btnExport').onclick = () => downloadBlob(new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' }), `cbn-data-${todayISO()}.json`);
  $('#importFile').onchange = async e => { const file = e.target.files[0]; if (!file) return; try { importData(JSON.parse(await file.text()), 'Imported'); } catch { toast('Not a valid JSON backup'); } e.target.value = ''; };
  $('#btnWaRestore').onclick = () => { const recs = recordsFromText($('#waPaste').value); if (!recs.length) return toast('No restore links found in the text'); importData({ receipts: recs, deleted: [], settings: {} }, 'Restored'); $('#waPaste').value = ''; };
  $('#btnClear').onclick = () => { if (confirm('Clear all receipts from THIS device? (Cloud JSON is not touched.)')) { db = emptyDb(); saveLocal(); newForm(); refreshLists(); toast('Cleared'); } };
  window.addEventListener('resize', fitPreview);
  window.addEventListener('hashchange', handleHash);

  fillSettings();
  newForm();
  refreshLists();
  handleHash();
  sync().then(() => fillSettings());
  if (document.fonts) document.fonts.ready.then(fitPreview);
}
init();
window.CBN = { receiptHTML, renderCanvas, makePdf };
})();
