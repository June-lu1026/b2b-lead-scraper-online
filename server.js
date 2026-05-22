/*
  B2B Lead Scraper - Free Cycling Dealer Version
  Requires: Node.js 18+
  No npm install needed. Uses only built-in Node.js modules.

  What it does:
  - Takes keyword + location
  - Searches public DuckDuckGo HTML results
  - Visits candidate business websites
  - Extracts public emails and phones from homepage/contact-like pages
  - Streams results to browser as NDJSON

  Notes:
  - This version does NOT use Google Places API, so it cannot reliably return map business data.
  - Results depend on public search pages and target website availability.
  - Use politely and keep limits small.
*/

const http = require('http');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT || 3000);
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 B2BLeadScraperCycling/1.2-filter';
const REQUEST_TIMEOUT_MS = 12000;
const SEARCH_DELAY_MS = 900;
const PAGE_DELAY_MS = 350;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function decodeHtmlEntities(str = '') {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x3D;/g, '=')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeWhitespace(str = '') {
  return String(str).replace(/\s+/g, ' ').trim();
}

function stripTags(html = '') {
  return decodeHtmlEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function hostOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function isBlockedHost(rawUrl) {
  const host = hostOf(rawUrl);
  if (!host) return true;
  const blocked = [
    'duckduckgo.com', 'google.com', 'bing.com', 'yahoo.com', 'facebook.com',
    'instagram.com', 'linkedin.com', 'youtube.com', 'tiktok.com', 'x.com',
    'twitter.com', 'pinterest.com', 'reddit.com', 'wikipedia.org',
    'amazon.com', 'ebay.com', 'apple.com', 'mapquest.com',
    'tripadvisor.com', 'yelp.com', 'yellowpages.com', 'trustpilot.com',
    'opencorporates.com', 'zoominfo.com', 'rocketreach.co', 'microsoft.com', 'office.com', 'live.com', 'msn.com', 'github.com', 'stackoverflow.com', 'medium.com'
  ];
  return blocked.some(domain => host === domain || host.endsWith('.' + domain));
}

function cleanUrl(rawUrl) {
  if (!rawUrl) return '';
  let u = decodeHtmlEntities(String(rawUrl)).trim();

  // DuckDuckGo redirect URL, e.g. /l/?uddg=https%3A%2F%2Fexample.com
  try {
    if (u.startsWith('//duckduckgo.com/l/') || u.startsWith('https://duckduckgo.com/l/') || u.startsWith('http://duckduckgo.com/l/')) {
      const parsed = new URL(u.startsWith('//') ? 'https:' + u : u);
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) u = decodeURIComponent(uddg);
    }
  } catch {}

  // Bing redirect URL, e.g. /ck/a?...&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbQ...
  try {
    if (u.startsWith('/ck/') || u.includes('bing.com/ck/')) {
      const parsed = new URL(u.startsWith('/') ? 'https://www.bing.com' + u : u);
      const encoded = parsed.searchParams.get('u');
      if (encoded) {
        let b64 = encoded;
        if (b64.startsWith('a1')) b64 = b64.slice(2);
        b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(b64, 'base64').toString('utf8');
        if (/^https?:\/\//i.test(decoded)) u = decoded;
      }
    }
  } catch {}

  if (u.startsWith('//')) u = 'https:' + u;
  if (!/^https?:\/\//i.test(u)) return '';

  try {
    const parsed = new URL(u);
    parsed.hash = '';
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']) {
      parsed.searchParams.delete(p);
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

async function fetchText(rawUrl, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
  try {
    const headers = {
      'User-Agent': options.userAgent || USER_AGENT,
      'Accept': options.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': options.acceptLanguage || 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7'
    };
    if (options.contentType) headers['Content-Type'] = options.contentType;

    const response = await fetch(rawUrl, {
      method: options.method || 'GET',
      body: options.body,
      headers,
      redirect: 'follow',
      signal: controller.signal
    });

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      return { ok: false, status: response.status, url: response.url, text: '', contentType };
    }
    const text = await response.text();
    return { ok: true, status: response.status, url: response.url, text, contentType };
  } catch (error) {
    return { ok: false, status: 0, url: rawUrl, text: '', contentType: '', error: error.message };
  } finally {
    clearTimeout(timer);
  }
}


function buildSearchQueries(keyword, location) {
  const kw = normalizeWhitespace(keyword || 'bike dealer');
  const loc = normalizeWhitespace(location || '');
  const lower = `${kw} ${loc}`.toLowerCase();
  const isCycling = /\b(bicycle|bike|cycling|cycle|fahrrad|velo|ebike|e-bike|mtb)\b/i.test(lower);
  let queries;
  if (isCycling) {
    queries = [
      `"bike shop" "${loc}" contact email`,
      `"bicycle shop" "${loc}" official website`,
      `"cycling store" "${loc}" contact`,
      `"bicycle dealer" "${loc}"`,
      `"bike dealer" "${loc}" contact`,
      `"Fahrradladen" "${loc}"`,
      `"Radladen" "${loc}"`,
      `"bicycle accessories" "${loc}" dealer`,
      `"bike parts" "${loc}" shop`,
      `"cycling accessories distributor" "${loc}"`,
      `"bicycle parts distributor" "${loc}"`,
      `"bike accessories wholesale" "${loc}"`
    ];
  } else {
    const base = `${kw} ${loc}`.trim();
    queries = [
      `"${base}" official website email`,
      `"${base}" contact`,
      `"${base}" dealer retailer`,
      `"${kw}" "${loc}" wholesale distributor`
    ];
  }
  return Array.from(new Set(queries.filter(Boolean)));
}

function dedupeLinksByHost(links) {
  const seen = new Set();
  const cleaned = [];
  for (const url of links) {
    const host = hostOf(url);
    if (!host || seen.has(host) || isBlockedHost(url)) continue;
    seen.add(host);
    cleaned.push(url);
  }
  return cleaned;
}

function extractDuckDuckGoLinks(html) {
  const links = [];
  const pattern = /class="result__a"[^>]+href="([^"]+)"/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const url = cleanUrl(match[1]);
    if (url && !isBlockedHost(url)) links.push(url);
  }
  return dedupeLinksByHost(links);
}

