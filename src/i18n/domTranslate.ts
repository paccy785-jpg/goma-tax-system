/**
 * DOM-level translator behind the EN / FR toggle.
 *
 * The app's components render a mix of English labels and French domain text.
 * Rather than rewrite every component, this module watches the rendered page
 * and swaps each text node (and placeholder / title / aria-label attribute):
 *
 *  - FR: English text → French (the `FR` dictionary); French text stays.
 *  - EN: French text → English (the `EN` dictionary, see enTranslate.ts);
 *        English text stays.
 *
 * The text React rendered is remembered per node, so switching language never
 * compounds translations and always starts again from the source text.
 */
import { FR } from './fr';
import { translateToEn } from './enTranslate';

export type Lang = 'en' | 'fr';

const ATTRS = ['placeholder', 'title', 'aria-label', 'label'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE']);

/** English original of every text node we have seen. */
const origText = new WeakMap<Text, string>();
/** The last value this module wrote into a text node. */
const lastText = new WeakMap<Text, string>();
/** English originals / last written values for translated attributes. */
const origAttr = new WeakMap<Element, Map<string, string>>();
const lastAttr = new WeakMap<Element, Map<string, string>>();

let current: Lang = 'en';
let observer: MutationObserver | null = null;

/* ------------------------------------------------------------------ */
/* String translation                                                  */
/* ------------------------------------------------------------------ */

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const MONTHS: Record<string, string> = {
  January: 'janvier', February: 'février', March: 'mars', April: 'avril', May: 'mai', June: 'juin',
  July: 'juillet', August: 'août', September: 'septembre', October: 'octobre', November: 'novembre', December: 'décembre',
};
const MONTHS_SHORT: Record<string, string> = {
  Jan: 'janv.', Feb: 'févr.', Mar: 'mars', Apr: 'avr.', May: 'mai', Jun: 'juin', Jul: 'juil.',
  Aug: 'août', Sep: 'sept.', Sept: 'sept.', Oct: 'oct.', Nov: 'nov.', Dec: 'déc.',
};
const WEEKDAYS: Record<string, string> = {
  Monday: 'lundi', Tuesday: 'mardi', Wednesday: 'mercredi', Thursday: 'jeudi', Friday: 'vendredi', Saturday: 'samedi', Sunday: 'dimanche',
};
const WEEKDAYS_SHORT: Record<string, string> = {
  Mon: 'lun.', Tue: 'mar.', Wed: 'mer.', Thu: 'jeu.', Fri: 'ven.', Sat: 'sam.', Sun: 'dim.',
};
const LONG_M = Object.keys(MONTHS).join('|');
const SHORT_M = Object.keys(MONTHS_SHORT).join('|');
const LONG_D = Object.keys(WEEKDAYS).join('|');
const SHORT_D = Object.keys(WEEKDAYS_SHORT).join('|');

/** Converts English-formatted dates (as produced by toLocaleDateString('en-US')) to French. */
function translateDates(s: string): string {
  return s
    // 11/6/2026 → 6/11/2026 — the numeric form toLocaleDateString('en-US')
    // actually produces. In French the day comes first, and "11/6/2026" read
    // the French way is 11 June, not 6 November.
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_m, mo, day, y) => `${day}/${mo}/${y}`)
    // 9:30:00 PM → 21:30:00 — the office runs on a 24-hour clock, and a
    // receipt reading "09:30 PM" is not a French time.
    .replace(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)\b/gi,
      (_m, h: string, min: string, sec: string | undefined, ampm: string) => {
        const hours = Number(h) % 12 + (/pm/i.test(ampm) ? 12 : 0);
        const hh = String(hours).padStart(2, '0');
        return sec ? `${hh}:${min}:${sec}` : `${hh}:${min}`;
      })
    // Monday, October 26, 2026 → lundi 26 octobre 2026
    .replace(new RegExp(`\\b(${LONG_D}),\\s+(${LONG_M})\\s+(\\d{1,2}),\\s+(\\d{4})\\b`, 'g'),
      (_m, d, mo, day, y) => `${WEEKDAYS[d]} ${day === '1' ? '1er' : day} ${MONTHS[mo]} ${y}`)
    // Mon, Oct 26, 2026 → lun. 26 oct. 2026
    .replace(new RegExp(`\\b(${SHORT_D}),\\s+(${SHORT_M})\\s+(\\d{1,2}),\\s+(\\d{4})\\b`, 'g'),
      (_m, d, mo, day, y) => `${WEEKDAYS_SHORT[d]} ${day} ${MONTHS_SHORT[mo]} ${y}`)
    // October 26, 2026 → 26 octobre 2026
    .replace(new RegExp(`\\b(${LONG_M})\\s+(\\d{1,2}),\\s+(\\d{4})\\b`, 'g'),
      (_m, mo, day, y) => `${day === '1' ? '1er' : day} ${MONTHS[mo]} ${y}`)
    // Oct 26, 2026 → 26 oct. 2026
    .replace(new RegExp(`\\b(${SHORT_M})\\s+(\\d{1,2}),\\s+(\\d{4})\\b`, 'g'),
      (_m, mo, day, y) => `${day} ${MONTHS_SHORT[mo]} ${y}`)
    // October 2026 → octobre 2026
    .replace(new RegExp(`\\b(${LONG_M})\\s+(\\d{4})\\b`, 'g'), (_m, mo, y) => `${MONTHS[mo]} ${y}`)
    // Oct 2026 → oct. 2026
    .replace(new RegExp(`\\b(${SHORT_M})\\s+(\\d{4})\\b`, 'g'), (_m, mo, y) => `${MONTHS_SHORT[mo]} ${y}`)
    // October 26 / Oct 26 (no year) → 26 octobre / 26 oct.
    .replace(new RegExp(`\\b(${LONG_M})\\s+(\\d{1,2})\\b(?![,:])`, 'g'), (_m, mo, day) => `${day} ${MONTHS[mo]}`)
    .replace(new RegExp(`\\b(${SHORT_M})\\s+(\\d{1,2})\\b(?![,:])`, 'g'), (_m, mo, day) => `${day} ${MONTHS_SHORT[mo]}`);
}

