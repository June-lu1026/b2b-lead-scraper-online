'use strict';

const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const VERSION = 'v6.6 稳定筛选版';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_TOTAL_MS = 28000;
const SEARCH_TIMEOUT_MS = 6500;
const PAGE_TIMEOUT_MS = 6500;
const MAX_ANALYZE_PAGES_PER_SITE = 4;

const DEFAULT_EXCLUDES = [
  'microsoft','bing.com','google.com','duckduckgo.com','yahoo.com','youtube.com','youtu.be','facebook.com','instagram.com','linkedin.com','x.com','twitter.com',
  'wikipedia.org','amazon.','ebay.','reddit.com','quora.com','pinterest.','aliexpress.','alibaba.','temu.','tiktok.com',
  'cyclingnews','bikeradar','road.cc','pinkbike','singletracks','bikepacking','outsideonline','review','reviews','forum','forums','blog','news','magazine',
  'trekbikes.com','specialized.com','giant-bicycles.com','canyon.com','shimano.com','sram.com','garmin.com','cannondale.com','cube.eu','scott-sports.com'
];

const TYPE_CONFIG = {
  all: { label: '全部类型', terms: ['bike shop','bicycle shop','cycling store','bike dealer','bicycle dealer','bike parts','cycling accessories','fahrradladen','fahrrad handler','fahrradhändler'] },
  shop: { label: '自行车店 / 门店', terms: ['bike shop','bicycle shop','cycling store','bike store','fahrradladen','radladen','fahrradgeschäft'] },
  dealer: { label: '经销商 Dealer', terms: ['bike dealer','bicycle dealer','cycling dealer','fahrrad händler','fahrradhaendler','authorized dealer'] },
  distributor: { label: '分销商 Distributor', terms: ['bike distributor','bicycle distributor','cycling distributor','bicycle parts distributor','cycling accessories distributor'] },
  wholesaler: { label: '批发商 Wholesale', terms: ['bike wholesale','bicycle wholesale','cycling wholesale','bike parts wholesale','cycling accessories wholesale','wholesaler'] },
  importer: { label: '进口商 Importer', terms: ['bike importer','bicycle importer','cycling importer','bike parts importer','cycling accessories importer'] },
  repair: { label: '维修店 / Workshop', terms: ['bike repair','bicycle repair','bike workshop','cycle repair','fahrrad werkstatt','fahrradwerkstatt'] }
};

