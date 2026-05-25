'use strict';

const http = require('http');
const { URL } = require('url');
const querystring = require('querystring');

const PORT = process.env.PORT || 3000;
const VERSION = 'v6.8 真筛选框稳定版';

let LAST_RESULTS = [];
let LAST_CSV_NAME = 'global-cycling-b2b-leads.csv';

const COUNTRY_OPTIONS = [
  ['ALL','全球 / 不限制'], ['Germany','Germany 德国'], ['France','France 法国'], ['United Kingdom','United Kingdom 英国'],
  ['Italy','Italy 意大利'], ['Spain','Spain 西班牙'], ['Netherlands','Netherlands 荷兰'], ['Belgium','Belgium 比利时'],
  ['Switzerland','Switzerland 瑞士'], ['Austria','Austria 奥地利'], ['Denmark','Denmark 丹麦'], ['Sweden','Sweden 瑞典'],
  ['Norway','Norway 挪威'], ['Finland','Finland 芬兰'], ['Poland','Poland 波兰'], ['Czech Republic','Czech Republic 捷克'],
  ['USA','USA 美国'], ['Canada','Canada 加拿大'], ['Mexico','Mexico 墨西哥'], ['Brazil','Brazil 巴西'],
  ['Australia','Australia 澳大利亚'], ['New Zealand','New Zealand 新西兰'], ['Japan','Japan 日本'], ['South Korea','South Korea 韩国'],
  ['Singapore','Singapore 新加坡'], ['Thailand','Thailand 泰国'], ['UAE','UAE 阿联酋'], ['South Africa','South Africa 南非']
];

const CITY_OPTIONS = [
  ['ALL','全部城市 / 不限制'], ['Berlin','Berlin'], ['Munich','Munich'], ['Hamburg','Hamburg'], ['Frankfurt','Frankfurt'],
  ['Paris','Paris'], ['Lyon','Lyon'], ['London','London'], ['Manchester','Manchester'], ['Milan','Milan'], ['Rome','Rome'],
  ['Madrid','Madrid'], ['Barcelona','Barcelona'], ['Amsterdam','Amsterdam'], ['Rotterdam','Rotterdam'], ['Brussels','Brussels'],
  ['Zurich','Zurich'], ['Vienna','Vienna'], ['Copenhagen','Copenhagen'], ['Stockholm','Stockholm'], ['Oslo','Oslo'],
  ['New York','New York'], ['Los Angeles','Los Angeles'], ['San Francisco','San Francisco'], ['Chicago','Chicago'], ['Seattle','Seattle'],
  ['Toronto','Toronto'], ['Vancouver','Vancouver'], ['Montreal','Montreal'], ['Sydney','Sydney'], ['Melbourne','Melbourne'],
  ['Tokyo','Tokyo'], ['Osaka','Osaka'], ['Seoul','Seoul'], ['Singapore','Singapore'], ['Bangkok','Bangkok'], ['Dubai','Dubai']
];

const COUNTRY_SYNONYMS = {
  Germany: ['germany','deutschland','.de','german'], France: ['france','.fr','french'],
  'United Kingdom': ['united kingdom','uk','britain','england','.co.uk'], Italy: ['italy','italia','.it'],
  Spain: ['spain','espana','españa','.es'], Netherlands: ['netherlands','holland','.nl'], Belgium: ['belgium','.be'],
  Switzerland: ['switzerland','schweiz','suisse','.ch'], Austria: ['austria','osterreich','österreich','.at'],
  Denmark: ['denmark','danmark','.dk'], Sweden: ['sweden','sverige','.se'], Norway: ['norway','norge','.no'], Finland: ['finland','.fi'],
  Poland: ['poland','polska','.pl'], 'Czech Republic': ['czech','czech republic','cesko','.cz'], USA: ['usa','united states','america','u.s.'],
  Canada: ['canada','.ca'], Mexico: ['mexico','.mx'], Brazil: ['brazil','brasil','.br'], Australia: ['australia','.au'],
  'New Zealand': ['new zealand','.nz'], Japan: ['japan','日本','.jp'], 'South Korea': ['south korea','korea','한국','.kr'],
  Singapore: ['singapore','.sg'], Thailand: ['thailand','.th'], UAE: ['uae','dubai','united arab emirates','.ae'],
  'South Africa': ['south africa','.za']
};

