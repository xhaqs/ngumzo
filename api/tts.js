/* ============================================================
   NGUMZO — /api/tts
   ------------------------------------------------------------
   Server-side text-to-speech, so EVERY language plays on EVERY
   device — even cheap phones with no installed voices.

   How it works: receives { text, lang }, fetches spoken audio
   from Google's translate TTS endpoint, streams the MP3 back.
   The browser plays it through an <audio> element.

   PRIVACY NOTE (must be disclosed in the UI):
   When a user taps "hear it", the single translated phrase is
   sent to Google to be spoken. Chat content in the relay stays
   encrypted as always — but this one phrase, on demand, leaves
   the device. The app tells the user this.

   Google TTS has a ~200 character limit per request, so we cap.
   ============================================================ */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  try {
    const { text, lang } = req.body || {};
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "missing text" });
      return;
    }
    // Google TTS endpoint caps around 200 chars; trim to be safe.
    const clip = text.slice(0, 200);
    const tl = (lang || "en").split("-")[0];   // primary language code

    const url = "https://translate.google.com/translate_tts"
      + "?ie=UTF-8"
      + "&client=tw-ob"
      + "&tl=" + encodeURIComponent(tl)
      + "&q="  + encodeURIComponent(clip);

    const g = await fetch(url, {
      headers: {
        // Google requires a normal-looking UA for this endpoint
        "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile"
      }
    });
    if (!g.ok) {
      res.status(502).json({ error: "tts upstream " + g.status });
      return;
    }
    const buf = Buffer.from(await g.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400"); // cache identical phrases a day
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: "tts failed" });
  }
}
