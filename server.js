'use strict';

const http = require('http');
const { URL, URLSearchParams } = require('url');

const PORT = process.env.PORT || 3000;
const VERSION = 'v6.5 全球筛选优化版';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const DEFAULT_EXCLUDES = [
  'microsoft','bing','google','duckduckgo','yahoo','youtube','facebook','instagram','linkedin','twitter','x.com','tiktok',
  'wikipedia','reddit','quora','pinterest','aliexpress','alibaba','amazon','ebay','temu','shopify.com',
  'cyclingnews','bikeradar','road.cc','pinkbike','singletracks','bikepacking','outsideonline','news','magazine','review','blog','forum','wiki','support','help center',
  'trekbikes.com','specialized.com','giant-bicycles.com','canyon.com','shimano.com','sram.com','garmin.com','cannondale.com','cube.eu','merida-bikes.com','pinarello.com','cervelo.com','bianchi.com'
];

const POSITIVE = [
  'bike shop','bicycle shop','cycling shop','cycle shop','bike store','bicycle store','cycling store',
  'bike dealer','bicycle dealer','cycle dealer','dealer','retailer','shop','store',
  'distributor','distribution','wholesale','wholesaler','importer','parts','accessories','bike parts','bicycle parts','cycling accessories',
  'fahrradladen','fahrradgeschäft','fahrrad händler','fahrradhaendler','radhändler','radladen','radsport','fahrradzubehör','fahrradteile',
  'bicicleta','ciclismo','vélo','velo','cyclisme','fiets','wieler','ciclismo','bici'
];

const TYPE_KEYWORDS = {
  all: [],
  shop: ['shop','store','retailer','bike shop','bicycle shop','cycling store','fahrradladen','radladen','fahrradgeschäft'],
  dealer: ['dealer','retailer','reseller','authorized dealer','bike dealer','bicycle dealer','händler','haendler','fahrrad händler'],
  distributor: ['distributor','distribution','importer','supplier','distributeur','distribuidor','distributore'],
  wholesale: ['wholesale','wholesaler','bulk','b2b','dealer program','trade','grosshandel'],
  repair: ['repair','service','workshop','bike service','fahrradwerkstatt','werkstatt']
};

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function cleanText(s) {
  return String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitList(s) {
  return String(s || '').split(/[，,\n;]/).map(x => x.trim()).filter(Boolean);
}

function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    u.hash = '';
    return u.toString();
  } catch (_) {
    return '';
  }
}

function domainOf(raw) {
  try {
    return new URL(raw).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_) {
    return '';
  }
}

function includesAny(text, arr) {
  const lower = String(text || '').toLowerCase();
  return arr.some(x => lower.includes(String(x).toLowerCase()));
}

function countMatches(text, arr) {
  const lower = String(text || '').toLowerCase();
  return arr.reduce((n, x) => n + (x && lower.includes(String(x).toLowerCase()) ? 1 : 0), 0);
}

function isExcluded(url, text, excludes) {
  const d = domainOf(url);
  const hay = (d + ' ' + String(text || '')).toLowerCase();
  return excludes.some(x => {
    const term = String(x || '').trim().toLowerCase();
    return term && hay.includes(term);
  });
}

async function fetchText(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
    });
    if (!res.ok) return { ok: false, status: res.status, text: '' };
    const ct = res.headers.get('content-type') || '';
    if (!/text|html|xml|rss/i.test(ct)) return { ok: false, status: res.status, text: '' };
    const text = await res.text();
    return { ok: true, status: res.status, text: text.slice(0, 1000000) };
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

function extractEmails(text) {
  const raw = String(text || '').replace(/\s*\[at\]\s*/gi, '@').replace(/\s*\(at\)\s*/gi, '@').replace(/\s+at\s+/gi, '@').replace(/\s*\[dot\]\s*/gi, '.').replace(/\s*\(dot\)\s*/gi, '.');
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const found = new Set();
  let m;
  while ((m = re.exec(raw))) {
    const e = m[0].toLowerCase().replace(/[.,;:!?]+$/, '');
    if (!/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(e)) found.add(e);
  }
  return [...found];
}

