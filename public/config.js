/* ============================================================
   NGUMZO — CONFIG
   ------------------------------------------------------------
   Paste your Firebase project keys below to connect the relay.

   HOW TO GET THESE:
   1. Go to console.firebase.google.com
   2. Create a project (or reuse an existing one)
   3. Add a "Web app" to it
   4. Enable "Realtime Database" in Build > Realtime Database
   5. Copy the config values it shows you into the blanks below

   UNTIL YOU FILL THIS IN:
   Ngumzo runs in DEMO MODE — the chat works on one device only,
   so you can see and test the interface. Two phones won't sync
   until real keys are here.

   IS THIS SAFE TO COMMIT TO GITHUB?
   Yes. Firebase web keys are public by design — they only
   identify the project, they are not a password. Real protection
   comes from (a) Realtime Database security rules and (b) the
   fact that Ngumzo encrypts messages before sending, so even
   with the keys, nobody can read the conversations.
   ============================================================ */

window.NGUMZO_CONFIG = {
  // ---- paste between the quotes ----
  apiKey:            "",
  authDomain:        "",
  databaseURL:       "",
  projectId:         "",
  storageBucket:     "",
  messagingSenderId: "",
  appId:             ""
};
