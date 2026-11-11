/**
 * Print one document on one portrait page — as the note de perception prints.
 *
 * A copy of the document is laid out on its own, at `layoutWidth`, with
 * nothing else of the app around it; it is measured and scaled to fit the
 * page's width and height, never below `minZoom` so the text stays readable.
 * The page rule and the copy are removed once the print dialog closes.
 */
export function printOnePage(
  source: HTMLElement | null,
  opts: {
    /** Width the document is laid out at, in CSS px (its width on screen). */
    layoutWidth: number;
    /** The PDF's name, shown by the print dialog. */
    title?: string;
    minZoom?: number;
  }
): void {
  if (!source) return;
  const SHEET_ID = 'one-page-print-sheet';
  document.getElementById(SHEET_ID)?.remove();
  document.querySelector('style[data-one-page-print]')?.remove();

  // Printable area of a portrait page with 12 mm margins, sized to fit both A4
  // (186 × 273 mm) and US Letter (191.9 × 255.4 mm): the smaller of each.
  const mm = (v: number) => Math.floor((v * 96) / 25.4);
  const PAGE_W = mm(186) - 8;
  const PAGE_H = mm(255) - 16;
  const W = opts.layoutWidth;
  const minZoom = opts.minZoom ?? 0.6;

  const sheet = source.cloneNode(true) as HTMLElement;
  sheet.id = SHEET_ID;
  // Measured off screen at its layout width, with nothing clipped by a
  // scrolling container of the screen version.
  sheet.style.cssText = `position:absolute;left:-20000px;top:0;width:${W}px;max-height:none;overflow:visible;`;
  sheet.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.overflowY !== 'visible' || cs.maxHeight !== 'none') {
      el.style.setProperty('overflow', 'visible', 'important');
      el.style.setProperty('max-height', 'none', 'important');
    }
  });
  document.body.appendChild(sheet);
  const zoom = Math.max(minZoom, Math.min(1, PAGE_W / W, PAGE_H / Math.max(1, sheet.scrollHeight)));
  sheet.style.cssText = '';

  const page = document.createElement('style');
  page.setAttribute('data-one-page-print', '');
  page.textContent = `@page { size: portrait; margin: 12mm; }
    #${SHEET_ID} { display: none; }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
      body.print-one-page > *:not(#${SHEET_ID}) { display: none !important; }
      body.print-one-page #${SHEET_ID} {
        display: block !important;
        width: ${W}px !important;
        max-width: ${W}px !important;
        margin: 0 auto !important;
        zoom: ${zoom};
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body.print-one-page #${SHEET_ID} * { overflow: visible !important; max-height: none !important; }
    }`;
  document.head.appendChild(page);
  document.body.classList.add('print-one-page');
  const prevTitle = document.title;
  if (opts.title) document.title = opts.title;

  const done = () => {
    document.title = prevTitle;
    document.body.classList.remove('print-one-page');
    sheet.remove();
    page.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