function extractBingLinks(html) {
  const links = [];
  const patterns = [
    /<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/gi,
    /<h2[^>]*>[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+)"/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const url = cleanUrl(match[1]);
      if (url && !isBlockedHost(url)) links.push(url);
    }
  }
  return dedupeLinksByHost(links);
}

async function searchDuckDuckGo(query, maxLinks) {
  const url = 'https://html.duckduckgo.com/html/?' + new URLSearchParams({ q: query }).toString();
  const getResult = await fetchText(url, { timeoutMs: REQUEST_TIMEOUT_MS });
  if (getResult.ok) {
    const links = extractDuckDuckGoLinks(getResult.text).slice(0, maxLinks);
    if (links.length) return links;
  }

  const form = new URLSearchParams({ q: query });
  const postResult = await fetchText('https://html.duckduckgo.com/html/', {
    method: 'POST',
    body: form.toString(),
    contentType: 'application/x-www-form-urlencoded',
    timeoutMs: REQUEST_TIMEOUT_MS
  });
  if (!postResult.ok) return [];
  return extractDuckDuckGoLinks(postResult.text).slice(0, maxLinks);
}

async function searchBing(query, maxLinks) {
  const url = 'https://www.bing.com/search?' + new URLSearchParams({ q: query, count: String(Math.min(50, maxLinks + 10)) }).toString();
  const result = await fetchText(url, { timeoutMs: REQUEST_TIMEOUT_MS });
  if (!result.ok) return [];
  return extractBingLinks(result.text).slice(0, maxLinks);
}

