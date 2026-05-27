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
import { getDatabase, ref, push, onChildAdded, query, limitToLast,
         get, set, remove, onValue, onDisconnect, child }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

/* ---------- languages offered ----------
   Each entry has an English name (so any user can scan the picker) and
   a native script (so a native speaker also recognises their language).
   The picker shows "English · Native" — best of both for a mixed-audience
   onboarding flow.

   tier "strong"  = reliable machine translation (Google's well-supported set)
   tier "fair"    = usable, less polished
   tier "rough"   = newer / low-resource — translation may be off. */
const LANGS = [
  // --- strong (large training data, high quality) ---
  { code:"en",    english:"English",                native:"",              tier:"strong" },
  { code:"sw",    english:"Swahili",                native:"Kiswahili",     tier:"strong" },
  { code:"fr",    english:"French",                 native:"Français",      tier:"strong" },
  { code:"ar",    english:"Arabic",                 native:"العربية",        tier:"strong" },
  { code:"es",    english:"Spanish",                native:"Español",       tier:"strong" },
  { code:"pt",    english:"Portuguese",             native:"Português",     tier:"strong" },
  { code:"de",    english:"German",                 native:"Deutsch",       tier:"strong" },
  { code:"it",    english:"Italian",                native:"Italiano",      tier:"strong" },
  { code:"nl",    english:"Dutch",                  native:"Nederlands",    tier:"strong" },
  { code:"ru",    english:"Russian",                native:"Русский",       tier:"strong" },
  { code:"pl",    english:"Polish",                 native:"Polski",        tier:"strong" },
  { code:"tr",    english:"Turkish",                native:"Türkçe",        tier:"strong" },
  { code:"zh-CN", english:"Chinese (Simplified)",   native:"中文 (简体)",     tier:"strong" },
  { code:"zh-TW", english:"Chinese (Traditional)",  native:"中文 (繁體)",     tier:"strong" },
  { code:"ja",    english:"Japanese",               native:"日本語",          tier:"strong" },
  { code:"ko",    english:"Korean",                 native:"한국어",          tier:"strong" },
  { code:"hi",    english:"Hindi",                  native:"हिन्दी",          tier:"strong" },
  { code:"bn",    english:"Bengali",                native:"বাংলা",          tier:"strong" },
  { code:"ur",    english:"Urdu",                   native:"اردو",          tier:"strong" },
  { code:"id",    english:"Indonesian",             native:"Bahasa Indonesia", tier:"strong" },
  { code:"vi",    english:"Vietnamese",             native:"Tiếng Việt",    tier:"strong" },
  { code:"th",    english:"Thai",                   native:"ไทย",           tier:"strong" },
  { code:"el",    english:"Greek",                  native:"Ελληνικά",      tier:"strong" },
  { code:"he",    english:"Hebrew",                 native:"עברית",         tier:"strong" },
  { code:"fa",    english:"Persian",                native:"فارسی",         tier:"strong" },
  { code:"sv",    english:"Swedish",                native:"Svenska",       tier:"strong" },
  { code:"no",    english:"Norwegian",              native:"Norsk",         tier:"strong" },
  { code:"da",    english:"Danish",                 native:"Dansk",         tier:"strong" },
  { code:"fi",    english:"Finnish",                native:"Suomi",         tier:"strong" },
  { code:"cs",    english:"Czech",                  native:"Čeština",       tier:"strong" },
  { code:"hu",    english:"Hungarian",              native:"Magyar",        tier:"strong" },
  { code:"ro",    english:"Romanian",               native:"Română",        tier:"strong" },
  { code:"uk",    english:"Ukrainian",              native:"Українська",    tier:"strong" },
  { code:"ms",    english:"Malay",                  native:"Bahasa Melayu", tier:"strong" },
  { code:"tl",    english:"Tagalog (Filipino)",     native:"",              tier:"strong" },

  // --- fair (usable, less polished) ---
  { code:"so",    english:"Somali",                 native:"Soomaali",      tier:"fair" },
  { code:"am",    english:"Amharic",                native:"አማርኛ",          tier:"fair" },
  { code:"rw",    english:"Kinyarwanda",            native:"",              tier:"fair" },
  { code:"zu",    english:"Zulu",                   native:"isiZulu",       tier:"fair" },
  { code:"xh",    english:"Xhosa",                  native:"isiXhosa",      tier:"fair" },
  { code:"ha",    english:"Hausa",                  native:"",              tier:"fair" },
  { code:"yo",    english:"Yoruba",                 native:"Yorùbá",        tier:"fair" },
  { code:"ig",    english:"Igbo",                   native:"",              tier:"fair" },
  { code:"st",    english:"Sesotho",                native:"",              tier:"fair" },
  { code:"sn",    english:"Shona",                  native:"chiShona",      tier:"fair" },
  { code:"ny",    english:"Chichewa",               native:"",              tier:"fair" },
  { code:"mg",    english:"Malagasy",               native:"",              tier:"fair" },
  { code:"ta",    english:"Tamil",                  native:"தமிழ்",         tier:"fair" },
  { code:"te",    english:"Telugu",                 native:"తెలుగు",        tier:"fair" },
  { code:"mr",    english:"Marathi",                native:"मराठी",          tier:"fair" },
  { code:"gu",    english:"Gujarati",               native:"ગુજરાતી",       tier:"fair" },
  { code:"pa",    english:"Punjabi",                native:"ਪੰਜਾਬੀ",         tier:"fair" },
  { code:"ne",    english:"Nepali",                 native:"नेपाली",        tier:"fair" },
  { code:"si",    english:"Sinhala",                native:"සිංහල",         tier:"fair" },
  { code:"km",    english:"Khmer",                  native:"ខ្មែរ",          tier:"fair" },
  { code:"my",    english:"Burmese",                native:"မြန်မာ",        tier:"fair" },
  { code:"ka",    english:"Georgian",               native:"ქართული",      tier:"fair" },
  { code:"hy",    english:"Armenian",               native:"Հայերեն",       tier:"fair" },
  { code:"az",    english:"Azerbaijani",            native:"Azərbaycan",    tier:"fair" },
  { code:"kk",    english:"Kazakh",                 native:"Қазақша",       tier:"fair" },
  { code:"uz",    english:"Uzbek",                  native:"O'zbek",        tier:"fair" },

  // --- rough (low-resource, newer — translation may be off) ---
  { code:"ki",    english:"Kikuyu",                 native:"Gĩkũyũ",        tier:"rough" },
  { code:"luo",   english:"Luo (Dholuo)",           native:"",              tier:"rough" },
  { code:"kam",   english:"Kamba",                  native:"Kĩkamba",       tier:"rough" },
  { code:"om",    english:"Oromo",                  native:"Afaan Oromoo",  tier:"rough" },
  { code:"ti",    english:"Tigrinya",               native:"ትግርኛ",          tier:"rough" },
  { code:"lg",    english:"Luganda",                native:"",              tier:"rough" },
  { code:"ee",    english:"Ewe",                    native:"Eʋegbe",        tier:"rough" },
  { code:"tw",    english:"Twi",                    native:"",              tier:"rough" },
  { code:"ak",    english:"Akan",                   native:"",              tier:"rough" },
  { code:"ln",    english:"Lingala",                native:"Lingála",       tier:"rough" },
  { code:"ts",    english:"Tsonga",                 native:"Xitsonga",      tier:"rough" }
];

