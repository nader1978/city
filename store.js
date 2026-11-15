// Data layer: Firebase (live) or localStorage (demo).
// Both expose the same functions, so app.js doesn't care which is used.

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

/* UTC day id, e.g. 20261115 (the security rules check the same format) */
export const dayId = (d = new Date()) => d.toISOString().slice(0, 10).replace(/-/g, '');
/* clean a text so it can be a key in the traffic counters */
export const statKey = s => String(s || '').toLowerCase().replace(/[.~*/\[\]`$#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normEmail = e => String(e || '').trim().toLowerCase();
export const validEmail = e => EMAIL_RE.test(normEmail(e));

export function isConfigured(cfg){
  const k = cfg?.firebase?.apiKey || '';
  return !!k && !k.startsWith('PASTE');
}

/* ------------------------------------------------------------------ */
/*  FIREBASE                                                           */
/* ------------------------------------------------------------------ */
export async function firebaseStore(cfg){
  const { initializeApp } = await import(FB + 'firebase-app.js');
  const A = await import(FB + 'firebase-auth.js');
  const F = await import(FB + 'firebase-firestore.js');
  const app = initializeApp(cfg.firebase);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const owners = (cfg.adminEmails || []).map(normEmail);
  const toUser = async u => {
    if (!u) return null;
    const email = normEmail(u.email), ok = !!email && u.emailVerified;
    const isOwner = ok && owners.includes(email);
    let isAdmin = isOwner;
    if (ok && !isAdmin) { try { isAdmin = (await F.getDoc(F.doc(db, 'admins', email))).exists(); } catch (e) { isAdmin = false; } }
    return { uid: u.uid, email, name: u.displayName || email, isAdmin, isOwner };
  };
  const inc = o => { const r = {}; for (const k in o) r[k] = (o[k] && typeof o[k] === 'object') ? inc(o[k]) : F.increment(o[k]); return r; };
  const now = () => new Date().toISOString();

  return {
    mode: 'firebase',
    owners,
    onAuth: cb => A.onAuthStateChanged(auth, async u => cb(await toUser(u))),
    signIn: () => A.signInWithPopup(auth, new A.GoogleAuthProvider()),
    signOut: () => A.signOut(auth),

    onListings: (cb, err) => F.onSnapshot(F.collection(db, 'listings'),
      s => cb(s.docs.map(d => ({ _id: d.id, ...d.data() }))), err),
    onMySub: (uid, cb, err) => F.onSnapshot(F.doc(db, 'submissions', uid),
      s => cb(s.exists() ? s.data() : null), err),
    onAllSubs: (cb, err) => F.onSnapshot(F.collection(db, 'submissions'),
      s => cb(s.docs.map(d => ({ _id: d.id, ...d.data() }))), err),

    setListing: (id, data) => F.setDoc(F.doc(db, 'listings', id), data),
    deleteListing: id => F.deleteDoc(F.doc(db, 'listings', id)),
    // merge a patch into submissions/{uid}.items.{id}
    patchItem: (uid, id, patch, meta = {}) => F.setDoc(F.doc(db, 'submissions', uid),
      { ...meta, items: { [id]: patch }, updatedAt: now() }, { merge: true }),
    deleteItem: (uid, id) => F.updateDoc(F.doc(db, 'submissions', uid),
      { ['items.' + id]: F.deleteField(), updatedAt: now() }),

    /* admins (any Google account an admin adds) */
    listAdmins: async () => (await F.getDocs(F.collection(db, 'admins'))).docs.map(d => ({ email: d.id, ...d.data() })),
    addAdmin: (email, by) => F.setDoc(F.doc(db, 'admins', normEmail(email)), { addedBy: by || '', addedAt: now() }),
    removeAdmin: email => F.deleteDoc(F.doc(db, 'admins', normEmail(email))),

    /* adverts */
    onAds: (cb, err) => F.onSnapshot(F.collection(db, 'ads'), s => cb(s.docs.map(d => ({ _id: d.id, ...d.data() }))), err),
    saveAd: (id, data) => F.setDoc(F.doc(db, 'ads', id), data),
    deleteAd: id => F.deleteDoc(F.doc(db, 'ads', id)),

    /* traffic counters: one document per day, numbers only go up */
    hit: o => F.setDoc(F.doc(db, 'stats', dayId()), inc(o), { merge: true }),
    getStats: async (from, to) => (await F.getDocs(F.query(F.collection(db, 'stats'),
      F.where(F.documentId(), '>=', from), F.where(F.documentId(), '<=', to)))).docs.map(d => ({ id: d.id, ...d.data() }))
  };
}

/* ------------------------------------------------------------------ */
/*  DEMO (localStorage)                                                */
/* ------------------------------------------------------------------ */
const KEY = 'csg-demo-v1';
const SAMPLES = {
  'sample-permits': { kind:'Public service', category:'gov', name:'Building Permits Office (Sample)', nameAr:'مكتب تصاريح البناء (نموذج)',
    description:'SAMPLE LISTING. Apply for new building permits, renovation approvals and completion certificates.',
    descriptionAr:'خدمة نموذجية. التقديم على تصاريح البناء الجديدة وموافقات الترميم وشهادات الإنجاز.',
    area:'Downtown', address:'Municipality Building, Ground Floor', phone:'+971 4 000 0000', email:'permits@example.gov',
    website:'https://example.gov/permits', hours:'Sun–Thu 7:30–14:30', fees:'From 250 AED depending on project size',
    requirements:'Emirates ID copy\nTitle deed or tenancy contract\nApproved drawings (PDF)', tags:'permit, construction, renovation, تصريح, بناء, ترميم' },
  'sample-pharmacy': { kind:'Shop', category:'health', name:'Al Noor 24h Pharmacy (Sample)', nameAr:'صيدلية النور ٢٤ ساعة (نموذج)',
    description:'SAMPLE LISTING. Open 24 hours. Prescriptions, baby care, home delivery within the district.',
    descriptionAr:'خدمة نموذجية. مفتوحة على مدار الساعة. صرف الوصفات، مستلزمات الأطفال، وتوصيل للمنازل.',
    area:'Al Rashidiya', address:'Main Street, next to the park', phone:'+971 4 000 0001', whatsapp:'+971 50 000 0001',
    hours:'Open 24 hours', tags:'medicine, delivery, صيدلية, دواء, توصيل' },
  'sample-plumber': { kind:'Business', category:'home', name:'QuickFix Plumbing & Electrical (Sample)', nameAr:'كويك فيكس للسباكة والكهرباء (نموذج)',
    description:'SAMPLE LISTING. Leak repairs, water heaters, AC drain cleaning and electrical fixes. Same-day visits.',
    descriptionAr:'خدمة نموذجية. إصلاح التسريبات، سخانات المياه، تنظيف تصريف المكيفات، وأعمال الكهرباء.',
    area:'Al Rashidiya', phone:'+971 50 000 0002', whatsapp:'+971 50 000 0002', hours:'Daily 8:00–22:00',
    fees:'Visit charge 100 AED, waived if repair is booked', tags:'plumber, electrician, سباك, كهربائي, صيانة' },
  'sample-water': { kind:'Public service', category:'utilities', name:'Water & Electricity Customer Centre (Sample)', nameAr:'مركز خدمة عملاء الماء والكهرباء (نموذج)',
    description:'SAMPLE LISTING. New connections, move-in/move-out, bill payment and complaints.',
    descriptionAr:'خدمة نموذجية. التوصيلات الجديدة، تفعيل وإلغاء الخدمة عند الانتقال، دفع الفواتير، والشكاوى.',
    area:'Downtown', address:'Service Centre, Block B', phone:'+971 4 000 0003', website:'https://example.gov/utilities',
    hours:'Sun–Thu 8:00–20:00, Sat 8:00–14:00', requirements:'Emirates ID\nTenancy contract or title deed', tags:'water, electricity, bill, ماء, كهرباء, فاتورة' }
};
const DEMO_USERS = {
  resident: null,
  provider: { uid:'demo-provider', email:'provider@demo', name:'Demo Provider', isAdmin:false },
  admin:    { uid:'demo-admin',    email:'admin@demo',    name:'Demo Admin',    isAdmin:true, isOwner:true }
};

export function demoStore(){
  const load = () => {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.listings) return s; } catch(e){}
    const at = new Date().toISOString(), listings = {};
    Object.entries(SAMPLES).forEach(([id, l]) => listings[id] = { ...l, approvedAt: at });
    return { listings, submissions: {}, role: 'resident', admins: {}, stats: {}, ads: {} };
  };
  let S = load();
  const L = { auth:new Set(), listings:new Set(), all:new Set(), mine:new Map(), ads:new Set() };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){} emit(); };
  const user = () => DEMO_USERS[S.role] || null;
  const listingsArr = () => Object.entries(S.listings).map(([id, v]) => ({ _id:id, ...v }));
  const adsArr = () => Object.entries(S.ads || {}).map(([id, v]) => ({ _id:id, ...v }));
  const subsArr = () => Object.entries(S.submissions).map(([id, v]) => ({ _id:id, ...v }));
  function emit(){
    L.listings.forEach(cb => cb(listingsArr()));
    L.ads.forEach(cb => cb(adsArr()));
    L.all.forEach(cb => cb(subsArr()));
    L.mine.forEach((uid, cb) => cb(S.submissions[uid] ? structuredClone(S.submissions[uid]) : null));
  }
  window.addEventListener('storage', e => { if (e.key === KEY){ S = load(); emit(); L.auth.forEach(cb => cb(user())); } });
  const sub = (set, cb, val) => { set.add(cb); setTimeout(() => cb(val()), 0); return () => set.delete(cb); };
  const deepMerge = (a, b) => { for (const k in b){ if (b[k] && typeof b[k]==='object' && !Array.isArray(b[k])) a[k] = deepMerge(a[k] || {}, b[k]); else a[k] = b[k]; } return a; };
  const guardAdmin = () => { if (!user()?.isAdmin) throw { code:'permission-denied' }; };

  return {
    mode: 'demo',
    get role(){ return S.role; },
    setRole(r){ S.role = r; save(); L.auth.forEach(cb => cb(user())); },
    onAuth: cb => sub(L.auth, cb, user),
    signIn: async () => { if (S.role === 'resident'){ S.role = 'provider'; save(); L.auth.forEach(cb => cb(user())); } },
    signOut: async () => { S.role = 'resident'; save(); L.auth.forEach(cb => cb(user())); },

    onListings: cb => sub(L.listings, cb, listingsArr),
    onMySub: (uid, cb) => { L.mine.set(cb, uid); setTimeout(() => cb(S.submissions[uid] ? structuredClone(S.submissions[uid]) : null), 0); return () => L.mine.delete(cb); },
    onAllSubs: cb => sub(L.all, cb, subsArr),

    setListing: async (id, data) => { guardAdmin(); S.listings[id] = data; save(); },
    deleteListing: async id => { guardAdmin(); delete S.listings[id]; save(); },
    patchItem: async (uid, id, patch, meta = {}) => {
      const u = user(); if (!u || (u.uid !== uid && !u.isAdmin)) throw { code:'permission-denied' };
      S.submissions[uid] = deepMerge(S.submissions[uid] || {}, { ...meta, items:{ [id]: patch }, updatedAt:new Date().toISOString() }); save();
    },
    deleteItem: async (uid, id) => {
      const u = user(); if (!u || (u.uid !== uid && !u.isAdmin)) throw { code:'permission-denied' };
      if (S.submissions[uid]?.items) delete S.submissions[uid].items[id]; save();
    },
    owners: ['admin@demo'],
    onAds: cb => sub(L.ads, cb, adsArr),
    saveAd: async (id, data) => { guardAdmin(); S.ads = S.ads || {}; S.ads[id] = data; save(); },
    deleteAd: async id => { guardAdmin(); if (S.ads) delete S.ads[id]; save(); },
    listAdmins: async () => { guardAdmin(); return Object.entries(S.admins || {}).map(([email, v]) => ({ email, ...v })); },
    addAdmin: async (email, by) => { guardAdmin(); S.admins = S.admins || {}; S.admins[normEmail(email)] = { addedBy: by || '', addedAt: new Date().toISOString() }; save(); },
    removeAdmin: async email => { guardAdmin(); if (S.admins) delete S.admins[normEmail(email)]; save(); },
    hit: async o => { S.stats = S.stats || {}; const id = dayId(); S.stats[id] = S.stats[id] || {};
      const add = (t, src) => { for (const k in src) { if (src[k] && typeof src[k] === 'object') { t[k] = t[k] || {}; add(t[k], src[k]); } else t[k] = (t[k] || 0) + src[k]; } };
      add(S.stats[id], o); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){} },
    getStats: async (from, to) => { guardAdmin(); return Object.entries(S.stats || {}).filter(([id]) => id >= from && id <= to).map(([id, v]) => ({ id, ...v })); }
  };
}