function extractPhones(text) {
  const re = /(\+?\d[\d\s()./-]{7,}\d)/g;
  const found = new Set();
  let m;
  while ((m = re.exec(String(text || '')))) {
    const p = m[1].replace(/\s+/g, ' ').trim();
    const digits = p.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 16) found.add(p);
  }
  return [...found].slice(0, 3);
}

function pickPriorityEmail(emails) {
  const weights = [
    ['sales@', 100], ['wholesale@', 95], ['dealer@', 92], ['b2b@', 90], ['trade@', 88], ['distribution@', 86], ['info@', 80], ['contact@', 78], ['office@', 70], ['hello@', 65], ['service@', 45], ['support@', 35], ['privacy@', 5], ['noreply@', 0]
  ];
  let best = emails[0] || '';
  let bestScore = -1;
  for (const e of emails) {
    let score = 50;
    for (const [key, w] of weights) if (e.includes(key)) score = Math.max(score, w);
    if (score > bestScore) { best = e; bestScore = score; }
  }
  return best;
}

function classifyType(text, url) {
  const hay = (text + ' ' + domainOf(url)).toLowerCase();
  const scores = {
    shop: countMatches(hay, TYPE_KEYWORDS.shop),
    dealer: countMatches(hay, TYPE_KEYWORDS.dealer),
    distributor: countMatches(hay, TYPE_KEYWORDS.distributor),
    wholesale: countMatches(hay, TYPE_KEYWORDS.wholesale),
    repair: countMatches(hay, TYPE_KEYWORDS.repair)
  };
  const order = Object.entries(scores).sort((a,b) => b[1] - a[1]);
  if (order[0][1] === 0) return '未分类';
  const map = { shop:'门店/零售店', dealer:'经销商 Dealer', distributor:'分销商/进口商', wholesale:'批发商 Wholesale', repair:'维修店/服务店' };
  return map[order[0][0]];
}