function parseManualWebsites(raw) {
  const parts = String(raw || '')
    .split(/[\s,;]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const sites = [];
  const seen = new Set();
  for (let item of parts) {
    if (!/^https?:\/\//i.test(item)) item = 'https://' + item;
    const url = cleanUrl(item);
    const host = hostOf(url);
    if (!url || !host || seen.has(host) || isBlockedHost(url)) continue;
    seen.add(host);
    sites.push({ url, query: 'manual website list' });
  }
  return sites;
}


async function discoverCandidateSites(keyword, location, limit, onProgress) {
  const queries = buildSearchQueries(keyword, location);
  const seenHosts = new Set();
  const sites = [];
  const searchers = [
    { name: 'DuckDuckGo', fn: searchDuckDuckGo },
    { name: 'Bing', fn: searchBing }
  ];

  for (const query of queries) {
    if (sites.length >= limit) break;
    for (const searcher of searchers) {
      if (sites.length >= limit) break;
      onProgress({ type: 'status', message: `${searcher.name} searching: ${query}` });
      const links = await searcher.fn(query, Math.max(10, limit));
      for (const link of links) {
        const host = hostOf(link);
        if (!host || seenHosts.has(host)) continue;
        seenHosts.add(host);
        sites.push({ url: link, query: `${searcher.name}: ${query}` });
        if (sites.length >= limit) break;
      }
      await sleep(SEARCH_DELAY_MS);
    }
  }

  return sites;
}

function extractTitle(html, fallbackHost) {
  const titleMatch = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) return fallbackHost || '';
  let title = normalizeWhitespace(stripTags(titleMatch[1]));
  title = title.replace(/\s*[\-|–|—|•]\s*(Home|Official Site|Homepage)\s*$/i, '');
  title = title.replace(/\s*[\-|–|—]\s*.*?(Official Website|Home)\s*$/i, '');
  if (title.length > 90) title = title.slice(0, 90).trim();
  return title || fallbackHost || '';
}

function deobfuscateText(text) {
  return String(text)
    .replace(/\s*\[\s*at\s*\]\s*/gi, '@')
    .replace(/\s*\(\s*at\s*\)\s*/gi, '@')
    .replace(/\s+at\s+/gi, '@')
    .replace(/\s*\[\s*dot\s*\]\s*/gi, '.')
    .replace(/\s*\(\s*dot\s*\)\s*/gi, '.')
    .replace(/\s+dot\s+/gi, '.');
}

function extractEmailsFromText(text) {
  const clean = deobfuscateText(decodeHtmlEntities(String(text)));
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi;
  const matches = clean.match(emailRegex) || [];
  const badFragments = [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.css', '.js',
    'example.com', 'domain.com', 'email.com', 'yourname@', 'name@',
    'sentry.io', 'wixpress.com', 'shopify.com', 'wordpress.com',
    'schema.org', 'cloudflare.com'
  ];

  const seen = new Set();
  const emails = [];
  for (let email of matches) {
    email = email.toLowerCase().replace(/[.,;:)]+$/g, '');
    if (badFragments.some(fragment => email.includes(fragment))) continue;
    if (!email.includes('@') || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return emails;
}

function classifyEmail(email) {
  const local = email.split('@')[0].toLowerCase();
  if (/^(sales|wholesale|dealer|dealers|distributor|distribution|procurement|purchasing|purchase|buyers?|orders?|export|trade|b2b|business)$/.test(local)) {
    return 'high-value-business';
  }
  if (/^(info|contact|hello|office|admin|service|customerservice|enquiry|inquiry)$/.test(local)) {
    return 'general-business';
  }
  if (/^(support|help|privacy|legal|abuse|security|noreply|no-reply|donotreply)$/.test(local)) {
    return 'low-priority';
  }
  return 'other';
}

function selectPriorityEmail(emails) {
  const score = email => {
    const type = classifyEmail(email);
    if (type === 'high-value-business') return 100;
    if (type === 'general-business') return 70;
    if (type === 'other') return 40;
    return 10;
  };
  return [...emails].sort((a, b) => score(b) - score(a))[0] || '';
}

function extractPhonesFromText(text) {
  const clean = normalizeWhitespace(stripTags(text));
  const phoneRegex = /(?:\+\d{1,3}[\s().-]?)?(?:\(?\d{2,4}\)?[\s().-]?){2,5}\d{3,4}/g;
  const matches = clean.match(phoneRegex) || [];
  const seen = new Set();
  const phones = [];
  for (const raw of matches) {
    const phone = raw.trim();
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 16) continue;
    if (/^\d{4}$/.test(digits)) continue;
    if (seen.has(phone)) continue;
    seen.add(phone);
    phones.push(phone);
    if (phones.length >= 3) break;
  }
  return phones;
}

function extractCandidatePageLinks(baseUrl, html) {
  const result = [];
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const words = [
    'contact', 'about', 'impressum', 'imprint', 'legal',
    'wholesale', 'dealer', 'distributor', 'trade', 'b2b',
    'privacy', 'customer-service', 'support'
  ];

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = decodeHtmlEntities(match[1] || '').trim();
    const label = normalizeWhitespace(stripTags(match[2] || '')).toLowerCase();
    const combined = `${href} ${label}`.toLowerCase();
    if (!words.some(w => combined.includes(w))) continue;

    try {
      const url = new URL(href, baseUrl);
      url.hash = '';
      if (!/^https?:$/i.test(url.protocol)) continue;
      if (hostOf(url.toString()) !== hostOf(baseUrl)) continue;
      result.push(url.toString());
    } catch {}
  }

  const seen = new Set();
  return result.filter(url => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  }).slice(0, 6);
}


