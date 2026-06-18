'use strict';
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT = process.env.PORT || 3456;
const CAL  = 'https://calendar.ontariotechu.ca';

// ── In-memory cache (1 hour TTL) ─────────────────────────────────
const cache = new Map();
const TTL   = 60 * 60 * 1000;
function cacheGet(k) {
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() - e.ts > TTL) { cache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v) { cache.set(k, { v, ts: Date.now() }); }

// ── Fetch with redirect follow ────────────────────────────────────
function fetchURL(url, hops = 6) {
  const cached = cacheGet(url);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OntarioTechAdvisingTool/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      }
    }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && hops > 0) {
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location : CAL + res.headers.location;
        res.resume();
        return fetchURL(loc, hops - 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { const html = Buffer.concat(chunks).toString('utf8'); cacheSet(url, html); resolve(html); });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout: ' + url)); });
  });
}

// ── HTML helpers ──────────────────────────────────────────────────
function decode(s) {
  return s
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#160;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ').trim();
}

// ── Years ─────────────────────────────────────────────────────────
async function getYears() {
  const html = await fetchURL(`${CAL}/`);
  const years = [];
  const selM = html.match(/<select[^>]*name="catalog"[^>]*>([\s\S]*?)<\/select>/i);
  if (!selM) throw new Error('Could not find catalog year selector');
  const optRe = /<option[^>]*value="(\d+)"[^>]*>(.*?)<\/option>/gi;
  let m;
  while ((m = optRe.exec(selM[1])) !== null) {
    const catoid   = +m[1];
    const raw      = decode(m[2]);
    const typeM    = raw.match(/(Undergraduate|Graduate)/i);
    const type     = typeM ? typeM[1].toLowerCase() : 'undergraduate';
    const yearM    = raw.match(/(\d{4}[-–]\d{4})/);
    const yearStr  = yearM ? yearM[1] : raw.replace(/\s*(?:Undergraduate|Graduate)\s+Academic\s+Calendar.*/i,'').trim();
    const archived = /archived/i.test(raw);
    const label    = yearStr;
    if (catoid && yearStr) years.push({ catoid, label, type, archived });
  }
  return years;
}

// ── Navoid discovery ──────────────────────────────────────────────
const navoidMap = {};
async function getNavoid(catoid, type) {
  const key = `${catoid}:${type}`;
  if (navoidMap[key]) return navoidMap[key];
  const html = await fetchURL(`${CAL}/index.php?catoid=${catoid}`);
  const linkRe = /href="(?:\/)?content\.php\?catoid=\d+(?:&amp;|&)navoid=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const links = [];
  while ((m = linkRe.exec(html)) !== null) links.push({ navoid: +m[1], text: decode(m[2]) });

  let match;
  if (type === 'programs') {
    match = links.find(l => /programs?\s+\(?by\s+degree/i.test(l.text)) ||
            links.find(l => /\bprograms?\b/i.test(l.text));
  } else {
    match = links.find(l => /course\s+description/i.test(l.text)) ||
            links.find(l => /^courses?$/i.test(l.text)) ||
            links.find(l => /\bcourses?\b/i.test(l.text));
  }
  if (!match) throw new Error(`Cannot find ${type} navoid for catoid ${catoid}`);
  navoidMap[key] = match.navoid;
  return match.navoid;
}

// ── All nav links ────────────────────────────────────────────────
async function getNavLinks(catoid) {
  const html = await fetchURL(`${CAL}/index.php?catoid=${catoid}`);
  const linkRe = /href="(?:\/)?content\.php\?catoid=\d+(?:&amp;|&)navoid=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const links = [];
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const text = decode(m[2]);
    if (text) links.push({ navoid: +m[1], text });
  }
  return links;
}

// ── Faculty list from "Programs by faculty" page ─────────────────
async function getFacultyList(catoid) {
  const indexLinks = await getNavLinks(catoid);
  const byFacLink  = indexLinks.find(l => /programs?\s+\(?\s*by\s+faculty/i.test(l.text));
  if (!byFacLink) throw new Error('Cannot find "Programs by faculty" link for catoid ' + catoid);

  //const html = await fetchURL(`${CAL}/content.php?catoid=${catoid}&navoid=${byFacLink.navoid}`);
  
  const html = 'https://calendar.ontariotechu.ca/content.php?catoid=92&navoid=4147';
  
  
  // Faculties are listed as preview_entity.php links (ent_oid)
  const linkRe = /href="(?:\/)?preview_entity\.php\?catoid=\d+(?:&amp;|&)ent_oid=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const linkRe = 'https://calendar.ontariotechu.ca/preview_entity.php?catoid=92&ent_oid=2065';
  
  
  
  const faculties = [];
  const seen = new Set();
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const entOid = +m[1];
    const text   = decode(m[2]);
    if (entOid && text && !seen.has(entOid)) {
      seen.add(entOid);
      faculties.push({ entOid, name: text });
    }
  }
  return faculties;
}

// ── Programs for a faculty entity page ───────────────────────────
async function getProgramsForEntity(catoid, entOid) {
  const html = await fetchURL(`${CAL}/preview_entity.php?catoid=${catoid}&ent_oid=${entOid}`);
  const programs = [];
  const seen = new Set();
  const re = /<a\s[^>]*href="(?:\/)?preview_program\.php\?catoid=\d+(?:&amp;|&)poid=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const poid = +m[1];
    const name = decode(m[2]);
    if (poid && name && !seen.has(poid)) { seen.add(poid); programs.push({ poid, name }); }
  }
  return programs;
}


