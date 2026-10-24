/**
 * A small allow-list sanitiser for rich text written in the admin panel.
 *
 * Formats are authored by staff and read by every signed-in customer, so an
 * Editor must not be able to put a script on a page someone else loads. Only
 * the tags the editor can actually produce are kept.
 */
const ALLOWED = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'code', 'pre',
  'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div',
]);

/** Attributes worth keeping; everything else, including on*, is dropped. */
const ALLOWED_ATTRS = { a: new Set(['href', 'title', 'target', 'rel']) };

const VOID = new Set(['br', 'hr']);

const escapeText = (t) => t.replace(/&(?![a-z#0-9]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const safeHref = (v) => {
  const url = String(v).trim();
  return /^(https?:|mailto:|tel:|#|\/)/i.test(url) ? url : '';
};

export function sanitizeHtml(input = '') {
  let html = String(input);

  // drop whole dangerous elements, contents and all
  html = html.replace(/<(script|style|iframe|object|embed|form|input|button|link|meta)\b[\s\S]*?<\/\1\s*>/gi, '');
  html = html.replace(/<(script|style|iframe|object|embed|form|input|button|link|meta)\b[^>]*\/?>/gi, '');

  const out = [];
  const open = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let m;

  while ((m = tagRe.exec(html)) !== null) {
    out.push(escapeText(html.slice(last, m.index)));
    last = tagRe.lastIndex;

    const [raw, rawName, rawAttrs = ''] = m;
    const name = rawName.toLowerCase();
    const closing = raw.startsWith('</');

    if (!ALLOWED.has(name)) continue;            // unknown tag: keep its text, lose the tag

    if (closing) {
      const i = open.lastIndexOf(name);
      if (i === -1) continue;                     // stray close
      while (open.length > i) out.push(`</${open.pop()}>`);
      continue;
    }

    const keep = [];
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let a;
    while ((a = attrRe.exec(rawAttrs)) !== null) {
      const key = a[1].toLowerCase();
      let val = a[2] ?? a[3] ?? a[4] ?? '';
      if (key.startsWith('on')) continue;         // never any event handlers
      if (!ALLOWED_ATTRS[name]?.has(key)) continue;
      if (key === 'href') { val = safeHref(val); if (!val) continue; }
      keep.push(`${key}="${val.replace(/"/g, '&quot;')}"`);
    }

    if (name === 'a' && !keep.some((k) => k.startsWith('href='))) continue;
    if (name === 'a') keep.push('rel="noopener noreferrer"');

    if (VOID.has(name)) { out.push(`<${name}>`); continue; }
    open.push(name);
    out.push(`<${name}${keep.length ? ' ' + keep.join(' ') : ''}>`);
  }

  out.push(escapeText(html.slice(last)));
  while (open.length) out.push(`</${open.pop()}>`);   // close anything left dangling
  return out.join('');
}

/** Readable plain text, for list previews and the copy button. */
export const htmlToText = (html = '') => String(html)
  .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\n{3,}/g, '\n\n')
  .trim();
