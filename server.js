'use strict';

const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const VERSION = 'v7.3 国家联动城市筛选版';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const COUNTRY_PRESETS = [
  ['', '全部国家 / 不限制'],
  ['Germany', 'Germany 德国'],
  ['France', 'France 法国'],
  ['United Kingdom', 'United Kingdom 英国'],
  ['Italy', 'Italy 意大利'],
  ['Spain', 'Spain 西班牙'],
  ['Netherlands', 'Netherlands 荷兰'],
  ['Belgium', 'Belgium 比利时'],
  ['Sweden', 'Sweden 瑞典'],
  ['Norway', 'Norway 挪威'],
  ['Denmark', 'Denmark 丹麦'],
  ['Finland', 'Finland 芬兰'],
  ['Poland', 'Poland 波兰'],
  ['Czech Republic', 'Czech Republic 捷克'],
  ['Austria', 'Austria 奥地利'],
  ['Switzerland', 'Switzerland 瑞士'],
  ['USA', 'USA 美国'],
  ['Canada', 'Canada 加拿大'],
  ['Australia', 'Australia 澳大利亚'],
  ['Japan', 'Japan 日本'],
  ['South Korea', 'South Korea 韩国']
];

const CITY_BY_COUNTRY = {
  '': [
    ['', '全部城市 / 不限制']
  ],
  'Germany': [['','全部城市 / 不限制'], ['Berlin','Berlin'], ['Munich','Munich'], ['Hamburg','Hamburg'], ['Frankfurt','Frankfurt'], ['Cologne','Cologne'], ['Stuttgart','Stuttgart'], ['Dusseldorf','Dusseldorf']],
  'France': [['','全部城市 / 不限制'], ['Paris','Paris'], ['Lyon','Lyon'], ['Marseille','Marseille'], ['Bordeaux','Bordeaux'], ['Toulouse','Toulouse'], ['Nice','Nice'], ['Lille','Lille']],
  'United Kingdom': [['','全部城市 / 不限制'], ['London','London'], ['Manchester','Manchester'], ['Birmingham','Birmingham'], ['Bristol','Bristol'], ['Glasgow','Glasgow'], ['Edinburgh','Edinburgh'], ['Leeds','Leeds']],
  'Italy': [['','全部城市 / 不限制'], ['Milan','Milan'], ['Rome','Rome'], ['Turin','Turin'], ['Bologna','Bologna'], ['Florence','Florence'], ['Naples','Naples']],
  'Spain': [['','全部城市 / 不限制'], ['Madrid','Madrid'], ['Barcelona','Barcelona'], ['Valencia','Valencia'], ['Seville','Seville'], ['Bilbao','Bilbao']],
  'Netherlands': [['','全部城市 / 不限制'], ['Amsterdam','Amsterdam'], ['Rotterdam','Rotterdam'], ['Utrecht','Utrecht'], ['Eindhoven','Eindhoven'], ['The Hague','The Hague']],
  'Belgium': [['','全部城市 / 不限制'], ['Brussels','Brussels'], ['Antwerp','Antwerp'], ['Ghent','Ghent'], ['Bruges','Bruges']],
  'Sweden': [['','全部城市 / 不限制'], ['Stockholm','Stockholm'], ['Gothenburg','Gothenburg'], ['Malmö','Malmö'], ['Uppsala','Uppsala']],
  'Norway': [['','全部城市 / 不限制'], ['Oslo','Oslo'], ['Bergen','Bergen'], ['Trondheim','Trondheim'], ['Stavanger','Stavanger']],
  'Denmark': [['','全部城市 / 不限制'], ['Copenhagen','Copenhagen'], ['Aarhus','Aarhus'], ['Odense','Odense']],
  'Finland': [['','全部城市 / 不限制'], ['Helsinki','Helsinki'], ['Tampere','Tampere'], ['Turku','Turku']],
  'Poland': [['','全部城市 / 不限制'], ['Warsaw','Warsaw'], ['Krakow','Krakow'], ['Wroclaw','Wroclaw'], ['Poznan','Poznan'], ['Gdansk','Gdansk']],
  'Czech Republic': [['','全部城市 / 不限制'], ['Prague','Prague'], ['Brno','Brno'], ['Ostrava','Ostrava']],
  'Austria': [['','全部城市 / 不限制'], ['Vienna','Vienna'], ['Graz','Graz'], ['Salzburg','Salzburg'], ['Innsbruck','Innsbruck']],
  'Switzerland': [['','全部城市 / 不限制'], ['Zurich','Zurich'], ['Geneva','Geneva'], ['Basel','Basel'], ['Bern','Bern'], ['Lausanne','Lausanne']],
  'USA': [['','全部城市 / 不限制'], ['New York','New York'], ['Los Angeles','Los Angeles'], ['Chicago','Chicago'], ['San Francisco','San Francisco'], ['Miami','Miami'], ['Seattle','Seattle'], ['Austin','Austin'], ['Denver','Denver'], ['Portland','Portland'], ['Boston','Boston']],
  'Canada': [['','全部城市 / 不限制'], ['Toronto','Toronto'], ['Vancouver','Vancouver'], ['Montreal','Montreal'], ['Calgary','Calgary'], ['Ottawa','Ottawa']],
  'Australia': [['','全部城市 / 不限制'], ['Sydney','Sydney'], ['Melbourne','Melbourne'], ['Brisbane','Brisbane'], ['Perth','Perth'], ['Adelaide','Adelaide']],
  'Japan': [['','全部城市 / 不限制'], ['Tokyo','Tokyo'], ['Osaka','Osaka'], ['Kyoto','Kyoto'], ['Yokohama','Yokohama'], ['Nagoya','Nagoya'], ['Fukuoka','Fukuoka']],
  'South Korea': [['','全部城市 / 不限制'], ['Seoul','Seoul'], ['Busan','Busan'], ['Incheon','Incheon'], ['Daegu','Daegu']]
};

