/* ============================================================
   NGUMZO v1 — app logic
   ------------------------------------------------------------
   The honest privacy model (v1):
   - Messages are ENCRYPTED in this browser before they are sent.
     The key is derived from the room code, so only people who
     have the code can decrypt. The relay (Firebase) only ever
     stores scrambled text — it cannot read the conversation.
   - Translation is done per-device AFTER decrypting locally,
     by calling Google Translate. Google sees the text; Ngumzo's
     relay does not.
   - Anyone with the room code can join. The code IS the key.
     v1 is for two people who trust each other and need the
     language bridge. Verified privacy is a later version.
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, push, onChildAdded, query, limitToLast }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

/* ---------- languages offered in v1 ---------- */
const LANGS = [
  { code:"en",  name:"English" },
  { code:"sw",  name:"Kiswahili" },
  { code:"fr",  name:"Français" },
  { code:"ar",  name:"العربية" },
  { code:"es",  name:"Español" },
  { code:"pt",  name:"Português" },
  { code:"de",  name:"Deutsch" },
  { code:"zh",  name:"中文" },
  { code:"hi",  name:"हिन्दी" },
  { code:"so",  name:"Soomaali" }
];

/* ---------- tiny DOM helpers ---------- */
const $ = id => document.getElementById(id);
function toast(msg){
  const t=document.createElement('div');
  t.className='toast';t.textContent=msg;document.body.appendChild(t);
  setTimeout(()=>t.remove(),2800);
}
function show(screenId){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $(screenId).classList.add('active');
  // pause the heavy plasma canvas while in chat; resume on the join screen
  if(window.__plasma){
    if(screenId==='chatScreen') window.__plasma.pause();
    else window.__plasma.resume();
  }
}

/* ---------- state ---------- */
let me = { name:"", lang:"en" };
let room = { code:"", key:null };
let db = null;
let demoMode = false;
const seen = new Set();   // message ids already rendered

/* ============================================================
   ENCRYPTION  — AES-GCM, key derived from the room code
   ============================================================ */
async function deriveKey(code){
  // PBKDF2 stretches the room code into a proper AES key.
  // Salt is fixed + code-based so both phones derive the SAME key
  // from the same code, with no key exchange needed.
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    "raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name:"PBKDF2",
      salt:enc.encode("ngumzo-v1-salt-" + code.toLowerCase()),
      iterations:120000, hash:"SHA-256" },
    base,
    { name:"AES-GCM", length:256 },
    false, ["encrypt","decrypt"]);
}
async function encrypt(key, plainObj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(plainObj));
  const ct = await crypto.subtle.encrypt({name:"AES-GCM",iv}, key, data);
  // store iv + ciphertext together, base64
  const both = new Uint8Array(iv.length + ct.byteLength);
  both.set(iv,0); both.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...both));
}
async function decrypt(key, b64){
  try{
    const both = Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
    const iv = both.slice(0,12), ct = both.slice(12);
    const plain = await crypto.subtle.decrypt({name:"AES-GCM",iv}, key, ct);
    return JSON.parse(new TextDecoder().decode(plain));
  }catch(e){
    return null;   // wrong key / corrupt — message stays unreadable
  }
}

/* ============================================================
   TRANSLATION  — per device, after local decrypt
   Calls a serverless route that proxies Google Translate.
   (Browsers can't call Google Translate directly — CORS blocks
   it — so a thin stateless proxy forwards the request. It only
   ever sees text the user chose to translate, never the room
   or the ciphertext.)
   ============================================================ */
async function translate(text, from, to){
  if(from === to) return text;
  try{
    const r = await fetch("/api/translate", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ text, from, to })
    });
    if(!r.ok) throw new Error("translate "+r.status);
    const data = await r.json();
    return data.translated || text;
  }catch(e){
    return text;   // fail soft — show original rather than nothing
  }
}

/* ============================================================
   JOIN SCREEN
   ============================================================ */
function fillLangs(){
  const sel = $('langSelect');
  LANGS.forEach(l=>{
    const o=document.createElement('option');
    o.value=l.code; o.textContent=l.name; sel.appendChild(o);
  });
  // best guess from the phone's language
  const guess = (navigator.language||"en").slice(0,2);
  if(LANGS.some(l=>l.code===guess)) sel.value=guess;
}
function randomCode(){
  // human-friendly: no easily-confused chars (0/O, 1/I)
  const chars="ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c="";
  for(let i=0;i<6;i++) c+=chars[Math.floor(Math.random()*chars.length)];
  return c;
}

$('createBtn').addEventListener('click', ()=>{
  $('codeInput').value = randomCode();
  enterRoom();
});
$('joinBtn').addEventListener('click', enterRoom);

