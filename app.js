// City Services Guide — app logic
import { T, CATS } from './i18n.js';
import config from './config.js';
import { isConfigured, firebaseStore, demoStore, dayId, statKey, validEmail, normEmail } from './store.js';

/* ---------- translations ---------- */
const CAT = Object.fromEntries(CATS.map(c=>[c.id,c]));
const KINDS = ['Public service','Business','Shop'];
const FIELDS = ['kind','category','name','nameAr','description','descriptionAr','area','address','mapLink','phone','whatsapp','email','website','hours','fees','requirements','tags'];

let lang = 'en';
try{ const s=localStorage.getItem('csg-lang'); if(s==='ar'||s==='en') lang=s; else if((navigator.language||'').startsWith('ar')) lang='ar'; }catch(e){}
const t = (k,...a)=>{ const v=T[lang][k]; return typeof v==='function'?v(...a):(v??k); };
const catLabel = id=>(CAT[id]||CAT.other)[lang];
const catIcon = id=>(CAT[id]||CAT.other).icon;
const locale = ()=>lang==='ar'?'ar-AE':'en-GB';
const fmtDate = s=>s?new Date(s).toLocaleDateString(locale()):'';
const fmtDT = s=>s?new Date(s).toLocaleString(locale(),{dateStyle:'medium',timeStyle:'short'}):'';
/* pick the field in the current language, fall back to the other */
const L = (o,k)=>{ const ar=o[k+'Ar'], en=o[k]; return lang==='ar' ? (ar||en||'') : (en||ar||''); };
const dirOf = s=>/[؀-ۿ]/.test(s||'')?'rtl':'ltr';

let store=null, me=null, ready=false, unsubMine=null, unsubAll=null;
let listings=[], mySub=null, allSubs=[];
const st = {tab:'find', q:'', cat:'all', area:'all', editId:null, admView:'pending', admSec:'review', trRange:30};

const $ = s=>document.querySelector(s);
/* Google Analytics events (does nothing if analytics is blocked) */
const track=(name,params={})=>{ try{ if(typeof window.gtag==='function') window.gtag('event',name,params); }catch(e){} try{ countHit(name,params); }catch(e){} };
/* Our own visitor counters (Admin → Traffic). Waits until the database is ready. */
const hitQueue=[];
function hit(o){ if(!store){ hitQueue.push(o); return; } try{ const r=store.hit(o); if(r&&r.catch) r.catch(()=>{}); }catch(e){} }
function countHit(name,p){
  if(name==='page_view'){ const tab=(String(p.page_title||'').split(': ')[1]||'find'); if(tab==='admin') return; hit({pv:{[tab]:1}}); }
  else if(name==='search'){ const k=statKey(p.search_term); if(k.length<2) return; hit(p.results===0?{search:{[k]:1},nores:{[k]:1}}:{search:{[k]:1}}); }
  else if(name==='view_item'&&p.item_id) hit({view:{[statKey(p.item_id)]:1}});
  else if(name.startsWith('contact_')) hit(p.item_id?{contact:{[name.slice(8)]:1},lead:{[statKey(p.item_id)]:1}}:{contact:{[name.slice(8)]:1}});
  else if(name==='select_category'&&p.category&&p.category!=='all') hit({cat:{[statKey(p.category)]:1}});
  else if(name==='submit_listing') hit({submit:1});
}
function countVisit(){
  let newSession=true, newDay=true;
  try{ newSession=!sessionStorage.getItem('csg-sess'); sessionStorage.setItem('csg-sess','1'); }catch(e){}
  try{ const d=dayId(); newDay=localStorage.getItem('csg-day')!==d; localStorage.setItem('csg-day',d); }catch(e){}
  if(!newSession) return;
  const dev=/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)||window.matchMedia('(max-width:700px)').matches?'mobile':'desktop';
  const first=(location.hash||'').slice(1)==='provide'?'provide':'find';
  const o={visits:1, dev:{[dev]:1}, lang:{[lang]:1}, pv:{[first]:1}}; if(newDay) o.visitors=1; hit(o);
}
const esc = s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = u=>{u=String(u||'').trim(); return /^https?:\/\//i.test(u)?u:'';};
const newId = ()=>'s'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
function toast(m,ms=2600){const el=$('#toast');el.textContent=m;el.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove('show'),ms);}
function pick(o){const r={};FIELDS.forEach(k=>r[k]=String(o?.[k]??'').trim());return r;}
/* Arabic-aware search normalisation */
const norm = s=>String(s||'').toLowerCase()
  .replace(/[ً-ٰٟـ]/g,'')
  .replace(/[إأآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/ؤ/g,'و').replace(/ئ/g,'ي')
  .replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));

/* ---------- language ---------- */
function applyLang(){
  document.documentElement.lang=lang; document.documentElement.dir=lang==='ar'?'rtl':'ltr';
  document.title=t('appName');
  document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));
  document.querySelectorAll('[data-i18n-ph]').forEach(el=>el.placeholder=t(el.dataset.i18nPh));
  $('#langBtn').textContent=t('langSwitch');
  const cs=$('#catSel'), cv=cs.value; cs.innerHTML=CATS.map(c=>`<option value="${c.id}">${c.icon} ${esc(c[lang])}</option>`).join(''); if(cv) cs.value=cv;
  const ks=$('#kindSel'), kv=ks.value; ks.innerHTML=KINDS.map(k=>`<option value="${esc(k)}">${esc(t('kinds')[k])}</option>`).join(''); if(kv) ks.value=kv;
  $('#formTitle').textContent=t(st.editId?'editListing':'newListing');
  $('#submitBtn').textContent=t(st.editId?'resubmit':'submit');
  renderAll();
}
$('#langBtn').addEventListener('click',()=>{ lang=lang==='ar'?'en':'ar'; track('change_language',{language:lang}); try{localStorage.setItem('csg-lang',lang);}catch(e){} applyLang(); });
function renderAll(){ renderAuth(); renderFind(); renderProvideGate(); renderMySubs(); renderAdmin(); }

/* ---------- tabs ---------- */
$('#tabs').addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(b)setTab(b.dataset.tab);});
function setTab(v){
  st.tab=v;
  track('page_view',{page_title:'Tab: '+v, page_location:location.origin+location.pathname+(v==='find'?'':'#'+v), language:lang});
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===v));
  ['find','provide','admin'].forEach(x=>$('#view-'+x).classList.toggle('hidden',x!==v));
  try{ history.replaceState(null,'',v==='find'?location.pathname+location.search:'#'+v); }catch(e){ try{location.hash=v==='find'?'':v;}catch(_){} }
  window.scrollTo(0,0);
}

