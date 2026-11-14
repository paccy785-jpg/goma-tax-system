import { addDoc, collection, doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { printDb } from '../firebase/config';

/**
 * Remote printing on the T6 terminal.
 *
 * The receipt is not sent to the computer's printer: the web app files a print
 * job in Firestore (printJobs), and the "T6 Print Station" app running on the
 * T6 picks it up and prints it on the T6's built-in receipt printer.
 *
 * - printStations/{stationId} — each T6 running the app registers itself and
 *   refreshes `lastSeenAt` every 30 seconds, so the web app knows it is online.
 * - printJobs/{jobId} — one per print: the receipt as lines of text, which the
 *   T6 lays out for its paper width. Status: pending → printing → printed
 *   (or failed, with the reason). A job is never deleted.
 *
 * Both collections live in the DPRNK database, where the T6 app listens — the
 * DGI portal files its jobs there too (printDb), so one T6 prints for both.
 */
export const PRINT_STATIONS = 'printStations';
export const PRINT_JOBS = 'printJobs';

/** A station is shown online when it reported in during this window. */
export const STATION_ONLINE_MS = 90_000;

/** One line of a receipt, as the T6 prints it. */
export type ReceiptLine =
  /** Text, wrapped to the paper width. size 2 = double height and width. */
  | { k: 'text'; text: string; align?: 'left' | 'center' | 'right'; bold?: boolean; size?: 1 | 2 }
  /** A label and its value: on one line when they fit, else the value under its label. */
  | { k: 'pair'; label: string; value: string; bold?: boolean }
  /** A dashed rule across the paper. */
  | { k: 'rule' }
  /** An empty line. */
  | { k: 'space' }
  /**
   * The DF seal of the Département des Finances, centred — drawn by the T6
   * Print Station app (version 1.1.0 or later; older versions leave a blank line).
   */
  | { k: 'seal' };

export type PrintJobStatus = 'pending' | 'printing' | 'printed' | 'failed';

export interface PrintJob {
  id: string;
  stationId: string;
  stationName: string;
  /** Shown in the T6's log, e.g. "Reçu RD-2026-00001". */
  title: string;
  lines: ReceiptLine[];
  status: PrintJobStatus;
  /** Why it failed, when it did. */
  error?: string;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
  claimedAt?: string;
  printedAt?: string;
  /** What was printed, e.g. { kind: 'declarationReceipt', ref: 'RD-2026-00001' }. */
  source?: { kind: string; ref: string };
}

export interface PrintStation {
  id: string;
  name: string;
  /** e.g. "T6". */
  model?: string;
  /** The printer the station prints on, e.g. "VirtualBtPrinter". */
  printerName?: string;
  /** Paper width in mm (58 or 80). */
  paperMm?: number;
  lastSeenAt: string;
  appVersion?: string;
}

export const isStationOnline = (s: Pick<PrintStation, 'lastSeenAt'>, now = Date.now()) =>
  !!s.lastSeenAt && now - new Date(s.lastSeenAt).getTime() < STATION_ONLINE_MS;

export function subscribeToPrintStations(
  callback: (stations: PrintStation[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  return onSnapshot(
    collection(printDb(), PRINT_STATIONS),
    (snap) =>
      callback(
        snap.docs
          .map((d) => ({ ...(d.data() as PrintStation), id: d.id }))
          .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
      ),
    (err) => {
      console.warn('[Print] Stations listener unavailable:', err);
      onError?.(err);
      callback([]);
    }
  );
}

/** File a print job for a station; resolves with the job id. */
export async function sendPrintJob(input: {
  station: Pick<PrintStation, 'id' | 'name'>;
  title: string;
  lines: ReceiptLine[];
  source?: PrintJob['source'];
  actor: { uid: string; displayName: string };
}): Promise<string> {
  const job: Omit<PrintJob, 'id'> = {
    stationId: input.station.id,
    stationName: input.station.name || input.station.id,
    title: input.title,
    lines: input.lines,
    status: 'pending',
    createdAt: new Date().toISOString(),
    createdByUid: input.actor.uid,
    createdByName: input.actor.displayName,
    ...(input.source ? { source: input.source } : {}),
  };
  const ref = await addDoc(collection(printDb(), PRINT_JOBS), job);
  return ref.id;
}

/** Follow one job's status as the T6 prints it. */
export function subscribeToPrintJob(id: string, callback: (job: PrintJob | null) => void): Unsubscribe {
  return onSnapshot(
    doc(printDb(), PRINT_JOBS, id),
    (snap) => callback(snap.exists() ? { ...(snap.data() as PrintJob), id: snap.id } : null),
    (err) => {
      console.warn('[Print] Job listener unavailable:', err);
      callback(null);
    }
  );
}
