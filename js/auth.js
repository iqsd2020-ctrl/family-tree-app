/* auth.js
   تسجيل دخول المطور (Admin) فقط.
   - الزائر: يشاهد الشجرة العامة (قراءة فقط) بدون أدوات إدارة.
   - المطور: يسجل دخول عبر Google ويظهر له وضع الإدارة (إضافة/تعديل/حذف).
*/
(function(){
  const S = window.FTStorage;
  const C = window.FTConfig || {};
  const ADMIN_EMAILS = Array.isArray(C.ADMIN_EMAILS) ? C.ADMIN_EMAILS.map(e => String(e||"").toLowerCase()) : [];
  const PUBLIC_TREE_ID = String(C.PUBLIC_TREE_ID || "main");
  const DEV_EMAIL = String(C.DEVELOPER_EMAIL || "").toLowerCase();
  const AUTO_SIGNOUT_NON_ADMIN = (C.AUTO_SIGNOUT_NON_ADMIN !== false);

  // --- DOM ---
  const modalAuth = document.getElementById("modalAuth");
  const btnAuth = document.getElementById("btnAuth");
  const btnCloseAuth = document.getElementById("btnCloseAuth");
  const btnLoginGoogle = document.getElementById("btnLoginGoogle");
  const btnLogout = document.getElementById("btnLogout");
  const authHint = document.getElementById("authHint");
  const authError = document.getElementById("authError");
const AUTH_ICON_HTML = btnAuth ? btnAuth.innerHTML : "";
  function openModal(){
    if(!modalAuth) return;
    modalAuth.classList.add("open");
    modalAuth.setAttribute("aria-hidden", "false");
  }

  function closeModal(){
    if(!modalAuth) return;
    modalAuth.classList.remove("open");
    modalAuth.setAttribute("aria-hidden", "true");
  }

  function setError(msg){
    if(!authError) return;
    const m = String(msg || "").trim();
    if(m){
      authError.style.display = "block";
      authError.textContent = m;
    }else{
      authError.style.display = "none";
      authError.textContent = "";
    }
  }

  function setHint(msg){
    if(!authHint) return;
    authHint.textContent = String(msg || "");
  }

  function humanFirebaseError(err){
    const code = (err && (err.code || err.message)) ? String(err.code || err.message) : "";
    if(code.includes("auth/popup-closed-by-user")) return "تم إغلاق نافذة تسجيل الدخول";
    if(code.includes("auth/popup-blocked")) return "تم حظر النافذة المنبثقة. جرّب السماح بالنوافذ المنبثقة أو سيتم استخدام التحويل (Redirect).";
    if(code.includes("auth/cancelled-popup-request")) return "تم إلغاء طلب النافذة المنبثقة. جرّب مرة أخرى.";
    if(code.includes("auth/unauthorized-domain")) return "هذا النطاق غير مصرح به. أضف الدومين إلى Authorized domains داخل Firebase Authentication.";
    if(code.includes("auth/operation-not-supported-in-this-environment")) return "بيئة المتصفح الحالية لا تدعم تسجيل الدخول بالطريقة المختارة. جرّب تشغيل الموقع عبر https أو localhost.";
    if(code.includes("auth/operation-not-allowed")) return "مزود تسجيل الدخول غير مفعّل في Firebase";
    if(code.includes("auth/network-request-failed")) return "تعذر الاتصال بالشبكة";
    return "تعذر تسجيل الدخول";
  }

  function isAdminUser(u){
    if(!u) return false;
    const email = String(u.email || "").toLowerCase();
    return !!email && ADMIN_EMAILS.includes(email);
  }

  // --- Firebase Auth ---
  let _auth = null;
  let _user = null;
  let _isAdmin = false;
  let _isEditor = false;
  let _isDeveloper = false;

  // listeners
  const _listeners = [];
  let _readyResolve = null;
  const _ready = new Promise((r) => { _readyResolve = r; });

  function emit(){
    for(const cb of _listeners){
      try{ cb(_user); }catch(e){ console.error(e); }
    }
  }

  function applyAdminMode(){
    document.body.classList.toggle("is-admin", !!_isAdmin);
    document.body.classList.toggle("is-editor", !!_isEditor);

    // إعداد الشجرة العامة دائماً
    try{
      if(S && S.setTreeId) S.setTreeId(PUBLIC_TREE_ID);
    }catch(e){ console.error(e); }

    // تحديث الواجهة
    if(btnLogout){
      btnLogout.style.display = _user ? "inline-block" : "none";
    }
    if(btnLoginGoogle){
      btnLoginGoogle.style.display = _user ? "none" : "inline-block";
    }

    if(btnAuth){
      if(_user && _user.photoURL){
        btnAuth.innerHTML = "";
        const img = document.createElement("img");
        img.className = "hdr-avatar";
        img.alt = "حسابك";
        img.referrerPolicy = "no-referrer";
        const _p = String(_user.photoURL || "");
        img.src = _p + (_p.includes("?") ? "&" : "?") + "sz=96&v=" + Date.now();
        img.onerror = () => { btnAuth.innerHTML = AUTH_ICON_HTML; };
        btnAuth.appendChild(img);
      }else{
        btnAuth.innerHTML = AUTH_ICON_HTML;
      }
    }

    const isFile = (location.protocol === "file:");
    if(isFile){
      setHint("ملاحظة: يفضّل تشغيل التطبيق عبر سيرفر محلي (http://localhost) لأن تسجيل الدخول قد لا يعمل على file://");
      return;
    }

    if(_user && _isAdmin){
      setHint("تم تسجيل الدخول كمطور. أدوات الإدارة مفعّلة.");
    }else if(_user){
      setHint("تم تسجيل الدخول. أدوات التحرير مفعّلة.");
    }else{
      setHint("سجّل الدخول عبر Google للتحرير. الزائر يمكنه المشاهدة فقط.");
    }
  }

  function initAuth(){
    // تأكد أن Firebase App تم تهيئته قبل استخدام Auth
    // (كان يحدث خطأ "No Firebase App" ثم تصبح _auth = null وبالتالي تظهر رسالة "Firebase Auth غير متاح")
    try{ if(S && S.getApp) S.getApp(); }catch(_e){}

    try{
      if(S && S.getAuth) _auth = S.getAuth();
      else if(window.firebase && firebase.auth) _auth = firebase.auth();
    }catch(_e){}

    if(!_auth || !_auth.onAuthStateChanged){
      // حتى لو تعذر auth، أبقِ الشجرة العامة
      try{ if(S && S.setTreeId) S.setTreeId(PUBLIC_TREE_ID); }catch{}
      _readyResolve && _readyResolve();
      return;
    }

    // 🚫 بدون أي حفظ محلي للجلسة: اجعل الـ Auth في الذاكرة فقط
    // في compat SDK: Persistence.NONE يعني عدم حفظ الجلسة في LocalStorage/SessionStorage.
    try{
      if(_auth.setPersistence && firebase.auth && firebase.auth.Auth && firebase.auth.Auth.Persistence){
        _auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});
      }
    }catch(_e){}

    // دعم signInWithRedirect كخيار بديل (مفيد للهواتف/حظر النوافذ المنبثقة)
    try{ if(_auth.getRedirectResult) _auth.getRedirectResult().catch(()=>{}); }catch(_e){}

    _auth.onAuthStateChanged(async (u) => {
      setError("");
      _user = u || null;
      _isAdmin = isAdminUser(_user);
      _isEditor = !!_user;
      _isDeveloper = !!(_user && String(_user.email || "").toLowerCase() === DEV_EMAIL);

      applyAdminMode();
      emit();
      _readyResolve && _readyResolve();
    });
  }

  initAuth();
  applyAdminMode();

  // --- Events ---
  if(btnAuth) btnAuth.addEventListener("click", openModal);
  if(btnCloseAuth) btnCloseAuth.addEventListener("click", closeModal);

  if(btnLoginGoogle){
    btnLoginGoogle.addEventListener("click", async () => {
      setError("");
      if(!_auth) return setError("Firebase Auth غير متاح");
      try{
        const provider = new firebase.auth.GoogleAuthProvider();
        try{
          await _auth.signInWithPopup(provider);
          closeModal();
        }catch(err){
          // في بعض الأجهزة/المتصفحات قد تُحظر النافذة المنبثقة، استخدم Redirect كبديل
          const code = String(err && (err.code || err.message) || "");
          if(code.includes("auth/popup-blocked") || code.includes("auth/operation-not-supported-in-this-environment")){
            setError(humanFirebaseError(err));
            await _auth.signInWithRedirect(provider);
            return;
          }
          throw err;
        }
      }catch(err){
        setError(humanFirebaseError(err));
      }
    });
  }

  if(btnLogout){
    btnLogout.addEventListener("click", async () => {
      setError("");
      if(!_auth) return setError("Firebase Auth غير متاح");
      try{
        await _auth.signOut();
        closeModal();
      }catch(err){
        setError(humanFirebaseError(err));
      }
    });
  }

  // --- API ---
  window.FTAuth = {
    get user(){ return _user; },
    get isAdmin(){ return _isAdmin; },
    get isEditor(){ return _isEditor; },
    get isDeveloper(){ return _isDeveloper; },
    waitForAuth: () => _ready,
    onAuthChanged: (cb) => { if(typeof cb === "function") _listeners.push(cb); },
  };
})();
