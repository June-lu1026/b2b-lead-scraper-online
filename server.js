const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const VERSION = 'v5.2 修复版';

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?\d{1,3}[\s.()\-]*)?(?:\(?\d{2,5}\)?[\s.()\-]*)?\d{3,5}[\s.()\-]*\d{3,5}/g;

const JUNK_DOMAINS = [
  'microsoft.com','bing.com','google.com','youtube.com','facebook.com','instagram.com','linkedin.com','x.com','twitter.com',
  'amazon.','ebay.','wikipedia.org','reddit.com','pinterest.','yelp.','tripadvisor.','mapcarta.','komoot.',
  'cyclingnews.com','bikeradar.com','road.cc','pinkbike.com','singletracks.com','mtbr.com','magazinesdirect.com'
];
const BRAND_DOMAINS = [
  'trekbikes.com','specialized.com','giant-bicycles.com','canyon.com','cube.eu','scott-sports.com','merida-bikes.com',
  'cannondale.com','sram.com','shimano.com','garmin.com','wahoofitness.com','favero.com','4iiii.com'
];
const TARGET_WORDS = [
  'bike shop','bicycle shop','cycling store','bike store','bicycle store','bike dealer','bicycle dealer','dealer','retailer',
  'distributor','distribution','wholesale','wholesaler','importer','parts','accessories','components','workshop','service',
  'fahrradladen','radladen','fahrradgeschäft','fahrrad shop','fahrrad händler','fahrradhaendler','fahrradhandel','händler','haendler',
  'vertrieb','großhandel','grosshandel','zubehör','zubehor','radsport'
];
const DEALER_WORDS = ['dealer','retailer','shop','store','händler','haendler','fahrradladen','fahrradgeschäft','radladen','workshop'];
const DISTRIBUTOR_WORDS = ['distributor','distribution','wholesale','wholesaler','importer','vertrieb','grosshandel','großhandel'];
const JUNK_WORDS = ['news','magazine','review','forum','blog','wiki','support','help center','privacy policy','digital services act','coupon','jobs'];

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(body);
}
function text(res, status, body, contentType='text/html; charset=utf-8') {
  res.writeHead(status, {'content-type':contentType,'cache-control':'no-store'});
  res.end(body);
}
async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 2_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
async function fetchText(url, timeoutMs=9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language':'en-US,en;q=0.9,de;q=0.8,zh-CN;q=0.6'
      }
    });
    const ctype = resp.headers.get('content-type') || '';
    const body = await resp.text();
    return {ok: resp.ok, status: resp.status, url: resp.url || url, body, contentType: ctype};
  } finally {
    clearTimeout(timer);
  }
}
function normalizeUrl(raw) {
  if (!raw) return '';
  let u = String(raw).trim();
  if (!u) return '';
  u = u.replace(/&amp;/g, '&');
  try { u = decodeURIComponent(u); } catch {}
  const match = u.match(/[?&](?:u|url|q|r)=((?:https?:\/\/)[^&]+)/i);
  if (match) {
    try { u = decodeURIComponent(match[1]); } catch { u = match[1]; }
  }
  if (u.startsWith('//')) u = 'https:' + u;
  if (!/^https?:\/\//i.test(u)) return '';
  try {
    const x = new URL(u);
    x.hash = '';
    if (x.pathname === '/url') return '';
    return x.toString();
  } catch { return ''; }
}
function domainOf(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./,''); } catch { return ''; }
}
function isJunkUrl(u) {
  const d = domainOf(u);
  const lower = String(u).toLowerCase();
  if (!d) return true;
  if (JUNK_DOMAINS.some(j => d.includes(j) || lower.includes(j))) return true;
  if (/\.(pdf|jpg|jpeg|png|gif|webp|zip|rar|docx?|xlsx?|pptx?)($|[?#])/i.test(u)) return true;
  return false;
}
function isBrandDomain(u) {
  const d = domainOf(u);
  return BRAND_DOMAINS.some(b => d.includes(b));
}
function uniqueByDomain(urls) {
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    const norm = normalizeUrl(u);
    const d = domainOf(norm);
    if (!norm || !d || seen.has(d) || isJunkUrl(norm)) continue;
    seen.add(d);
    out.push(norm);
  }
  return out;
}
function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractTitle(html, fallback) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const t = m ? stripHtml(m[1]).slice(0, 140) : '';
  return t || domainOf(fallback) || fallback;
}
function extractLinks(baseUrl, html) {
  const out = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const href = m[1] || '';
    const text = stripHtml(m[2] || '').toLowerCase();
    const hLower = href.toLowerCase();
    const useful = ['contact','about','dealer','distributor','wholesale','impressum','store','shop','partner','retail','sales','vertrieb','kontakt','haendler','händler','fachhaendler','fachhändler'];
    if (!useful.some(w => hLower.includes(w) || text.includes(w))) continue;
    try {
      const abs = new URL(href, baseUrl).toString();
      if (!isJunkUrl(abs)) out.push(abs);
    } catch {}
  }
  return Array.from(new Set(out)).slice(0, 6);
}
function cleanEmails(html) {
  const decoded = String(html || '')
    .replace(/\s*\[at\]\s*/gi, '@')
    .replace(/\s*\(at\)\s*/gi, '@')
    .replace(/\s+at\s+/gi, '@')
    .replace(/\s*\[dot\]\s*/gi, '.')
    .replace(/\s*\(dot\)\s*/gi, '.')
    .replace(/\s+dot\s+/gi, '.');
  const found = decoded.match(EMAIL_RE) || [];
  return Array.from(new Set(found.map(e => e.toLowerCase()).filter(e => !/\.(png|jpg|jpeg|webp|gif|svg)$/.test(e))));
}
function pickEmail(emails) {
  const weights = [
    ['sales@',100,'high-value-business'], ['wholesale@',100,'high-value-business'], ['dealer@',95,'high-value-business'], ['distribution@',95,'high-value-business'],
    ['distributor@',95,'high-value-business'], ['export@',90,'high-value-business'], ['order@',85,'business'], ['info@',80,'general-business'],
    ['contact@',75,'general-business'], ['hello@',70,'general-business'], ['shop@',70,'shop'], ['service@',55,'service'], ['support@',35,'support'],
    ['privacy@',10,'low-value'], ['noreply@',5,'low-value'], ['no-reply@',5,'low-value']
  ];
  let best = {email:'', type:'none', w:0};
  for (const e of emails) {
    let w = 45, type = 'other';
    for (const [pat, score, t] of weights) {
      if (e.includes(pat)) { w = score; type = t; break; }
    }
    if (w > best.w) best = {email:e, type, w};
  }
  return best;
}
function scoreCandidate(url, title, textContent, emails, phones) {
  const hay = (url + ' ' + title + ' ' + textContent).toLowerCase();
  let matchScore = 0;
  for (const w of TARGET_WORDS) if (hay.includes(w)) matchScore += 10;
  for (const w of DEALER_WORDS) if (hay.includes(w)) matchScore += 8;
  for (const w of DISTRIBUTOR_WORDS) if (hay.includes(w)) matchScore += 12;
  matchScore = Math.min(100, matchScore);

  let score = matchScore;
  if (emails.length) score += 25;
  if (phones.length) score += 10;
  if (pickEmail(emails).w >= 80) score += 15;
  if (isBrandDomain(url)) score -= 35;
  if (JUNK_WORDS.some(w => hay.includes(w))) score -= 25;
  if (/\.de\//i.test(url) || domainOf(url).endsWith('.de') || hay.includes('berlin') || hay.includes('germany') || hay.includes('deutschland')) score += 12;
  score = Math.max(0, Math.min(100, score));

  let type = 'other';
  if (DISTRIBUTOR_WORDS.some(w => hay.includes(w))) type = 'distributor';
  else if (DEALER_WORDS.some(w => hay.includes(w))) type = 'dealer-shop';
  else if (hay.includes('parts') || hay.includes('accessories') || hay.includes('zubehör')) type = 'parts-accessories';
  return {score, matchScore, type};
}
async function searchWeb(keyword, location, limit) {
  const queries = [
    keyword + ' ' + location + ' website contact',
    keyword + ' ' + location + ' shop dealer contact',
    'Fahrradladen ' + location + ' kontakt',
    'Fahrrad Händler ' + location + ' kontakt',
    'bicycle parts distributor ' + location,
    'cycling accessories distributor ' + location
  ];
  const urls = [];
  for (const q of queries) {
    if (urls.length >= Math.max(12, limit * 4)) break;
    const engines = [
      'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q),
      'https://www.bing.com/search?q=' + encodeURIComponent(q)
    ];
    for (const engine of engines) {
      try {
        const r = await fetchText(engine, 8000);
        const html = r.body || '';
        let m;
        const hrefRe = /href=["']([^"']+)["']/gi;
        while ((m = hrefRe.exec(html))) {
          const u = normalizeUrl(m[1]);
          if (u) urls.push(u);
        }
      } catch (_) {}
      await delay(150);
      if (urls.length >= Math.max(12, limit * 4)) break;
    }
  }
  return uniqueByDomain(urls).slice(0, Math.max(8, limit * 3));
}
async function analyzeSite(url) {
  const started = Date.now();
  let notes = [];
  let pagesChecked = 0;
  try {
    const first = await fetchText(url, 9000);
    if (!first.ok && first.status !== 403) notes.push('Homepage HTTP ' + first.status);
    const homepage = first.body || '';
    pagesChecked++;
    const title = extractTitle(homepage, url);
    const pageUrls = [first.url || url].concat(extractLinks(first.url || url, homepage)).slice(0, 7);
    let combined = homepage;
    let contactUrl = '';
    for (let i = 1; i < pageUrls.length; i++) {
      try {
        const rr = await fetchText(pageUrls[i], 7000);
        if (rr.ok) {
          pagesChecked++;
          combined += '\n' + rr.body;
          if (!contactUrl && /contact|kontakt|impressum|dealer|wholesale|vertrieb/i.test(pageUrls[i])) contactUrl = pageUrls[i];
        }
      } catch (_) {}
    }
    const emails = cleanEmails(combined);
    const phones = Array.from(new Set((stripHtml(combined).match(PHONE_RE) || []).map(p => p.replace(/\s+/g,' ').trim()).filter(p => p.replace(/\D/g,'').length >= 7))).slice(0, 3);
    if (!emails.length) notes.push('No public email found on checked pages');
    if (!phones.length) notes.push('No phone found on website');
    notes.push('Checked ' + pagesChecked + ' pages');
    const textContent = stripHtml(combined).slice(0, 20000);
    const scoring = scoreCandidate(first.url || url, title, textContent, emails, phones);
    const best = pickEmail(emails);
    return {
      url: first.url || url,
      domain: domainOf(first.url || url),
      title,
      phone: phones[0] || '',
      emails,
      priorityEmail: best.email,
      emailType: best.type,
      contactUrl,
      notes: notes.join('; '),
      elapsedMs: Date.now() - started,
      score: scoring.score,
      matchScore: scoring.matchScore,
      leadType: scoring.type,
      isBrand: isBrandDomain(first.url || url),
      isJunk: JUNK_WORDS.some(w => (title + ' ' + url).toLowerCase().includes(w)) || isJunkUrl(first.url || url)
    };
  } catch (e) {
    return {
      url, domain: domainOf(url), title: domainOf(url) || url, phone:'', emails:[], priorityEmail:'', emailType:'none', contactUrl:'',
      notes: 'Failed: ' + (e && e.name === 'AbortError' ? 'timeout' : (e.message || e)), elapsedMs: Date.now() - started,
      score:0, matchScore:0, leadType:'other', isBrand:false, isJunk:false
    };
  }
}
function applyFilters(results, filters) {
  filters = filters || {};
  const minScore = Number(filters.minScore ?? 50);
  const minMatch = Number(filters.minMatch ?? 45);
  const leadType = filters.leadType || 'dealer-distributor';
  const exclude = String(filters.exclude || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  return results.filter(r => {
    const hay = (r.title + ' ' + r.url + ' ' + r.notes).toLowerCase();
    if (Number(r.score || 0) < minScore) return false;
    if (Number(r.matchScore || 0) < minMatch) return false;
    if (filters.onlyEmail && !r.priorityEmail) return false;
    if (filters.onlyPhone && !r.phone) return false;
    if (filters.hideJunk && (r.isJunk || JUNK_WORDS.some(w => hay.includes(w)))) return false;
    if (filters.regionRelevant) {
      const d = domainOf(r.url);
      const loc = String(filters.location || '').toLowerCase();
      const regionOk = d.endsWith('.de') || hay.includes('berlin') || hay.includes('germany') || hay.includes('deutschland') || loc.split(/\s+/).some(tok => tok.length > 3 && hay.includes(tok));
      if (!regionOk) return false;
    }
    if (exclude.some(x => hay.includes(x))) return false;
    if (leadType === 'dealer' && r.leadType !== 'dealer-shop') return false;
    if (leadType === 'distributor' && r.leadType !== 'distributor') return false;
    if (leadType === 'wholesale' && !/wholesale|wholesaler|grosshandel|großhandel|distribution|distributor/i.test(hay)) return false;
    if (leadType === 'parts' && !/parts|accessories|components|zubehor|zubehör/i.test(hay)) return false;
    if (leadType === 'dealer-distributor' && !['dealer-shop','distributor','parts-accessories'].includes(r.leadType)) return false;
    return true;
  }).sort((a,b) => (b.score - a.score) || (b.matchScore - a.matchScore));
}

const INDEX_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>骑行配件 B2B 线索采集工具 v5.2</title><style>
:root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,"Microsoft YaHei",sans-serif;color:#0f172a;background:#f6f7fb}*{box-sizing:border-box}body{margin:0;padding:32px}.wrap{max-width:1240px;margin:auto}.card{background:#fff;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 14px 35px rgba(15,23,42,.07);padding:24px;margin-bottom:18px}h1{margin:0 0 8px;font-size:30px}.sub{color:#64748b;font-size:15px;margin-bottom:16px}.warn{border:1px solid #fed7aa;background:#fff7ed;color:#9a3412;padding:14px;border-radius:12px;line-height:1.6;margin:12px 0 18px}.grid{display:grid;grid-template-columns:1fr 1fr 160px 140px;gap:12px;align-items:end}.grid2{display:grid;grid-template-columns:1.2fr 170px 140px 140px 190px 200px;gap:10px;align-items:end}.field label{display:block;font-size:13px;color:#475569;margin:0 0 6px}input,select,textarea{width:100%;padding:11px 12px;border:1px solid #d7dde7;border-radius:11px;font-size:15px;background:#fff}textarea{min-height:86px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.btn{border:0;border-radius:12px;background:#111827;color:#fff;padding:13px 20px;font-weight:700;font-size:16px;cursor:pointer}.btn:disabled{background:#9ca3af;cursor:not-allowed}.btn.secondary{background:#64748b}.btn.danger{background:#b91c1c}.bar{height:10px;background:#e5e7eb;border-radius:999px;overflow:hidden;margin-top:14px}.fill{height:100%;width:0;background:#111827;transition:width .2s}.status{margin-top:12px;color:#334155}.filters{border:1px solid #e5e7eb;border-radius:14px;background:#fbfdff;padding:14px;margin-bottom:14px}.checks{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;color:#475569;font-size:13px}.checks label{display:flex;gap:6px;align-items:center}table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;font-size:14px}th,td{text-align:left;padding:12px;border-bottom:1px solid #eef2f7;vertical-align:top}th{background:#f8fafc;font-weight:800}tr:last-child td{border-bottom:0}.pill{display:inline-block;padding:3px 9px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:12px}.small{font-size:12px;color:#64748b}.link{color:#2563eb;text-decoration:none;word-break:break-all}.toprow{display:flex;justify-content:space-between;gap:12px;align-items:center}.csv{background:#334155}.version{display:inline-block;font-size:13px;color:#065f46;background:#d1fae5;border-radius:999px;padding:4px 10px;margin-left:8px}@media(max-width:900px){.grid,.grid2{grid-template-columns:1fr}.toprow{display:block}.btn{width:100%}}
</style></head><body><div class="wrap"><section class="card"><h1>骑行配件 B2B 线索采集工具 <span class="version">v5.2 已验证版</span></h1><div class="sub">寻找自行车店、骑行店、配件经销商、批发商和分销商官网，并从公开页面提取邮箱和电话。</div><div class="warn"><b>说明：</b>免费版不调用 Google Maps/Places，所以没有稳定的地图商家电话、地址和前 100 商家保证。系统会过滤 Microsoft/搜索引擎帮助页、品牌官网、新闻测评和无关平台。若搜索不准，建议直接粘贴官网吗列表。</div><div class="field"><label>可选：直接粘贴官网列表，一行一个。填写这里会优先分析这些网站，不依赖公开搜索。</label><textarea id="manualUrls" placeholder="例如：&#10;https://example-bike-shop.de&#10;https://example-distributor.com"></textarea></div><div class="grid" style="margin-top:14px"><div class="field"><label>行业关键词</label><input id="keyword" value="bike dealer"/></div><div class="field"><label>地区</label><input id="location" value="Berlin Germany"/></div><div class="field"><label>目标数量</label><input id="limit" type="number" min="1" max="50" value="10"/></div><div><button class="btn" id="startBtn">开始提取</button><button class="btn danger" id="stopBtn" style="display:none;margin-top:8px">停止</button></div></div><div class="status" id="status">准备就绪</div><div class="bar"><div class="fill" id="fill"></div></div></section><section class="card"><div class="toprow"><h2 style="margin:0 0 14px">结果 <span id="count">0</span> 条</h2><button class="btn csv" id="downloadBtn" disabled>下载筛选后 CSV</button></div><div class="filters"><b>筛选结果</b><div class="grid2" style="margin-top:12px"><div class="field"><label>搜索结果内关键词</label><input id="within" placeholder="例如 berlin / distributor"/></div><div class="field"><label>线索类型</label><select id="leadType"><option value="dealer-distributor">店/经销商/分销商</option><option value="dealer">只看门店/Dealer</option><option value="distributor">只看 Distributor</option><option value="wholesale">只看 Wholesale</option><option value="parts">配件相关</option><option value="all">全部</option></select></div><div class="field"><label>最低总分</label><input id="minScore" type="number" value="50"/></div><div class="field"><label>最低匹配度</label><input id="minMatch" type="number" value="45"/></div><div class="field"><label>匹配等级</label><select id="matchLevel"><option value="strict">强匹配 + 可能匹配</option><option value="all">全部</option></select></div><div class="field"><label>排除关键词</label><input id="exclude" value="microsoft,bing,cyclingnews,magazine,review,forum,blog"/></div></div><div class="checks"><label><input id="onlyEmail" type="checkbox" checked/>只看有邮箱</label><label><input id="onlyPhone" type="checkbox"/>只看有电话</label><label><input id="regionRelevant" type="checkbox" checked/>地区相关 / 德国站优先</label><label><input id="hideJunk" type="checkbox" checked/>隐藏新闻/测评/论坛/平台页</label><label><input id="sortByScore" type="checkbox" checked/>按分数排序</label></div><div class="small" style="margin-top:8px">提示：德国本地客户建议搜 Fahrradladen、Fahrrad Händler、bike dealer、bicycle parts distributor，并保持地区相关开启。</div></div><div style="overflow:auto;max-height:520px"><table><thead><tr><th>分数</th><th>匹配度</th><th>类型</th><th>公司/网站</th><th>电话</th><th>优先邮箱</th><th>全部邮箱</th><th>Contact 页面</th><th>备注</th></tr></thead><tbody id="rows"></tbody></table></div></section></div><script>
var allResults = []; var controller = null;
function el(id){return document.getElementById(id)}
function esc(s){return String(s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function filters(){return {leadType:el('leadType').value,minScore:Number(el('minScore').value||0),minMatch:Number(el('minMatch').value||0),exclude:el('exclude').value,onlyEmail:el('onlyEmail').checked,onlyPhone:el('onlyPhone').checked,regionRelevant:el('regionRelevant').checked,hideJunk:el('hideJunk').checked,location:el('location').value}}
function applyLocalFilters(){var f=filters();var within=el('within').value.trim().toLowerCase();var rows=allResults.filter(function(r){var hay=(r.title+' '+r.url+' '+r.notes+' '+(r.emails||[]).join(' ')).toLowerCase();if(within && hay.indexOf(within)<0)return false;if(Number(r.score)<f.minScore)return false;if(Number(r.matchScore)<f.minMatch)return false;if(f.onlyEmail&&!r.priorityEmail)return false;if(f.onlyPhone&&!r.phone)return false;if(f.exclude){var bad=f.exclude.toLowerCase().split(',').map(function(x){return x.trim()}).filter(Boolean);for(var i=0;i<bad.length;i++){if(hay.indexOf(bad[i])>=0)return false}}if(f.leadType==='dealer'&&r.leadType!=='dealer-shop')return false;if(f.leadType==='distributor'&&r.leadType!=='distributor')return false;if(f.leadType==='wholesale'&&!/wholesale|wholesaler|grosshandel|großhandel|distribution|distributor/i.test(hay))return false;if(f.leadType==='parts'&&!/parts|accessories|components|zubehor|zubehör/i.test(hay))return false;if(f.leadType==='dealer-distributor'&&['dealer-shop','distributor','parts-accessories'].indexOf(r.leadType)<0)return false;return true});if(el('sortByScore').checked)rows.sort(function(a,b){return (b.score-a.score)||(b.matchScore-a.matchScore)});render(rows)}
function render(rows){el('count').textContent=rows.length;el('downloadBtn').disabled=rows.length===0;var html='';rows.forEach(function(r){html+='<tr><td><span class="pill">'+esc(r.score)+'</span></td><td>'+esc(r.matchScore)+'</td><td>'+esc(r.leadType)+'</td><td><b>'+esc(r.title)+'</b><br><a class="link" href="'+esc(r.url)+'" target="_blank">'+esc(r.url)+'</a></td><td>'+esc(r.phone)+'</td><td><b>'+esc(r.priorityEmail||'')+'</b><br><span class="small">'+esc(r.emailType||'')+'</span></td><td>'+esc((r.emails||[]).join('; '))+'</td><td>'+(r.contactUrl?'<a class="link" href="'+esc(r.contactUrl)+'" target="_blank">打开</a>':'')+'</td><td class="small">'+esc(r.notes||'')+'</td></tr>'});el('rows').innerHTML=html||'<tr><td colspan="9" class="small">暂无结果。可以降低最低总分/匹配度，或直接粘贴官网列表。</td></tr>'}
async function start(){controller=new AbortController();el('startBtn').disabled=true;el('stopBtn').style.display='inline-block';el('fill').style.width='8%';el('status').textContent='正在搜索和分析，最多约 60 秒...';allResults=[];render([]);try{var payload={keyword:el('keyword').value,location:el('location').value,limit:Number(el('limit').value||10),manualUrls:el('manualUrls').value,filters:filters()};var resp=await fetch('/api/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});el('fill').style.width='80%';var data=await resp.json();if(!resp.ok)throw new Error(data.error||'请求失败');allResults=data.results||[];el('status').textContent='完成：找到 '+allResults.length+' 条候选线索；来源 '+(data.candidates||0)+' 个网站。';el('fill').style.width='100%';applyLocalFilters()}catch(e){el('status').textContent=(e.name==='AbortError')?'已停止':'失败：'+e.message;el('fill').style.width='0%'}finally{el('startBtn').disabled=false;el('stopBtn').style.display='none';controller=null}}
function stop(){if(controller)controller.abort()}
function download(){var rows=[];var old=el('rows').querySelectorAll('tr');var filtered=allResults;var csvRows=[['score','match_score','lead_type','title','url','phone','priority_email','all_emails','contact_url','notes']];filtered.forEach(function(r){csvRows.push([r.score,r.matchScore,r.leadType,r.title,r.url,r.phone,r.priorityEmail,(r.emails||[]).join('; '),r.contactUrl,r.notes])});var csv=csvRows.map(function(row){return row.map(function(v){return '"'+String(v||'').replace(/"/g,'""')+'"'}).join(',')}).join('\n');var blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cycling_b2b_leads.csv';a.click();URL.revokeObjectURL(a.href)}
el('startBtn').addEventListener('click',start);el('stopBtn').addEventListener('click',stop);el('downloadBtn').addEventListener('click',download);['within','leadType','minScore','minMatch','exclude','onlyEmail','onlyPhone','regionRelevant','hideJunk','sortByScore'].forEach(function(id){el(id).addEventListener('input',applyLocalFilters);el(id).addEventListener('change',applyLocalFilters)});render([]);
</script></body></html>`;

async function handleSearch(req, res) {
  try {
    const body = await readBody(req);
    const payload = body ? JSON.parse(body) : {};
    const keyword = String(payload.keyword || 'bike dealer').trim();
    const location = String(payload.location || '').trim();
    const limit = Math.min(50, Math.max(1, Number(payload.limit || 10)));
    let manual = String(payload.manualUrls || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let candidates = uniqueByDomain(manual);
    if (!candidates.length) {
      candidates = await searchWeb(keyword, location, limit);
    }
    const maxCandidates = Math.min(candidates.length, Math.max(8, limit * 2));
    const analyzed = [];
    const started = Date.now();
    for (let i = 0; i < maxCandidates; i++) {
      if (Date.now() - started > 65000) break;
      const result = await analyzeSite(candidates[i]);
      analyzed.push(result);
      if (analyzed.filter(r => r.score >= 50 && r.priorityEmail).length >= limit) break;
    }
    let filters = payload.filters || {};
    filters.location = location;
    let results = applyFilters(analyzed, filters);
    if (!results.length) {
      results = analyzed.sort((a,b) => (b.score - a.score) || (b.matchScore - a.matchScore)).slice(0, limit);
    } else {
      results = results.slice(0, limit);
    }
    json(res, 200, {version: VERSION, candidates: candidates.length, analyzed: analyzed.length, results});
  } catch (e) {
    json(res, 500, {error: e.message || String(e)});
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') return text(res, 200, INDEX_HTML);
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, {ok:true, version: VERSION});
  if (req.method === 'POST' && url.pathname === '/api/search') return handleSearch(req, res);
  return text(res, 404, 'Not found', 'text/plain; charset=utf-8');
});

server.listen(PORT, () => {
  console.log('B2B Lead Scraper ' + VERSION + ' is running.');
  console.log('Open: http://localhost:' + PORT);
  console.log('Render/Railway port: ' + PORT);
});
