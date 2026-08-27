# פריסה ל-Netlify

1. העלה את קובצי הפרויקט ל-GitHub או פתח אותם בפרויקט Netlify.
2. ב-Netlify בחר Build command: `npm run build` ו-Publish directory: `dist`.
3. הוסף ב-Environment variables את הערכים הבאים:
   - `USE_FIRESTORE=true`
   - `FIREBASE_SERVICE_ACCOUNT_JSON` — כל תוכן קובץ המפתח, בשורה אחת.
   - `DRIVE_PAYMENT_FOLDER_ID=1j4rGV1iSveiQlzAErId5hUAKhNe7CTRJ`
   - `DEVELOPER_PASSWORD` — סיסמת מפתח חדשה וחזקה.
4. בצע Deploy. אין להעלות את `firebase-service-account.json` ל-GitHub או ל-Netlify כקובץ.
