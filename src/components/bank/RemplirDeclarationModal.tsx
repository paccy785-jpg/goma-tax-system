import React, { useEffect, useState } from 'react';
import { Loader2, Lock, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { confirmationId } from '../../services/bankConfirmationService';
import { DeclarationAdmin, fillDeclarationAdmin } from '../../services/declarationAdminService';
import { formatMoney } from '../../utils/money';
import { Button } from '../ui';
import { PayableDeclaration } from './ConfirmPaymentModal';

/**
 * The fields of the "III) Réservé à l'administration" table of the printed
 * IF / IRL declarations, in the order they appear there (Cachet de
 * l'administration left out — it is stamped by hand).
 */
type AdminFieldKey = 'numeroQuittance' | 'dateQuittance' | 'nomQualiteAgent' | 'numeroRecepisse' | 'dateRecepisse';

const ADMIN_FIELDS: { key: AdminFieldKey; label: string; date?: boolean }[] = [
  { key: 'numeroQuittance', label: 'Numéro de la quittance ou BV' },
  { key: 'dateQuittance', label: 'Date de la quittance ou BV', date: true },
  { key: 'nomQualiteAgent', label: 'Nom et qualité de l’agent' },
  { key: 'numeroRecepisse', label: 'Numéro du récépissé' },
  { key: 'dateRecepisse', label: 'Date du récépissé', date: true },
];

const EMPTY: Record<AdminFieldKey, string> = {
  numeroQuittance: '',
  dateQuittance: '',
  nomQualiteAgent: '',
  numeroRecepisse: '',
  dateRecepisse: '',
};

const inputClass =
  'w-full px-3.5 py-2 bg-surface2 border border-line rounded-[10px] text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none transition-premium font-sans';

const declKey = (d: PayableDeclaration) => confirmationId(d.kind, d.calculationId);
const declLabel = (d: PayableDeclaration) =>
  `${d.contribuableName} — ${d.kind === 'foncier' ? 'Foncier' : 'Locatif'}${d.detail ? ` — ${d.detail}` : ''} — ${formatMoney(
    Math.max(0, d.amountUSD)
  )}`;

/**
 * The "Remplir la déclaration" card, opened from the Paiements des
 * déclarations table: the accountant fills in "Réservé à l'administration" for
 * one declaration. Once saved it is final, and the declaration's payment can
 * then be confirmed.
 */
export const RemplirDeclarationModal: React.FC<{
  /** Declarations still to fill in (pending payment, not yet filled). */
  declarations: PayableDeclaration[];
  /** The declaration whose row opened the card (none: the header button). */
  initialId?: string | null;
  onClose: () => void;
  onSaved?: (r: DeclarationAdmin) => void;
}> = ({ declarations, initialId, onClose, onSaved }) => {
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  const [declId, setDeclId] = useState<string>(
    initialId && declarations.some((d) => declKey(d) === initialId) ? initialId : ''
  );
  const [values, setValues] = useState<Record<AdminFieldKey, string>>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const decl = declarations.find((d) => declKey(d) === declId) || null;
  const missing = (k: AdminFieldKey) => !values[k].trim();
  const complete = !!decl && ADMIN_FIELDS.every((f) => !missing(f.key));

  const save = async () => {
    setTouched(true);
    if (!complete || !decl || saving) return;
    if (!userProfile) {
      showToast('Connectez-vous avant de remplir une déclaration.', 'error', 'Non connecté');
      return;
    }
    if (userProfile.role !== 'Admin' && userProfile.role !== 'Supervisor' && userProfile.role !== 'Cashier') {
      showToast('Votre profil n’est pas autorisé à remplir une déclaration.', 'error', 'Accès refusé');
      return;
    }
    setSaving(true);
    try {
      const r = await fillDeclarationAdmin(
        { kind: decl.kind, calculationId: decl.calculationId, contribuableName: decl.contribuableName, ...values },
        { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role }
      );
      showToast('Le paiement de cette déclaration peut maintenant être confirmé.', 'success', 'Déclaration remplie');
      onSaved?.(r);
      onClose();
    } catch (err) {
      const msg =
        (err as { code?: string })?.code === 'permission-denied'
          ? 'Accès refusé par la base de données. Déployez les règles Firestore (declarationAdmin).'
          : (err as Error)?.message || 'La déclaration n’a pas pu être enregistrée.';
      showToast(msg, 'error', 'Échec');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/60 backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div className="bg-surface rounded-[18px] border border-line shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4.5 border-b border-line flex items-center justify-between gap-3 bg-surface">
          <div className="min-w-0">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent font-sans">
              III) Réservé à l’administration
            </span>
            <h2 className="font-display text-lg font-bold text-ink tracking-tight">Remplir la déclaration</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Fermer"
            className="p-1.5 rounded-[8px] text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin">
          <div>
            <label htmlFor="remplir-decl-declaration" className="block text-xs font-semibold text-ink mb-1">
              Déclaration
            </label>
            {declarations.length === 0 ? (
              <p className="text-xs text-muted italic">Aucune déclaration à remplir.</p>
            ) : (
              <select
                id="remplir-decl-declaration"
                value={declId}
                onChange={(e) => setDeclId(e.target.value)}
                className={`${inputClass} cursor-pointer`}
              >
                <option value="">— Sélectionner —</option>
                {declarations.map((d) => (
                  <option key={declKey(d)} value={declKey(d)}>
                    {declLabel(d)}
                  </option>
                ))}
              </select>
            )}
            {touched && !decl && declarations.length > 0 && (
              <p className="text-[11px] text-danger mt-1">Sélectionnez la déclaration.</p>
            )}
          </div>

          {ADMIN_FIELDS.map(({ key, label, date }) => (
            <div key={key}>
              <label htmlFor={`remplir-decl-${key}`} className="block text-xs font-semibold text-ink mb-1">
                {label}
              </label>
              <input
                id={`remplir-decl-${key}`}
                type={date ? 'date' : 'text'}
                autoComplete="off"
                value={values[key]}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                className={`${inputClass}${date ? ' cursor-pointer' : ''}`}
              />
              {touched && missing(key) && <p className="text-[11px] text-danger mt-1">Champ obligatoire.</p>}
            </div>
          ))}

          <p className="flex items-center gap-1.5 text-[11px] text-faint">
            <Lock className="w-3 h-3" />
            Une fois enregistrée, la déclaration ne peut plus être modifiée.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-line bg-surface2/40 flex items-center justify-end gap-2.5">
          <Button variant="ghost" size="md" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={save}
            disabled={saving || declarations.length === 0}
            icon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
          >
            Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
};