/* ---------- FIND ---------- */
function renderChips(){
  const counts={}; listings.forEach(l=>counts[l.category]=(counts[l.category]||0)+1);
  $('#chips').innerHTML = `<button class="chip ${st.cat==='all'?'on':''}" data-c="all">${esc(t('all'))}</button>` +
    CATS.map(c=>`<button class="chip ${st.cat===c.id?'on':''}" data-c="${c.id}">${c.icon} ${esc(c[lang])}${counts[c.id]?` · ${counts[c.id]}`:''}</button>`).join('');
}
$('#chips').addEventListener('click',e=>{const b=e.target.closest('.chip');if(!b)return;st.cat=b.dataset.c;renderFind();track('select_category',{category:st.cat});});
let searchTimer=null;
$('#q').addEventListener('input',e=>{
  st.q=e.target.value; renderGrid();
  clearTimeout(searchTimer);
  const term=st.q.trim();
  if(term.length>=2) searchTimer=setTimeout(()=>track('search',{search_term:term, results:listings.filter(matches).length, language:lang}),1500);
});
$('#areaSel').addEventListener('change',e=>{st.area=e.target.value;renderGrid();});
function renderAreas(){
  const areas=[...new Set(listings.map(l=>(l.area||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,locale()));
  if(st.area!=='all' && !areas.includes(st.area)) st.area='all';
  $('#areaSel').innerHTML = `<option value="all">${esc(t('allAreas'))}</option>`+areas.map(a=>`<option value="${esc(a)}" ${a===st.area?'selected':''}>${esc(a)}</option>`).join('');
}
function matches(l){
  if(st.cat!=='all' && l.category!==st.cat) return false;
  if(st.area!=='all' && (l.area||'').trim()!==st.area) return false;
  const q=norm(st.q.trim()); if(!q) return true;
  const c=CAT[l.category]||CAT.other;
  const hay=norm([l.name,l.nameAr,l.description,l.descriptionAr,l.tags,c.en,c.ar,l.area,l.address,l.requirements,l.kind,T.ar.kindShort[l.kind]].join(' '));
  return q.split(/\s+/).every(w=>hay.includes(w));
}
function renderGrid(){
  const res=listings.filter(matches).sort((a,b)=>L(a,'name').localeCompare(L(b,'name'),locale()));
  const filtered=st.q||st.cat!=='all'||st.area!=='all';
  $('#resultCount').textContent = ready ? t('count',res.length)+(filtered?t('countMatch'):'') : '';
  if(!res.length){
    $('#grid').innerHTML = ready ? `<div class="empty" style="grid-column:1/-1"><b>${esc(t(listings.length?'noMatch':'noneYet'))}</b>${esc(t(listings.length?'noMatchSub':'noneYetSub'))}</div>` : '';
    return;
  }
  const cards = res.map(l=>{ const nm=L(l,'name'), ds=L(l,'description'); return `
    <button class="card" data-id="${esc(l._id)}">
      <div class="meta"><span class="tag">${catIcon(l.category)} ${esc(catLabel(l.category))}</span><span class="tag kind">${esc(t('kindShort')[l.kind]||l.kind)}</span></div>
      <h3 dir="auto">${esc(nm)}</h3>
      ${ds?`<p class="desc" dir="auto">${esc(ds)}</p>`:''}
      <div class="foot">${l.area?`<span dir="auto">📍 ${esc(l.area)}</span>`:''}${l.hours?`<span dir="auto">🕒 ${esc(l.hours)}</span>`:''}<span class="verified">✔ ${esc(t('verified'))}</span></div>
    </button>`;});
  const adHtml = (typeof inlineAdHtml==='function') ? inlineAdHtml() : '';
  if(adHtml) cards.splice(Math.min(3,cards.length),0,adHtml);
  $('#grid').innerHTML = cards.join('');
}
$('#grid').addEventListener('click',e=>{const c=e.target.closest('.card');if(c)openDetail(c.dataset.id);});
function renderFind(){renderChips();renderAreas();renderAdTop();renderGrid();}

function openDetail(id){
  const l=listings.find(x=>x._id===id); if(!l) return;
  $('#modal').dataset.id=l._id;
  track('view_item',{item_id:l._id, item_name:l.name||l.nameAr, item_category:l.category, area:l.area||''});
  const web=safeUrl(l.website), map=safeUrl(l.mapLink);
  const row=(ic,lbl,val)=>val?`<div class="it"><div class="ic">${ic}</div><div><div class="lbl">${esc(t(lbl))}</div><div class="val" dir="auto">${val}</div></div></div>`:'';
  const tel=p=>`<span class="ltr">${esc(p)}</span> · <a href="tel:${esc(p.replace(/[^\d+]/g,''))}">${esc(t('call'))}</a>`;
  const wa=p=>`<span class="ltr">${esc(p)}</span> · <a href="https://wa.me/${p.replace(/[^\d]/g,'')}" target="_blank" rel="noopener">${esc(t('openWa'))}</a>`;
  const other = lang==='ar' ? l.name : l.nameAr;
  $('#modalBox').innerHTML=`
    <div class="mh">
      <button class="x" aria-label="Close" data-close>×</button>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="tag">${catIcon(l.category)} ${esc(catLabel(l.category))}</span><span class="tag kind">${esc(t('kindShort')[l.kind]||l.kind)}</span><span class="verified">✔ ${esc(t('verifiedBy'))}</span></div>
      <h2 dir="auto">${esc(L(l,'name'))}</h2>
      ${other && other!==L(l,'name')?`<div class="small" dir="auto">${esc(other)}</div>`:''}
      ${l.area?`<div class="small" dir="auto">📍 ${esc(l.area)}</div>`:''}
    </div>
    <div class="mb">
      ${quickActions(l)}
      ${L(l,'description')?`<p class="d" dir="auto">${esc(L(l,'description'))}</p>`:''}
      <div class="info">
        ${row('🕒','hours',esc(l.hours))}
        ${row('📍','address',esc(l.address)+(map?`${l.address?'<br>':''}<a href="${esc(map)}" target="_blank" rel="noopener">${esc(t('openMap'))}</a>`:''))}
        ${row('📞','phone',l.phone?tel(l.phone):'')}
        ${row('💬','whatsapp',l.whatsapp?wa(l.whatsapp):'')}
        ${row('✉️','email',l.email?`<span class="ltr">${esc(l.email)}</span>`:'')}
        ${row('🌐','website',web?`<a class="ltr" href="${esc(web)}" target="_blank" rel="noopener">${esc(web)}</a>`:'')}
        ${row('💰','fees',esc(l.fees))}
        ${row('📄','reqs',esc(l.requirements))}
      </div>
      ${l.approvedAt?`<p class="small" style="margin:18px 0 0">${esc(t('lastVerified'))}: ${esc(fmtDate(l.approvedAt))}</p>`:''}
    </div>`;
  openSheet();
}
function quickActions(l){
  const btns=[];
  if(l.phone) btns.push(`<a class="q-call" href="tel:${esc(l.phone.replace(/[^\d+]/g,''))}" data-ev="call">📞 ${esc(t('call'))}</a>`);
  const wa=(l.whatsapp||'').replace(/[^\d]/g,'');
  if(wa) btns.push(`<a class="q-wa" href="https://wa.me/${wa}" target="_blank" rel="noopener" data-ev="whatsapp">💬 ${esc(t('whatsapp'))}</a>`);
  const map=safeUrl(l.mapLink) || (l.address ? 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent([l.address,l.area].filter(Boolean).join(', ')) : '');
  if(map) btns.push(`<a class="q-map" href="${esc(map)}" target="_blank" rel="noopener" data-ev="directions">📍 ${esc(t('directions'))}</a>`);
  return btns.length?`<div class="quick">${btns.join('')}</div>`:'';
}
/* the detail sheet closes with the phone's Back button too */
function openSheet(){
  $('#modal').classList.add('open'); document.body.style.overflow='hidden';
  try{ if(!history.state?.sheet) history.pushState({sheet:1},''); }catch(e){}
}
function closeSheet(fromPop){
  if(!$('#modal').classList.contains('open')) return;
  $('#modal').classList.remove('open'); document.body.style.overflow='';
  if(!fromPop){ try{ if(history.state?.sheet) history.back(); }catch(e){} }
}
window.addEventListener('popstate',()=>closeSheet(true));
$('#modal').addEventListener('click',e=>{
  const a=e.target.closest('a[data-ev]'); if(a){ const l=listings.find(x=>x._id===$('#modal').dataset.id); track('contact_'+a.dataset.ev,{item_id:l?._id, item_name:l?.name||l?.nameAr}); }
  if(e.target.id==='modal'||e.target.closest('[data-close]')) closeSheet();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet();});

/* ---------- PROVIDE ---------- */
function renderProvideGate(){
  const g=$('#provideGate'), body=$('#provideBody');
  if(!ready){ g.innerHTML=''; body.classList.add('hidden'); return; }
  if(!me){ g.innerHTML=`<div class="notice">${esc(t('provNeedSignIn'))}<br><button class="btn gatebtn" id="gateSignIn">${esc(t('signInBtn'))}</button></div>`; body.classList.add('hidden'); return; }
  g.innerHTML=''; body.classList.remove('hidden');
}
$('#provideGate').addEventListener('click',e=>{ if(e.target.id==='gateSignIn') doSignIn(); });
function myItems(){ const it=mySub?.items||{}; return Object.entries(it).map(([id,v])=>({id,...v})).sort((a,b)=>(b.submittedAt||'').localeCompare(a.submittedAt||'')); }
function renderMySubs(){
  const items=myItems();
  if(!items.length){ $('#mySubs').innerHTML=`<p class="small">${esc(t('mySubsEmpty'))}</p>`; return; }
  const live=id=>listings.some(l=>l._id===id);
  $('#mySubs').innerHTML=items.map(i=>`
    <div class="subitem">
      <div class="row"><b dir="auto">${esc(L(i,'name'))}</b><span class="status s-${esc(i.status)}">${esc(t('status')[i.status]||i.status)}</span></div>
      <div class="small">${catIcon(i.category)} ${esc(catLabel(i.category))} · ${esc(t('submitted'))} ${esc(fmtDate(i.submittedAt))}</div>
      ${i.status==='rejected'&&i.note?`<div class="note"><b>${esc(t('adminNote'))}</b> <span dir="auto">${esc(i.note)}</span></div>`:''}
      ${i.status==='pending'&&live(i.id)?`<div class="small">${esc(t('oldLive'))}</div>`:''}
      <div class="actions">
        ${i.status!=='removal'&&i.status!=='removed'?`<button class="btn ghost sm" data-edit="${esc(i.id)}">${esc(t('edit'))}</button>`:''}
        ${i.status==='approved'?`<button class="btn ghost sm" data-removal="${esc(i.id)}">${esc(t('reqRemoval'))}</button>`:''}
        ${['pending','rejected','removed'].includes(i.status)&&!live(i.id)?`<button class="btn ghost sm" data-withdraw="${esc(i.id)}">${esc(t('del'))}</button>`:''}
      </div>
    </div>`).join('');
}
$('#mySubs').addEventListener('click',async e=>{
  const b=e.target.closest('button'); if(!b) return;
  if(b.dataset.edit) startEdit(b.dataset.edit);
  if(b.dataset.removal){ b.disabled=true; if(await saveMyItem(b.dataset.removal,{status:'removal',note:''})) toast(t('removalReq')); else b.disabled=false; }
  if(b.dataset.withdraw){
    b.disabled=true;
    try{ await store.deleteItem(me.uid,b.dataset.withdraw); toast(t('deleted')); }
    catch(err){ handleWriteErr(err); b.disabled=false; }
  }
});
function startEdit(id){
  const i=mySub?.items?.[id]; if(!i) return;
  st.editId=id; const f=$('#form');
  FIELDS.forEach(k=>{ if(f.elements[k]) f.elements[k].value=i[k]||''; });
  $('#formTitle').textContent=t('editListing'); $('#submitBtn').textContent=t('resubmit');
  $('#cancelEdit').classList.remove('hidden'); $('#formMsg').textContent='';
  f.scrollIntoView({behavior:'smooth',block:'start'});
}
function resetForm(){
  st.editId=null; $('#form').reset();
  $('#formTitle').textContent=t('newListing'); $('#submitBtn').textContent=t('submit');
  $('#cancelEdit').classList.add('hidden');
}
$('#cancelEdit').addEventListener('click',()=>{resetForm();$('#formMsg').textContent='';});
async function saveMyItem(id,patch){
  try{ await store.patchItem(me.uid,id,patch,{providerEmail:me.email,providerName:me.name}); return true; }
  catch(err){ handleWriteErr(err); return false; }
}
function handleWriteErr(err){
  console.error(err);
  if(err?.code==='permission-denied') toast(t('noPerm'));
  else if(err?.code==='resource-exhausted') toast(t('quota'));
  else toast(t('saveFail'));
}
$('#form').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=e.target, data=pick(Object.fromEntries(new FormData(f)));
  const missing=[];
  if(!data.name && !data.nameAr) missing.push(t('needName'));
  if(!data.area) missing.push(t('f_area'));
  if(!data.phone) missing.push(t('f_phone'));
  if(missing.length){ $('#formMsg').style.color='var(--bad)'; $('#formMsg').textContent=t('fillIn')+missing.join(lang==='ar'?'، ':', '); return; }
  if(data.website && !safeUrl(data.website)) data.website='https://'+data.website.replace(/^\/+/,'');
  const id=st.editId||newId();
  $('#submitBtn').disabled=true;
  const ok=await saveMyItem(id,{...data,status:'pending',note:'',submittedAt:new Date().toISOString()});
  $('#submitBtn').disabled=false;
  if(ok){ track('submit_listing',{category:data.category}); resetForm(); $('#formMsg').style.color='var(--ok)'; $('#formMsg').textContent=t('sent'); }
});

