'use strict';

const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const VERSION = 'v6.2 全球筛选按钮修复版';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_HTML_CHARS = 900000;
const SEARCH_TIMEOUT_MS = 10000;
const PAGE_TIMEOUT_MS = 11000;
const MAX_SEARCH_QUERIES = 10;
const MAX_CANDIDATES = 70;

const HARD_EXCLUDE_DOMAINS = [
  'google.com','bing.com','microsoft.com','help.bing.microsoft.com','youtube.com','youtu.be','facebook.com','instagram.com','linkedin.com','x.com','twitter.com','tiktok.com',
  'wikipedia.org','amazon.','ebay.','reddit.com','quora.com','pinterest.','aliexpress.','alibaba.','temu.','shopify.com','medium.com',
  'cyclingnews.com','bikeradar.com','road.cc','pinkbike.com','singletracks.com','bikepacking.com','outsideonline.com','cyclingweekly.com',
  'trekbikes.com','specialized.com','giant-bicycles.com','canyon.com','shimano.com','sram.com','garmin.com','cannondale.com','scott-sports.com',
  'cube.eu','merida-bikes.com','pinarello.com','cervelo.com','bianchi.com','orbea.com','focus-bikes.com','radon-bikes.de'
];

const POSITIVE_WORDS = [
  'bike','bicycle','cycling','cycle','cycles','bikes','bicycles','velos','velo','fahrrad','fahrräder','radladen','fahrradladen','fahrradgeschäft',
  'shop','store','retail','retailer','dealer','distributor','distribution','wholesale','wholesaler','importer','importeur','händler','haendler','grosshandel','großhandel',
  'parts','accessories','component','components','zubehör','zubehoer','teile','fahrradteile','workshop','repair','service','bikefitting'
];

const NEGATIVE_WORDS = [
  'news','magazine','review','reviews','blog','forum','wiki','support','help center','privacy policy only','press release','coupon','deal aggregator','marketplace','classifieds','podcast','software','digital services act','jobs','career','stock photo'
];

const TYPE_WORDS = {
  all: ['bike shop','bicycle shop','cycling store','dealer','distributor','wholesale','importer','repair','workshop','parts','accessories'],
  shop: ['bike shop','bicycle shop','cycling store','bike store','retailer','retail','fahrradladen','radladen','fahrradgeschäft','velos shop','cycle shop'],
  dealer: ['dealer','bike dealer','bicycle dealer','cycling dealer','authorized dealer','händler','haendler','fahrrad händler','fahrradhaendler'],
  distributor: ['distributor','distribution','bike distributor','bicycle distributor','cycling distributor','importer','importeur','distributeur'],
  wholesale: ['wholesale','wholesaler','grosshandel','großhandel','bulk order','trade account','b2b'],
  importer: ['importer','importeur','import','exclusive distributor','national distributor'],
  repair: ['repair','workshop','service','bike service','cycle repair','fahrradwerkstatt','werkstatt']
};