const TYPE_TERMS = {
  all: ['bike','bicycle','cycling','cycle','fahrrad','velo'],
  shop: ['bike shop','bicycle shop','cycling store','bike store','fahrradladen','radladen','cycle shop'],
  dealer: ['dealer','bike dealer','bicycle dealer','fahrrad händler','haendler','reseller'],
  distributor: ['distributor','distribution','distributeur','distribuidor','importer','wholesale','wholesaler'],
  service: ['bike repair','workshop','service center','fahrradwerkstatt']
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
function arr(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (!v) return [];
  return [v].filter(Boolean);
}
function splitWords(s) {
  return String(s || '').split(/[\n,;|]+/).map(x => x.trim()).filter(Boolean);
}
function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { return new URL(s).toString(); } catch { return ''; }
}
function domainFromUrl(raw) {
  try { return new URL(raw).hostname.replace(/^www\./,''); } catch { return ''; }
}
function textLower(...parts) { return parts.join(' ').toLowerCase(); }
function stripTags(html) { return String(html || '').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' '); }
function decodeHtml(s) { return String(s || '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'"); }
function uniq(a) { return Array.from(new Set(a.filter(Boolean))); }

async function fetchText(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 LeadResearchBot/1.0', 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
    const txt = await res.text();
    return { ok: res.ok, status: res.status, text: txt.slice(0, 700000) };
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e.name || e.message };
  } finally { clearTimeout(timer); }
}

function isExcluded(item, excludes) {
  const hay = textLower(item.url, item.title, item.snippet || '');
  return excludes.some(x => x && hay.includes(x.toLowerCase()));
}

function isRegionMatch(item, countries, cities) {
  const hay = textLower(item.url, item.title, item.snippet || '', item.htmlText || '');
  let countryOk = countries.length === 0 || countries.includes('ALL');
  if (!countryOk) {
    countryOk = countries.some(c => (COUNTRY_SYNONYMS[c] || [c]).some(t => hay.includes(t.toLowerCase())));
  }
  let cityOk = cities.length === 0 || cities.includes('ALL');
  if (!cityOk) cityOk = cities.some(c => hay.includes(c.toLowerCase()));
  return { countryOk, cityOk, both: countryOk && cityOk };
}

function labelType(scoreText) {
  const t = scoreText.toLowerCase();
  if (/distributor|wholesale|wholesaler|importer|distribution|grosshandel/.test(t)) return '分销/批发/进口商';
  if (/dealer|reseller|händler|haendler/.test(t)) return '经销商/Dealer';
  if (/repair|workshop|service|werkstatt/.test(t)) return '维修/服务店';
  if (/shop|store|laden|radladen/.test(t)) return '自行车店/门店';
  return '待判断';
}

async function searchBingRss(q) {
  const url = 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(q);
  const r = await fetchText(url, 7000);
  const items = [];
  if (!r.text) return items;
  const re = /<item>[\s\S]*?<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?(?:<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>)?[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(r.text))) {
    items.push({ title: decodeHtml(m[1] || ''), url: decodeHtml(m[2] || ''), snippet: stripTags(decodeHtml(m[3] || '')) });
  }
  return items;
}
async function searchDuckDuckGo(q) {
  const url = 'https://duckduckgo.com/html/?q=' + encodeURIComponent(q);
  const r = await fetchText(url, 8000);
  const items = [];
  if (!r.text) return items;
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(r.text))) {
    let href = decodeHtml(m[1]);
    try {
      const u = new URL(href, 'https://duckduckgo.com');
      if (u.searchParams.get('uddg')) href = u.searchParams.get('uddg');
    } catch {}
    items.push({ title: stripTags(decodeHtml(m[2] || '')), url: href, snippet: '' });
  }
  return items;
}

