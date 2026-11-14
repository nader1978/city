// ============================================================
//  City Services Guide — configuration
// ============================================================
//  Firebase project: faqouscityappdb
//  The Firebase web config is meant to be public (it is not a password).
//  Your data is protected by the rules in firestore.rules.
// ============================================================

export default {
  firebase: {
    apiKey: "AIzaSyCtfLipWnJjxUFIlVtW5xo2S5tCZOPctSY",
    authDomain: "faqouscityappdb.firebaseapp.com",
    projectId: "faqouscityappdb",
    storageBucket: "faqouscityappdb.firebasestorage.app",
    messagingSenderId: "349200622645",
    appId: "1:349200622645:web:f25c837018a022a2bd3d7c",
    measurementId: "G-6ZF9KY9SRX"
  },

  // Google accounts that can approve / reject listings
  // (must match the list in firestore.rules)
  adminEmails: [
    "nader.alnajjar@gmail.com"
  ]
};