function send(res, status, body, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function cleanText(html) {
  return decodeEntities(String(html || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/');
}

function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  s = decodeEntities(s);
  if (s.startsWith('//')) s = 'https:' + s;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    u.hash = '';
    const badParams = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid','msclkid'];
    badParams.forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch (_) { return ''; }
}

function domainFromUrl(u) {
  try { return new URL(u).hostname.replace(/^www\./i, '').toLowerCase(); }
  catch (_) { return ''; }
}

function sameDomain(a, b) {
  const da = domainFromUrl(a), db = domainFromUrl(b);
  return da && db && (da === db || da.endsWith('.' + db) || db.endsWith('.' + da));
}

function isExcludedDomain(url, extra) {
  const d = domainFromUrl(url);
  if (!d) return true;
  const list = HARD_EXCLUDE_DOMAINS.concat(extra || []).map(x => String(x).trim().toLowerCase()).filter(Boolean);
  return list.some(x => d.includes(x.replace(/^https?:\/\//, '').replace(/^www\./, '')));
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs || PAGE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.6'
      }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const type = resp.headers.get('content-type') || '';
    if (type && !/text|html|xml|json/i.test(type)) throw new Error('Unsupported content-type ' + type);
    const txt = await resp.text();
    return txt.slice(0, MAX_HTML_CHARS);
  } finally {
    clearTimeout(t);
  }
}

function extractTitle(html, url) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = m ? cleanText(m[1]).slice(0, 160) : '';
  return title || domainFromUrl(url) || url;
}

function extractEmails(text) {
  const raw = String(text || '')
    .replace(/\s*\[at\]\s*/gi, '@')
    .replace(/\s*\(at\)\s*/gi, '@')
    .replace(/\s+at\s+/gi, '@')
    .replace(/\s*\[dot\]\s*/gi, '.')
    .replace(/\s*\(dot\)\s*/gi, '.')
    .replace(/\s+dot\s+/gi, '.');
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const out = new Set();
  let m;
  while ((m = re.exec(raw)) !== null) {
    let e = m[0].toLowerCase().replace(/[).,;:]+$/g, '');
    if (e.length > 6 && !e.includes('example.') && !e.includes('sentry.io')) out.add(e);
  }
  return Array.from(out).slice(0, 20);
}

function extractPhones(text) {
  const re = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{3,5}(?:[\s.-]?\d{2,5})?/g;
  const out = new Set();
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const p = m[0].replace(/\s+/g, ' ').trim();
    const digits = p.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 16 && !/^20\d{6,}/.test(digits)) out.add(p);
  }
  return Array.from(out).slice(0, 5);
}

function extractLinks(html, baseUrl) {
  const out = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    let href = decodeEntities(m[1]);
    if (!href || href.startsWith('#') || /^mailto:|^tel:|^javascript:/i.test(href)) continue;
    try {
      if (href.startsWith('/url?') || href.includes('/url?q=')) {
        const q = new URL(href, 'https://example.com').searchParams.get('q');
        if (q) href = q;
      }
      if (href.includes('uddg=')) {
        const q = new URL(href, 'https://duckduckgo.com').searchParams.get('uddg');
        if (q) href = decodeURIComponent(q);
      }
      const u = new URL(href, baseUrl).toString();
      const norm = normalizeUrl(u);
      if (norm) out.push(norm);
    } catch (_) {}
  }
  return Array.from(new Set(out));
}

