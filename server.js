'use strict';

const http = require('http');
const { URL, URLSearchParams } = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const VERSION = 'v6.3 稳定提交版';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const STORE = new Map();

const DEFAULT_EXCLUDE = [
  'microsoft','bing','google','youtube','facebook','instagram','linkedin','twitter','x.com',
  'wikipedia','amazon','ebay','reddit','quora','pinterest','aliexpress','alibaba','temu',
  'cyclingnews','bikeradar','road.cc','pinkbike','singletracks','bikepacking','outsideonline',
  'trekbikes','specialized','giant-bicycles','canyon','shimano','sram','garmin','cannondale',
  'scott-sports','cube.eu','merida-bikes','pinarello','cervelo','bianchi','orbea','focus-bikes',
  'news','magazine','review','blog','forum','wiki','support','help center','privacy policy only','press release','coupon','podcast'
];

const TYPE_WORDS = {
  all: ['bike shop','bicycle shop','cycling store','bike dealer','bicycle dealer','cycling dealer','bike distributor','bicycle distributor','bike wholesale','bike parts','cycling accessories'],
  shop: ['bike shop','bicycle shop','cycling store','bike store','cycle shop','Fahrradladen','Radladen','bicicleteria','magasin velo','tienda bicicletas'],
  dealer: ['bike dealer','bicycle dealer','cycling dealer','Fahrrad Händler','Fahrradhaendler','authorized dealer','cycle dealer'],
  distributor: ['bike distributor','bicycle distributor','cycling distributor','cycling accessories distributor','bike parts distributor','importer distributor'],
  wholesaler: ['bike wholesale','bicycle wholesale','cycling wholesale','bike parts wholesale','cycling accessories wholesaler'],
  importer: ['bike importer','bicycle importer','cycling importer','bike parts importer','cycling accessories importer'],
  repair: ['bike repair shop','bicycle repair','cycle workshop','Fahrradwerkstatt','bike service']
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function norm(s) { return String(s || '').trim(); }
function splitList(s) { return norm(s).split(/[\n,;]+/).map(x => x.trim()).filter(Boolean); }
function unique(arr) { return [...new Set(arr.filter(Boolean))]; }

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function fetchText(url, timeout = 8000) {
  const t = withTimeout(timeout);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml' }, signal: t.signal, redirect: 'follow' });
    const text = await r.text();
    return { ok: r.ok, status: r.status, url: r.url, text: text.slice(0, 900000) };
  } catch (e) {
    return { ok: false, status: 0, url, text: '', error: e.message || String(e) };
  } finally {
    t.done();
  }
}