function cityOptionsForCountry(country='') {
  return CITY_BY_COUNTRY[country] || CITY_BY_COUNTRY[''];
}

function normalizeCityForCountry(country='', city='') {
  const opts = cityOptionsForCountry(country).map(([v]) => v);
  return opts.includes(city) ? city : '';
}


const TLD_BY_COUNTRY = {
  'germany':['.de'], 'france':['.fr'], 'united kingdom':['.uk','.co.uk'], 'uk':['.uk','.co.uk'], 'italy':['.it'],
  'spain':['.es'], 'netherlands':['.nl'], 'belgium':['.be'], 'sweden':['.se'], 'norway':['.no'], 'denmark':['.dk'],
  'finland':['.fi'], 'poland':['.pl'], 'czech republic':['.cz'], 'austria':['.at'], 'switzerland':['.ch'],
  'usa':['.com','.us'], 'canada':['.ca'], 'australia':['.au','.com.au'], 'japan':['.jp'], 'south korea':['.kr']
};

const LOCAL_TERMS = {
  'germany': ['fahrradladen','fahrrad händler','fahrradteile händler','radladen','bike shop'],
  'france': ['magasin vélo','boutique vélo','revendeur vélo','pièces vélo','bike shop'],
  'united kingdom': ['bike shop','cycle shop','bicycle dealer','bike parts dealer'],
  'uk': ['bike shop','cycle shop','bicycle dealer','bike parts dealer'],
  'italy': ['negozio bici','negozio biciclette','rivenditore bici','componenti bici'],
  'spain': ['tienda bicicletas','tienda ciclismo','distribuidor bicicletas','componentes bicicleta'],
  'netherlands': ['fietsenwinkel','fiets dealer','fiets onderdelen','bike shop'],
  'belgium': ['fietsenwinkel','magasin vélo','bike shop'],
  'sweden': ['cykelbutik','cykelaffär','cykelhandlare','cykeldelar','cykelverkstad','bike shop'],
  'norway': ['sykkelbutikk','sykkel deler','sykkelforhandler','bike shop'],
  'denmark': ['cykelbutik','cykelforhandler','cykeldele','bike shop'],
  'finland': ['pyöräliike','pyöräkauppa','bike shop'],
  'poland': ['sklep rowerowy','części rowerowe','dystrybutor rowerów'],
  'czech republic': ['prodejna kol','cyklo obchod','bike shop'],
  'austria': ['fahrradladen','fahrrad händler','bike shop'],
  'switzerland': ['fahrradladen','velogeschäft','bike shop'],
  'usa': ['bike shop','bicycle shop','bike dealer','bike parts distributor'],
  'canada': ['bike shop','bicycle shop','bike dealer','bike parts distributor'],
  'australia': ['bike shop','bicycle shop','bike dealer','bike parts distributor'],
  'japan': ['自転車 店','サイクルショップ','自転車 パーツ','bike shop'],
  'south korea': ['자전거 매장','자전거 부품','bike shop']
};

const HARD_EXCLUDE = [
  'microsoft.com','bing.com','google.com','facebook.com','instagram.com','youtube.com','youtu.be','x.com','twitter.com',
  'linkedin.com','wikipedia.org','reddit.com','quora.com','pinterest.','amazon.','ebay.','aliexpress.','alibaba.',
  'cyclingnews.com','bikeradar.com','road.cc','pinkbike.com','singletracks.com','bikepacking.com',
  'help.','support.','privacy policy','terms of service',
  'walmart.com','rei.com','giant-bicycles.com','trekbikes.com','specialized.com','cannondale.com',
  'university','universität','college','research','study','pdf','brochure','manual','download','uploads'
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?){2,5}\d{2,5}/g;

