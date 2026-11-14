/**
 * The number a figure of the DGI "Nouveau calcul" card stands for, however it
 * was written. Spaces are grouping. With both commas and dots, the one written
 * last is the decimal separator ("1,364,414.50" and "1.364.414,50" are both
 * 1364414.5). With only one kind: written more than once, or followed by
 * exactly three digits, it groups thousands ("1,364,414", "136.441" → 136441);
 * otherwise it is the decimal separator ("129.82", "12,5"). Returns NaN for an
 * empty or malformed figure.
 *
 * It lives apart from the card because it is the part that has to be right:
 * every figure of every category salariale is read through it, and a figure
 * read a thousand times too small is an assessment a thousand times too small.
 */
export function parseFigure(raw: string): number {
  let t = (raw || '').replace(/[\s\u00a0\u202f]/g, '');
  if (!t || !/\d/.test(t)) return NaN;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.';
    const grp = dec === ',' ? '.' : ',';
    t = t.split(grp).join('');
    if (t.split(dec).length > 2) return NaN;
    t = t.replace(dec, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = t.split(sep);
    // A zero integer part ("0.500", "0,250") can only be a decimal — no one
    // groups thousands behind a leading zero, and reading it as a group turned
    // 0.5 into 500.
    const zeroInt = /^[0]+$/.test(parts[0]);
    // A figure written with MORE THAN ONE separator is a grouped number
    // whatever its first group is: "0,500,000" is five hundred thousand, and
    // reading it as a decimal dropped every group after the second — the
    // figure came back as 0.5, a million times too small.
    const grouping =
      parts.length > 2 || (!zeroInt && parts[0] !== '' && parts[1].length === 3);
    t = grouping ? parts.join('') : `${parts[0]}.${parts[1]}`;
  }
  return /^\d*\.?\d*$/.test(t) && t !== '.' ? Number(t) : NaN;
}