/* how the picker shows each language: English first, native in parens if different */
function langLabel(l){
  if(!l.native || l.native === l.english) return l.english;
  return l.english + " · " + l.native;
}

/* ---------- countries offered (optional flag next to user's name) ----------
   Voluntary. Never auto-detected. Users who skip it stay flag-less.
   Tight starter list — East Africa + common diaspora destinations. */
const COUNTRIES = [
  { code:"",   name:"— don't show —",        flag:""   },
  { code:"ke", name:"Kenya",                  flag:"🇰🇪" },
  { code:"tz", name:"Tanzania",               flag:"🇹🇿" },
  { code:"ug", name:"Uganda",                 flag:"🇺🇬" },
  { code:"rw", name:"Rwanda",                 flag:"🇷🇼" },
  { code:"et", name:"Ethiopia",               flag:"🇪🇹" },
  { code:"so", name:"Somalia",                flag:"🇸🇴" },
  { code:"za", name:"South Africa",           flag:"🇿🇦" },
  { code:"ng", name:"Nigeria",                flag:"🇳🇬" },
  { code:"gb", name:"United Kingdom",         flag:"🇬🇧" },
  { code:"us", name:"United States",          flag:"🇺🇸" },
  { code:"ae", name:"United Arab Emirates",   flag:"🇦🇪" },
  { code:"sa", name:"Saudi Arabia",           flag:"🇸🇦" },
  { code:"qa", name:"Qatar",                  flag:"🇶🇦" },
  { code:"de", name:"Germany",                flag:"🇩🇪" },
  { code:"ca", name:"Canada",                 flag:"🇨🇦" },
  { code:"au", name:"Australia",              flag:"🇦🇺" },
  { code:"in", name:"India",                  flag:"🇮🇳" },
  { code:"cn", name:"China",                  flag:"🇨🇳" },
  { code:"fr", name:"France",                 flag:"🇫🇷" }
];
function flagFor(code){
  const c = COUNTRIES.find(x=>x.code===code);
  return c && c.flag ? c.flag : "";
}
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
let me = { name:"", lang:"en", country:"" };
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
function populateLangSelect(sel){
  sel.innerHTML = "";
  const groups = [
    { tier:"strong", label:"Reliable" },
    { tier:"fair",   label:"Good — minor rough edges" },
    { tier:"rough",  label:"Experimental — translation may be poor" }
  ];
  groups.forEach(g=>{
    const list = LANGS.filter(l=>l.tier===g.tier);
    if(!list.length) return;
    const og = document.createElement('optgroup');
    og.label = g.label;
    list.forEach(l=>{
      const o=document.createElement('option');
      o.value=l.code; o.textContent=langLabel(l); og.appendChild(o);
    });
    sel.appendChild(og);
  });
}
function fillLangs(){
  populateLangSelect($('langSelect'));
  populateLangSelect($('langSwitchSelect'));
  // best guess from the phone's language for the join screen
  const guess = (navigator.language||"en").slice(0,2);
  if(LANGS.some(l=>l.code===guess)) $('langSelect').value=guess;
}
function fillCountries(){
  const sel = $('countrySelect');
  COUNTRIES.forEach(c=>{
    const o = document.createElement('option');
    o.value = c.code;
    o.textContent = c.flag ? (c.flag + "  " + c.name) : c.name;
    sel.appendChild(o);
  });
}
function randomCode(){
  // human-friendly: no easily-confused chars (0/O, 1/I)
  const chars="ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c="";
  for(let i=0;i<6;i++) c+=chars[Math.floor(Math.random()*chars.length)];
  return c;
}

