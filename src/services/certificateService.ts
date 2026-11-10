import { 
  collection, 
  doc, 
  getDocs, 
  updateDoc, 
  runTransaction,
  query,
  limit,
  onSnapshot,
  type Unsubscribe 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { emitGlobalToast } from '../contexts/ToastContext';
import { 
  BusinessLicenseCertificate, 
  CertificateCounter, 
  CertificateStatus, 
  CertificateVerificationResult, 
  Assessment, 
  UserRole,
  normalizeSector,
  normalizeSizeClass
} from '../types';
import { logAuditEvent } from './dbService';
import { todayDateString } from '../utils/date';
import { BRAND } from '../branding';

const CERTIFICATES_COLLECTION = 'certificates';

/**
 * Unpredictable anti-fraud token embedded in a certificate's QR payload.
 *
 * The old value was `Math.random()` + `Date.now()`, which is not only
 * predictable (a PRNG, not a CSPRNG) but can repeat — two certificates issued
 * in the same instant from the same seeded generator could share a token. A
 * certificate's whole purpose is to be verifiable against forgery, so the token
 * comes from the platform CSPRNG, with a non-crypto fallback only if the
 * browser exposes neither `crypto.randomUUID` nor `crypto.getRandomValues`.
 */
function generateSecurityHash(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '').toUpperCase();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
  } catch {
    // fall through to the best-effort fallback below
  }
  return Math.random().toString(36).substring(2, 10).toUpperCase() + Date.now().toString(36).toUpperCase();
}

/**
 * The next certificate sequence to try.
 *
 * The counter alone is not authoritative: it can sit BEHIND the certificates
 * actually on disk (a failed issuance used to derive a number locally without
 * advancing it), and trusting it produced a number already in use, which the
 * old unconditional write then overwrote. Reconciling against the highest
 * sequence on disk as well is what makes the number safe to reserve.
 */
export function nextCertificateSequence(counterValue: number, highestIssued: number): number {
  const fromCounter = Number.isFinite(counterValue) ? counterValue + 1 : 10;
  const fromDisk = Number.isFinite(highestIssued) ? highestIssued + 1 : 10;
  return Math.max(fromCounter, fromDisk, 10);
}

// Helper: Calculate effective status (Auto-expire past tax year)
export function getEffectiveCertificateStatus(cert: BusinessLicenseCertificate): CertificateStatus {
  if (cert.status === 'Revoked') return 'Revoked';
  const today = todayDateString();
  if (cert.expiryDate && cert.expiryDate < today) {
    return 'Expired';
  }
  const currentYear = new Date().getFullYear();
  if (cert.taxYearCovered && cert.taxYearCovered < currentYear) {
    return 'Expired';
  }
  return cert.status || 'Valid';
}

/**
 * Apply the effective status to every certificate and order them
 * descending: highest sequence or newest issue date first.
 */
function normalizeCertificateList(certs: BusinessLicenseCertificate[]): BusinessLicenseCertificate[] {
  const list = certs.map((cert) => ({
    ...cert,
    status: getEffectiveCertificateStatus(cert),
  }));

  list.sort((a, b) => {
    if (b.sequenceNumber !== a.sequenceNumber) {
      return b.sequenceNumber - a.sequenceNumber;
    }
    return new Date(b.issueDate || b.createdAt).getTime() - new Date(a.issueDate || a.createdAt).getTime();
  });

  return list;
}

/**
 * Fetch all Business License Certificates from Firestore.
 * Normalizes effective statuses (automatically checks for expired certificates).
 * Firestore is the only store: an empty collection is an empty list and a failed
 * read is surfaced instead of being answered with a local copy.
 */
export async function getCertificates(): Promise<BusinessLicenseCertificate[]> {
  try {
    const snapshot = await getDocs(collection(db, CERTIFICATES_COLLECTION));
    return normalizeCertificateList(snapshot.docs.map((d) => d.data() as BusinessLicenseCertificate));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, CERTIFICATES_COLLECTION);
    return [];
  }
}

/**
 * Active-aware real-time listener for Business License Certificates.
 * Bounded by Spark tier limit() and explicitly cleans up when unsubscribed.
 */
