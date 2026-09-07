const MONTHS_GEN = ["stycznia","lutego","marca","kwietnia","maja","czerwca","lipca","sierpnia","września","października","listopada","grudnia"];
const DAYS_IN_MONTH = [31,29,31,30,31,30,31,31,30,31,30,31];

function pad(n){ return String(n).padStart(2, "0"); }

function formatDate(day, month){
  return day + " " + MONTHS_GEN[month - 1];
}

function corsHeaders(origin){
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin"
  };
}

function jsonResponse(data, origin, status){
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders(origin))
  });
}

async function fetchJson(url, init){
  const res = await fetch(url, Object.assign({ headers: { "User-Agent": "tego-dnia-worker/1.0 (contact: via GitHub repo)" } }, init || {}));
  if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
  return res.json();
}

// ---------- wikitext parsing (ported from the frontend) ----------

function stripWikitext(raw){
  let text = raw;
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<ref[^>]*\/>/gi, "");
  text = text.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  text = text.replace(/\{\{[^{}]*\}\}/g, "");
  text = text.replace(/\{\{[^{}]*\}\}/g, "");
  const links = [];
  text = text.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, function(full, target, display){
    const t = target.trim();
    if (t && links.indexOf(t) === -1) links.push(t);
    return (display !== undefined && display !== "") ? display : t;
  });
  text = text.replace(/\[(https?:\/\/[^\s\]]+)\s*([^\]]*)\]/g, function(full, url, label){ return label || url; });
  text = text.replace(/'''''/g, "").replace(/'''/g, "").replace(/''/g, "");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(/:$/, "").trim();
  return { text, firstLink: links[0] || null, links };
}

function splitBulletDepth(line){
  const m = line.match(/^(\*{1,2})\s*(.*)$/);
  if (!m) return null;
  const content = m[2].replace(/^&nbsp;\s*/i, "").trim();
  if (!content) return null;
  return { depth: m[1].length, content };
}

function parseYearPrefix(content){
  const ym = content.match(/^\[\[(\d{1,4})\]\]|^(\d{1,4})\b/);
  if (!ym) return null;
  let year = parseInt(ym[1] || ym[2], 10);
  let rest = content.slice(ym[0].length);
  const bc = rest.match(/^\s*p\.?\s*n\.?\s*e\.?/i);
  if (bc){ year = -year; rest = rest.slice(bc[0].length); }
  rest = rest.replace(/^\s*[–—-]\s*/, "").trim();
  if (rest === ":" || rest === "") rest = "";
  return { year, rest };
}

function parseEventsSection(wikitext, heading){
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("==\\s*" + escaped + "\\s*==([\\s\\S]*?)(?:\\n==[^=]|$)", "i");
  const m = wikitext.match(re);
  if (!m) return [];
  const events = [];
  let currentYear = null;
  m[1].split("\n").forEach(function(line){
    const b = splitBulletDepth(line);
    if (!b) return;
    let rawText;
    if (b.depth === 1){
      const yp = parseYearPrefix(b.content);
      if (!yp) return;
      currentYear = yp.year;
      rawText = yp.rest;
    } else {
      if (currentYear === null) return;
      rawText = b.content;
    }
    if (!rawText) return;
    const parsed = stripWikitext(rawText);
    if (!parsed.text) return;
    events.push({ year: currentYear, text: parsed.text, linkTitle: parsed.firstLink, links: parsed.links });
  });
  return events;
}

const POLAND_RE = /Polsk|Rzeczpospolit|Warszaw|Krak[oó]w|\bSejm|Wojsko Polskie\b|\bPRL\b|III Rzeczypospolit|Ksi[eę]stwa Warszawskiego|Gda[nń]sk|Pozna[nń]|Wroc[lł]aw|Lw[oó]w|Piast[oó]w|Jagiell/i;

async function fetchDayPool(title){
  const url = "https://pl.wikipedia.org/w/api.php?action=parse&page=" +
    encodeURIComponent(title) + "&prop=wikitext&format=json&formatversion=2";
  const data = await fetchJson(url);
  if (data.error) throw new Error(data.error.info || data.error.code || "Błąd API Wikipedii");
  if (!data.parse || typeof data.parse.wikitext !== "string") throw new Error("Nieoczekiwana odpowiedź API");
  const wikitext = data.parse.wikitext;

  let poland = parseEventsSection(wikitext, "Wydarzenia w Polsce");
  let world = parseEventsSection(wikitext, "Wydarzenia na świecie");
  if (!poland.length && !world.length){
    parseEventsSection(wikitext, "Wydarzenia").forEach(function(e){
      (POLAND_RE.test(e.text) ? poland : world).push(e);
    });
  }
  const births = parseEventsSection(wikitext, "Urodzili się");
  const deaths = parseEventsSection(wikitext, "Zmarli");
  return world.concat(poland, births, deaths).filter(function(e){ return e.linkTitle; });
}

// ---------- Commons / summary lookups ----------