// ── Programs ──────────────────────────────────────────────────────
async function getPrograms(catoid, navoid) {
  if (!navoid) navoid = await getNavoid(catoid, 'programs');
  const html   = await fetchURL(`${CAL}/content.php?catoid=${catoid}&navoid=${navoid}`);
  const programs = [];
  let degree = '';
  const tokenRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>|<a\s[^>]*href="(?:\/)?preview_program\.php\?catoid=\d+(?:&amp;|&)poid=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = tokenRe.exec(html)) !== null) {
    if (m[1] !== undefined) { degree = decode(m[1]); }
    else if (m[2]) { const name = decode(m[3]); if (name) programs.push({ poid: +m[2], name, degree }); }
  }
  return programs;
}

// ── Course parsing helpers ────────────────────────────────────────
function parseCoursesFromPage(html, prefixes) {
  const courses = [];
  const seen = new Set();
  const normalized = html.replace(/&#8211;/g,'–').replace(/&ndash;/g,'–').replace(/&#8212;/g,'—').replace(/&mdash;/g,'—');

  function addRaw(raw) {
    const clean = raw.replace(/\s+opens\s+a\s+new\s+window\s*$/i,'').trim();
    const sep = clean.match(/[–\-—]/);
    if (!sep) return;
    const parts = clean.split(sep[0]);
    const code = parts[0].trim();
    const name = parts.slice(1).join(sep[0]).trim();
    if (!code || !name) return;
    const prefix = code.split(' ')[0];
    if (prefixes && prefixes.length > 0 && !prefixes.includes(prefix)) return;
    if (!seen.has(code)) { seen.add(code); courses.push({ code, name }); }
  }

  const re1 = /title="([A-Z]{2,8}\s+\d{4}\w*\s*[–\-—]\s*[^"]+)"/gi;
  let m;
  while ((m = re1.exec(normalized)) !== null) addRaw(m[1]);

  const re2 = /aria-label="View course details for ([A-Z]{2,8}\s+\d{4}\w*\s*[–\-—]\s*[^"]+)"/gi;
  while ((m = re2.exec(normalized)) !== null) addRaw(m[1]);

  return courses;
}

// ── Faculty → course prefix map ──────────────────────────────────
// Static map of course prefix → faculty abbreviation.
// Faculties: Sci, Eng, BIT, HSci, Ed, SSci, ALL
const PREFIX_FACULTY = {
  ALSU:'ALL', LEAP:'ALL', XBIT:'ALL',
  BIOL:'Sci',  CHEM:'Sci',  CSCI:'Sci',  ENVS:'Sci',  FSCI:'Sci',
  IMCS:'Sci',  MATH:'Sci',  NSCI:'Sci',  PHY:'Sci',   SCCO:'Sci',
  SCIE:'Sci',  STAT:'Sci',  SUST:'Sci',
  ARTE:'Eng',  AUTE:'Eng',  ELEE:'Eng',  ENEE:'Eng',  ENGR:'Eng',
  ENSY:'Eng',  ESNS:'Eng',  MANE:'Eng',  MECE:'Eng',  METE:'Eng',
  NUCL:'Eng',  SOFE:'Eng',
  BUSI:'BIT',  COMM:'BIT',  ECON:'BIT',  INFR:'BIT',  INSE:'BIT',
  HLSC:'HSci', KINE:'HSci', MLSC:'HSci', NURS:'HSci', RADI:'HSci', SIMU:'HSci',
  CURS:'Ed',   EDST:'Ed',   EDUC:'Ed',
  CRMN:'SSci', FPSY:'SSci', INDG:'SSci', LGLS:'SSci', POSC:'SSci',
  PSYC:'SSci', SOCI:'SSci', SSCI:'SSci',
};

// Return all prefixes belonging to a given faculty abbreviation
function prefixesForFaculty(fac) {
  return Object.entries(PREFIX_FACULTY)
    .filter(([,f]) => f === fac)
    .map(([p]) => p)
    .sort();
}

// Return all known prefixes
const ALL_PREFIXES = Object.keys(PREFIX_FACULTY).sort();

// ── Program page parser ───────────────────────────────────────────
const W2N = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10 };

// ── Elective type derivation ──────────────────────────────────────
// Year-list elective items carry their own descriptor text, e.g.
//   "Senior CS elective"  /  "CSCI 4000-level elective"  /  "Elective"
// We derive a stable camelCase key directly from that text — no hardcoded
// lookup table.  A plain "Elective" / "Electives" item returns null (untyped).