export function subscribeToCertificates(
  onData: (certs: BusinessLicenseCertificate[]) => void,
  onError?: (err: any) => void,
  limitCount: number = 100
): Unsubscribe {
  console.log(`[Firestore Listener] Subscribed to certificates (limit: ${limitCount})`);
  const q = query(collection(db, CERTIFICATES_COLLECTION), limit(limitCount));

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      onData(normalizeCertificateList(snapshot.docs.map((d) => d.data() as BusinessLicenseCertificate)));
    },
    (err) => {
      console.error('[Firestore Listener] Error on certificates:', err);
      emitGlobalToast(`Error syncing business license certificates: ${err?.message || 'Permission or network issue'}`, 'error', 'Sync Error');
      if (onError) onError(err);
      onData([]);
    }
  );

  return () => {
    console.log('[Firestore Listener] Unsubscribed from certificates');
    unsubscribe();
  };
}

/**
 * Generates and persists a sequential, unique, never-reused certificate.
 * Triggered automatically when an assessment is fully paid.
 */
export async function issueCertificateForAssessment(
  assessment: Assessment,
  issuer: { uid: string; displayName: string; role: UserRole },
  receiptNumber?: string
): Promise<BusinessLicenseCertificate> {
  const fiscalYear = assessment.fiscalYear || new Date().getFullYear();
  const existingList = await getCertificates();
  
  // Verify if a certificate already exists for this assessment
  // Only a certificate that is still VALID counts as already issued. The old
  // check matched on assessmentId alone, so once a certificate had been revoked
  // or had expired, re-issuing returned that dead document and reported success
  // while the business held a void licence.
  const existingCert = existingList.find(
    (c) =>
      getEffectiveCertificateStatus(c) === 'Valid' &&
      (c.assessmentId === assessment.id ||
        (c.businessId === (assessment.businessId || assessment.taxpayerId) &&
          c.taxYearCovered === fiscalYear))
  );
  if (existingCert) {
    return existingCert;
  }

  const now = new Date().toISOString();
  const issueDate = todayDateString();
  const expiryDate = `${fiscalYear}-12-31`;

  const securityHash = generateSecurityHash();

  const certIdFor = (sequence: number) => `cert_${fiscalYear}_${String(sequence).padStart(5, '0')}`;
  const certNumberFor = (sequence: number) => `CERT-PAT-${fiscalYear}-${String(sequence).padStart(5, '0')}`;
  const highestIssuedSequence = () =>
    existingList.reduce((max, c) => Math.max(max, c.sequenceNumber || 0), 0);

  /** The full certificate for one reserved sequence number. */
  const buildCertificate = (sequence: number): BusinessLicenseCertificate => {
    const certNumber = certNumberFor(sequence);
    const qrPayload = JSON.stringify({
      type: 'GOMA_PATENTE_CERTIFICATE',
      certNo: certNumber,
      biz: assessment.businessName || assessment.taxpayerName,
      rccm: assessment.nationalIdOrRccm || 'N/A',
      year: fiscalYear,
      expiry: expiryDate,
      status: 'VALID',
      hash: securityHash,
    });

    return {
      id: certIdFor(sequence),
      certificateNumber: certNumber,
      sequenceNumber: sequence,
      assessmentId: assessment.id,
      assessmentNumber: assessment.assessmentNumber || assessment.noticeNumber,
      receiptNumber: receiptNumber || 'REC-AUTOMATIQUE',
      businessId: assessment.businessId || assessment.taxpayerId || 'biz_unknown',
      businessName: assessment.businessName || assessment.taxpayerName || 'Unknown Taxpayer',
      tradeName: assessment.businessName,
      ownerName: assessment.ownerFullName || 'Legal Representative',
      businessRegistrationNumber: assessment.nationalIdOrRccm || 'CD/GOM/NOT-SPECIFIED',
      commune: assessment.commune || 'Goma',
      quartier: assessment.quartier || 'Centre Urbain',
      activitySector: normalizeSector(assessment.activitySector || 'Commerce'),
      sizeClass: normalizeSizeClass(assessment.sizeClass || 'Medium'),
      taxYearCovered: fiscalYear,
      issuingOffice: BRAND.docIssuingOffice,
      issuedBy: issuer.uid,
      issuedByName: issuer.displayName,
      issueDate,
      expiryDate,
      status: 'Valid',
      // Use ?? not || — `amountPaidUSD: 0` is a legitimate value, and `||` would
      // certify the full amount due as paid for a zero-paid assessment.
      amountPaidUSD: assessment.amountPaidUSD ?? assessment.amountDueUSD ?? 0,
      qrVerificationCode: qrPayload,
      securityHash,
      notes: `Official Business License Certificate (Patente) generated following full payment of assessment ${assessment.assessmentNumber || assessment.noticeNumber}.`,
      createdAt: now,
      updatedAt: now,
    };
  };

  // Reserve the number AND write the certificate in ONE transaction.
  //
  // The previous code advanced the counter, then wrote the certificate with a
  // plain setDoc. That produced two failure modes:
  //   - the counter could fall BEHIND the certificates on disk — the old catch
  //     branch derived a number locally without advancing it — so the next
  //     successful issuance recomputed a number already in use;
  //   - the write itself was an unconditional upsert, so that recomputed number
  //     silently REPLACED an issued certificate, handing one business's official
  //     number (and its audit trail) to another.
  //
  // Now the candidate is reconciled against both the counter and the documents
  // actually on disk, the target id is read inside the transaction, and nothing
  // is written unless that id is still free. If the number cannot be reserved
  // the issuance fails loudly rather than minting a duplicate.
  const counterRef = doc(db, 'counters', 'certificateCounter');
  const certificate = await runTransaction(db, async (txn) => {
    // A transaction must do all of its reads before any write.
    const counterDoc = await txn.get(counterRef);
    const counterValue = counterDoc.exists()
      ? (counterDoc.data() as CertificateCounter).currentSequence || 9
      : 9;

    let candidate = nextCertificateSequence(counterValue, highestIssuedSequence());
    let occupied = await txn.get(doc(db, CERTIFICATES_COLLECTION, certIdFor(candidate)));
    let guard = 0;
    while (occupied.exists() && guard < 100) {
      candidate += 1;
      occupied = await txn.get(doc(db, CERTIFICATES_COLLECTION, certIdFor(candidate)));
      guard += 1;
    }
    if (occupied.exists()) {
      throw new Error('Aucun numéro de certificat libre n’a pu être réservé — réessayez.');
    }

    const next = buildCertificate(candidate);
    txn.set(
      counterRef,
      {
        id: 'certificateCounter',
        currentSequence: candidate,
        lastCertificateNumber: next.certificateNumber,
        updatedAt: now,
      },
      { merge: true }
    );
    txn.set(doc(db, CERTIFICATES_COLLECTION, next.id), next);
    return next;
  }).catch((err) => handleFirestoreError(err, OperationType.CREATE, CERTIFICATES_COLLECTION));

  // Log to the immutable audit trail
  await logAuditEvent(
    issuer.uid,
    issuer.displayName,
    issuer.role,
    'ISSUE_CERTIFICATE',
    'Certificate',
    certificate.id,
    `Official issuance of Business License Certificate No. ${certificate.certificateNumber} for business "${certificate.businessName}" (Fiscal Year ${fiscalYear}). Holder: ${certificate.ownerName}. Status: VALID through ${expiryDate}.`
  );

  return certificate;
}