function domainFromUrl(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function normalizeUrl(u) {
  let x = norm(u);
  if (!x) return '';
  if (!/^https?:\/\//i.test(x)) x = 'https://' + x;
  try {
    const url = new URL(x);
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}

function isExcluded(url, title, excludes) {
  const hay = (url + ' ' + title).toLowerCase();
  return excludes.some(w => w && hay.includes(w.toLowerCase()));
}

function extractEmails(text) {
  const raw = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return unique(raw.map(e => e.toLowerCase()).filter(e => !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(e))).slice(0, 20);
}

function decodeEntities(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&#x2F;/g, '/').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function extractTitle(html, fallback) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeEntities(m ? m[1].replace(/\s+/g, ' ').trim() : fallback || '');
}

function extractPhones(text) {
  const raw = text.match(/(?:\+?\d[\d\s().\-\/]{7,}\d)/g) || [];
  return unique(raw.map(p => p.replace(/\s+/g, ' ').trim()).filter(p => p.replace(/\D/g, '').length >= 8 && p.replace(/\D/g, '').length <= 15)).slice(0, 5);
}

function findContactLinks(baseUrl, html) {
  const links = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = decodeEntities(m[1]);
    const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const combo = (href + ' ' + label).toLowerCase();
    if (/(contact|kontakt|about|impressum|dealer|wholesale|distributor|partner|b2b|retailer|store|shop|team|company)/.test(combo)) {
      try { links.push(new URL(href, baseUrl).toString()); } catch {}
    }
  }
  return unique(links).filter(u => domainFromUrl(u) === domainFromUrl(baseUrl)).slice(0, 5);
}

function classify(text, title, url) {
  const h = (text + ' ' + title + ' ' + url).toLowerCase();
  const tags = [];
  let type = 'other';
  if (/(distributor|distribution|distribuidor|grossiste|vertrieb|importer|importateur|importeur)/.test(h)) { type = 'distributor'; tags.push('distributor'); }
  if (/(wholesale|wholesaler|b2b|bulk|trade account|dealer account|reseller)/.test(h)) { if (type === 'other') type = 'wholesaler'; tags.push('wholesale'); }
  if (/(dealer|retailer|authorized dealer|bike dealer|fahrrad händler|haendler|händler)/.test(h)) { if (type === 'other') type = 'dealer'; tags.push('dealer'); }
  if (/(bike shop|bicycle shop|cycling store|bike store|cycle shop|fahrradladen|radladen|shop)/.test(h)) { if (type === 'other') type = 'shop'; tags.push('shop'); }
  if (/(repair|workshop|service|werkstatt)/.test(h)) { tags.push('repair'); }
  if (/(power meter|powermeter|crank|crankset|chainring|bike parts|bicycle parts|cycling accessories|zubehör|teile|components)/.test(h)) tags.push('parts/accessories');
  return { type, tags: unique(tags) };
}

function scoreLead({html, title, url, emails, phones, contactUrl, query, marketWords, mustWords}) {
  const hay = (html + ' ' + title + ' ' + url).toLowerCase();
  const cl = classify(hay, title, url);
  let match = 0;
  let score = 0;
  const positive = ['bike','bicycle','cycling','cycle','fahrrad','radladen','dealer','shop','store','distributor','wholesale','wholesaler','importer','parts','accessories','zubehör','components','power meter','crank'];
  for (const w of positive) if (hay.includes(w)) match += 6;
  for (const w of mustWords) if (w && hay.includes(w.toLowerCase())) match += 8;
  for (const w of marketWords) if (w && hay.includes(w.toLowerCase())) match += 5;
  match = Math.min(100, match);
  score += match;
  if (emails.length) score += 30;
  if (phones.length) score += 10;
  if (contactUrl) score += 8;
  if (cl.type !== 'other') score += 15;
  if (cl.tags.includes('parts/accessories')) score += 10;
  if (/privacy|terms|support|help|news|magazine|review|blog|forum/.test(hay)) score -= 15;
  score = Math.max(0, Math.min(100, score));
  return { score, match, type: cl.type, tags: cl.tags };
}

async function searchBing(query, limit, excludes) {
  const url = 'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&count=30';
  const r = await fetchText(url, 9000);
  if (!r.text) return [];
  const out = [];
  const re = /<li class="b_algo"[\s\S]*?<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(r.text))) {
    const link = decodeEntities(m[1]);
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const u = normalizeUrl(link);
    if (!u || isExcluded(u, title, excludes)) continue;
    out.push({ url: u, title });
    if (out.length >= limit) break;
  }
  return out;
}