const COUNTRY_HINTS = {
  germany: { tlds: ['.de'], words: ['germany','deutschland','german','berlin','hamburg','munich','münchen','cologne','köln','frankfurt','stuttgart','düsseldorf','dusseldorf'] },
  france: { tlds: ['.fr'], words: ['france','français','francais','paris','lyon','marseille','toulouse','nice','bordeaux'] },
  usa: { tlds: ['.com','.us'], words: ['usa','united states','america','new york','los angeles','chicago','seattle','california','texas'] },
  'united states': { tlds: ['.com','.us'], words: ['usa','united states','america','new york','los angeles','chicago','seattle','california','texas'] },
  uk: { tlds: ['.co.uk','.uk'], words: ['uk','united kingdom','britain','england','london','manchester','birmingham'] },
  italy: { tlds: ['.it'], words: ['italy','italia','italiano','milan','milano','rome','roma','torino'] },
  spain: { tlds: ['.es'], words: ['spain','españa','espana','madrid','barcelona','valencia'] },
  netherlands: { tlds: ['.nl'], words: ['netherlands','nederland','dutch','amsterdam','rotterdam','utrecht'] },
  belgium: { tlds: ['.be'], words: ['belgium','belgië','belgique','brussels','bruxelles','antwerp'] },
  switzerland: { tlds: ['.ch'], words: ['switzerland','schweiz','suisse','zürich','zurich','geneva','bern'] },
  austria: { tlds: ['.at'], words: ['austria','österreich','osterreich','vienna','wien','salzburg'] },
  canada: { tlds: ['.ca'], words: ['canada','toronto','vancouver','montreal','ottawa','calgary'] },
  australia: { tlds: ['.com.au','.au'], words: ['australia','sydney','melbourne','brisbane','perth'] },
  japan: { tlds: ['.jp'], words: ['japan','日本','tokyo','osaka','kyoto','yokohama'] },
  korea: { tlds: ['.kr'], words: ['korea','south korea','seoul','busan'] },
  taiwan: { tlds: ['.tw'], words: ['taiwan','台灣','台湾','taipei','taichung'] }
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function getParam(q, key, fallback = '') {
  const val = q.get(key);
  return val == null || val === '' ? fallback : val;
}

function splitList(s) {
  return String(s || '')
    .split(/[\n,;，；]+/)
    .map(x => x.trim())
    .filter(Boolean);
}

function normalizeUrl(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const url = new URL(s);
    url.hash = '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

function domainFromUrl(u) {
  try {
    return new URL(u).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return '';
  }
}

function dedupeByDomain(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const d = domainFromUrl(item.url);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push({ ...item, domain: d });
  }
  return out;
}

function isExcluded(item, excludeTerms) {
  const hay = `${item.url || ''} ${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  return excludeTerms.some(t => t && hay.includes(t.toLowerCase()));
}

function findEmails(text) {
  const matches = String(text || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  return [...new Set(matches.map(e => e.toLowerCase()).filter(e => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(e)))];
}

function findPhones(text) {
  const matches = String(text || '').match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
  return [...new Set(matches.map(p => p.replace(/\s+/g, ' ').trim()).filter(p => p.replace(/\D/g, '').length >= 8))].slice(0, 3);
}

function pickEmail(emails) {
  const priority = ['sales@','wholesale@','dealer@','distributor@','export@','info@','contact@','office@','hello@','service@'];
  for (const p of priority) {
    const found = emails.find(e => e.startsWith(p));
    if (found) return found;
  }
  return emails[0] || '';
}

function emailType(email) {
  if (!email) return '';
  if (/^(sales|wholesale|dealer|distributor|export|partners|b2b)@/i.test(email)) return 'high-value-business';
  if (/^(info|contact|office|hello)@/i.test(email)) return 'general-business';
  if (/^(support|service|customer)@/i.test(email)) return 'service';
  return 'other';
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      redirect: 'follow'
    });
    if (!res.ok) return { ok: false, status: res.status, text: '' };
    const text = await res.text();
    return { ok: true, status: res.status, text: text.slice(0, 550000) };
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e.name || e.message };
  } finally {
    clearTimeout(timer);
  }
}

function parseRssItems(xml) {
  const out = [];
  const re = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?(?:<description>([\s\S]*?)<\/description>)?[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const title = decodeEntities(m[1] || '').replace(/<[^>]+>/g, ' ');
    const url = normalizeUrl(decodeEntities(m[2] || ''));
    const snippet = decodeEntities(m[3] || '').replace(/<[^>]+>/g, ' ');
    if (url) out.push({ title, url, snippet, source: 'bing-rss' });
  }
  return out;
}

function parseDuck(html) {
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,900}?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>)?/gi;
  let m;
  while ((m = re.exec(html))) {
    let raw = decodeEntities(m[1] || '');
    try {
      if (raw.startsWith('/l/')) {
        const ddg = new URL('https://duckduckgo.com' + raw);
        raw = ddg.searchParams.get('uddg') || raw;
      }
    } catch (_) {}
    const url = normalizeUrl(raw);
    const title = decodeEntities(m[2] || '').replace(/<[^>]+>/g, ' ');
    const snippet = decodeEntities(m[3] || m[4] || '').replace(/<[^>]+>/g, ' ');
    if (url) out.push({ title, url, snippet, source: 'duckduckgo' });
  }
  return out;
}

function buildQueries(p) {
  const countries = splitList(p.country);
  const cities = splitList(p.city);
  const type = TYPE_CONFIG[p.type] || TYPE_CONFIG.all;
  const base = splitList(`${p.mainKeyword},${p.productTags}`).slice(0, 6).join(' ');
  const countryList = countries.length ? countries : [''];
  const cityList = cities.length ? cities : [''];
  const queries = [];
  for (const country of countryList) {
    for (const city of cityList) {
      const place = [city, country].filter(Boolean).join(' ');
      const typeTerm = type.terms[0] || '';
      queries.push(`${p.mainKeyword || typeTerm} ${base} ${place}`.trim());
      queries.push(`${typeTerm} ${base} ${place}`.trim());
      if (/germany|deutschland/i.test(country + ' ' + city)) {
        queries.push(`Fahrradladen Fahrradteile ${place}`.trim());
        queries.push(`Fahrrad Händler Zubehör ${place}`.trim());
      }
      if (/france|paris/i.test(country + ' ' + city)) queries.push(`magasin vélo pièces cyclisme ${place}`.trim());
      if (/spain|madrid|barcelona/i.test(country + ' ' + city)) queries.push(`tienda bicicletas accesorios ciclismo ${place}`.trim());
      if (/italy|milan|roma/i.test(country + ' ' + city)) queries.push(`negozio biciclette accessori ciclismo ${place}`.trim());
    }
  }
  return [...new Set(queries.filter(Boolean))].slice(0, p.strategy === 'wide' ? 8 : 5);
}

async function searchWeb(queries, limit, deadline) {
  const all = [];
  const usedQueries = [];
  for (const q of queries) {
    if (Date.now() > deadline || all.length >= limit * 3) break;
    usedQueries.push(q);
    const encoded = encodeURIComponent(q);
    const rssUrl = `https://www.bing.com/search?format=rss&q=${encoded}`;
    const rss = await fetchText(rssUrl, SEARCH_TIMEOUT_MS);
    if (rss.ok) all.push(...parseRssItems(rss.text));
    if (all.length < limit * 2 && Date.now() < deadline) {
      const duckUrl = `https://duckduckgo.com/html/?q=${encoded}`;
      const duck = await fetchText(duckUrl, SEARCH_TIMEOUT_MS);
      if (duck.ok) all.push(...parseDuck(duck.text));
    }
  }
  return { items: dedupeByDomain(all), usedQueries };
}