/* ---------- ADMIN ---------- */
const ADM_LABEL = k=>({kind:'f_kind',category:'f_category',name:'f_name',nameAr:'f_nameAr',description:'f_description',descriptionAr:'f_descriptionAr',area:'f_area',address:'f_address',mapLink:'f_mapLink',phone:'f_phone',whatsapp:'f_whatsapp',email:'f_email',website:'f_website',hours:'f_hours',fees:'f_fees',requirements:'f_requirements',tags:'f_tags'})[k];
function flatSubs(){
  const out=[]; allSubs.forEach(s=>Object.entries(s.items||{}).forEach(([id,v])=>out.push({id,owner:s._id,providerEmail:s.providerEmail,providerName:s.providerName,...v})));
  return out.sort((a,b)=>(a.submittedAt||'').localeCompare(b.submittedAt||''));
}
function renderAdminTabs(){
  const secs=['review','ads','traffic','admins'];
  $('#admTabs').innerHTML=secs.map(k=>`<button class="${st.admSec===k?'on':''}" data-sec="${k}">${esc(t('admSec_'+k))}</button>`).join('');
}
$('#admTabs').addEventListener('click',e=>{ const b=e.target.closest('button[data-sec]'); if(!b) return; st.admSec=b.dataset.sec; renderAdmin(); });
function renderAdmin(){
  if(!me?.isAdmin) return;
  renderAdminTabs();
  { const all=flatSubs(), n=all.filter(i=>i.status==='pending'||i.status==='removal').length; $('#adminCount').textContent=n; $('#adminCount').classList.toggle('hidden',!n); }
  $('#admStats').classList.toggle('hidden', st.admSec!=='review');
  { const h=$('#view-admin h2'), p=$('#view-admin .sub'); h.textContent=t({review:'admTitle',traffic:'tr_title',admins:'adm_title',ads:'ad_titleT'}[st.admSec]); p.textContent=t({review:'admSub',traffic:'tr_sub',admins:'adm_sub',ads:'ad_sub'}[st.admSec]); }
  if(st.admSec==='traffic'){ renderTraffic(); return; }
  if(st.admSec==='admins'){ renderAdmins(); return; }
  if(st.admSec==='ads'){ renderAdsAdmin(); return; }
  const all=flatSubs();
  const groups={pending:all.filter(i=>i.status==='pending'),removal:all.filter(i=>i.status==='removal'),rejected:all.filter(i=>i.status==='rejected')};
  const n=groups.pending.length+groups.removal.length;
  $('#adminCount').textContent=n; $('#adminCount').classList.toggle('hidden',!n);
  const stats=[['pending',groups.pending.length],['removal',groups.removal.length],['published',listings.length],['rejected',groups.rejected.length]];
  $('#admStats').innerHTML=stats.map(([k,c])=>`<button class="stat ${st.admView===k?'on':''}" data-v="${k}"><div class="n">${c}</div><div class="l">${esc(t('st_'+k))}</div></button>`).join('');
  const body=$('#admBody');
  if(st.admView==='published'){
    if(!listings.length){ body.innerHTML=`<div class="empty"><b>${esc(t('nothingPub'))}</b>${esc(t('nothingPubSub'))}</div>`; return; }
    body.innerHTML=`<div class="tablewrap"><table class="pub"><thead><tr><th>${esc(t('th_name'))}</th><th>${esc(t('th_cat'))}</th><th>${esc(t('th_area'))}</th><th>${esc(t('th_ver'))}</th><th></th></tr></thead><tbody>${
      [...listings].sort((a,b)=>L(a,'name').localeCompare(L(b,'name'),locale())).map(l=>`<tr><td><b dir="auto">${esc(L(l,'name'))}</b></td><td>${catIcon(l.category)} ${esc(catLabel(l.category))}</td><td dir="auto">${esc(l.area)}</td><td class="small">${esc(fmtDate(l.approvedAt))}</td><td class="end"><button class="btn ghost sm" data-view="${esc(l._id)}">${esc(t('view'))}</button> <button class="btn bad sm" data-unpub="${esc(l._id)}">${esc(t('unpublish'))}</button></td></tr>`).join('')
    }</tbody></table></div>`;
    return;
  }
  const list=groups[st.admView]||[];
  if(!list.length){ const m={pending:'clearPending',removal:'clearRemoval',rejected:'clearRejected'}[st.admView]; body.innerHTML=`<div class="empty"><b>${esc(t('allClear'))}</b>${esc(t(m))}</div>`; return; }
  body.innerHTML=list.map(i=>{
    const live=listings.find(l=>l._id===i.id);
    const showDiff=live&&st.admView==='pending';
    const dd=k=>{
      let v=k==='category'?`${catIcon(i[k])} ${catLabel(i[k])}`:k==='kind'?(t('kinds')[i[k]]||i[k]):i[k];
      const ch=showDiff&&String(live[k]||'')!==String(i[k]||'');
      if(!v) return ch?`<dt>${esc(t(ADM_LABEL(k)))}</dt><dd><span class="changed">${esc(t('removedVal'))}</span></dd>`:'';
      return `<dt>${esc(t(ADM_LABEL(k)))}</dt><dd dir="auto">${ch?`<span class="changed">${esc(v)}</span>`:esc(v)}</dd>`;
    };
    return `<div class="review" data-id="${esc(i.id)}" data-owner="${esc(i.owner)}">
      <div class="top"><div><h3 dir="auto">${esc(L(i,'name'))}</h3><div class="small">${i.providerEmail?`${esc(t('from'))} <span class="ltr">${esc(i.providerName&&i.providerName!==i.providerEmail?i.providerName+' · ':'')}${esc(i.providerEmail)}</span> · `:''}${esc(t('submitted'))} ${esc(fmtDT(i.submittedAt))}${showDiff?` · <b>${esc(t('isUpdate'))}</b>`:''}</div></div>
      <span class="status s-${esc(i.status)}">${esc(t('status')[i.status])}</span></div>
      <dl class="kv">${FIELDS.map(dd).join('')}</dl>
      ${i.status==='rejected'&&i.note?`<div class="small" style="margin-bottom:10px"><b>${esc(t('yourNote'))}</b> <span dir="auto">${esc(i.note)}</span></div>`:''}
      <div class="actions">
        ${i.status==='pending'?`<button class="btn ok" data-approve>${esc(t('approve'))}</button><button class="btn ghost" data-rejecttoggle>${esc(t('sendBackNote'))}</button>`:''}
        ${i.status==='removal'?`<button class="btn bad" data-doremove>${esc(t('unpublish'))}</button><button class="btn ghost" data-keep>${esc(t('keep'))}</button>`:''}
        ${i.status==='rejected'?`<button class="btn ok" data-approve>${esc(t('approveAnyway'))}</button>`:''}
      </div>
      <div class="rejectbox"><textarea dir="auto" placeholder="${esc(t('rejectPh'))}"></textarea><div class="actions"><button class="btn bad sm" data-reject>${esc(t('sendBack'))}</button></div></div>
    </div>`;
  }).join('');
}
$('#admStats').addEventListener('click',e=>{const b=e.target.closest('.stat');if(b){st.admView=b.dataset.v;renderAdmin();}});

