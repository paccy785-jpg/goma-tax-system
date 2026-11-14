import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BadgeCheck, CheckCircle2, Loader2, Monitor, Printer, TriangleAlert, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  isStationOnline,
  PrintJob,
  PrintStation,
  ReceiptLine,
  sendPrintJob,
  subscribeToPrintJob,
  subscribeToPrintStations,
} from '../../services/printService';
import { moisLabel, type DgiCalculImpot, type MontantDevise } from '../../services/dgiCalculImpotService';
import { montantsPayesOf, type DgiDeclaration } from '../../services/dgiDeclarationService';
import { amountInFrenchWords, USD_LABELS, type FrenchCurrencyLabels } from '../../utils/frenchNumber';
import { formatMontant } from './DgiCalculImpotView';
import { Button } from '../ui';
import { DepartementFinancesSeal } from '../DepartementFinancesSeal';
import { printOnePage } from '../../utils/printOnePage';

const IMPOT = 'Impôts professionnel et exceptionnel sur les rémunérations (IPR / IER)';

const CDF_LABELS: FrenchCurrencyLabels = {
  singular: 'franc congolais',
  plural: 'francs congolais',
  centSingular: 'centime',
  centPlural: 'centimes',
};

/** yyyy-mm-dd → dd/mm/yyyy, without going through a time zone. */
const frDay = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : d || '—');
const frDateTime = (iso?: string) =>
  iso
    ? `${new Date(iso).toLocaleDateString('fr-FR')} à ${new Date(iso).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : '—';
const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const enLettres = (m: MontantDevise) =>
  capFirst(amountInFrenchWords(m.montant, m.devise === 'CDF' ? CDF_LABELS : USD_LABELS));

/** The declaration a payment settles, for the receipt's "Déclaration" line. */
const declarationLabel = (d: DgiDeclaration, calculs: DgiCalculImpot[]) => {
  const c = d.calculId
    ? calculs.find((x) => x.id === d.calculId)
    : calculs
        .filter((x) => x.contribuableId === d.contribuableId)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
  return c ? `Salaires du mois de ${moisLabel(c.salairesMois)} ${c.annee}` : '—';
};

/**
 * The receipt as the T6 prints it — the same content as on screen, line by
 * line, laid out by the T6 for its paper width (as the DPRNK receipts).
 */
export function dgiReceiptLines(d: DgiDeclaration, calculs: DgiCalculImpot[]): ReceiptLine[] {
  const montants = montantsPayesOf(d, calculs);
  return [
    { k: 'text', text: 'RÉPUBLIQUE DÉMOCRATIQUE DU CONGO', align: 'center', bold: true },
    { k: 'text', text: 'Département des Finances', align: 'center', bold: true },
    { k: 'seal' },
    { k: 'text', text: 'Coordination Provinciale des Finances du Nord-Kivu (CPF-NK)', align: 'center' },
    { k: 'text', text: 'Direction Provinciale des Impôts/DPI-NK', align: 'center' },
    { k: 'rule' },
    { k: 'text', text: 'REÇU DE PAIEMENT', align: 'center', bold: true, size: 2 },
    { k: 'text', text: `Quittance N° ${d.numeroQuittance || '—'}`, align: 'center', bold: true },
    { k: 'text', text: frDay(d.dateQuittance), align: 'center' },
    { k: 'rule' },
    { k: 'pair', label: 'Contribuable', value: d.contribuableName || '—', bold: true },
    { k: 'pair', label: 'Adresse', value: d.contribuableAdresse || '—' },
    { k: 'pair', label: 'Impôt', value: IMPOT },
    { k: 'pair', label: 'Déclaration', value: declarationLabel(d, calculs) },
    { k: 'pair', label: 'Mode de paiement', value: d.modePaiement || '—' },
    { k: 'pair', label: 'Date', value: frDay(d.date) },
    { k: 'pair', label: 'Qualité', value: d.qualite || '—' },
    { k: 'pair', label: 'Date de la quittance', value: frDay(d.dateQuittance) },
    { k: 'pair', label: 'Enregistré le', value: frDateTime(d.createdAt) },
    { k: 'pair', label: 'Enregistré par', value: d.createdByName || '—' },
    { k: 'rule' },
    { k: 'text', text: 'MONTANT PAYÉ', align: 'center', bold: true },
    ...montants.flatMap<ReceiptLine>((m) => [
      { k: 'text', text: formatMontant(m), align: 'center', bold: true, size: 2 },
      { k: 'text', text: `En toutes lettres : ${enLettres(m)}`, align: 'center' },
    ]),
    ...(montants.length === 0 ? [{ k: 'text', text: '—', align: 'center' } as ReceiptLine] : []),
    { k: 'rule' },
    {
      k: 'text',
      text: 'Ce reçu atteste du paiement ci-dessus, enregistré par le comptable. Un paiement enregistré ne peut être ni modifié ni annulé.',
    },
  ];
}

/** The T6 picked last on this computer — shared with the DPRNK receipts. */
const STATION_PREF = 'goma_receipt_print_station';
const readStationPref = () => {
  try {
    return localStorage.getItem(STATION_PREF) || '';
  } catch {
    return '';
  }
};
const writeStationPref = (id: string) => {
  try {
    localStorage.setItem(STATION_PREF, id);
  } catch {
    /* per-browser convenience only */
  }
};

const JOB_STATUS: Record<PrintJob['status'], string> = {
  pending: 'Envoyé — en attente du T6…',
  printing: 'Impression en cours sur le T6…',
  printed: 'Reçu imprimé sur le T6.',
  failed: 'Le T6 n’a pas pu imprimer',
};

/**
 * The receipt of a payment recorded on the DGI Accountant tab: on screen, on
 * this computer's printer, or on the T6 — the same T6 Print Station as the
 * DPRNK receipts. Read-only: a recorded payment cannot be changed.
 */
export const DgiReceiptModal: React.FC<{
  payment: DgiDeclaration | null;
  calculs: DgiCalculImpot[];
  onClose: () => void;
}> = ({ payment, calculs, onClose }) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  const { userProfile } = useAuth();

  const [stations, setStations] = useState<PrintStation[]>([]);
  const [stationId, setStationId] = useState<string>(readStationPref);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!payment) return;
    const unsub = subscribeToPrintStations(setStations);
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      unsub();
      window.clearInterval(tick);
    };
  }, [payment]);
  const station = useMemo(() => {
    const picked = stations.find((s) => s.id === stationId);
    if (picked) return picked;
    return stations.find((s) => isStationOnline(s, now)) || stations[0] || null;
  }, [stations, stationId, now]);
  const online = station ? isStationOnline(station, now) : false;

  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<PrintJob | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  useEffect(() => {
    if (!jobId) return;
    return subscribeToPrintJob(jobId, setJob);
  }, [jobId]);
  useEffect(() => {
    setJobId(null);
    setJob(null);
    setSendError('');
  }, [payment?.id]);

  useEffect(() => {
    if (!payment) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [payment, onClose]);

  if (!payment) return null;
  const d = payment;
  const number = d.numeroQuittance || '—';
  const montants = montantsPayesOf(d, calculs);

  const printOnT6 = async () => {
    if (!station || !userProfile || sending) return;
    setSending(true);
    setSendError('');
    setJob(null);
    try {
      const id = await sendPrintJob({
        station,
        title: `Reçu DGI ${number}`,
        lines: dgiReceiptLines(d, calculs),
        source: { kind: 'dgiPaymentReceipt', ref: number },
        actor: { uid: userProfile.uid, displayName: userProfile.displayName },
      });
      setJobId(id);
    } catch (err) {
      console.warn('[Print] Could not send the DGI receipt to the T6:', err);
      setSendError('Le reçu n’a pas pu être envoyé au T6. Vérifiez la connexion, puis réessayez.');
    } finally {
      setSending(false);
    }
  };
  const busy = sending || job?.status === 'pending' || job?.status === 'printing';
  const print = () => printOnePage(sheetRef.current, { layoutWidth: 720, title: `Reçu ${number}` });

  const row = (label: string, value: React.ReactNode, mono = false) => (
    <tr className="border-b border-slate-200 last:border-0">
      <th scope="row" className="w-[38%] py-2 pr-3 text-left align-top text-[12px] font-semibold text-slate-500">
        {label}
      </th>
      <td className={`py-2 text-[13px] font-semibold text-slate-900 align-top ${mono ? 'font-mono tabular-nums' : ''}`}>
        {value}
      </td>
    </tr>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dgi-rd-title"
        className="bg-surface rounded-2xl border border-line shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        <div className="px-6 py-4 bg-navy text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-white/15">
              <BadgeCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 id="dgi-rd-title" className="text-base font-bold font-display">
                Reçu de paiement
              </h3>
              <p className="text-xs text-white/70 font-mono truncate">{number}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-1 rounded-md text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto bg-surface2/40">
          {/* ---- The printable receipt ---- */}
          <div ref={sheetRef} data-no-i18n className="bg-white text-slate-900 rounded-[12px] border border-slate-200 p-6 sm:p-8 font-sans">
            <div className="flex items-start justify-between gap-6">
              <div className="w-max max-w-full flex flex-col items-center text-center">
                <div className="text-[13px] font-bold uppercase tracking-[0.08em] leading-snug">
                  République Démocratique du Congo
                </div>
                <div className="text-[12px] font-semibold uppercase mt-1.5">Département des Finances</div>
                <DepartementFinancesSeal className="w-[100px] h-[100px] mt-1.5 text-slate-900" monogramColor="#D00000" />
                <div className="text-[12px] font-semibold uppercase mt-1.5">
                  Coordination Provinciale des Finances du Nord-Kivu (CPF-NK)
                </div>
                <div className="text-[12px] font-semibold mt-1">Direction Provinciale des Impôts/DPI-NK</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[16px] font-black uppercase tracking-[0.06em]">Reçu de paiement</div>
                <div className="text-[13px] font-mono font-bold mt-1">Quittance N° {number}</div>
                <div className="text-[12px] text-slate-600 mt-1">{frDay(d.dateQuittance)}</div>
              </div>
            </div>

            <table className="w-full mt-5 border-collapse">
              <tbody>
                {row('Contribuable', d.contribuableName || '—')}
                {row('Adresse', d.contribuableAdresse || '—')}
                {row('Impôt', IMPOT)}
                {row('Déclaration', declarationLabel(d, calculs))}
                {row('Mode de paiement', d.modePaiement || '—')}
                {row('Date', frDay(d.date), true)}
                {row('Qualité', d.qualite || '—')}
                {row('Date de la quittance', frDay(d.dateQuittance), true)}
                {row('Enregistré le', frDateTime(d.createdAt), true)}
                {row('Enregistré par', d.createdByName || '—')}
              </tbody>
            </table>

            <div className="mt-5 rounded-[10px] border-2 border-slate-900 px-4 py-3 space-y-2">
              {montants.length === 0 ? (
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[12px] font-bold uppercase tracking-[0.08em]">Montant payé</span>
                  <span className="text-[23px] font-black">—</span>
                </div>
              ) : (
                montants.map((m) => (
                  <div key={m.devise}>
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-[12px] font-bold uppercase tracking-[0.08em]">Montant payé</span>
                      <span className="text-[23px] font-black tabular-nums">{formatMontant(m)}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-slate-700">
                      <span className="font-semibold">En toutes lettres :</span> <span className="italic">{enLettres(m)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <p className="mt-8 text-[11px] text-slate-500 leading-relaxed">
              Ce reçu atteste du paiement ci-dessus, enregistré par le comptable. Un paiement enregistré ne peut être ni
              modifié ni annulé.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-line bg-surface2/50 shrink-0 space-y-3">
          {/* Which T6 prints, and whether it is connected — the same T6 as DPRNK. */}
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-semibold text-muted">Imprimante :</span>
            {stations.length === 0 ? (
              <span className="text-warn font-semibold">
                Aucun T6 connecté — ouvrez l’application « T6 Print Station » sur le T6.
              </span>
            ) : (
              <>
                <select
                  value={station?.id || ''}
                  onChange={(e) => {
                    setStationId(e.target.value);
                    writeStationPref(e.target.value);
                  }}
                  aria-label="Imprimante T6"
                  className="h-8 px-2.5 rounded-[8px] border border-line bg-surface text-[12px] text-ink focus:border-accent focus:outline-none cursor-pointer"
                >
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || s.id}
                      {isStationOnline(s, now) ? '' : ' (hors ligne)'}
                    </option>
                  ))}
                </select>
                <span className={`inline-flex items-center gap-1.5 font-semibold ${online ? 'text-sage' : 'text-warn'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-sage' : 'bg-warn'}`} />
                  {online ? 'En ligne' : 'Hors ligne — le reçu sortira dès que le T6 sera reconnecté'}
                </span>
              </>
            )}
          </div>

          {(job || sendError) && (
            <div
              role="status"
              className={`flex items-center gap-2 text-[12px] font-semibold ${
                sendError || job?.status === 'failed' ? 'text-danger' : job?.status === 'printed' ? 'text-sage' : 'text-ink'
              }`}
            >
              {sendError || job?.status === 'failed' ? (
                <TriangleAlert className="w-4 h-4 shrink-0" />
              ) : job?.status === 'printed' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
              )}
              <span>
                {sendError ||
                  (job ? `${JOB_STATUS[job.status]}${job.status === 'failed' && job.error ? ` : ${job.error}` : ''}` : '')}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Fermer
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={print}
              icon={<Monitor className="w-3.5 h-3.5" />}
              title="Imprimer sur l’imprimante de cet ordinateur"
            >
              Imprimer sur cet ordinateur
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void printOnT6()}
              disabled={!station || busy}
              icon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              title={station ? `Imprimer sur ${station.name || station.id}` : 'Aucun T6 connecté'}
            >
              {job?.status === 'printed' || job?.status === 'failed' ? 'Imprimer à nouveau' : 'Imprimer le reçu'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