const CYCLING_TERMS = [
  'bicycle','bicycles','bike','bikes','cycling','cycle','cycles','ebike','e-bike','mtb',
  'road bike','mountain bike','gravel bike','bike parts','bicycle parts','cycling accessories',
  'fahrrad','fahrräder','fahrradladen','radladen','rennrad','mountainbike','velo'
];
const CHANNEL_TERMS = [
  'shop','store','retailer','dealer','dealers','distributor','distribution','wholesale','wholesaler',
  'reseller','stockist','importer','trade','b2b','parts','accessories','workshop','repair','service',
  'laden','händler','haendler','vertrieb','grosshandel','großhandel'
];
const STRONG_NEGATIVE_TERMS = [
  'microsoft','bing','software','privacy policy','terms of service','digital services act',
  'support page','help center','login','careers','jobs','press release',
  'news','magazine','review','reviews','blog','forum','best bike','top bike','buyers guide','buying guide','roundup','comparison'
];
const KNOWN_BRAND_OR_MARKETPLACE_DOMAINS = [
  'trekbikes.com','specialized.com','giant-bicycles.com','cannondale.com','canyon.com',
  'shimano.com','sram.com','bosch-ebike.com','rei.com','bikesdirect.com',
  'cyclingnews.com','bicycling.com','road.cc','bikeperfect.com','pinkbike.com','singletracks.com','bikeradar.com'
];
function includesAny(text, terms) {
  const lower = String(text || '').toLowerCase();
  return terms.some(term => lower.includes(term.toLowerCase()));
}
function locationTokens(location) {
  const tokens = String(location || '').toLowerCase().split(/[^a-z0-9äöüß]+/i).map(t => t.trim()).filter(t => t.length >= 3);
  if (/germany|deutschland|de\b/i.test(location || '')) tokens.push('germany','deutschland','german','berlin','.de');
  return Array.from(new Set(tokens));
}
function scoreTargetFit({ lead, allText, location }) {
  const host = hostOf(lead.website || '');
  const title = lead.business_name || '';
  const text = `${title} ${host} ${lead.website || ''} ${allText || ''}`.toLowerCase();
  const titleHost = `${title} ${host}`.toLowerCase();
  let score = 0;
  const notes = [];
  if (includesAny(titleHost, CYCLING_TERMS)) { score += 35; notes.push('cycling in title/domain'); }
  else if (includesAny(text, CYCLING_TERMS)) { score += 25; notes.push('cycling content'); }
  if (includesAny(titleHost, CHANNEL_TERMS)) { score += 30; notes.push('dealer/shop/distributor in title/domain'); }
  else if (includesAny(text, CHANNEL_TERMS)) { score += 20; notes.push('dealer/shop/distributor content'); }
  const locTokens = locationTokens(location);
  let locHit = false;
  for (const token of locTokens) {
    if (token === '.de' && host.endsWith('.de')) locHit = true;
    else if (token !== '.de' && text.includes(token)) locHit = true;
  }
  if (locHit) { score += 25; notes.push('location match'); }
  else if (location) { score -= 20; notes.push('weak location match'); }
  if (lead.priority_email && classifyEmail(lead.priority_email) !== 'low-priority') score += 10;
  if (includesAny(text.slice(0, 5000), STRONG_NEGATIVE_TERMS)) { score -= 50; notes.push('irrelevant/support/tech signals'); }
  if (KNOWN_BRAND_OR_MARKETPLACE_DOMAINS.some(d => host === d || host.endsWith('.' + d))) { score -= 35; notes.push('likely brand/marketplace, not dealer/distributor'); }
  score = Math.max(0, Math.min(100, score));
  let category = 'needs-review';
  if (score >= 75) category = 'strong cycling dealer/distributor fit';
  else if (score >= 50) category = 'possible cycling channel lead';
  else category = 'low relevance';
  return { score, notes: notes.join(', '), category };
}

function calculateLeadScore({ website, phone, emails, priorityEmail, allText }) {
  let score = 0;
  if (website) score += 20;
  if (phone) score += 10;
  if (emails.length) score += 30;
  if (priorityEmail) {
    const type = classifyEmail(priorityEmail);
    if (type === 'high-value-business') score += 20;
    if (type === 'general-business') score += 10;
  }
  if (/\b(wholesale|distributor|dealer|b2b|trade|procurement|export)\b/i.test(allText || '')) score += 20;
  return Math.min(score, 100);
}

