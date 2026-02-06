/* storage.js
   ربط التخزين مع Firestore + مزامنة لحظية + (اختياري) ربط الشجرة بالمستخدم عند تسجيل الدخول

   ملاحظة مهمة: الصور تُحفظ في Firestore كـ Base64 (كنص داخل وثيقة "ملف")
   وليس كصورة في Firebase Storage.

   الهيكل:
   - familyTrees/{treeId}
       { tree: <الشجرة بدون الصور>, schemaVersion, updatedAt, clientUpdatedAt, ownerUid }
   - familyTrees/{treeId}/files/{personId}
       { base64, mime, name, bytes, updatedAt, clientUpdatedAt }
*/
(function(){
  const C = window.FTConfig || {};
  const PUBLIC_TREE_ID = (C.PUBLIC_TREE_ID || "main");

  // --- Firebase config (حسب بياناتك) ---
  const firebaseConfig = {
    apiKey: "AIzaSyDjFRpCoLs48wfLPwCd4DDJON948wC9swk",
    authDomain: "clan-9afa3.firebaseapp.com",
    projectId: "clan-9afa3",
    storageBucket: "clan-9afa3.firebasestorage.app",
    messagingSenderId: "98783718879",
    appId: "1:98783718879:web:61915dd8ad82d26599e86a",
    measurementId: "G-FQDES1815B"
  };

  const TREE_ID_KEY = "familyTree.firestore.treeId.v1";

  // --- وضع الضيف (بدون Firestore): تخزين محلي ---
  // نخزّن الشجرة (بما فيها الصور كـ DataURL) داخل LocalStorage.
  // الهدف: تجنّب خطأ الصلاحيات عند قواعد Firestore التي تتطلب تسجيل الدخول.
  const LOCAL_TREE_PREFIX = "familyTree.local.tree.v1.";
  const LOCAL_EVENT_NAME = "FTLocalTreeChanged";

  // --- حالة داخلية ---
  let _inited = false;
  let _app = null;
  let _db = null;
  let _auth = null;
  let _treeId = null;
  let _knownPhotoIds = new Set();

  // Debounce للحفظ لتقليل عدد الكتابات
  let _saveTimer = null;
  let _savePending = null; // آخر بيانات
  let _savePromise = null;
  let _saveResolve = null;
  let _saveReject = null;

  function uid(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  }

  function ensureLocalTreeId(){
    let id = localStorage.getItem(TREE_ID_KEY);
    if(!id){
      id = uid();
      localStorage.setItem(TREE_ID_KEY, id);
    }
    return id;
  }

  function init(){
    if(_inited) return;

    if(!window.firebase || !firebase.initializeApp){
      throw new Error("Firebase SDK غير محمّل. تأكد من وجود سكربتات Firebase في index.html");
    }

    // لا تكرر initializeApp إن كان التطبيق مهيأ مسبقاً
    if(firebase.apps && firebase.apps.length){
      _app = firebase.app();
    }else{
      _app = firebase.initializeApp(firebaseConfig);
    }

    try{
      // Analytics قد يفشل على file:// أو بدون HTTPS
      if(firebase.analytics) firebase.analytics();
    }catch(_e){}

    _db = firebase.firestore();

    // Persistence (اختياري) لتحسين التجربة عند انقطاع الانترنت
    // يجب استدعاؤه مبكراً وقبل بدء الاستماع/القراءة المكثفة.
    try{
      if(_db.enablePersistence){
        _db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
      }
    }catch(_e){}

    // Auth (اختياري) — إن لم يتم تحميل firebase-auth-compat.js سيبقى null
    try{
      if(firebase.auth) _auth = firebase.auth();
    }catch(_e){}

    // اجعل الشجرة العامة الافتراضية للجميع
    if(!_treeId) _treeId = PUBLIC_TREE_ID;

    // افتراضي: شجرة عامة واحدة للجميع
    _treeId = ensureLocalTreeId();

    _inited = true;
  }

  // --- اختيار مصدر التخزين ---
  // Firestore: فقط عند تسجيل الدخول (request.auth موجود)
  function isAuthed(){
    try{ return !!(_auth && _auth.currentUser && _auth.currentUser.uid); }catch{ return false; }
  }

  function useFirestore(){
    // الشجرة عامة للقراءة للجميع (Firestore Rules تتحكم بالكتابة)
    return true;
  }

  // --- LocalStorage backend (Guest) ---
  function localKey(){
    init();
    return LOCAL_TREE_PREFIX + (_treeId || ensureLocalTreeId());
  }

  function localRead(){
    try{
      const raw = localStorage.getItem(localKey());
      if(!raw) return null;
      const obj = JSON.parse(raw);
      if(obj && obj.tree) return obj;
    }catch(_e){}
    return null;
  }

  function localWrite(tree){
    const payload = { tree: tree, clientUpdatedAt: Date.now() };
    try{
      localStorage.setItem(localKey(), JSON.stringify(payload));
    }catch(e){
      console.error("Local save failed", e);
      throw e;
    }

    // بثّ إشعار (لنفس التبويب) لتحديث subscribe المحلي
    try{
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT_NAME, { detail: { treeId: _treeId } }));
    }catch(_e){}

    return payload;
  }

  function localRemove(){
    try{ localStorage.removeItem(localKey()); }catch(_e){}
    try{
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT_NAME, { detail: { treeId: _treeId } }));
    }catch(_e){}
  }

  function getApp(){ init(); return _app; }
  function getDb(){ init(); return _db; }
  function getAuth(){ init(); return _auth; }

  function setTreeId(id){
    init();
    const next = (id && String(id).trim()) ? String(id).trim() : PUBLIC_TREE_ID;
    const changed = next !== _treeId;
    _treeId = next;
    if(changed){
      _knownPhotoIds = new Set();
    }
    return _treeId;
  }

  function treeDocRef(){
    init();
    return _db.collection("familyTrees").doc(_treeId);
  }

  function filesColRef(){
    return treeDocRef().collection("files");
  }

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

  function walkTree(node, fn){
    if(!node || typeof node !== "object") return;
    fn(node);
    if(Array.isArray(node.children)){
      for(const ch of node.children) walkTree(ch, fn);
    }
  }

  function stripPhotosForFirestore(tree){
    // نسخة آمنة للحفظ بدون صور داخل الشجرة (الصور تُحفظ كـ "ملفات" منفصلة)
    const clone = JSON.parse(JSON.stringify(tree));
    walkTree(clone, (p) => {
      const has = !!(p.photo && typeof p.photo === "string" && p.photo.startsWith("data:"));
      if(has) p.photoFileId = p.id;
      else p.photoFileId = "";
      delete p.photo;
    });
    return clone;
  }

  function collectPhotoFiles(tree){
    const out = new Map();
    walkTree(tree, (p) => {
      if(!p || !p.id) return;
      if(p.photo && typeof p.photo === "string" && p.photo.startsWith("data:")){
        const parsed = extractDataUrl(p.photo);
        if(parsed && parsed.base64){
          out.set(p.id, {
            id: p.id,
            mime: parsed.mime || "image/jpeg",
            base64: parsed.base64,
            name: (p.name ? String(p.name).trim() : "") || "photo",
            bytes: approximateBytesFromBase64(parsed.base64)
          });
        }
      }
    });
    return out;
  }

  function mergeTreeWithFiles(treeWithoutPhotos, filesMap){
    const merged = JSON.parse(JSON.stringify(treeWithoutPhotos));
    walkTree(merged, (p) => {
      const img = filesMap.get(p.id);
      if(img) p.photo = img;
      else p.photo = "";
      if(p.photoFileId) delete p.photoFileId;
    });
    return merged;
  }

  async function load(){
    init();

    // وضع الضيف: تخزين محلي (بدون Firestore)
    if(!useFirestore()){
      const payload = localRead();
      return (payload && payload.tree) ? payload.tree : null;
    }

    const ref = treeDocRef();
    const snap = await ref.get();
    if(!snap.exists) return null;

    const data = snap.data() || {};
    const tree = data.tree;
    if(!tree) return null;

    // حمّل كل "الملفات" (Base64) وألصقها بالشجرة كـ DataURL للعرض
    const filesSnap = await filesColRef().get();
    const fileMap = new Map();
    const ids = new Set();

    filesSnap.forEach(docSnap => {
      const f = docSnap.data() || {};
      if(f.base64 && f.mime){
        fileMap.set(docSnap.id, makeDataUrl(f.mime, f.base64));
        ids.add(docSnap.id);
      }
    });

    _knownPhotoIds = ids;
    return mergeTreeWithFiles(tree, fileMap);
  }

  async function _saveNowFirestore(tree){
    init();

    const ref = treeDocRef();
    const filesRef = filesColRef();

    const photoFiles = collectPhotoFiles(tree);
    const newPhotoIds = new Set(photoFiles.keys());

    const cleanTree = stripPhotosForFirestore(tree);

    const batch = _db.batch();

    const user = (_auth && _auth.currentUser) ? _auth.currentUser : null;

    // الشجرة (بدون الصور)
    batch.set(ref, {
      tree: cleanTree,
      schemaVersion: 1,
      ownerUid: user ? user.uid : "",
      clientUpdatedAt: Date.now(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // ملفات الصور
    for(const [personId, f] of photoFiles.entries()){
      // حماية بسيطة من تجاوز حجم الوثيقة (1MiB)
      if(f.bytes > 700 * 1024){
        throw new Error("حجم الصورة بعد الضغط كبير جداً لهذا النوع من التخزين. جرّب صورة أصغر.");
      }

      batch.set(filesRef.doc(personId), {
        base64: f.base64,
        mime: f.mime,
        name: f.name,
        bytes: f.bytes,
        clientUpdatedAt: Date.now(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    // حذف ملفات لم تعد موجودة
    for(const oldId of _knownPhotoIds){
      if(!newPhotoIds.has(oldId)){
        batch.delete(filesRef.doc(oldId));
      }
    }

    await batch.commit();
    _knownPhotoIds = newPhotoIds;
  }

  async function _saveNowLocal(tree){
    init();
    localWrite(tree);
  }

  function save(tree){
    // Debounce: كل استدعاء خلال فترة قصيرة يستبدل السابق
    _savePending = tree;

    if(!_savePromise){
      _savePromise = new Promise((resolve, reject) => {
        _saveResolve = resolve;
        _saveReject = reject;
      });
    }

    if(_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
      const payload = _savePending;
      _savePending = null;
      _saveTimer = null;

      try{
        if(useFirestore()) await _saveNowFirestore(payload);
        else await _saveNowLocal(payload);
        if(_saveResolve) _saveResolve(true);
      }catch(err){
        console.error("Firestore save failed", err);
        if(_saveReject) _saveReject(err);
      }finally{
        _savePromise = null;
        _saveResolve = null;
        _saveReject = null;
      }
    }, 650);

    return _savePromise;
  }

  async function clear(){
    init();

    if(!useFirestore()){
      localRemove();
      _knownPhotoIds = new Set();
      return;
    }

    const ref = treeDocRef();
    const filesRef = filesColRef();

    // احذف كل ملفات الصور أولاً
    const snap = await filesRef.get();
    const batch = _db.batch();
    snap.forEach(d => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();

    _knownPhotoIds = new Set();
  }

  /**
   * subscribe(onData, onError)
   * مزامنة لحظية عبر onSnapshot. تعيد دالة unsubscribe.
   *
   * onData(mergedTree|null, meta)
   * meta = { exists, fromCache, clientUpdatedAt, updatedAt, treeId }
   */
  function subscribe(onData, onError){
    init();

    // وضع الضيف: مزامنة محلية بسيطة (بين التبويبات)
    if(!useFirestore()){
      let stopped = false;

      const emit = () => {
        if(stopped) return;
        const payload = localRead();
        const exists = !!(payload && payload.tree);
        const meta = {
          exists,
          fromCache: true,
          clientUpdatedAt: exists ? Number(payload.clientUpdatedAt || 0) : 0,
          updatedAt: null,
          treeId: _treeId
        };
        try{
          if(typeof onData === "function") onData(exists ? payload.tree : null, meta);
        }catch(e){
          if(typeof onError === "function") onError(e);
          else console.error(e);
        }
      };

      const onLocalEvt = (e) => {
        if(stopped) return;
        // إن تغيّرت شجرة أخرى، تجاهل
        if(e && e.detail && e.detail.treeId && e.detail.treeId !== _treeId) return;
        emit();
      };

      const onStorage = (e) => {
        if(stopped) return;
        if(e && e.key === localKey()) emit();
      };

      // بثّ أولي
      emit();

      window.addEventListener(LOCAL_EVENT_NAME, onLocalEvt);
      window.addEventListener("storage", onStorage);

      return () => {
        stopped = true;
        try{ window.removeEventListener(LOCAL_EVENT_NAME, onLocalEvt); }catch{}
        try{ window.removeEventListener("storage", onStorage); }catch{}
      };
    }

    const ref = treeDocRef();
    const filesRef = filesColRef();

    let lastTree = null;
    let lastMeta = { exists: false, fromCache: false, clientUpdatedAt: 0, updatedAt: null, treeId: _treeId };
    let filesMap = new Map();
    let haveFiles = false;

    function emit(){
      if(typeof onData !== "function") return;
      if(!lastTree){
        onData(null, lastMeta);
        return;
      }
      const merged = mergeTreeWithFiles(lastTree, filesMap);
      onData(merged, lastMeta);
    }

    const unsubTree = ref.onSnapshot((snap) => {
      if(!snap.exists){
        lastTree = null;
        lastMeta = { exists: false, fromCache: snap.metadata?.fromCache || false, clientUpdatedAt: 0, updatedAt: null, treeId: _treeId };
        emit();
        return;
      }
      const data = snap.data() || {};
      lastTree = data.tree || null;
      lastMeta = {
        exists: true,
        fromCache: snap.metadata?.fromCache || false,
        clientUpdatedAt: Number(data.clientUpdatedAt || 0) || 0,
        updatedAt: data.updatedAt || null,
        treeId: _treeId
      };
      emit();
    }, (err) => {
      if(typeof onError === "function") onError(err);
      else console.error(err);
    });

    const unsubFiles = filesRef.onSnapshot((snap) => {
      const m = new Map();
      const ids = new Set();
      snap.forEach(docSnap => {
        const f = docSnap.data() || {};
        if(f.base64 && f.mime){
          m.set(docSnap.id, makeDataUrl(f.mime, f.base64));
          ids.add(docSnap.id);
        }
      });
      filesMap = m;
      haveFiles = true;
      _knownPhotoIds = ids;
      emit();
    }, (err) => {
      if(typeof onError === "function") onError(err);
      else console.error(err);
    });

    return () => {
      try{ unsubTree && unsubTree(); }catch{}
      try{ unsubFiles && unsubFiles(); }catch{}
    };
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

    // افتراضي: رقم شجرة محلي للضيف (غير مزامن)
    get localTreeId(){ return ensureLocalTreeId(); },
    // رقم الشجرة الحالي (قد يكون uid عند تسجيل الدخول)
    get currentTreeId(){ init(); return _treeId || ensureLocalTreeId(); },

    KEY: TREE_ID_KEY
  };
})();