function buildQueries(form) {
  const countries = form.countries;
  const cities = form.cities;
  const keyword = form.keyword || 'bike shop';
  const product = form.product || 'bike parts';
  const typeTerms = TYPE_TERMS[form.customerType] || TYPE_TERMS.all;
  const countryText = countries.filter(x => x !== 'ALL').join(' ');
  const cityText = cities.filter(x => x !== 'ALL').join(' ');
  const regionText = [cityText, countryText].filter(Boolean).join(' ');
  const base = [keyword, product, regionText].filter(Boolean).join(' ');
  const queries = [base];
  typeTerms.slice(0, 4).forEach(t => queries.push([t, product, regionText].filter(Boolean).join(' ')));
  return uniq(queries).slice(0, 5);
}

function extractEmails(text) {
  const matches = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return uniq(matches.map(e => e.toLowerCase()).filter(e => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(e)));
}
function extractPhones(text) {
  const matches = String(text || '').match(/(?:\+|00)?\d[\d\s().-]{7,}\d/g) || [];
  return uniq(matches.map(x => x.replace(/\s+/g,' ').trim()).filter(x => x.replace(/\D/g,'').length >= 8)).slice(0, 4);
}
function pickPriorityEmail(emails) {
  const priority = ['sales@','wholesale@','dealer@','distribution@','distributor@','export@','info@','contact@','hello@','service@'];
  for (const p of priority) {
    const hit = emails.find(e => e.startsWith(p));
    if (hit) return hit;
  }
  return emails[0] || '';
}
function contactLinks(baseUrl, html) {
  const links = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const href = decodeHtml(m[1]);
    const label = stripTags(decodeHtml(m[2] || '')).toLowerCase();
    const target = (href + ' ' + label).toLowerCase();
    if (/contact|about|impressum|dealer|wholesale|distribution|distributor|store|shop|service|kontakt|über|ueber/.test(target)) {
      try { links.push(new URL(href, baseUrl).toString()); } catch {}
    }
  }
  return uniq(links).slice(0, 4);
}
function scoreLead(item, pageText, emails, phones, form) {
  const hay = textLower(item.url, item.title, item.snippet, pageText);
  let score = 0;
  let match = 0;
  const positive = splitWords(form.mustInclude).concat(TYPE_TERMS[form.customerType] || TYPE_TERMS.all);
  positive.forEach(w => { if (hay.includes(w.toLowerCase())) { score += 6; match += 5; } });
  splitWords(form.product).forEach(w => { if (hay.includes(w.toLowerCase())) { score += 4; match += 3; } });
  if (emails.length) score += 25;
  if (phones.length) score += 10;
  const reg = isRegionMatch({ ...item, htmlText: pageText }, form.countries, form.cities);
  if (reg.countryOk && !(form.countries.includes('ALL') || !form.countries.length)) { score += 8; match += 8; }
  if (reg.cityOk && !(form.cities.includes('ALL') || !form.cities.length)) { score += 8; match += 8; }
  return { score: Math.min(100, score), match: Math.min(100, match), region: reg };
}