async function analyzeWebsite(site, context = {}) {
  const homepage = await fetchText(site.url);
  const finalUrl = homepage.url || site.url;
  const host = hostOf(finalUrl);
  const pagesVisited = [];
  const allEmails = new Set();
  let phone = '';
  let contactPageUrl = '';
  let title = host;
  let notes = [];

  if (!homepage.ok || !/text\/html|application\/xhtml|text\/plain/i.test(homepage.contentType)) {
    return {
      business_name: host || site.url,
      website: finalUrl,
      phone: '',
      emails: [],
      priority_email: '',
      email_type: '',
      contact_page_url: '',
      source: site.query,
      lead_score: 0,
      target_fit_score: 0,
      target_category: 'fetch failed',
      target_notes: '',
      notes: homepage.error ? `Could not fetch homepage: ${homepage.error}` : `Homepage HTTP ${homepage.status}`,
      do_not_contact: false,
      created_at: new Date().toISOString()
    };
  }

  pagesVisited.push(finalUrl);
  title = extractTitle(homepage.text, host);
  let combinedText = stripTags(homepage.text);
  for (const email of extractEmailsFromText(homepage.text)) allEmails.add(email);
  const homePhones = extractPhonesFromText(homepage.text);
  if (homePhones[0]) phone = homePhones[0];

  const contactLinks = extractCandidatePageLinks(finalUrl, homepage.text);
  for (const link of contactLinks) {
    await sleep(PAGE_DELAY_MS);
    const page = await fetchText(link);
    if (!page.ok) continue;
    pagesVisited.push(page.url || link);
    const text = page.text || '';
    combinedText += '\n' + stripTags(text);
    const pageEmails = extractEmailsFromText(text);
    if (pageEmails.length && !contactPageUrl) contactPageUrl = page.url || link;
    for (const email of pageEmails) allEmails.add(email);
    if (!phone) {
      const pagePhones = extractPhonesFromText(text);
      if (pagePhones[0]) phone = pagePhones[0];
    }
  }

  const emails = Array.from(allEmails);
  const priority = selectPriorityEmail(emails);
  const emailType = priority ? classifyEmail(priority) : '';
  if (!emails.length) notes.push('No public email found on checked pages');
  if (!phone) notes.push('No phone found on website');
  if (pagesVisited.length > 1) notes.push(`Checked ${pagesVisited.length} pages`);

  const website = finalUrl;
  const lead_score = calculateLeadScore({ website, phone, emails, priorityEmail: priority, allText: combinedText });
  const baseLead = {
    business_name: title,
    website,
    phone,
    emails,
    priority_email: priority,
    email_type: emailType,
    contact_page_url: contactPageUrl,
    source: site.query,
    lead_score,
    notes: notes.join('; '),
    do_not_contact: false,
    created_at: new Date().toISOString()
  };
  const fit = scoreTargetFit({ lead: baseLead, allText: combinedText, location: context.location || '' });
  baseLead.target_fit_score = fit.score;
  baseLead.target_category = fit.category;
  baseLead.target_notes = fit.notes;
  baseLead.lead_score = Math.round((lead_score * 0.45) + (fit.score * 0.55));
  return baseLead;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>B2B Lead Scraper - Free</title>
  <style>
    :root { font-family: Arial, "Microsoft YaHei", sans-serif; color: #1f2937; background: #f7f7fb; }
    body { margin: 0; }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 28px 18px 48px; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; box-shadow: 0 8px 24px rgba(15,23,42,.06); padding: 22px; margin-bottom: 18px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .sub { margin: 0; color: #6b7280; line-height: 1.6; }
    .grid { display: grid; grid-template-columns: 1fr 1fr 140px auto; gap: 12px; align-items: end; margin-top: 18px; }
    label { display: block; font-size: 13px; color: #4b5563; margin-bottom: 6px; }
    input, select { width: 100%; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 12px; padding: 11px 12px; font-size: 15px; background:#fff; }
    .filter-box { background:#f9fafb; border:1px solid #e5e7eb; border-radius:14px; padding:14px; margin-bottom:14px; }
    .filter-grid { display:grid; grid-template-columns: repeat(6, minmax(120px, 1fr)); gap:10px; align-items:end; }
    .checks { display:flex; flex-wrap:wrap; gap:12px; margin-top:10px; font-size:13px; color:#374151; }
    .checks label { display:flex; align-items:center; gap:6px; margin:0; }
    .checks input { width:auto; }
    .tiny { font-size:12px; color:#6b7280; margin-top:6px; }
    button { border: 0; border-radius: 12px; padding: 12px 16px; background: #111827; color: #fff; cursor: pointer; font-size: 15px; }
    button.secondary { background: #374151; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .status { margin-top: 14px; font-size: 14px; color: #4b5563; min-height: 22px; }
    .bar { height: 10px; background: #e5e7eb; border-radius: 999px; overflow: hidden; margin-top: 12px; }
    .fill { height: 100%; width: 0%; background: #111827; transition: width .25s; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #eef0f3; vertical-align: top; text-align: left; }
    th { background: #f9fafb; position: sticky; top: 0; z-index: 1; }
    .table-wrap { max-height: 560px; overflow: auto; border: 1px solid #e5e7eb; border-radius: 14px; }
    .pill { display:inline-block; padding: 3px 8px; border-radius: 999px; background:#eef2ff; color:#3730a3; font-size:12px; }
    .muted { color:#6b7280; }
    .note { background:#fff7ed; border:1px solid #fed7aa; color:#9a3412; border-radius:14px; padding:12px 14px; margin-top:14px; font-size:14px; line-height:1.55; }
    a { color: #2563eb; text-decoration: none; }
    @media (max-width: 850px) { .grid, .filter-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>骑行配件 B2B 线索采集工具 - 筛选版</h1>
      <p class="sub">专门用于寻找自行车店、骑行店、配件经销商、批发商和分销商官网，并从公开页面提取邮箱和电话。</p>
      <div class="note">说明：免费版不调用 Google Maps/Places，所以没有稳定的地图商家电话、地址和前 100 商家保证。系统会过滤 Microsoft/搜索引擎帮助页、品牌官网、无关平台等低相关结果。免费版仍依赖公开搜索结果；如果搜索不准，建议直接粘贴官网列表。</div>
      <div style="margin-top:16px;">
        <label>可选：直接粘贴官网列表，一行一个。填了这里会优先分析这些网站，不依赖公开搜索。</label>
        <textarea id="websites" placeholder="例如：&#10;https://example-bike-shop.de&#10;https://example-distributor.com" style="width:100%; box-sizing:border-box; min-height:76px; border:1px solid #d1d5db; border-radius:12px; padding:11px 12px; font-size:14px; resize:vertical;"></textarea>
      </div>
      <div class="grid">
        <div>
          <label>行业关键词</label>
          <input id="keyword" placeholder="例如 bike dealer / bicycle shop / cycling accessories distributor" value="bike dealer">
        </div>
        <div>
          <label>地区</label>
          <input id="location" placeholder="例如 Berlin Germany" value="Berlin Germany">
        </div>
        <div>
          <label>目标数量</label>
          <input id="limit" type="number" min="1" max="80" value="20">
        </div>
        <div>
          <button id="startBtn">开始提取</button>
        </div>
      </div>
      <div class="status" id="status">准备就绪</div>
      <div class="bar"><div class="fill" id="fill"></div></div>
    </div>

    <div class="card">
      <div style="display:flex; gap:12px; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <div><strong>结果</strong> <span class="muted" id="count">0 条</span></div>
        <button class="secondary" id="downloadBtn" disabled>下载筛选后 CSV</button>
      </div>
      <div class="filter-box">
        <div style="font-weight:700; margin-bottom:10px;">筛选结果</div>
        <div class="filter-grid">
          <div>
            <label>搜索结果内关键词</label>
            <input id="filterText" placeholder="例如 berlin / distributor / shop">
          </div>
          <div>
            <label>线索类型</label>
            <select id="filterType">
              <option value="channel" selected>店/经销商/分销商</option>
              <option value="shop">只看门店/零售店</option>
              <option value="dealer">只看经销商/Dealer</option>
              <option value="distributor">只看分销商/Distributor</option>
              <option value="wholesale">只看批发/Wholesale</option>
              <option value="all">不限</option>
            </select>
          </div>
          <div>
            <label>最低总分</label>
            <input id="minScore" type="number" min="0" max="100" value="50">
          </div>
          <div>
            <label>最低匹配度</label>
            <input id="minFit" type="number" min="0" max="100" value="45">
          </div>
          <div>
            <label>匹配等级</label>
            <select id="fitCategory">
              <option value="all">不限</option>
              <option value="strong">强匹配</option>
              <option value="possible" selected>强匹配 + 可能匹配</option>
            </select>
          </div>
          <div>
            <label>排除关键词</label>
            <input id="excludeText" value="microsoft,bing,cyclingnews,magazine,news,review,forum,wikipedia,amazon,ebay">
          </div>
        </div>
        <div class="checks">
          <label><input id="requireEmail" type="checkbox" checked> 只看有邮箱</label>
          <label><input id="requirePhone" type="checkbox"> 只看有电话</label>
          <label><input id="strictLocation" type="checkbox" checked> 地区相关 / 德国站优先</label>
          <label><input id="hideMedia" type="checkbox" checked> 隐藏新闻/测评/论坛/平台页</label>
          <label><input id="sortByScore" type="checkbox" checked> 按分数排序</label>
        </div>
        <div class="tiny">提示：如果你要找德国本地客户，建议关键词用 Fahrradladen、Fahrrad Händler、bike dealer、bicycle parts distributor，并保持“地区相关”开启。</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>分数</th>
              <th>匹配度</th>
              <th>公司/网站</th>
              <th>电话</th>
              <th>优先邮箱</th>
              <th>全部邮箱</th>
              <th>Contact 页面</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
    </div>
  </div>

<script>
const rows = [];
const startBtn = document.getElementById('startBtn');
const downloadBtn = document.getElementById('downloadBtn');
const tbody = document.getElementById('tbody');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const fillEl = document.getElementById('fill');

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function setStatus(msg) {
  statusEl.textContent = msg || '';
}

let filteredRows = [];

function leadText(row) {
  return [
    row.business_name, row.website, row.phone, row.priority_email,
    (row.emails || []).join(' '), row.email_type, row.target_category,
    row.target_notes, row.notes
  ].join(' ').toLowerCase();
}

function splitWords(value) {
  return String(value || '').split(/[,;，、\n]+/).map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
}

function typeMatches(row, type) {
  if (type === 'all') return true;
  const text = leadText(row);
  const sets = {
    channel: ['shop','store','retailer','dealer','distributor','wholesale','wholesaler','händler','haendler','laden','vertrieb','grosshandel','großhandel','b2b','trade'],
    shop: ['shop','store','retailer','fahrradladen','radladen','laden','workshop','repair'],
    dealer: ['dealer','dealers','händler','haendler','reseller','stockist'],
    distributor: ['distributor','distribution','vertrieb','importer','export'],
    wholesale: ['wholesale','wholesaler','grosshandel','großhandel','b2b','trade']
  };
  return (sets[type] || []).some(function(w) { return text.includes(w); });
}

function locationMatches(row) {
  const loc = document.getElementById('location').value.toLowerCase();
  if (!loc.trim()) return true;
  const rowText = [row.business_name, row.website, row.target_notes, row.notes].join(' ').toLowerCase();
  const host = (function() { try { return new URL(row.website).hostname.toLowerCase(); } catch (e) { return ''; } })();
  const tokens = loc.split(/[^a-z0-9äöüß]+/i).filter(function(t) { return t.length >= 3; });
  if (/germany|deutschland|de\b/i.test(loc) && host.endsWith('.de')) return true;
  return tokens.some(function(t) { return rowText.includes(t); });
}

function rowPassesFilters(row) {
  const text = leadText(row);
  const search = document.getElementById('filterText').value.trim().toLowerCase();
  if (search && !text.includes(search)) return false;

  const minScore = Number(document.getElementById('minScore').value || 0);
  const minFit = Number(document.getElementById('minFit').value || 0);
  if (Number(row.lead_score || 0) < minScore) return false;
  if (Number(row.target_fit_score || 0) < minFit) return false;

  const cat = document.getElementById('fitCategory').value;
  const target = String(row.target_category || '').toLowerCase();
  if (cat === 'strong' && !target.includes('strong')) return false;
  if (cat === 'possible' && !(target.includes('strong') || target.includes('possible'))) return false;

  if (!typeMatches(row, document.getElementById('filterType').value)) return false;
  if (document.getElementById('requireEmail').checked && !(row.emails || []).length) return false;
  if (document.getElementById('requirePhone').checked && !row.phone) return false;
  if (document.getElementById('strictLocation').checked && !locationMatches(row)) return false;

  if (document.getElementById('hideMedia').checked) {
    const mediaWords = ['news','magazine','review','reviews','blog','forum','wiki','best bike','top bike','buying guide','buyers guide','comparison','youtube','facebook','instagram'];
    if (mediaWords.some(function(w) { return text.includes(w); })) return false;
  }

  const exclude = splitWords(document.getElementById('excludeText').value);
  if (exclude.some(function(w) { return text.includes(w); })) return false;
  return true;
}

function renderRows() {
  filteredRows = rows.filter(rowPassesFilters);
  if (document.getElementById('sortByScore').checked) {
    filteredRows.sort(function(a, b) { return Number(b.lead_score || 0) - Number(a.lead_score || 0); });
  }
  tbody.innerHTML = '';
  countEl.textContent = filteredRows.length + ' / ' + rows.length + ' 条';
  downloadBtn.disabled = filteredRows.length === 0;

  for (const row of filteredRows) {
    const tr = document.createElement('tr');
    const contact = row.contact_page_url ? '<a target="_blank" href="' + esc(row.contact_page_url) + '">打开</a>' : '';
    tr.innerHTML =
      '<td><span class="pill">' + esc(row.lead_score) + '</span></td>' +
      '<td><span class="pill">' + esc(row.target_fit_score || '') + '</span><br><span class="muted">' + esc(row.target_category || '') + '</span></td>' +
      '<td><strong>' + esc(row.business_name) + '</strong><br><a href="' + esc(row.website) + '" target="_blank">' + esc(row.website) + '</a></td>' +
      '<td>' + esc(row.phone) + '</td>' +
      '<td><strong>' + esc(row.priority_email) + '</strong><br><span class="muted">' + esc(row.email_type) + '</span></td>' +
      '<td>' + esc((row.emails || []).join('; ')) + '</td>' +
      '<td>' + contact + '</td>' +
      '<td class="muted">' + esc([row.target_notes, row.notes].filter(Boolean).join('; ')) + '</td>';
    tbody.appendChild(tr);
  }
}

function addRow(row) {
  rows.push(row);
  renderRows();
}

function toCsvValue(v) {
  const s = Array.isArray(v) ? v.join('; ') : String(v ?? '');
  return '"' + s.replace(/"/g, '""') + '"';
}

function downloadCsv() {
  const headers = [
    'business_name','website','phone','emails','priority_email','email_type',
    'contact_page_url','source','lead_score','target_fit_score','target_category','target_notes','notes','do_not_contact','created_at'
  ];
  const data = filteredRows.length ? filteredRows : rows;
  const csv = [headers.join(',')].concat(data.map(function(r) { return headers.map(function(h) { return toCsvValue(r[h]); }).join(','); })).join('\\r\\n');
  const blob = new Blob(['\\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'b2b-leads-filtered.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

downloadBtn.addEventListener('click', downloadCsv);
for (const id of ['filterText','filterType','minScore','minFit','fitCategory','excludeText','requireEmail','requirePhone','strictLocation','hideMedia','sortByScore']) {
  document.addEventListener('input', function(e) { if (e.target && e.target.id === id) renderRows(); });
  document.addEventListener('change', function(e) { if (e.target && e.target.id === id) renderRows(); });
}


startBtn.addEventListener('click', async () => {
  rows.length = 0;
  tbody.innerHTML = '';
  countEl.textContent = '0 条';
  filteredRows = [];
  downloadBtn.disabled = true;
  fillEl.style.width = '0%';
  startBtn.disabled = true;

  const payload = {
    keyword: document.getElementById('keyword').value.trim(),
    location: document.getElementById('location').value.trim(),
    limit: Number(document.getElementById('limit').value || 20),
    websites: document.getElementById('websites').value.trim()
  };

  if (!payload.keyword || !payload.location) {
    setStatus('请填写关键词和地区');
    startBtn.disabled = false;
    return;
  }

  try {
    setStatus('开始搜索...');
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok || !res.body) {
      const text = await res.text();
      throw new Error(text || '请求失败');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'status') setStatus(msg.message);
        if (msg.type === 'progress') {
          fillEl.style.width = Math.min(100, Math.round((msg.current / Math.max(1, msg.total)) * 100)) + '%';
          setStatus(\`正在分析 \${msg.current}/\${msg.total}: \${msg.website || ''}\`);
        }
        if (msg.type === 'lead') addRow(msg.data);
        if (msg.type === 'done') {
          fillEl.style.width = '100%';
          setStatus(\`完成：找到 \${rows.length} 条候选线索\`);
        }
        if (msg.type === 'error') setStatus('错误：' + msg.message);
      }
    }
  } catch (err) {
    setStatus('错误：' + err.message);
  } finally {
    startBtn.disabled = false;
  }
});
</script>
</body>
</html>`;

async function handleSearch(req, res) {
  let body;
  try {
    body = await parseBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: 'Invalid JSON body' });
  }

  const keyword = normalizeWhitespace(body.keyword || '');
  const location = normalizeWhitespace(body.location || '');
  const limit = Math.max(1, Math.min(80, Number(body.limit || 20)));
  const manualSites = parseManualWebsites(body.websites || '').slice(0, limit);

  if (!manualSites.length && (!keyword || !location)) {
    return sendJson(res, 400, { error: 'keyword and location are required, unless websites are provided' });
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
  });

  const write = obj => res.write(JSON.stringify(obj) + '\n');

  try {
    let sites = manualSites;
    if (sites.length) {
      write({ type: 'status', message: `Using ${sites.length} websites from manual list. Analyzing...` });
    } else {
      write({ type: 'status', message: 'Searching public web results...' });
      sites = await discoverCandidateSites(keyword, location, limit, write);
      if (!sites.length) {
        write({ type: 'status', message: 'No candidate websites found from public search. Try a more specific keyword, or paste website URLs into the manual website list.' });
      } else {
        write({ type: 'status', message: `Found ${sites.length} candidate websites. Analyzing...` });
      }
    }

    let current = 0;
    for (const site of sites) {
      current += 1;
      write({ type: 'progress', current, total: sites.length, website: site.url });
      const lead = await analyzeWebsite(site, { keyword, location });
      const isManual = manualSites.length > 0;
      if (isManual || lead.target_fit_score >= 45) {
        write({ type: 'lead', data: lead });
      } else {
        write({ type: 'status', message: `跳过低相关结果：${lead.business_name || site.url}` });
      }
      await sleep(PAGE_DELAY_MS);
    }

    write({ type: 'done', count: sites.length });
  } catch (error) {
    write({ type: 'error', message: error.message });
  } finally {
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && reqUrl.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(INDEX_HTML);
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/search') {
    await handleSearch(req, res);
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/health') {
    return sendJson(res, 200, { ok: true });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('B2B Lead Scraper Free is running.');
  console.log(`Open: http://localhost:${PORT}`);
  console.log(`Render/Railway port: ${PORT}`);
  console.log('');
});