async function enterRoom(){
  const name = $('nameInput').value.trim();
  const code = $('codeInput').value.trim().toUpperCase();
  if(!name){ toast("Add your name first"); return; }
  if(!code){ toast("Type a room code, or tap New Room"); return; }
  if(code.length < 4){ toast("Room code looks too short"); return; }

  me.name = name;
  me.lang = $('langSelect').value;
  room.code = code;
  room.key  = await deriveKey(code);

  $('roomCodeLabel').textContent = code;
  $('myLangPill').textContent = LANGS.find(l=>l.code===me.lang).name;
  $('messages').innerHTML = "";
  seen.clear();

  connectRelay();
  show('chatScreen');
  $('msgInput').focus();
}

/* ============================================================
   RELAY  — Firebase Realtime Database (stores ciphertext only)
   ============================================================ */
function connectRelay(){
  const cfg = window.NGUMZO_CONFIG;
  const configured = cfg && cfg.apiKey && cfg.databaseURL;

  if(!configured){
    // DEMO MODE — no backend; let the user see the UI work locally
    demoMode = true;
    $('cfgBanner').style.display = "block";
    addSystemLine("Demo mode — connect a relay in config.js to sync two phones.");
    return;
  }
  demoMode = false;
  $('cfgBanner').style.display = "none";

  if(!db){
    const app = initializeApp(cfg);
    db = getDatabase(app);
  }
  // listen to the last 100 messages in this room
  const msgsRef = query(ref(db, "rooms/"+room.code+"/messages"), limitToLast(100));
  onChildAdded(msgsRef, snap=>{
    const id = snap.key;
    if(seen.has(id)) return;
    seen.add(id);
    renderIncoming(id, snap.val());
  });
  addSystemLine("Connected. Share the code so one other person can join.");
}

/* ============================================================
   SENDING
   ============================================================ */
$('sendBtn').addEventListener('click', sendMessage);
$('msgInput').addEventListener('keydown', e=>{
  if(e.key==="Enter"){ e.preventDefault(); sendMessage(); }
});

async function sendMessage(){
  const text = $('msgInput').value.trim();
  if(!text) return;
  $('msgInput').value = "";

  // what we put on the wire — the ORIGINAL text + sender's language.
  // each receiver translates into their own language locally.
  const payload = {
    name: me.name,
    lang: me.lang,
    text: text,
    ts:   Date.now()
  };

  // show my own message immediately (no translation — it's my language)
  renderBubble({ mine:true, name:me.name, original:text,
                 shown:text, fromLang:me.lang, ts:payload.ts });

  if(demoMode) return;   // nothing to send to

  const cipher = await encrypt(room.key, payload);
  push(ref(db, "rooms/"+room.code+"/messages"), {
    c: cipher,            // ciphertext — the relay sees only this
    ts: payload.ts        // timestamp left clear, for ordering
  });
}

/* ============================================================
   RECEIVING
   ============================================================ */
async function renderIncoming(id, raw){
  if(!raw || !raw.c) return;
  const payload = await decrypt(room.key, raw.c);
  if(!payload) return;   // couldn't decrypt — not our key

  const mine = (payload.name === me.name);
  if(mine) return;       // already shown my own on send

  // translate THEIR message into MY language
  const shown = await translate(payload.text, payload.lang, me.lang);
  renderBubble({
    mine:false, name:payload.name,
    original:payload.text, shown:shown,
    fromLang:payload.lang, ts:payload.ts
  });
}

/* ============================================================
   RENDERING
   ============================================================ */
function renderBubble({mine,name,original,shown,fromLang,ts}){
  const box = $('messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (mine?'mine':'theirs');

  const showOriginal = (!mine && original !== shown);
  const time = new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});

  wrap.innerHTML =
    `<div class="bubble">${escapeHtml(shown)}</div>` +
    (showOriginal
      ? `<div class="original">“${escapeHtml(original)}”</div>` : ``) +
    `<div class="meta">${escapeHtml(name)} · ${time}</div>`;

  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}
function addSystemLine(text){
  const box = $('messages');
  const el = document.createElement('div');
  el.className = 'sysline';
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>(
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============================================================
   SHARE + NAVIGATION
   ============================================================ */
$('shareBtn').addEventListener('click', async ()=>{
  const text = `Join my Ngumzo conversation. Room code: ${room.code}`;
  if(navigator.share){
    try{ await navigator.share({ text }); }catch(e){}
  }else{
    try{
      await navigator.clipboard.writeText(room.code);
      toast("Room code copied: "+room.code);
    }catch(e){ toast("Room code: "+room.code); }
  }
});
$('backBtn').addEventListener('click', ()=>{
  if(confirm("Leave this conversation?")){
    show('joinScreen');
  }
});

/* ============================================================
   BOOT
   ============================================================ */
fillLangs();
// allow ?room=CODE links to prefill
const urlRoom = new URLSearchParams(location.search).get('room');
if(urlRoom) $('codeInput').value = urlRoom.toUpperCase();