function scoreRegion(text, url, countries, cities) {
  const hay = `${text || ''} ${url || ''}`.toLowerCase();
  let countryScore = 0;
  let cityScore = 0;
  for (const country of countries) {
    const key = country.toLowerCase().trim();
    if (!key) continue;
    if (hay.includes(key)) countryScore += 20;
    const cfg = COUNTRY_HINTS[key] || COUNTRY_HINTS[key.replace(/^the\s+/i, '')];
    if (cfg) {
      if (cfg.tlds.some(t => hay.includes(t))) countryScore += 20;
      if (cfg.words.some(w => hay.includes(w.toLowerCase()))) countryScore += 15;
    }
  }
  for (const city of cities) {
    const c = city.toLowerCase().trim();
    if (c && hay.includes(c)) cityScore += 25;
  }
  return { countryScore: Math.min(countryScore, 50), cityScore: Math.min(cityScore, 50) };
}

function hasRequired(text, requiredTerms) {
  if (!requiredTerms.length) return true;
  const hay = String(text || '').toLowerCase();
  return requiredTerms.some(t => hay.includes(t.toLowerCase()));
}

function classifyType(text) {
  const hay = String(text || '').toLowerCase();
  const checks = [
    ['distributor', ['distributor','distribution','distributeur','distribuidor','vertrieb']],
    ['wholesaler', ['wholesale','wholesaler','grosshandel','großhandel','b2b']],
    ['dealer', ['dealer','händler','handler','retailer','authorized dealer']],
    ['shop', ['shop','store','fahrradladen','radladen','magasin','tienda','negozio']],
    ['repair', ['repair','workshop','werkstatt','service center']],
    ['importer', ['importer','import','importeur']]
  ];
  for (const [type, words] of checks) if (words.some(w => hay.includes(w))) return type;
  return 'unknown';
}