const plural = (n: string, one: string, many: string) => (Number(n.replace(/\s/g, '')) <= 1 ? one : many);
const tr = (s: string) => FR[norm(s)] ?? s;
/** Lower-cases the first letter unless the word is an acronym (NIF, USD…). */
const lcFirst = (s: string) => (/^[A-ZÀ-Ý][a-zà-ÿ]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** Phrases built at runtime from numbers or names. Each must match the whole string. */
const PATTERNS: [RegExp, (...m: string[]) => string][] = [
  [/^Displaying (\d+) of (\d+) registered taxpayers?$/, (_, a, b) => `Affichage de ${a} sur ${b} ${plural(b, 'contribuable enregistré', 'contribuables enregistrés')}`],
  [/^Displaying (\d+) of (\d+) registered properties$/, (_, a, b) => `Affichage de ${a} sur ${b} propriétés enregistrées`],
  [/^Displaying (\d+) of (\d+) issued receipts$/, (_, a, b) => `Affichage de ${a} sur ${b} reçus émis`],
  [/^Displaying (\d+) of (\d+) assessment notices$/, (_, a, b) => `Affichage de ${a} sur ${b} avis d’imposition`],
  [/^Displaying (\d+) of (\d+) logged municipal events$/, (_, a, b) => `Affichage de ${a} sur ${b} événements municipaux journalisés`],
  [/^Displaying (\d+) of (\d+) municipal licenses in registry$/, (_, a, b) => `Affichage de ${a} sur ${b} patentes au registre`],
  [/^(\d+) active schedules?$/, (_, n) => `${n} ${plural(n, 'échéancier actif', 'échéanciers actifs')}`],
  [/^(\d+) notices? pending$/, (_, n) => `${n} ${plural(n, 'avis en attente', 'avis en attente')}`],
  [/^(\d+) open past their date$/, (_, n) => `${n} en retard sur leur échéance`],
  [/^(\d+) employees? ready for release$/, (_, n) => `${n} ${plural(n, 'employé prêt', 'employés prêts')} pour le versement`],
  [/^(\d+) with arrears$/, (_, n) => `${n} avec arriérés`],
  [/^(\d+) valid receipts?$/, (_, n) => `${n} ${plural(n, 'reçu valide', 'reçus valides')}`],
  [/^(\d+) bank slips?$/, (_, n) => `${n} ${plural(n, 'bordereau bancaire', 'bordereaux bancaires')}`],
  [/^(\d+) approved shifts?$/, (_, n) => `${n} ${plural(n, 'service approuvé', 'services approuvés')}`],
  [/^(\d+) modules?$/, (_, n) => `${n} ${plural(n, 'module', 'modules')}`],
  [/^Avg wait (.+)$/, (_, w) => `Attente moyenne ${w}`],
  [/^Registered rangs \((\d+)\)$/, (_, n) => `Rangs enregistrés (${n})`],
  [/^Registered usages \((\d+)\)$/, (_, n) => `Usages enregistrés (${n})`],
  [/^Sort by (.+)$/, (_, l) => `Trier par ${lcFirst(tr(l))}`],
  [/^Edit property (.+)$/, (_, p) => `Modifier la propriété ${p}`],
  [/^Open dossier for (.+)$/, (_, n) => `Ouvrir le dossier de ${n}`],
  [/^(.+) — open dossier$/, (_, n) => `${n} — ouvrir le dossier`],
  [/^Mark done (.+)$/, (_, t) => `Marquer comme fait : ${t}`],
  [/^Reply as (.+)…$/, (_, n) => `Répondre en tant que ${n}…`],
  [/^(Revoke|Grant) access to (.+) for (.+)$/, (_, a, m, r) => `${a === 'Revoke' ? 'Retirer' : 'Accorder'} l’accès à ${tr(m)} pour ${tr(r)}`],
  [/^(.+) added to the taxpayer registry\.$/, (_, n) => `${n} ajouté au registre des contribuables.`],
  [/^(.+) removed from the registry\.$/, (_, n) => `${n} retiré du registre.`],
  [/^NIF already registered to (.+)\.$/, (_, n) => `NIF déjà attribué à ${n}.`],
  [/^NIF (.+) is already on the roll\. Search the registry before recording it again\.$/, (_, n) => `Le NIF ${n} figure déjà au rôle. Consultez le registre avant de l’enregistrer à nouveau.`],
  [/^Issued (.+) — check it before saving\.$/, (_, n) => `NIF ${n} attribué — vérifiez-le avant d’enregistrer.`],
  [/^Recorded (.+) as this taxpayer's existing fiscal identification\.$/, (_, n) => `${n} enregistré comme identifiant fiscal existant de ce contribuable.`],
  [/^Parcel (.+) filed on the cadastral register\.$/, (_, p) => `Parcelle ${p} inscrite au registre cadastral.`],
  [/^Parcel (.+) updated on the cadastral register\.$/, (_, p) => `Parcelle ${p} mise à jour au registre cadastral.`],
  [/^Rang (.+) added to the register\.$/, (_, r) => `Rang ${r} ajouté au registre.`],
  [/^Usage (.+) added to the register\.$/, (_, u) => `Usage ${u} ajouté au registre.`],
  [/^(.+) name is required\.$/, (_, l) => `Le nom (${lcFirst(tr(l))}) est obligatoire.`],
  [/^Code (.+) is already used by "(.+)"\.$/, (_, c, l) => `Le code ${c} est déjà utilisé par « ${l} ».`],
  [/^User profile for (.+) updated successfully\.$/, (_, n) => `Profil utilisateur de ${n} mis à jour.`],
  [/^Declaration could not be saved: (.+)$/, (_, e) => `La déclaration n’a pas pu être enregistrée : ${e === 'the server rejected the write' ? 'le serveur a refusé l’écriture' : e}`],
  [/^Deadline set for (.+)\. It now shows on the calendar\.$/, (_, d) => `Échéance fixée au ${d}. Elle apparaît désormais au calendrier.`],
  [/^Posted to (.+)\.$/, (_, d) => `Publié dans ${tr(d)}.`],
  [/^"(.+)" checked in\. Waiting clock started\.$/, (_, n) => `« ${n} » enregistré. Le décompte de l’attente a commencé.`],
  [/^"(.+)" marked as no-show\.$/, (_, n) => `« ${n} » marqué comme absent.`],
  [/^Visit completed for "(.+)"\.$/, (_, n) => `Visite terminée pour « ${n} ».`],
  [/^Ticket for "(.+)" cancelled\.$/, (_, n) => `Ticket de « ${n} » annulé.`],
  [/^"(.+)" marked as paid today\.$/, (_, n) => `« ${n} » marqué comme payé aujourd’hui.`],
  [/^"(.+)" cancelled and closed\.$/, (_, n) => `« ${n} » annulé et clôturé.`],
  [/^"(.+)" paused\. No dues accrue while paused\.$/, (_, n) => `« ${n} » suspendu. Aucune échéance ne court pendant la suspension.`],
  [/^"(.+)" permanently removed\.$/, (_, n) => `« ${n} » supprimé définitivement.`],
  [/^One-off expense "(.+)" logged as paid\.$/, (_, n) => `Dépense ponctuelle « ${n} » enregistrée comme payée.`],
  [/^Ledger entry "(.+)" cancelled\.$/, (_, n) => `Entrée « ${n} » annulée.`],
  [/^(.+) removed from the payroll roster\.$/, (_, n) => `${n} retiré de la liste de paie.`],
  [/^Advance for (.+) marked as fully repaid\.$/, (_, n) => `Avance de ${n} marquée comme entièrement remboursée.`],
  [/^Current date and time in (.+)$/, (_, z) => `Date et heure actuelles (${z})`],
  [/^Current time (.+)$/, (_, t) => `Heure actuelle ${translateDates(t)}`],
  // Documents and registers whose label carries a count or a date with it.
  [/^License Registry \((\d+)\)$/, (_, n) => `Registre des licences (${n})`],
  [/^Submitted on (.+)$/, (_, d) => `Soumis le ${translateDates(d)}`],
  [/^Verified on: (.+)$/, (_, d) => `Vérifié le : ${translateDates(d)}`],
  [/^Revocation Date: (.+)$/, (_, d) => `Date de révocation : ${translateDates(d)}`],
  [/^This certificate was revoked on (.+) by (.+)\.$/, (_, d, who) => `Ce certificat a été révoqué le ${translateDates(d)} par ${who}.`],
];

/**
 * US number grouping → the French separator.
 *
 * `toLocaleString('en-US')` groups thousands with a comma, and "1,234" read
 * the French way is one point two three four — not one thousand two hundred
 * and thirty-four. The French separator is a narrow no-break space, the same
 * one the money format uses.
 */
function translateNumberGrouping(s: string): string {
  return s.replace(/\b\d{1,3}(?:,\d{3})+\b/g, (m) => m.replace(/,/g, '\u202F'));
}

/** Returns the French text for an English string, or null when it has none. */
function translateToFr(raw: string): string | null {
  const key = norm(raw);
  if (!key) return null;
  const hit = FR[key];
  if (hit !== undefined) return hit;
  for (const [re, fn] of PATTERNS) {
    const m = key.match(re);
    if (m) return fn(...m);
  }
  const dated = translateDates(key);
  if (dated !== key) return dated;
  const grouped = translateNumberGrouping(key);
  return grouped !== key ? grouped : null;
}

/** Translates a source string into the active language, or null if nothing changes. */
export function translateString(raw: string): string | null {
  return current === 'fr' ? translateToFr(raw) : translateToEn(raw);
}

/* ------------------------------------------------------------------ */
/* DOM application                                                     */
/* ------------------------------------------------------------------ */

function skippable(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName)) return true;
    if (e.hasAttribute('data-no-i18n')) return true;
    if ((e as HTMLElement).isContentEditable) return true;
  }
  return false;
}