function esc(s='') {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function lower(s='') { return String(s||'').toLowerCase(); }
function splitCSV(s='') {
  return String(s||'').split(',').map(x => x.trim()).filter(Boolean);
}
function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }
function normalizeUrl(u='') {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    const url = new URL(u);
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}
function domainFromUrl(u='') {
  try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; }
}
function isFileLike(url='') {
  try {
    const u = new URL(url);
    return /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(u.pathname);
  } catch { return /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(String(url)); }
}
function isBadCandidate(url, title, excludes) {
  const blob = lower(url + ' ' + title);
  const host = lower(domainFromUrl(url));
  if (isFileLike(url)) return true;
  const list = [...HARD_EXCLUDE, ...excludes.map(x => lower(x))];
  if (list.some(x => x && blob.includes(x))) return true;
  // Skip pages that are usually content, documents, or platforms rather than dealer/distributor homepages.
  if (/\b(pdf|brochure|manual|catalog|catalogue|download|fileadmin|wp-content\/uploads|university|universität|research|study|guide|safety|gesetz|policy)\b/i.test(blob)) return true;
  if (/\b(news|review|forum|blog|magazine|wiki|marketplace|classified|deals?|coupon)\b/i.test(blob)) return true;
  if (/\b(walmart|amazon|ebay|aliexpress|alibaba|rei co-op|giant bicycles|trek bikes|specialized)\b/i.test(blob)) return true;
  return false;
}
function extractPhones(text='') {
  const raw = String(text).match(/(?:\+\d{1,3}[\s().-]?)?(?:\(?\d{2,5}\)?[\s().-]?){2,5}\d{2,5}/g) || [];
  const out = [];
  for (let ph of raw) {
    ph = ph.replace(/\s+/g,' ').trim();
    const digits = ph.replace(/\D/g,'');
    if (digits.length < 7 || digits.length > 15) continue;
    if (/000000|111111|222222|333333|444444|555555|666666|777777|888888|999999/.test(digits)) continue;
    if (/\d+\.\d+/.test(ph)) continue; // coordinates / version numbers
    if (/^(19|20)\d{2}/.test(digits) && digits.length < 10) continue;
    if (!/[+()\s.-]/.test(ph) && digits.length > 11) continue;
    if (!out.some(x => x.replace(/\D/g,'') === digits)) out.push(ph);
  }
  return out.slice(0,4);
}
function countryKey(c='') { return lower(c).replace(/\s+/g,' ').trim(); }
function countryAliases(country='') {
  const c = countryKey(country);
  const map = {
    'usa':['usa','united states','america','us'],
    'united kingdom':['united kingdom','uk','great britain','england'],
    'south korea':['south korea','korea','kr'],
    'czech republic':['czech republic','czechia'],
    'germany':['germany','deutschland'],
    'france':['france','français'],
    'sweden':['sweden','sverige'],
    'norway':['norway','norge'],
    'denmark':['denmark','danmark'],
    'finland':['finland','suomi'],
    'japan':['japan','日本']
  };
  return map[c] || (c ? [c] : []);
}
function regionMatch(url, title, text, country, city) {
  const blob = lower([url,title,text].join(' '));
  const host = lower(domainFromUrl(url));
  let countryHit = !country;
  let cityHit = !city;
  if (country) {
    const aliases = countryAliases(country);
    const tlds = TLD_BY_COUNTRY[countryKey(country)] || [];
    countryHit = aliases.some(a => blob.includes(a)) || tlds.some(t => host.endsWith(t));
  }
  if (city) cityHit = blob.includes(lower(city));
  return {countryHit, cityHit};
}
function labelType(type) {
  const m = {
    all:'全部类型', shop:'自行车店/门店', dealer:'经销商 Dealer',
    distributor:'分销商 Distributor', wholesale:'批发商 Wholesale',
    importer:'进口商 Importer', service:'维修店/服务商'
  };
  return m[type] || '全部类型';
}

function buildQueries(p) {
  const country = p.country || '';
  const city = p.city || '';
  const main = p.keyword || 'bike shop';
  const product = p.product || '';
  const type = p.type || 'all';
  const typeTerms = {
    shop:['bike shop','bicycle shop','cycling store'],
    dealer:['bike dealer','bicycle dealer','cycling dealer'],
    distributor:['bike parts distributor','bicycle parts distributor','cycling distributor'],
    wholesale:['bike parts wholesale','cycling accessories wholesale','bicycle wholesale'],
    importer:['bike parts importer','bicycle importer','cycling importer'],
    service:['bike repair shop','bicycle service shop'],
    all:[main]
  }[type] || [main];

  const loc = [city, country].filter(Boolean).join(' ');
  const local = LOCAL_TERMS[countryKey(country)] || [];
  const queries = [];

  // Important: search query is intentionally short. Product tags are for scoring, not for making the search too long.
  queries.push([main, loc].filter(Boolean).join(' '));
  for (const t of typeTerms) queries.push([t, loc].filter(Boolean).join(' '));
  for (const t of local.slice(0,4)) queries.push([t, loc].filter(Boolean).join(' '));

  if (product && type !== 'shop') {
    const firstProduct = splitCSV(product)[0] || product.split(/\s+/).slice(0,2).join(' ');
    queries.push([firstProduct, typeTerms[0] || main, country].filter(Boolean).join(' '));
  }
  return uniq(queries).slice(0,8);
}

async function fetchText(url, timeoutMs=7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8' }
    });
    if (!res.ok) return {ok:false, status:res.status, text:''};
    const text = await res.text();
    return {ok:true, status:res.status, text};
  } catch (e) {
    return {ok:false, status:0, text:'', error:String(e && e.message || e)};
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(s='') {
  return String(s)
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}

function extractSearchCandidatesFromBingRSS(xml) {
  const out = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml))) {
    const item = m[0];
    const title = decodeEntities((item.match(/<title>([\s\S]*?)<\/title>/i)||[])[1] || '');
    let link = decodeEntities((item.match(/<link>([\s\S]*?)<\/link>/i)||[])[1] || '');
    if (link && /^https?:\/\//i.test(link)) out.push({title, url:link, source:'bing-rss'});
  }
  return out;
}

