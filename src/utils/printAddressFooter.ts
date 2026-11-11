/** Exact office address shared by the DF, DRL and note de perception prints. */
export const PRINT_OFFICE_ADDRESS = 'Adresse: Commune de Goma, Quartier Les Volcans, Rond Point Tshukudu, Batiment DGI, Rue Nzumuka James, no 12, Av. Mont Goma.';

// Reserved outside the scaled document so the footer stays readable and clear of content.
export const PRINT_ADDRESS_FOOTER_SPACE_PX = 44;

export function mountPrintAddressFooter(id: string): HTMLElement {
  document.getElementById(id)?.remove();
  const footer = document.createElement('footer');
  footer.id = id;
  footer.setAttribute('translate', 'no');
  footer.setAttribute('data-no-i18n', '');
  footer.textContent = PRINT_OFFICE_ADDRESS;
  footer.style.display = 'none';
  document.body.appendChild(footer);
  return footer;
}

export function printAddressFooterCss(id: string): string {
  return `@media print {
    #${id} {
      display: block !important;
      position: fixed !important;
      left: 0 !important; right: 0 !important; bottom: 0 !important;
      margin: 0 !important; padding: 7px 0 0 !important;
      border-top: 1px solid #888 !important;
      font: 9px/1.4 "Times New Roman", Times, serif !important;
      color: #000 !important; background: #fff !important;
      text-align: center !important;
      letter-spacing: normal !important; text-transform: none !important;
      white-space: normal !important; overflow-wrap: normal !important;
      z-index: 10000;
    }
  }`;
}
