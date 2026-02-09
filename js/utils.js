/* utils.js */
(function(){
  function uid(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // fallback
    return "id-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  }

  function deepClone(obj){
    return JSON.parse(JSON.stringify(obj));
  }

  function initials(name){
    if(!name) return "؟";
    // خذ أول حرفين من أول كلمة
    const s = String(name).trim();
    if(!s) return "؟";
    const parts = s.split(/\s+/);
    const first = parts[0] || "";
    const second = parts[1] || "";
    const a = first.charAt(0);
    const b = second.charAt(0);
    return (a + b).trim() || a || "؟";
  }

  // إيجاد شخص داخل الشجرة (DFS)
  function findById(root, id){
    if(!root) return null;
    if(root.id === id) return root;
    if(root.children){
      for(const ch of root.children){
        const hit = findById(ch, id);
        if(hit) return hit;
      }
    }
    return null;
  }

  // تحديث شخص
  function updateById(root, id, patch){
    const p = findById(root, id);
    if(!p) return false;
    Object.assign(p, patch);
    return true;
  }

  // حذف شخص (مع الفرع)
  function deleteById(root, id){
    if(!root || !root.children) return false;
    const idx = root.children.findIndex(c => c.id === id);
    if(idx >= 0){
      root.children.splice(idx, 1);
      return true;
    }
    for(const ch of root.children){
      const ok = deleteById(ch, id);
      if(ok) return true;
    }
    return false;
  }

  // ضمان وجود حقول أساسية + IDs
  function normalizeTree(node){
    if(!node || typeof node !== "object") return null;
    const out = {
      id: node.id || uid(),
      name: String(node.name || "").trim() || "بدون اسم",
      title: node.title ? String(node.title) : "",
      desc: node.desc ? String(node.desc) : "",
      photo: node.photo ? String(node.photo) : "",
      // إضافات: لون البطاقة + تواريخ الولادة/الوفاة (مع الحفاظ على التوافق مع الملفات القديمة)
      cardColor: sanitizeCardColor(node.cardColor),
      birthDate: sanitizeIsoDate(node.birthDate),
      deathDate: sanitizeIsoDate(node.deathDate),
      devSigned: !!node.devSigned,
      defaultOpen: !!node.defaultOpen,
      children: Array.isArray(node.children) ? node.children.map(normalizeTree).filter(Boolean) : []
    };
    return out;
  }

  function sanitizeCardColor(v){
    const key = String(v || "default").trim();
    const allowed = new Set(["default","emerald_dark","black","gray"]);
    return allowed.has(key) ? key : "default";
  }

  function isValidIsoDate(str){
    if(!str) return false;
    const s = String(str).trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + "T00:00:00");
    // تحقق بسيط لتفادي تواريخ غير موجودة (مثال: 2023-02-31)
    if(Number.isNaN(d.getTime())) return false;
    const iso = d.toISOString().slice(0,10);
    return iso === s;
  }

  function sanitizeIsoDate(v){
    const s = String(v || "").trim();
    if(isValidIsoDate(s)) return s;
    if(/^\d+$/.test(s)) return s;
    return "";
  }

  function validateDates(birthDate, deathDate){
    const b = String(birthDate || "").trim();
    const d = String(deathDate || "").trim();

    const bIso = b && isValidIsoDate(b);
    const dIso = d && isValidIsoDate(d);
    const bNum = b && /^\d+$/.test(b);
    const dNum = d && /^\d+$/.test(d);

    if(b && !(bIso || bNum)) return "صيغة تاريخ الولادة غير صحيحة";
    if(d && !(dIso || dNum)) return "صيغة تاريخ الوفاة غير صحيحة";

    if(b && d){
      if(bIso && dIso){
        const bd = new Date(b + "T00:00:00");
        const dd = new Date(d + "T00:00:00");
        if(dd.getTime() < bd.getTime()) return "تاريخ الوفاة يجب أن يكون بعد تاريخ الولادة";
      }else if(bNum && dNum){
        const bn = Number(b);
        const dn = Number(d);
        if(dn < bn) return "تاريخ الوفاة يجب أن يكون بعد تاريخ الولادة";
      }
    }
    return "";
  }

  function cardColorClass(cardColorKey){
    switch (sanitizeCardColor(cardColorKey)){
      case "emerald_dark": return "color-emerald-dark";
      case "black": return "color-black";
      case "gray": return "color-gray";
      default: return "";
    }
  }

  function yearOf(iso){
    const s = String(iso || "").trim();
    if(!s) return "";
    if(isValidIsoDate(s)) return s.slice(0,4);
    if(/^\d+$/.test(s)) return s;
    return "";
  }

  function compactYears(birthDate, deathDate){
    const by = yearOf(birthDate);
    const dy = yearOf(deathDate);
    if(!by && !dy) return "";
    if(by && dy) return `${by}–${dy}`;
    if(by && !dy) return `${by}–`;
    return `–${dy}`;
  }

  function formatDateAr(iso){
    const s = String(iso || "").trim();
    if(!s) return "";
    if(/^\d+$/.test(s)) return s;
    if(!isValidIsoDate(s)) return "";
    try{
      const d = new Date(s + "T00:00:00");
      return new Intl.DateTimeFormat("ar-IQ", { year:"numeric", month:"long", day:"numeric" }).format(d);
    }catch{
      return s;
    }
  }

  function formatLifeDates(birthDate, deathDate){
    const b = formatDateAr(birthDate);
    const d = formatDateAr(deathDate);
    if(!b && !d) return "";
    if(b && d) return `الميلاد: ${b} — الوفاة: ${d}`;
    if(b && !d) return `الميلاد: ${b}`;
    return `الوفاة: ${d}`;
  }

  function dataUrlByteSize(dataUrl){
    if(!dataUrl) return 0;
    const idx = dataUrl.indexOf(",");
    if(idx < 0) return 0;
    const b64 = dataUrl.slice(idx + 1);
    let padding = 0;
    if(b64.endsWith("==")) padding = 2;
    else if(b64.endsWith("=")) padding = 1;
    return Math.floor((b64.length * 3) / 4) - padding;
  }

  // ضغط الصورة مهما كان حجمها: قصّ إلى مربع + ضغط تدريجي حتى <= maxBytes (مع محاولة الوصول لـ targetBytes)
  // يتم الإرجاع DataURL (jpeg) لاستخدامه مباشرة في العرض ثم تحويله/تخزينه كنص Base64 في Firestore.
  function processImageFile(file, size=200, quality=0.82, maxBytes=1024*1024, targetBytes=90*1024){
    return new Promise((resolve, reject) => {
      if(!file) return resolve("");
      if(!file.type || !file.type.startsWith("image/")){
        return reject(new Error("الملف ليس صورة"));
      }

      // استخدم ObjectURL لتجنب تحميل الملف كله Base64 في الذاكرة (مهم للصور الكبيرة)
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try{
          try{ URL.revokeObjectURL(objectUrl); }catch{}

          // crop source square once
          const w = img.width;
          const h = img.height;
          const s = Math.min(w, h);
          const sx = (w - s) / 2;
          const sy = (h - s) / 2;

          let dim = Math.max(64, Number(size) || 200);
          let qStart = Math.min(0.95, Math.max(0.2, Number(quality) || 0.82));
          const qMin = 0.35;

          let bestDataUrl = "";
          let bestBytes = Number.POSITIVE_INFINITY;

          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");

          function draw(){
            canvas.width = dim;
            canvas.height = dim;
            ctx.clearRect(0,0,dim,dim);
            ctx.drawImage(img, sx, sy, s, s, 0, 0, dim, dim);
          }

          function tryEncode(q){
            const dataUrl = canvas.toDataURL("image/jpeg", q);
            const bytes = dataUrlByteSize(dataUrl);
            if(bytes < bestBytes){
              bestBytes = bytes;
              bestDataUrl = dataUrl;
            }
            return { dataUrl, bytes };
          }

          // محاولات متعددة: خفض الجودة ثم (عند الحاجة) خفض الأبعاد
          const maxPasses = 6;
          for(let pass=0; pass<maxPasses; pass++){
            draw();

            // أولاً: حاول الوصول إلى <= maxBytes
            let q = qStart;
            let lastOk = null;
            while(q >= qMin){
              const r = tryEncode(q);
              if(r.bytes <= maxBytes){
                lastOk = r;
                // إذا وصلنا للهدف (مثال 90KB) نخرج مباشرة
                if(r.bytes <= targetBytes){
                  return resolve(r.dataUrl);
                }
              }
              q -= 0.06;
            }

            // إن حصلنا على نسخة <= maxBytes لكن ليست <= targetBytes، نرجّح أفضل نسخة ضمن <= maxBytes
            if(lastOk){
              // استمر بتمرير الجودة قليلاً أدنى من آخر جودة للوصول لـ targetBytes إن أمكن
              let q2 = Math.max(qMin, q + 0.06);
              while(q2 >= qMin){
                const r2 = tryEncode(q2);
                if(r2.bytes <= targetBytes) return resolve(r2.dataUrl);
                q2 -= 0.06;
              }
              // نكتفي بآخر نسخة صالحة تحت 1MB
              return resolve(lastOk.dataUrl);
            }

            // لا تزال أكبر من maxBytes: خفّض الأبعاد وحاول من جديد
            dim = Math.floor(dim * 0.82);
            if(dim < 96) break;
            // إعادة رفع جودة البداية قليلًا بعد خفض الأبعاد لتحسين الشكل
            qStart = Math.min(0.92, qStart + 0.08);
          }

          if(bestDataUrl){
            // أفضل محاولة (قد تكون أكبر من maxBytes في الحالات القصوى)
            if(bestBytes > maxBytes){
              return reject(new Error("تعذر ضغط الصورة لأقل من 1MB. جرّب صورة أخرى."));
            }
            return resolve(bestDataUrl);
          }
          return reject(new Error("تعذر معالجة الصورة"));
        }catch(err){
          return reject(err);
        }
      };
      img.onerror = () => {
        try{ URL.revokeObjectURL(objectUrl); }catch{}
        return reject(new Error("تعذر تحميل الصورة"));
      };
      img.src = objectUrl;
    });
  }


// --- بحث عربي ذكي: تطبيع وإزالة تشكيل وتمديد ---
// يهدف لتحسين البحث: لا يتأثر بالتشكيل (الحركات) أو الكشيدة (ـ) أو اختلاف أشكال الهمزة/التاء المربوطة.
function normalizeArabic(str){
  let s = String(str || '');

  // إزالة التمديد (الكشيدة)
  s = s.replace(/ـ/g, '');

  // إزالة التشكيل وعلامات الضبط
  s = s.replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, '');

  // توحيد أشكال الحروف الشائعة
  s = s.replace(/[أإآٱ]/g, 'ا');
  s = s.replace(/ؤ/g, 'و');
  s = s.replace(/ئ/g, 'ي');
  s = s.replace(/ى/g, 'ي');
  s = s.replace(/ة/g, 'ه');
  s = s.replace(/ء/g, '');

  // تحويل الأرقام العربية-الهندية إلى 0-9
  const map = { '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9' };
  s = s.replace(/[٠-٩]/g, (d) => map[d] || d);

  // إزالة علامات الترقيم والرموز (اترك الحروف/الأرقام/المسافات)
  s = s.replace(/[^0-9A-Za-z؀-ۿ\s]/g, ' ');

  // توحيد المسافات
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// Stem خفيف (ليس صرف عربي كامل): يفيد في تجاهل "الـ" وبعض اللواحق الشائعة
function lightStemArabic(token){
  let t = String(token || '').trim();
  if(!t) return '';

  // Prefixes
  if(t.length > 5 && t.startsWith('وال')) t = t.slice(3);
  else if(t.length > 5 && t.startsWith('بال')) t = t.slice(3);
  else if(t.length > 5 && t.startsWith('كال')) t = t.slice(3);
  else if(t.length > 5 && t.startsWith('فال')) t = t.slice(3);
  else if(t.length > 4 && t.startsWith('لل')) t = t.slice(2);

  if(t.length > 4 && t.startsWith('ال')) t = t.slice(2);

  // حرف عطف/جر واحد (و/ف/ب/ك/ل)
  if(t.length > 3 && /^[وفبكل]/.test(t)) t = t.slice(1);

  // Suffixes (الأطول أولاً)
  const suffixes = ['كما','كم','كن','هما','هم','هن','ها','نا','ات','ون','ين','ان','ه','ي','ك'];
  for(const suf of suffixes){
    if(t.length > (suf.length + 2) && t.endsWith(suf)){
      t = t.slice(0, -suf.length);
      break;
    }
  }

  // إزالة هاء التأنيث في نهاية الكلمة (بعد تطبيع ة->ه)
  if(t.length > 3 && t.endsWith('ه')) t = t.slice(0, -1);

  return t;
}

function tokenizeArabic(str){
  const norm = normalizeArabic(str);
  if(!norm) return [];
  return norm.split(/\s+/).map(lightStemArabic).filter(Boolean);
}

  function downloadJson(filename, dataObj){
    const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

// --- Toast / Snackbar (بديل alert) ---
let _lastToastKey = "";
let _lastToastAt = 0;

function ensureToastHost(){
  let host = document.getElementById("toastHost");
  if(!host){
    host = document.createElement("div");
    host.id = "toastHost";
    host.className = "toast-host";
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-relevant", "additions text");
    host.setAttribute("aria-atomic", "false");
    document.body.appendChild(host);
  }
  return host;
}

function toast(message, opts){
  const o = opts && typeof opts === "object" ? opts : {};
  const type = String(o.type || "info").toLowerCase();
  const title = String(o.title || "");
  const duration = (o.duration === 0) ? 0 : (Number(o.duration || 3200) || 3200);

  const msg = String(message || "").trim();
  if(!msg) return;

  // dedupe سريع لمنع الإزعاج عند تكرار نفس الرسالة
  const key = `${type}|${title}|${msg}`;
  const now = Date.now();
  if(key === _lastToastKey && (now - _lastToastAt) < 700) return;
  _lastToastKey = key;
  _lastToastAt = now;

  const host = ensureToastHost();

  // حد أقصى للتكديس
  while(host.children.length >= 3){
    host.removeChild(host.lastElementChild);
  }

  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");

  const icon = document.createElement("div");
  icon.className = "toast-icon";
  icon.textContent =
    type === "success" ? "✅" :
    type === "warning" ? "⚠️" :
    type === "error" ? "⛔" : "ℹ️";

  const body = document.createElement("div");
  body.className = "toast-body";

  if(title){
    const t = document.createElement("div");
    t.className = "toast-title";
    t.textContent = title;
    body.appendChild(t);
  }

  const m = document.createElement("div");
  m.className = "toast-msg";
  m.textContent = msg;
  body.appendChild(m);

  const close = document.createElement("button");
  close.className = "toast-close";
  close.type = "button";
  close.setAttribute("aria-label", "إغلاق");
  close.textContent = "×";

  let timer = null;
  let hiding = false;

  function hide(){
    if(hiding) return;
    hiding = true;
    if(timer) clearTimeout(timer);
    el.classList.add("is-hiding");
    setTimeout(() => {
      try{ el.remove(); }catch{}
    }, 180);
  }

  close.addEventListener("click", hide);
  el.addEventListener("click", (e) => {
    if(e.target === close) return;
    hide();
  });

  el.appendChild(icon);
  el.appendChild(body);
  el.appendChild(close);
  host.insertBefore(el, host.firstChild);

  if(duration > 0){
    timer = setTimeout(hide, duration);
  }
}

function toastError(message, opts){
  toast(message, Object.assign({}, opts || {}, { type: "error" }));
}
function toastSuccess(message, opts){
  toast(message, Object.assign({}, opts || {}, { type: "success" }));
}
function toastWarning(message, opts){
  toast(message, Object.assign({}, opts || {}, { type: "warning" }));
}
function toastInfo(message, opts){
  toast(message, Object.assign({}, opts || {}, { type: "info" }));
}


  window.FTUtils = {
    uid, deepClone, initials,
    findById, updateById, deleteById,
    normalizeTree,
    processImageFile,
    validateDates,
    cardColorClass,
    compactYears,
    formatLifeDates,
    normalizeArabic, lightStemArabic, tokenizeArabic,
    downloadJson,
    toast, toastInfo, toastSuccess, toastWarning, toastError
  };
})();