function textToElecKey(rawText) {
  // Strip footnote markers, parentheticals, and the generic word "elective(s)"
  const s = rawText
    .replace(/[*+†‡§]+/g, '')
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/\belectives?\b/gi, '')
    .replace(/\bcourses?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;   // was a plain "Elective" → goes into the untyped pool

  // Build a camelCase slug from the remaining words
  const words = s.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return words.map((w, i) =>
    i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join('');
}

// Clean up the original text for use as a human-readable label.
function textToElecLabel(rawText) {
  return rawText.replace(/[*+†‡§]+/g, '').replace(/\s+/g, ' ').trim();
}

function inferElecType(text) {
  return textToElecKey(text);
}

// Derive a course-filter rule from elective label/descriptor text.
// Returns null if no useful filter can be inferred.
// Rule shape: { prefixes?: string[], minLevel?: number, maxLevel?: number }
//
// Handles patterns like:
//   "CSCI courses at the 4000 level"      → {prefixes:['CSCI'], minLevel:4000, maxLevel:4999}
//   "CSCI 4000-level elective"            → same
//   "Senior Computer Science elective"    → {prefixes:['CSCI'], minLevel:3000}
//   "3000 or 4000 level CSCI"             → {prefixes:['CSCI'], minLevel:3000, maxLevel:4999}
//   "MATH elective"                       → {prefixes:['MATH']}
function inferFilterRule(text) {
  if (!text) return null;
  const low = text.toLowerCase();

  // ── Faculty-level patterns (use PREFIX_FACULTY map) ──────────────
  // "Science (Non-CS)" / "Faculty of Science that are not computer science" → Sci minus CSCI
  if (/science/i.test(text) && /non[- ]?(?:cs|computer)|not\s+computer|except\s+(?:cs|computer)/i.test(text)) {
    return { prefixes: prefixesForFaculty('Sci').filter(p => p !== 'CSCI') };
  }
  // "Non-Science" / "outside.*science" / "outside.*faculty" → everything except Sci
  if (/non[- ]?science|outside\s+(?:the\s+)?(?:faculty|science)/i.test(text)) {
    const sciSet = new Set(prefixesForFaculty('Sci'));
    return { prefixes: ALL_PREFIXES.filter(p => !sciSet.has(p)) };
  }
  // "Faculty of Science" / "science elective" → all Sci prefixes
  // But NOT "computer science elective" — that's a CS-specific type, not a faculty filter
  if (/faculty\s+of\s+science|\bscience\s+elective|\bin\s+science\b/i.test(text)
      && !/computer\s+science/i.test(text)) {
    return { prefixes: prefixesForFaculty('Sci') };
  }

  // ── Specific subject-code patterns ───────────────────────────────
  // Extract unique uppercase subject codes present in text, ignoring stop words
  const STOP = new Set(['CS','IT','OR','AND','THE','AT','IN','OF','ANY','FOR','NOT','NON','LEVEL']);
  const seen = new Set();
  const subjMatches = [...text.matchAll(/\b([A-Z]{2,8})\b/g)]
    .map(m => m[1])
    .filter(s => PREFIX_FACULTY[s] && !STOP.has(s) && !seen.has(s) && seen.add(s));

  // English phrase → prefix fallback (when no all-caps code found)
  const SUBJ_MAP = {
    'computer science':'CSCI', 'mathematics':'MATH', 'statistics':'STAT',
    'biology':'BIOL',          'chemistry':'CHEM',   'physics':'PHY',
    'communications':'COMM',   'communication':'COMM','business':'BUSI',
    'networking':'INFR',       'software':'SOFE',
  };
  let prefixes = subjMatches.length > 0 ? subjMatches : null;
  if (!prefixes) {
    for (const [phrase, code] of Object.entries(SUBJ_MAP)) {
      if (low.includes(phrase)) { prefixes = [code]; break; }
    }
  }

  // ── Level range ───────────────────────────────────────────────────
  const levels = [...text.matchAll(/\b(\d{4})\b/g)]
    .map(m => +m[1]).filter(n => n >= 1000 && n <= 9000);

  let minLevel = null, maxLevel = null;
  if (levels.length >= 2) {
    minLevel = Math.min(...levels);
    maxLevel = Math.max(...levels) + 999;
  } else if (levels.length === 1) {
    minLevel = levels[0];
    maxLevel = levels[0] + 999;
  }

  // "senior" / "upper-year" implies 3000+
  if (!minLevel && /\bsenior\b|\bupper[- ]?year\b|\bupper[- ]?level\b/i.test(text)) {
    minLevel = 3000;
  }

  if (!prefixes && !minLevel) return null;
  const rule = {};
  if (prefixes) rule.prefixes = prefixes;
  if (minLevel) rule.minLevel = minLevel;
  if (maxLevel) rule.maxLevel = maxLevel;
  return rule;
}

// Parse footnote/definition lines from a program page section.
// Looks for patterns like:
//   "* Senior CS elective: any CSCI course at the 3000 or 4000 level"
//   "† Science elective = a course offered by the Faculty of Science"
// Returns { key → filterRule } — only for lines that give a clear filter.
function parseFootnoteDefinitions(sectionHtml) {
  const rules = {};
  // Lines starting with a footnote marker followed by a definition (colon or =)
  const decoded = decode(sectionHtml);
  const defRe = /[*†‡§+]\s*([^:=\n]{3,60})\s*[:=]\s*([^\n]{5,200})/g;
  let m;
  while ((m = defRe.exec(decoded)) !== null) {
    const subjectText = m[1].trim();
    const definitionText = m[2].trim();
    const key = textToElecKey(subjectText);
    if (!key) continue;
    const rule = inferFilterRule(definitionText) || inferFilterRule(subjectText);
    if (rule) rules[key] = rule;
  }
  return rules;
}

function parseCourseFromContent(content) {
  const m = content.match(/aria-label="View course details for ([^"]+)"/i);
  if (!m) return null;
  const raw = m[1].replace(/\s+opens\s+a\s+new\s+window\s*$/i,'').trim();
  const sep = raw.match(/[–\-—]/);
  if (!sep) return null;
  const parts = raw.split(sep[0]);
  return { code: parts[0].trim(), name: parts.slice(1).join(sep[0]).trim() };
}