function labelType(type) {
  return ({ shop: '门店/Shop', dealer: '经销商/Dealer', distributor: '分销商/Distributor', wholesaler: '批发商/Wholesale', importer: '进口商/Importer', repair: '维修/Workshop', unknown: '未识别' })[type] || type;
}

function findContactLinks(baseUrl, html) {
  const links = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = decodeEntities(m[1] || '').trim();
    const text = decodeEntities(m[2] || '').replace(/<[^>]+>/g, ' ').trim().toLowerCase();
    const combined = `${href} ${text}`.toLowerCase();
    if (!/(contact|about|impressum|dealer|distributor|wholesale|b2b|retailer|shop|stores|kontakt|händler|handler|partner)/i.test(combined)) continue;
    try {
      const abs = new URL(href, baseUrl).toString();
      if (domainFromUrl(abs) === domainFromUrl(baseUrl)) links.push(abs);
    } catch (_) {}
  }
  return [...new Set(links)].slice(0, MAX_ANALYZE_PAGES_PER_SITE - 1);
}

async function analyzeSite(item, p, deadline) {
  const url = normalizeUrl(item.url);
  const domain = domainFromUrl(url);
  const notes = [];
  let allText = `${item.title || ''} ${item.snippet || ''} ${url}`;
  let htmlCombined = '';
  let contactUrl = '';
  let pagesChecked = 0;
  const first = await fetchText(url, PAGE_TIMEOUT_MS);
  pagesChecked += 1;
  if (!first.ok) {
    notes.push(`Homepage HTTP ${first.status || first.error || 'failed'}`);
  } else {
    htmlCombined += first.text;
    allText += ' ' + stripHtml(first.text);
    const links = findContactLinks(url, first.text);
    for (const link of links) {
      if (Date.now() > deadline) break;
      const res = await fetchText(link, PAGE_TIMEOUT_MS);
      pagesChecked += 1;
      if (res.ok) {
        if (!contactUrl) contactUrl = link;
        htmlCombined += ' ' + res.text;
        allText += ' ' + stripHtml(res.text);
      }
    }
  }
  const emails = findEmails(htmlCombined + ' ' + allText);
  const phones = findPhones(allText);
  const priorityEmail = pickEmail(emails);
  const type = classifyType(allText);
  const countries = splitList(p.country);
  const cities = splitList(p.city);
  const region = scoreRegion(allText, url, countries, cities);
  const requiredTerms = splitList(p.required);
  const typeTerms = (TYPE_CONFIG[p.type] || TYPE_CONFIG.all).terms;
  const typeMatch = p.type === 'all' || type === p.type || typeTerms.some(t => allText.toLowerCase().includes(t.toLowerCase()));
  const requiredOk = hasRequired(allText, requiredTerms);
  let match = 0;
  if (type !== 'unknown') match += 25;
  if (typeMatch) match += 25;
  if (requiredOk) match += 20;
  match += Math.min(30, region.countryScore + region.cityScore);
  if (emails.length) match += 15;
  let score = match;
  if (priorityEmail) score += emailType(priorityEmail) === 'high-value-business' ? 25 : 15;
  if (phones.length) score += 10;
  if (contactUrl) score += 10;
  if (notes.length === 0) notes.push(`Checked ${pagesChecked} pages`);
  return {
    score: Math.min(100, score),
    match: Math.min(100, match),
    type,
    title: item.title || domain,
    url,
    domain,
    phones,
    emails,
    priorityEmail,
    emailType: emailType(priorityEmail),
    contactUrl,
    notes: notes.join('; '),
    regionCountry: region.countryScore,
    regionCity: region.cityScore,
    requiredOk,
    typeMatch
  };
}

async function mapLimit(items, limit, fn) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = items[index++];
      const res = await fn(current);
      if (res) results.push(res);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function applyFilters(results, p) {
  const minScore = Number(p.minScore || 0);
  const minMatch = Number(p.minMatch || 0);
  const countries = splitList(p.country);
  const cities = splitList(p.city);
  const regionMode = p.regionMode || 'prefer';
  return results.filter(r => {
    if (p.emailOnly && !r.priorityEmail) return false;
    if (p.phoneOnly && !r.phones.length) return false;
    if (r.score < minScore || r.match < minMatch) return false;
    if (!r.requiredOk) return false;
    if (p.type !== 'all' && !r.typeMatch) return false;
    if (regionMode === 'strict') {
      if (countries.length && r.regionCountry <= 0) return false;
      if (cities.length && r.regionCity <= 0) return false;
    }
    return true;
  });
}

