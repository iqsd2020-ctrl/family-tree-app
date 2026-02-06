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
- ضغط الصور قبل رفعها وتخزينها في Firestore كـ Base64 (ضمن subcollection)
- مزامنة لحظية عبر Firestore (Realtime via onSnapshot)

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

## إعداد Firebase (خطوات سريعة)
1) افتح Firebase Console → Authentication → Sign-in method  
   فعّل **Google**.

2) Firestore → Rules  
   الصق القواعد من `firestore.rules` ثم Publish.

3) تأكد أن Firestore Mode على Production أو Test حسب حاجتك، لكن **القواعد أعلاه تضبط الوصول فعلياً**.

## ملاحظة
المشروع يعرض الشجرة العامة فور فتح الصفحة (بدون تسجيل دخول).  
عند تسجيل دخول المطور عبر زر 👤 سيتم تفعيل وضع الإدارة وإظهار أدوات التحكم.