// Collect option-group items starting at liItems[start].
// greedy=true  → used for explicit "N of:" groups: take ALL consecutive course items,
//                no "or" connector required (the marker already tells us they're choices).
// greedy=false → used for implicit "or" groups: stop when no "or" connector found.
// Returns array with extra ._consumed so caller can advance i.
function collectOptions(liItems, start, greedy) {
  const options = [];
  let i = start;
  while (i < liItems.length) {
    const li = liItems[i];
    if (li.cls.includes('acalog-course')) {
      const c = parseCourseFromContent(li.content);
      if (c) options.push(c);
      i++;
      if (greedy) continue; // take everything — the N-of header already scoped this
      const hasInlineOr = /<strong>\s*or\s*<\/strong>/i.test(li.content);
      if (!hasInlineOr) {
        if (i < liItems.length && isOrSeparator(liItems[i])) { i++; continue; }
        break;
      }
      continue;
    }
    if (isOrSeparator(li)) { i++; continue; }
    if (li.cls.includes('acalog-adhoc-list-item') && li.cls.includes('acalog-adhoc-after')) {
      const t = decode(li.content).replace(/[*+]+$/,'').trim();
      if (t.length < 80) { options.push({ text: t }); i++; }
      break;
    }
    break;
  }
  options._consumed = i - start;
  return options;
}
function isOrSeparator(li) {
  if (li.cls.includes('acalog-course')) return false;
  if (li.cls.includes('acalog-adhoc-list-item')) return false;
  return /^\s*or\s*$/i.test(decode(li.content));
}

function parseYearUl(ulHtml, yearNum, requirements, mkId) {
  // Extract all <li> elements with their class and content
  const liRe = /<li(?:\s+class="([^"]*)")?[^>]*>([\s\S]*?)<\/li>/gi;
  const liItems = [];
  let m;
  while ((m = liRe.exec(ulHtml)) !== null) {
    // Strip nested <ul>...</ul> from li content so nested lists don't confuse parsing
    const content = m[2].replace(/<ul[\s\S]*?<\/ul>/gi, '');
    liItems.push({ cls: m[1] || '', content });
  }

  let i = 0;
  while (i < liItems.length) {
    const { cls, content } = liItems[i];
    const isCourse      = cls.includes('acalog-course');
    const isListItem    = cls.includes('acalog-adhoc-list-item');
    const isNote        = cls.includes('acalog-adhoc') && !isListItem;
    const isAfter       = cls.includes('acalog-adhoc-after');
    const textRaw       = decode(content);

    // Skip long footnote notes (>120 chars, not an N-of marker)
    const nOfMatch = isNote ? content.match(/<p>\s*(one|two|three|four|five|six)\s+of:\s*<\/p>/i) : null;
    if (isNote && !nOfMatch && textRaw.length > 120) { i++; continue; }

    // ── "N of:" option group (handles One of:, Two of:, Three of:, …) ──
    if (nOfMatch) {
      const groupCount = W2N[nOfMatch[1].toLowerCase()] || 1;
      i++;
      const options = collectOptions(liItems, i, true); // greedy: take all consecutive courses
      i += options._consumed; delete options._consumed;
      if (options.length > 0) {
        for (let gc = 0; gc < groupCount; gc++) {
          const label = groupCount > 1 ? `One of (${gc + 1}/${groupCount})` : 'One of';
          requirements.push({ id: mkId(), type: 'option', year: yearNum, label, options: [...options] });
        }
      }
      continue;
    }

    // ── Course item with implicit "or" (no preceding "One of:") ──
    if (isCourse && /<strong>\s*or\s*<\/strong>/i.test(content)) {
      const options = collectOptions(liItems, i, false);
      i += options._consumed; delete options._consumed;
      if (options.length > 0)
        requirements.push({ id: mkId(), type: 'option', year: yearNum, label: 'One of', options });
      continue;
    }

    // ── Regular required course ───────────────────────────────────
    if (isCourse) {
      const c = parseCourseFromContent(content);
      if (c) requirements.push({ id: mkId(), type: 'course', year: yearNum, ...c });
      i++; continue;
    }

    // ── acalog-adhoc-before: only parse if it looks like "N elective(s)" ───
    // e.g. <li class="acalog-adhoc acalog-adhoc-before"><p>*Two electives</p></li>
    if (!isListItem && cls.includes('acalog-adhoc-before') && textRaw.length < 120) {
      const t = textRaw.replace(/^[*+†‡§\s]+/, '').replace(/[*+†‡§\s]+$/, '').trim();
      const firstWord = (t.split(/\s+/)[0] || '').toLowerCase();
      const count = W2N[firstWord];
      if (count) {
        const descriptor = t.replace(new RegExp(`^${firstWord}\\s+`, 'i'), '').trim();
        if (/elective|course/i.test(descriptor)) {
          const elecType   = inferElecType(descriptor);
          const label      = textToElecLabel(descriptor) || 'Elective';
          const filterRule = inferFilterRule(descriptor);
          for (let k = 0; k < count; k++) {
            const card = { id: mkId(), type: 'elective', year: yearNum, elecType, label };
            if (filterRule) card.filterRule = filterRule;
            requirements.push(card);
          }
          i++; continue;
        }
      }
    }

    // ── Adhoc list items: electives and typed elective descriptors ───
    if (isListItem && textRaw.length < 120) {
      const t = textRaw.replace(/^[*+†‡§]+/, '').replace(/[*+†‡§]+$/, '').trim();
      const firstWord = (t.split(/\s+/)[0] || '').toLowerCase();
      const count = W2N[firstWord] || 1;
      // Strip leading count-word to get the bare descriptor ("Senior CS elective")
      const descriptor = (count > 1 || W2N[firstWord])
        ? t.replace(new RegExp(`^${firstWord}\\s+`, 'i'), '').trim()
        : t;

      // Derive type key and human label purely from the descriptor text —
      // no hardcoded category names.
      const elecType   = inferElecType(descriptor); // null → plain untyped elective
      const label      = textToElecLabel(descriptor) || 'Elective';
      const filterRule = inferFilterRule(descriptor);

      for (let k = 0; k < count; k++) {
        const card = { id: mkId(), type: 'elective', year: yearNum, elecType, label };
        if (filterRule) card.filterRule = filterRule;
        requirements.push(card);
      }
      i++; continue;
    }

    i++;
  }
}
// Same block for acalog-adhoc-before items — handled inline above, but
// filterRule is set the same way via the shared inferFilterRule call.

