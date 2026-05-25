'use strict';

const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const VERSION = 'v5 防卡顿筛选版';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const HARD_EXCLUDE_DOMAINS = [
  'bing.com','microsoft.com','google.com','youtube.com','youtu.be','facebook.com','instagram.com','linkedin.com','x.com','twitter.com',
  'wikipedia.org','amazon.','ebay.','reddit.com','quora.com','pinterest.','aliexpress.','alibaba.','temu.',
  'cyclingnews.com','bikeradar.com','road.cc','pinkbike.com','singletracks.com','bikepacking.com','outsideonline.com',
  'trekbikes.com','specialized.com','giant-bicycles.com','canyon.com','shimano.com','sram.com','garmin.com','cannondale.com',
  'scott-sports.com','cube.eu','merida-bikes.com','pinarello.com','cervelo.com','bianchi.com','orbea.com','focus-bikes.com'
];

const CYCLING_POSITIVE = [
  'bike shop','bicycle shop','cycle shop','cycling store','bike store','bicycle store','bike dealer','bicycle dealer','cycling dealer',
  'bike distributor','bicycle distributor','cycling distributor','bike wholesale','bicycle wholesale','cycling wholesale','bike parts','bicycle parts','cycling accessories',
  'fahrradladen','fahrradgeschäft','fahrrad handler','fahrrad händler','radladen','radsport','fahrrad zubehör','fahrradzubehör','fahrradteile',
  'dealer','distributor','wholesale','wholesaler','retailer','shop','store','parts','accessories','zubehör','händler'
];

const NEGATIVE_WORDS = [
  'news','magazine','review','blog','forum','wiki','support','help center','privacy policy only','press release','coupon','deal aggregator',
  'marketplace','classifieds','youtube','podcast','software','digital services act'
];

function htmlPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>骑行配件 B2B 线索采集工具 - v5</title>
<style>
  :root{--bg:#f6f7fb;--card:#fff;--text:#0f172a;--muted:#64748b;--line:#e2e8f0;--dark:#111827;--blue:#2563eb;--orange:#c2410c;--green:#047857;--red:#b91c1c;}
  *{box-sizing:border-box} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans SC",sans-serif;background:var(--bg);color:var(--text)}
  .wrap{max-width:1360px;margin:28px auto;padding:0 18px}.card{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:0 12px 36px rgba(15,23,42,.06);padding:22px;margin-bottom:18px}
  h1{font-size:28px;margin:0 0 8px}.sub{color:var(--muted);font-size:15px}.badge{display:inline-block;background:#eef2ff;color:#3730a3;border-radius:999px;padding:2px 8px;font-size:12px;margin-left:8px}
  .warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:12px;padding:12px 14px;margin:16px 0;line-height:1.5}.grid{display:grid;grid-template-columns:1.2fr 1fr 170px 120px;gap:14px;align-items:end}
  label{font-size:13px;color:#334155;display:block;margin-bottom:6px} input,textarea,select{width:100%;border:1px solid #cbd5e1;border-radius:12px;padding:12px 13px;font-size:15px;background:#fff} textarea{min-height:78px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
  button{border:0;border-radius:12px;background:var(--dark);color:#fff;padding:13px 18px;font-size:16px;cursor:pointer}button:disabled{background:#9ca3af;cursor:not-allowed}.btn2{background:#475569}.btnDanger{background:#991b1b}.btnLight{background:#e2e8f0;color:#0f172a}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.status{margin-top:12px;color:#334155}.bar{height:10px;background:#e5e7eb;border-radius:999px;overflow:hidden;margin-top:8px}.bar>div{height:100%;width:0;background:#111827;transition:width .2s}
  .filters{display:grid;grid-template-columns:1.1fr 180px 120px 120px 180px 1fr;gap:10px;align-items:end}.checks{margin-top:10px;display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:#475569}.checks label{display:flex;align-items:center;gap:5px;margin:0}.checks input{width:auto}
  table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid var(--line);border-radius:14px;overflow:hidden;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:10px;vertical-align:top;text-align:left}th{background:#f8fafc;font-weight:700}tr:last-child td{border-bottom:0}.score{display:inline-block;border-radius:999px;background:#eef2ff;color:#3730a3;padding:3px 8px}.match{font-size:12px;color:#0f766e}.small{font-size:12px;color:#64748b}.email{font-weight:700}.scroll{overflow:auto;max-height:560px}.right{margin-left:auto}.muted{color:#64748b}.ok{color:var(--green)}.bad{color:var(--red)}.pill{display:inline-block;padding:2px 7px;background:#f1f5f9;border-radius:999px;margin:1px;font-size:12px}.topline{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.version{font-weight:600;color:#475569}
  @media(max-width:900px){.grid,.filters{grid-template-columns:1fr}.right{margin-left:0}}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="topline"><h1>骑行配件 B2B 线索采集工具 - 筛选版</h1><span class="badge">${VERSION}</span></div>
    <div class="sub">专门寻找自行车店、骑行店、配件经销商、批发商和分销商官网，并从公开页面提取邮箱和电话。</div>
    <div class="warn">说明：免费版不调用 Google Maps/Places，所以没有稳定地图商家电话、地址和前 100 商家保证。v5 增加了超时、防卡顿和停止按钮；如果公开搜索不准，建议直接粘贴官网列表。</div>

    <label>可选：直接粘贴官网列表，一行一个。填了这里会优先分析这些网站，不依赖公开搜索。</label>
    <textarea id="manualUrls" placeholder="例如：\nhttps://example-bike-shop.de\nhttps://example-distributor.com"></textarea>

    <div class="grid" style="margin-top:14px">
      <div><label>行业关键词</label><input id="keyword" value="bike dealer" /></div>
      <div><label>地区</label><input id="location" value="Berlin Germany" /></div>
      <div><label>目标数量</label><input id="target" type="number" min="1" max="50" value="20" /></div>
      <div><button id="startBtn">开始提取</button></div>
    </div>
    <div class="row" style="margin-top:10px"><button id="stopBtn" class="btnDanger" disabled>停止</button><button id="clearBtn" class="btnLight">清空结果</button><span id="elapsed" class="small"></span></div>
    <div id="status" class="status">准备就绪</div>
    <div class="bar"><div id="bar"></div></div>
  </div>

  <div class="card">
    <div class="row"><h2 style="margin:0;font-size:20px">结果 <span id="resultCount" class="muted">0</span> 条</h2><button id="downloadBtn" class="btn2 right" disabled>下载筛选后 CSV</button></div>
    <div class="card" style="box-shadow:none;margin:14px 0 12px;padding:14px;background:#fbfdff">
      <b>筛选结果</b>
      <div class="filters" style="margin-top:10px">
        <div><label>搜索结果内关键词</label><input id="filterText" placeholder="例如 berlin / distributor" /></div>
        <div><label>线索类型</label><select id="typeFilter"><option value="all">全部</option><option value="shop">店/车店</option><option value="dealer">经销商</option><option value="distributor">分销商</option><option value="wholesale">批发/Wholesale</option></select></div>
        <div><label>最低总分</label><input id="minScore" type="number" value="50" /></div>
        <div><label>最低匹配度</label><input id="minMatch" type="number" value="45" /></div>
        <div><label>匹配等级</label><select id="matchLevel"><option value="possible">强匹配 + 可能匹配</option><option value="strong">只看强匹配</option><option value="all">全部</option></select></div>
        <div><label>排除关键词</label><input id="excludeWords" value="microsoft,bing,cyclingnews,bikeradar,magazine,news,blog,forum,review" /></div>
      </div>
      <div class="checks">
        <label><input id="onlyEmail" type="checkbox" checked />只看有邮箱</label>
        <label><input id="onlyPhone" type="checkbox" />只看有电话</label>
        <label><input id="preferRegion" type="checkbox" checked />地区相关 / 德国站优先</label>
        <label><input id="hideIrrelevant" type="checkbox" checked />隐藏新闻/测评/论坛/平台页</label>
        <label><input id="sortScore" type="checkbox" checked />按分数排序</label>
      </div>
    </div>
    <div class="scroll"><table><thead><tr><th>分数</th><th>匹配度</th><th>类型</th><th style="min-width:250px">公司/网站</th><th>电话</th><th style="min-width:190px">优先邮箱</th><th style="min-width:220px">全部邮箱</th><th>Contact 页面</th><th>备注</th></tr></thead><tbody id="tbody"></tbody></table></div>
  </div>
</div>
<script>
let allResults = [];
let aborter = null;
let startedAt = 0;
let timer = null;
const $ = id => document.getElementById(id);

function setStatus(text){ $('status').textContent = text; }
function setBar(p){ $('bar').style.width = Math.max(0, Math.min(100, p)) + '%'; }
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function domainFromUrl(u){ try{return new URL(u).hostname.replace(/^www\./,'')}catch{return ''} }
function startTimer(){ startedAt = Date.now(); clearInterval(timer); timer=setInterval(()=>{$('elapsed').textContent='已运行 '+Math.round((Date.now()-startedAt)/1000)+' 秒';},1000); }
function stopTimer(){ clearInterval(timer); $('elapsed').textContent=''; }

function getFilters(){ return {
  text: $('filterText').value.trim().toLowerCase(), type: $('typeFilter').value, minScore: Number($('minScore').value || 0), minMatch: Number($('minMatch').value || 0), matchLevel: $('matchLevel').value,
  excludeWords: $('excludeWords').value.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean), onlyEmail: $('onlyEmail').checked, onlyPhone: $('onlyPhone').checked, preferRegion: $('preferRegion').checked, hideIrrelevant: $('hideIrrelevant').checked, sortScore: $('sortScore').checked
};}
function passes(r){ const f=getFilters(); const hay=[r.title,r.url,r.type,r.notes,(r.emails||[]).join(' ')].join(' ').toLowerCase();
  if(f.text && !hay.includes(f.text)) return false;
  if(f.excludeWords.some(w=>hay.includes(w))) return false;
  if(f.type !== 'all' && r.type !== f.type) return false;
  if((r.score||0) < f.minScore) return false;
  if((r.match||0) < f.minMatch) return false;
  if(f.matchLevel === 'strong' && (r.match||0) < 70) return false;
  if(f.onlyEmail && !(r.emails||[]).length) return false;
  if(f.onlyPhone && !(r.phones||[]).length) return false;
  if(f.hideIrrelevant && r.irrelevant) return false;
  return true; }
function render(){ let rows = allResults.filter(passes); if(getFilters().sortScore) rows.sort((a,b)=>(b.score||0)-(a.score||0)); $('resultCount').textContent = rows.length; $('downloadBtn').disabled = rows.length === 0;
  $('tbody').innerHTML = rows.map(r=>`<tr><td><span class="score">${esc(r.score)}</span></td><td><span class="match">${esc(r.match)}</span></td><td>${esc(labelType(r.type))}</td><td><b>${esc(r.title || domainFromUrl(r.url))}</b><br><a href="${esc(r.url)}" target="_blank">${esc(r.url)}</a><br>${(r.tags||[]).map(t=>`<span class="pill">${esc(t)}</span>`).join('')}</td><td>${esc((r.phones||[]).slice(0,2).join('; '))}</td><td><span class="email">${esc(r.priorityEmail||'')}</span><br><span class="small">${esc(r.emailType||'')}</span></td><td>${esc((r.emails||[]).join('; '))}</td><td>${r.contactUrl?`<a href="${esc(r.contactUrl)}" target="_blank">打开</a>`:''}</td><td class="small">${esc(r.notes||'')}</td></tr>`).join(''); }
function labelType(t){ return {shop:'店/车店',dealer:'经销商',distributor:'分销商',wholesale:'批发'}[t] || t || ''; }
['filterText','typeFilter','minScore','minMatch','matchLevel','excludeWords','onlyEmail','onlyPhone','preferRegion','hideIrrelevant','sortScore'].forEach(id => $(id).addEventListener('input', render));
$('clearBtn').onclick=()=>{allResults=[]; render(); setStatus('已清空'); setBar(0);};
$('stopBtn').onclick=()=>{ if(aborter){ aborter.abort(); setStatus('已停止'); $('startBtn').disabled=false; $('stopBtn').disabled=true; stopTimer(); }};
$('downloadBtn').onclick=()=>{ const rows=allResults.filter(passes); const headers=['score','match','type','title','url','phones','priorityEmail','emailType','emails','contactUrl','notes']; const csv=[headers.join(',')].concat(rows.map(r=>headers.map(h=>csvCell(Array.isArray(r[h])?r[h].join('; '):(r[h]||''))).join(','))).join('\n'); const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='cycling_b2b_leads.csv'; a.click(); URL.revokeObjectURL(a.href); };
function csvCell(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }

$('startBtn').onclick = async () => {
  allResults = []; render(); setBar(0); $('startBtn').disabled=true; $('stopBtn').disabled=false; startTimer();
  aborter = new AbortController();
  const payload = { keyword:$('keyword').value, location:$('location').value, target:Number($('target').value||20), manualUrls:$('manualUrls').value, filters:getFilters() };
  try{
    const resp = await fetch('/api/search', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), signal:aborter.signal });
    if(!resp.ok) throw new Error('HTTP '+resp.status);
    const reader = resp.body.getReader(); const decoder = new TextDecoder(); let buf='';
    while(true){ const {value,done}=await reader.read(); if(done) break; buf += decoder.decode(value,{stream:true}); const lines=buf.split('\n'); buf=lines.pop(); for(const line of lines){ if(!line.trim()) continue; const msg=JSON.parse(line); handleMsg(msg); } }
    if(buf.trim()) handleMsg(JSON.parse(buf));
  }catch(e){ if(e.name !== 'AbortError') setStatus('出错：'+e.message); }
  finally{ $('startBtn').disabled=false; $('stopBtn').disabled=true; stopTimer(); }
};
function handleMsg(msg){ if(msg.type==='status'){ setStatus(msg.text); if(msg.progress!=null) setBar(msg.progress); } if(msg.type==='lead'){ allResults.push(msg.lead); render(); } if(msg.type==='done'){ setStatus(msg.text); setBar(100); render(); } if(msg.type==='warn'){ setStatus(msg.text); } }
</script>
</body></html>`;
}

function send(res, status, body, type='text/html; charset=utf-8') { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); }
function json(res, status, obj) { send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8'); }
async function readBody(req) { return new Promise((resolve, reject) => { let data=''; req.on('data', c => { data += c; if (data.length > 2_000_000) { reject(new Error('Body too large')); req.destroy(); } }); req.on('end', () => resolve(data)); req.on('error', reject); }); }

function normalizeUrl(u) {
  u = String(u || '').trim(); if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); x.hash=''; return x.toString(); } catch { return ''; }
}
function host(u){ try{return new URL(u).hostname.replace(/^www\./,'').toLowerCase()}catch{return ''} }
function isHardExcluded(u){ const h=host(u); return HARD_EXCLUDE_DOMAINS.some(d => h.includes(d.replace('.', '').length < 5 ? d : d)); }
function stripHtml(html){ return String(html||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
function decodeEntities(s){ return String(s||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>'); }
function titleFromHtml(html){ const m=String(html||'').match(/<title[^>]*>([\s\S]*?)<\/title>/i); return decodeEntities(stripHtml(m ? m[1] : '')).slice(0,140); }
function uniq(arr){ return [...new Set(arr.filter(Boolean))]; }
function includesAny(text, words){ text=String(text||'').toLowerCase(); return words.some(w=>text.includes(w)); }

async function fetchText(url, timeoutMs=8000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.8,de;q=0.7' }, signal: ctrl.signal, redirect: 'follow' });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, url: resp.url || url, text: text.slice(0, 650000) };
  } catch(e) { return { ok:false, status:0, url, text:'', error:e.name === 'AbortError' ? 'timeout' : e.message }; }
  finally { clearTimeout(t); }
}

function extractEmails(text) {
  const raw = String(text||'')
    .replace(/\s*\[at\]\s*/gi,'@').replace(/\s*\(at\)\s*/gi,'@').replace(/\s+at\s+/gi,'@')
    .replace(/\s*\[dot\]\s*/gi,'.').replace(/\s*\(dot\)\s*/gi,'.').replace(/\s+dot\s+/gi,'.');
  const m = raw.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
  return uniq(m.map(e => e.toLowerCase().replace(/^mailto:/,'').replace(/[),.;]+$/,''))).filter(e => !/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i.test(e));
}
function extractPhones(text) {
  const m = String(text||'').match(/(?:\+\d{1,3}[\s().-]?)?(?:\(?\d{2,5}\)?[\s().-]?){2,5}\d{2,5}/g) || [];
  return uniq(m.map(p => p.replace(/\s+/g,' ').trim()).filter(p => (p.match(/\d/g)||[]).length >= 7 && (p.match(/\d/g)||[]).length <= 18)).slice(0,4);
}
function chooseEmail(emails) {
  const order = ['sales@','wholesale@','dealer@','b2b@','trade@','export@','info@','contact@','hello@','order@','shop@','service@'];
  for (const key of order) { const found = emails.find(e => e.startsWith(key)); if (found) return found; }
  return emails[0] || '';
}
function emailType(email) {
  if (!email) return '';
  if (/^(sales|wholesale|dealer|b2b|trade|export)@/.test(email)) return 'high-value-business';
  if (/^(info|contact|hello|shop|order)@/.test(email)) return 'general-business';
  if (/^(privacy|abuse|noreply|no-reply|support)@/.test(email)) return 'low-priority';
  return 'other';
}
function extractLinks(base, html) {
  const links = []; const re = /href=["']([^"'#]+)["']/gi; let m;
  while ((m = re.exec(html))) {
    let href = decodeEntities(m[1]); if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
    try { links.push(new URL(href, base).toString()); } catch {}
  }
  return uniq(links).filter(u => host(u) === host(base));
}
function contactLinks(base, html) {
  const keys = ['contact','kontakt','impressum','about','ueber','über','haendler','händler','dealer','trade','b2b','wholesale','distributor','distribution','partner','retail','shop','store'];
  return extractLinks(base, html).filter(u => includesAny(u, keys)).slice(0,6);
}

async function searchBing(query, limit) {
  const url = 'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&count=30';
  const r = await fetchText(url, 9000);
  if (!r.text) return [];
  const urls = [];
  const patterns = [/href="(https?:\/\/[^"<>]+)"/gi, /<a[^>]+href="(https?:\/\/[^"<>]+)"[^>]*>/gi];
  for (const pat of patterns) { let m; while ((m = pat.exec(r.text))) urls.push(decodeEntities(m[1])); }
  return cleanCandidates(urls).slice(0, limit);
}
async function searchDuck(query, limit) {
  const url = 'https://duckduckgo.com/html/?q=' + encodeURIComponent(query);
  const r = await fetchText(url, 9000);
  if (!r.text) return [];
  const urls = []; let m; const re = /uddg=([^&"']+)/g;
  while ((m = re.exec(r.text))) { try { urls.push(decodeURIComponent(m[1])); } catch {} }
  const re2 = /class="result__a"[^>]+href="([^"]+)"/g;
  while ((m = re2.exec(r.text))) { try { urls.push(new URL(decodeEntities(m[1]), 'https://duckduckgo.com').searchParams.get('uddg') || decodeEntities(m[1])); } catch {} }
  return cleanCandidates(urls).slice(0, limit);
}
function cleanCandidates(urls) {
  const out = [];
  for (let u of urls) {
    u = normalizeUrl(u); if (!u) continue;
    try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) continue; x.hash=''; if (isHardExcluded(x.toString())) continue; out.push(x.toString()); } catch {}
  }
  const seenHost = new Set(); const result=[];
  for (const u of out) { const h=host(u); if (!h || seenHost.has(h)) continue; seenHost.add(h); result.push(u); }
  return result;
}
function buildQueries(keyword, location) {
  const k = keyword || 'bike dealer'; const l = location || '';
  const local = /germany|berlin|deutschland/i.test(l);
  const qs = [
    `${k} ${l}`,
    `${k} ${l} contact email`,
    `bike shop dealer distributor ${l}`,
    `bicycle parts distributor ${l}`,
    `cycling accessories wholesale ${l}`
  ];
  if (local) qs.push(`Fahrradladen ${l}`, `Fahrrad Händler ${l}`, `Fahrradzubehör Händler ${l}`, `site:.de Fahrrad Händler ${l}`);
  return uniq(qs);
}
function classifyAndScore({url,title,text,emails,phones,location}) {
  const hay = `${url} ${title} ${text}`.toLowerCase(); const h=host(url);
  let score = 20, match = 10; const tags=[];
  if (emails.length) { score += 25; tags.push('email'); }
  if (phones.length) { score += 10; tags.push('phone'); }
  const positives = CYCLING_POSITIVE.filter(w => hay.includes(w));
  match += Math.min(55, positives.length * 8); score += Math.min(35, positives.length * 5);
  if (positives.length) tags.push(...positives.slice(0,4));
  const loc = String(location||'').toLowerCase();
  const regionHit = (loc.includes('germany') && (h.endsWith('.de') || hay.includes('germany') || hay.includes('deutschland'))) || (loc.includes('berlin') && hay.includes('berlin'));
  if (regionHit) { score += 12; match += 10; tags.push('region'); }
  let type = 'shop';
  if (/(distributor|distribution|importer|großhandel|grosshandel)/i.test(hay)) { type='distributor'; score += 12; match += 12; }
  else if (/(wholesale|wholesaler|b2b|trade|bulk|großhandel|grosshandel)/i.test(hay)) { type='wholesale'; score += 12; match += 12; }
  else if (/(dealer|händler|handler|partner)/i.test(hay)) { type='dealer'; score += 10; match += 10; }
  const irrelevant = includesAny(hay, NEGATIVE_WORDS) || isHardExcluded(url);
  if (irrelevant) { score -= 40; match -= 35; tags.push('possible-irrelevant'); }
  if (/(official|manufacturer|brand|global)/i.test(hay) && !/(dealer|store|shop|retail)/i.test(hay)) { score -= 20; match -= 15; }
  score = Math.max(0, Math.min(100, score)); match = Math.max(0, Math.min(100, match));
  return {score, match, type, tags: uniq(tags).slice(0,8), irrelevant};
}

async function analyzeSite(url, location) {
  const home = await fetchText(url, 8500);
  if (!home.ok && !home.text) return { url, title: host(url), score: 0, match: 0, type:'', emails:[], phones:[], priorityEmail:'', emailType:'', contactUrl:'', tags:[], irrelevant:false, notes:`Homepage ${home.error || ('HTTP '+home.status)}` };
  const finalUrl = normalizeUrl(home.url || url) || url;
  let pages = [{url: finalUrl, html: home.text}];
  const contacts = contactLinks(finalUrl, home.text).slice(0,5);
  for (const link of contacts) { const r = await fetchText(link, 6500); if (r.text) pages.push({url: r.url || link, html: r.text}); }
  const combined = pages.map(p => p.html).join('\n');
  const text = stripHtml(combined).slice(0, 250000);
  const emails = extractEmails(combined + ' ' + text);
  const phones = extractPhones(text);
  const title = titleFromHtml(home.text) || host(finalUrl);
  const contactUrl = pages.find(p => p.url !== finalUrl && extractEmails(p.html).length)?.url || contacts[0] || '';
  const scoring = classifyAndScore({url: finalUrl, title, text, emails, phones, location});
  const priorityEmail = chooseEmail(emails);
  return { url: finalUrl, title, phones, emails, priorityEmail, emailType: emailType(priorityEmail), contactUrl, notes: `Checked ${pages.length} pages`, ...scoring };
}

function serverPasses(lead, filters) {
  filters = filters || {}; const text = [lead.title, lead.url, lead.type, lead.notes, (lead.emails||[]).join(' ')].join(' ').toLowerCase();
  const exclude = Array.isArray(filters.excludeWords) ? filters.excludeWords : [];
  if (exclude.some(w => w && text.includes(String(w).toLowerCase()))) return false;
  if (filters.type && filters.type !== 'all' && lead.type !== filters.type) return false;
  if (Number(filters.minScore || 0) && lead.score < Number(filters.minScore || 0)) return false;
  if (Number(filters.minMatch || 0) && lead.match < Number(filters.minMatch || 0)) return false;
  if (filters.matchLevel === 'strong' && lead.match < 70) return false;
  if (filters.onlyEmail && !(lead.emails||[]).length) return false;
  if (filters.onlyPhone && !(lead.phones||[]).length) return false;
  if (filters.hideIrrelevant && lead.irrelevant) return false;
  return true;
}

async function handleSearch(req, res) {
  let payload={}; try { payload = JSON.parse(await readBody(req) || '{}'); } catch(e) { return json(res, 400, {error:'Bad JSON'}); }
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
  const sendMsg = obj => res.write(JSON.stringify(obj) + '\n');
  const started = Date.now(); const maxMs = 75000;
  const keyword = String(payload.keyword || '').trim(); const location = String(payload.location || '').trim(); const target = Math.max(1, Math.min(50, Number(payload.target || 20))); const filters = payload.filters || {};
  try {
    sendMsg({type:'status', text:'开始准备候选网站...', progress:2});
    let candidates = String(payload.manualUrls || '').split(/\r?\n/).map(normalizeUrl).filter(Boolean);
    if (candidates.length) sendMsg({type:'status', text:`使用手动官网列表：${candidates.length} 个`, progress:8});
    else {
      const queries = buildQueries(keyword, location); const all=[]; let qi=0;
      for (const q of queries) {
        if (Date.now()-started > 25000) break;
        qi++; sendMsg({type:'status', text:`公开搜索中 ${qi}/${queries.length}: ${q}`, progress:Math.min(30, 5 + qi*3)});
        const [b,d] = await Promise.allSettled([searchBing(q, 12), searchDuck(q, 8)]);
        if (b.status === 'fulfilled') all.push(...b.value); if (d.status === 'fulfilled') all.push(...d.value);
        candidates = cleanCandidates(all).slice(0, Math.max(target * 3, 25));
        if (candidates.length >= target * 2) break;
      }
    }
    candidates = cleanCandidates(candidates).slice(0, Math.max(target * 3, 30));
    if (!candidates.length) { sendMsg({type:'done', text:'没有找到候选网站。建议在上方直接粘贴官网列表，一行一个。', progress:100}); return res.end(); }
    sendMsg({type:'status', text:`找到 ${candidates.length} 条候选线索，开始分析官网...`, progress:35});
    let found=0, checked=0;
    for (const u of candidates) {
      if (Date.now()-started > maxMs) { sendMsg({type:'warn', text:`已达到防卡顿时间上限，已先返回 ${found} 条。可降低目标数量或使用官网列表。`}); break; }
      checked++; sendMsg({type:'status', text:`正在分析 ${checked}/${candidates.length}: ${u}`, progress:35 + Math.floor((checked/candidates.length)*60)});
      const lead = await analyzeSite(u, location);
      if (serverPasses(lead, filters)) { found++; sendMsg({type:'lead', lead}); }
      if (found >= target) break;
    }
    sendMsg({type:'done', text:`完成：找到 ${found} 条筛选后线索，分析 ${checked} 个候选网站。`, progress:100});
    res.end();
  } catch(e) { sendMsg({type:'done', text:'出错：' + e.message, progress:100}); res.end(); }
}

const server = http.createServer((req, res) => {
  const path = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (req.method === 'GET' && path === '/') return send(res, 200, htmlPage());
  if (req.method === 'GET' && path === '/health') return json(res, 200, {ok:true, version:VERSION});
  if (req.method === 'POST' && path === '/api/search') return handleSearch(req, res);
  return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
});
server.listen(PORT, () => {
  console.log(`Cycling B2B Lead Scraper ${VERSION} is running.`);
  console.log(`Open: http://localhost:${PORT}`);
  console.log(`Render/Railway port: ${PORT}`);
});
