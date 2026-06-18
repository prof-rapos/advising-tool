'use strict';
// Pre-scrapes the Ontario Tech academic calendar using a headless browser.
// Playwright's Chromium solves the AWS WAF JavaScript challenge automatically.
// Results are written to cache/ and committed to the repo, so the Render
// server never needs to do live calendar fetches at runtime.
//
// Usage:  node scrape.js
//         npm run scrape
// Also triggered weekly by .github/workflows/scrape.yml

const { chromium } = require('playwright-chromium');
const path = require('path');
const { parseProgramFromHtml, diskSet, ALL_PREFIXES } = require('./server');

const CAL = 'https://calendar.ontariotechu.ca';

function decode(s) {
  return s.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&#160;/g,' ')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/\s+/g,' ').trim();
}

async function browserGet(page, url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const html = await page.content();
    if (html.includes('AwsWafIntegration') && html.length < 5000) {
      if (attempt < retries) {
        console.log(`  [WAF] retrying in 3s... (${url.slice(-50)})`);
        await page.waitForTimeout(3000);
        continue;
      }
      throw new Error(`WAF blocked: ${url}`);
    }
    return html;
  }
}

function parseYears(html) {
  const years = [];
  const selM = html.match(/<select[^>]*name="catalog"[^>]*>([\s\S]*?)<\/select>/i);
  if (!selM) return years;
  const optRe = /<option[^>]*value="(\d+)"[^>]*>(.*?)<\/option>/gi;
  let m;
  while ((m = optRe.exec(selM[1])) !== null) {
    const catoid = +m[1]; const raw = decode(m[2]);
    const typeM = raw.match(/(Undergraduate|Graduate)/i);
    const type = typeM ? typeM[1].toLowerCase() : 'undergraduate';
    const yearM = raw.match(/(\d{4}[-–]\d{4})/);
    const yearStr = yearM ? yearM[1] : raw.replace(/\s*(?:Undergraduate|Graduate)\s+Academic\s+Calendar.*/i,'').trim();
    const archived = /archived/i.test(raw);
    if (catoid && yearStr) years.push({ catoid, label: yearStr, type, archived });
  }
  return years;
}

function parseNavLinks(html) {
  const re = /href="(?:\/)?content\.php\?catoid=\d+(?:&amp;|&)navoid=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const links = []; let m;
  while ((m = re.exec(html)) !== null) { const text = decode(m[2]); if (text) links.push({ navoid: +m[1], text }); }
  return links;
}

function parseFaculties(html) {
  const re = /href="(?:\/)?preview_entity\.php\?catoid=\d+(?:&amp;|&)ent_oid=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set(); const out = []; let m;
  while ((m = re.exec(html)) !== null) {
    const entOid = +m[1]; const name = decode(m[2]);
    if (entOid && name && !seen.has(entOid)) { seen.add(entOid); out.push({ entOid, name }); }
  }
  return out;
}

function parsePrograms(html) {
  const re = /href="(?:\/)?preview_program\.php\?catoid=\d+(?:&amp;|&)poid=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set(); const out = []; let m;
  while ((m = re.exec(html)) !== null) {
    const poid = +m[1]; const name = decode(m[2]);
    if (poid && name && !seen.has(poid)) { seen.add(poid); out.push({ poid, name }); }
  }
  return out;
}

function parseCoursesFromPage(html, prefix) {
  const courses = []; const seen = new Set();
  const norm = html.replace(/&#8211;/g,'–').replace(/&ndash;/g,'–').replace(/&#8212;/g,'—').replace(/&mdash;/g,'—');
  function addRaw(raw) {
    const clean = raw.replace(/\s+opens\s+a\s+new\s+window\s*$/i,'').trim();
    const sep = clean.match(/[–\-—]/); if (!sep) return;
    const parts = clean.split(sep[0]);
    const code = parts[0].trim(); const name = parts.slice(1).join(sep[0]).trim();
    if (!code || !name) return;
    if (prefix && code.split(' ')[0] !== prefix) return;
    if (!seen.has(code)) { seen.add(code); courses.push({ code, name }); }
  }
  const re1 = /title="([A-Z]{2,8}\s+\d{4}\w*\s*[–\-—]\s*[^"]+)"/gi; let m;
  while ((m = re1.exec(norm)) !== null) addRaw(m[1]);
  const re2 = /aria-label="View course details for ([A-Z]{2,8}\s+\d{4}\w*\s*[–\-—]\s*[^"]+)"/gi;
  while ((m = re2.exec(norm)) !== null) addRaw(m[1]);
  return courses;
}

function getTotalPages(html) {
  const nums = [...html.matchAll(/filter(?:\[cpage\]|%5Bcpage%5D)=(\d+)/gi)].map(m => +m[1]);
  return nums.length ? Math.max(...nums) : 1;
}