$('createBtn').addEventListener('click', ()=>{
  // validate name first — code is generated automatically
  const name = $('nameInput').value.trim();
  if(!name){ toast("Add your name first"); return; }
  // generate the fresh code and show the invite screen
  const code = randomCode();
  $('codeInput').value = code;
  $('inviteCode').textContent = code;
  $('inviteCap').textContent = ROOM_CAPACITY;
  show('inviteScreen');
  pingStat("room_created");
});
$('joinBtn').addEventListener('click', enterRoom);

/* ============================================================
   INVITE SCREEN — share / copy / enter
   ============================================================ */
function buildInviteText(){
  const code = $('inviteCode').textContent.trim();
  const url  = location.origin + "/?room=" + encodeURIComponent(code);
  return "Join my Ngumzo conversation — we can chat across languages.\n" +
         "Room code: " + code + "\n" + url;
}
$('inviteShareBtn').addEventListener('click', async ()=>{
  const text = buildInviteText();
  if(navigator.share){
    try{ await navigator.share({ text }); return; }catch(e){ /* user cancelled */ }
  }
  // fallback: open WhatsApp directly
  const wa = "https://wa.me/?text=" + encodeURIComponent(text);
  window.open(wa, "_blank");
});
$('inviteCopyBtn').addEventListener('click', async ()=>{
  try{
    await navigator.clipboard.writeText(buildInviteText());
    toast("Invite copied — paste it anywhere");
  }catch(e){
    toast("Code: " + $('inviteCode').textContent);
  }
});
$('inviteEnterBtn').addEventListener('click', ()=>{ enterRoom(); });
$('inviteBack').addEventListener('click', ()=>{ show('joinScreen'); });

/* ============================================================
   ROOM CAPACITY — testing-launch phase
   Raised from 2 to 6 so testers can share with small groups.
   Will be configurable per-room in a later version.
   ============================================================ */