function sortResults(results, sort) {
  const arr = [...results];
  if (sort === 'match') arr.sort((a, b) => b.match - a.match || b.score - a.score);
  else if (sort === 'email') arr.sort((a, b) => Number(!!b.priorityEmail) - Number(!!a.priorityEmail) || b.score - a.score);
  else arr.sort((a, b) => b.score - a.score || b.match - a.match);
  return arr;
}

async function performSearch(p) {
  const deadline = Date.now() + MAX_TOTAL_MS;
  const diagnostics = { mode: '', queries: [], rawCandidates: 0, afterExclude: 0, afterPreRegion: 0, analyzed: 0, beforeFinalFilter: 0, final: 0, reason: '' };
  const excludeTerms = [...DEFAULT_EXCLUDES, ...splitList(p.excludes)].map(x => x.toLowerCase());
  let candidates = [];
  const manualUrls = splitList(p.manualUrls).map(normalizeUrl).filter(Boolean);
  if (manualUrls.length) {
    diagnostics.mode = 'manual';
    candidates = manualUrls.map(url => ({ title: domainFromUrl(url), url, snippet: '', source: 'manual' }));
  } else {
    diagnostics.mode = 'search';
    const queries = buildQueries(p);
    const searched = await searchWeb(queries, Number(p.limit || 20), deadline);
    diagnostics.queries = searched.usedQueries;
    candidates = searched.items;
  }
  diagnostics.rawCandidates = candidates.length;
  candidates = dedupeByDomain(candidates).filter(c => !isExcluded(c, excludeTerms));
  diagnostics.afterExclude = candidates.length;

  // Pre-region ranking/filtering using search title/url/snippet. Strict filtering is applied again after website analysis.
  const countries = splitList(p.country);
  const cities = splitList(p.city);
  candidates = candidates.map(c => {
    const pre = scoreRegion(`${c.title || ''} ${c.snippet || ''}`, c.url, countries, cities);
    return { ...c, preRegion: pre.countryScore + pre.cityScore };
  });
  if ((p.regionMode || 'prefer') === 'strict') {
    // Keep uncertain candidates too; some sites only show location inside homepage. This avoids over-filtering before fetch.
    candidates = candidates.filter(c => c.preRegion > 0 || diagnostics.mode === 'manual');
  }
  candidates.sort((a, b) => (b.preRegion || 0) - (a.preRegion || 0));
  diagnostics.afterPreRegion = candidates.length;

  const maxAnalyze = Math.min(Number(p.limit || 20) * 2, 30, candidates.length);
  const toAnalyze = candidates.slice(0, maxAnalyze);
  const analyzed = await mapLimit(toAnalyze, 4, async item => {
    if (Date.now() > deadline) return null;
    return analyzeSite(item, p, deadline);
  });
  diagnostics.analyzed = analyzed.length;
  diagnostics.beforeFinalFilter = analyzed.length;
  const filtered = sortResults(applyFilters(analyzed, p), p.sort).slice(0, Number(p.limit || 20));
  diagnostics.final = filtered.length;
  if (!diagnostics.rawCandidates) diagnostics.reason = '公开搜索源没有返回候选网站。建议使用上方“官网列表”直接粘贴目标网站。';
  else if (!diagnostics.afterExclude) diagnostics.reason = '候选网站都被排除关键词/域名过滤掉了。可以删减排除词再试。';
  else if (!diagnostics.final) diagnostics.reason = '有候选网站，但被国家/城市/客户类型/必须包含词/邮箱电话条件过滤掉了。可以改为“地区相关优先”、降低最低分，或取消邮箱/电话限制。';
  return { results: filtered, diagnostics };
}