/* ---------- ADMIN → TRAFFIC ---------- */
let trCache={key:'',rows:null,err:false,busy:false};
const fmtN=n=>Number(n||0).toLocaleString(locale());
const sumMap=(rows,k)=>{ const o={}; rows.forEach(r=>{ const m=r[k]; if(m&&typeof m==='object') for(const x in m) o[x]=(o[x]||0)+(+m[x]||0); }); return o; };
const sumNum=(rows,k)=>rows.reduce((a,r)=>a+(+r[k]||0),0);
const topOf=(o,n=8)=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,n);
function dayList(n){ const out=[]; const d=new Date(); for(let i=n-1;i>=0;i--){ const x=new Date(d.getTime()-i*864e5); out.push(dayId(x)); } return out; }
async function loadTraffic(force){
  const days=dayList(st.trRange), key=days[0]+'-'+days[days.length-1];
  if(!force && trCache.key===key && (trCache.rows||trCache.busy)) return;
  trCache={key,rows:null,err:false,busy:true};
  try{ const rows=await store.getStats(days[0],days[days.length-1]); trCache={key,rows,err:false,busy:false}; }
  catch(e){ console.error(e); trCache={key,rows:null,err:true,busy:false}; }
  if(st.tab==='admin'&&st.admSec==='traffic') renderTraffic();
}
function barRows(entries,label,total,unit){
  if(!entries.length) return `<p class="small">${esc(t('tr_none'))}</p>`;
  const max=Math.max(...entries.map(e=>e[1]),1);
  return `<div class="tr-bars">${entries.map(([k,v])=>`<div class="tr-bar"><div class="tr-bl"><span dir="auto">${label(k)}</span><b>${fmtN(v)}${unit?` <small>${esc(unit)}</small>`:''}</b></div><div class="tr-track"><i style="width:${Math.max(3,Math.round(v/max*100))}%"></i></div></div>`).join('')}</div>`;
}
function chartSvg(days,byDay){
  const W=Math.max(300,Math.min(1100,($('#admBody').clientWidth||640)-34)),H=200,P={l:34,r:8,t:12,b:26}, n=days.length, vals=days.map(d=>byDay[d]||{v:0,u:0});
  const max=Math.max(4,...vals.map(x=>Math.max(x.v,x.u)));
  const step=Math.pow(10,Math.floor(Math.log10(max))), nice=Math.ceil(max/step)*step;
  const cw=(W-P.l-P.r)/n, bw=Math.max(2,cw*.62);
  const y=v=>P.t+(H-P.t-P.b)*(1-v/nice);
  const grid=[0,.5,1].map(f=>`<line x1="${P.l}" x2="${W-P.r}" y1="${y(nice*f)}" y2="${y(nice*f)}" class="g"/><text x="${P.l-6}" y="${y(nice*f)+4}" text-anchor="end">${fmtN(Math.round(nice*f))}</text>`).join('');
  const bars=vals.map((x,i)=>`<rect x="${P.l+i*cw+(cw-bw)/2}" y="${y(x.u)}" width="${bw}" height="${Math.max(0,y(0)-y(x.u))}" rx="2" class="b"><title>${days[i].slice(6)}/${days[i].slice(4,6)} · ${fmtN(x.u)} ${t('tr_visitors')} · ${fmtN(x.v)} ${t('tr_visits')}</title></rect>`).join('');
  const line=vals.map((x,i)=>`${i?'L':'M'}${(P.l+i*cw+cw/2).toFixed(1)},${y(x.v).toFixed(1)}`).join(' ');
  const every=Math.ceil(n/7);
  const labels=days.map((d,i)=>(i%every===0||i===n-1)?`<text x="${P.l+i*cw+cw/2}" y="${H-8}" text-anchor="middle">${+d.slice(6)}/${+d.slice(4,6)}</text>`:'').join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="tr-chart" role="img" aria-label="${esc(t('tr_daily'))}" direction="ltr">${grid}${bars}<path d="${line}" class="l"/>${labels}</svg>
    <div class="tr-legend"><span><i class="b"></i>${esc(t('tr_visitors'))}</span><span><i class="l"></i>${esc(t('tr_visits'))}</span></div>`;
}
function renderTraffic(){
  const body=$('#admBody'); loadTraffic(false);
  const ranges=[7,30,90];
  const head=`<div class="tr-head"><div class="seg">${ranges.map(r=>`<button class="${st.trRange===r?'on':''}" data-range="${r}">${esc(t('tr_range'+r))}</button>`).join('')}</div><button class="btn ghost sm" data-trrefresh>↻</button></div>`;
  if(trCache.busy||!trCache.rows){ body.innerHTML=head+(trCache.err?`<div class="notice">${esc(t('tr_fail'))}</div>`:`<p class="small">${esc(t('tr_loading'))}</p>`); return; }
  const rows=trCache.rows, days=dayList(st.trRange), byDay={}; rows.forEach(r=>byDay[r.id]={v:+r.visits||0,u:+r.visitors||0});
  const contact=sumMap(rows,'contact'), views=sumMap(rows,'view'), leads=sumMap(rows,'lead');
  const pvTotal=Object.values(sumMap(rows,'pv')).reduce((a,b)=>a+b,0);
  const kp=[['tr_visitors',sumNum(rows,'visitors')],['tr_visits',sumNum(rows,'visits')],['tr_pv',pvTotal],['tr_searches',Object.values(sumMap(rows,'search')).reduce((a,b)=>a+b,0)],['tr_views',Object.values(views).reduce((a,b)=>a+b,0)],['tr_contacts',Object.values(contact).reduce((a,b)=>a+b,0)],['tr_submits',sumNum(rows,'submit')]];
  const lname=id=>{ const l=listings.find(x=>x._id===id); return l?esc(L(l,'name')):`<span class="small">${esc(t('tr_deleted'))}</span>`; };
  const topViewed=topOf(views,8);
  const viewedHtml=topViewed.length?`<div class="tr-bars">${(()=>{ const max=Math.max(...topViewed.map(e=>e[1]),1); return topViewed.map(([id,v])=>`<div class="tr-bar"><div class="tr-bl"><span dir="auto">${lname(id)}</span><b>${fmtN(v)} <small>${esc(t('tr_viewsCol'))}</small>${leads[id]?` · ${fmtN(leads[id])} <small>${esc(t('tr_contactsCol'))}</small>`:''}</b></div><div class="tr-track"><i style="width:${Math.max(3,Math.round(v/max*100))}%"></i></div></div>`).join(''); })()}</div>`:`<p class="small">${esc(t('tr_none'))}</p>`;
  const ctLabel=k=>esc(t({call:'tr_call',whatsapp:'tr_wa',directions:'tr_dir'}[k]||k));
  const devLabel=k=>esc(t(k==='mobile'?'tr_mobile':'tr_desktop'));
  const langLabel=k=>k==='ar'?'العربية':'English';
  body.innerHTML=head+`
    <div class="tr-kpis">${kp.map(([k,v])=>`<div class="tr-kpi"><div class="n">${fmtN(v)}</div><div class="l">${esc(t(k))}</div></div>`).join('')}</div>
    <div class="panel tr-panel"><h3>${esc(t('tr_daily'))}</h3>${chartSvg(days,byDay)}</div>
    <div class="tr-grid">
      <div class="panel tr-panel"><h3>${esc(t('tr_topViewed'))}</h3>${viewedHtml}</div>
      <div class="panel tr-panel"><h3>${esc(t('tr_topSearch'))}</h3>${barRows(topOf(sumMap(rows,'search')),k=>esc(k),0,t('tr_times'))}</div>
      <div class="panel tr-panel"><h3>${esc(t('tr_nores'))}</h3><p class="small" style="margin:-6px 0 10px">${esc(t('tr_noresHint'))}</p>${barRows(topOf(sumMap(rows,'nores')),k=>esc(k),0,t('tr_times'))}</div>
      <div class="panel tr-panel"><h3>${esc(t('tr_contactType'))}</h3>${barRows(topOf(contact),ctLabel)}</div>
      <div class="panel tr-panel"><h3>${esc(t('tr_cats'))}</h3>${barRows(topOf(sumMap(rows,'cat')),k=>`${catIcon(k)} ${esc(catLabel(k))}`)}</div>
      <div class="panel tr-panel"><h3>${esc(t('tr_devices'))} · ${esc(t('tr_langs'))}</h3>${barRows(topOf(sumMap(rows,'dev')),devLabel)}<div style="height:12px"></div>${barRows(topOf(sumMap(rows,'lang')),langLabel)}</div>
    </div>
    <p class="small tr-note">${esc(t('tr_note'))} <a href="https://analytics.google.com/" target="_blank" rel="noopener">${esc(t('tr_ga'))}</a></p>`;
}

/* ---------- ADMIN → ADMINS ---------- */
let admList={rows:null,busy:false,err:false}, admConfirm=null;
async function loadAdmins(){ admList={rows:null,busy:true,err:false}; try{ admList={rows:await store.listAdmins(),busy:false,err:false}; }catch(e){ console.error(e); admList={rows:null,busy:false,err:true}; } if(st.tab==='admin'&&st.admSec==='admins') renderAdmins(); }
function renderAdmins(){
  const body=$('#admBody');
  if(!admList.rows&&!admList.busy&&!admList.err){ loadAdmins(); }
  const owners=(store.owners||[]).map(normEmail);
  const others=(admList.rows||[]).filter(a=>!owners.includes(a.email)).sort((a,b)=>a.email.localeCompare(b.email));
  const you=e=>e===me?.email?` <span class="tag kind">${esc(t('adm_you'))}</span>`:'';
  const ownerRows=owners.map(e=>`<div class="adm-row"><div class="adm-av">${esc(e[0]||'?').toUpperCase()}</div><div class="adm-d"><b class="ltr">${esc(e)}</b>${you(e)}<small>${esc(t('adm_ownerHint'))}</small></div><span class="status s-approved">${esc(t('adm_owner'))}</span></div>`).join('');
  const otherRows=admList.busy?`<p class="small">${esc(t('tr_loading'))}</p>`:admList.err?`<div class="notice">${esc(t('saveFail'))}</div>`:(others.length?others.map(a=>`<div class="adm-row"><div class="adm-av">${esc(a.email[0]||'?').toUpperCase()}</div><div class="adm-d"><b class="ltr">${esc(a.email)}</b>${you(a.email)}<small>${esc(t('adm_added'))} ${esc(fmtDate(a.addedAt))}${a.addedBy?` · ${esc(t('adm_by'))} <span class="ltr">${esc(a.addedBy)}</span>`:''}</small></div>${a.email===me?.email?'':(admConfirm===a.email?`<div class="actions"><button class="btn bad sm" data-admdel="${esc(a.email)}">${esc(t('adm_remove'))}</button><button class="btn ghost sm" data-admcancel>${esc(t('adm_cancel'))}</button></div>`:`<button class="btn ghost sm" data-admask="${esc(a.email)}">${esc(t('adm_remove'))}</button>`)}</div>`).join(''):`<p class="small">${esc(t('adm_none'))}</p>`);
  body.innerHTML=`<div class="two">
    <div class="panel"><h3>${esc(t('adm_add'))}</h3><p class="small" style="margin-top:-6px">${esc(t('adm_hint'))}</p>
      <form id="admForm" class="actions" novalidate style="margin-top:12px"><label class="f" style="flex:1;min-width:200px"><input id="admEmail" type="email" dir="ltr" placeholder="name@gmail.com" autocomplete="off" aria-label="${esc(t('adm_add'))}"></label><button class="btn" type="submit">${esc(t('adm_add'))}</button></form>
      <div class="formmsg" id="admMsg" style="margin-top:8px"></div></div>
    <div class="panel"><h3>${esc(t('admSec_admins'))}</h3><div class="adm-list">${ownerRows}${otherRows}</div></div></div>`;
}
$('#admBody').addEventListener('submit',async e=>{
  if(e.target.id!=='admForm') return; e.preventDefault();
  const inp=$('#admEmail'), email=normEmail(inp.value), msg=$('#admMsg');
  if(!validEmail(email)){ msg.style.color='var(--bad)'; msg.textContent=t('adm_badEmail'); return; }
  if((store.owners||[]).map(normEmail).includes(email)||(admList.rows||[]).some(a=>a.email===email)){ msg.style.color='var(--bad)'; msg.textContent=t('adm_exists'); return; }
  try{ await store.addAdmin(email,me?.email); toast(t('adm_addedToast')); await loadAdmins(); }catch(err){ handleWriteErr(err); }
});
$('#admBody').addEventListener('click',async e=>{
  const b=e.target.closest('button'); if(!b) return;
  if(b.dataset.range){ st.trRange=+b.dataset.range; renderTraffic(); return; }
  if('trrefresh' in b.dataset){ loadTraffic(true); renderTraffic(); return; }
  if(b.dataset.admask){ admConfirm=b.dataset.admask; renderAdmins(); return; }
  if('admcancel' in b.dataset){ admConfirm=null; renderAdmins(); return; }
  if(b.dataset.admdel){ b.disabled=true; try{ await store.removeAdmin(b.dataset.admdel); admConfirm=null; toast(t('adm_removed')); await loadAdmins(); }catch(err){ handleWriteErr(err); b.disabled=false; } return; }
},true);
$('#admBody').addEventListener('click',async e=>{
  const b=e.target.closest('button'); if(!b) return;
  if(b.dataset.view){ openDetail(b.dataset.view); return; }
  if(b.dataset.unpub){
    const l=listings.find(x=>x._id===b.dataset.unpub); if(!l) return; b.disabled=true;
    try{
      await store.deleteListing(l._id);
      if(l.providerId){ const s=allSubs.find(x=>x._id===l.providerId); if(s?.items?.[l._id]) await store.patchItem(l.providerId,l._id,{status:'removed',reviewedAt:new Date().toISOString()}); }
      toast(t('unpublished'));
    }catch(err){handleWriteErr(err);b.disabled=false;}
    return;
  }
  const card=b.closest('.review'); if(!card) return;
  const id=card.dataset.id, owner=card.dataset.owner;
  const item=allSubs.find(s=>s._id===owner)?.items?.[id]; if(!item) return;
  const now=new Date().toISOString(), patch=p=>store.patchItem(owner,id,p);
  if('rejecttoggle' in b.dataset){ card.querySelector('.rejectbox').classList.toggle('open'); card.querySelector('textarea').focus(); return; }
  const unlock=()=>card.querySelectorAll('button').forEach(x=>x.disabled=false);
  card.querySelectorAll('button').forEach(x=>x.disabled=true);
  try{
    if('approve' in b.dataset){
      await store.setListing(id,{...pick(item),providerId:owner,approvedAt:now});
      await patch({status:'approved',note:'',reviewedAt:now});
      toast(t('approved'));
    }else if('reject' in b.dataset){
      const note=card.querySelector('textarea').value.trim();
      if(!note){ toast(t('addNote')); unlock(); return; }
      await patch({status:'rejected',note,reviewedAt:now});
      toast(t('sentBack'));
    }else if('doremove' in b.dataset){
      await store.deleteListing(id);
      await patch({status:'removed',reviewedAt:now});
      toast(t('unpublished'));
    }else if('keep' in b.dataset){
      await patch({status:'approved',reviewedAt:now});
      toast(t('kept'));
    }
  }catch(err){ handleWriteErr(err); unlock(); }
});


/* ================= ADVERTS ================= */
let ads=[], adEdit=null, adConfirm=null, adStats=null, adImg='';
const nowMs=()=>Date.now();
const adStatus=a=>{ const n=nowMs(), s=Date.parse(a.start||0), e=Date.parse(a.end||0); if(a.paused) return 'paused'; if(n<s) return 'scheduled'; if(n>e) return 'ended'; return 'live'; };
const adLive=a=>adStatus(a)==='live';
const adTitle=a=>lang==='ar'?(a.titleAr||a.title||''):(a.title||a.titleAr||'');
const adText=a=>lang==='ar'?(a.textAr||a.text||''):(a.text||a.textAr||'');
const adFor=(where)=>ads.filter(a=>adLive(a)&&(a.place===where||a.place==='both')&&(!a.cat||a.cat===st.cat)).sort((x,y)=>(x.order||0)-(y.order||0)||String(x.start).localeCompare(String(y.start)));
const adSeen=new Set();
function adImpression(a){ if(adSeen.has(a._id)) return; adSeen.add(a._id); let k='csg-adv-'+a._id; try{ if(sessionStorage.getItem(k)) return; sessionStorage.setItem(k,'1'); }catch(e){} hit({adv:{[statKey(a._id)]:1}}); }
function adCardHtml(a,variant){
  const img=a.image?`<img src="${esc(a.image)}" alt="" loading="lazy">`:'';
  const cta=a.listingId?t('ad_view'):(safeUrl(a.url)?t('ad_visit'):'');
  const inner=`${img}<span class="ad-shade"></span><span class="ad-tag">${esc(t('ad_sponsored'))}</span><span class="ad-txt"><b dir="auto">${esc(adTitle(a))}</b>${adText(a)?`<small dir="auto">${esc(adText(a))}</small>`:''}${cta?`<em>${esc(cta)} ›</em>`:''}</span>`;
  const cls=`ad ad-${variant}${a.image?'':' ad-noimg'}`;
  if(!a.listingId && safeUrl(a.url)) return `<a class="${cls}" href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener sponsored" data-ad="${esc(a._id)}">${inner}</a>`;
  return `<button class="${cls}" type="button" data-ad="${esc(a._id)}">${inner}</button>`;
}
let adTimer=null, adIdx=0;
function renderAdTop(){
  const box=$('#adTop'); if(!box) return;
  const list=adFor('top');
  clearInterval(adTimer);
  if(!list.length){ box.innerHTML=''; box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML=`<div class="ad-track" id="adTrack">${list.map(a=>adCardHtml(a,'top')).join('')}</div>${list.length>1?`<div class="ad-dots">${list.map((a,i)=>`<button type="button" aria-label="${i+1}" data-dot="${i}" class="${i===0?'on':''}"></button>`).join('')}</div>`:''}`;
  adImpression(list[0]); adIdx=0;
  const tr=$('#adTrack');
  const setDot=i=>{ box.querySelectorAll('.ad-dots button').forEach((d,j)=>d.classList.toggle('on',j===i)); if(list[i]) adImpression(list[i]); };
  tr.addEventListener('scroll',()=>{ const i=Math.round(Math.abs(tr.scrollLeft)/tr.clientWidth); if(i!==adIdx){ adIdx=i; setDot(i); } },{passive:true});
  if(list.length>1){
    let paused=false; tr.addEventListener('pointerdown',()=>paused=true); tr.addEventListener('mouseenter',()=>paused=true); tr.addEventListener('mouseleave',()=>paused=false);
    adTimer=setInterval(()=>{ if(paused||document.hidden||st.tab!=='find') return; const n=(adIdx+1)%list.length; tr.scrollTo({left:(document.dir==='rtl'?-1:1)*n*tr.clientWidth,behavior:'smooth'}); },6000);
  }
}
document.addEventListener('click',e=>{
  const d=e.target.closest('#adTop .ad-dots button'); if(d){ const tr=$('#adTrack'); tr.scrollTo({left:(document.dir==='rtl'?-1:1)*(+d.dataset.dot)*tr.clientWidth,behavior:'smooth'}); return; }
  const a=e.target.closest('[data-ad]'); if(!a) return;
  const ad=ads.find(x=>x._id===a.dataset.ad); if(!ad) return;
  hit({adc:{[statKey(ad._id)]:1}}); track('ad_click',{ad_id:ad._id, advertiser:ad.advertiser||''});
  if(ad.listingId){ e.preventDefault(); openDetail(ad.listingId); }
},true);
function inlineAdHtml(){ const list=adFor('inline'); if(!list.length) return ''; const a=list[Math.floor(nowMs()/60000)%list.length]; adImpression(a); return adCardHtml(a,'inline'); }
setInterval(()=>{ if(st.tab==='find'&&ads.length){ renderAdTop(); renderGrid(); } if(st.tab==='admin'&&st.admSec==='ads'&&!adEdit) renderAdsAdmin(); },60000);

/* image: shrink to a banner-sized JPEG so it can be stored with the advert */
function shrinkImage(file){ return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onerror=()=>rej(new Error('read')); fr.onload=()=>{ const im=new Image(); im.onerror=()=>rej(new Error('image')); im.onload=()=>{
  const maxW=1200,maxH=600, r=Math.min(1,maxW/im.width,maxH/im.height), w=Math.round(im.width*r), h=Math.round(im.height*r);
  const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,w,h); g.drawImage(im,0,0,w,h);
  let q=.82, out=c.toDataURL('image/jpeg',q); while(out.length>420000&&q>.4){ q-=.08; out=c.toDataURL('image/jpeg',q); } res(out); }; im.src=fr.result; }; fr.readAsDataURL(file); }); }