async function analyzeSite(inputUrl, seedTitle, opts) {
  const home = normalizeUrl(inputUrl);
  if (!home) return null;
  const domain = domainFromUrl(home);
  if (!domain) return null;
  if (isExcluded(home, seedTitle || '', opts.excludes)) return null;

  const pages = [];
  const homeRes = await fetchText(home, 7500);
  if (!homeRes.text) return { url: home, title: seedTitle || domain, phones: [], emails: [], priorityEmail: '', contactUrl: '', score: 0, match: 0, type: 'other', tags: [], notes: 'Homepage unavailable' };
  const title = extractTitle(homeRes.text, seedTitle || domain);
  pages.push({ url: homeRes.url || home, text: homeRes.text });

  const contactLinks = findContactLinks(homeRes.url || home, homeRes.text).slice(0, 4);
  const pageResults = await Promise.all(contactLinks.map(u => fetchText(u, 6000)));
  for (const pr of pageResults) if (pr.text) pages.push({ url: pr.url, text: pr.text });

  const allText = pages.map(p => p.text).join('\n');
  const emails = extractEmails(allText);
  const phones = extractPhones(allText);
  const contactPage = pages.find(p => p.url !== (homeRes.url || home) && extractEmails(p.text).length)?.url || contactLinks[0] || '';
  const sc = scoreLead({ html: allText, title, url: home, emails, phones, contactUrl: contactPage, marketWords: opts.marketWords, mustWords: opts.mustWords });
  const priority = pickPriorityEmail(emails);
  return { url: home, title, phones, emails, priorityEmail: priority, contactUrl: contactPage, score: sc.score, match: sc.match, type: sc.type, tags: sc.tags, notes: 'Checked ' + pages.length + ' pages' };
}

function pickPriorityEmail(emails) {
  const preferred = ['sales@','wholesale@','dealer@','b2b@','trade@','info@','contact@','hello@','order@','procurement@','purchase@'];
  for (const p of preferred) {
    const found = emails.find(e => e.startsWith(p));
    if (found) return found;
  }
  return emails[0] || '';
}