function extractSearchCandidatesFromDuck(html) {
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = decodeEntities(m[1]);
    let title = decodeEntities(m[2].replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
    try {
      const u = new URL(href, 'https://duckduckgo.com');
      if (u.searchParams.get('uddg')) href = decodeURIComponent(u.searchParams.get('uddg'));
    } catch {}
    if (/^https?:\/\//i.test(href)) out.push({title, url:href, source:'duckduckgo'});
  }
  return out;
}

async function searchWeb(query, diag) {
  const all = [];
  const encoded = encodeURIComponent(query);
  const sources = [
    {name:'bing-rss', url:`https://www.bing.com/search?format=rss&q=${encoded}`},
    {name:'duckduckgo', url:`https://duckduckgo.com/html/?q=${encoded}`}
  ];
  for (const src of sources) {
    const r = await fetchText(src.url, 7000);
    diag.sourceAttempts.push({source:src.name, query, ok:r.ok, status:r.status, bytes:r.text ? r.text.length : 0});
    if (!r.ok || !r.text) continue;
    if (src.name === 'bing-rss') all.push(...extractSearchCandidatesFromBingRSS(r.text));
    else all.push(...extractSearchCandidatesFromDuck(r.text));
  }
  return all;
}

function extractRelevantLinks(baseUrl, html) {
  const links = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = decodeEntities(m[1]);
    const label = decodeEntities(m[2].replace(/<[^>]+>/g,' ')).toLowerCase();
    const blob = (href + ' ' + label).toLowerCase();
    if (/(contact|about|impressum|dealer|wholesale|distributor|retailer|store|location|team|support|kontakt|händler|handler|butik|affär|kontakt)/i.test(blob)) {
      try {
        const u = new URL(href, baseUrl);
        if (u.protocol.startsWith('http')) {
          u.hash = '';
          links.push(u.toString());
        }
      } catch {}
    }
  }
  return uniq(links).slice(0,4);
}

function cleanHtmlText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function choosePriorityEmail(emails) {
  const good = ['sales@','wholesale@','dealer@','distributor@','export@','b2b@','order@','info@','contact@','hello@'];
  const bad = ['privacy@','abuse@','noreply@','no-reply@','support@','webmaster@'];
  const sorted = [...emails].sort((a,b) => {
    const la = lower(a), lb = lower(b);
    const sa = good.findIndex(g => la.includes(g));
    const sb = good.findIndex(g => lb.includes(g));
    const ba = bad.some(x => la.includes(x)) ? 1 : 0;
    const bb = bad.some(x => lb.includes(x)) ? 1 : 0;
    return (ba-bb) || ((sa < 0 ? 999 : sa) - (sb < 0 ? 999 : sb));
  });
  return sorted[0] || '';
}

function scoreLead({url,title,text,emails,phones,p}) {
  const blob = lower([url,title,text].join(' '));
  const required = splitCSV(p.required);
  const product = splitCSV(p.product);
  const type = p.type || 'all';

  let score = 0, match = 0;
  const tags = [];

  if (emails.length) { score += 30; tags.push('email'); }
  if (phones.length) { score += 10; tags.push('phone'); }

  const positive = ['bike','bicycle','cycling','cycle','fahrrad','rad','cykel','fiets','vélo','velo','bicicleta','bici','parts','accessories','shop','store','dealer','distributor','wholesale','retail','butik','händler','handler','handlare'];
  for (const w of positive) if (blob.includes(w)) { match += 5; score += 2; }

  for (const w of required) if (blob.includes(lower(w))) { match += 8; score += 3; }
  for (const w of product) if (blob.includes(lower(w))) { match += 5; score += 2; }

  const typeWords = {
    shop:['shop','store','retail','laden','butik','affär','winkel','magasin'],
    dealer:['dealer','händler','handler','handlare','revendeur','rivenditore'],
    distributor:['distributor','distribution','distribuidor','distributeur'],
    wholesale:['wholesale','wholesaler','grossist','großhandel','gros'],
    importer:['importer','import','importeur'],
    service:['repair','service','workshop','verkstad','werkstatt']
  }[type] || [];
  for (const w of typeWords) if (blob.includes(w)) { match += 10; score += 5; tags.push(type); }

  const region = regionMatch(url,title,text,p.country,p.city);
  if (region.countryHit && p.country) { score += 12; match += 8; tags.push('country'); }
  if (region.cityHit && p.city) { score += 12; match += 8; tags.push('city'); }

  if (/news|review|forum|blog|magazine|wiki|marketplace|classified|pdf|download|manual|brochure|university|walmart|amazon|ebay/i.test(blob)) { score -= 55; match -= 30; tags.push('low-relevance'); }

  return {score: Math.max(0, score), match: Math.max(0, match), tags: uniq(tags), region};
}

