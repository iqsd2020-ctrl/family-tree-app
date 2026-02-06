// config.js
// إعدادات التطبيق (شجرة واحدة عامة + صلاحيات المطور)
(function(){
  window.FTConfig = {
    // معرّف الشجرة العامة المشتركة لكل الزوار
    PUBLIC_TREE_ID: "main",

    // البريد/البريدات المسموح لها كـ "مطور/مدير"
    ADMIN_EMAILS: ["iq.sd.2020@gmail.com"],

    // البريد الأساسي للمطور (توقيع المطور)
    DEVELOPER_EMAIL: "iq.sd.2020@gmail.com",

    // عند دخول مستخدم غير مخوّل: يتم تسجيل خروجه تلقائياً
    AUTO_SIGNOUT_NON_ADMIN: true
  };
})();