/** The source text of a node: what React last wrote into it. */
function englishOf(node: Text): string {
  const data = node.data;
  if (lastText.has(node) && data === lastText.get(node)) return origText.get(node) ?? data;
  origText.set(node, data);
  return data;
}

function write(node: Text, value: string) {
  lastText.set(node, value);
  if (node.data !== value) node.data = value;
}

/** Keeps the original leading/trailing whitespace around a translation. */
function wrap(original: string, translated: string): string {
  const lead = original.match(/^\s*/)![0];
  const trail = original.match(/\s*$/)![0];
  return lead + translated + trail;
}

/**
 * React renders `Displaying {a} of {b} items` as several sibling text nodes.
 * When an element holds only text nodes, translate the joined sentence so the
 * French word order is right; fall back to node-by-node otherwise.
 */
function translateGroup(parent: Element): boolean {
  const kids = parent.childNodes;
  if (kids.length < 2) return false;
  const nodes: Text[] = [];
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.nodeType !== Node.TEXT_NODE) return false;
    nodes.push(k as Text);
  }
  const originals = nodes.map(englishOf);
  const joined = originals.join('');
  const fr = translateString(joined);
  if (fr === null) return false;
  write(nodes[0], wrap(joined, fr));
  for (let i = 1; i < nodes.length; i++) write(nodes[i], '');
  return true;
}