function pickContactLinks(html, baseUrl) {
  const links = extractLinks(html, baseUrl).filter(u => sameDomain(u, baseUrl));
  const important = ['contact','kontakt','about','impressum','dealer','distributor','wholesale','trade','b2b','retail','stores','shop','service','support','team'];
  return links
    .map(u => ({ url: u, score: important.reduce((n, w) => n + (u.toLowerCase().includes(w) ? 1 : 0), 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.url)
    .slice(0, 6);
}

function parseCsvWords(s) {
  return String(s || '').split(/[\n,，;；]+/).map(x => x.trim()).filter(Boolean);
}

function unique(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }

function choosePriorityEmail(emails) {
  if (!emails || !emails.length) return '';
  const high = ['sales','wholesale','dealer','distributor','trade','order','export','b2b','procurement','purchasing','info','contact','hello'];
  const low = ['noreply','no-reply','privacy','abuse','legal','press','career','jobs','support'];
  return emails.slice().sort((a,b) => {
    const sa = high.reduce((n,w)=> n + (a.includes(w) ? 10 : 0), 0) - low.reduce((n,w)=> n + (a.includes(w) ? 8 : 0), 0);
    const sb = high.reduce((n,w)=> n + (b.includes(w) ? 10 : 0), 0) - low.reduce((n,w)=> n + (b.includes(w) ? 8 : 0), 0);
    return sb - sa;
  })[0];
}

function labelType(type) {
  return ({shop:'门店/零售店', dealer:'经销商', distributor:'分销商', wholesale:'批发商', importer:'进口商', repair:'维修/服务店', all:'综合'})[type] || type || '综合';
}

function inferType(text, url) {
  const hay = (text + ' ' + url).toLowerCase();
  const scores = {};
  for (const [type, words] of Object.entries(TYPE_WORDS)) {
    if (type === 'all') continue;
    scores[type] = words.reduce((n,w) => n + (hay.includes(w) ? 1 : 0), 0);
  }
  const best = Object.entries(scores).sort((a,b)=>b[1]-a[1])[0];
  return best && best[1] > 0 ? best[0] : 'shop';
}

function includesAny(hay, words) {
  hay = String(hay || '').toLowerCase();
  return (words || []).some(w => w && hay.includes(String(w).toLowerCase()));
}

function countMatches(hay, words) {
  hay = String(hay || '').toLowerCase();
  return (words || []).reduce((n,w) => n + (w && hay.includes(String(w).toLowerCase()) ? 1 : 0), 0);
}

function scoreSite(data, opts) {
  const title = data.title || '';
  const url = data.url || '';
  const domain = domainFromUrl(url);
  const hay = (title + ' ' + domain + ' ' + (data.text || '')).toLowerCase();
  const countries = parseCsvWords(opts.countries);
  const cities = parseCsvWords(opts.cities);
  const products = parseCsvWords(opts.productTags);
  const must = parseCsvWords(opts.mustInclude);
  const selectedType = opts.customerType || 'all';
  const typeWords = TYPE_WORDS[selectedType] || TYPE_WORDS.all;

  let score = 0;
  let match = 0;
  const tags = [];

  const posHits = countMatches(hay, POSITIVE_WORDS);
  score += Math.min(30, posHits * 5);
  match += Math.min(30, posHits * 4);

  const typeHits = countMatches(hay, typeWords);
  if (typeHits > 0) { score += Math.min(25, typeHits * 8); match += Math.min(35, typeHits * 10); tags.push(labelType(selectedType)); }

  const productHits = countMatches(hay, products);
  if (productHits > 0) { score += Math.min(20, productHits * 7); match += Math.min(20, productHits * 6); tags.push('产品相关'); }

  const mustHits = must.length ? countMatches(hay, must) : 1;
  if (must.length && mustHits === 0) { score -= 30; match -= 30; }
  if (must.length && mustHits > 0) { score += Math.min(20, mustHits * 6); match += Math.min(20, mustHits * 6); tags.push('必须词命中'); }

  const locHits = countMatches(hay + ' ' + url, countries.concat(cities));
  if (locHits > 0) { score += Math.min(20, locHits * 7); match += Math.min(15, locHits * 5); tags.push('地区相关'); }

  if (data.emails.length) score += 25;
  if (data.phones.length) score += 10;
  if (data.contactUrl) score += 8;

  const negHits = countMatches(hay, NEGATIVE_WORDS);
  if (negHits > 0) { score -= Math.min(40, negHits * 12); match -= Math.min(30, negHits * 10); tags.push('疑似内容站'); }

  const type = inferType(hay, url);
  if (selectedType !== 'all' && type !== selectedType && typeHits === 0) {
    match -= 15;
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    match: Math.max(0, Math.min(100, Math.round(match))),
    type,
    tags: unique(tags)
  };
}

function shouldKeep(result, opts) {
  const extraExcludes = parseCsvWords(opts.excludeWords);
  const hay = [result.url, result.title, result.notes, result.tags.join(' ')].join(' ').toLowerCase();
  if (extraExcludes.some(w => hay.includes(w.toLowerCase()))) return false;
  if (opts.hideIrrelevant !== false && includesAny(hay, NEGATIVE_WORDS)) return false;
  if (opts.onlyEmail && !result.emails.length) return false;
  if (opts.onlyPhone && !result.phones.length) return false;
  if (Number(result.score) < Number(opts.minScore || 0)) return false;
  if (Number(result.match) < Number(opts.minMatch || 0)) return false;
  return true;
}

function makeQueries(opts) {
  const countries = parseCsvWords(opts.countries || opts.country || '');
  const cities = parseCsvWords(opts.cities || opts.city || '');
  const keyword = String(opts.keyword || '').trim();
  const products = parseCsvWords(opts.productTags);
  const must = parseCsvWords(opts.mustInclude);
  const type = opts.customerType || 'all';
  const typeWords = (TYPE_WORDS[type] || TYPE_WORDS.all).slice(0, 5);
  const locs = [];
  if (cities.length || countries.length) {
    if (cities.length && countries.length) {
      for (const c of cities) for (const country of countries) locs.push((c + ' ' + country).trim());
    } else {
      locs.push(...cities, ...countries);
    }
  } else {
    locs.push('');
  }
  const terms = unique([keyword].concat(typeWords).concat(products).concat(must)).filter(Boolean).slice(0, 10);
  const queries = [];
  for (const loc of locs.slice(0, 6)) {
    for (const term of terms.slice(0, 8)) {
      queries.push([term, loc, 'contact email'].filter(Boolean).join(' '));
      if (queries.length >= MAX_SEARCH_QUERIES) return queries;
    }
  }
  return queries.slice(0, MAX_SEARCH_QUERIES);
}

async function searchWeb(opts) {
  const queries = makeQueries(opts);
  const extraExcludes = parseCsvWords(opts.excludeWords);
  const found = new Set();
  for (const q of queries) {
    const urls = [
      'https://www.bing.com/search?q=' + encodeURIComponent(q),
      'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q)
    ];
    for (const searchUrl of urls) {
      try {
        const html = await fetchText(searchUrl, SEARCH_TIMEOUT_MS);
        const links = extractLinks(html, searchUrl);
        for (const link of links) {
          const norm = normalizeUrl(link);
          if (!norm) continue;
          if (isExcludedDomain(norm, extraExcludes)) continue;
          found.add(norm);
          if (found.size >= MAX_CANDIDATES) break;
        }
      } catch (_) {}
      if (found.size >= MAX_CANDIDATES) break;
    }
    if (found.size >= MAX_CANDIDATES) break;
  }
  return Array.from(found);
}

function reduceToRootUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    const norm = normalizeUrl(u);
    if (!norm) continue;
    try {
      const x = new URL(norm);
      const root = x.origin + '/';
      const key = domainFromUrl(root);
      if (!seen.has(key)) { seen.add(key); out.push(root); }
    } catch (_) {}
  }
  return out;
}

async function analyzeSite(url, opts) {
  const root = normalizeUrl(url);
  const extraExcludes = parseCsvWords(opts.excludeWords);
  if (!root || isExcludedDomain(root, extraExcludes)) return null;
  let html = '';
  let notes = [];
  try {
    html = await fetchText(root, PAGE_TIMEOUT_MS);
  } catch (err) {
    return {
      url: root, title: domainFromUrl(root), phones: [], emails: [], priorityEmail: '', contactUrl: '', notes: 'Homepage ' + err.message,
      score: 0, match: 0, type: 'unknown', tags: []
    };
  }

  const title = extractTitle(html, root);
  const pages = [{ url: root, html }];
  const contacts = pickContactLinks(html, root);
  for (const link of contacts) {
    if (pages.length >= 7) break;
    try {
      const h = await fetchText(link, PAGE_TIMEOUT_MS);
      pages.push({ url: link, html: h });
    } catch (_) {}
  }

  let allText = '';
  let emails = [];
  let phones = [];
  let contactUrl = '';
  for (const p of pages) {
    const txt = cleanText(p.html);
    allText += ' ' + txt + ' ' + p.url;
    emails = emails.concat(extractEmails(p.html + ' ' + txt));
    phones = phones.concat(extractPhones(txt));
    if (!contactUrl && /contact|kontakt|impressum|dealer|wholesale|trade|b2b/i.test(p.url)) contactUrl = p.url;
  }
  emails = unique(emails).slice(0, 20);
  phones = unique(phones).slice(0, 5);
  const priorityEmail = choosePriorityEmail(emails);
  const scored = scoreSite({ url: root, title, text: allText, emails, phones, contactUrl }, opts);
  if (!emails.length) notes.push('No public email found');
  if (!phones.length) notes.push('No phone found');
  notes.push('Checked ' + pages.length + ' pages');
  return {
    url: root,
    title,
    phones,
    emails,
    priorityEmail,
    contactUrl,
    notes: notes.join('; '),
    score: scored.score,
    match: scored.match,
    type: scored.type,
    tags: scored.tags
  };
}

async function scrape(opts) {
  const limit = Math.max(1, Math.min(100, Number(opts.limit || 20)));
  const manual = String(opts.manualUrls || '').split(/[\n\s,，]+/).map(normalizeUrl).filter(Boolean);
  let candidates = [];
  let sourceMode = 'search';
  if (manual.length) {
    candidates = reduceToRootUrls(manual);
    sourceMode = 'manual';
  } else {
    candidates = reduceToRootUrls(await searchWeb(opts));
  }

  const results = [];
  const errors = [];
  const maxToAnalyze = Math.min(candidates.length, Math.max(limit * 4, 20));
  for (const u of candidates.slice(0, maxToAnalyze)) {
    if (results.length >= limit) break;
    try {
      const r = await analyzeSite(u, opts);
      if (!r) continue;
      if (shouldKeep(r, opts)) results.push(r);
    } catch (err) {
      errors.push(domainFromUrl(u) + ': ' + err.message);
    }
  }
  results.sort((a,b) => (b.score - a.score) || (b.match - a.match));
  return { version: VERSION, sourceMode, candidates: candidates.length, results: results.slice(0, limit), errors: errors.slice(0, 10) };
}

function pageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>全球骑行配件 B2B 线索采集工具 - ${VERSION}</title>
<style>
:root{--bg:#f4f6fb;--card:#fff;--text:#0f172a;--muted:#64748b;--line:#dbe3ef;--brand:#101827;--orange:#fff7ed;--orangeBorder:#fdba74;--orangeText:#9a3412;--green:#d1fae5;--greenText:#065f46;--blue:#2563eb;}
*{box-sizing:border-box} body{margin:0;background:var(--bg);font-family:Arial,'Microsoft YaHei',sans-serif;color:var(--text);}
.wrap{max-width:1280px;margin:34px auto;padding:0 18px}.card{background:var(--card);border:1px solid #e5e7eb;border-radius:18px;padding:26px;box-shadow:0 18px 45px rgba(15,23,42,.07);margin-bottom:22px}
h1{font-size:30px;margin:0 0 8px;font-weight:800}.badge{display:inline-block;font-size:13px;padding:6px 12px;border-radius:999px;background:var(--green);color:var(--greenText);vertical-align:middle;margin-left:10px}.sub{color:#475569;margin:0 0 18px;line-height:1.6}.notice{background:var(--orange);border:1px solid var(--orangeBorder);border-radius:12px;color:var(--orangeText);padding:14px 16px;line-height:1.55;margin:14px 0 20px}.hint{color:var(--muted);font-size:13px;margin:8px 0}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px;align-items:end}.field{position:relative;z-index:2}.field label{display:block;font-size:14px;color:#334155;margin:0 0 7px}.field input,.field select,.field textarea{width:100%;border:1px solid #cbd5e1;border-radius:12px;padding:12px 14px;font-size:16px;background:#fff;outline:none}.field input:focus,.field textarea:focus,.field select:focus{border-color:#111827;box-shadow:0 0 0 2px rgba(17,24,39,.12)}textarea{min-height:92px;resize:vertical}.span-12{grid-column:span 12}.span-6{grid-column:span 6}.span-4{grid-column:span 4}.span-3{grid-column:span 3}.span-2{grid-column:span 2}.span-1{grid-column:span 1}.btnBox{position:relative;z-index:30;display:flex;gap:10px;align-items:end}.btn{border:0;border-radius:13px;padding:13px 20px;font-weight:800;font-size:17px;cursor:pointer;line-height:1;background:var(--brand);color:#fff;min-height:50px;white-space:nowrap;position:relative;z-index:99;pointer-events:auto}.btn:hover{filter:brightness(1.08)}.btn:disabled{opacity:.6;cursor:not-allowed}.btn.secondary{background:#64748b}.checks{display:flex;gap:18px;flex-wrap:wrap;margin-top:10px;color:#334155;font-size:14px}.checks label{display:flex;gap:6px;align-items:center}.progressOuter{height:12px;background:#e5e7eb;border-radius:999px;overflow:hidden;margin-top:12px}.progress{height:100%;width:0%;background:#111827;transition:width .25s ease}.status{font-size:15px;color:#334155;margin-top:12px}.toolbar{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:14px}.resultTitle{font-size:24px;font-weight:800}.download{background:#334155;color:#fff;border:0;border-radius:12px;padding:12px 20px;font-size:16px;font-weight:800;cursor:pointer}.download:disabled{background:#9ca3af;cursor:not-allowed}.tableWrap{overflow:auto;border:1px solid #e2e8f0;border-radius:14px}table{width:100%;border-collapse:collapse;min-width:1120px}th,td{border-bottom:1px solid #e2e8f0;padding:12px;vertical-align:top;text-align:left;font-size:14px}th{background:#f8fafc;font-weight:800}a{color:#2563eb;text-decoration:none}.small{font-size:12px;color:#64748b}.pill{display:inline-block;margin:2px 3px 0 0;background:#eef2ff;color:#3730a3;border-radius:999px;padding:3px 7px;font-size:12px}.score{display:inline-block;background:#eef2ff;color:#4338ca;border-radius:999px;padding:4px 8px;font-weight:700}.debug{font-size:12px;color:#64748b;margin-top:10px;white-space:pre-wrap}.rowNote{color:#64748b}.email{font-weight:800}.buttonTest{font-size:12px;color:#64748b;margin-top:6px}
@media(max-width:900px){.span-6,.span-4,.span-3,.span-2,.span-1{grid-column:span 12}.btnBox{justify-content:stretch}.btn{width:100%}}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>全球骑行配件 B2B 线索采集工具 <span class="badge">${VERSION}</span></h1>
    <p class="sub">面向全球寻找自行车店、骑行店、配件经销商、批发商、分销商、进口商官网，并从公开页面提取邮箱和电话。</p>
    <div class="notice"><b>说明：</b> 免费版不调用 Google Maps/Places，所以没有稳定的地图商家电话、地址和前 100 商家保证。系统会过滤 Microsoft/搜索引擎帮助页、品牌官网、新闻测评和无关平台。若搜索不准，建议直接粘贴官网列表。</div>

    <form id="leadForm" onsubmit="return window.startScrape(event);">
      <div class="grid">
        <div class="field span-12">
          <label>可选：直接粘贴官网列表，一行一个。填了这里会优先分析这些网站，不依赖公开搜索。</label>
          <textarea id="manualUrls" placeholder="例如：\nhttps://example-bike-shop.de\nhttps://example-distributor.com"></textarea>
        </div>

        <div class="field span-3">
          <label>目标客户类型</label>
          <select id="customerType">
            <option value="all">全部：店/经销商/分销商</option>
            <option value="shop">门店/零售店</option>
            <option value="dealer" selected>经销商 Dealer</option>
            <option value="distributor">分销商 Distributor</option>
            <option value="wholesale">批发商 Wholesale</option>
            <option value="importer">进口商 Importer</option>
            <option value="repair">维修/服务店</option>
          </select>
        </div>
        <div class="field span-3">
          <label>国家/市场，可多个</label>
          <input id="countries" value="Germany" placeholder="Germany, France, USA, Japan" />
        </div>
        <div class="field span-3">
          <label>城市/地区，可多个</label>
          <input id="cities" value="Berlin" placeholder="Berlin, Paris, Los Angeles" />
        </div>
        <div class="field span-3">
          <label>目标数量</label>
          <input id="limit" type="number" min="1" max="100" value="10" />
        </div>

        <div class="field span-4">
          <label>主搜索关键词</label>
          <input id="keyword" value="bike dealer" placeholder="bike dealer / cycling accessories distributor" />
        </div>
        <div class="field span-4">
          <label>产品方向标签</label>
          <input id="productTags" value="bike parts, cycling accessories, power meter, crankset" placeholder="power meter, crankset, bike parts" />
        </div>
        <div class="field span-4">
          <label>必须包含关键词</label>
          <input id="mustInclude" value="bike,bicycle,cycling,dealer,shop,distributor,parts" placeholder="bike,bicycle,cycling,dealer,parts" />
        </div>

        <div class="field span-3">
          <label>排除关键词/域名</label>
          <input id="excludeWords" value="microsoft,bing,cyclingnews,news,review,forum,amazon,ebay,trek,giant" />
        </div>
        <div class="field span-2">
          <label>最低总分</label>
          <input id="minScore" type="number" min="0" max="100" value="45" />
        </div>
        <div class="field span-2">
          <label>最低匹配度</label>
          <input id="minMatch" type="number" min="0" max="100" value="35" />
        </div>
        <div class="field span-2">
          <label>搜索策略</label>
          <select id="strictMode">
            <option value="normal" selected>正常</option>
            <option value="strict">严格过滤</option>
            <option value="loose">宽松</option>
          </select>
        </div>
        <div class="field span-3 btnBox">
          <button id="startBtn" class="btn" type="submit" onclick="return window.startScrape(event);">开始提取</button>
          <button id="stopBtn" class="btn secondary" type="button" onclick="window.stopScrape();" disabled>停止</button>
        </div>

        <div class="span-12 checks">
          <label><input id="onlyEmail" type="checkbox" checked /> 只看有邮箱</label>
          <label><input id="onlyPhone" type="checkbox" /> 只看有电话</label>
          <label><input id="hideIrrelevant" type="checkbox" checked /> 隐藏新闻/测评/论坛/平台页</label>
          <label><input id="sortByScore" type="checkbox" checked /> 按分数排序</label>
        </div>
      </div>
    </form>

    <div id="status" class="status">准备就绪</div>
    <div class="progressOuter"><div id="progress" class="progress"></div></div>
    <div class="buttonTest">提示：如果按钮点击无反应，把光标放在任意输入框里按 Enter 也会开始；本版同时绑定了按钮 click 和表单 submit。</div>
    <div id="debug" class="debug"></div>
  </div>

  <div class="card">
    <div class="toolbar">
      <div class="resultTitle">结果 <span id="count">0</span> 条</div>
      <button id="downloadBtn" class="download" disabled onclick="window.downloadCsv();">下载筛选后 CSV</button>
    </div>
    <div class="tableWrap">
      <table>
        <thead><tr><th>分数</th><th>匹配度</th><th>类型</th><th>公司/网站</th><th>电话</th><th>优先邮箱</th><th>全部邮箱</th><th>Contact 页面</th><th>备注</th></tr></thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>
  </div>
</div>
<script>
(function(){
  var rows = [];
  var running = false;
  var controller = null;
  var timer = null;
  var tick = 0;
  function byId(id){ return document.getElementById(id); }
  function val(id){ var el = byId(id); return el ? el.value : ''; }
  function checked(id){ var el = byId(id); return !!(el && el.checked); }
  function escClient(s){ return String(s == null ? '' : s).replace(/[&<>'"]/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]; }); }
  function domainFromUrl(url){ try { return new URL(url).hostname.replace(/^www\./,''); } catch(e){ return url; } }
  function labelType(t){ return ({shop:'门店',dealer:'经销商',distributor:'分销商',wholesale:'批发商',importer:'进口商',repair:'维修店',unknown:'未知'}[t] || t || '综合'); }
  function setStatus(s){ byId('status').textContent = s; }
  function setProgress(p){ byId('progress').style.width = Math.max(0, Math.min(100, p)) + '%'; }
  function payload(){
    var strict = val('strictMode');
    var minScore = Number(val('minScore') || 0);
    var minMatch = Number(val('minMatch') || 0);
    if (strict === 'strict') { minScore = Math.max(minScore, 60); minMatch = Math.max(minMatch, 55); }
    if (strict === 'loose') { minScore = Math.min(minScore, 20); minMatch = Math.min(minMatch, 20); }
    return {
      manualUrls: val('manualUrls'),
      customerType: val('customerType'),
      countries: val('countries'),
      cities: val('cities'),
      limit: Number(val('limit') || 10),
      keyword: val('keyword'),
      productTags: val('productTags'),
      mustInclude: val('mustInclude'),
      excludeWords: val('excludeWords'),
      minScore: minScore,
      minMatch: minMatch,
      onlyEmail: checked('onlyEmail'),
      onlyPhone: checked('onlyPhone'),
      hideIrrelevant: checked('hideIrrelevant')
    };
  }
  window.startScrape = async function(event){
    if (event && event.preventDefault) event.preventDefault();
    if (running) return false;
    running = true;
    rows = [];
    render();
    controller = new AbortController();
    byId('startBtn').disabled = true;
    byId('stopBtn').disabled = false;
    byId('downloadBtn').disabled = true;
    byId('debug').textContent = '';
    tick = 0;
    setProgress(7);
    setStatus('已触发，正在提交任务...');
    timer = setInterval(function(){ tick += 1; setProgress(Math.min(92, 7 + tick * 3)); setStatus('正在搜索和分析公开网站... 已等待 ' + tick + ' 秒'); }, 1000);
    try {
      var resp = await fetch('/api/scrape', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload()), signal: controller.signal });
      var data = await resp.json();
      if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
      rows = data.results || [];
      if (checked('sortByScore')) rows.sort(function(a,b){ return (b.score-a.score) || (b.match-a.match); });
      setProgress(100);
      setStatus('完成：找到 ' + rows.length + ' 条线索；候选网站 ' + (data.candidates || 0) + ' 个；模式：' + (data.sourceMode || 'search'));
      if (data.errors && data.errors.length) byId('debug').textContent = '部分站点失败：\n' + data.errors.join('\n');
      render();
    } catch (err) {
      if (err.name === 'AbortError') setStatus('已停止');
      else setStatus('出错：' + err.message);
      byId('debug').textContent = '建议：目标数量先设为 5；或直接粘贴官网列表。';
    } finally {
      running = false;
      clearInterval(timer);
      byId('startBtn').disabled = false;
      byId('stopBtn').disabled = true;
      byId('downloadBtn').disabled = rows.length === 0;
    }
    return false;
  };
  window.stopScrape = function(){ if (controller) controller.abort(); };
  function render(){
    byId('count').textContent = rows.length;
    byId('downloadBtn').disabled = rows.length === 0;
    byId('tbody').innerHTML = rows.map(function(r){
      var tags = (r.tags || []).map(function(t){ return '<span class="pill">' + escClient(t) + '</span>'; }).join(' ');
      return '<tr>'+
        '<td><span class="score">' + escClient(r.score) + '</span></td>'+
        '<td><span class="score">' + escClient(r.match) + '</span></td>'+
        '<td>' + escClient(labelType(r.type)) + '<br>' + tags + '</td>'+
        '<td><b>' + escClient(r.title || domainFromUrl(r.url)) + '</b><br><a href="' + escClient(r.url) + '" target="_blank">' + escClient(r.url) + '</a></td>'+
        '<td>' + escClient((r.phones || []).join('; ')) + '</td>'+
        '<td><span class="email">' + escClient(r.priorityEmail || '') + '</span></td>'+
        '<td>' + escClient((r.emails || []).join('; ')) + '</td>'+
        '<td>' + (r.contactUrl ? '<a href="' + escClient(r.contactUrl) + '" target="_blank">打开</a>' : '') + '</td>'+
        '<td class="rowNote">' + escClient(r.notes || '') + '</td>'+
      '</tr>';
    }).join('');
  }
  window.downloadCsv = function(){
    if (!rows.length) return;
    var headers = ['score','match','type','title','url','phones','priority_email','emails','contact_url','tags','notes'];
    var lines = [headers.join(',')];
    rows.forEach(function(r){
      var vals = [r.score,r.match,labelType(r.type),r.title,r.url,(r.phones||[]).join('; '),r.priorityEmail,(r.emails||[]).join('; '),r.contactUrl,(r.tags||[]).join('; '),r.notes];
      lines.push(vals.map(function(v){ return '"' + String(v == null ? '' : v).replace(/"/g,'""') + '"'; }).join(','));
    });
    var blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'global-cycling-b2b-leads-v6.csv';
    document.body.appendChild(a); a.click(); a.remove();
  };
  document.addEventListener('DOMContentLoaded', function(){
    var form = byId('leadForm');
    var btn = byId('startBtn');
    if (form) form.addEventListener('submit', window.startScrape);
    if (btn) btn.addEventListener('click', window.startScrape);
    document.addEventListener('keydown', function(e){ if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) window.startScrape(e); });
  });
})();
</script>
</body>
</html>`;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, pageHtml(), 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true, version: VERSION });
  if (req.method === 'POST' && url.pathname === '/api/scrape') {
    try {
      const body = await readJson(req);
      const data = await scrape(body);
      return sendJson(res, 200, data);
    } catch (err) {
      return sendJson(res, 500, { error: err.message, version: VERSION });
    }
  }
  return send(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => sendJson(res, 500, { error: err.message, version: VERSION }));
});
server.listen(PORT, () => {
  console.log('B2B Lead Scraper running.');
  console.log('Version:', VERSION);
  console.log('Port:', PORT);
});
