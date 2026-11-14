// ============================================================
//  City Services Guide — configuration
// ============================================================
//  1. Paste your Firebase web app config below (see README.md).
//  2. Put the admin's Google email address(es) in adminEmails.
//     The same emails must also be in firestore.rules.
//
//  While apiKey still says "PASTE_YOUR_API_KEY", the site runs in
//  DEMO MODE: everything is saved only in the visitor's browser.
// ============================================================

export default {
  firebase: {
    apiKey: "PASTE_YOUR_API_KEY",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:0000000000000000"
  },

  // Google accounts that can approve / reject listings
  adminEmails: [
    "admin@example.com"
  ]
};
