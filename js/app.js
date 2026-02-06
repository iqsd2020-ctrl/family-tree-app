/* app.js
   تطبيق شجرة العائلة (إضافة/تعديل/حذف + صور مصغرة + حفظ ومزامنة Firestore)

   أهم التحسينات:
   - دعم تسجيل دخول المطور (FTAuth) لإظهار وضع الإدارة (الزائر قراءة فقط).
   - مزامنة لحظية (onSnapshot) عبر FTStorage.subscribe.
   - منع حفظ حلقي عند تطبيق تحديثات قادمة من Firestore.
*/
(async function(){
  const S = window.FTStorage;
  const U = window.FTUtils;
  const Auth = window.FTAuth;

  if(!S || !U){
    alert("تعذر تشغيل التطبيق: ملفات JS الأساسية مفقودة");
    return;
  }

  const { load, save, clear, subscribe } = S;

  function isAdmin(){ return !!(Auth && Auth.isAdmin); }
  function isEditor(){ return !!(Auth && (Auth.isEditor || Auth.user)); }

  function requireAdmin(){
    if(isAdmin()) return true;
    alert("هذه العملية متاحة للمطور فقط");
    return false;
  }

  function requireEditor(){
    if(isEditor()) return true;
    alert("سجّل الدخول عبر Google أولاً");
    return false;
  }

  function subtreeHasDevSigned(node){
    if(!node) return false;
    if(node.devSigned) return true;
    if(Array.isArray(node.children)){
      for(const ch of node.children){
        if(subtreeHasDevSigned(ch)) return true;
      }
    }
    return false;
  }



  // --- بيانات افتراضية (يمكن إعادة الضبط إليها) ---
  const SAMPLE = U.normalizeTree({
    name: "الجد المؤسس",
    title: "عميد الأسرة",
    desc: "عاش في القرن التاسع عشر، أسس العائلة في المنطقة.",
    children: [
      {
        name: "صالح",
        title: "تاجر",
        children: [{ name: "علي" }, { name: "عمر" }, { name: "خالد" }]
      },
      {
        name: "سعاد",
        title: "معلمة",
        children: [{ name: "هدى" }, { name: "منى" }]
      },
      {
        name: "عبدالله",
        title: "شاعر",
        children: [
          { name: "فيصل", children: [{ name: "أحمد" }, { name: "سلطان" }] }
        ]
      }
    ]
  });

  // --- عناصر DOM ---
  const treeRootEl = document.getElementById("treeRoot");
  const container = document.getElementById("container");
 if(container) container.style.transformOrigin = "0 0";
   const viewport = document.getElementById("viewport");
  const syncStatusEl = document.getElementById("syncStatus");
const loadingOverlay = document.getElementById("loadingOverlay");
  // Search (بحث ذكي في الهيدر)
  const headerSearch = document.getElementById("headerSearch");
  const hdrSearchInput = document.getElementById("hdrSearchInput");
  const hdrSearchClear = document.getElementById("hdrSearchClear");
  const hdrSearchResults = document.getElementById("hdrSearchResults");

  // Controls
  const btnZoomIn = document.getElementById("btnZoomIn");
  const btnZoomOut = document.getElementById("btnZoomOut");
  const btnResetView = document.getElementById("btnResetView");
  const btnCenterRoot = document.getElementById("btnCenterRoot");
  const btnAddRootChild = document.getElementById("btnAddRootChild");
  const btnManage = document.getElementById("btnManage");

  // Details modal
  const modalDetails = document.getElementById("modalDetails");
  const mName = document.getElementById("mName");
  const mTitle = document.getElementById("mTitle");
  const mDates = document.getElementById("mDates");
  const mDesc = document.getElementById("mDesc");
  const mPhoto = document.getElementById("mPhoto");
  const btnCloseDetails = document.getElementById("btnCloseDetails");
  const btnAddChild = document.getElementById("btnAddChild");
  const btnAddParentRoot = document.getElementById("btnAddParentRoot");
  const btnEditPerson = document.getElementById("btnEditPerson");
  const btnDevSign = document.getElementById("btnDevSign");
  const btnDeletePerson = document.getElementById("btnDeletePerson");
  const btnCenterPerson = document.getElementById("btnCenterPerson");

  // Form modal
  const modalForm = document.getElementById("modalForm");
  const fTitle = document.getElementById("fTitle");
  const fName = document.getElementById("fName");
  const fRole = document.getElementById("fRole");
  const fDesc = document.getElementById("fDesc");
  const fPhoto = document.getElementById("fPhoto");
  const fPhotoPreview = document.getElementById("fPhotoPreview");
  const photoHint = document.getElementById("photoHint");
  const fCardColor = document.getElementById("fCardColor");
  const fBirthDate = document.getElementById("fBirthDate");
  const fDeathDate = document.getElementById("fDeathDate");
  const btnSavePerson = document.getElementById("btnSavePerson");
  const btnCancelForm = document.getElementById("btnCancelForm");

  // Crop modal (قصّ الصورة)
  const modalCrop = document.getElementById("modalCrop");
  const cropFrame = document.getElementById("cropFrame");
  const cropImg = document.getElementById("cropImg");
  const cropZoom = document.getElementById("cropZoom");
  const cropSize = document.getElementById("cropSize");
  const cropSizeHint = document.getElementById("cropSizeHint");
  const btnCropApply = document.getElementById("btnCropApply");
  const btnCropCancel = document.getElementById("btnCropCancel");

  // Manage modal
  const modalManage = document.getElementById("modalManage");
  const btnCloseManage = document.getElementById("btnCloseManage");
  const btnExport = document.getElementById("btnExport");
  const btnImport = document.getElementById("btnImport");
  const btnResetData = document.getElementById("btnResetData");
  const btnAbout = document.getElementById("btnAbout");
  const fileImport = document.getElementById("fileImport");

  // Confirm modal
  const modalConfirm = document.getElementById("modalConfirm");
  const cText = document.getElementById("cText");
  const btnConfirmYes = document.getElementById("btnConfirmYes");
  const btnConfirmNo = document.getElementById("btnConfirmNo");

  // Auth modal (لإغلاقه عبر ESC / overlay)
  const modalAuth = document.getElementById("modalAuth");

  function setSync(text){
    if(!syncStatusEl) return;
    syncStatusEl.textContent = String(text || "");
  }
function showLoading(){
    if(!loadingOverlay) return;
    loadingOverlay.classList.remove("hidden");
  }

  function hideLoading(){
    if(!loadingOverlay) return;
    loadingOverlay.classList.add("hidden");
  }
  // --- حالة التطبيق ---
  let state = U.deepClone(SAMPLE);
  state = U.normalizeTree(state);

  let selectedId = state.id;      // الشخص المحدد
  let formMode = "addChild";      // addChild | edit
  let formParentId = null;        // عند الإضافة
  let pendingAction = null;       // callback for confirm
  let pendingPhotoDataUrl = "";   // من المعالجة


// --- بحث ذكي ---
let searchIndex = [];          // [{id,name,title,years,breadcrumb,normName,normTitle,tokens}]
let lastSearchResults = [];
let activeSearchIdx = -1;
let searchDebounce = null;

  // --- المزامنة ---
  let unsubRemote = null;
  let applyingRemote = false;
  let lastAppliedClientUpdatedAt = 0;
  let lastUserUid = null;

  // --- Pan & Zoom ---
  let scale = 1;
  let panning = false;
  let pointX = 0;
  let pointY = 0;
  let startX = 0;
  let startY = 0;

  // Touch (single pan + pinch zoom)
  let touchMode = "none"; // none|pan|pinch
  let lastTouchX = 0;
  let lastTouchY = 0;
  let pinchStartDist = 0;
  let pinchStartScale = 1;

  function setTransform(){
    container.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
  }

  function clampScale(v){
    return Math.min(2.2, Math.max(0.35, v));
  }

  function zoomAt(delta, centerX, centerY){
    const prev = scale;
    const next = clampScale(scale + delta);
    if(next === prev) return;

    const rect = viewport.getBoundingClientRect();

    const cRect = container.getBoundingClientRect();
    const baseX = (cRect.left - rect.left) - pointX;
    const baseY = (cRect.top - rect.top) - pointY;

    const cx = centerX ?? (rect.left + rect.width/2);
    const cy = centerY ?? (rect.top + rect.height/2);

    const vx = (cx - rect.left) - baseX;
    const vy = (cy - rect.top) - baseY;

    pointX = vx - (vx - pointX) * (next / prev);
    pointY = vy - (vy - pointY) * (next / prev);

    scale = next;
    setTransform();
  }

  function getZoomAnchor(){
    const vRect = viewport.getBoundingClientRect();
    const vCenterX = vRect.left + vRect.width / 2;
    const vCenterY = vRect.top + vRect.height / 2;

    let card = null;
    try{
      const at = document.elementFromPoint(vCenterX, vCenterY);
      card = at && at.closest ? at.closest(".card") : null;
    }catch(_e){}

    if(!card){
      const cards = Array.from(document.querySelectorAll(".card"));
      if(!cards.length) return null;

      let bestX = 0, bestY = 0, bestD = Infinity;
      for(const el of cards){
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = cx - vCenterX;
        const dy = cy - vCenterY;
        const d = dx*dx + dy*dy;
        if(d < bestD){
          bestD = d;
          bestX = cx;
          bestY = cy;
        }
      }
      return { x: bestX, y: bestY };
    }

    const r = card.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function zoomIn(){
    const a = getZoomAnchor();
    if(a) zoomAt(0.1, a.x, a.y);
    else zoomAt(0.1);
  }

  function zoomOut(){
    const a = getZoomAnchor();
    if(a) zoomAt(-0.1, a.x, a.y);
    else zoomAt(-0.1);
  }

  function centerOnElement(el){
    if(!el) return;

    const vRect = viewport.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();

    const vCenterX = vRect.left + vRect.width / 2;
    const vCenterY = vRect.top + vRect.height / 2;

    const eCenterX = eRect.left + eRect.width / 2;
    const eCenterY = eRect.top + eRect.height / 2;

    const dx = (vCenterX - eCenterX);
    const dy = (vCenterY - eCenterY) - 40;

    pointX += dx;
    pointY += dy;
    setTransform();
  }

  function resetView(){
    scale = 1;
    pointX = 0;
    pointY = 0;
    setTransform();

    requestAnimationFrame(() => {
      const cards = Array.from(document.querySelectorAll(".card"));
      if(!cards.length) return;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      const centers = cards.map(el => {
        const r = el.getBoundingClientRect();
        if(r.left < minX) minX = r.left;
        if(r.top < minY) minY = r.top;
        if(r.right > maxX) maxX = r.right;
        if(r.bottom > maxY) maxY = r.bottom;
        return {
          el,
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2
        };
      });

      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;

      let bestEl = centers[0].el;
      let bestD = Infinity;

      for(const c of centers){
        const dx = c.cx - midX;
        const dy = c.cy - midY;
        const d = dx*dx + dy*dy;
        if(d < bestD){
          bestD = d;
          bestEl = c.el;
        }
      }

      centerOnElement(bestEl);
    });
  }

  // --- بناء الشجرة ---
  function buildTree(person, isRoot=false){
    const li = document.createElement("li");

    const card = document.createElement("div");
    const colorClass = U.cardColorClass(person.cardColor);
    card.className = isRoot ? "card root" : ("card" + (colorClass ? (" " + colorClass) : ""));
    card.dataset.id = person.id;

    const avatar = document.createElement(person.photo ? "img" : "div");
    avatar.className = "avatar" + (person.photo ? "" : " placeholder");
    if(person.photo){
      avatar.src = person.photo;
      avatar.alt = "صورة";
    }else{
      avatar.textContent = U.initials(person.name);
    }

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = person.name;

    card.appendChild(avatar);
    card.appendChild(name);

    if(person.title){
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = person.title;
      card.appendChild(title);
    }

    const years = U.compactYears(person.birthDate, person.deathDate);
    if(years){
      const dates = document.createElement("div");
      dates.className = "dates";
      dates.textContent = years;
      card.appendChild(dates);
    }

    card.addEventListener("click", (e) => {
      e.stopPropagation();
      showDetails(person.id);
    });

    li.appendChild(card);

    if(person.children && person.children.length){
      const ul = document.createElement("ul");
      person.children.forEach(ch => ul.appendChild(buildTree(ch, false)));
      li.appendChild(ul);
    }

    return li;
  }

  function render(saveToRemote = true){
    treeRootEl.innerHTML = "";
    treeRootEl.appendChild(buildTree(state, true));
    highlightSelected();

    // تحديث فهرس البحث بعد أي تغيير في الشجرة
    try{ rebuildSearchIndex(); }catch(_e){}

    if(!saveToRemote) return;

    // حفظ في Firestore (بشكل Debounced)
    try{
      setSync("جارٍ الحفظ...");
      const p = save(state);
      if(p && typeof p.then === "function"){
        p.then(() => setSync("تم الحفظ"))
         .catch((err) => {
           console.error(err);
           setSync(err && err.localSaved ? "تم الحفظ محليًا" : "تعذر الحفظ");
         });
      }
    }catch(err){
      console.error(err);
      setSync(err && err.localSaved ? "تم الحفظ محليًا" : "تعذر الحفظ");
    }
  }

  function highlightSelected(){
    document.querySelectorAll(".card.selected").forEach(el => el.classList.remove("selected"));
    const el = document.querySelector(`.card[data-id="${selectedId}"]`);
    if(el) el.classList.add("selected");
  }


// --- بحث ذكي (لا يتأثر بالتشكيل/التمديد + مطابقة قريبة من المنطق العربي) ---
function rebuildSearchIndex(){
  const out = [];

  function walk(node, parents){
    if(!node) return;
    const name = node.name || '';
    const title = node.title || '';
    const years = U.compactYears(node.birthDate, node.deathDate);
    const breadcrumb = parents.length ? parents.join(' › ') : '';

    const father = parents.length ? parents[parents.length - 1] : '';
    const grand = parents.length > 1 ? parents[parents.length - 2] : '';
    const lineage = [name, father, grand].filter(Boolean).join(' ');

    const normName = (U.normalizeArabic ? U.normalizeArabic(name) : String(name));
    const normTitle = (U.normalizeArabic ? U.normalizeArabic(title) : String(title));
    const tokens = (U.tokenizeArabic ? U.tokenizeArabic(name + ' ' + title) : []);
    const normLineage = (U.normalizeArabic ? U.normalizeArabic(lineage) : String(lineage));
    const lineageTokens = (U.tokenizeArabic ? U.tokenizeArabic(lineage) : []);

    out.push({
      id: node.id,
      name,
      title,
      years,
      breadcrumb,
      normName,
      normTitle,
      tokens,
      father,
      grand,
      lineage,
      normLineage,
      lineageTokens
    });

    const nextParents = parents.concat(name).slice(-6); // لا نُطيل المسار
    if(Array.isArray(node.children)){
      for(const ch of node.children) walk(ch, nextParents);
    }
  }

  walk(state, []);
  searchIndex = out;
}

function scoreEntry(entry, qNorm, qTokens){
  if(!entry || !qNorm) return 0;
  let score = 0;

  // الاسم
  if(entry.normName === qNorm) score += 1200;
  else if(entry.normName && entry.normName.startsWith(qNorm)) score += 820;
  else if(entry.normName){
    const pos = entry.normName.indexOf(qNorm);
    if(pos >= 0) score += (560 - Math.min(260, pos));
  }

  // الاسم + الأب + الجد
  if(Array.isArray(qTokens) && qTokens.length >= 2 && entry.normLineage){
    if(entry.normLineage === qNorm) score += 1600;
    else if(entry.normLineage.startsWith(qNorm)) score += 1080;
    else {
      const pos = entry.normLineage.indexOf(qNorm);
      if(pos >= 0) score += (720 - Math.min(320, pos));
    }
  }

  // اللقب/الوظيفة
  if(entry.normTitle){
    if(entry.normTitle === qNorm) score += 240;
    else if(entry.normTitle.startsWith(qNorm)) score += 170;
    else if(entry.normTitle.includes(qNorm)) score += 120;
  }

  // مطابقة على مستوى الكلمات (Tokens)
  const srcTokens = (Array.isArray(qTokens) && qTokens.length >= 2 && Array.isArray(entry.lineageTokens))
    ? entry.lineageTokens
    : entry.tokens;

  if(Array.isArray(qTokens) && qTokens.length && Array.isArray(srcTokens)){
    for(const qt of qTokens){
      if(!qt) continue;
      let best = 0;
      for(const t of srcTokens){
        if(!t) continue;
        if(t === qt){ best = 170; break; }
        if(t.startsWith(qt) || qt.startsWith(t)) best = Math.max(best, 130);
        else if(t.includes(qt) || qt.includes(t)) best = Math.max(best, 85);
      }
      score += best;
    }
  }

  // عقوبة بسيطة للأسماء الطويلة مع تطابق ضعيف
  score -= Math.min(60, Math.floor((entry.name.length - qNorm.length) * 0.35));
  return score;
}

function doSearch(query, limit=8){
  const raw = String(query || '').trim();
  const qNorm = (U.normalizeArabic ? U.normalizeArabic(raw) : raw);
  if(!qNorm) return [];

  const qTokens = (U.tokenizeArabic ? U.tokenizeArabic(raw) : qNorm.split(/\s+/));
  const needLineage = Array.isArray(qTokens) && qTokens.length >= 2;

  function lineageStartsWith(entryTokens){
    if(!needLineage) return true;
    if(!Array.isArray(entryTokens) || entryTokens.length < qTokens.length) return false;
    for(let i=0;i<qTokens.length;i++){
      if(entryTokens[i] !== qTokens[i]) return false;
    }
    return true;
  }

  const hits = [];
  for(const e of (searchIndex || [])){
    if(needLineage && !lineageStartsWith(e.lineageTokens)) continue;
    const sc = scoreEntry(e, qNorm, qTokens);
    if(sc > 0) hits.push(Object.assign({ score: sc }, e));
  }

  hits.sort((a,b) => (b.score - a.score) || a.name.localeCompare(b.name, 'ar'));
  return hits.slice(0, Math.max(1, Math.min(12, Number(limit) || 8)));
}

function setSearchClearVisible(){
  if(!hdrSearchClear || !hdrSearchInput) return;
  const v = String(hdrSearchInput.value || '').trim();
  hdrSearchClear.style.display = v ? 'inline-flex' : 'none';
}

function closeSearchResults(){
  activeSearchIdx = -1;
  lastSearchResults = [];
  if(hdrSearchResults){
    hdrSearchResults.classList.remove('open');
    hdrSearchResults.innerHTML = '';
  }
}

function renderSearchResults(list){
  lastSearchResults = Array.isArray(list) ? list : [];
  activeSearchIdx = -1;

  if(!hdrSearchResults) return;
  hdrSearchResults.innerHTML = '';

  if(!lastSearchResults.length){
    hdrSearchResults.classList.remove('open');
    return;
  }

  for(let i=0; i<lastSearchResults.length; i++){
    const r = lastSearchResults[i];
    const item = document.createElement('div');
    item.className = 'search-item';
    item.setAttribute('role','option');
    item.dataset.id = r.id;
    item.dataset.index = String(i);

    const top = document.createElement('div');
    top.className = 'search-item-top';

    const n = document.createElement('span');
    n.className = 'search-item-name';
    const bc = String(r.breadcrumb || '');
    const bcParts = bc ? bc.split(' › ') : [];
    const father = r.father || (bcParts.length ? bcParts[bcParts.length - 1] : '');
    const grand = r.grand || (bcParts.length > 1 ? bcParts[bcParts.length - 2] : '');
    n.textContent = [r.name, father, grand].filter(Boolean).join(' ');
    top.appendChild(n);

    if(r.years){
      const y = document.createElement('span');
      y.className = 'search-item-years';
      y.textContent = r.years;
      top.appendChild(y);
    }
    item.appendChild(top);

    const metaParts = [];
    if(r.title) metaParts.push(r.title);
    if(r.breadcrumb) metaParts.push('من: ' + r.breadcrumb);
    if(metaParts.length){
      const meta = document.createElement('div');
      meta.className = 'search-item-meta';
      meta.textContent = metaParts.join(' • ');
      item.appendChild(meta);
    }

    item.addEventListener('click', (e) => {
      e.preventDefault();
      selectSearchResult(r.id);
    });

    hdrSearchResults.appendChild(item);
  }

  hdrSearchResults.classList.add('open');
}

function setActiveSearchItem(idx){
  if(!hdrSearchResults) return;
  const items = Array.from(hdrSearchResults.querySelectorAll('.search-item'));
  items.forEach(el => el.classList.remove('active'));
  if(idx >= 0 && idx < items.length){
    items[idx].classList.add('active');
    try{ items[idx].scrollIntoView({ block: 'nearest' }); }catch{}
  }
}

function flashCard(el){
  if(!el) return;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 950);
}

function selectSearchResult(id){
  closeSearchResults();
  try{ if(hdrSearchInput) hdrSearchInput.blur(); }catch(_e){}

  selectedId = id;
  highlightSelected();

  const card = document.querySelector(`.card[data-id="${id}"]`);
  if(card){
    centerOnElement(card);
    flashCard(card);
  }

  // عرض التفاصيل لتأكيد العثور على الشخص
  showDetails(id);
}

function initSearchUI(){
  if(!hdrSearchInput || !hdrSearchResults) return;

  setSearchClearVisible();

  hdrSearchInput.addEventListener('input', () => {
    setSearchClearVisible();
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      const q = hdrSearchInput.value;
      renderSearchResults(doSearch(q, 8));
    }, 70);
  });

  hdrSearchInput.addEventListener('keydown', (e) => {
    const open = hdrSearchResults.classList.contains('open');
    const max = (lastSearchResults || []).length;
    if(!open){
      if(e.key === 'Escape') hdrSearchInput.blur();
      return;
    }
    if(!max) return;

    if(e.key === 'ArrowDown'){
      e.preventDefault();
      activeSearchIdx = Math.min(max - 1, activeSearchIdx + 1);
      setActiveSearchItem(activeSearchIdx);
    }else if(e.key === 'ArrowUp'){
      e.preventDefault();
      activeSearchIdx = Math.max(0, activeSearchIdx - 1);
      setActiveSearchItem(activeSearchIdx);
    }else if(e.key === 'Enter'){
      if(activeSearchIdx >= 0 && activeSearchIdx < max){
        e.preventDefault();
        selectSearchResult(lastSearchResults[activeSearchIdx].id);
      }else if(max === 1){
        e.preventDefault();
        selectSearchResult(lastSearchResults[0].id);
      }
    }else if(e.key === 'Escape'){
      e.preventDefault();
      closeSearchResults();
    }
  });

  if(hdrSearchClear){
    hdrSearchClear.addEventListener('click', () => {
      hdrSearchInput.value = '';
      hdrSearchInput.focus();
      setSearchClearVisible();
      closeSearchResults();
    });
  }

  // إغلاق النتائج عند النقر خارج صندوق البحث
  document.addEventListener('click', (e) => {
    if(headerSearch && headerSearch.contains(e.target)) return;
    closeSearchResults();
  });
}

