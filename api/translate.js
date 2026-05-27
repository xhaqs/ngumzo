/* ============================================================
   NGUMZO — /api/translate
   ------------------------------------------------------------
   A thin, STATELESS proxy. It exists only because browsers
   cannot call Google Translate directly (CORS blocks it).

   What it does:  receives { text, from, to }, asks Google,
                  returns { translated }.
   What it does NOT do:  no database, no logging of message
                  text, no knowledge of the room code or who
                  is talking. It forwards one string and forgets.

   This is consistent with Ngumzo's promise: the RELAY never
   sees plaintext. This translate route sees only the single
   phrase a user chose to translate — never the conversation,
   never the ciphertext, never the room.
   ============================================================ */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  try {
    const { text, from, to } = req.body || {};

    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "missing text" });
      return;
    }
    if (text.length > 2000) {
      res.status(400).json({ error: "text too long" });
      return;
    }
    if (from === to) {
      res.status(200).json({ translated: text });
      return;
    }

    // Google's free translate endpoint (the one the web widget uses).
    const url = "https://translate.googleapis.com/translate_a/single"
      + "?client=gtx"
      + "&sl=" + encodeURIComponent(from || "auto")
      + "&tl=" + encodeURIComponent(to || "en")
      + "&dt=t"
      + "&q="  + encodeURIComponent(text);

    const g = await fetch(url);
    if (!g.ok) {
      res.status(502).json({ error: "translate upstream " + g.status });
      return;
    }

    // Google returns a nested array; the translated chunks are in [0][*][0].
    const data = await g.json();
    let translated = "";
    if (Array.isArray(data) && Array.isArray(data[0])) {
      for (const chunk of data[0]) {
        if (chunk && chunk[0]) translated += chunk[0];
      }
    }

    res.status(200).json({ translated: translated || text });
  } catch (e) {
    res.status(500).json({ error: "translate failed" });
  }
}
