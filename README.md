# Ngumzo

**Talk across languages — privately.**

Two people, two languages, one conversation. Each person writes in their own
language; the message reaches the other person in theirs. Messages are
encrypted on the phone before they are sent, so the relay never reads them.

A RIAKOINE-EMPIRE project.

---

## What v1 is

- **Room code to connect** — one person makes a room, shares the 6-letter
  code, the other joins. No signup, no accounts.
- **Per-person language** — you each pick your own. Translation happens on
  each device.
- **Encrypted relay** — messages are scrambled (AES-GCM) in the browser
  before sending. The key comes from the room code. Firebase, the relay,
  only ever stores ciphertext.

## What v1 is NOT (yet)

- Not group chat — two people per room is the tested path.
- Not verified-private — anyone with the code can join. The code *is* the
  key. v1 is for two people who trust each other and need the language
  bridge. Verified identity / key exchange is a later version.
- Translation is done by Google — so **Google sees the text**. Ngumzo's
  relay does not. The app says this plainly to the user.

---

## Files

```
public/
  index.html     the app — join screen + chat screen
  app.js         logic — encryption, room sync, translation
  config.js      >>> PASTE YOUR FIREBASE KEYS HERE <<<
api/
  translate.js   stateless proxy to Google Translate
vercel.json      Vercel routing
firebase-rules.json   security rules to paste into Firebase
```

## Setup

1. **Firebase** — create a project at console.firebase.google.com,
   add a Web app, enable **Realtime Database**.
2. Paste the Realtime Database security rules from `firebase-rules.json`
   into the Firebase console (Realtime Database > Rules).
3. Copy your Firebase web config into `public/config.js`.
4. Deploy the repo to Vercel (it auto-detects the `api/` route).

**Until config.js is filled in**, Ngumzo runs in **demo mode** — the chat
UI works on one device so you can see and test it, but two phones won't
sync until real keys are in place.

## Honest limits

This is v1 — the smallest version that proves the core loop: do two people,
speaking two languages, actually have a working conversation. Validate that
with real use before building anything else.
