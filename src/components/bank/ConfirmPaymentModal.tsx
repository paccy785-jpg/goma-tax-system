import React, { useEffect, useState } from 'react';
import { BadgeCheck, X, Loader2, Lock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  BankConfirmation,
  confirmPayment,
  DECLARATION_KIND_LABELS,
  DeclarationKind,
  normalizeReference,
  receiptNumberOf,
} from '../../services/bankConfirmationService';
import { formatMoney } from '../../utils/money';
import { Button } from '../ui';

/** A declaration awaiting the bank's confirmation. */
export interface PayableDeclaration {
  kind: DeclarationKind;
  calculationId: string;
  contribuableName: string;
  contribuableNif?: string;
  detail: string;
  amountUSD: number;
  modePaiement?: string;
  declaredAt: string;
}

export const ConfirmPaymentModal: React.FC<{
  item: PayableDeclaration | null;
  usedReferences: Set<string>;
  onClose: () => void;
  onConfirmed?: (c: BankConfirmation) => void;
}> = ({ item, usedReferences, onClose, onConfirmed }) => {
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  const [reference, setReference] = useState('');
  const [received, setReceived] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setReference('');
    setReceived(false);
    setTouched(false);
  }, [item?.kind, item?.calculationId]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose, saving]);

  if (!item) return null;

  const ref = reference.trim();
  const duplicate = !!ref && usedReferences.has(normalizeReference(ref));
  const refError = !ref ? 'Saisissez la référence du paiement.' : duplicate ? 'Cette référence a déjà été utilisée pour un autre paiement.' : '';
  const canSave = !refError && received && !saving;

  const save = async () => {
    setTouched(true);
    if (!canSave) return;
    if (!userProfile) {
      showToast('Connectez-vous avant de confirmer un paiement.', 'error', 'Non connecté');
      return;
    }
    // A bank confirmation is irreversible; the role is enforced here too, not
    // only by the parent hiding the confirm control (Auditors are read-only).
    if (userProfile.role !== 'Admin' && userProfile.role !== 'Supervisor' && userProfile.role !== 'Cashier') {
      showToast('Votre profil n’est pas autorisé à confirmer un paiement.', 'error', 'Accès refusé');
      return;
    }
    setSaving(true);
    try {
      const c = await confirmPayment(
        {
          kind: item.kind,
          calculationId: item.calculationId,
          contribuableName: item.contribuableName,
          contribuableNif: item.contribuableNif,
          amountUSD: item.amountUSD,
          modePaiement: item.modePaiement,
          reference: ref,
          detail: item.detail,
          declaredAt: item.declaredAt,
        },
        { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role },
        usedReferences
      );
      showToast(
        `Paiement de ${formatMoney(c.amountUSD)} confirmé pour ${c.contribuableName} — réf. ${c.reference}. Reçu ${receiptNumberOf(c)} ajouté à l’historique des paiements.`,
        'success',
        'Paiement confirmé'
      );
      onConfirmed?.(c);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'La confirmation a échoué.', 'error', 'Échec');
    } finally {
      setSaving(false);
    }
  };

  const row = (label: string, value: React.ReactNode, strong = false) => (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-[12px] text-muted shrink-0">{label}</span>
      <span className={`text-right min-w-0 truncate ${strong ? 'text-base font-bold text-accent-dark tabular-nums' : 'text-xs text-ink font-semibold'}`}>
        {value}
      </span>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-payment-title"
        className="bg-surface rounded-2xl border border-line shadow-2xl w-full max-w-lg overflow-hidden"
      >
        <div className="px-6 py-4 bg-navy text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-white/15">
              <BadgeCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 id="confirm-payment-title" className="text-base font-bold font-display">
                Confirmer le paiement
              </h3>
              <p className="text-xs text-white/70">Vérifiez le paiement puis saisissez sa référence</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Fermer"
            className="p-1 rounded-md text-white/80 hover:text-white hover:bg-white/10 cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="rounded-[12px] border border-line bg-surface2/40 px-4 py-2 divide-y divide-line">
            {row('Contribuable', item.contribuableName)}
            {item.contribuableNif && row('NIF', item.contribuableNif)}
            {row('Impôt', DECLARATION_KIND_LABELS[item.kind])}
            {item.detail && row('Objet', <span title={item.detail}>{item.detail}</span>)}
            {item.modePaiement && row('Mode de paiement déclaré', item.modePaiement)}
            {row('Montant à payer', formatMoney(item.amountUSD), true)}
          </div>

          <label className="block">
            <span className="block text-xs font-semibold text-ink mb-1.5">Référence du paiement</span>
            <input
              type="text"
              autoFocus
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder="N° de bordereau, de transaction ou de chèque…"
              disabled={saving}
              className={`w-full h-11 px-3 text-sm font-mono rounded-[10px] border bg-surface text-ink placeholder:text-faint placeholder:font-sans focus:border-accent focus:outline-none transition-premium ${
                (touched && refError) || duplicate ? 'border-danger' : 'border-line'
              }`}
            />
            {((touched && refError) || duplicate) && <p className="text-[12px] text-danger mt-1">{refError}</p>}
          </label>

          <label className="flex items-start gap-2.5 p-3 rounded-[10px] bg-surface2/50 border border-line cursor-pointer">
            <input
              type="checkbox"
              checked={received}
              onChange={(e) => setReceived(e.target.checked)}
              disabled={saving}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <span className="text-xs text-ink leading-relaxed">
              Je confirme que le paiement de <strong>{formatMoney(item.amountUSD)}</strong> de{' '}
              <strong>{item.contribuableName}</strong> a bien été reçu.
            </span>
          </label>

          <p className="text-[11px] text-muted flex items-start gap-1.5 leading-relaxed">
            <Lock className="w-3 h-3 shrink-0 mt-px" />
            Une confirmation enregistrée ne peut plus être modifiée ni supprimée.
          </p>
        </div>

        <div className="px-6 py-4 border-t border-line bg-surface2/50 flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={save}
            disabled={!canSave}
            icon={saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BadgeCheck className="w-3.5 h-3.5" />}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>
    </div>
  );
};
