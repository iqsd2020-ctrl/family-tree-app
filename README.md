# شجرة العائلة (Family Tree App)

تطبيق ويب (صفحة واحدة) لعرض **شجرة عائلة واحدة مشتركة** لجميع الزوار، مع فصل الصلاحيات:

- **الزائر:** عرض/قراءة فقط (لا تظهر له أدوات الإدارة)
- **المطور (Admin):** يسجل دخول عبر Google ويملك كامل الصلاحيات (إضافة/تعديل/حذف/استيراد/تصدير/إعادة ضبط)

## الميزات
- عرض شجرة العائلة (Pan & Zoom + دعم Pinch على الجوال)
- بطاقات أشخاص مع:
  - صورة مصغرة + معاينة في نافذة التفاصيل
  - لون بطاقة (مجموعة ألوان محددة)
  - تواريخ الولادة/الوفاة
- ضغط الصور قبل حفظها وتخزينها في Firestore كـ Base64 (كنص)
- **كل شخص وثيقة مستقلة** داخل `familyTrees/main/files/{personId}`
- **كل صورة وثيقة مستقلة** مرتبطة بالشخص داخل `familyTrees/main/files/photo_{personId}`
- مزامنة لحظية عبر Firestore (Realtime via onSnapshot)
- **لا يوجد أي حفظ محلي في المتصفح** (لا LocalStorage ولا IndexedDB Persistence)

## إعدادات المشروع
تم وضع الإعدادات في:
- `js/config.js`

أهم الإعدادات:
- `PUBLIC_TREE_ID`: معرّف الشجرة العامة (افتراضياً `"main"`)
- `ADMIN_EMAILS`: قائمة بريد/بريدات المطورين المسموح لهم بالإدارة
- `AUTO_SIGNOUT_NON_ADMIN`: تسجيل خروج تلقائي إن سجل دخول حساب غير مخوّل

> يفضّل استخدام UID داخل قواعد Firestore إن أمكن، لكن هذا المشروع يدعم **التحقق بالبريد** أيضاً.

## قواعد Firestore (مهم جداً 🔒)
قم بنسخ قواعد Firestore من الملف:
- `firestore.rules`

هذه القواعد تحقق التالي:
- السماح بالقراءة للجميع للشجرة العامة فقط (`familyTrees/main`)
- السماح بالكتابة **للمطور فقط** (حسب البريد في القواعد)

### مثال (مختصر) للقواعد
```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null
        && request.auth.token.email == "iq.sd.2020@gmail.com";
    }

    match /familyTrees/{treeId} {
      allow read: if treeId == "main";
      allow write: if treeId == "main" && isAdmin();

      match /files/{fileId} {
        allow read: if treeId == "main";
        allow write: if treeId == "main" && isAdmin();
      }
    }
  }
}
```

## تشغيل محلي
يفضل تشغيله عبر سيرفر محلي (بدلاً من `file://`) لأن تسجيل الدخول قد لا يعمل على `file://`.

مثال (Node):
```bash
npx serve .
```

ثم افتح الرابط الذي يظهر لك.

### أخطاء تسجيل الدخول الشائعة
- **Firebase Auth غير متاح**: كانت تظهر عند محاولة الدخول قبل تهيئة Firebase App. تم إصلاحها بجعل تهيئة Firebase تتم مبكراً.
- **auth/unauthorized-domain**: أضف الدومين الحالي إلى **Authorized domains** داخل Firebase Console → Authentication.
- **popup-blocked**: اسمح بالنوافذ المنبثقة أو سيستخدم التطبيق التحويل (Redirect) تلقائياً.

## إعداد Firebase (خطوات سريعة)
1) افتح Firebase Console → Authentication → Sign-in method  
   فعّل **Google**.

2) Firestore → Rules  
   الصق القواعد من `firestore.rules` ثم Publish.

3) تأكد أن Firestore Mode على Production أو Test حسب حاجتك، لكن **القواعد أعلاه تضبط الوصول فعلياً**.

## ملاحظة
المشروع يعرض الشجرة العامة فور فتح الصفحة (بدون تسجيل دخول).  
عند تسجيل دخول المطور عبر زر 👤 سيتم تفعيل وضع الإدارة وإظهار أدوات التحكم.