// Word-to-number map for written-out numbers in requirement text
const WORD_NUMS = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
                   ten:10,eleven:11,twelve:12,fifteen:15,eighteen:18,twenty:20,
                   'twenty-four':24,'twenty-one':21};

function normaliseWordNums(text) {
  return text.replace(
    /\b(twenty-four|twenty-one|twenty|eighteen|fifteen|twelve|eleven|ten|nine|eight|seven|six|five|four|three|two|one)\b/gi,
    m => WORD_NUMS[m.toLowerCase()] || m
  );
}

// Parse elective credit-hour requirements from a section of HTML.
// Returns { restrictions: {key: courseCount}, subsets: {childKey: parentKey} }
//
// Design notes:
//  - Extract <li> items individually so list-formatted requirements don't run together
//    after tag-stripping (they often have no trailing period).
//  - Use the FULL preceding text for sub-requirement detection ("among which…") but
//    only a NARROW window (±20 chars) around the credit-hours match for CATEGORY
//    detection, to prevent a prior clause's category from shadowing the current one.
//  - Sub-requirements net against their parent so the parent shows only the residual
//    (e.g. nonscience:4, business:1, comm:1 → nonscience:2, business:1, comm:1).
function parseElectiveRestrictions(sectionHtml) {
  const restrictions = {};
  const subsets      = {};

  // ── Step 1: collect candidate sentences ───────────────────────────────────────
  // Prefer per-<li> extraction; fall back to whole-section decode.
  const sentences = [];

  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let lm;
  const liChunks = [];
  while ((lm = liRe.exec(sectionHtml)) !== null) liChunks.push(lm[1]);

  if (liChunks.length > 0) {
    // Each <li> is one logical sentence; also grab paragraph text outside the list
    for (const chunk of liChunks) {
      const t = normaliseWordNums(decode(chunk));
      for (const s of t.split(/[.;]\s*/)) { const st = s.trim(); if (st) sentences.push(st); }
    }
    const noLi = sectionHtml.replace(/<li[^>]*>[\s\S]*?<\/li>/gi, '');
    const pt   = normaliseWordNums(decode(noLi));
    for (const s of pt.split(/[.;]\s*/)) { const st = s.trim(); if (st) sentences.push(st); }
  } else {
    const t = normaliseWordNums(decode(sectionHtml));
    for (const s of t.split(/[.;]\s*/)) { const st = s.trim(); if (st) sentences.push(st); }
  }

  // ── Step 2: scan each sentence for credit-hour mentions ───────────────────────
  const crRe = /(\d+)\s+(?:\w+\s+)?credit\s+hours?/gi;

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;
    // Skip sentences that state a total degree credit requirement
    if (/\b(complete|earn)\b.{0,80}\b(to\s+graduate|for\s+the\s+degree|in\s+total|graduation\s+requirement)/i.test(sentence)) continue;

    crRe.lastIndex = 0;
    let cm;
    while ((cm = crRe.exec(sentence)) !== null) {
      const n = +cm[1];
      if (n === 0) continue;
      const courses = Math.round(n / 3);

      // Full preceding text: used only for "isSub" detection
      const precedingFull = sentence.slice(0, cm.index);
      const isSub = /\bamong\s+which\b|\bof\s+which\b|\bof\s+these\b|\bincluding\b/i.test(precedingFull);

      // NARROW context for category: 20 chars before + 100 chars after the match.
      // Strip parentheticals first — qualifiers like "(offered by the Faculty of Science
      // or outside the Faculty of Science)" describe WHERE, not WHAT the elective is,
      // and would otherwise trigger the wrong category pattern.
      const nearBefore = sentence.slice(Math.max(0, cm.index - 20), cm.index);
      const afterText  = sentence.slice(cm.index + cm[0].length, cm.index + cm[0].length + 100);
      const ctx = (nearBefore + ' ' + afterText).replace(/\([^)]*\)/g, ' ');

      // Category matching — most specific first.
      // 'general' precedes 'nonscience'/'science': "general elective (offered by Faculty of
      // Science or outside)" contains both signals; the word "general" is definitive.
      // Program-specific typed electives (e.g. "Senior CS elective") are handled by
      // inferElecType in the year-list parser, not here.
      let key = null, parentKey = null;

      if (/non[- ]?computer\s+science.*science|science.*non[- ]?computer/i.test(ctx))
        key = 'scienceNonCS';
      else if (/\bbiology\b|\bbiochemist/i.test(ctx))
        { key = 'biology';    parentKey = 'science'; }
      else if (/\bchemistry\b/i.test(ctx))
        { key = 'chemistry';  parentKey = 'science'; }
      else if (/\bphysics\b/i.test(ctx))
        { key = 'physics';    parentKey = 'science'; }
      else if (/\bmath(?:ematics)?\b|\bcalculus\b|\blinear\s+algebra\b/i.test(ctx))
        { key = 'mathematics'; parentKey = 'science'; }
      else if (/\bstatistics\b/i.test(ctx))
        { key = 'statistics'; parentKey = 'science'; }
      else if (/\bgeneral\s+elective|\bgeneral\b/i.test(ctx))
        key = 'general';
      else if (/non[- ]?science|outside\s+(the\s+)?faculty|outside\s+(the\s+)?science/i.test(ctx))
        key = 'nonscience';
      else if (/faculty\s+of\s+science|science\s+elective|\bin\s+science\b/i.test(ctx))
        key = 'science';
      else if (/\bbusiness\b/i.test(ctx))
        { key = 'business'; if (isSub) parentKey = 'nonscience'; }
      else if (/\bcommunicat/i.test(ctx))
        { key = 'comm';     if (isSub) parentKey = 'nonscience'; }

      if (!key) continue;
      restrictions[key] = Math.max(restrictions[key] || 0, courses);
      if (parentKey) subsets[key] = parentKey;
    }
  }

  // ── Step 3: net sub-requirements out of their parent ──────────────────────────
  // e.g. nonscience:4, business:1(⊂nonscience), comm:1(⊂nonscience) → nonscience:2
  for (const [child, parent] of Object.entries(subsets)) {
    if (restrictions[child] != null && restrictions[parent] != null) {
      restrictions[parent] = Math.max(0, restrictions[parent] - restrictions[child]);
      if (restrictions[parent] === 0) delete restrictions[parent];
    }
  }

  // Build human labels for each detected key.
  // These are the names shown in the elective bar for prose-restriction categories.
  const PROSE_LABELS = {
    scienceNonCS: 'Science (Non-CS)', science: 'Science',
    nonscience: 'Non-Science',        business: 'Business',
    comm: 'Communications',           general: 'General',
    biology: 'Biology',               chemistry: 'Chemistry',
    physics: 'Physics',               mathematics: 'Mathematics',
    statistics: 'Statistics',
  };
  const labels = {};
  for (const key of Object.keys(restrictions)) {
    labels[key] = PROSE_LABELS[key] || key; // fallback: use key as label
  }

  return { restrictions, subsets, labels };
}