function defaultParams() {
  return {
    manualUrls: '',
    type: 'all',
    country: 'Germany',
    city: 'Berlin',
    limit: '20',
    mainKeyword: 'bike shop',
    productTags: 'bike parts, cycling accessories, power meter, cranks',
    required: 'bike,bicycle,cycling,shop,dealer,distributor,parts',
    excludes: 'microsoft,bing,google,cyclingnews,news,review,forum,wikipedia,amazon,ebay,facebook,instagram,youtube',
    minScore: '0',
    minMatch: '0',
    regionMode: 'prefer',
    sort: 'score',
    emailOnly: false,
    phoneOnly: false,
    hidePlatforms: true,
    submitted: false
  };
}

function paramsFromQuery(q) {
  const d = defaultParams();
  return {
    manualUrls: getParam(q, 'manualUrls', d.manualUrls),
    type: getParam(q, 'type', d.type),
    country: getParam(q, 'country', d.country),
    city: getParam(q, 'city', d.city),
    limit: getParam(q, 'limit', d.limit),
    mainKeyword: getParam(q, 'mainKeyword', d.mainKeyword),
    productTags: getParam(q, 'productTags', d.productTags),
    required: getParam(q, 'required', d.required),
    excludes: getParam(q, 'excludes', d.excludes),
    minScore: getParam(q, 'minScore', d.minScore),
    minMatch: getParam(q, 'minMatch', d.minMatch),
    regionMode: getParam(q, 'regionMode', d.regionMode),
    sort: getParam(q, 'sort', d.sort),
    emailOnly: q.get('emailOnly') === 'on',
    phoneOnly: q.get('phoneOnly') === 'on',
    hidePlatforms: q.get('hidePlatforms') !== 'off',
    submitted: q.get('submitted') === '1'
  };
}

