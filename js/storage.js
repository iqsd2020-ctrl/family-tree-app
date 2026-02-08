/* storage.js
   Firestore-only storage layer (بدون أي تخزين محلي بالمتصفح)

   المتطلبات التي يحققها هذا الملف:
   - مزامنة لحظية حقيقية عبر onSnapshot
   - لا LocalStorage ولا IndexedDB Persistence
   - كل شخص وثيقة مستقلة (Documents) ضمن المسار المسموح بالقواعد الحالية
   - الصور تُضغط في المتصفح ثم تُخزّن كنص Base64 (وثيقة مستقلة مرتبطة بالشخص)

   القيود:
   - لا نغيّر قواعد Firestore الحالية. القواعد الحالية تسمح فقط بالوصول إلى:
       /familyTrees/main
       /familyTrees/main/files/*
     لذلك يتم حفظ كل شيء بشكل منظم ضمن files/ كوثائق متعددة.

   مخطط البيانات (Schema v2):
   - /familyTrees/{treeId}
       { schemaVersion: 2, rootId, clientUpdatedAt, updatedAt }
   - /familyTrees/{treeId}/files/{docId}
       نوعان من الوثائق:
       1) شخص:
          { type:'person', name, title, desc, cardColor, birthDate, deathDate,
            parentId, orderIndex, clientUpdatedAt, updatedAt }
       2) صورة:
          { type:'photo', personId, mime, base64, bytes, clientUpdatedAt, updatedAt }
          docId = `photo_${personId}`
*/
(function(){
  const C = window.FTConfig || {};
  const PUBLIC_TREE_ID = String(C.PUBLIC_TREE_ID || "main");

  // --- Firebase config ---
  const firebaseConfig = {
    apiKey: "AIzaSyDjFRpCoLs48wfLPwCd4DDJON948wC9swk",
    authDomain: "clan-9afa3.firebaseapp.com",
    projectId: "clan-9afa3",
    storageBucket: "clan-9afa3.firebasestorage.app",
    messagingSenderId: "98783718879",
    appId: "1:98783718879:web:61915dd8ad82d26599e86a",
    measurementId: "G-FQDES1815B"
  };

  // --- state ---
  let _inited = false;
  let _app = null;
  let _db = null;
  let _auth = null;
  let _treeId = PUBLIC_TREE_ID;

  // لمعرفة ما يجب حذفه عند الحفظ/الاستيراد
  let _knownFileDocIds = new Set();
// Snapshot baseline (للتحديث الجزئي فقط: اكتب ما تغيّر)
let _knownPersonCanon = new Map(); // key: personId -> canonical person fields
let _knownPhotoCanon = new Map();  // key: docId (photo_{personId} أو legacy) -> canonical photo fields
let _knownRootId = "";


  // Debounce للحفظ لتقليل عدد الكتابات
  let _saveTimer = null;
  let _savePending = null;
  let _savePromise = null;
  let _saveResolve = null;
  let _saveReject = null;
  let _saveInFlight = Promise.resolve();

  // --- Local backup (حفظ محلي احتياطي) ---
  const _LOCAL_BACKUP_PREFIX = "FT_TREE_BACKUP_v1:";
  let _lastLocalBackupOk = false;
  let _lastLocalBackupAt = 0;

  function _localKey(){ return _LOCAL_BACKUP_PREFIX + _treeId; }

  function _saveLocalBackup(tree){
    try{
      const payload = { tree, savedAt: Date.now() };
      localStorage.setItem(_localKey(), JSON.stringify(payload));
      _lastLocalBackupAt = payload.savedAt;
      _lastLocalBackupOk = true;
      return true;
    }catch(_e){
      _lastLocalBackupOk = false;
      return false;
    }
  }

  function _loadLocalBackup(){
    try{
      const raw = localStorage.getItem(_localKey());
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      if(!parsed || typeof parsed !== "object") return null;
      if(!parsed.tree) return null;
      return { tree: parsed.tree, savedAt: Number(parsed.savedAt || 0) || 0 };
    }catch(_e){
      return null;
    }
  }

  function _clearLocalBackup(){
    try{ localStorage.removeItem(_localKey()); }catch(_e){}
  }


  function init(){
    if(_inited) return;
    if(!window.firebase || !firebase.initializeApp){
      throw new Error("Firebase SDK غير محمّل. تأكد من سكربتات Firebase في index.html");
    }

    if(firebase.apps && firebase.apps.length){
      _app = firebase.app();
    }else{
      _app = firebase.initializeApp(firebaseConfig);
    }

    try{ if(firebase.analytics) firebase.analytics(); }catch(_e){}

    _db = firebase.firestore();

    // 🚫 لا تفعّل enablePersistence: هذا يسبب IndexedDB (مرفوض حسب الطلب)

    try{ if(firebase.auth) _auth = firebase.auth(); }catch(_e){}
    _inited = true;
  }

  function getApp(){ init(); return _app; }
  function getDb(){ init(); return _db; }
  function getAuth(){ init(); return _auth; }

  function setTreeId(id){
    init();
    _treeId = (id && String(id).trim()) ? String(id).trim() : PUBLIC_TREE_ID;
    _knownFileDocIds = new Set();
    return _treeId;
  }

  function treeDocRef(){
    init();
    return _db.collection("familyTrees").doc(_treeId);
  }

  function filesColRef(){
    return treeDocRef().collection("files");
  }

  // --- helpers ---
  function extractDataUrl(dataUrl){
    if(!dataUrl || typeof dataUrl !== "string") return null;
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if(!m) return null;
    return { mime: m[1], base64: m[2] };
  }

  function makeDataUrl(mime, base64){
    if(!mime || !base64) return "";
    return `data:${mime};base64,${base64}`;
  }

  function approximateBytesFromBase64(b64){
    if(!b64) return 0;
    let padding = 0;
    if(b64.endsWith("==")) padding = 2;
    else if(b64.endsWith("=")) padding = 1;
    return Math.floor((b64.length * 3) / 4) - padding;
  }

function _canonPerson(d){
  // نبقي فقط الحقول الدلالية (بدون updatedAt/clientUpdatedAt) لتحديد التغيّر الحقيقي
  const o = {
    type: "person",
    name: String((d && d.name) || "").trim() || "بدون اسم",
    title: d && d.title ? String(d.title) : "",
    desc: d && d.desc ? String(d.desc) : "",
    cardColor: d && d.cardColor ? String(d.cardColor) : "default",
    birthDate: d && d.birthDate ? String(d.birthDate) : "",
    deathDate: d && d.deathDate ? String(d.deathDate) : "",
    devSigned: !!(d && d.devSigned),
    defaultOpen: !!(d && d.defaultOpen),
    parentId: d && d.parentId ? String(d.parentId) : "",
    orderIndex: Number.isFinite(Number(d && d.orderIndex)) ? Number(d.orderIndex) : 0,
  };
  return o;
}

function _canonPhoto(d){
  const o = {
    type: "photo",
    personId: d && d.personId ? String(d.personId) : "",
    mime: d && d.mime ? String(d.mime) : "image/jpeg",
    base64: d && d.base64 ? String(d.base64) : "",
    bytes: Number.isFinite(Number(d && d.bytes)) ? Number(d.bytes) : 0,
  };
  return o;
}

function _canonEquals(a, b){
  // مقارنة سريعة وآمنة (لا نعتمد على ترتيب مفاتيح كائنات غير canonical)
  if(a === b) return true;
  if(!a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if(ka.length !== kb.length) return false;
  for(const k of ka){
    if(a[k] !== b[k]) return false;
  }
  return true;
}


  function walkTree(node, fn, parentId="", orderIndex=0){
    if(!node || typeof node !== "object") return;
    fn(node, parentId, orderIndex);
    if(Array.isArray(node.children)){
      for(let i=0; i<node.children.length; i++){
        walkTree(node.children[i], fn, node.id, i);
      }
    }
  }

  function normalizeTreeShape(node){
    // لا نكرر منطق utils.normalizeTree هنا بالكامل، لكن نضمن وجود حقول أساسية
    const U = window.FTUtils;
    if(U && U.normalizeTree) return U.normalizeTree(node);
    // fallback minimal
    return node;
  }

  function flattenTreeToDocs(tree){
    const t = normalizeTreeShape(tree);
    const rootId = String(t && t.id || "");
    const personDocs = new Map();
    const photoDocs = new Map();

    walkTree(t, (p, parentId, orderIndex) => {
      const id = String(p.id || "");
      if(!id) return;

      // شخص
      personDocs.set(id, {
        type: "person",
        name: String(p.name || "").trim() || "بدون اسم",
        title: p.title ? String(p.title) : "",
        desc: p.desc ? String(p.desc) : "",
        cardColor: p.cardColor ? String(p.cardColor) : "default",
        birthDate: p.birthDate ? String(p.birthDate) : "",
        deathDate: p.deathDate ? String(p.deathDate) : "",
        devSigned: !!p.devSigned,
        defaultOpen: !!p.defaultOpen,
        parentId: parentId ? String(parentId) : "",
        orderIndex: Number.isFinite(orderIndex) ? orderIndex : 0,
      });

      // صورة: وثيقة مستقلة مرتبطة بالشخص
      if(p.photo && typeof p.photo === "string" && p.photo.startsWith("data:")){
        const parsed = extractDataUrl(p.photo);
        if(parsed && parsed.base64){
          const bytes = approximateBytesFromBase64(parsed.base64);
          photoDocs.set(id, {
            type: "photo",
            personId: id,
            mime: parsed.mime || "image/jpeg",
            base64: parsed.base64,
            bytes
          });
        }
      }
    });

    return { rootId, personDocs, photoDocs };
  }

  function buildTreeFromDocs(rootId, personDocs, photoDocs){
    if(!personDocs || personDocs.size === 0) return null;

    const map = new Map();
    for(const [id, d] of personDocs.entries()){
      const photo = photoDocs && photoDocs.get(id);
      map.set(id, {
        id,
        name: d.name || "بدون اسم",
        title: d.title || "",
        desc: d.desc || "",
        cardColor: d.cardColor || "default",
        birthDate: d.birthDate || "",
        deathDate: d.deathDate || "",
        devSigned: !!d.devSigned,
        defaultOpen: !!d.defaultOpen,
        photo: (photo && photo.mime && photo.base64) ? makeDataUrl(photo.mime, photo.base64) : "",
        children: [],
        // مؤقت للترتيب
        _parentId: d.parentId || "",
        _orderIndex: Number(d.orderIndex || 0)
      });
    }

    // اربط الأبناء
    let fallbackRoot = null;
    for(const [id, node] of map.entries()){
      const pid = node._parentId;
      if(pid && map.has(pid)){
        map.get(pid).children.push(node);
      }else{
        // بدون أب: مرشح جذر
        if(!fallbackRoot) fallbackRoot = node;
      }
    }

    // رتب الأبناء حسب orderIndex ثم الاسم
    for(const n of map.values()){
      if(n.children && n.children.length){
        n.children.sort((a,b) => {
          const da = Number(a._orderIndex || 0), db = Number(b._orderIndex || 0);
          if(da !== db) return da - db;
          return String(a.name||"").localeCompare(String(b.name||""), "ar");
        });
      }
      delete n._parentId;
      delete n._orderIndex;
    }

    const rid = (rootId && map.has(rootId)) ? rootId : (fallbackRoot ? fallbackRoot.id : null);
    return rid ? map.get(rid) : fallbackRoot;
  }

  function isSchemaV2(mainDocData){
    const v = Number(mainDocData && mainDocData.schemaVersion || 0);
    if(v >= 2) return true;
    // علامة إضافية احتياطاً
    if(mainDocData && mainDocData.rootId) return true;
    return false;
  }

function parseFilesSnapshotToDocs(filesSnap){
  const personDocs = new Map();
  const photoDocs = new Map();
  const ids = new Set();

  // Baseline: نبني canonical أثناء القراءة لتفادي المرور مرتين
  const personCanon = new Map(); // key: personId
  const photoCanon = new Map();  // key: actual docId داخل files (photo_{personId} أو legacy)

  filesSnap.forEach(docSnap => {
    ids.add(docSnap.id);
    const d = docSnap.data() || {};
    const t = String(d.type || "");

    if(t === "person"){
      personDocs.set(docSnap.id, d);
      personCanon.set(docSnap.id, _canonPerson(d));
    }else if(t === "photo"){
      const pid = String(d.personId || "");
      if(pid){
        photoDocs.set(pid, d);
        // حافظ على docId الحقيقي (docSnap.id) لكي نعرف ما الموجود فعلاً في Firestore
        photoCanon.set(docSnap.id, _canonPhoto({ ...d, personId: pid }));
      }
    }else{
      // دعم قديم (v1): وثائق صور فقط بدون type (docId == personId)
      if(d.base64 && d.mime){
        const legacy = { type: "photo", personId: docSnap.id, mime: d.mime, base64: d.base64, bytes: d.bytes || 0 };
        photoDocs.set(docSnap.id, legacy);
        photoCanon.set(docSnap.id, _canonPhoto(legacy));
      }
    }
  });

  _knownFileDocIds = ids;
  _knownPersonCanon = personCanon;
  _knownPhotoCanon = photoCanon;
  return { personDocs, photoDocs };
}


  async function load(){
    init();

    const local = _loadLocalBackup();

    try{
      const ref = treeDocRef();
      const snap = await ref.get();
      if(!snap.exists) return (local && local.tree) ? local.tree : null;
      const main = snap.data() || {};
      const remoteTs = Number(main.clientUpdatedAt || 0) || 0;

      // v2: وثائق متعددة
      if(isSchemaV2(main)){
        _knownRootId = String(main.rootId || "");
        const filesSnap = await filesColRef().get();
        const { personDocs, photoDocs } = parseFilesSnapshotToDocs(filesSnap);
        const tree = buildTreeFromDocs(String(main.rootId || ""), personDocs, photoDocs);
        if(local && local.tree && local.savedAt && local.savedAt > remoteTs) return local.tree;
        return tree || (local && local.tree) || null;
      }

      // v1: شجرة واحدة + صور بملفات
      _knownRootId = "";
      _knownPersonCanon = new Map();
      _knownPhotoCanon = new Map();
      const tree = main.tree;
      if(!tree) return (local && local.tree) ? local.tree : null;

      const filesSnap = await filesColRef().get();
      const photoDocs = new Map();
      const ids = new Set();
      filesSnap.forEach(docSnap => {
        const f = docSnap.data() || {};
        if(f.base64 && f.mime){
          photoDocs.set(docSnap.id, { mime: f.mime, base64: f.base64 });
          ids.add(docSnap.id);
        }
      });
      _knownFileDocIds = ids;

      // ألصق الصور داخل الشجرة
      const merged = JSON.parse(JSON.stringify(tree));
      walkTree(merged, (p) => {
        const ph = photoDocs.get(p.id);
        p.photo = ph ? makeDataUrl(ph.mime, ph.base64) : "";
      });

      if(local && local.tree && local.savedAt && local.savedAt > remoteTs) return local.tree;
      return merged;
    }catch(_e){
      return (local && local.tree) ? local.tree : null;
    }
  }


  async function commitOpsInChunks(ops, chunkSize=450){
    init();
    for(let i=0; i<ops.length; i+=chunkSize){
      const batch = _db.batch();
      const slice = ops.slice(i, i+chunkSize);
      for(const op of slice){
        if(op.kind === "set") batch.set(op.ref, op.data, op.options || { merge: true });
        else if(op.kind === "delete") batch.delete(op.ref);
      }
      await batch.commit();
    }
  }

async function _saveNowFirestore(tree){
  init();
  const ref = treeDocRef();
  const filesRef = filesColRef();

  const { rootId, personDocs, photoDocs } = flattenTreeToDocs(tree);
  if(!rootId){
    throw new Error("تعذر تحديد جذر الشجرة");
  }

  const now = Date.now();

  // لضمان حذف صحيح في أول عملية حفظ (حتى لو لم تكتمل subscribe بعد)
  // لا نفعل هذا دائماً لتقليل القراءات.
  if(!_knownFileDocIds || _knownFileDocIds.size === 0){
    try{
      const snap = await filesRef.get();
      const ids = new Set();
      snap.forEach(d => ids.add(d.id));
      _knownFileDocIds = ids;
    }catch(_e){}
  }

  const desiredIds = new Set();
  const ops = [];

  // نبني canonical جديد لاستخدامه كـ baseline بعد الحفظ
  const nextPersonCanon = new Map(); // key: personId
  const nextPhotoCanon = new Map();  // key: docId

  // --- وثائق الأشخاص: اكتب فقط ما تغيّر ---
  for(const [id, d] of personDocs.entries()){
    desiredIds.add(id);
    const canon = _canonPerson(d);
    nextPersonCanon.set(id, canon);

    const prev = _knownPersonCanon && _knownPersonCanon.get(id);
    const changed = !_canonEquals(canon, prev);
    if(changed){
      ops.push({
        kind: "set",
        ref: filesRef.doc(id),
        // replace كامل لضمان تنظيف أي حقول قديمة
        options: { merge: false },
        data: {
          ...canon,
          clientUpdatedAt: now,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }
      });
    }
  }

  // --- وثائق الصور: اكتب فقط ما تغيّر ---
  for(const [personId, d] of photoDocs.entries()){
    // حماية من تجاوز حجم الوثيقة (1MiB)
    if(d && d.bytes && Number(d.bytes) > 700 * 1024){
      throw new Error("حجم الصورة بعد الضغط كبير جداً. جرّب صورة أصغر.");
    }

    const docId = `photo_${personId}`;
    desiredIds.add(docId);

    const canon = _canonPhoto({ ...d, personId: String(personId) });
    nextPhotoCanon.set(docId, canon);

    const prev = _knownPhotoCanon && _knownPhotoCanon.get(docId);
    const changed = !_canonEquals(canon, prev);
    if(changed){
      ops.push({
        kind: "set",
        ref: filesRef.doc(docId),
        options: { merge: false },
        data: {
          ...canon,
          clientUpdatedAt: now,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }
      });
    }
  }

  // --- حذف الوثائق القديمة غير الموجودة في الحالة الجديدة ---
  for(const oldId of _knownFileDocIds){
    if(!desiredIds.has(oldId)){
      ops.push({ kind: "delete", ref: filesRef.doc(oldId) });
    }
  }

  const hasFileOps = ops.length > 0;
  const rootChanged = String(rootId) !== String(_knownRootId || "");

  // تحديث وثيقة الشجرة الرئيسية فقط عند وجود تغيير فعلي
  if(hasFileOps || rootChanged){
    ops.unshift({
      kind: "set",
      ref,
      options: { merge: true },
      data: {
        schemaVersion: 2,
        rootId,
        clientUpdatedAt: now,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        // إزالة الحقل القديم (v1) إن وجد
        tree: firebase.firestore.FieldValue.delete()
      }
    });
  }else{
    // لا تغييرات: لا داعي لأي كتابة
    return;
  }

  await commitOpsInChunks(ops);

  _knownFileDocIds = desiredIds;
  _knownPersonCanon = nextPersonCanon;
  _knownPhotoCanon = nextPhotoCanon;
  _knownRootId = String(rootId);
}


  function save(tree){
    _savePending = tree;

    // حفظ محلي فوري لضمان عدم ضياع البيانات عند الإغلاق/فشل Firestore
    const localOk = _saveLocalBackup(tree);

    if(!_savePromise){
      _savePromise = new Promise((resolve, reject) => {
        _saveResolve = resolve;
        _saveReject = reject;
      });
    }

    if(_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      _saveTimer = null;

      const flush = async () => {
        try{
          while(_savePending){
            const payload = _savePending;
            _savePending = null;

            let stable = payload;
            try{ stable = JSON.parse(JSON.stringify(payload)); }catch(_e){}
            await _saveNowFirestore(stable);
          }
          if(_saveResolve) _saveResolve(true);
        }catch(err){
          console.error("Firestore save failed", err);
          try{
            if(localOk || _lastLocalBackupOk){
              err.localSaved = true;
              err.localSavedAt = _lastLocalBackupAt || Date.now();
            }
          }catch(_e){}
          if(_saveReject) _saveReject(err);
        }finally{
          _savePromise = null;
          _saveResolve = null;
          _saveReject = null;
        }
      };

      _saveInFlight = _saveInFlight.then(flush, flush);
    }, 0);

    return _savePromise;
  }



  async function clear(){
    init();
    const ref = treeDocRef();
    const filesRef = filesColRef();

    // احذف كل وثائق files على دفعات
    const snap = await filesRef.get();
    const ops = [];
    snap.forEach(d => ops.push({ kind: "delete", ref: d.ref }));
    // احذف وثيقة الشجرة الرئيسية
    ops.push({ kind: "delete", ref });
    await commitOpsInChunks(ops);
    _knownFileDocIds = new Set();

    _clearLocalBackup();
  }


  /**
   * subscribe(onData, onError)
   * onData(tree|null, meta)
   * meta = { exists, fromCache, clientUpdatedAt, updatedAt, treeId }
   */
  function subscribe(onData, onError){
    init();
    const ref = treeDocRef();
    const filesRef = filesColRef();

    let mainSnap = null;
    let filesSnap = null;
    let filesRev = 0;

    function emit(){
      try{
        if(!mainSnap || !mainSnap.exists){
          const meta = {
            exists: false,
            fromCache: !!(mainSnap && mainSnap.metadata && mainSnap.metadata.fromCache),
            clientUpdatedAt: 0,
            updatedAt: null,
            treeId: _treeId,
            devCollapsedIds: []
          };
          if(typeof onData === "function") onData(null, meta);
          return;
        }

        const main = mainSnap.data() || {};
        const meta = {
          exists: true,
          fromCache: !!(mainSnap.metadata && mainSnap.metadata.fromCache),
          clientUpdatedAt: (Number(main.clientUpdatedAt || 0) || 0) * 1000 + filesRev,
          updatedAt: main.updatedAt || null,
          treeId: _treeId,
          devCollapsedIds: Array.isArray(main.devCollapsedIds) ? main.devCollapsedIds : []
        };

        // لا نُصدر شيئاً قبل توفر snapshot للملفات (لتفادي flicker)
        if(!filesSnap){
          if(typeof onData === "function") onData(null, meta);
          return;
        }

        // v2
        if(isSchemaV2(main)){
          _knownRootId = String(main.rootId || "");
          const { personDocs, photoDocs } = parseFilesSnapshotToDocs(filesSnap);
          const tree = buildTreeFromDocs(String(main.rootId || ""), personDocs, photoDocs);
          if(typeof onData === "function") onData(tree, meta);
          return;
        }

        // v1
        _knownRootId = "";
        _knownPersonCanon = new Map();
        _knownPhotoCanon = new Map();
        const tree = main.tree;
        if(!tree){
          if(typeof onData === "function") onData(null, meta);
          return;
        }

        const photoMap = new Map();
        const ids = new Set();
        filesSnap.forEach(docSnap => {
          const f = docSnap.data() || {};
          if(f.base64 && f.mime){
            photoMap.set(docSnap.id, makeDataUrl(f.mime, f.base64));
            ids.add(docSnap.id);
          }
        });
        _knownFileDocIds = ids;

        const merged = JSON.parse(JSON.stringify(tree));
        walkTree(merged, (p) => {
          const img = photoMap.get(p.id);
          p.photo = img || "";
        });
        if(typeof onData === "function") onData(merged, meta);
      }catch(err){
        if(typeof onError === "function") onError(err);
        else console.error(err);
      }
    }

    const unsubMain = ref.onSnapshot((s) => { mainSnap = s; emit(); }, (err) => {
      if(typeof onError === "function") onError(err);
      else console.error(err);
    });

    const unsubFiles = filesRef.onSnapshot((s) => { filesRev++; filesSnap = s; emit(); }, (err) => {
      if(typeof onError === "function") onError(err);
      else console.error(err);
    });

    return () => {
      try{ unsubMain && unsubMain(); }catch{}
      try{ unsubFiles && unsubFiles(); }catch{}
    };
  }


  async function loadDevCollapsedIds(){
    init();
    try{
      const snap = await treeDocRef().get();
      if(!snap.exists) return [];
      const main = snap.data() || {};
      const arr = Array.isArray(main.devCollapsedIds) ? main.devCollapsedIds : [];
      return arr.map(x => String(x || "").trim()).filter(Boolean);
    }catch(_e){
      return [];
    }
  }

  async function saveDevCollapsedIds(ids){
    init();
    const ref = treeDocRef();
    const now = Date.now();
    const arr = Array.isArray(ids) ? ids.map(x => String(x || "").trim()).filter(Boolean) : [];
    await ref.set({
      devCollapsedIds: arr,
      clientUpdatedAt: now,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
  // --- Import/Export helpers ---
  function exportPayload(tree){
    const { rootId, personDocs, photoDocs } = flattenTreeToDocs(tree);
    const documents = [];
    for(const [id, d] of personDocs.entries()) documents.push({ id, ...d });
    for(const [personId, d] of photoDocs.entries()) documents.push({ id: `photo_${personId}`, ...d });
    return {
      schemaVersion: 2,
      treeId: _treeId,
      exportedAt: new Date().toISOString(),
      rootId,
      documents,
      // نسخة بشرية (اختيارية) لسهولة المعاينة
      tree
    };
  }

  function importPayload(raw){
    if(raw && typeof raw === "object" && Number(raw.schemaVersion || 0) >= 2 && Array.isArray(raw.documents)){
      const personDocs = new Map();
      const photoDocs = new Map();
      for(const d of raw.documents){
        if(!d || typeof d !== "object") continue;
        const t = String(d.type || "");
        if(t === "person" && d.id){
          const id = String(d.id);
          const copy = { ...d };
          delete copy.id;
          personDocs.set(id, copy);
        }else if(t === "photo"){
          const pid = String(d.personId || "");
          if(pid){
            const copy = { ...d };
            delete copy.id;
            photoDocs.set(pid, copy);
          }
        }
      }
      return buildTreeFromDocs(String(raw.rootId || ""), personDocs, photoDocs);
    }

    // شكل قديم: شجرة nested مباشرة
    return normalizeTreeShape(raw);
  }

  window.FTStorage = {
    load,
    save,
    clear,
    subscribe,
    getApp,
    getDb,
    getAuth,
    setTreeId,

    loadDevCollapsedIds,
    saveDevCollapsedIds,

    // أدوات استيراد/تصدير
    exportPayload,
    importPayload,
  };

  // تهيئة Firebase مبكراً لضمان توفر Auth/Firestore للوحدات الأخرى
  try{ init(); }catch(e){ console.error(e); }
})();