/**
 * Revokes a certificate directly once Maker-Checker approval has succeeded.
 * Should NOT be called directly by standard users without Maker-Checker clearance.
 */
export async function revokeCertificateInternal(
  certificateIdOrNumber: string,
  checker: { uid: string; displayName: string; role: UserRole },
  reason: string,
  approvalRequestId: string
): Promise<BusinessLicenseCertificate> {
  const certs = await getCertificates();
  const cert = certs.find((c) => c.id === certificateIdOrNumber || c.certificateNumber === certificateIdOrNumber);

  if (!cert) {
    throw new Error(`Certificate (${certificateIdOrNumber}) not found in official registry.`);
  }

  // Status guard: only a Valid certificate can be revoked. Without it, a second
  // revocation silently overwrote revokedAt/revokedBy/revocationReason,
  // destroying the original (possibly fraud-related) revocation trail, and an
  // Expired certificate could be "revoked" out of the blue.
  if (getEffectiveCertificateStatus(cert) !== 'Valid') {
    throw new Error(
      `Certificate ${cert.certificateNumber} cannot be revoked — its current status is "${getEffectiveCertificateStatus(cert)}".`
    );
  }

  const now = new Date().toISOString();
  const updatedCert: BusinessLicenseCertificate = {
    ...cert,
    status: 'Revoked',
    revokedAt: now,
    revokedBy: checker.uid,
    revokedByName: checker.displayName,
    revokedRole: checker.role,
    revocationReason: reason,
    revocationRequestId: approvalRequestId,
    updatedAt: now,
  };

  // 1. Update in Firestore. Failure propagates: a revocation that did not
  //    reach the server did not happen.
  try {
    await updateDoc(doc(db, CERTIFICATES_COLLECTION, cert.id), {
      status: 'Revoked',
      revokedAt: now,
      revokedBy: checker.uid,
      revokedByName: checker.displayName,
      revokedRole: checker.role,
      revocationReason: reason,
      revocationRequestId: approvalRequestId,
      updatedAt: now,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${CERTIFICATES_COLLECTION}/${cert.id}`);
  }

  // 2. Audit trail log
  await logAuditEvent(
    checker.uid,
    checker.displayName,
    checker.role,
    'REVOKE_CERTIFICATE',
    'Certificate',
    cert.id,
    `ADMINISTRATIVE REVOCATION of Business License Certificate No. ${cert.certificateNumber} (${cert.businessName}) approved by ${checker.displayName} (${checker.role}) under Maker-Checker visa ${approvalRequestId}. Reason: "${reason.trim()}". The certificate is now invalid with no legal effect.`
  );

  return updatedCert;
}

/**
 * Every field of a certificate that must still match the QR payload frozen
 * inside it at issuance, with the record field it is compared against.
 *
 * Only fields written from the SAME expression in both places are listed, so a
 * legitimate record can never disagree with its own payload:
 *
 *  - `certNo`   ← `certificateNumber`   — which certificate this is
 *  - `year`     ← `taxYearCovered`      — the fiscal year it covers
 *  - `expiry`   ← `expiryDate`          — the window it is valid for
 *  - `hash`     ← `securityHash`        — the anti-fraud token
 *
 * `biz` and `rccm` are compared only when the record is not showing its own
 * documented placeholder. At issuance the payload writes
 * `assessment.businessName || assessment.taxpayerName` while the record writes
 * `... || 'Unknown Taxpayer'`, and the payload writes
 * `nationalIdOrRccm || 'N/A'` while the record writes
 * `... || 'CD/GOM/NOT-SPECIFIED'`. An assessment that named no business would
 * therefore make an honest record disagree with its payload, so those two
 * fields are skipped rather than allowed to raise a false alarm — the holder's
 * name is still checked on every certificate that has a real one.
 *
 * `status` is never compared: the payload always writes 'VALID' and revocation
 * legitimately changes it afterwards.
 *
 * A field the payload does not carry is simply not checked — a legacy or
 * foreign-schema payload is not evidence of tampering.
 */
const QR_INTEGRITY_FIELDS: {
  qr: string;
  record: keyof BusinessLicenseCertificate;
  /** Skip the comparison when the record holds this placeholder value. */
  skipIfRecordEquals?: string;
}[] = [
  { qr: 'certNo', record: 'certificateNumber' },
  { qr: 'year', record: 'taxYearCovered' },
  { qr: 'expiry', record: 'expiryDate' },
  { qr: 'hash', record: 'securityHash' },
  { qr: 'biz', record: 'businessName', skipIfRecordEquals: 'Unknown Taxpayer' },
  { qr: 'rccm', record: 'businessRegistrationNumber', skipIfRecordEquals: 'CD/GOM/NOT-SPECIFIED' },
];

/**
 * The fields of a certificate that no longer match the payload frozen inside
 * it — empty when the record is intact (or the payload carries nothing to
 * compare).
 */
function qrIntegrityMismatches(cert: BusinessLicenseCertificate): string[] {
  const payload = cert.qrVerificationCode;
  if (!payload) return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return [];
  }

  const mismatches: string[] = [];
  for (const { qr, record, skipIfRecordEquals } of QR_INTEGRITY_FIELDS) {
    const fromQr = parsed[qr];
    const fromRecord = cert[record];
    // A missing/blank value on either side is not a mismatch: legacy records
    // predate the token, and `hash` is optional on the type.
    if (fromQr === undefined || fromQr === null || fromQr === '') continue;
    if (fromRecord === undefined || fromRecord === null || fromRecord === '') continue;
    // A documented placeholder is not the real value, so there is nothing to
    // compare it against.
    if (skipIfRecordEquals && String(fromRecord) === skipIfRecordEquals) continue;
    if (String(fromQr) !== String(fromRecord)) {
      mismatches.push(`${record} (record: "${String(fromRecord)}", issued: "${String(fromQr)}")`);
    }
  }
  return mismatches;
}

/**
 * Dedicated Certificate Verification Lookup (Separate from receipt verification)
 * Looks up authenticity by certificate number and verifies business name.
 */
export async function verifyCertificate(
  certificateNumberQuery: string,
  businessNameQuery?: string
): Promise<CertificateVerificationResult> {
  const qCert = certificateNumberQuery.trim().toUpperCase();
  const qBiz = businessNameQuery?.trim().toLowerCase();
  const now = new Date().toISOString();

  if (!qCert) {
    return {
      isValid: false,
      status: 'NotFound',
      verificationMessage: 'Certificate number is required.',
      verifiedAt: now,
    };
  }

  const certs = await getCertificates();
  
  // Find matching certificate by number or ID
  const found = certs.find((c) => 
    (c.certificateNumber || '').toUpperCase() === qCert ||
    (c.id || '').toUpperCase() === qCert ||
    (c.certificateNumber || '').replace(/[^A-Z0-9]/g, '') === qCert.replace(/[^A-Z0-9]/g, '')
  );

  if (!found) {
    return {
      isValid: false,
      status: 'NotFound',
      verificationMessage: `No official business license certificate found matching reference "${certificateNumberQuery}". This document may be counterfeit or unregistered.`,
      verifiedAt: now,
    };
  }

  // If business name was provided as a second verification factor, cross-check it
  if (qBiz) {
    const bizNameLower = (found.businessName || '').toLowerCase();
    const tradeNameLower = (found.tradeName || '').toLowerCase();
    const ownerLower = (found.ownerName || '').toLowerCase();
    const rccmLower = (found.businessRegistrationNumber || '').toLowerCase();

    const matchesName =
      bizNameLower.includes(qBiz) ||
      tradeNameLower.includes(qBiz) ||
      ownerLower.includes(qBiz) ||
      rccmLower.includes(qBiz);

    if (!matchesName) {
      return {
        isValid: false,
        certificate: found,
        status: found.status,
        verificationMessage: `Match Warning: Certificate ${found.certificateNumber} exists, but business name "${businessNameQuery}" does not match the registered holder (${found.businessName}).`,
        verifiedAt: now,
      };
    }
  }

  // Integrity check against the payload frozen inside the certificate at
  // issuance.
  //
  // `qrVerificationCode` is written once, when the certificate is minted, and
  // never rewritten — revocation changes only the status and revocation fields.
  // So the certificate number, fiscal year, expiry and security token it
  // carries are a record of what was actually issued, and a stored document
  // that no longer agrees with them was altered after the fact.
  //
  // Previously the security token was generated, stored, printed on the
  // certificate and never compared with anything, so a record edited in
  // Firestore — a "corrected" holder, a bumped amount paid, a moved expiry —
  // verified as perfectly authentic on a screen whose entire purpose is to
  // catch forged documents.
  //
  // Only immutable fields are compared (see QR_INTEGRITY_FIELDS): `status` is
  // expected to drift on revocation, and `biz`/`rccm` are written from
  // different fallback expressions, so comparing them would fail honest
  // records that named no business.
  const mismatches = qrIntegrityMismatches(found);
  if (mismatches.length > 0) {
    return {
      isValid: false,
      certificate: found,
      status: 'Tampered',
      verificationMessage: `INTEGRITY FAILURE: Certificate ${found.certificateNumber} was found, but it no longer matches the record frozen inside it at issuance — ${mismatches.join('; ')}. The document was altered after it was issued. Do NOT accept it; refer the holder to the Urban Finance Directorate for re-issuance.`,
      verifiedAt: now,
    };
  }

  const effectiveStatus = getEffectiveCertificateStatus(found);

  if (effectiveStatus === 'Revoked') {
    return {
      isValid: false,
      certificate: found,
      status: 'Revoked',
      verificationMessage: `WARNING: This certificate (${found.certificateNumber}) was OFFICIALLY REVOKED on ${found.revokedAt ? new Date(found.revokedAt).toLocaleDateString('en-US') : 'recently'} for reason: "${found.revocationReason || 'Unspecified'}". It is null and void with no legal standing.`,
      verifiedAt: now,
    };
  }

  if (effectiveStatus === 'Expired') {
    return {
      isValid: false,
      certificate: found,
      status: 'Expired',
      verificationMessage: `This certificate (${found.certificateNumber}) for fiscal year ${found.taxYearCovered} EXPIRED on ${found.expiryDate}. The business must renew its business license for the current fiscal year.`,
      verifiedAt: now,
    };
  }

  return {
    isValid: true,
    certificate: found,
    status: 'Valid',
    verificationMessage: `AUTHENTIC AND VALID CERTIFICATE. Registered holder: "${found.businessName}" (Fiscal Year ${found.taxYearCovered}). Issued by ${found.issuingOffice}.`,
    verifiedAt: now,
  };
}