async function analyzeUrl(item, form) {
  const url = normalizeUrl(item.url);
  const domain = domainFromUrl(url);
  const home = await fetchText(url, 7000);
  let combined = [item.title, item.snippet, domain, home.text].join(' ');
  let emails = extractEmails(combined);
  let phones = extractPhones(combined);
  let contactUrl = '';
  if (home.text) {
    for (const link of contactLinks(url, home.text)) {
      if (emails.length >= 4 && phones.length) break;
      const sub = await fetchText(link, 5000);
      if (sub.text) {
        if (!contactUrl) contactUrl = link;
        combined += ' ' + sub.text;
        emails = uniq(emails.concat(extractEmails(sub.text)));
        phones = uniq(phones.concat(extractPhones(sub.text)));
      }
    }
  }
  const meta = scoreLead(item, stripTags(combined).slice(0, 40000), emails, phones, form);
  return {
    title: item.title || domain,
    url,
    domain,
    phones,
    emails,
    priorityEmail: pickPriorityEmail(emails),
    contactUrl,
    score: meta.score,
    match: meta.match,
    type: labelType(combined),
    regionOk: meta.region.both,
    notes: home.ok ? 'Checked website' : ('Homepage HTTP ' + (home.status || home.error || 'error'))
  };
}

function passesFilters(r, form) {
  if (form.onlyEmail && !r.emails.length) return false;
  if (form.onlyPhone && !r.phones.length) return false;
  if (r.score < form.minScore) return false;
  if (r.match < form.minMatch) return false;
  if (form.countryMode === 'strict' || form.cityMode === 'strict') {
    if (!r.regionOk) return false;
  }
  return true;
}

async function runSearch(form) {
  const diag = { queries: [], candidates: 0, afterExclude: 0, afterRegion: 0, analyzed: 0, final: 0, message: '' };
  const excludes = splitWords(form.exclude);
  let candidates = [];
  const manual = splitWords(form.manualUrls).map(normalizeUrl).filter(Boolean).map(u => ({ title: domainFromUrl(u), url: u, snippet: 'manual input' }));
  if (manual.length) {
    candidates = manual;
    diag.message = '使用手动官网列表，跳过公开搜索。';
  } else {
    const queries = buildQueries(form);
    diag.queries = queries;
    for (const q of queries) {
      const [b, d] = await Promise.allSettled([searchBingRss(q), searchDuckDuckGo(q)]);
      if (b.status === 'fulfilled') candidates.push(...b.value);
      if (d.status === 'fulfilled') candidates.push(...d.value);
      if (candidates.length >= form.limit * 4) break;
    }
  }
  const seen = new Set();
  candidates = candidates.map(x => ({ ...x, url: normalizeUrl(x.url) })).filter(x => x.url).filter(x => {
    const d = domainFromUrl(x.url);
    if (!d || seen.has(d)) return false;
    seen.add(d); return true;
  });
  diag.candidates = candidates.length;
  candidates = candidates.filter(x => !isExcluded(x, excludes));
  diag.afterExclude = candidates.length;
  if (form.countryMode === 'strict' || form.cityMode === 'strict') {
    candidates = candidates.filter(x => {
      const m = isRegionMatch(x, form.countries, form.cities);
      if (form.countryMode === 'strict' && !m.countryOk) return false;
      if (form.cityMode === 'strict' && !m.cityOk) return false;
      return true;
    });
  }
  diag.afterRegion = candidates.length;
  const maxAnalyze = Math.min(candidates.length, Math.max(form.limit * 3, 12));
  const results = [];
  for (const item of candidates.slice(0, maxAnalyze)) {
    const r = await analyzeUrl(item, form);
    diag.analyzed += 1;
    if (passesFilters(r, form)) results.push(r);
    if (results.length >= form.limit) break;
  }
  if (form.sort === 'match') results.sort((a,b) => b.match - a.match || b.score - a.score);
  else results.sort((a,b) => b.score - a.score || b.match - a.match);
  diag.final = results.length;
  if (!diag.message) {
    if (!diag.candidates) diag.message = '公开搜索源返回 0 个候选网站。建议改用手动官网列表或换搜索词。';
    else if (!diag.afterExclude) diag.message = '候选网站都被排除关键词过滤了。请减少排除关键词。';
    else if (!diag.afterRegion) diag.message = '候选网站没有通过地区严格筛选。请改为相关优先或不限制。';
    else if (!results.length) diag.message = '候选网站已分析，但没有通过邮箱/电话/分数等筛选。请降低筛选条件。';
  }
  return { results, diag };
}