const ROOM_CAPACITY = 6;

/* a stable per-device id for this session (one "seat" in a room) */
const DEVICE_ID = 'd' + Math.random().toString(36).slice(2,11);

async function enterRoom(){
  const name = $('nameInput').value.trim();
  const code = $('codeInput').value.trim().toUpperCase();
  if(!name){ toast("Add your name first"); return; }
  if(!code){ toast("Type a room code, or tap New Room"); return; }
  if(code.length < 4){ toast("Room code looks too short"); return; }

  me.name = name;
  me.lang = $('langSelect').value;
  me.country = $('countrySelect').value || "";
  room.code = code;
  room.key  = await deriveKey(code);

  // ---- TWO-PERSON ROOM LOCK ----
  // before entering, check the room is not already full.
  const cfg = window.NGUMZO_CONFIG;
  const configured = cfg && cfg.apiKey && cfg.databaseURL;
  if(configured){
    if(!db){
      const fbApp = initializeApp(cfg);
      db = getDatabase(fbApp);
    }
    try{
      const seatsSnap = await get(ref(db, "rooms/"+code+"/seats"));
      const seats = seatsSnap.val() || {};
      const ids = Object.keys(seats);
      // room is full only if 2 OTHER devices already hold seats
      if(ids.length >= ROOM_CAPACITY && !ids.includes(DEVICE_ID)){
        toast("That room is full — already has " + ROOM_CAPACITY + " people.");
        return;
      }
    }catch(e){
      // if the check fails, fail safe: let them in rather than lock out
      console.warn("seat check failed", e);
    }
  }

  $('roomCodeLabel').textContent = code;
  updateLangPill();
  $('messages').innerHTML = "";
  seen.clear();

  connectRelay();
  show('chatScreen');
  $('msgInput').focus();
}

/* ============================================================
   RELAY  — Firebase Realtime Database (stores ciphertext only)
   ============================================================ */
let seatRef = null;       // this device's seat in the room
let seatsListenerOff = null;

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
    const fbApp = initializeApp(cfg);
    db = getDatabase(fbApp);
  }

  // ---- claim a seat, and free it automatically if we disconnect ----
  seatRef = ref(db, "rooms/"+room.code+"/seats/"+DEVICE_ID);
  set(seatRef, { name: me.name, ts: Date.now() });
  onDisconnect(seatRef).remove();   // tab closed / network lost -> seat frees

  // ---- watch how many people are in the room ----
  const allSeats = ref(db, "rooms/"+room.code+"/seats");
  seatsListenerOff = onValue(allSeats, snap=>{
    const seats = snap.val() || {};
    updatePresence(Object.keys(seats).length);
  });

  // ---- listen to the last 100 messages ----
  const msgsRef = query(ref(db, "rooms/"+room.code+"/messages"), limitToLast(100));
  onChildAdded(msgsRef, snap=>{
    const id = snap.key;
    if(seen.has(id)) return;
    seen.add(id);
    renderIncoming(id, snap.val());
  });
  addSystemLine("Connected. Share the code — up to " + ROOM_CAPACITY + " people can join.");
}

/* show "n here" / "n here · room full" in the header */
function updatePresence(count){
  const el = $('presence');
  if(!el) return;
  if(count <= 0){
    el.textContent = "connecting…";
    el.className = "presence waiting";
  } else if(count >= ROOM_CAPACITY){
    el.textContent = count + " here · room full";
    el.className = "presence sealed";
  } else {
    el.textContent = count + " here";
    el.className = "presence waiting";
  }
}

/* free our seat when leaving the room */
function leaveRoom(){
  try{
    if(seatRef) remove(seatRef);
    if(seatsListenerOff) seatsListenerOff();
  }catch(e){}
  seatRef = null; seatsListenerOff = null;
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
    country: me.country || "",
    text: text,
    ts:   Date.now()
  };

  // show my own message immediately (no translation — it's my language)
  renderBubble({ mine:true, name:me.name, country:me.country, original:text,
                 shown:text, fromLang:me.lang, ts:payload.ts });

  if(demoMode) return;   // nothing to send to

  const cipher = await encrypt(room.key, payload);
  push(ref(db, "rooms/"+room.code+"/messages"), {
    c: cipher,            // ciphertext — the relay sees only this
    ts: payload.ts        // timestamp left clear, for ordering
  });
  pingStat("message_sent");
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
    mine:false, name:payload.name, country:payload.country||"",
    original:payload.text, shown:shown,
    fromLang:payload.lang, ts:payload.ts
  });
}

