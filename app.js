// City Services Guide — app logic
import { T, CATS } from './i18n.js';
import config from './config.js';
import { isConfigured, firebaseStore, demoStore } from './store.js';

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
const st = {tab:'find', q:'', cat:'all', area:'all', editId:null, admView:'pending'};

const $ = s=>document.querySelector(s);
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
$('#langBtn').addEventListener('click',()=>{ lang=lang==='ar'?'en':'ar'; try{localStorage.setItem('csg-lang',lang);}catch(e){} applyLang(); });
function renderAll(){ renderAuth(); renderFind(); renderProvideGate(); renderMySubs(); renderAdmin(); }

/* ---------- tabs ---------- */
$('#tabs').addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(b)setTab(b.dataset.tab);});
function setTab(v){
  st.tab=v;
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
$('#chips').addEventListener('click',e=>{const b=e.target.closest('.chip');if(!b)return;st.cat=b.dataset.c;renderFind();});
$('#q').addEventListener('input',e=>{st.q=e.target.value;renderGrid();});
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
  $('#grid').innerHTML = res.map(l=>{ const nm=L(l,'name'), ds=L(l,'description'); return `
    <button class="card" data-id="${esc(l._id)}">
      <div class="meta"><span class="tag">${catIcon(l.category)} ${esc(catLabel(l.category))}</span><span class="tag kind">${esc(t('kindShort')[l.kind]||l.kind)}</span></div>
      <h3 dir="auto">${esc(nm)}</h3>
      ${ds?`<p class="desc" dir="auto">${esc(ds)}</p>`:''}
      <div class="foot">${l.area?`<span dir="auto">📍 ${esc(l.area)}</span>`:''}${l.hours?`<span dir="auto">🕒 ${esc(l.hours)}</span>`:''}<span class="verified">✔ ${esc(t('verified'))}</span></div>
    </button>`;}).join('');
}
$('#grid').addEventListener('click',e=>{const c=e.target.closest('.card');if(c)openDetail(c.dataset.id);});
function renderFind(){renderChips();renderAreas();renderGrid();}

function openDetail(id){
  const l=listings.find(x=>x._id===id); if(!l) return;
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
  $('#modal').classList.add('open');
}
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal'||e.target.closest('[data-close]'))$('#modal').classList.remove('open');});
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('#modal').classList.remove('open');});

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
  if(ok){ resetForm(); $('#formMsg').style.color='var(--ok)'; $('#formMsg').textContent=t('sent'); }
});

/* ---------- ADMIN ---------- */
const ADM_LABEL = k=>({kind:'f_kind',category:'f_category',name:'f_name',nameAr:'f_nameAr',description:'f_description',descriptionAr:'f_descriptionAr',area:'f_area',address:'f_address',mapLink:'f_mapLink',phone:'f_phone',whatsapp:'f_whatsapp',email:'f_email',website:'f_website',hours:'f_hours',fees:'f_fees',requirements:'f_requirements',tags:'f_tags'})[k];
function flatSubs(){
  const out=[]; allSubs.forEach(s=>Object.entries(s.items||{}).forEach(([id,v])=>out.push({id,owner:s._id,providerEmail:s.providerEmail,providerName:s.providerName,...v})));
  return out.sort((a,b)=>(a.submittedAt||'').localeCompare(b.submittedAt||''));
}
function renderAdmin(){
  if(!me?.isAdmin) return;
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

/* ---------- auth ---------- */
function renderAuth(){
  const b=$('#authBtn'); if(!b) return;
  if(!store){ b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  b.textContent = me ? t('signOut') : t('signInBtn');
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

function onUser(u){
  me=u;
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
  let first=true;
  store.onListings(list=>{
    clearTimeout(loadTimer); $('#findNotice').innerHTML=''; ready=true;
    listings=list; renderAll();
  }, err=>{ clearTimeout(loadTimer); ready=true; console.error(err); $('#findNotice').innerHTML=`<div class="notice">${esc(t('loadFail'))}</div>`; $('#resultCount').textContent=''; });
  store.onAuth(u=>{
    onUser(u);
    if(first){ first=false; const h=(location.hash||'').slice(1);
      if(h==='provide') setTab('provide'); else if(h==='admin'&&me?.isAdmin) setTab('admin'); }
  });
})();