function select(name, value, options) {
  return `<select name="${esc(name)}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(value) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

function renderForm(p) {
  const typeOptions = Object.entries(TYPE_CONFIG).map(([k, v]) => [k, v.label]);
  return `
  <form action="/search" method="GET" class="card form-card" id="leadForm">
    <input type="hidden" name="submitted" value="1">
    <h1>全球骑行配件 B2B 线索采集工具 <span class="badge">${VERSION}</span></h1>
    <p class="subtitle">面向全球寻找自行车店、骑行店、配件经销商、批发商、分销商、进口商官网，并从公开页面提取邮箱和电话。</p>
    <div class="notice"><b>说明：</b> 免费版不调用 Google Maps/Places，所以没有稳定的地图商家电话、地址和前 100 商家保证。默认排除的是搜索引擎、社媒、新闻测评、论坛、百科和大平台页面，不是排除你的浏览器。</div>
    <label class="wide">可选：直接粘贴官网列表，一行一个。填写这里会优先分析这些网站，不依赖公开搜索。</label>
    <textarea name="manualUrls" placeholder="例如：\nhttps://example-bike-shop.de\nhttps://example-distributor.com">${esc(p.manualUrls)}</textarea>
    <div class="grid">
      <label>目标客户类型${select('type', p.type, typeOptions)}</label>
      <label>国家/市场，可多个<input name="country" value="${esc(p.country)}" placeholder="Germany, France, USA"></label>
      <label>城市/地区，可多个<input name="city" value="${esc(p.city)}" placeholder="Berlin, Paris, Los Angeles"></label>
      <label>目标数量<input name="limit" type="number" min="1" max="50" value="${esc(p.limit)}"></label>
      <label>主搜索关键词<input name="mainKeyword" value="${esc(p.mainKeyword)}" placeholder="bike shop / bike dealer"></label>
      <label>产品方向标签<input name="productTags" value="${esc(p.productTags)}" placeholder="bike parts, cycling accessories"></label>
      <label>必须包含关键词<input name="required" value="${esc(p.required)}" placeholder="bike,bicycle,cycling,shop,dealer"></label>
      <label>排除关键词/域名，可编辑<input name="excludes" value="${esc(p.excludes)}" placeholder="microsoft,bing,news,review"></label>
      <label>最低总分<input name="minScore" type="number" min="0" max="100" value="${esc(p.minScore)}"></label>
      <label>最低匹配度<input name="minMatch" type="number" min="0" max="100" value="${esc(p.minMatch)}"></label>
      <label>地区筛选${select('regionMode', p.regionMode, [['prefer','相关优先'],['strict','严格筛选：必须匹配国家/城市']])}</label>
      <label>排序${select('sort', p.sort, [['score','按分数排序'],['match','按匹配度排序'],['email','有邮箱优先']])}</label>
    </div>
    <div class="checks">
      <label><input type="checkbox" name="emailOnly" ${p.emailOnly ? 'checked' : ''}> 只看有邮箱</label>
      <label><input type="checkbox" name="phoneOnly" ${p.phoneOnly ? 'checked' : ''}> 只看有电话</label>
    </div>
    <div class="actions">
      <button class="primary" type="submit">开始提取</button>
      <a class="reset" href="/">重置</a>
    </div>
    <p class="hint">国家/城市现在会参与搜索词构造和最终筛选。若公开搜索返回少，建议把地区筛选设为“相关优先”，或直接粘贴官网列表。</p>
  </form>`;
}

function renderDiagnostics(d) {
  if (!d) return '';
  return `<div class="card diag"><h3>搜索诊断</h3><div class="diag-grid">
    <span>模式：<b>${esc(d.mode || '-')}</b></span>
    <span>搜索候选：<b>${esc(d.rawCandidates)}</b></span>
    <span>排除后：<b>${esc(d.afterExclude)}</b></span>
    <span>地区预筛后：<b>${esc(d.afterPreRegion)}</b></span>
    <span>已分析网站：<b>${esc(d.analyzed)}</b></span>
    <span>最终结果：<b>${esc(d.final)}</b></span>
  </div>${d.reason ? `<p class="reason">${esc(d.reason)}</p>` : ''}${d.queries && d.queries.length ? `<details><summary>本次实际搜索词</summary><ol>${d.queries.map(q => `<li>${esc(q)}</li>`).join('')}</ol></details>` : ''}</div>`;
}

function renderResults(results, p) {
  const csvData = encodeURIComponent(toCsv(results));
  const rows = results.map(r => `<tr>
    <td><span class="score">${esc(r.score)}</span></td>
    <td>${esc(r.match)}</td>
    <td>${esc(labelType(r.type))}</td>
    <td><b>${esc(r.title || r.domain)}</b><br><a href="${esc(r.url)}" target="_blank">${esc(r.url)}</a></td>
    <td>${esc((r.phones || []).join('; '))}</td>
    <td><b>${esc(r.priorityEmail || '')}</b><br><span class="small">${esc(r.emailType || '')}</span></td>
    <td>${esc((r.emails || []).join('; '))}</td>
    <td>${r.contactUrl ? `<a href="${esc(r.contactUrl)}" target="_blank">打开</a>` : ''}</td>
    <td class="small">${esc(r.notes || '')}<br>地区分：${esc(r.regionCountry + r.regionCity)}</td>
  </tr>`).join('');
  return `<div class="card"><div class="result-head"><h2>结果 ${results.length} 条</h2><a class="download ${results.length ? '' : 'disabled'}" href="data:text/csv;charset=utf-8,${csvData}" download="global-cycling-b2b-leads.csv">下载 CSV</a></div>
  <div class="table-wrap"><table><thead><tr><th>分数</th><th>匹配度</th><th>类型</th><th>公司/网站</th><th>电话</th><th>优先邮箱</th><th>全部邮箱</th><th>Contact 页面</th><th>备注</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="empty">暂无结果。可以降低最低分/匹配度，地区筛选改为相关优先，或直接粘贴官网列表。</td></tr>'}</tbody></table></div></div>`;
}

function toCsv(results) {
  const header = ['score','match','type','title','url','phone','priority_email','all_emails','contact_url','notes'];
  const lines = [header.join(',')];
  for (const r of results) {
    const vals = [r.score, r.match, labelType(r.type), r.title, r.url, (r.phones || []).join('; '), r.priorityEmail, (r.emails || []).join('; '), r.contactUrl, r.notes];
    lines.push(vals.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(','));
  }
  return lines.join('\n');
}