/* ============================================================
   RENDERING
   ============================================================ */
function renderBubble({mine,name,country,original,shown,fromLang,ts}){
  const box = $('messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (mine?'mine':'theirs');

  const showOriginal = (!mine && original !== shown);
  const time = new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  const flag = flagFor(country);
  const nameLine = (flag ? flag + " " : "") + escapeHtml(name);

  wrap.innerHTML =
    `<div class="bubble">${escapeHtml(shown)}</div>` +
    (showOriginal
      ? `<div class="original">“${escapeHtml(original)}”</div>` : ``) +
    `<div class="meta">${nameLine} · ${time}</div>`;

  // speak button on INCOMING bubbles — read the translation aloud in MY language
  if(!mine && 'speechSynthesis' in window){
    const speakBtn = document.createElement('button');
    speakBtn.className = 'speak-btn';
    speakBtn.type = 'button';
    speakBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" '+
      'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'+
      '<path d="M11 5L6 9H2v6h4l5 4V5z"/>'+
      '<path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg> hear it';
    speakBtn.addEventListener('click', ()=> speakText(shown, me.lang, speakBtn));
    wrap.appendChild(speakBtn);
  }

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
    leaveRoom();
    show('joinScreen');
  }
});

/* ============================================================
   LANGUAGE SWITCHER (in-chat)
   - Past bubbles stay as they were.
   - A system line marks the switch.
   - Future incoming messages translate to the new language.
   ============================================================ */
function updateLangPill(){
  const langName = LANGS.find(l=>l.code===me.lang).english;
  const flag = flagFor(me.country);
  $('myLangPill').textContent = (flag ? flag + " " : "") + langName;
}
function openLangSheet(){
  $('langSwitchSelect').value = me.lang;
  const d = $('langDialog');
  if(d.showModal) d.showModal();
  else d.setAttribute('open','');   // ancient-browser fallback
  if(window.__plasma) window.__plasma.pause();
}
function closeLangSheet(){
  const d = $('langDialog');
  if(d.close) d.close();
  else d.removeAttribute('open');
}

$('myLangPill').addEventListener('click', openLangSheet);
$('dialogClose').addEventListener('click', closeLangSheet);
// tap on the backdrop closes the dialog
$('langDialog').addEventListener('click', e=>{
  if(e.target === $('langDialog')) closeLangSheet();
});
$('langSwitchApply').addEventListener('click', ()=>{
  const newLang = $('langSwitchSelect').value;
  if(newLang === me.lang){ closeLangSheet(); return; }
  const oldName = LANGS.find(l=>l.code===me.lang).english;
  const newName = LANGS.find(l=>l.code===newLang).english;
  me.lang = newLang;
  updateLangPill();
  addSystemLine("You switched from " + oldName + " to " + newName + ". Future messages will reach you in " + newName + ".");
  closeLangSheet();
});

/* ============================================================
   VOICE INPUT  — speak, the words land in the composer
   Uses the browser's built-in SpeechRecognition. Free, on-device
   on most Android browsers. Quality varies by language — same
   honest tier story as translation.
   ============================================================ */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recogniser = null;
let isRecording = false;

/* speech-recognition language tags differ slightly from translation codes */
function speechTagFor(langCode){
  const map = {
    en:"en-US", sw:"sw-KE", fr:"fr-FR", ar:"ar-SA", es:"es-ES",
    pt:"pt-BR", de:"de-DE", it:"it-IT", nl:"nl-NL", ru:"ru-RU",
    pl:"pl-PL", tr:"tr-TR", ja:"ja-JP", ko:"ko-KR", hi:"hi-IN",
    bn:"bn-IN", ur:"ur-PK", id:"id-ID", vi:"vi-VN", th:"th-TH",
    el:"el-GR", he:"he-IL", fa:"fa-IR", sv:"sv-SE", no:"nb-NO",
    da:"da-DK", fi:"fi-FI", cs:"cs-CZ", hu:"hu-HU", ro:"ro-RO",
    uk:"uk-UA", ms:"ms-MY", tl:"fil-PH", so:"so-SO", am:"am-ET",
    "zh-CN":"zh-CN", "zh-TW":"zh-TW", zu:"zu-ZA", xh:"xh-ZA",
    ta:"ta-IN", te:"te-IN", mr:"mr-IN", gu:"gu-IN", pa:"pa-IN",
    ne:"ne-NP", si:"si-LK", km:"km-KH", my:"my-MM", ka:"ka-GE",
    hy:"hy-AM", az:"az-AZ", kk:"kk-KZ", uz:"uz-UZ"
  };
  return map[langCode] || langCode;
}