async function parseProgramPage(catoid, poid) {
  const cacheKey = `parse:${catoid}:${poid}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const html = await fetchURL(`${CAL}/preview_program.php?catoid=${catoid}&poid=${poid}`);
  const norm = html
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/&#160;|&nbsp;/g, ' ');

  let nextId = 1;
  const mkId = () => `r${nextId++}`;

  const requirements = [];
  let elecRestrictions = {};
  let elecSubsets = {};
  let elecLabels = {};        // key → human-readable label, sent to client
  let restrictedElectives = {};
  let elecFilterRules = {};   // key → {prefixes?,minLevel?,maxLevel?}

  // Split into acalog-core sections
  const sectionRe = /<div[^>]*class="[^"]*acalog-core[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*acalog-core|$)/gi;
  let sm;
  const sections = [];
  while ((sm = sectionRe.exec(norm)) !== null) sections.push(sm[1]);

  let foundYearSections = false;

  for (const section of sections) {
    // ── Year requirement section ───────────────────────────────
    const yearMatch = section.match(/<h[23][^>]*>[\s\S]*?Year\s+(\d)\b[^<]*/i);
    if (yearMatch) {
      foundYearSections = true;
      const yearNum = +yearMatch[1];
      // Pass section HTML directly; parseYearUl handles nested <ul> stripping per-li
parseYearUl(section, yearNum, requirements, mkId);
      continue;
    }

    // ── Generic program requirement section (non-year) ─────────
    // Used as fallback for programs that don't have Year N headings
    const h2Text = decode((section.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i) || [])[1] || '');
    const isProgramDetails = /program\s+(details?|requirements?|map|outline)|degree\s+requirements?/i.test(h2Text);
    if (!foundYearSections && isProgramDetails) {
      parseYearUl(section, 0, requirements, mkId); // year 0 = unspecified
      continue;
    }

    // ── Elective restriction prose ─────────────────────────────
    // Parse from ANY non-year section that mentions credit hours.
    // Don't restrict to specific headings — programs use varied section names.
    if (/\d+\s+credit\s+hours?/i.test(section)) {
      const { restrictions: r, subsets: s, labels: l } = parseElectiveRestrictions(section);
      for (const [k, v] of Object.entries(r))
        elecRestrictions[k] = Math.max(elecRestrictions[k] || 0, v);
      Object.assign(elecSubsets, s);
      // Labels from prose restrictions (only set if not already set from a year-list card)
      for (const [k, lbl] of Object.entries(l)) {
        if (!elecLabels[k]) elecLabels[k] = lbl;
      }
    }

    // ── Named restricted elective lists (course codes) ────────
    // Detect sections that are elective definition lists (have a heading with "elective(s)")
    // and extract the courses, keyed by the elective type derived from the heading.
    const secHeading = decode((section.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i)||[])[1]||'');
    if (/elective/i.test(secHeading)) {
      let key = textToElecKey(secHeading);
      if (key) {
        // Prefer an existing restriction/label key if this heading maps to the same thing
        // e.g. "Communication electives" → "communication" should resolve to "comm"
        const allKnown = new Set([...Object.keys(elecRestrictions), ...Object.keys(elecLabels)]);
        for (const k of allKnown) {
          if (k === key) break;
          if (key.startsWith(k) || k.startsWith(key)) { key = k; break; }
        }
        const listed = parseCoursesFromPage(section, null);
        if (listed.length) restrictedElectives[key] = listed;
      }
    }

    // ── Footnote definitions → filter rules ───────────────────
    const footRules = parseFootnoteDefinitions(section);
    for (const [k, rule] of Object.entries(footRules)) {
      if (!elecFilterRules[k]) elecFilterRules[k] = rule;
    }
  }

  // ── Fallback: if still no requirements, scrape ALL course links from the page ──
  if (requirements.length === 0) {
    console.log(`[parse-program] No year sections found for catoid=${catoid} poid=${poid}, using full-page fallback`);
    const allCourses = parseCoursesFromPage(norm, null);
    const seen = new Set();
    for (const c of allCourses) {
      if (!seen.has(c.code)) {
        seen.add(c.code);
        requirements.push({ id: mkId(), type: 'course', year: 0, ...c });
      }
    }
  }

  // Collect labels and filter rules from year-list typed elective cards.
  for (const req of requirements) {
    if (req.type === 'elective' && req.elecType) {
      if (req.label && !elecLabels[req.elecType]) elecLabels[req.elecType] = req.label;
      // Card-level filterRule takes precedence over footnote-derived rules
      if (req.filterRule && !elecFilterRules[req.elecType])
        elecFilterRules[req.elecType] = req.filterRule;
    }
  }

  // Also infer filter rules from the elective type key/label for types that have
  // restriction counts but no explicit card or footnote rule (e.g. prose-only types).
  for (const key of Object.keys(elecRestrictions)) {
    if (!elecFilterRules[key]) {
      const label = elecLabels[key] || key;
      const rule  = inferFilterRule(label) || inferFilterRule(key);
      if (rule) elecFilterRules[key] = rule;
    }
  }

  // ── Sanity check ────────────────────────────────────────────────────────────────
  // The year list provides typed cards (with elecType) and untyped "Elective" cards.
  // The prose provides per-category slot counts.
  // A year-list type can overlap with a prose restriction (e.g. "Two general electives"
  // in the year list + "9 credit hours general" in prose both describe the same pool).
  // We account for each type as max(typed-card-count, prose-restriction-count) to avoid
  // double-counting while still capturing the full picture.
  const elecCardCount = requirements.filter(r => r.type === 'elective').length;
  const typedCounts   = {};
  for (const req of requirements) {
    if (req.type === 'elective' && req.elecType)
      typedCounts[req.elecType] = (typedCounts[req.elecType] || 0) + 1;
  }
  const allKeys = new Set([...Object.keys(typedCounts), ...Object.keys(elecRestrictions)]);
  let totalAccountedSlots = 0;
  for (const k of allKeys)
    totalAccountedSlots += Math.max(typedCounts[k] || 0, elecRestrictions[k] || 0);

  const elecRestrictionSum = Object.values(elecRestrictions).reduce((s, v) => s + v, 0);
  // Over-accounting (accounted > cards): acceptable — specialization prose is inherited from
  // the parent program and describes more generic slots than the specialization year list
  // actually provides (some generic slots are replaced by typed specialization requirements).
  // Under-accounting (accounted < cards): real problem — some elective cards have no
  // restriction/type description, so the bar won't account for them.
  const elecSanityOk = totalAccountedSlots >= elecCardCount;
  if (!elecSanityOk) {
    console.warn(`[parse-program] Sanity under-count catoid=${catoid} poid=${poid}: ` +
      `accounted=${totalAccountedSlots} < elecCardCount=${elecCardCount}. ` +
      `typed=${JSON.stringify(typedCounts)} restrictions=${JSON.stringify(elecRestrictions)}`);
  }

  const result = {
    programUrl: `${CAL}/preview_program.php?catoid=${catoid}&poid=${poid}`,
    requirements,
    elecRestrictions,
    elecSubsets,
    elecLabels,
    elecFilterRules,
    restrictedElectives,
    elecSanityOk,
    elecCardCount,
    elecRestrictionSum,
  };

  cacheSet(cacheKey, result);
  return result;
}

// ── Courses (for elective dropdowns) ─────────────────────────────
function getTotalPages(html) {
  const nums = [...html.matchAll(/filter(?:\[cpage\]|%5Bcpage%5D)=(\d+)/gi)].map(m => +m[1]);
  return nums.length ? Math.max(...nums) : 1;
}

// Fetch all courses for a single prefix using the catalog's built-in prefix filter.
// Each prefix has at most a handful of pages so no cap needed.
async function getCoursesForPrefix(catoid, navoid, prefix) {
  const cacheKey = `pfx:${catoid}:${prefix}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const pageUrl = n =>
    `${CAL}/content.php?catoid=${catoid}&navoid=${navoid}` +
    `&filter%5Bkeyword%5D=&filter%5Bprefix%5D=${prefix}&filter%5Bcpage%5D=${n}`;

  const firstHtml = await fetchURL(pageUrl(1));
  const total = getTotalPages(firstHtml);

  const pages = total > 1
    ? await Promise.all(Array.from({ length: total }, (_, i) => fetchURL(pageUrl(i + 1))))
    : [firstHtml];

  const courses = [];
  const seen = new Set();
  for (const pg of pages) {
    for (const c of parseCoursesFromPage(pg, [prefix])) {
      if (!seen.has(c.code)) { seen.add(c.code); courses.push(c); }
    }
  }
  cacheSet(cacheKey, courses);
  return courses;
}