async function analyzeSite(candidate, p, diag) {
  const url = normalizeUrl(candidate.url);
  if (!url || isFileLike(url)) return null;
  const pages = [url];
  let allText = '';
  let allHtml = '';
  let contactUrl = '';
  const emails = new Set();
  const phones = new Set();
  let statusNotes = [];

  const first = await fetchText(url, 8500);
  diag.analyzed++;
  if (!first.ok) {
    return {
      url, title:candidate.title || domainFromUrl(url), phones:[], emails:[],
      priorityEmail:'', contactUrl:'', score:0, match:0, type:'unknown', tags:[],
      notes:`Homepage HTTP ${first.status || 'timeout'}`
    };
  }
  allHtml += first.text + '\n';
  allText += cleanHtmlText(first.text) + '\n';
  for (const e of first.text.match(EMAIL_RE) || []) emails.add(e.toLowerCase());
  // Phone numbers are extracted from cleaned text after all pages are collected, to avoid coordinates and file IDs.

  const links = extractRelevantLinks(url, first.text);
  for (const link of links.slice(0,3)) {
    const rr = await fetchText(link, 6500);
    if (!rr.ok) continue;
    if (!contactUrl && /contact|kontakt|impressum|dealer|wholesale|distributor/i.test(link)) contactUrl = link;
    allHtml += rr.text + '\n';
    allText += cleanHtmlText(rr.text) + '\n';
    for (const e of rr.text.match(EMAIL_RE) || []) emails.add(e.toLowerCase());
    // defer phone extraction to final cleaned text
  }

  const emailList = uniq([...emails]).filter(e => !/\.(png|jpg|jpeg|gif|webp)$/i.test(e));
  const phoneList = extractPhones(allText).slice(0,3);
  const title = candidate.title || (first.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1] || domainFromUrl(url);

  const sc = scoreLead({url,title,text:allText,emails:emailList,phones:phoneList,p});
  let type = 'other';
  const blob = lower([url,title,allText].join(' '));
  if (/distributor|distribution|distribuidor|distributeur/.test(blob)) type = 'distributor';
  else if (/wholesale|wholesaler|grossist|großhandel/.test(blob)) type = 'wholesale';
  else if (/dealer|händler|handler|handlare|revendeur/.test(blob)) type = 'dealer';
  else if (/shop|store|laden|butik|affär|winkel|magasin|fahrradladen|cykelbutik/.test(blob)) type = 'shop';

  return {
    url, title: cleanHtmlText(title).slice(0,140), phones: phoneList, emails: emailList,
    priorityEmail: choosePriorityEmail(emailList), contactUrl, score: sc.score, match: sc.match,
    type, tags: sc.tags, region: sc.region,
    notes: `Checked ${1 + Math.min(3, links.length)} pages`
  };
}

function passFinalFilters(r, p) {
  if (!r) return false;
  if (isBadCandidate(r.url, r.title, splitCSV(p.exclude))) return false;
  if (r.tags && r.tags.includes('low-relevance')) return false;
  if (Number(r.score) < Number(p.minScore || 0)) return false;
  if (Number(r.match) < Number(p.minMatch || 0)) return false;
  if (p.onlyEmail && !r.emails.length) return false;
  if (p.onlyPhone && !r.phones.length) return false;
  if (p.countryMode === 'strict' && p.country && !r.region.countryHit) return false;
  if (p.cityMode === 'strict' && p.city && !r.region.cityHit) return false;
  if (p.type && p.type !== 'all' && r.type !== p.type) {
    // allow dealer/distributor/wholesale overlap when match is high
    if (!((p.type === 'dealer' || p.type === 'distributor') && r.match >= 35)) return false;
  }
  return true;
}

async function runSearch(p) {
  const diag = {
    queries: buildQueries(p),
    sourceAttempts: [],
    candidatesRaw: 0,
    candidatesAfterExclude: 0,
    candidatesAfterRegionPreFilter: 0,
    analyzed: 0,
    final: 0,
    message: ''
  };

  const exclude = splitCSV(p.exclude).map(lower);
  let candidates = [];

  const manual = String(p.urls || '').split(/\r?\n/).map(normalizeUrl).filter(Boolean);
  if (manual.length) {
    candidates = manual.map(u => ({url:u, title:domainFromUrl(u), source:'manual'}));
    diag.message = '使用手动官网列表，不依赖公开搜索。';
  } else {
    for (const q of diag.queries) {
      const got = await searchWeb(q, diag);
      candidates.push(...got);
      if (candidates.length >= Number(p.target || 20) * 4) break;
    }
  }

  // Deduplicate and exclude junk.
  const seen = new Set();
  let deduped = [];
  for (const c of candidates) {
    const u = normalizeUrl(c.url);
    const d = domainFromUrl(u);
    if (!u || !d || seen.has(d)) continue;
    seen.add(d);
    deduped.push({url:u, title:c.title || d, source:c.source});
  }
  diag.candidatesRaw = deduped.length;

  deduped = deduped.filter(c => !isBadCandidate(c.url, c.title, exclude));
  diag.candidatesAfterExclude = deduped.length;

  // Light prefilter for region. In "prefer" mode we do not remove; we sort up. In strict mode, filter by URL/title only first.
  if ((p.countryMode === 'strict' && p.country) || (p.cityMode === 'strict' && p.city)) {
    deduped = deduped.filter(c => {
      const rm = regionMatch(c.url,c.title,'',p.country,p.city);
      const countryOk = !(p.countryMode === 'strict' && p.country) || rm.countryHit;
      const cityOk = !(p.cityMode === 'strict' && p.city) || rm.cityHit;
      return countryOk && cityOk;
    });
  }
  diag.candidatesAfterRegionPreFilter = deduped.length;

  // Prefer regional signals before analysis.
  deduped.sort((a,b) => {
    const ra = regionMatch(a.url,a.title,'',p.country,p.city);
    const rb = regionMatch(b.url,b.title,'',p.country,p.city);
    return ((rb.countryHit?1:0)+(rb.cityHit?1:0)) - ((ra.countryHit?1:0)+(ra.cityHit?1:0));
  });

  const maxAnalyze = Math.min(Math.max(Number(p.target || 20) * 2, 12), 36);
  const results = [];
  for (const c of deduped.slice(0, maxAnalyze)) {
    const r = await analyzeSite(c, p, diag);
    if (passFinalFilters(r, p)) results.push(r);
    if (results.length >= Number(p.target || 20)) break;
  }

  if (p.sort === 'match') results.sort((a,b) => b.match - a.match);
  else if (p.sort === 'email') results.sort((a,b) => Number(!!b.priorityEmail) - Number(!!a.priorityEmail) || b.score - a.score);
  else results.sort((a,b) => b.score - a.score);

  diag.final = results.length;
  if (!manual.length && diag.candidatesRaw === 0) {
    diag.message = '公开搜索源返回 0 个候选网站。请尝试更短的关键词，或直接粘贴官网列表。';
  } else if (diag.candidatesAfterExclude === 0) {
    diag.message = '候选网站都被排除关键词/域名或文件/平台过滤掉了。请减少排除词，或改用手动官网列表。';
  } else if (diag.candidatesAfterRegionPreFilter === 0) {
    diag.message = '严格地区筛选过滤掉了所有候选。请改为“相关优先”或“不限制”。';
  } else if (results.length === 0) {
    diag.message = '已找到候选网站，但最终筛选后为 0。请降低最低分/匹配度，或取消只看邮箱/电话。';
  }

  return {results, diag};
}