function pickCommonsImages(data, limit){
  if (!data || !data.query || !data.query.pages) return [];
  const pages = data.query.pages.filter(function(p){ return p.imageinfo && p.imageinfo.length; });
  pages.sort(function(a, b){
    const wa = a.imageinfo[0].thumbwidth || a.imageinfo[0].width || 0;
    const wb = b.imageinfo[0].thumbwidth || b.imageinfo[0].width || 0;
    return (wb >= 400 ? 1 : 0) - (wa >= 400 ? 1 : 0);
  });
  return pages.slice(0, limit).map(function(p){
    const ii = p.imageinfo[0];
    return {
      source: ii.thumburl || ii.url,
      caption: (p.title || "").replace(/^File:/i, "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_/g, " ")
    };
  });
}

async function findImage(title){
  const commonsUrl = "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=" +
    encodeURIComponent(title) + "&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url|size&iiurlwidth=1200&format=json&formatversion=2";
  const summaryUrl = "https://pl.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title.replace(/ /g, "_"));
  const [commonsData, summary] = await Promise.all([
    fetchJson(commonsUrl).catch(function(){ return null; }),
    fetchJson(summaryUrl).catch(function(){ return null; })
  ]);
  let images = pickCommonsImages(commonsData, 4);
  if (!images.length && summary && summary.thumbnail && summary.thumbnail.source){
    images = [{ source: summary.thumbnail.source, caption: summary.description || summary.title || "" }];
  }
  return images;
}

// ---------- Claude ----------

async function askClaude(env, day, month, pool){
  const dateStr = formatDate(day, month);
  const listing = pool.slice(0, 400).map(function(e){
    return e.year + ": " + e.text + " [" + e.linkTitle + "]";
  }).join("\n");

  const prompt = "Oto lista wydarzeń związanych z dniem " + dateStr + " (różne lata), z artykułu-kalendarza polskiej Wikipedii. " +
    "Każda linia: ROK: opis [tytuł powiązanego artykułu].\n\n" + listing + "\n\n" +
    "Zadanie:\n" +
    "1. Wybierz JEDNO, najciekawsze wydarzenie lub postać z tej listy — najlepiej sprzed co najmniej 100 lat. " +
    "Preferuj sprawy obyczajowe, kulturalne, naukowe, ciekawostkowe, ludzkie, nietypowe — nad polityczno-wojenne " +
    "(unikaj bitew, koronacji, traktatów, wyborów, jeśli jest coś ciekawszego). Szukaj czegoś zaskakującego: " +
    "pozornie błahego, a istotnego, albo mniej oczywistej postaci.\n" +
    "2. Napisz o tym krótką, wciągającą opowieść po polsku w stylu 'historii jednego zdjęcia' — 3-4 akapity, " +
    "żywym, literackim językiem, nie encyklopedycznym referatem. Możesz oprzeć się na własnej wiedzy o temacie, " +
    "nie tylko na jednym zdaniu z listy — ale trzymaj się faktów.\n" +
    "3. Nadaj temu chwytliwy, literacki tytuł (nie surową nazwę artykułu Wikipedii).\n" +
    "4. Podaj krótki podtytuł/kontekst (kilka słów).\n" +
    "5. Podaj link_title DOKŁADNIE tak, jak w nawiasie kwadratowym przy wybranej linii z listy.\n\n" +
    "Odpowiedz WYŁĄCZNIE obiektem JSON, dokładnie w tym kształcie, bez żadnego tekstu poza nim:\n" +
    "{\"year\": <liczba>, \"fact\": \"<oryginalne zdanie z listy>\", \"link_title\": \"<dokładny tytuł z nawiasu>\", " +
    "\"title\": \"<literacki tytuł>\", \"subtitle\": \"<krótki podtytuł>\", \"story\": [\"<akapit 1>\", \"<akapit 2>\", \"<akapit 3>\"]}";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-sonnet-5",
      max_tokens: 1800,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!res.ok){
    const errText = await res.text().catch(function(){ return ""; });
    throw new Error("Anthropic API HTTP " + res.status + " " + errText.slice(0, 300));
  }
  const data = await res.json();
  const raw = data.content && data.content[0] && data.content[0].text;
  if (!raw) throw new Error("Pusta odpowiedź modelu");
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Model nie zwrócił JSON-a");
  return JSON.parse(jsonMatch[0]);
}

// ---------- main handler ----------

async function buildStory(env, day, month){
  const pool = await fetchDayPool(formatDate(day, month));
  if (!pool.length) throw new Error("Nie znaleziono wydarzeń dla tej daty");

  const picked = await askClaude(env, day, month, pool);
  if (!picked || !picked.link_title) throw new Error("Model nie wybrał tematu");

  const images = await findImage(picked.link_title).catch(function(){ return []; });

  return {
    day, month,
    year: picked.year,
    fact: picked.fact,
    title: picked.title,
    subtitle: picked.subtitle,
    paragraphs: Array.isArray(picked.story) ? picked.story : [],
    images,
    generatedAt: new Date().toISOString()
  };
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";

    if (request.method === "OPTIONS"){
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (url.pathname !== "/api/story"){
      return jsonResponse({ error: "not_found" }, origin, 404);
    }

    const day = parseInt(url.searchParams.get("day"), 10);
    const month = parseInt(url.searchParams.get("month"), 10);
    if (!month || month < 1 || month > 12 || !day || day < 1 || day > DAYS_IN_MONTH[month - 1]){
      return jsonResponse({ error: "invalid_date" }, origin, 400);
    }

    const cacheKey = pad(month) + "-" + pad(day);
    const forceRefresh = url.searchParams.get("refresh") === "1";

    try {
      if (!forceRefresh){
        const cached = await env.STORY_CACHE.get(cacheKey, "json");
        if (cached) return jsonResponse(cached, origin);
      }

      const story = await buildStory(env, day, month);
      await env.STORY_CACHE.put(cacheKey, JSON.stringify(story));
      return jsonResponse(story, origin);
    } catch (err){
      return jsonResponse({ error: "generation_failed", message: String(err && err.message || err) }, origin, 500);
    }
  }
};