function getForm(raw) {
  const countries = arr(raw.countries).filter(Boolean);
  const cities = arr(raw.cities).filter(Boolean);
  return {
    manualUrls: raw.manualUrls || '',
    customerType: raw.customerType || 'all',
    countryMode: raw.countryMode || 'priority',
    cityMode: raw.cityMode || 'priority',
    countries: countries.length ? countries : ['ALL'],
    cities: cities.length ? cities : ['ALL'],
    limit: Math.max(1, Math.min(50, Number(raw.limit || 20))),
    keyword: raw.keyword || 'bike shop',
    product: raw.product || 'bike parts, cycling accessories, power meter, crankset',
    mustInclude: raw.mustInclude || 'bike,bicycle,cycling,shop,dealer,distributor,parts',
    exclude: raw.exclude || 'microsoft,bing,google,facebook,instagram,youtube,amazon,ebay,wikipedia,reddit,cyclingnews,news,review,forum,blog,magazine,aliexpress,alibaba',
    minScore: Number(raw.minScore || 0),
    minMatch: Number(raw.minMatch || 0),
    sort: raw.sort || 'score',
    onlyEmail: raw.onlyEmail === 'on',
    onlyPhone: raw.onlyPhone === 'on'
  };
}

function options(list, selected) {
  const set = new Set(selected || []);
  return list.map(([v, label]) => `<option value="${esc(v)}"${set.has(v) ? ' selected' : ''}>${esc(label)}</option>`).join('');
}

