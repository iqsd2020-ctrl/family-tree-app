/* PWA: Service Worker + زر التثبيت (يظهر فقط إذا كان التطبيق غير مثبّت) */
(() => {
  const installBtn = document.getElementById('btnInstall');
  const installModal = document.getElementById('modalInstall');
  const installConfirmBtn = document.getElementById('btnInstallConfirm');
  const installCloseBtn = document.getElementById('btnInstallClose');
  const installIosHint = document.getElementById('installIosHint');

  let deferredPrompt = null;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  const isInstalled = () => {
    return (
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) ||
      window.navigator.standalone === true
    );
  };

  const openInstallModal = () => {
    if (!installModal) return;
    installModal.classList.add('open');
    installModal.setAttribute('aria-hidden', 'false');
  };

  const closeInstallModal = () => {
    if (!installModal) return;
    installModal.classList.remove('open');
    installModal.setAttribute('aria-hidden', 'true');
  };

  const syncInstallModalUI = () => {
    const canPrompt = !!deferredPrompt;

    if (installConfirmBtn) {
      installConfirmBtn.style.display = canPrompt ? '' : 'none';
    }
    if (installIosHint) {
      installIosHint.style.display = (isIOS && !canPrompt) ? '' : 'none';
    }
  };

  const hideInstallBtn = () => {
    if (!installBtn) return;
    installBtn.style.display = 'none';
    closeInstallModal();
  };

  const showInstallBtn = () => {
    if (!installBtn) return;
    installBtn.style.display = '';
    syncInstallModalUI();
    openInstallModal();
  };

  // زر التثبيت
  if (installBtn) {
    if (isInstalled()) hideInstallBtn();
    else if (isIOS) showInstallBtn();

    window.addEventListener('beforeinstallprompt', (e) => {
      // منع الإظهار الافتراضي وحفظ الحدث لطلب التثبيت عند الضغط على زرنا
      e.preventDefault();
      deferredPrompt = e;
      if (!isInstalled()) showInstallBtn();
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      hideInstallBtn();
    });

    if (installCloseBtn) {
      installCloseBtn.addEventListener('click', () => closeInstallModal());
    }

    if (installModal) {
      installModal.addEventListener('click', (e) => { if (e.target === installModal) closeInstallModal(); });
    }

    installBtn.addEventListener('click', () => {
      if (isInstalled()) return;
      syncInstallModalUI();
      openInstallModal();
    });

    if (installConfirmBtn) {
      installConfirmBtn.addEventListener('click', async () => {
        if (isIOS && !isInstalled() && !deferredPrompt) return;
        if (!deferredPrompt) return;

        installConfirmBtn.disabled = true;
        deferredPrompt.prompt();

        try {
          const choice = await deferredPrompt.userChoice;
          deferredPrompt = null;

          if (choice && choice.outcome === 'accepted') {
            hideInstallBtn();
          } else {
            closeInstallModal();
          }
        } finally {
          installConfirmBtn.disabled = false;
        }
      });
    }
  }

  // تسجيل Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();