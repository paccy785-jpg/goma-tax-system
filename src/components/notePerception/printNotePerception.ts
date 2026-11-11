/**
 * Print the note de perception — a copy of its sheet (NotePerceptionPrintSheet)
 * on its own portrait page, with nothing else of the app around it. The copy
 * takes the compact print layout of the Impôt foncier document (.pp-compact in
 * index.css), so the shared top band — masthead far left, Identification du
 * redevable far right — prints alike.
 *
 * The sheet is laid out at LAYOUT_W (wide enough for the masthead and the
 * identification table side by side), then measured and scaled to fit one
 * page — never below MIN_PRINT_ZOOM, so the text stays readable.
 */
import QRCode from 'qrcode';
import { issueNotePerceptionDocumentCode } from '../../services/notePerceptionDocumentCode';
import { emitGlobalToast } from '../../contexts/ToastContext';
import { buildNotePerceptionQrPayload, newNotePerceptionRef } from './notePerceptionQr';

const MIN_PRINT_ZOOM = 0.7;

export async function printNotePerception(
  source: HTMLElement | null,
  /** The saved note on the sheet, if any: its number and id go in the QR code and the PDF's name. */
  note?: { id: string; numero: string } | null
): Promise<void> {
  if (!source) return;
  const sheet = source.cloneNode(true) as HTMLElement;
  let documentCode = '';
  try {
    if (note) documentCode = await issueNotePerceptionDocumentCode(note.id);
  } catch (error) {
    emitGlobalToast(error instanceof Error ? error.message : 'Impossible de générer le code de la note.', 'error', 'Impression impossible');
    return;
  }
  document.getElementById('np-print-sheet')?.remove();
  document.querySelector('style[data-np-print]')?.remove();

  // Printable area of a portrait page with 12 mm margins, sized to fit both A4
  // (186 × 273 mm) and US Letter (191.9 × 255.4 mm) — the smaller of each, in
  // CSS px.
  const mm = (v: number) => Math.floor((v * 96) / 25.4);
  const PAGE_W = mm(186) - 8;
  const PAGE_H = mm(255) - 16;
  const LAYOUT_W = 860;

  sheet.id = 'np-print-sheet';
  sheet.classList.add('pp-compact');
  const codeLabel = sheet.querySelector<HTMLElement>('[data-np-document-code]');
  if (codeLabel) codeLabel.textContent = documentCode;
  // Measured off screen at the page width — blank rows at their printed
  // height — to find the scale that fits it on one page.
  sheet.style.cssText = `position:absolute;left:-20000px;top:0;width:${LAYOUT_W}px;`;
  // Rows of the vertical tables: tight, but each blank still tall enough to
  // write in. Set inline (and important) so the measured sheet is the printed one.
  sheet.querySelectorAll<HTMLElement>('.np-vertical-table th:not(.np-stacked-cell)').forEach((th) => {
    th.style.setProperty('padding-top', '3px', 'important');
    th.style.setProperty('padding-bottom', '3px', 'important');
  });
  sheet.querySelectorAll<HTMLElement>('.np-print-blank-row > td').forEach((td) => {
    if (!td.style.height) td.style.height = '21px';
    td.style.setProperty('line-height', '1', 'important');
    if (!td.classList.contains('np-parts-cell')) {
      td.style.setProperty('padding-top', '2px', 'important');
      td.style.setProperty('padding-bottom', '2px', 'important');
    }
  });
  // Card headings ("Remplir par …") a little tighter than on the other
  // documents, so the whole form and its QR code keep to one page.
  sheet.querySelectorAll<HTMLElement>('section > div:first-child').forEach((head) => {
    head.style.setProperty('padding-top', '3px', 'important');
    head.style.setProperty('padding-bottom', '3px', 'important');
    head.querySelector<HTMLElement>('h2')?.style.setProperty('line-height', '1.2', 'important');
  });
  Array.from(sheet.children).forEach((child, i) => {
    if (i > 0) (child as HTMLElement).style.setProperty('margin-top', '6px', 'important');
  });
  document.body.appendChild(sheet);

  // The QR code at the foot of the page: this printed copy's reference, in the
  // payload the scanning app reads (notePerceptionQr.ts). Drawn at three times
  // its printed size so it stays sharp on paper.
  const ref = documentCode || newNotePerceptionRef();
  const qrImg = sheet.querySelector<HTMLImageElement>('.np-qr');
  const qrRef = sheet.querySelector<HTMLElement>('.np-qr-ref');
  try {
    const url = await QRCode.toDataURL(JSON.stringify(buildNotePerceptionQrPayload(ref, new Date(), note?.id)), {
      width: 288,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
    if (qrImg) {
      qrImg.src = url;
      await qrImg.decode().catch(() => undefined);
    }
    if (qrRef) qrRef.textContent = ref;
  } catch {
    // No code rather than no print.
    sheet.querySelector('.np-qr-block')?.remove();
  }

  // The document's title sits on the same line as the last row of the
  // Identification du redevable table (E-mail): lowered by the gap between
  // the two centres, measured on the laid-out sheet (the zoom scales both alike).
  const title = sheet.querySelector<HTMLElement>('.np-doc-title');
  const identRows = sheet.querySelectorAll<HTMLElement>('.pp-top-right .np-vertical-table tr');
  const lastRow = identRows[identRows.length - 1];
  if (title && lastRow) {
    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    };
    const drop = centre(lastRow) - centre(title);
    if (drop > 0) {
      const base = parseFloat(getComputedStyle(title).marginTop) || 0;
      title.style.setProperty('margin-top', `${base + drop}px`, 'important');
    }
  }

  const zoom = Math.max(MIN_PRINT_ZOOM, Math.min(PAGE_W / LAYOUT_W, PAGE_H / Math.max(1, sheet.scrollHeight)));
  sheet.style.cssText = '';

  const page = document.createElement('style');
  page.setAttribute('data-np-print', '');
  page.textContent = `@page { size: portrait; margin: 12mm; }
    #np-print-sheet { display: none; }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
      body.print-note-perception > *:not(#np-print-sheet) { display: none !important; }
      body.print-note-perception #np-print-sheet {
        display: block !important;
        width: ${LAYOUT_W}px !important;
        max-width: ${LAYOUT_W}px !important;
        margin: 0 auto !important;
        zoom: ${zoom};
      }
      body.print-note-perception #np-print-sheet table { width: 100% !important; }
      body.print-note-perception #np-print-sheet .overflow-x-auto { overflow: visible; }
      body.print-note-perception #np-print-sheet .np-vertical-table th,
      body.print-note-perception #np-print-sheet .np-vertical-table td { vertical-align: middle !important; }
      body.print-note-perception #np-print-sheet .np-part-label { font-size: 10px !important; }
      body.print-note-perception #np-print-sheet .np-parts-cell { padding: 0 !important; }
      /* A row of several headings: each line as tall as a single row, top and bottom padding on the lines. */
      body.print-note-perception #np-print-sheet .np-stacked-cell { padding-top: 0 !important; padding-bottom: 0 !important; }
    }`;
  document.head.appendChild(page);
  document.body.classList.add('print-note-perception');

  // The PDF is named after the document.
  const prevTitle = document.title;
  document.title = note ? `Note de perception ${documentCode}` : 'Note de perception';

  const done = () => {
    document.title = prevTitle;
    document.body.classList.remove('print-note-perception');
    sheet.remove();
    page.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