if(!SpeechRec){
  // browser doesn't support speech input — hide the button rather than confuse
  const mb = $('micBtn'); if(mb) mb.style.display = "none";
}

$('micBtn') && $('micBtn').addEventListener('click', ()=>{
  if(!SpeechRec){ toast("Voice input not supported on this browser"); return; }
  if(isRecording){ stopRecording(); return; }
  startRecording();
});

function startRecording(){
  try{
    recogniser = new SpeechRec();
    recogniser.lang = speechTagFor(me.lang || "en");
    recogniser.continuous = false;
    recogniser.interimResults = true;
    recogniser.maxAlternatives = 1;

    const inp = $('msgInput');
    const startText = inp.value;
    recogniser.onresult = (ev)=>{
      let t = "";
      for(let i = ev.resultIndex; i < ev.results.length; i++){
        t += ev.results[i][0].transcript;
      }
      inp.value = startText ? (startText + " " + t) : t;
    };
    recogniser.onerror = (ev)=>{
      stopRecording();
      if(ev.error === "not-allowed") toast("Microphone permission needed");
      else if(ev.error === "no-speech") toast("Didn't catch anything — try again");
      else if(ev.error === "language-not-supported")
        toast("Voice not supported for " + LANGS.find(l=>l.code===me.lang).english);
      else toast("Voice error: " + ev.error);
    };
    recogniser.onend = ()=>{ if(isRecording) stopRecording(); };
    recogniser.start();
    isRecording = true;
    $('micBtn').classList.add('recording');
    $('micBtn').setAttribute('aria-label','Stop recording');
  }catch(e){
    toast("Could not start voice input");
    isRecording = false;
  }
}
function stopRecording(){
  try{ if(recogniser) recogniser.stop(); }catch(e){}
  recogniser = null;
  isRecording = false;
  const mb = $('micBtn'); if(mb){
    mb.classList.remove('recording');
    mb.setAttribute('aria-label','Speak');
  }
}

/* ============================================================
   VOICE OUTPUT  — speak button on incoming translated bubbles
   Uses speechSynthesis. Voice quality depends on the device's
   installed voices — beyond our control, but free and offline.
   ============================================================ */
let currentUtterance = null;

function speakText(text, langCode, btn){
  if(!('speechSynthesis' in window)){
    toast("Speak-aloud not supported on this browser"); return;
  }
  // stop anything already playing (avoids overlap)
  window.speechSynthesis.cancel();
  if(currentUtterance && btn !== currentUtterance.__btn){
    if(currentUtterance.__btn) currentUtterance.__btn.classList.remove('playing');
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = speechTagFor(langCode);
  u.rate = 1.0;
  u.__btn = btn;
  u.onend = ()=>{ if(btn) btn.classList.remove('playing'); currentUtterance = null; };
  u.onerror = ()=>{ if(btn) btn.classList.remove('playing'); currentUtterance = null; };
  currentUtterance = u;
  if(btn) btn.classList.add('playing');
  window.speechSynthesis.speak(u);
}

/* ============================================================
   ANALYTICS — privacy-respecting counts only
   Reports: app opens, rooms created, messages sent.
   Never reports: message content, who-talked-to-whom, room codes.
   Fire-and-forget to /api/stats — failure is silent and never blocks.
   ============================================================ */
function pingStat(event){
  try{
    fetch("/api/stats", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ event: event })
    }).catch(()=>{});
  }catch(e){}
}
pingStat("open");

/* ============================================================
   BOOT
   ============================================================ */
fillLangs();
fillCountries();
// allow ?room=CODE links to prefill
const urlRoom = new URLSearchParams(location.search).get('room');
if(urlRoom) $('codeInput').value = urlRoom.toUpperCase();