function formValue(q, k, def='') { return q.get(k) ?? def; }
function paramsFromUrl(urlObj) {
  const q = urlObj.searchParams;
  const country = formValue(q,'country','Germany');
  const city = normalizeCityForCountry(country, formValue(q,'city','Berlin'));
  return {
    urls: formValue(q,'urls',''),
    type: formValue(q,'type','all'),
    countryMode: formValue(q,'countryMode','strict'),
    country,
    cityMode: formValue(q,'cityMode','prefer'),
    city,
    target: Math.min(Math.max(parseInt(formValue(q,'target','10'),10) || 10, 1), 30),
    keyword: formValue(q,'keyword','bike shop'),
    product: formValue(q,'product','bike parts, cycling accessories, power meter, crankset'),
    required: formValue(q,'required','bike,bicycle,cycling,shop,dealer,distributor,parts'),
    exclude: formValue(q,'exclude','microsoft,bing,google,facebook,instagram,youtube,amazon,ebay,wikipedia,reddit,cyclingnews,news,review,forum,blog,magazine,pdf,download,manual,brochure,walmart,rei,giant,trek,specialized,hotel,booking,trivago,tripadvisor,dicks,zigwheels,buycycle,marketplace,used'),
    minScore: parseInt(formValue(q,'minScore','20'),10) || 0,
    minMatch: parseInt(formValue(q,'minMatch','20'),10) || 0,
    onlyEmail: q.get('onlyEmail') === 'on',
    onlyPhone: q.get('onlyPhone') === 'on',
    sort: formValue(q,'sort','score')
  };
}
function selected(a,b) { return String(a) === String(b) ? 'selected' : ''; }
function checked(v) { return v ? 'checked' : ''; }