function page(form, results, diag) {
  const rows = results.map(r => `<tr><td>${r.score}</td><td>${r.match}</td><td>${esc(r.type)}</td><td><b>${esc(r.title)}</b><br><a href="${esc(r.url)}" target="_blank">${esc(r.domain)}</a></td><td>${esc(r.phones.join('; '))}</td><td><b>${esc(r.priorityEmail)}</b></td><td>${esc(r.emails.join('; '))}</td><td>${r.contactUrl ? `<a href="${esc(r.contactUrl)}" target="_blank">打开</a>` : ''}</td><td>${esc(r.notes)}</td></tr>`).join('');
  const diagHtml = diag ? `<div class="diag"><b>搜索诊断：</b> 候选 ${diag.candidates}，排除后 ${diag.afterExclude}，地区筛选后 ${diag.afterRegion}，已分析 ${diag.analyzed}，最终 ${diag.final}<br><b>搜索词：</b> ${esc((diag.queries || []).join(' | '))}<br>${esc(diag.message || '')}</div>` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>全球骑行配件 B2B 线索采集工具</title><style>
  body{margin:0;background:#f4f6fb;color:#0f172a;font-family:Arial,'Microsoft YaHei',sans-serif}.wrap{max-width:1180px;margin:28px auto;padding:0 18px}.card{background:#fff;border-radius:18px;padding:24px;box-shadow:0 18px 50px rgba(15,23,42,.08);margin-bottom:22px}.badge{display:inline-block;background:#dcfce7;color:#047857;border-radius:999px;padding:8px 14px;font-size:13px;margin-left:12px}.notice{background:#fff7ed;border:1px solid #fdba74;color:#9a3412;border-radius:12px;padding:14px;margin:16px 0}.region{background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:16px;margin:16px 0}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}label{font-size:13px;color:#475569;display:block;margin-bottom:6px}input,select,textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:11px;padding:12px;font-size:15px;background:#fff}select[multiple]{min-height:132px}.help{font-size:12px;color:#64748b;margin-top:6px}.actions{display:flex;gap:12px;align-items:center}.btn{border:0;background:#0f172a;color:#fff;border-radius:12px;padding:14px 26px;font-weight:700;font-size:16px;cursor:pointer}.btn2{background:#94a3b8}.checks{display:flex;gap:20px;align-items:center;margin:14px 0}.checks label{display:flex;gap:6px;align-items:center;margin:0}.checks input{width:auto}.bar{height:10px;border-radius:99px;background:#0f172a;margin-top:12px}.small{font-size:12px;color:#64748b}.diag{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin:14px 0;color:#334155;line-height:1.7}table{width:100%;border-collapse:collapse;font-size:14px}th,td{border-bottom:1px solid #e2e8f0;text-align:left;padding:12px;vertical-align:top}th{background:#f8fafc}a{color:#2563eb;text-decoration:none}.csv{float:right;background:#64748b;color:#fff;padding:12px 18px;border-radius:12px;font-weight:700}@media(max-width:900px){.grid,.grid3{grid-template-columns:1fr}.actions{display:block}.btn{width:100%;margin:8px 0}}
  </style></head><body><div class="wrap"><div class="card"><h1>全球骑行配件 B2B 线索采集工具 <span class="badge">${VERSION}</span></h1><p>面向全球寻找自行车店、骑行店、配件经销商、批发商、分销商、进口商官网，并从公开页面提取邮箱和电话。</p><div class="notice"><b>说明：</b> 免费版不调用 Google Maps/Places，所以没有稳定的地图商家电话、地址和前 100 商家保证。默认排除的是搜索引擎、社媒、新闻测评、论坛、百科和大平台页面。</div>
  <form method="POST" action="/search"><label>可选：直接粘贴官网列表，一行一个。填写这里会优先分析这些网站，不依赖公开搜索。</label><textarea name="manualUrls" rows="4" placeholder="例如：\nhttps://example-bike-shop.de\nhttps://example-distributor.com">${esc(form.manualUrls)}</textarea>
  <div class="region"><h2>地区筛选</h2><p class="small">这里是真正的筛选框。按住 Ctrl / Cmd 可以多选国家或城市；选择严格匹配时，结果必须在域名、标题或网页内容里匹配国家/城市信号。</p><div class="grid"><div><label>国家/市场筛选模式</label><select name="countryMode"><option value="none"${form.countryMode==='none'?' selected':''}>不限制国家</option><option value="priority"${form.countryMode==='priority'?' selected':''}>国家相关优先</option><option value="strict"${form.countryMode==='strict'?' selected':''}>严格匹配国家</option></select></div><div><label>国家/市场，多选</label><select name="countries" multiple>${options(COUNTRY_OPTIONS, form.countries)}</select><div class="help">按 Ctrl / Cmd 多选；选“全球”表示不限制。</div></div><div><label>城市/地区筛选模式</label><select name="cityMode"><option value="none"${form.cityMode==='none'?' selected':''}>不限制城市</option><option value="priority"${form.cityMode==='priority'?' selected':''}>城市相关优先</option><option value="strict"${form.cityMode==='strict'?' selected':''}>严格匹配城市</option></select></div><div><label>城市/地区，多选</label><select name="cities" multiple>${options(CITY_OPTIONS, form.cities)}</select><div class="help">按 Ctrl / Cmd 多选；选“全部城市”表示不限制。</div></div></div></div>
  <div class="grid"><div><label>目标客户类型</label><select name="customerType"><option value="all"${form.customerType==='all'?' selected':''}>全部类型</option><option value="shop"${form.customerType==='shop'?' selected':''}>自行车店 / 门店</option><option value="dealer"${form.customerType==='dealer'?' selected':''}>经销商 Dealer</option><option value="distributor"${form.customerType==='distributor'?' selected':''}>分销 / 批发 / 进口商</option><option value="service"${form.customerType==='service'?' selected':''}>维修 / 服务店</option></select></div><div><label>目标数量</label><input name="limit" type="number" min="1" max="50" value="${esc(form.limit)}"></div><div><label>主搜索关键词</label><input name="keyword" value="${esc(form.keyword)}"></div><div><label>产品方向标签</label><input name="product" value="${esc(form.product)}"></div></div>
  <div class="grid"><div><label>必须包含关键词</label><input name="mustInclude" value="${esc(form.mustInclude)}"></div><div><label>排除关键词/域名，可编辑</label><input name="exclude" value="${esc(form.exclude)}"><div class="help">黑名单，用来过滤搜索引擎、新闻、论坛、社媒、大平台等无关页。</div></div><div><label>最低总分</label><input name="minScore" type="number" value="${esc(form.minScore)}"></div><div><label>最低匹配度</label><input name="minMatch" type="number" value="${esc(form.minMatch)}"></div></div>
  <div class="grid3"><div><label>排序</label><select name="sort"><option value="score"${form.sort==='score'?' selected':''}>按总分排序</option><option value="match"${form.sort==='match'?' selected':''}>按匹配度排序</option></select></div><div class="checks"><label><input type="checkbox" name="onlyEmail"${form.onlyEmail?' checked':''}>只看有邮箱</label><label><input type="checkbox" name="onlyPhone"${form.onlyPhone?' checked':''}>只看有电话</label></div><div class="actions"><button class="btn" type="submit">开始提取</button><a class="btn btn2" href="/" style="text-align:center;text-decoration:none">重置</a></div></div>
  <p><b>${diag ? '完成：找到 ' + results.length + ' 条线索' : '准备就绪'}</b></p><div class="bar"></div><p class="small">如果按钮无响应，可在任意输入框按 Enter 提交。搜索可能需要几十秒；免费 Render 有冷启动。</p></form>${diagHtml}</div>
  <div class="card"><a class="csv" href="/download.csv">下载 CSV</a><h2>结果 ${results.length} 条</h2><table><thead><tr><th>分数</th><th>匹配度</th><th>类型</th><th>公司/网站</th><th>电话</th><th>优先邮箱</th><th>全部邮箱</th><th>Contact 页面</th><th>备注</th></tr></thead><tbody>${rows || '<tr><td colspan="9">暂无结果。可以降低筛选条件，或直接粘贴官网列表。</td></tr>'}</tbody></table></div></div></body></html>`;
}

function toCsv(rows) {
  const header = ['score','match','type','title','domain','url','phones','priority_email','emails','contact_url','notes'];
  const lines = [header.join(',')];
  rows.forEach(r => {
    const vals = [r.score,r.match,r.type,r.title,r.domain,r.url,r.phones.join('; '),r.priorityEmail,r.emails.join('; '),r.contactUrl,r.notes].map(v => '"' + String(v == null ? '' : v).replace(/"/g,'""') + '"');
    lines.push(vals.join(','));
  });
  return lines.join('\n');
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/health') { res.writeHead(200, {'content-type':'text/plain'}); return res.end('ok ' + VERSION); }
  if (u.pathname === '/download.csv') {
    const csv = toCsv(LAST_RESULTS);
    res.writeHead(200, {'content-type':'text/csv; charset=utf-8', 'content-disposition':'attachment; filename="' + LAST_CSV_NAME + '"'});
    return res.end('\ufeff' + csv);
  }
  if (req.method === 'POST' && u.pathname === '/search') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 2_000_000) req.destroy(); });
    req.on('end', async () => {
      const raw = querystring.parse(body);
      const form = getForm(raw);
      try {
        const { results, diag } = await runSearch(form);
        LAST_RESULTS = results;
        LAST_CSV_NAME = 'global-cycling-b2b-leads-' + Date.now() + '.csv';
        res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
        res.end(page(form, results, diag));
      } catch (e) {
        res.writeHead(500, {'content-type':'text/html; charset=utf-8'});
        res.end(page(form, [], { candidates:0, afterExclude:0, afterRegion:0, analyzed:0, final:0, queries:[], message:'服务器错误：' + (e.stack || e.message) }));
      }
    });
    return;
  }
  const form = getForm({});
  res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
  res.end(page(form, [], null));
});

server.listen(PORT, () => {
  console.log('B2B Lead Scraper ' + VERSION + ' running on port ' + PORT);
});