function renderPage(p, results, diagnostics, processingText) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>全球骑行配件 B2B 线索采集工具</title><style>
    :root{--bg:#f4f6fb;--card:#fff;--text:#0f172a;--muted:#667085;--line:#e2e8f0;--brand:#0f172a;--soft:#f8fafc;--accent:#dcfce7;--orange:#fff7ed;--orange-line:#fdba74}
    *{box-sizing:border-box}body{font-family:Arial,'Microsoft YaHei',sans-serif;background:var(--bg);color:var(--text);margin:0;padding:32px}.wrap{max-width:1180px;margin:0 auto}.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px;margin-bottom:22px;box-shadow:0 12px 35px rgba(15,23,42,.06)}h1{margin:0 0 8px;font-size:30px}.subtitle{color:#475569;margin:0 0 16px}.badge{font-size:13px;background:var(--accent);padding:7px 12px;border-radius:999px;color:#047857;vertical-align:middle}.notice{background:var(--orange);border:1px solid var(--orange-line);color:#9a3412;border-radius:12px;padding:14px 16px;margin:18px 0}.wide{display:block;margin-bottom:8px;color:#475569}textarea{width:100%;min-height:88px;border:1px solid #cbd5e1;border-radius:12px;padding:12px;font-size:14px}label{font-size:13px;color:#475569}input,select{display:block;width:100%;height:42px;border:1px solid #cbd5e1;border-radius:11px;padding:0 12px;font-size:15px;background:#fff;margin-top:6px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:14px}.checks{display:flex;gap:28px;margin:18px 0}.checks input{display:inline;width:auto;height:auto;margin-right:6px}.actions{display:flex;gap:12px;justify-content:flex-end;align-items:center}.primary{border:0;background:#0f172a;color:#fff;border-radius:12px;padding:14px 28px;font-size:17px;font-weight:700;cursor:pointer}.reset{display:inline-block;background:#94a3b8;color:#fff;border-radius:12px;padding:14px 24px;text-decoration:none;font-weight:700}.hint{font-size:12px;color:#64748b;margin:12px 0 0}.bar{height:12px;background:#0f172a;border-radius:99px;margin-top:14px}.result-head{display:flex;justify-content:space-between;align-items:center}.download{background:#334155;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:700}.download.disabled{background:#94a3b8;pointer-events:none}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:14px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:12px;text-align:left;vertical-align:top}th{background:#f8fafc}.score{display:inline-block;background:#eef2ff;color:#4338ca;border-radius:999px;padding:4px 8px}.small{font-size:12px;color:#64748b}.empty{color:#64748b}.diag h3{margin-top:0}.diag-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.diag-grid span{background:#f8fafc;border:1px solid var(--line);border-radius:10px;padding:10px}.reason{color:#9a3412;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px}@media(max-width:900px){body{padding:12px}.grid{grid-template-columns:1fr}.diag-grid{grid-template-columns:1fr 1fr}.actions{justify-content:stretch}.primary,.reset{width:50%;text-align:center}}
  </style></head><body><div class="wrap">${renderForm(p)}${processingText || ''}${renderDiagnostics(diagnostics)}${renderResults(results || [], p)}</div></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version: VERSION }));
    return;
  }
  if (url.pathname !== '/' && url.pathname !== '/search') {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const p = paramsFromQuery(url.searchParams);
  let results = [];
  let diagnostics = null;
  try {
    if (p.submitted) {
      const out = await performSearch(p);
      results = out.results;
      diagnostics = out.diagnostics;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderPage(p, results, diagnostics));
  } catch (e) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderPage(p, [], { reason: '服务器处理失败：' + (e.message || e), mode: 'error', rawCandidates: 0, afterExclude: 0, afterPreRegion: 0, analyzed: 0, final: 0, queries: [] }));
  }
});

server.listen(PORT, () => {
  console.log(`${VERSION} running on port ${PORT}`);
});