// تفعيل البحث
initSearchUI();

  // --- Modal helpers ---
  function openModal(modal){
    if(!modal) return;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }
  function closeModal(modal){
    if(!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  // Close on overlay click
  [modalDetails, modalForm, modalManage, modalConfirm, modalAuth].filter(Boolean).forEach(m => {
    m.addEventListener("click", (e) => { if(e.target === m) closeModal(m); });
  });

  if(modalCrop){
    modalCrop.addEventListener("click", (e) => { if(e.target === modalCrop) cancelCrop(true); });
  }

  // --- تفاصيل الشخص ---
  function showDetails(id){
    const person = U.findById(state, id);
    if(!person) return;

    selectedId = id;
    highlightSelected();

    mName.textContent = person.name;
    mTitle.textContent = person.title || "";
    const life = U.formatLifeDates(person.birthDate, person.deathDate);
    mDates.textContent = life;
    mDates.style.display = life ? "block" : "none";
    mDesc.textContent = person.desc || "لا توجد تفاصيل إضافية";

    if(person.photo){
      mPhoto.src = person.photo;
      mPhoto.style.display = "block";
    }else{
      mPhoto.src = "assets/placeholder.svg";
      mPhoto.style.display = "block";
    }

    const p = U.findById(state, id);

    const locked = !!(p && p.devSigned && !isAdmin());

    btnEditPerson.disabled = locked;
    btnEditPerson.style.opacity = locked ? "0.5" : "1";

    btnDeletePerson.disabled = (id === state.id) || locked;
    btnDeletePerson.style.opacity = ((id === state.id) || locked) ? "0.5" : "1";

    if(btnDevSign){
      if(isAdmin()) btnDevSign.style.display = "inline-block";
      else btnDevSign.style.display = "none";
      btnDevSign.disabled = !!(p && p.devSigned);
      btnDevSign.style.opacity = (p && p.devSigned) ? "0.5" : "1";
    }

    if(btnAddParentRoot){
      if(id === state.id) btnAddParentRoot.style.removeProperty("display");
      else btnAddParentRoot.style.setProperty("display", "none", "important");
    }

    openModal(modalDetails);
  }

  btnCloseDetails.addEventListener("click", () => closeModal(modalDetails));

  btnCenterPerson.addEventListener("click", () => {
    closeModal(modalDetails);
    requestAnimationFrame(() => {
      const el = document.querySelector(`.card[data-id="${selectedId}"]`);
      centerOnElement(el);
    });
  });

  btnAddChild.addEventListener("click", () => {
    if(!requireEditor()) return;
    closeModal(modalDetails);
    openAddChildForm(selectedId);
  });

  if(btnAddParentRoot){
    btnAddParentRoot.addEventListener("click", () => {
      if(!requireEditor()) return;
      if(selectedId !== state.id) return;
      closeModal(modalDetails);
      openAddParentRootForm();
    });
  }

  btnEditPerson.addEventListener("click", () => {
    if(!requireEditor()) return;
    const p = U.findById(state, selectedId);
    if(p && p.devSigned && !isAdmin()){
      alert("هذا الشخص موقّع من المطور ولا يمكن تعديله.");
      return;
    }
    closeModal(modalDetails);
    openEditForm(selectedId);
  });

  if(btnDevSign) btnDevSign.addEventListener("click", () => {
    if(!requireAdmin()) return;
    const p = U.findById(state, selectedId);
    if(!p) return;
    if(p.devSigned){
      alert("هذا الشخص موقّع بالفعل.");
      return;
    }
    p.devSigned = true;
    render(true);
    alert("تم توقيع الشخص من المطور.");
  });

  btnDeletePerson.addEventListener("click", () => {
    if(!requireEditor()) return;
    if(selectedId === state.id) return;
    const target = U.findById(state, selectedId);
    if(target && subtreeHasDevSigned(target) && !isAdmin()){
      alert("هذا الفرع يحتوي على أشخاص موقّعين من المطور ولا يمكن حذفه.");
      return;
    }
    closeModal(modalDetails);
    confirm(`سيتم حذف "${U.findById(state, selectedId)?.name || ""}" وكل فروعه. هل تريد المتابعة؟`, () => {
      const target2 = U.findById(state, selectedId);
      if(target2 && subtreeHasDevSigned(target2) && !isAdmin()){
        alert("هذا الفرع يحتوي على أشخاص موقّعين من المطور ولا يمكن حذفه.");
        return;
      }
      U.deleteById(state, selectedId);
      selectedId = state.id;
      render(true);
      requestAnimationFrame(resetView);
    });
  });

  // --- نموذج الإضافة/التعديل ---
  function resetForm(){
    fName.value = "";
    fRole.value = "";
    fDesc.value = "";
    fPhoto.value = "";
    fPhotoPreview.src = "";
    fPhotoPreview.style.display = "none";
    pendingPhotoDataUrl = "";

    if(fCardColor) fCardColor.value = "default";
    if(fBirthDate) fBirthDate.value = "";
    if(fDeathDate) fDeathDate.value = "";
  }

  function openAddChildForm(parentId){
    resetForm();
    formMode = "addChild";
    formParentId = parentId;
    fTitle.textContent = "إضافة ابن/ابنة";
    openModal(modalForm);
    setTimeout(() => fName.focus(), 60);
  }

  function openAddParentRootForm(){
    resetForm();
    formMode = "addParentRoot";
    formParentId = null;
    fTitle.textContent = "إضافة والد الجذر";
    openModal(modalForm);
    setTimeout(() => fName.focus(), 60);
  }

  function openEditForm(id){
    resetForm();
    formMode = "edit";
    formParentId = null;
    const p = U.findById(state, id);
    if(!p) return;

    fTitle.textContent = "تعديل البيانات";
    fName.value = p.name || "";
    fRole.value = p.title || "";
    fDesc.value = p.desc || "";

    if(fCardColor) fCardColor.value = p.cardColor || "default";
    if(fBirthDate) fBirthDate.value = p.birthDate || "";
    if(fDeathDate) fDeathDate.value = p.deathDate || "";

    if(p.photo){
      fPhotoPreview.src = p.photo;
      fPhotoPreview.style.display = "block";
      pendingPhotoDataUrl = p.photo;
    }
    openModal(modalForm);
    setTimeout(() => fName.focus(), 60);
  }

  // --- قصّ الصورة قبل الرفع ---
  let cropPrevPhotoDataUrl = "";
  let cropObjectUrl = "";
  let cropBaseScale = 1;
  let cropNaturalW = 0;
  let cropNaturalH = 0;
  let cropOffsetX = 0;
  let cropOffsetY = 0;
  let cropDragging = false;
  let cropDragStartX = 0;
  let cropDragStartY = 0;
  let cropDragStartOffX = 0;
  let cropDragStartOffY = 0;

  function updateCropSizeHint(){
    if(!cropSizeHint || !cropSize) return;
    const v = Number(cropSize.value || 240) || 240;
    cropSizeHint.textContent = `${v}×${v}`;
  }

  function cropClampOffsets(){
    if(!cropFrame) return;
    const V = cropFrame.getBoundingClientRect().width || 280;
    const zoom = cropZoom ? Number(cropZoom.value || 1) : 1;
    const scale = cropBaseScale * zoom;

    const scaledW = cropNaturalW * scale;
    const scaledH = cropNaturalH * scale;

    const maxX = Math.max(0, (scaledW - V) / 2);
    const maxY = Math.max(0, (scaledH - V) / 2);

    cropOffsetX = Math.min(maxX, Math.max(-maxX, cropOffsetX));
    cropOffsetY = Math.min(maxY, Math.max(-maxY, cropOffsetY));
  }

  function applyCropTransform(){
    if(!cropImg) return;
    cropClampOffsets();
    const zoom = cropZoom ? Number(cropZoom.value || 1) : 1;
    const scale = cropBaseScale * zoom;
    cropImg.style.transform = `translate(-50%, -50%) translate(${cropOffsetX}px, ${cropOffsetY}px) scale(${scale})`;
  }

  function openCropperForFile(file){
    if(!modalCrop || !cropImg || !cropFrame) return false;

    cropPrevPhotoDataUrl = pendingPhotoDataUrl || "";
    if(photoHint) photoHint.textContent = "اختر الجزء المطلوب ثم اضغط اعتماد.";
    if(cropZoom) cropZoom.value = "1";
    updateCropSizeHint();

    if(cropObjectUrl){ try{ URL.revokeObjectURL(cropObjectUrl); }catch{} cropObjectUrl = ""; }
    cropObjectUrl = URL.createObjectURL(file);

    openModal(modalCrop);

    // انتظر فتح النافذة ليأخذ cropFrame أبعاده الصحيحة
    requestAnimationFrame(() => {
      cropImg.onload = () => {
        cropNaturalW = cropImg.naturalWidth || 0;
        cropNaturalH = cropImg.naturalHeight || 0;

        const V = cropFrame.getBoundingClientRect().width || 280;
        const minSide = Math.min(cropNaturalW, cropNaturalH) || 1;
        cropBaseScale = V / minSide;

        cropOffsetX = 0;
        cropOffsetY = 0;
        applyCropTransform();
      };
      let triedDataUrl = false;
      cropImg.onerror = () => {
        if(!triedDataUrl && file){
          triedDataUrl = true;
          const fr = new FileReader();
          fr.onload = () => { cropImg.src = String(fr.result || ""); };
          fr.onerror = () => {
            cancelCrop(true);
            alert("تعذر قراءة الصورة. جرّب صورة أخرى بصيغة JPG/PNG.");
          };
          fr.readAsDataURL(file);
          return;
        }

        cancelCrop(true);
        const ext = (file && file.name ? file.name.split(".").pop().toLowerCase() : "");
        const type = (file && file.type ? file.type.toLowerCase() : "");
        if(type === "image/heic" || type === "image/heif" || ext === "heic" || ext === "heif"){
          alert("صيغة الصورة HEIC/HEIF غير مدعومة في هذا المتصفح. رجاءً حوّلها إلى JPG أو PNG ثم أعد المحاولة.");
        }else{
          alert("تعذر تحميل الصورة. جرّب صورة بصيغة JPG/PNG.");
        }
      };
      cropImg.src = cropObjectUrl;
    });

    return true;
  }

  function cancelCrop(restore){
    if(restore){
      pendingPhotoDataUrl = cropPrevPhotoDataUrl || "";
      if(pendingPhotoDataUrl){
        fPhotoPreview.src = pendingPhotoDataUrl;
        fPhotoPreview.style.display = "block";
      }else{
        fPhotoPreview.src = "";
        fPhotoPreview.style.display = "none";
      }
    }

    if(cropImg) cropImg.src = "";
    if(cropObjectUrl){ try{ URL.revokeObjectURL(cropObjectUrl); }catch{} cropObjectUrl = ""; }

    closeModal(modalCrop);
    if(fPhoto) fPhoto.value = "";
    cropDragging = false;

    if(photoHint) photoHint.textContent = "سيتم حفظ الصورة في Firestore كملف Base64. سيتم ضغطها تلقائياً لتكون صغيرة.";
  }

  async function applyCrop(){
    if(!cropImg || !cropFrame) return;
    try{
      if(photoHint) photoHint.textContent = "جارٍ ضغط الصورة...";
      btnSavePerson.disabled = true;
      if(btnCropApply) btnCropApply.disabled = true;
      if(btnCropCancel) btnCropCancel.disabled = true;

      const V = cropFrame.getBoundingClientRect().width || 280;
      const outSize = Number(cropSize && cropSize.value || 240) || 240;
      const zoom = cropZoom ? Number(cropZoom.value || 1) : 1;
      const scale = cropBaseScale * zoom;

      cropClampOffsets();

      const cx = (V/2) + cropOffsetX;
      const cy = (V/2) + cropOffsetY;

      const scaledW = cropNaturalW * scale;
      const scaledH = cropNaturalH * scale;

      const imgLeft = cx - (scaledW / 2);
      const imgTop = cy - (scaledH / 2);

      const srcX = (0 - imgLeft) / scale;
      const srcY = (0 - imgTop) / scale;
      const srcW = V / scale;
      const srcH = V / scale;

      const canvas = document.createElement("canvas");
      canvas.width = outSize;
      canvas.height = outSize;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0,0,outSize,outSize);
      ctx.drawImage(cropImg, srcX, srcY, srcW, srcH, 0, 0, outSize, outSize);

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => {
          if(!b) return reject(new Error("تعذر تجهيز الصورة"));
          resolve(b);
        }, "image/jpeg", 0.92);
      });

      const dataUrl = await U.processImageFile(blob, outSize, 0.86, 280*1024, 110*1024);

      pendingPhotoDataUrl = dataUrl;
      fPhotoPreview.src = dataUrl;
      fPhotoPreview.style.display = "block";

      cancelCrop(false);
    }catch(err){
      alert(err.message || "تعذر معالجة الصورة");
      cancelCrop(true);
    }finally{
      btnSavePerson.disabled = false;
      if(btnCropApply) btnCropApply.disabled = false;
      if(btnCropCancel) btnCropCancel.disabled = false;
    }
  }

  if(cropZoom) cropZoom.addEventListener("input", applyCropTransform);
  if(cropSize) cropSize.addEventListener("input", updateCropSizeHint);

  if(cropFrame){
    cropFrame.addEventListener("pointerdown", (e) => {
      if(!modalCrop || !modalCrop.classList.contains("open")) return;
      cropDragging = true;
      try{ cropFrame.setPointerCapture(e.pointerId); }catch{}
      cropDragStartX = e.clientX;
      cropDragStartY = e.clientY;
      cropDragStartOffX = cropOffsetX;
      cropDragStartOffY = cropOffsetY;
    });
    cropFrame.addEventListener("pointermove", (e) => {
      if(!cropDragging) return;
      cropOffsetX = cropDragStartOffX + (e.clientX - cropDragStartX);
      cropOffsetY = cropDragStartOffY + (e.clientY - cropDragStartY);
      applyCropTransform();
    });
    cropFrame.addEventListener("pointerup", (e) => {
      cropDragging = false;
      try{ cropFrame.releasePointerCapture(e.pointerId); }catch{}
    });
    cropFrame.addEventListener("pointercancel", (e) => {
      cropDragging = false;
      try{ cropFrame.releasePointerCapture(e.pointerId); }catch{}
    });
  }

  if(btnCropCancel) btnCropCancel.addEventListener("click", () => cancelCrop(true));
  if(btnCropApply) btnCropApply.addEventListener("click", applyCrop);

  fPhoto.addEventListener("change", async () => {
    const file = fPhoto.files && fPhoto.files[0];
    if(!file) return;

    // إن لم تتوفر نافذة القص لأي سبب، ارجع للطريقة القديمة (ضغط مباشر)
    if(!openCropperForFile(file)){
      try{
        if(photoHint) photoHint.textContent = "جارٍ ضغط الصورة...";
        btnSavePerson.disabled = true;
        const dataUrl = await U.processImageFile(file, 240, 0.86, 280*1024, 110*1024);
        pendingPhotoDataUrl = dataUrl;
        fPhotoPreview.src = dataUrl;
        fPhotoPreview.style.display = "block";
      }catch(err){
        alert(err.message || "تعذر معالجة الصورة");
        fPhoto.value = "";
      }finally{
        btnSavePerson.disabled = false;
        if(photoHint) photoHint.textContent = "سيتم حفظ الصورة في Firestore كملف Base64. سيتم ضغطها تلقائياً لتكون صغيرة.";
      }
    }
  });

  btnCancelForm.addEventListener("click", () => closeModal(modalForm));

  btnSavePerson.addEventListener("click", async () => {
    if(!requireEditor()) return;
    const name = String(fName.value || "").trim();
    if(!name){
      alert("الاسم مطلوب");
      fName.focus();
      return;
    }
    const title = String(fRole.value || "").trim();
    const desc = String(fDesc.value || "").trim();
    const photo = pendingPhotoDataUrl || "";

    const cardColor = fCardColor ? String(fCardColor.value || "default") : "default";
    const birthDate = fBirthDate ? String(fBirthDate.value || "") : "";
    const deathDate = fDeathDate ? String(fDeathDate.value || "") : "";

    const dateErr = U.validateDates(birthDate, deathDate);
    if(dateErr){
      alert(dateErr);
      return;
    }

    if(formMode === "addChild"){
      const parent = U.findById(state, formParentId);
      if(!parent){ alert("تعذر إيجاد الأب/الأم"); return; }
      if(!Array.isArray(parent.children)) parent.children = [];
      parent.children.push(U.normalizeTree({ id: U.uid(), name, title, desc, photo, cardColor, birthDate, deathDate, children: [] }));
      selectedId = parent.children[parent.children.length - 1].id;
      render(true);
      closeModal(modalForm);
      requestAnimationFrame(() => showDetails(selectedId));
    }else if(formMode === "addParentRoot"){
      const oldRoot = state;
      state = U.normalizeTree({ id: U.uid(), name, title, desc, photo, cardColor, birthDate, deathDate, children: [oldRoot] });
      selectedId = state.id;
      render(true);
      closeModal(modalForm);
      requestAnimationFrame(() => showDetails(selectedId));
    }else{
      const cur = U.findById(state, selectedId);
      if(cur && cur.devSigned && !isAdmin()){
        alert("هذا الشخص موقّع من المطور ولا يمكن تعديله.");
        return;
      }
      const ok = U.updateById(state, selectedId, { name, title, desc, photo, cardColor, birthDate, deathDate });
      if(!ok){ alert("تعذر التعديل"); return; }
      render(true);
      closeModal(modalForm);
      requestAnimationFrame(() => showDetails(selectedId));
    }
  });

  // --- إدارة ---
  btnManage.addEventListener("click", () => { if(!requireAdmin()) return; openModal(modalManage); });
  btnCloseManage.addEventListener("click", () => closeModal(modalManage));

  btnExport.addEventListener("click", () => {
    if(!requireAdmin()) return;
    const payload = (S && S.exportPayload) ? S.exportPayload(state) : U.deepClone(state);
    const filename = `family-tree-${new Date().toISOString().slice(0,10)}.json`;
    U.downloadJson(filename, payload);
  });

  btnImport.addEventListener("click", () => { if(!requireAdmin()) return; fileImport.click(); });
  fileImport.addEventListener("change", async () => {
    if(!requireAdmin()) return;
    const file = fileImport.files && fileImport.files[0];
    if(!file) return;
    try{
      const text = await file.text();
      const raw = JSON.parse(text);
      const imported = (S && S.importPayload) ? S.importPayload(raw) : raw;
      const normalized = U.normalizeTree(imported);
      if(!normalized || !normalized.id) throw new Error("ملف غير صالح");

      // حسب المتطلبات: عند استيراد JSON من المطور يجب حذف الوثائق السابقة بالكامل
      try{ await clear(); }catch(_e){}

      state = normalized;
      selectedId = state.id;
      render(true);
      closeModal(modalManage);
      requestAnimationFrame(resetView);
      alert("تم الاستيراد بنجاح. سيتم بناء الوثائق الجديدة على Firestore.");
    }catch(err){
      alert("فشل الاستيراد: " + (err.message || "خطأ غير معروف"));
    }finally{
      fileImport.value = "";
    }
  });

  btnResetData.addEventListener("click", () => {
    if(!requireAdmin()) return;
    confirm("سيتم مسح البيانات الحالية وإعادة الشجرة الافتراضية. هل تريد المتابعة؟", async () => {
      state = U.deepClone(SAMPLE);
      state = U.normalizeTree(state);
      selectedId = state.id;
      try{ await clear(); }catch(_e){}
      render(true);
      closeModal(modalManage);
      requestAnimationFrame(resetView);
    });
  });

  btnAbout.addEventListener("click", () => {
    alert("تطبيق شجرة العائلة يعمل داخل المتصفح مع حفظ البيانات على Firestore (بدون أي حفظ محلي).\n\n- قراءة عامة للزوار\n- تعديل/إدارة للمطور فقط\n- كل شخص وثيقة مستقلة داخل Firestore\n- الصور تُضغط تلقائياً ثم تُحفظ كنص Base64 في وثيقة صورة مرتبطة بالشخص\n- مزامنة لحظية");
  });

  // --- تأكيد ---
  function confirm(text, onYes){
    cText.textContent = text;
    pendingAction = onYes;
    openModal(modalConfirm);
  }
  btnConfirmNo.addEventListener("click", () => { pendingAction = null; closeModal(modalConfirm); });
  btnConfirmYes.addEventListener("click", async () => {
    if(!requireAdmin()) return;
    const fn = pendingAction;
    pendingAction = null;
    closeModal(modalConfirm);
    if(typeof fn === "function"){
      try{
        const r = fn();
        if(r && typeof r.then === "function") await r;
      }catch(err){
        console.error(err);
        alert(err.message || "حدث خطأ أثناء تنفيذ العملية");
      }
    }
  });

  // --- Pan & Zoom events ---
  btnZoomIn.addEventListener("click", zoomIn);
  btnZoomOut.addEventListener("click", zoomOut);
  btnResetView.addEventListener("click", resetView);
  if(btnCenterRoot){
    btnCenterRoot.addEventListener("click", () => {
      const rootCard = document.querySelector(`.card[data-id="${state.id}"]`);
      centerOnElement(rootCard);
    });
  }
  btnAddRootChild.addEventListener("click", () => { if(!requireEditor()) return; openAddChildForm(state.id); });

  // Mouse pan
  viewport.addEventListener("mousedown", (e) => {
    if(e.button !== 0) return;
    panning = true;
    viewport.classList.add("is-gesturing");
    startX = e.clientX - pointX;
    startY = e.clientY - pointY;
    viewport.style.cursor = "grabbing";
  });

  viewport.addEventListener("mousemove", (e) => {
    if(!panning) return;
    e.preventDefault();
    pointX = e.clientX - startX;
    pointY = e.clientY - startY;
    setTransform();
  });

  function endMousePan(){
    panning = false;
    viewport.classList.remove("is-gesturing");
    viewport.style.cursor = "grab";
  }
  viewport.addEventListener("mouseup", endMousePan);
  viewport.addEventListener("mouseleave", endMousePan);

  // Wheel zoom
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = (e.deltaY > 0) ? -0.08 : 0.08;
    zoomAt(delta, e.clientX, e.clientY);
  }, { passive: false });

  // Touch: pan + pinch
  viewport.addEventListener("touchstart", (e) => {
    viewport.classList.add("is-gesturing");
    if(e.touches.length === 1){
      touchMode = "pan";
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    }else if(e.touches.length === 2){
      touchMode = "pinch";
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist = Math.hypot(dx, dy);
      pinchStartScale = scale;
    }
  }, { passive: true });

  viewport.addEventListener("touchmove", (e) => {
    if(touchMode === "pan" && e.touches.length === 1){
      e.preventDefault();
      const cx = e.touches[0].clientX;
      const cy = e.touches[0].clientY;
      pointX += (cx - lastTouchX);
      pointY += (cy - lastTouchY);
      setTransform();
      lastTouchX = cx;
      lastTouchY = cy;
    }else if(touchMode === "pinch" && e.touches.length === 2){
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / (pinchStartDist || dist);
      const nextScale = clampScale(pinchStartScale * ratio);

      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;

      const prev = scale;
      scale = nextScale;

      const rect = viewport.getBoundingClientRect();

      const cRect = container.getBoundingClientRect();
      const baseX = (cRect.left - rect.left) - pointX;
      const baseY = (cRect.top - rect.top) - pointY;

      const vx = (mx - rect.left) - baseX;
      const vy = (my - rect.top) - baseY;

      pointX = vx - (vx - pointX) * (scale / prev);
      pointY = vy - (vy - pointY) * (scale / prev);

      setTransform();
    }
  }, { passive: false });

  viewport.addEventListener("touchend", (e) => {
    if(e.touches.length === 0){
      touchMode = "none";
      viewport.classList.remove("is-gesturing");
    }
    if(e.touches.length === 1){
      touchMode = "pan";
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    }
  });

  viewport.addEventListener("touchcancel", () => {
    touchMode = "none";
    viewport.classList.remove("is-gesturing");
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape"){
      [modalDetails, modalForm, modalManage, modalConfirm, modalAuth].filter(Boolean).forEach(closeModal);
      if(modalCrop && modalCrop.classList.contains("open")) cancelCrop(true);
    }
  });

  // --- تشغيل وربط المزامنة ---
  async function bootForCurrentTree(){
    if(unsubRemote){ try{ unsubRemote(); }catch{} unsubRemote = null; }
    applyingRemote = false;
    lastAppliedClientUpdatedAt = 0;

    showLoading();
    setSync("تحميل...");

    let loaded = null;
    try{
      loaded = await load();
    }catch(err){
      console.error("Firestore load failed", err);
    }

    if(!loaded){
      if(isAdmin()){
        loaded = U.deepClone(SAMPLE);
        try{ await save(loaded); }catch(_e){}
      }else{
        loaded = U.normalizeTree({ name: "شجرة العائلة", title: "", desc: "لا توجد بيانات بعد. يرجى التواصل مع المطور لإضافة الشجرة.", children: [] });
      }
    }

    state = U.normalizeTree(loaded);
    selectedId = state.id;

    // ارسم بدون حفظ إضافي (البيانات إما جاءت من Firestore أو تم حفظ العينة أعلاه)
    render(false);
    resetView();
    hideLoading();

    // ابدأ المزامنة اللحظية
    unsubRemote = subscribe((remoteTree, meta) => {
      if(!remoteTree){
        setSync(meta && meta.fromCache ? "محلي" : "لا توجد بيانات");
        return;
      }

      const remoteClientUpdatedAt = Number(meta && meta.clientUpdatedAt || 0);
      if(remoteClientUpdatedAt && remoteClientUpdatedAt <= lastAppliedClientUpdatedAt){
        setSync(meta && meta.fromCache ? "متصل (محلي)" : "متصل");
        return;
      }

      lastAppliedClientUpdatedAt = remoteClientUpdatedAt || Date.now();

      if(applyingRemote) return;
      applyingRemote = true;

      const prevSelected = selectedId;
      const prevScale = scale, prevX = pointX, prevY = pointY;

      state = U.normalizeTree(remoteTree);
      selectedId = U.findById(state, prevSelected) ? prevSelected : state.id;
      render(false);

      // حافظ على موضع العرض الحالي
      scale = prevScale; pointX = prevX; pointY = prevY; setTransform();

      applyingRemote = false;
      setSync(meta && meta.fromCache ? "متصل (محلي)" : "متصل");
    }, (err) => {
      console.error(err);
      setSync("خطأ مزامنة");
    });

    // تحديث حالة الصلاحيات (قراءة فقط / مطور)
    setSync(isAdmin() ? "متصل • مطور" : (isEditor() ? "متصل • محرر" : "متصل • قراءة فقط"));
  }

  // انتظر حالة Auth (لإظهار وضع المطور عند تسجيل الدخول)
  try{ if(Auth && Auth.waitForAuth) await Auth.waitForAuth(); }catch{}

  await bootForCurrentTree();

  // عند تغيّر حالة الدخول: فقط حدّث الشارة (بدون إعادة ربط الشجرة)
  if(Auth && Auth.onAuthChanged){
    Auth.onAuthChanged(() => {
      setSync(isAdmin() ? "متصل • مطور" : (isEditor() ? "متصل • محرر" : "متصل • قراءة فقط"));
    });
  }

})();