function renderPage(p, data) {
  const results = data?.results || [];
  const diag = data?.diag || null;
  const rows = results.map(r => `
    <tr>
      <td><span class="badge">${esc(r.score)}</span></td>
      <td><span class="badge muted">${esc(r.match)}</span></td>
      <td>${esc(labelType(r.type))}</td>
      <td><b>${esc(r.title || domainFromUrl(r.url))}</b><br><a href="${esc(r.url)}" target="_blank">${esc(r.url)}</a><div class="small">${esc((r.tags||[]).join(', '))}</div></td>
      <td>${esc((r.phones||[]).join('; '))}</td>
      <td><b>${esc(r.priorityEmail||'')}</b></td>
      <td>${esc((r.emails||[]).join('; '))}</td>
      <td>${r.contactUrl ? `<a href="${esc(r.contactUrl)}" target="_blank">打开</a>` : ''}</td>
      <td class="small">${esc(r.notes||'')}</td>
    </tr>
  `).join('');

  const csvData = encodeURIComponent(toCSV(results));
  const diagHtml = diag ? `
    <div class="diag">
      <b>搜索诊断：</b>
      候选 ${diag.candidatesRaw}，排除后 ${diag.candidatesAfterExclude}，地区筛选后 ${diag.candidatesAfterRegionPreFilter}，已分析 ${diag.analyzed}，最终 ${diag.final}
      <br><b>搜索词：</b> ${esc(diag.queries.join(' | '))}
      ${diag.message ? `<br><b>提示：</b> ${esc(diag.message)}` : ''}
      <details><summary>搜索源状态</summary>
        <pre>${esc(JSON.stringify(diag.sourceAttempts, null, 2))}</pre>
      </details>
    </div>
  ` : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>全球骑行配件 B2B 线索采集工具</title>
<style>
:root{--bg:#f5f7fb;--card:#fff;--ink:#0f172a;--muted:#64748b;--line:#dbe5f2;--blue:#0f172a;--soft:#eef6ff;--orange:#fff7ed}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font-family:Arial,"Microsoft YaHei",sans-serif;color:var(--ink)}
.wrap{max-width:1180px;margin:32px auto;padding:0 20px}.card{background:var(--card);border-radius:18px;box-shadow:0 16px 40px rgba(15,23,42,.08);padding:28px;margin-bottom:24px}
h1{margin:0 0 8px;font-size:30px}.version{display:inline-block;background:#d1fae5;color:#047857;font-size:13px;border-radius:999px;padding:6px 12px;margin-left:12px}.lead{color:#475569;margin:0 0 18px}
.notice{background:var(--orange);border:1px solid #fdba74;border-radius:12px;padding:14px 16px;color:#9a3412;margin-bottom:18px;line-height:1.55}
.region{background:#eef6ff;border:1px solid #bfdbfe;border-radius:14px;padding:18px;margin:16px 0}.region h2{margin:0 0 8px;font-size:22px}.small{font-size:12px;color:var(--muted);line-height:1.45}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
label{font-size:13px;color:#334155;display:block;margin-bottom:6px}input,textarea,select{width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:12px 14px;font-size:15px;background:#fff}textarea{min-height:86px;font-family:ui-monospace,monospace}
button,.btn{border:0;border-radius:12px;padding:14px 22px;background:#0f172a;color:#fff;font-size:17px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block;text-align:center}.btn.secondary{background:#94a3b8}.actions{display:flex;gap:12px;align-items:end}
.checks{display:flex;gap:22px;margin:14px 0}.checks label{display:flex;align-items:center;gap:8px;margin:0}.checks input{width:auto}
.progress{height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin-top:10px}.bar{height:100%;background:#0f172a;width:${data ? '100' : '0'}%}
.tableWrap{width:100%;overflow-x:auto;border:1px solid #e2e8f0;border-radius:12px}table{width:100%;min-width:1120px;border-collapse:collapse;font-size:14px;table-layout:fixed}th,td{border-bottom:1px solid #e2e8f0;padding:12px;text-align:left;vertical-align:top;word-break:break-word}th{background:#f8fafc}.badge{background:#e0e7ff;border-radius:999px;padding:4px 8px;color:#3730a3;font-size:12px}.badge.muted{background:#e2e8f0;color:#334155}
.diag{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-top:14px;line-height:1.6}.diag pre{white-space:pre-wrap;max-height:260px;overflow:auto}
@media(max-width:900px){.grid,.grid3{grid-template-columns:1fr}.actions{align-items:stretch}.wrap{padding:0 12px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>全球骑行配件 B2B 线索采集工具 <span class="version">${VERSION}</span></h1>
    <p class="lead">面向全球寻找自行车店、骑行店、配件经销商、批发商、分销商、进口商官网，并从公开页面提取邮箱和电话。此版会过滤 PDF、新闻测评、大平台、品牌官网和非客户页面。</p>
    <div class="notice"><b>说明：</b> 免费版不调用 Google Maps/Places，所以没有稳定的地图商家电话、地址和前 100 商家保证。默认排除的是搜索引擎、社媒、新闻测评、论坛、百科和大平台页面，不是排除你的浏览器。</div>

    <form method="GET" action="/search">
      <label>可选：直接粘贴官网列表，一行一个。填写这里会优先分析这些网站，不依赖公开搜索。</label>
      <textarea name="urls" placeholder="例如：&#10;https://example-bike-shop.de&#10;https://example-distributor.com">${esc(p.urls)}</textarea>

      <div class="region">
        <h2>地区筛选</h2>
        <p class="small">这里是单选筛选，不做多选。一次只跑一个国家/市场和一个城市/地区。选择国家后，城市下拉框会自动切换到该国家常用城市，避免 France + Berlin 这类不匹配组合。</p>
        <div class="grid">
          <div><label>国家/市场筛选模式</label><select name="countryMode">
            <option value="none" ${selected(p.countryMode,'none')}>不限制国家</option>
            <option value="prefer" ${selected(p.countryMode,'prefer')}>国家相关优先</option>
            <option value="strict" ${selected(p.countryMode,'strict')}>严格匹配国家</option>
          </select></div>
          <div><label>国家/市场，单选</label><select id="countrySelect" name="country">${COUNTRY_PRESETS.map(([v,l])=>`<option value="${esc(v)}" ${selected(p.country,v)}>${esc(l)}</option>`).join('')}</select></div>
          <div><label>城市/地区筛选模式</label><select name="cityMode">
            <option value="none" ${selected(p.cityMode,'none')}>不限制城市</option>
            <option value="prefer" ${selected(p.cityMode,'prefer')}>城市相关优先</option>
            <option value="strict" ${selected(p.cityMode,'strict')}>严格匹配城市</option>
          </select></div>
          <div><label>城市/地区，单选</label><select id="citySelect" name="city">${cityOptionsForCountry(p.country).map(([v,l])=>`<option value="${esc(v)}" ${selected(p.city,v)}>${esc(l)}</option>`).join('')}</select></div>
        </div>
      </div>

      <div class="grid">
        <div><label>目标客户类型</label><select name="type">
          ${['all','shop','dealer','distributor','wholesale','importer','service'].map(v=>`<option value="${v}" ${selected(p.type,v)}>${esc(labelType(v))}</option>`).join('')}
        </select></div>
        <div><label>目标数量</label><input name="target" value="${esc(p.target)}"></div>
        <div><label>主搜索关键词</label><input name="keyword" value="${esc(p.keyword)}"></div>
        <div><label>产品方向标签</label><input name="product" value="${esc(p.product)}"></div>
        <div><label>必须包含关键词</label><input name="required" value="${esc(p.required)}"></div>
        <div><label>排除关键词/域名，可编辑</label><input name="exclude" value="${esc(p.exclude)}"><div class="small">黑名单，用来过滤搜索引擎、新闻、论坛、社媒、大平台等无关页。</div></div>
        <div><label>最低总分</label><input name="minScore" value="${esc(p.minScore)}"></div>
        <div><label>最低匹配度</label><input name="minMatch" value="${esc(p.minMatch)}"></div>
        <div><label>排序</label><select name="sort"><option value="score" ${selected(p.sort,'score')}>按总分排序</option><option value="match" ${selected(p.sort,'match')}>按匹配度排序</option><option value="email" ${selected(p.sort,'email')}>有邮箱优先</option></select></div>
        <div class="actions"><button type="submit">开始提取</button><a class="btn secondary" href="/">重置</a></div>
      </div>
      <div class="checks">
        <label><input type="checkbox" name="onlyEmail" ${checked(p.onlyEmail)}> 只看有邮箱</label>
        <label><input type="checkbox" name="onlyPhone" ${checked(p.onlyPhone)}> 只看有电话</label>
      </div>
      <b>${data ? `完成：找到 ${results.length} 条线索` : '准备就绪'}</b>
      <div class="progress"><div class="bar"></div></div>
      <div class="small">如果按钮无响应，也可以在任意输入框按 Enter 提交。搜索可能需要几十秒；免费 Render 有冷启动。</div>
      ${diagHtml}
    </form>
  </div>

  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
      <h2>结果 ${results.length} 条</h2>
      <a class="btn secondary" href="data:text/csv;charset=utf-8,${csvData}" download="global-cycling-b2b-leads.csv">下载 CSV</a>
    </div>
    <div class="tableWrap"><table>
      <thead><tr><th style="width:64px">分数</th><th style="width:70px">匹配度</th><th style="width:90px">类型</th><th style="width:300px">公司/网站</th><th style="width:140px">电话</th><th style="width:180px">优先邮箱</th><th style="width:240px">全部邮箱</th><th style="width:110px">Contact 页面</th><th style="width:120px">备注</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9" class="small">暂无结果。可以降低筛选条件，或者直接粘贴官网列表。</td></tr>'}</tbody>
    </table></div>
  </div>
</div>

<script>
(function(){
  const cityByCountry = ${JSON.stringify(CITY_BY_COUNTRY)};
  const countrySelect = document.getElementById('countrySelect');
  const citySelect = document.getElementById('citySelect');
  if (!countrySelect || !citySelect) return;
  function rebuildCities() {
    const selectedCity = citySelect.value;
    const list = cityByCountry[countrySelect.value] || cityByCountry[''] || [['','全部城市 / 不限制']];
    citySelect.innerHTML = '';
    for (const pair of list) {
      const opt = document.createElement('option');
      opt.value = pair[0];
      opt.textContent = pair[1];
      citySelect.appendChild(opt);
    }
    if ([...citySelect.options].some(o => o.value === selectedCity)) citySelect.value = selectedCity;
    else citySelect.value = '';
  }
  countrySelect.addEventListener('change', rebuildCities);
})();
</script>

</body>
</html>`;
}

function toCSV(results) {
  const headers = ['score','match','type','title','url','phone','priority_email','emails','contact_url','notes'];
  const lines = [headers.join(',')];
  for (const r of results) {
    const row = [
      r.score, r.match, labelType(r.type), r.title, r.url, (r.phones||[]).join('; '),
      r.priorityEmail||'', (r.emails||[]).join('; '), r.contactUrl||'', r.notes||''
    ].map(v => `"${String(v??'').replace(/"/g,'""')}"`);
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

const server = http.createServer(async (req,res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  if (urlObj.pathname === '/health') {
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({ok:true, version:VERSION}));
    return;
  }
  if (urlObj.pathname === '/search') {
    const p = paramsFromUrl(urlObj);
    let data;
    try {
      data = await runSearch(p);
    } catch (e) {
      data = {results:[], diag:{queries:[],sourceAttempts:[],candidatesRaw:0,candidatesAfterExclude:0,candidatesAfterRegionPreFilter:0,analyzed:0,final:0,message:'运行出错：'+String(e && e.message || e)}};
    }
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
    res.end(renderPage(p, data));
    return;
  }
  const p = paramsFromUrl(urlObj);
  res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
  res.end(renderPage(p, null));
});

server.listen(PORT, () => {
  console.log(`${VERSION} running on port ${PORT}`);
});