async function getCourses(catoid, prefixes) {
  const cacheKey = `courses:${catoid}:${(prefixes||[]).sort().join(',')}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const navoid = await getNavoid(catoid, 'courses');

  // If specific prefixes requested, fetch each one via the prefix filter (fast, complete).
  // Otherwise fall back to the full alphabetical listing (capped at 50 pages).
  let courses;
  if (prefixes && prefixes.length > 0) {
    const CHUNK = 6; // fetch up to 6 prefixes in parallel
    const all = [];
    const seen = new Set();
    for (let i = 0; i < prefixes.length; i += CHUNK) {
      const chunk = prefixes.slice(i, i + CHUNK);
      const results = await Promise.all(chunk.map(p => getCoursesForPrefix(catoid, navoid, p)));
      for (const list of results) {
        for (const c of list) {
          if (!seen.has(c.code)) { seen.add(c.code); all.push(c); }
        }
      }
    }
    courses = all.sort((a, b) => a.code.localeCompare(b.code));
  } else {
    const pageUrl = n => `${CAL}/content.php?catoid=${catoid}&navoid=${navoid}&filter%5Bcpage%5D=${n}`;
    const firstHtml = await fetchURL(pageUrl(1));
    const total = getTotalPages(firstHtml);
    const pages = await Promise.all(
      Array.from({ length: Math.min(total, 50) }, (_, i) => fetchURL(pageUrl(i + 1)))
    );
    const seen = new Set();
    courses = [];
    for (const pg of pages) {
      for (const c of parseCoursesFromPage(pg, null)) {
        if (!seen.has(c.code)) { seen.add(c.code); courses.push(c); }
      }
    }
  }

  cacheSet(cacheKey, courses);
  return courses;
}

// ── HTTP server ───────────────────────────────────────────────────
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };

function jsonRes(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(data));
}
function errRes(res, msg, status = 500) {
  console.error('[API]', msg);
  jsonRes(res, { error: String(msg) }, status);
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`); // base only used for relative URL parsing
  const { pathname, searchParams } = parsed;

  if (pathname.startsWith('/api/')) {
    try {
      if (pathname === '/api/years') {
        return jsonRes(res, await getYears());
      }
      if (pathname === '/api/nav-links') {
        const catoid = +searchParams.get('catoid');
        if (!catoid) return errRes(res, 'Missing catoid', 400);
        return jsonRes(res, await getNavLinks(catoid));
      }
      if (pathname === '/api/faculty-list') {
        const catoid = +searchParams.get('catoid');
        if (!catoid) return errRes(res, 'Missing catoid', 400);
        return jsonRes(res, await getFacultyList(catoid));
      }
      if (pathname === '/api/programs-for-entity') {
        const catoid = +searchParams.get('catoid');
        const entOid = +searchParams.get('entOid');
        if (!catoid || !entOid) return errRes(res, 'Missing catoid or entOid', 400);
        return jsonRes(res, await getProgramsForEntity(catoid, entOid));
      }
      if (pathname === '/api/debug-faculty-page') {
        const catoid = +searchParams.get('catoid');
        if (!catoid) return errRes(res, 'Missing catoid', 400);
        const indexLinks = await getNavLinks(catoid);
        const byFacLink = indexLinks.find(l => /programs?\s+\(?\s*by\s+faculty/i.test(l.text));
        if (!byFacLink) return errRes(res, 'No by-faculty link found');
        const html = await fetchURL(`${CAL}/content.php?catoid=${catoid}&navoid=${byFacLink.navoid}`);
        // Extract all hrefs
        const hrefs = [];
        const re = /href="([^"]+)"/gi; let m;
        while ((m = re.exec(html)) !== null) hrefs.push(m[1]);
        return jsonRes(res, { navoid: byFacLink.navoid, hrefs: [...new Set(hrefs)] });
      }
      if (pathname === '/api/programs') {
        const catoid = +searchParams.get('catoid');
        const navoid = +searchParams.get('navoid') || null;
        if (!catoid) return errRes(res, 'Missing catoid', 400);
        return jsonRes(res, await getPrograms(catoid, navoid));
      }
      if (pathname === '/api/parse-program') {
        const catoid = +searchParams.get('catoid');
        const poid   = +searchParams.get('poid');
        if (!catoid || !poid) return errRes(res, 'Missing catoid or poid', 400);
        return jsonRes(res, await parseProgramPage(catoid, poid));
      }

      if (pathname === '/api/mapping') {
        const catoid = +searchParams.get('catoid');
        const poid   = +searchParams.get('poid');
        if (!catoid || !poid) return errRes(res, 'Missing catoid or poid', 400);
        const fp = path.join(__dirname, 'mappings', `${catoid}-${poid}.json`);
        if (!fs.existsSync(fp)) return errRes(res, 'No mapping found', 404);
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
        return jsonRes(res, data);
      }

      if (pathname === '/api/courses') {
        const catoid   = +searchParams.get('catoid');
        const prefixes = (searchParams.get('prefixes')||'').split(',').map(s=>s.trim()).filter(Boolean);
        const minLevel = searchParams.get('minLevel') ? +searchParams.get('minLevel') : null;
        const maxLevel = searchParams.get('maxLevel') ? +searchParams.get('maxLevel') : null;
        if (!catoid) return errRes(res, 'Missing catoid', 400);
        let courses = await getCourses(catoid, prefixes.length ? prefixes : null);
        // Level filtering: course code is like "CSCI 4020U" — extract numeric level
        if (minLevel || maxLevel) {
          courses = courses.filter(c => {
            const lvl = parseInt((c.code.match(/(\d{4})/)||[])[1]);
            if (isNaN(lvl)) return false;
            if (minLevel && lvl < minLevel) return false;
            if (maxLevel && lvl > maxLevel) return false;
            return true;
          });
        }
        return jsonRes(res, courses);
      }
      errRes(res, 'Not found', 404);
    } catch (e) { errRes(res, e.message); }
    return;
  }

  // Static files
  let fp = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  const ext = path.extname(fp);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

server.listen(PORT, () => console.log(`Advising tool → http://localhost:${PORT}`));