async function mapLimit(items, limit, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); } catch (e) { results[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function buildQueries(params) {
  const markets = splitList(params.markets || 'Germany');
  const cities = splitList(params.cities || 'Berlin');
  const productTags = splitList(params.productTags || 'bike parts, cycling accessories');
  const keyword = norm(params.keyword || 'bike dealer');
  const typeWords = TYPE_WORDS[params.targetType] || TYPE_WORDS.all;
  const terms = unique([keyword, ...typeWords.slice(0, 3), ...productTags.slice(0, 3)]).slice(0, 7);
  const queries = [];
  for (const market of markets.slice(0, 4)) {
    for (const city of (cities.length ? cities : ['']).slice(0, 5)) {
      for (const t of terms.slice(0, 3)) queries.push([t, city, market].filter(Boolean).join(' '));
    }
  }
  return unique(queries).slice(0, 12);
}

async function runSearch(params) {
  const limit = Math.max(1, Math.min(50, parseInt(params.limit || '10', 10) || 10));
  const excludes = unique([...DEFAULT_EXCLUDE, ...splitList(params.exclude || '')]);
  const mustWords = splitList(params.must || 'bike,bicycle,cycling,dealer,shop,distributor,parts');
  const marketWords = unique([...splitList(params.markets || ''), ...splitList(params.cities || '')]);
  const minScore = parseInt(params.minScore || '45', 10) || 0;
  const minMatch = parseInt(params.minMatch || '35', 10) || 0;
  const requireEmail = params.requireEmail === 'on';
  const requirePhone = params.requirePhone === 'on';
  const manualUrls = splitList(params.manualUrls || '').map(normalizeUrl).filter(Boolean);

  let candidates = manualUrls.map(u => ({ url: u, title: domainFromUrl(u) }));
  if (!candidates.length) {
    const queries = buildQueries(params);
    for (const q of queries) {
      const got = await searchBing(q, 8, excludes);
      candidates.push(...got);
      candidates = uniqueByDomain(candidates);
      if (candidates.length >= limit * 3) break;
    }
  }

  candidates = uniqueByDomain(candidates).slice(0, Math.max(10, limit * 3));
  const opts = { excludes, marketWords, mustWords };
  let analyzed = (await mapLimit(candidates, 3, c => analyzeSite(c.url, c.title, opts))).filter(Boolean);
  analyzed = analyzed.filter(r => r.score >= minScore && r.match >= minMatch);
  if (requireEmail) analyzed = analyzed.filter(r => r.emails.length > 0);
  if (requirePhone) analyzed = analyzed.filter(r => r.phones.length > 0);
  if ((params.sort || 'score') === 'score') analyzed.sort((a, b) => b.score - a.score || b.match - a.match);
  return analyzed.slice(0, limit);
}

function uniqueByDomain(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const d = domainFromUrl(it.url);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(it);
  }
  return out;
}

function renderPage(params = {}, results = [], message = '') {
  const id = results.length ? saveResults(results) : '';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>全球骑行配件 B2B 线索采集工具</title>
<style>
:root{--bg:#f5f7fb;--card:#fff;--text:#0f172a;--muted:#64748b;--line:#e2e8f0;--primary:#0f172a;--green:#dcfce7;--orange:#fff7ed;--orange2:#fed7aa;}
*{box-sizing:border-box} body{margin:0;background:var(--bg);font-family:Arial,"Microsoft YaHei",sans-serif;color:var(--text)} .wrap{max-width:1180px;margin:36px auto;padding:0 18px}.card{background:#fff;border:1px solid var(--line);border-radius:20px;box-shadow:0 16px 40px rgba(15,23,42,.08);padding:24px;margin-bottom:22px}.title{font-size:30px;font-weight:800;margin:0 0 8px}.badge{display:inline-block;background:var(--green);color:#047857;border-radius:999px;font-size:13px;padding:6px 12px;margin-left:10px;vertical-align:middle}.sub{color:#475569;margin:0 0 18px}.note{background:var(--orange);border:1px solid var(--orange2);border-radius:14px;padding:14px 16px;color:#9a3412;line-height:1.55;margin:14px 0 18px}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px}.field{display:flex;flex-direction:column;gap:6px}.field label{font-size:13px;color:#475569}.field input,.field textarea,.field select{width:100%;border:1px solid #cbd5e1;border-radius:12px;padding:12px 14px;font-size:15px;background:#fff}.field textarea{min-height:88px;font-family:Consolas,monospace}.col12{grid-column:span 12}.col4{grid-column:span 4}.col3{grid-column:span 3}.col2{grid-column:span 2}.checks{display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin:12px 0}.checks label{font-size:14px;color:#334155}.btns{display:flex;gap:12px;align-items:end}.btn{border:0;border-radius:12px;padding:13px 22px;font-size:16px;font-weight:700;cursor:pointer;background:#0f172a;color:#fff;min-width:120px;position:relative;z-index:20}.btn.gray{background:#94a3b8}.btn:hover{filter:brightness(1.05)}.hint{font-size:12px;color:#64748b;margin-top:8px}.bar{height:12px;background:#e5e7eb;border-radius:999px;margin-top:14px;overflow:hidden}.bar div{height:100%;background:#0f172a;width:${message ? '100' : '0'}%}.results-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.download{display:inline-block;background:#64748b;color:#fff;text-decoration:none;border-radius:12px;padding:12px 18px;font-weight:700}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:14px}table{width:100%;border-collapse:collapse;min-width:1050px}th,td{padding:11px 10px;border-bottom:1px solid var(--line);font-size:14px;vertical-align:top}th{background:#f8fafc;text-align:left}.score{display:inline-block;background:#eef2ff;color:#4338ca;border-radius:999px;padding:4px 8px}.small{font-size:12px;color:#64748b}.url{color:#2563eb;text-decoration:none}.pill{display:inline-block;background:#f1f5f9;border-radius:999px;padding:3px 7px;margin:2px;font-size:12px}.message{font-weight:700;color:#0f172a;margin:10px 0}@media(max-width:900px){.col4,.col3,.col2{grid-column:span 12}.btns{align-items:stretch}.btn{width:100%}}
</style></head><body><main class="wrap">
<section class="card"><h1 class="title">全球骑行配件 B2B 线索采集工具 <span class="badge">${VERSION}</span></h1><p class="sub">面向全球寻找自行车店、骑行店、配件经销商、批发商、分销商、进口商官网，并从公开页面提取邮箱和电话。</p><div class="note"><b>说明：</b> 免费版不调用 Google Maps/Places，所以没有稳定的地图商家电话、地址和前 100 商家保证。系统会过滤 Microsoft/搜索引擎帮助页、品牌官网、新闻测评和无关平台。若搜索不准，建议直接粘贴官网列表。</div>
<form method="post" action="/search" id="leadForm"><div class="grid">
<div class="field col12"><label>可选：直接粘贴官网列表，一行一个。填写这里会优先分析这些网站，不依赖公开搜索。</label><textarea name="manualUrls" placeholder="例如：\nhttps://example-bike-shop.de\nhttps://example-distributor.com">${esc(params.manualUrls || '')}</textarea></div>
<div class="field col3"><label>目标客户类型</label><select name="targetType">${selectOptions(params.targetType || 'dealer')}</select></div>
<div class="field col3"><label>国家/市场，可多个</label><input name="markets" value="${esc(params.markets || 'Germany')}" placeholder="Germany, France, USA"></div>
<div class="field col3"><label>城市/地区，可多个</label><input name="cities" value="${esc(params.cities || 'Berlin')}" placeholder="Berlin, Paris, Los Angeles"></div>
<div class="field col3"><label>目标数量</label><input name="limit" type="number" min="1" max="50" value="${esc(params.limit || '10')}"></div>
<div class="field col4"><label>主搜索关键词</label><input name="keyword" value="${esc(params.keyword || 'bike dealer')}" placeholder="bike dealer / bicycle parts distributor"></div>
<div class="field col4"><label>产品方向标签</label><input name="productTags" value="${esc(params.productTags || 'bike parts, cycling accessories, power meter, crankset')}" placeholder="bike parts, power meter, crankset"></div>
<div class="field col4"><label>必须包含关键词</label><input name="must" value="${esc(params.must || 'bike,bicycle,cycling,dealer,shop,distributor,parts')}" placeholder="bike,bicycle,cycling,dealer"></div>
<div class="field col3"><label>排除关键词/域名</label><input name="exclude" value="${esc(params.exclude || 'microsoft,bing,cyclingnews,news,review')}" placeholder="microsoft,bing,news"></div>
<div class="field col2"><label>最低总分</label><input name="minScore" type="number" value="${esc(params.minScore || '45')}"></div>
<div class="field col2"><label>最低匹配度</label><input name="minMatch" type="number" value="${esc(params.minMatch || '35')}"></div>
<div class="field col2"><label>排序</label><select name="sort"><option value="score"${(params.sort||'score')==='score'?' selected':''}>按分数排序</option><option value="none"${params.sort==='none'?' selected':''}>原始顺序</option></select></div>
<div class="field col3 btns"><button class="btn" id="submitBtn" type="submit">开始提取</button><a class="btn gray" style="text-align:center;text-decoration:none" href="/">重置</a></div>
</div><div class="checks"><label><input type="checkbox" name="requireEmail" ${params.requireEmail === 'on' ? 'checked' : ''}> 只看有邮箱</label><label><input type="checkbox" name="requirePhone" ${params.requirePhone === 'on' ? 'checked' : ''}> 只看有电话</label><label><input type="checkbox" checked disabled> 隐藏新闻/测评/论坛/平台页</label></div><div class="message">${esc(message || '准备就绪')}</div><div class="bar"><div></div></div><div class="hint">本版是服务端提交模式，不依赖前端按钮脚本。按钮无反应时，也可以在任意输入框按 Enter 触发提交。</div></form></section>
<section class="card"><div class="results-head"><h2>结果 ${results.length} 条</h2>${id ? `<a class="download" href="/download?id=${id}">下载 CSV</a>` : '<span class="download" style="background:#94a3b8">下载 CSV</span>'}</div><div class="table-wrap"><table><thead><tr><th>分数</th><th>匹配度</th><th>类型</th><th>公司/网站</th><th>电话</th><th>优先邮箱</th><th>全部邮箱</th><th>Contact 页面</th><th>备注</th></tr></thead><tbody>${renderRows(results)}</tbody></table></div></section>
</main><script>document.getElementById('leadForm').addEventListener('submit',function(){var b=document.getElementById('submitBtn'); b.textContent='正在提取...'; b.disabled=true;});</script></body></html>`;
}

function selectOptions(value) {
  const opts = [['all','全部类型'],['shop','自行车店 / 门店'],['dealer','经销商 Dealer'],['distributor','分销商 Distributor'],['wholesaler','批发商 Wholesaler'],['importer','进口商 Importer'],['repair','维修店 / Workshop']];
  return opts.map(([v,t]) => `<option value="${v}"${value===v?' selected':''}>${t}</option>`).join('');
}

function renderRows(results) {
  if (!results.length) return '<tr><td colspan="9" class="small">暂无结果。可以降低最低分/匹配度，或直接粘贴官网列表。</td></tr>';
  return results.map(r => `<tr><td><span class="score">${esc(r.score)}</span></td><td>${esc(r.match)}</td><td>${esc(labelType(r.type))}<br>${(r.tags||[]).map(t=>`<span class="pill">${esc(t)}</span>`).join('')}</td><td><b>${esc(r.title || domainFromUrl(r.url))}</b><br><a class="url" href="${esc(r.url)}" target="_blank">${esc(r.url)}</a></td><td>${esc((r.phones||[]).join('; '))}</td><td><b>${esc(r.priorityEmail||'')}</b></td><td>${esc((r.emails||[]).join('; '))}</td><td>${r.contactUrl ? `<a class="url" href="${esc(r.contactUrl)}" target="_blank">打开</a>` : ''}</td><td class="small">${esc(r.notes||'')}</td></tr>`).join('');
}

function labelType(t) {
  return ({shop:'门店', dealer:'经销商', distributor:'分销商', wholesaler:'批发商', importer:'进口商', repair:'维修/服务', other:'其他'})[t] || t || '其他';
}

function saveResults(results) {
  const id = crypto.randomBytes(8).toString('hex');
  STORE.set(id, { results, ts: Date.now() });
  for (const [k, v] of STORE.entries()) if (Date.now() - v.ts > 60 * 60 * 1000) STORE.delete(k);
  return id;
}

function toCSV(results) {
  const header = ['score','match','type','title','url','phones','priorityEmail','emails','contactUrl','tags','notes'];
  const rows = results.map(r => [r.score,r.match,r.type,r.title,r.url,(r.phones||[]).join('; '),r.priorityEmail,(r.emails||[]).join('; '),r.contactUrl,(r.tags||[]).join('; '),r.notes]);
  return [header, ...rows].map(row => row.map(cell => '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"').join(',')).join('\n');
}

function parseBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 2_000_000) req.destroy(); });
    req.on('end', () => {
      const p = new URLSearchParams(data);
      const obj = {};
      for (const [k, v] of p.entries()) obj[k] = v;
      resolve(obj);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderPage());
      return;
    }
    if (req.method === 'GET' && u.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, version: VERSION }));
      return;
    }
    if (req.method === 'GET' && u.pathname === '/download') {
      const id = u.searchParams.get('id');
      const item = STORE.get(id || '');
      if (!item) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="global-cycling-b2b-leads.csv"' });
      res.end('\ufeff' + toCSV(item.results));
      return;
    }
    if (req.method === 'POST' && u.pathname === '/search') {
      const params = await parseBody(req);
      const results = await runSearch(params);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderPage(params, results, `完成：找到 ${results.length} 条线索`));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderPage({}, [], '出错：' + (e && e.message ? e.message : String(e))));
  }
});

server.listen(PORT, () => {
  console.log(`B2B Lead Scraper ${VERSION} running on port ${PORT}`);
});