function decodeXml(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function extractUrlsFromSearchHtml(html) {
  const urls = new Set();
  let m;
  const patterns = [
    /<a[^>]+href="(https?:\/\/[^"]+)"/gi,
    /uddg=([^&"']+)/gi,
    /url=([^&"']*https?%3A%2F%2F[^&"']+)/gi
  ];
  for (const re of patterns) {
    while ((m = re.exec(html))) {
      let u = m[1];
      try { u = decodeURIComponent(u); } catch (_) {}
      u = normalizeUrl(u);
      if (u) urls.add(u);
    }
  }
  return [...urls];
}

async function searchCandidates(query, limit, debug) {
  const urls = new Map();
  const q = encodeURIComponent(query);
  const sources = [
    { name: 'bing-rss', url: `https://www.bing.com/search?format=rss&q=${q}` },
    { name: 'duckduckgo-html', url: `https://duckduckgo.com/html/?q=${q}` },
    { name: 'bing-html', url: `https://www.bing.com/search?q=${q}` }
  ];
  for (const src of sources) {
    const r = await fetchText(src.url, 8000);
    debug.sources.push(`${src.name}:${r.ok ? 'ok' : 'fail ' + r.status}`);
    if (!r.text) continue;
    if (src.name === 'bing-rss') {
      const itemRe = /<item>[\s\S]*?<\/item>/gi;
      const linkRe = /<link>([\s\S]*?)<\/link>/i;
      let item;
      while ((item = itemRe.exec(r.text))) {
        const lm = linkRe.exec(item[0]);
        if (lm) {
          const u = normalizeUrl(decodeXml(lm[1].trim()));
          if (u) urls.set(domainOf(u), u);
        }
      }
    } else {
      for (const u of extractUrlsFromSearchHtml(r.text)) urls.set(domainOf(u), u);
    }
    if (urls.size >= limit * 3) break;
  }
  return [...urls.values()].slice(0, Math.max(limit * 4, 20));
}

function buildQueries(p) {
  const countries = splitList(p.countries || p.country);
  const cities = splitList(p.cities || p.city);
  const type = p.customerType || 'all';
  const typeWords = (TYPE_KEYWORDS[type] || []).slice(0, 3).join(' ');
  const seed = p.keyword || 'bike shop';
  const product = p.productTags || '';
  const queries = [];
  const countryList = countries.length ? countries : [''];
  const cityList = cities.length ? cities : [''];
  for (const country of countryList.slice(0, 4)) {
    for (const city of cityList.slice(0, 4)) {
      queries.push([seed, typeWords, product, city, country].filter(Boolean).join(' '));
    }
  }
  queries.push([seed, product, countries[0] || '', 'dealer distributor wholesale'].filter(Boolean).join(' '));
  return [...new Set(queries.map(q => q.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 8);
}

function findContactLinks(baseUrl, html) {
  const found = new Set();
  const base = new URL(baseUrl);
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const label = cleanText(m[2]).toLowerCase();
    const combined = (href + ' ' + label).toLowerCase();
    if (/(contact|kontakt|about|impressum|dealer|wholesale|distribution|trade|b2b|retail|store|shops|service)/i.test(combined)) {
      try {
        const u = new URL(href, base);
        if (u.hostname.replace(/^www\./,'') === base.hostname.replace(/^www\./,'')) {
          u.hash = '';
          found.add(u.toString());
        }
      } catch (_) {}
    }
  }
  return [...found].slice(0, 6);
}

async function analyzeSite(url, p) {
  const normalized = normalizeUrl(url);
  const result = {
    score: 0, match: 0, type: '未分类', title: domainOf(normalized), url: normalized, phones: [], emails: [], priorityEmail: '', contactUrl: '', notes: []
  };
  const homepage = await fetchText(normalized, 10000);
  if (!homepage.ok) {
    result.notes.push(`Homepage HTTP ${homepage.status || 'timeout'}`);
    return result;
  }
  const html = homepage.text;
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  result.title = titleMatch ? cleanText(titleMatch[1]).slice(0, 120) : domainOf(normalized);
  let combinedText = cleanText(html).slice(0, 200000);
  let combinedHtml = html.slice(0, 200000);
  const links = findContactLinks(normalized, html);
  for (const link of links) {
    const r = await fetchText(link, 8000);
    if (r.ok) {
      combinedHtml += '\n' + r.text.slice(0, 180000);
      combinedText += '\n' + cleanText(r.text).slice(0, 180000);
      if (!result.contactUrl && /(contact|kontakt|impressum|dealer|wholesale|trade|b2b)/i.test(link)) result.contactUrl = link;
    }
  }
  const hay = (result.title + ' ' + normalized + ' ' + combinedText).toLowerCase();
  result.emails = extractEmails(combinedHtml + ' ' + combinedText);
  result.phones = extractPhones(combinedText);
  result.priorityEmail = pickPriorityEmail(result.emails);
  result.type = classifyType(hay, normalized);
  result.match = Math.min(100, countMatches(hay, POSITIVE) * 7 + countMatches(hay, splitList(p.includeKeywords)) * 10 + countMatches(hay, splitList(p.productTags)) * 8);
  result.score = result.match;
  if (result.emails.length) result.score += 25;
  if (result.phones.length) result.score += 10;
  if (/sales@|wholesale@|dealer@|trade@|b2b@|info@|contact@/.test(result.priorityEmail)) result.score += 10;
  if (result.type !== '未分类') result.score += 10;
  const locationTerms = [...splitList(p.countries || p.country), ...splitList(p.cities || p.city)].map(x => x.toLowerCase());
  const locHits = locationTerms.filter(x => x && hay.includes(x)).length;
  if (locHits) { result.score += 10 + locHits * 3; result.notes.push('Location matched'); }
  if (links.length) result.notes.push(`Checked ${1 + links.length} pages`);
  return result;
}

function passFilters(r, p, excludes) {
  const hay = (r.title + ' ' + r.url + ' ' + r.type + ' ' + r.notes.join(' ')).toLowerCase();
  if (isExcluded(r.url, hay, excludes)) return false;
  const type = p.customerType || 'all';
  if (type !== 'all') {
    const typeMap = { shop: '门店', dealer: '经销商', distributor: '分销商', wholesale: '批发商', repair: '维修店' };
    if (!r.type.includes(typeMap[type] || '')) return false;
  }
  if (p.onlyEmail === 'on' && !r.emails.length) return false;
  if (p.onlyPhone === 'on' && !r.phones.length) return false;
  if (Number(r.score) < Number(p.minScore || 0)) return false;
  if (Number(r.match) < Number(p.minMatch || 0)) return false;
  const locMode = p.locationMode || 'prefer';
  if (locMode === 'strict') {
    const locTerms = [...splitList(p.countries || p.country), ...splitList(p.cities || p.city)].map(x => x.toLowerCase()).filter(Boolean);
    if (locTerms.length && !locTerms.some(t => hay.includes(t) || r.notes.join(' ').toLowerCase().includes('location matched'))) return false;
  }
  return true;
}

async function collect(p) {
  const limit = Math.max(1, Math.min(80, Number(p.limit || 20)));
  const excludes = [...DEFAULT_EXCLUDES, ...splitList(p.excludeKeywords)].filter(Boolean);
  const debug = { queries: [], sources: [], candidatesBeforeFilter: 0, candidatesAfterExclude: 0, analyzed: 0, final: 0, mode: '' };
  let candidateUrls = [];
  const manual = splitList(p.manualSites).map(normalizeUrl).filter(Boolean);
  if (manual.length) {
    debug.mode = 'manual-sites';
    candidateUrls = [...new Set(manual)].slice(0, limit * 2);
  } else {
    debug.mode = 'public-search';
    const queries = buildQueries(p);
    debug.queries = queries;
    const found = new Map();
    for (const q of queries) {
      const urls = await searchCandidates(q, limit, debug);
      for (const u of urls) found.set(domainOf(u), u);
      if (found.size >= limit * 3) break;
    }
    candidateUrls = [...found.values()];
  }
  debug.candidatesBeforeFilter = candidateUrls.length;
  candidateUrls = candidateUrls.filter(u => !isExcluded(u, '', excludes));
  debug.candidatesAfterExclude = candidateUrls.length;
  const results = [];
  for (const u of candidateUrls.slice(0, Math.max(limit * 3, 15))) {
    const r = await analyzeSite(u, p);
    debug.analyzed += 1;
    if (passFilters(r, p, excludes)) results.push(r);
    if (results.length >= limit) break;
  }
  if ((p.sortBy || 'score') === 'match') results.sort((a,b) => b.match - a.match || b.score - a.score);
  else results.sort((a,b) => b.score - a.score || b.match - a.match);
  debug.final = results.length;
  return { results, debug };
}

function csv(results) {
  const header = ['score','match','type','title','url','phone','priority_email','all_emails','contact_url','notes'];
  const rows = [header, ...results.map(r => [r.score, r.match, r.type, r.title, r.url, r.phones.join('; '), r.priorityEmail, r.emails.join('; '), r.contactUrl, r.notes.join('; ')])];
  return rows.map(row => row.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\n');
}

function formValue(p, key, fallback) {
  return esc(p[key] == null || p[key] === '' ? fallback : p[key]);
}

function selected(p, key, val, fallback) {
  const cur = p[key] == null || p[key] === '' ? fallback : p[key];
  return cur === val ? ' selected' : '';
}

function checked(p, key, fallback) {
  const val = p[key];
  if (val == null) return fallback ? ' checked' : '';
  return val === 'on' ? ' checked' : '';
}

function renderPage(p = {}, data = null) {
  const results = data ? data.results : [];
  const debug = data ? data.debug : null;
  const csvData = encodeURIComponent(csv(results));
  const rows = results.map(r => `
<tr>
<td><span class="pill">${esc(r.score)}</span></td>
<td>${esc(r.match)}</td>
<td>${esc(r.type)}</td>
<td><b>${esc(r.title)}</b><br><a href="${esc(r.url)}" target="_blank">${esc(r.url)}</a></td>
<td>${esc(r.phones.join('; '))}</td>
<td><b>${esc(r.priorityEmail)}</b></td>
<td class="small">${esc(r.emails.join('; '))}</td>
<td>${r.contactUrl ? `<a href="${esc(r.contactUrl)}" target="_blank">打开</a>` : ''}</td>
<td class="small">${esc(r.notes.join('; '))}</td>
</tr>`).join('');

  const debugHtml = debug ? `
<div class="debug">
<b>搜索诊断：</b>
模式：${esc(debug.mode)} ｜ 候选网站：${esc(debug.candidatesBeforeFilter)} ｜ 排除后：${esc(debug.candidatesAfterExclude)} ｜ 已分析：${esc(debug.analyzed)} ｜ 最终：${esc(debug.final)}<br>
搜索词：${esc((debug.queries || []).join(' | ') || '手动官网列表')}<br>
搜索源：${esc((debug.sources || []).join(' / '))}
</div>` : '';

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>全球骑行配件 B2B 线索采集工具</title><style>
body{margin:0;background:#f5f7fb;color:#0f172a;font-family:Arial,'Microsoft YaHei',sans-serif}.wrap{max-width:1180px;margin:36px auto;padding:0 18px}.card{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:24px;margin-bottom:22px;box-shadow:0 18px 45px rgba(15,23,42,.07)}h1{font-size:30px;margin:0 0 8px}.badge{font-size:13px;background:#d1fae5;color:#065f46;border-radius:999px;padding:7px 12px;margin-left:12px;vertical-align:middle}.sub{color:#475569;margin:0 0 18px}.notice{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:12px;padding:14px;margin:16px 0}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px}.field{grid-column:span 4}.field.small{grid-column:span 2}.field.wide{grid-column:span 6}.field.full{grid-column:1/-1}label{font-size:13px;color:#475569;display:block;margin:0 0 5px}input,select,textarea{width:100%;box-sizing:border-box;border:1px solid #d8dee9;border-radius:12px;padding:12px;font-size:15px;background:#fff}textarea{min-height:86px;font-family:Consolas,monospace}.actions{display:flex;gap:12px;align-items:end}.btn{border:0;border-radius:12px;background:#0f172a;color:white;font-weight:700;font-size:16px;padding:13px 22px;cursor:pointer}.btn.secondary{background:#94a3b8}.checks{display:flex;gap:18px;flex-wrap:wrap;margin-top:16px}.checks label{display:flex;align-items:center;gap:6px}.progress{height:12px;background:#e5e7eb;border-radius:999px;overflow:hidden;margin-top:12px}.progress span{display:block;height:100%;background:#0f172a;width:${results.length ? '100%' : '0%'}}.tablewrap{overflow:auto;border:1px solid #e5e7eb;border-radius:14px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{border-bottom:1px solid #e5e7eb;text-align:left;padding:12px;vertical-align:top}th{background:#f8fafc}.pill{display:inline-block;background:#eef2ff;color:#3730a3;border-radius:999px;padding:4px 8px}.small{font-size:12px;color:#64748b;max-width:310px}.download{float:right;background:#64748b;color:#fff;text-decoration:none;border-radius:12px;padding:13px 20px;font-weight:700}.debug{font-size:12px;color:#334155;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:12px;margin-top:14px}.hint{font-size:12px;color:#64748b;margin-top:8px}@media(max-width:820px){.field,.field.small,.field.wide{grid-column:1/-1}.actions{align-items:stretch}.btn{width:100%}}
</style></head><body><div class="wrap">
<div class="card"><h1>全球骑行配件 B2B 线索采集工具 <span class="badge">${VERSION}</span></h1><p class="sub">面向全球寻找自行车店、骑行店、配件经销商、批发商、分销商、进口商官网，并从公开页面提取邮箱和电话。</p>
<div class="notice"><b>说明：</b>免费版不调用 Google Maps/Places，所以没有稳定的地图商家电话、地址和前 100 商家保证。默认排除的是搜索引擎、社媒、新闻测评、论坛、百科和大平台页面，不是排除你的浏览器。</div>
<form method="POST" action="/search">
<div class="grid">
<div class="field full"><label>可选：直接粘贴官网列表，一行一个。填写这里会优先分析这些网站，不依赖公开搜索。</label><textarea name="manualSites" placeholder="例如：&#10;https://example-bike-shop.de&#10;https://example-distributor.com">${formValue(p,'manualSites','')}</textarea></div>
<div class="field"><label>目标客户类型</label><select name="customerType"><option value="all"${selected(p,'customerType','all','all')}>全部类型</option><option value="shop"${selected(p,'customerType','shop','all')}>自行车店 / 门店</option><option value="dealer"${selected(p,'customerType','dealer','all')}>经销商 Dealer</option><option value="distributor"${selected(p,'customerType','distributor','all')}>分销商 / 进口商</option><option value="wholesale"${selected(p,'customerType','wholesale','all')}>批发商 Wholesale</option><option value="repair"${selected(p,'customerType','repair','all')}>维修店 / 服务店</option></select></div>
<div class="field"><label>国家/市场，可多个</label><input name="countries" value="${formValue(p,'countries','Germany')}" placeholder="Germany, France, USA, Japan"></div>
<div class="field"><label>城市/地区，可多个</label><input name="cities" value="${formValue(p,'cities','Berlin')}" placeholder="Berlin, Paris, Los Angeles"></div>
<div class="field small"><label>目标数量</label><input name="limit" type="number" min="1" max="80" value="${formValue(p,'limit','20')}"></div>
<div class="field"><label>主搜索关键词</label><input name="keyword" value="${formValue(p,'keyword','bike shop')}" placeholder="bike shop / bike dealer / Fahrradladen"></div>
<div class="field"><label>产品方向标签</label><input name="productTags" value="${formValue(p,'productTags','bike parts, cycling accessories, power meter, crankset')}" placeholder="bike parts, power meter, crankset"></div>
<div class="field"><label>必须包含关键词</label><input name="includeKeywords" value="${formValue(p,'includeKeywords','bike,bicycle,cycling,dealer,shop,distributor,parts')}"></div>
<div class="field"><label>排除关键词/域名，可编辑</label><input name="excludeKeywords" value="${formValue(p,'excludeKeywords','microsoft,bing,google,cyclingnews,news,review,forum,amazon,ebay,wikipedia')}"></div>
<div class="field small"><label>最低总分</label><input name="minScore" type="number" value="${formValue(p,'minScore','0')}"></div>
<div class="field small"><label>最低匹配度</label><input name="minMatch" type="number" value="${formValue(p,'minMatch','0')}"></div>
<div class="field small"><label>地区筛选</label><select name="locationMode"><option value="prefer"${selected(p,'locationMode','prefer','prefer')}>相关优先</option><option value="strict"${selected(p,'locationMode','strict','prefer')}>严格包含</option></select></div>
<div class="field small"><label>排序</label><select name="sortBy"><option value="score"${selected(p,'sortBy','score','score')}>按分数排序</option><option value="match"${selected(p,'sortBy','match','score')}>按匹配度排序</option></select></div>
<div class="field small actions"><button class="btn" type="submit">开始提取</button><button class="btn secondary" type="reset">重置</button></div>
</div>
<div class="checks"><label><input type="checkbox" name="onlyEmail"${checked(p,'onlyEmail',false)}> 只看有邮箱</label><label><input type="checkbox" name="onlyPhone"${checked(p,'onlyPhone',false)}> 只看有电话</label></div>
<div class="hint">排除关键词/域名用于过滤搜索源自身页面、新闻测评、论坛、社媒和大平台；你可以删除或新增，例如 trek, giant, youtube。</div>
<p><b>${data ? '完成：找到 ' + results.length + ' 条线索' : '准备就绪'}</b></p><div class="progress"><span></span></div>${debugHtml}
</form></div>
<div class="card"><h2>结果 ${results.length} 条 ${results.length ? `<a class="download" download="global-cycling-b2b-leads.csv" href="data:text/csv;charset=utf-8,${csvData}">下载 CSV</a>` : ''}</h2><div class="tablewrap"><table><thead><tr><th>分数</th><th>匹配度</th><th>类型</th><th>公司/网站</th><th>电话</th><th>优先邮箱</th><th>全部邮箱</th><th>Contact 页面</th><th>备注</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="small">暂无结果。可以降低最低分/匹配度，或直接粘贴官网列表。</td></tr>'}</tbody></table></div></div>
</div></body></html>`;
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const obj = {};
      for (const [k,v] of params.entries()) obj[k] = v;
      resolve(obj);
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/health') {
      res.writeHead(200, {'content-type':'application/json'});
      res.end(JSON.stringify({ ok: true, version: VERSION }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/search') {
      const p = await parseBody(req);
      const data = await collect(p);
      res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
      res.end(renderPage(p, data));
      return;
    }
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
    res.end(renderPage({}));
  } catch (e) {
    res.writeHead(500, {'content-type':'text/html; charset=utf-8'});
    res.end(`<h1>Server Error</h1><pre>${esc(e.stack || e.message)}</pre>`);
  }
});

server.listen(PORT, () => {
  console.log(`B2B Lead Scraper ${VERSION} running on port ${PORT}`);
});