function translateText(node: Text) {
  const parent = node.parentElement;
  if (!parent || skippable(parent)) return;
  try {
    if (translateGroup(parent)) return;
    const original = englishOf(node);
    const translated = translateString(original);
    write(node, translated === null ? original : wrap(original, translated));
  } catch {
    /* one unexpected string must never abort the whole language switch */
  }
}

function translateAttrs(el: Element) {
  for (const name of ATTRS) {
    if (!el.hasAttribute(name)) continue;
    const value = el.getAttribute(name)!;
    let origs = origAttr.get(el);
    let lasts = lastAttr.get(el);
    if (!origs) { origs = new Map(); origAttr.set(el, origs); }
    if (!lasts) { lasts = new Map(); lastAttr.set(el, lasts); }
    if (!(lasts.has(name) && lasts.get(name) === value)) origs.set(name, value);
    const original = origs.get(name)!;
    const next = translateString(original) ?? original;
    lasts.set(name, next);
    if (value !== next) el.setAttribute(name, next);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateText(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    if (skippable(root as Element)) return;
    translateAttrs(root as Element);
  }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  const els: Element[] = [];
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) texts.push(n as Text);
    else els.push(n as Element);
  }
  els.forEach(translateAttrs);
  texts.forEach(translateText);
}

function onMutations(records: MutationRecord[]) {
  for (const r of records) {
    if (r.type === 'characterData') {
      translateText(r.target as Text);
    } else if (r.type === 'attributes') {
      translateAttrs(r.target as Element);
    } else {
      r.addedNodes.forEach(walk);
      // A removed sibling can change a text-only group; re-check the parent.
      if (r.removedNodes.length && r.target.nodeType === Node.ELEMENT_NODE) {
        const t = (r.target as Element).firstChild;
        if (t && t.nodeType === Node.TEXT_NODE) translateText(t as Text);
      }
    }
  }
  // Drop the records our own writes just produced.
  observer?.takeRecords();
}

