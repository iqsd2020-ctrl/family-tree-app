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
  function requireAdmin(){
    if(isAdmin()) return true;
    alert("هذه العملية متاحة للمطور فقط");
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
  const viewport = document.getElementById("viewport");
  const syncStatusEl = document.getElementById("syncStatus");

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
  const btnEditPerson = document.getElementById("btnEditPerson");
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

  // --- حالة التطبيق ---
  let state = U.deepClone(SAMPLE);
  state = U.normalizeTree(state);

  let selectedId = state.id;      // الشخص المحدد
  let formMode = "addChild";      // addChild | edit
  let formParentId = null;        // عند الإضافة
  let pendingAction = null;       // callback for confirm
  let pendingPhotoDataUrl = "";   // من المعالجة

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
    const cx = centerX ?? (rect.left + rect.width/2);
    const cy = centerY ?? (rect.top + rect.height/2);

    const vx = cx - rect.left;
    const vy = cy - rect.top;

    pointX = vx - (vx - pointX) * (next / prev);
    pointY = vy - (vy - pointY) * (next / prev);

    scale = next;
    setTransform();
  }

  function zoomIn(){ zoomAt(0.1); }
  function zoomOut(){ zoomAt(-0.1); }

  function centerOnElement(el){
    if(!el) return;

    const prevScale = scale, prevX = pointX, prevY = pointY;
    scale = 1; pointX = 0; pointY = 0; setTransform();

    const vRect = viewport.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();

    const vCenterX = vRect.left + vRect.width / 2;
    const vCenterY = vRect.top + vRect.height / 2;

    const eCenterX = eRect.left + eRect.width / 2;
    const eCenterY = eRect.top + eRect.height / 2;

    const dx = (vCenterX - eCenterX);
    const dy = (vCenterY - eCenterY) - 40;

    scale = prevScale; pointX = prevX; pointY = prevY; setTransform();

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
      const rootCard = document.querySelector(`.card[data-id="${state.id}"]`);
      centerOnElement(rootCard);
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

    if(!saveToRemote) return;

    // حفظ في Firestore (بشكل Debounced)
    try{
      setSync("جارٍ الحفظ...");
      const p = save(state);
      if(p && typeof p.then === "function"){
        p.then(() => setSync("تم الحفظ"))
         .catch((err) => {
           console.error(err);
           setSync("تعذر الحفظ");
         });
      }
    }catch(err){
      console.error(err);
      setSync("تعذر الحفظ");
    }
  }

  function highlightSelected(){
    document.querySelectorAll(".card.selected").forEach(el => el.classList.remove("selected"));
    const el = document.querySelector(`.card[data-id="${selectedId}"]`);
    if(el) el.classList.add("selected");
  }

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

    btnDeletePerson.disabled = (id === state.id);
    btnDeletePerson.style.opacity = (id === state.id ? "0.5" : "1");

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
    if(!requireAdmin()) return;
    closeModal(modalDetails);
    openAddChildForm(selectedId);
  });

  btnEditPerson.addEventListener("click", () => {
    if(!requireAdmin()) return;
    closeModal(modalDetails);
    openEditForm(selectedId);
  });

  btnDeletePerson.addEventListener("click", () => {
    if(!requireAdmin()) return;
    if(selectedId === state.id) return;
    closeModal(modalDetails);
    confirm(`سيتم حذف "${U.findById(state, selectedId)?.name || ""}" وكل فروعه. هل تريد المتابعة؟`, () => {
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

  fPhoto.addEventListener("change", async () => {
    const file = fPhoto.files && fPhoto.files[0];
    if(!file) return;
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
  });

  btnCancelForm.addEventListener("click", () => closeModal(modalForm));

  btnSavePerson.addEventListener("click", async () => {
    if(!requireAdmin()) return;
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
    }else{
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
  btnCenterRoot.addEventListener("click", () => {
    const rootCard = document.querySelector(`.card[data-id="${state.id}"]`);
    centerOnElement(rootCard);
  });
  btnAddRootChild.addEventListener("click", () => { if(!requireAdmin()) return; openAddChildForm(state.id); });

  // Mouse pan
  viewport.addEventListener("mousedown", (e) => {
    if(e.button !== 0) return;
    panning = true;
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
      const vx = mx - rect.left;
      const vy = my - rect.top;
      pointX = vx - (vx - pointX) * (scale / prev);
      pointY = vy - (vy - pointY) * (scale / prev);

      setTransform();
    }
  }, { passive: false });

  viewport.addEventListener("touchend", (e) => {
    if(e.touches.length === 0) touchMode = "none";
    if(e.touches.length === 1){
      touchMode = "pan";
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    }
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape"){
      [modalDetails, modalForm, modalManage, modalConfirm, modalAuth].filter(Boolean).forEach(closeModal);
    }
  });

  // --- تشغيل وربط المزامنة ---
  async function bootForCurrentTree(){
    if(unsubRemote){ try{ unsubRemote(); }catch{} unsubRemote = null; }
    applyingRemote = false;
    lastAppliedClientUpdatedAt = 0;

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
    setSync(isAdmin() ? "متصل • مطور" : "متصل • قراءة فقط");
  }

  // انتظر حالة Auth (لإظهار وضع المطور عند تسجيل الدخول)
  try{ if(Auth && Auth.waitForAuth) await Auth.waitForAuth(); }catch{}

  await bootForCurrentTree();

  // عند تغيّر حالة الدخول: فقط حدّث الشارة (بدون إعادة ربط الشجرة)
  if(Auth && Auth.onAuthChanged){
    Auth.onAuthChanged(() => {
      setSync(isAdmin() ? "متصل • مطور" : "متصل • قراءة فقط");
    });
  }

})();