async function main() {
  console.log('[scrape] Launching Chromium...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  try {
    // Homepage visit — Chromium solves WAF challenge, stores aws-waf-token cookie
    console.log('[scrape] Warming up (WAF challenge)...');
    const homeHtml = await browserGet(page, `${CAL}/`);
    console.log('[scrape] WAF cleared.');

    const years = parseYears(homeHtml);
    diskSet('years.json', years);
    console.log(`[scrape] ${years.length} catalogs → years.json`);

    const active = years.filter(y => !y.archived);
    console.log(`[scrape] Active: ${active.map(y => `${y.label}(${y.catoid})`).join(', ')}`);

    for (const { catoid } of active) {
      console.log(`\n[scrape] === catoid=${catoid} ===`);

      const indexHtml = await browserGet(page, `${CAL}/index.php?catoid=${catoid}`);
      const navLinks  = parseNavLinks(indexHtml);
      const byFacLink = navLinks.find(l => /programs?\s+\(?\s*by\s+faculty/i.test(l.text));
      const courseLink = navLinks.find(l => /course\s+description/i.test(l.text)) ||
                         navLinks.find(l => /^courses?$/i.test(l.text));

      // ── Faculties + programs + program parse ─────────────────────
      if (!byFacLink) {
        console.error(`[scrape] No "Programs by faculty" link for catoid=${catoid}`);
      } else {
        const facHtml   = await browserGet(page, `${CAL}/content.php?catoid=${catoid}&navoid=${byFacLink.navoid}`);
        const faculties = parseFaculties(facHtml);
        diskSet(`${catoid}/faculty-list.json`, faculties);
        console.log(`[scrape] ${faculties.length} faculties`);

        const allPoids = [];
        for (const fac of faculties) {
          try {
            const entHtml = await browserGet(page, `${CAL}/preview_entity.php?catoid=${catoid}&ent_oid=${fac.entOid}`);
            const progs   = parsePrograms(entHtml);
            diskSet(`${catoid}/programs-${fac.entOid}.json`, progs);
            console.log(`[scrape]   ${fac.name}: ${progs.length} programs`);
            for (const p of progs) allPoids.push(p.poid);
          } catch (e) {
            console.error(`[scrape]   ${fac.name} failed: ${e.message}`);
          }
        }

        console.log(`[scrape] Parsing ${allPoids.length} programs...`);
        let parsed = 0, pfailed = 0;
        for (const poid of allPoids) {
          try {
            const html = await browserGet(page, `${CAL}/preview_program.php?catoid=${catoid}&poid=${poid}`);
            const data = parseProgramFromHtml(html, catoid, poid);
            diskSet(`${catoid}/parse-program-${poid}.json`, data);
            parsed++;
            if (parsed % 10 === 0) process.stdout.write(`  ${parsed}/${allPoids.length} programs\r`);
          } catch (e) {
            pfailed++;
            console.error(`[scrape]   parse failed poid=${poid}: ${e.message}`);
          }
        }
        console.log(`[scrape] Programs: ${parsed} ok, ${pfailed} failed        `);
      }

      // ── Courses by prefix ──────────────────────────────────────────
      if (!courseLink) {
        console.error(`[scrape] No course descriptions link for catoid=${catoid}`); continue;
      }
      const navoid = courseLink.navoid;
      console.log(`[scrape] Fetching ${ALL_PREFIXES.length} course prefixes...`);

      let cfetched = 0, cfailed = 0;
      for (const prefix of ALL_PREFIXES) {
        try {
          const url1 = `${CAL}/content.php?catoid=${catoid}&navoid=${navoid}` +
                       `&filter%5Bkeyword%5D=&filter%5Bprefix%5D=${prefix}&filter%5Bcpage%5D=1`;
          const pg1   = await browserGet(page, url1);
          const total = getTotalPages(pg1);
          const allPages = [pg1];
          for (let p = 2; p <= total; p++) {
            allPages.push(await browserGet(page, url1.replace('cpage%5D=1', `cpage%5D=${p}`)));
          }
          const courses = []; const seen = new Set();
          for (const pg of allPages) {
            for (const c of parseCoursesFromPage(pg, prefix)) {
              if (!seen.has(c.code)) { seen.add(c.code); courses.push(c); }
            }
          }
          diskSet(`${catoid}/courses-${prefix}.json`, courses);
          cfetched++;
          if (cfetched % 10 === 0) process.stdout.write(`  ${cfetched}/${ALL_PREFIXES.length} prefixes\r`);
        } catch (e) {
          cfailed++;
          console.error(`[scrape]   courses failed prefix=${prefix}: ${e.message}`);
        }
      }
      console.log(`[scrape] Courses: ${cfetched} prefixes ok, ${cfailed} failed        `);
    }
  } finally {
    await browser.close();
  }

  console.log('\n[scrape] Done. Commit the cache/ directory to deploy the data.');
}

main().catch(e => { console.error('[scrape] Fatal:', e.message); process.exit(1); });