let dialogsPatched = false;

/** Browser confirm / alert / prompt boxes are not in the DOM — translate their text too. */
function patchDialogs() {
  if (dialogsPatched || typeof window === 'undefined') return;
  dialogsPatched = true;
  const tx = (m: unknown) => {
    if (m == null) return m as undefined;
    const text = String(m);
    return translateString(text) ?? text;
  };
  const nativeConfirm = window.confirm.bind(window);
  const nativeAlert = window.alert.bind(window);
  const nativePrompt = window.prompt.bind(window);
  window.confirm = (message?: string) => nativeConfirm(tx(message));
  window.alert = (message?: unknown) => nativeAlert(tx(message));
  window.prompt = (message?: string, def?: string) => nativePrompt(tx(message), def);
}

/** Switches the whole page to the given language and keeps it there. */
export function applyLanguage(lang: Lang) {
  current = lang;
  try {
    document.documentElement.lang = lang;
  } catch {
    /* non-fatal */
  }
  patchDialogs();
  observer?.disconnect();
  observer = null;
  try {
    walk(document.body);
  } catch {
    /* a failed pass must not leave the toggle stuck — the observer below
       still reconnects, and the next render re-translates */
  }
  // The observer is (re)established whatever happened above, so the switch is
  // never left half-applied and a later toggle always works.
  observer = new MutationObserver(onMutations);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRS],
  });
}