/* ---------- ADMIN → ADVERTS ---------- */
const toLocalInput=iso=>{ if(!iso) return ''; const d=new Date(iso); if(isNaN(d)) return ''; const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fmtWhen=iso=>{ try{ return new Date(iso).toLocaleString(locale(),{dateStyle:'medium',timeStyle:'short'}); }catch(e){ return iso||''; } };
async function loadAdStats(){
  try{ const days=dayList(90); const rows=await store.getStats(days[0],days[days.length-1]); adStats={v:sumMap(rows,'adv'),c:sumMap(rows,'adc')}; }catch(e){ console.error(e); adStats={v:{},c:{},err:true}; }
  if(st.tab==='admin'&&st.admSec==='ads'&&!adEdit) renderAdsAdmin();
}
function renderAdsAdmin(){
  const body=$('#admBody');
  if(adEdit){ renderAdForm(); return; }
  if(!adStats) loadAdStats();
  const order={live:0,scheduled:1,paused:2,ended:3};
  const list=[...ads].sort((a,b)=>order[adStatus(a)]-order[adStatus(b)]||String(b.start).localeCompare(String(a.start)));
  const pill=s=>`<span class="status ad-s-${s}">${esc(t('ad_st_'+s))}</span>`;
  const placeLbl=a=>t(a.place==='both'?'ad_pl_both':a.place==='inline'?'ad_pl_inline':'ad_pl_top');
  const rows=list.map(a=>{ const s=adStatus(a), v=adStats?.v?.[statKey(a._id)]||0, c=adStats?.c?.[statKey(a._id)]||0, ctr=v?Math.round(c/v*1000)/10:0;
    return `<div class="adm-ad">
      <div class="adm-ad-img">${a.image?`<img src="${esc(a.image)}" alt="">`:`<span>${esc(t('ad_sponsored'))}</span>`}</div>
      <div class="adm-ad-d"><div class="row1"><b dir="auto">${esc(adTitle(a)||'—')}</b>${pill(s)}</div>
        <small dir="auto">${esc(a.advertiser||'')}${a.listingId?` · ${esc(t('ad_linkGuide'))}`:safeUrl(a.url)?` · <span class="ltr">${esc(safeUrl(a.url).replace(/^https?:\/\//,'').slice(0,40))}</span>`:''}</small>
        <small>${esc(fmtWhen(a.start))} → ${esc(fmtWhen(a.end))}</small>
        <small>${esc(placeLbl(a))} · ${a.cat?`${catIcon(a.cat)} ${esc(catLabel(a.cat))}`:esc(t('ad_allCats'))}</small>
        <div class="adm-ad-k"><span><b>${fmtN(v)}</b> ${esc(t('ad_views'))}</span><span><b>${fmtN(c)}</b> ${esc(t('ad_clicks'))}</span><span><b>${ctr}%</b> ${esc(t('ad_ctr'))}</span></div>
        <div class="actions">
          <button class="btn ghost sm" data-adedit="${esc(a._id)}">${esc(t('edit'))}</button>
          ${s!=='ended'?`<button class="btn ghost sm" data-adpause="${esc(a._id)}">${esc(t(a.paused?'ad_resume':'ad_pause'))}</button>`:''}
          <button class="btn ghost sm" data-adcopy="${esc(a._id)}">${esc(t('ad_copy'))}</button>
          ${adConfirm===a._id?`<button class="btn bad sm" data-addel="${esc(a._id)}">${esc(t('ad_delSure'))}</button><button class="btn ghost sm" data-adcancel>${esc(t('adm_cancel'))}</button>`:`<button class="btn ghost sm" data-adask="${esc(a._id)}">${esc(t('del'))}</button>`}
        </div></div></div>`; }).join('');
  body.innerHTML=`<div class="tr-head"><p class="small" style="margin:0">${esc(t('ad_listHint'))}</p><button class="btn" data-adnew>＋ ${esc(t('ad_new'))}</button></div>
    ${list.length?`<div class="adm-ads">${rows}</div>`:`<div class="empty"><b>${esc(t('ad_none'))}</b>${esc(t('ad_noneSub'))}</div>`}
    ${adStats&&!adStats.err?`<p class="small tr-note">${esc(t('ad_statsNote'))}</p>`:''}`;
}
function blankAd(){ const s=new Date(); s.setMinutes(0,0,0); s.setHours(s.getHours()+1); const e=new Date(s.getTime()+7*864e5); return {advertiser:'',listingId:'',url:'',title:'',titleAr:'',text:'',textAr:'',image:'',place:'top',cat:'',start:s.toISOString(),end:e.toISOString(),paused:false,order:0}; }
function renderAdForm(){
  const a=adEdit.data, isNew=!adEdit.id;
  const opts=[...listings].sort((x,y)=>L(x,'name').localeCompare(L(y,'name'),locale())).map(l=>`<option value="${esc(l._id)}" ${a.listingId===l._id?'selected':''}>${esc(L(l,'name'))}</option>`).join('');
  $('#admBody').innerHTML=`<div class="two">
  <div class="panel"><h3>${esc(t(isNew?'ad_new':'ad_editT'))}</h3>
    <form id="adForm" class="form" novalidate>
      <label class="f full"><span>${esc(t('ad_advertiser'))} <span class="req">*</span></span><input name="advertiser" maxlength="100" value="${esc(a.advertiser)}" dir="auto"></label>
      <div class="sect">${esc(t('ad_secContent'))}</div>
      <label class="f"><span>${esc(t('ad_title'))} (English)</span><input name="title" maxlength="70" dir="ltr" value="${esc(a.title)}"></label>
      <label class="f"><span>${esc(t('ad_title'))} (العربية)</span><input name="titleAr" maxlength="70" dir="rtl" value="${esc(a.titleAr)}"></label>
      <label class="f"><span>${esc(t('ad_text'))} (English)</span><input name="text" maxlength="120" dir="ltr" value="${esc(a.text)}"></label>
      <label class="f"><span>${esc(t('ad_text'))} (العربية)</span><input name="textAr" maxlength="120" dir="rtl" value="${esc(a.textAr)}"></label>
      <div class="full small">${esc(t('ad_titleRule'))}</div>
      <label class="f full"><span>${esc(t('ad_image'))} <span class="hint">${esc(t('ad_imageHint'))}</span></span><input type="file" id="adFile" accept="image/*"></label>
      ${a.image?`<div class="full actions"><button type="button" class="btn ghost sm" data-adnoimg>${esc(t('ad_removeImg'))}</button></div>`:''}
      <div class="sect">${esc(t('ad_secLink'))}</div>
      <label class="f full"><span>${esc(t('ad_linkListing'))}</span><select name="listingId"><option value="">${esc(t('ad_noListing'))}</option>${opts}</select></label>
      <label class="f full"><span>${esc(t('ad_linkUrl'))}</span><input name="url" maxlength="300" dir="ltr" placeholder="https://…" value="${esc(a.url)}"></label>
      <div class="sect">${esc(t('ad_secWhere'))}</div>
      <label class="f"><span>${esc(t('ad_place'))}</span><select name="place">${['top','inline','both'].map(p=>`<option value="${p}" ${a.place===p?'selected':''}>${esc(t('ad_pl_'+p))}</option>`).join('')}</select></label>
      <label class="f"><span>${esc(t('ad_cat'))}</span><select name="cat"><option value="">${esc(t('ad_allCats'))}</option>${CATS.map(c=>`<option value="${c.id}" ${a.cat===c.id?'selected':''}>${c.icon} ${esc(c[lang])}</option>`).join('')}</select></label>
      <div class="sect">${esc(t('ad_secWhen'))}</div>
      <label class="f"><span>${esc(t('ad_start'))} <span class="req">*</span></span><input type="datetime-local" name="start" value="${esc(toLocalInput(a.start))}"></label>
      <label class="f"><span>${esc(t('ad_end'))} <span class="req">*</span></span><input type="datetime-local" name="end" value="${esc(toLocalInput(a.end))}"></label>
      <div class="full actions" style="gap:6px">${[[7,'ad_q7'],[14,'ad_q14'],[30,'ad_q30']].map(([d,k])=>`<button type="button" class="btn ghost sm" data-adquick="${d}">${esc(t(k))}</button>`).join('')}</div>
      <label class="f"><span>${esc(t('ad_order'))} <span class="hint">${esc(t('ad_orderHint'))}</span></span><input type="number" name="order" min="0" max="99" value="${+a.order||0}"></label>
      <label class="f" style="justify-content:flex-end"><span style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" name="paused" ${a.paused?'checked':''} style="width:18px;height:18px"> ${esc(t('ad_pausedBox'))}</span></label>
      <div class="full actions"><button class="btn" type="submit">${esc(t('ad_save'))}</button><button class="btn ghost" type="button" data-adback>${esc(t('adm_cancel'))}</button><span class="formmsg" id="adMsg"></span></div>
    </form></div>
  <div class="panel ad-prev-panel"><h3>${esc(t('ad_preview'))}</h3><div id="adPrev"></div><p class="small" id="adPrevSt" style="margin-top:12px"></p></div></div>`;
  updateAdPreview();
}
function readAdForm(){ const f=$('#adForm'); if(!f) return adEdit.data; const v=k=>String(f.elements[k]?.value||'').trim();
  const toIso=x=>{ const d=new Date(x); return isNaN(d)?'':d.toISOString(); };
  return {...adEdit.data, advertiser:v('advertiser'), title:v('title'), titleAr:v('titleAr'), text:v('text'), textAr:v('textAr'), listingId:v('listingId'), url:v('url'), place:v('place')||'top', cat:v('cat'), start:toIso(v('start')), end:toIso(v('end')), order:Math.max(0,Math.min(99,parseInt(v('order'))||0)), paused:!!f.elements.paused?.checked, image:adEdit.data.image||''}; }
function updateAdPreview(){ const a={...readAdForm(),_id:'preview'}; const p=$('#adPrev'); if(!p) return;
  p.innerHTML=`<div class="ad-prev-top">${adCardHtml(a,'top').replace(/data-ad="preview"/,'tabindex="-1"')}</div><div class="ad-prev-inline">${adCardHtml(a,'inline').replace(/data-ad="preview"/,'tabindex="-1"')}</div>`;
  const s=a.start&&a.end?adStatus(a):''; $('#adPrevSt').textContent=s?t('ad_willBe')+' '+t('ad_st_'+s):''; }
$('#admBody').addEventListener('input',e=>{ if(e.target.closest('#adForm')){ adEdit.data=readAdForm(); updateAdPreview(); } });
$('#admBody').addEventListener('change',async e=>{
  if(e.target.id==='adFile'&&e.target.files[0]){ const msg=$('#adMsg'); msg.style.color='var(--muted)'; msg.textContent=t('tr_loading');
    try{ adEdit.data=readAdForm(); adEdit.data.image=await shrinkImage(e.target.files[0]); msg.textContent=''; renderAdForm(); }catch(err){ msg.style.color='var(--bad)'; msg.textContent=t('ad_imgFail'); } }
  else if(e.target.closest('#adForm')){ adEdit.data=readAdForm(); updateAdPreview(); }
});
$('#admBody').addEventListener('submit',async e=>{
  if(e.target.id!=='adForm') return; e.preventDefault();
  const a=readAdForm(), msg=$('#adMsg'), bad=m=>{ msg.style.color='var(--bad)'; msg.textContent=m; };
  if(!a.advertiser) return bad(t('ad_needAdv'));
  if(!a.title&&!a.titleAr) return bad(t('ad_needTitle'));
  if(!a.start||!a.end) return bad(t('ad_needDates'));
  if(Date.parse(a.end)<=Date.parse(a.start)) return bad(t('ad_badDates'));
  if(a.url&&!safeUrl(a.url)) a.url='https://'+a.url.replace(/^\/+/,'');
  const id=adEdit.id||('ad'+Date.now().toString(36)+Math.random().toString(36).slice(2,6));
  const data={...a, updatedAt:new Date().toISOString(), updatedBy:me?.email||''}; if(!adEdit.id){ data.createdAt=data.updatedAt; data.createdBy=data.updatedBy; }
  e.target.querySelector('button[type=submit]').disabled=true;
  try{ await store.saveAd(id,data); toast(t('ad_saved')); adEdit=null; renderAdsAdmin(); }
  catch(err){ e.target.querySelector('button[type=submit]').disabled=false; handleWriteErr(err); if(String(err?.message||'').match(/size|large|exceed/i)) bad(t('ad_tooBig')); }
});
$('#admBody').addEventListener('click',async e=>{
  const b=e.target.closest('button'); if(!b) return;
  if('adnew' in b.dataset){ adEdit={id:null,data:blankAd()}; renderAdForm(); return; }
  if(b.dataset.adedit){ const a=ads.find(x=>x._id===b.dataset.adedit); if(a){ const {_id,...d}=a; adEdit={id:_id,data:{...blankAd(),...d}}; renderAdForm(); } return; }
  if(b.dataset.adcopy){ const a=ads.find(x=>x._id===b.dataset.adcopy); if(a){ const {_id,createdAt,createdBy,...d}=a; const nb=blankAd(); adEdit={id:null,data:{...d,start:nb.start,end:nb.end,paused:false}}; renderAdForm(); } return; }
  if('adback' in b.dataset){ adEdit=null; renderAdsAdmin(); return; }
  if('adnoimg' in b.dataset){ adEdit.data=readAdForm(); adEdit.data.image=''; renderAdForm(); return; }
  if(b.dataset.adquick){ adEdit.data=readAdForm(); const s=Date.parse(adEdit.data.start)||Date.now(); adEdit.data.end=new Date(s+(+b.dataset.adquick)*864e5).toISOString(); renderAdForm(); return; }
  if(b.dataset.adpause){ const a=ads.find(x=>x._id===b.dataset.adpause); if(!a) return; b.disabled=true; const {_id,...d}=a; try{ await store.saveAd(_id,{...d,paused:!a.paused,updatedAt:new Date().toISOString(),updatedBy:me?.email||''}); toast(t(a.paused?'ad_resumed':'ad_paused')); }catch(err){ handleWriteErr(err); b.disabled=false; } return; }
  if(b.dataset.adask){ adConfirm=b.dataset.adask; renderAdsAdmin(); return; }
  if('adcancel' in b.dataset){ adConfirm=null; renderAdsAdmin(); return; }
  if(b.dataset.addel){ b.disabled=true; try{ await store.deleteAd(b.dataset.addel); adConfirm=null; toast(t('deleted')); }catch(err){ handleWriteErr(err); b.disabled=false; } return; }
},true);

/* ---------- auth ---------- */
function renderAuth(){
  const b=$('#authBtn'); if(!b) return;
  if(!store){ b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  const small=window.matchMedia('(max-width:700px)').matches;
  b.textContent = me ? t('signOut') : t(small?'signInShort':'signInBtn');
  b.classList.toggle('out', !!me);
  $('#who').textContent = me ? (me.name||me.email) : '';
  $('#adminTab').classList.toggle('hidden', !me?.isAdmin);
  if(store.mode==='demo'){
    $('#roleSel').innerHTML=['resident','provider','admin'].map(r=>`<option value="${r}" ${store.role===r?'selected':''}>${esc(t('role_'+r))}</option>`).join('');
  }
}
async function doSignIn(){
  try{ await store.signIn(); }
  catch(err){
    console.error(err);
    const c=err?.code||'';
    if(c==='auth/popup-closed-by-user'||c==='auth/cancelled-popup-request') return;
    const msg={
      'auth/unauthorized-domain':t('err_domain')+' '+location.hostname,
      'auth/operation-not-allowed':t('err_provider'),
      'auth/configuration-not-found':t('err_provider'),
      'auth/popup-blocked':t('err_popup')
    }[c] || t('signInFail')+(c?' ('+c+')':'');
    toast(msg,9000);
  }
}
$('#authBtn').addEventListener('click',()=>{ if(me) store.signOut(); else doSignIn(); });
$('#roleSel').addEventListener('change',e=>store.setRole(e.target.value));
window.matchMedia('(max-width:700px)').addEventListener?.('change',()=>renderAuth());

function onUser(u){
  me=u; admList={rows:null,busy:false,err:false}; trCache={key:'',rows:null,err:false,busy:false};
  if(unsubMine){unsubMine();unsubMine=null;} if(unsubAll){unsubAll();unsubAll=null;}
  mySub=null; allSubs=[];
  if(me) unsubMine=store.onMySub(me.uid, d=>{ mySub=d; renderMySubs(); }, err=>console.error(err));
  if(me?.isAdmin) unsubAll=store.onAllSubs(s=>{ allSubs=s; renderAdmin(); }, err=>console.error(err));
  if(!me?.isAdmin && st.tab==='admin') setTab('find');
  if(!me && st.editId) resetForm();
  renderAll();
}

/* ---------- boot ---------- */
applyLang();
$('#resultCount').textContent='…';
const loadTimer=setTimeout(()=>{ if(!ready) $('#findNotice').innerHTML=`<div class="notice">${esc(t('cantReach'))}</div>`; },10000);
(async()=>{
  try{
    store = isConfigured(config) ? await firebaseStore(config) : demoStore();
  }catch(err){
    console.error(err); clearTimeout(loadTimer); ready=true;
    $('#findNotice').innerHTML=`<div class="notice">${esc(t('loadFail'))}</div>`; $('#resultCount').textContent=''; return;
  }
  $('#demobar').classList.toggle('hidden', store.mode!=='demo');
  hitQueue.splice(0).forEach(hit); countVisit();
  let first=true;
  store.onListings(list=>{
    clearTimeout(loadTimer); $('#findNotice').innerHTML=''; ready=true;
    listings=list; renderAll();
  }, err=>{ clearTimeout(loadTimer); ready=true; console.error(err); $('#findNotice').innerHTML=`<div class="notice">${esc(t('loadFail'))}</div>`; $('#resultCount').textContent=''; });
  store.onAds(list=>{ ads=list; if(ready) renderAdTop(), renderGrid(); if(st.tab==='admin'&&st.admSec==='ads'&&!adEdit) renderAdsAdmin(); }, err=>console.error(err));
  store.onAuth(u=>{
    onUser(u);
    if(first){ first=false; const h=(location.hash||'').slice(1);
      if(h==='provide') setTab('provide'); else if(h==='admin'&&me?.isAdmin) setTab('admin'); }
  });
})();
