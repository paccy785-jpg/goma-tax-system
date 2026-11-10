import React, { useState, useEffect, useRef } from 'react';
import { 
  Settings, 
  ShieldCheck, 
  DollarSign, 
  Save, 
  UserPlus, 
  AlertCircle, 
  CheckCircle2, 
  Database,
  Lock,
  Landmark,
  Wifi,
  Scale,
  Ruler,
  MapPin,
  Shapes,
  BookOpenText
} from 'lucide-react';
import { ACTIVE_DATABASE_ID } from '../firebase/config';
import { TaxRateConfig } from '../types';
import { 
  getTaxRateConfigs, 
  updateTaxRate, 
  logAuditEvent 
} from '../services/dbService';
import { useAuth } from '../contexts/AuthContext';
import { PatenteRateScheduleView } from './PatenteRateScheduleView';
import { RangRegistryView } from './settings/RangRegistryView';
import { AddressHierarchyView } from './settings/AddressHierarchyView';
import { UsageRegistryView } from './settings/UsageRegistryView';
import { NomenclaturesImpotsView } from './NomenclaturesImpotsView';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';
import { formatMoney } from '../utils/money';

export type SettingsTab = 'tariffs' | 'rangs' | 'adresses' | 'usages' | 'nomenclatures' | 'system';

interface SettingsViewProps {
  /**
   * The subtabs shown, in their usual order. Omitted: all of them (DPRNK). The
   * DGI portal shows only the address hierarchy its enrolment card needs.
   */
  tabs?: SettingsTab[];
  /** Page title and description. Omitted: the DPRNK ones. */
  title?: string;
  description?: string;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ tabs, title, description }) => {
  const { userProfile, userRole } = useAuth();
  const [rates, setRates] = useState<TaxRateConfig[]>([]);
  const shows = (tab: SettingsTab) => !tabs || tabs.includes(tab);
  const [chosenTab, setActiveTab] = useState<SettingsTab>(tabs?.[0] ?? 'tariffs');
  const activeTab: SettingsTab = shows(chosenTab) ? chosenTab : tabs?.[0] ?? 'tariffs';
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const saveMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (saveMsgTimerRef.current) clearTimeout(saveMsgTimerRef.current);
  }, []);

  // Editable rates state
  const [editableRates, setEditableRates] = useState<Record<string, { usd: number }>>({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const rateData = await getTaxRateConfigs();
      setRates(rateData || []);
      const initialMap: Record<string, { usd: number }> = {};
      rateData.forEach((r) => {
        initialMap[r.id] = { usd: r.annualRateUSD };
      });
      setEditableRates(initialMap);
    } catch (err) {
      console.warn('[Settings] Load error:', err);
    }
  };

  const handleSaveRate = async (rate: TaxRateConfig) => {
    const editValues = editableRates[rate.id];
    if (!editValues) return;
    setSavingId(rate.id);
    try {
      const updated: TaxRateConfig = {
        ...rate,
        annualRateUSD: editValues.usd,
        updatedBy: userProfile?.displayName || 'Admin Officer',
        updatedAt: new Date().toISOString(),
      };
      await updateTaxRate(updated);

      if (userProfile) {
        await logAuditEvent(
          userProfile.uid,
          userProfile.displayName,
          userProfile.role,
          'UPDATE_TAX_RATE',
          'TaxRateConfig',
          rate.id,
          `Modified Patente rate for ${rate.category} to ${formatMoney(updated.annualRateUSD)}.`
        );
      }

      setRates((prev) => prev.map((r) => (r.id === rate.id ? updated : r)));
      setSaveSuccessMsg(`Rate updated successfully for ${rate.category.replace('Category_', '')}.`);
      // Tracked timer: the bare setTimeout fired setSaveSuccessMsg after unmount.
      if (saveMsgTimerRef.current) clearTimeout(saveMsgTimerRef.current);
      saveMsgTimerRef.current = setTimeout(() => setSaveSuccessMsg(null), 3000);
    } catch (err) {
      console.error('[Save Rate] Error:', err);
    } finally {
      setSavingId(null);
    }
  };

  if (userRole !== 'Admin') {
    return (
      <div className="p-8 bg-white rounded-xl border border-slate-200 text-center space-y-3">
        <Lock className="w-10 h-10 text-red-500 mx-auto" />
        <h3 className="text-base font-bold text-slate-900">Access Restricted</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          The Settings module is reserved exclusively for the <strong>Admin</strong> role to configure tax rate schedules.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 font-sans">
      
      {/* Header */}
      <PageHeader
        eyebrow="Governance"
        title={title ?? "System Administration & Tariff Rates"}
        description={description ?? "Configure DPRNK Business License Tax rates, official tariff rates, the cadastral rang register and the address hierarchy."}
        actions={
          saveSuccessMsg ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-sage/15 text-sage border border-sage/30 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-sage" />
              {saveSuccessMsg}
            </div>
          ) : undefined
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-line pb-2">
        {shows('tariffs') && <button
          id="tab-tariffs-btn"
          type="button"
          onClick={() => setActiveTab('tariffs')}
          className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold transition-premium cursor-pointer ${
            activeTab === 'tariffs'
              ? 'bg-accent text-white shadow-xs font-bold'
              : 'text-muted hover:text-ink hover:bg-surface2'
          }`}
        >
          <Scale className="w-4 h-4" />
          Tax Rate Schedule
        </button>}

        {shows('rangs') && <button
          id="tab-rangs-btn"
          type="button"
          onClick={() => setActiveTab('rangs')}
          className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold transition-premium cursor-pointer ${
            activeTab === 'rangs'
              ? 'bg-accent text-white shadow-xs font-bold'
              : 'text-muted hover:text-ink hover:bg-surface2'
          }`}
        >
          <Ruler className="w-4 h-4" />
          Rang
        </button>}

        {shows('adresses') && <button
          id="tab-adresses-btn"
          type="button"
          onClick={() => setActiveTab('adresses')}
          className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold transition-premium cursor-pointer ${
            activeTab === 'adresses'
              ? 'bg-accent text-white shadow-xs font-bold'
              : 'text-muted hover:text-ink hover:bg-surface2'
          }`}
        >
          <MapPin className="w-4 h-4" />
          Adresse
        </button>}

        {shows('usages') && <button
          id="tab-usages-btn"
          type="button"
          onClick={() => setActiveTab('usages')}
          className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold transition-premium cursor-pointer ${
            activeTab === 'usages'
              ? 'bg-accent text-white shadow-xs font-bold'
              : 'text-muted hover:text-ink hover:bg-surface2'
          }`}
        >
          <Shapes className="w-4 h-4" />
          Usage
        </button>}

        {shows('nomenclatures') && <button
          id="tab-nomenclatures-btn"
          type="button"
          onClick={() => setActiveTab('nomenclatures')}
          className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold transition-premium cursor-pointer ${
            activeTab === 'nomenclatures'
              ? 'bg-accent text-white shadow-xs font-bold'
              : 'text-muted hover:text-ink hover:bg-surface2'
          }`}
        >
          <BookOpenText className="w-4 h-4" />
          Nomenclatures des Impôts
        </button>}

        {shows('system') && <button
          id="tab-system-btn"
          type="button"
          onClick={() => setActiveTab('system')}
          className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold transition-premium cursor-pointer ${
            activeTab === 'system'
              ? 'bg-accent text-white shadow-xs font-bold'
              : 'text-muted hover:text-ink hover:bg-surface2'
          }`}
        >
          <Database className="w-4 h-4" />
          Offline Persistence & Firestore
        </button>}
      </div>

      {/* TAB 1: TAX RATE SCHEDULE (PHASE 3 PATENTE SCHEDULE) */}
      {activeTab === 'tariffs' && (
        <PatenteRateScheduleView userRole={userRole} />
      )}

      {/* TAB 2: RANG REGISTER — cadastral lot numbers used across the system */}
      {activeTab === 'rangs' && <RangRegistryView />}

      {/* TAB 3: ADDRESS HIERARCHY — ville › commune › quartier › avenue */}
      {activeTab === 'adresses' && <AddressHierarchyView />}

      {/* TAB 4: USAGE REGISTER — declared fiscal uses of a property */}
      {activeTab === 'usages' && <UsageRegistryView />}

      {/* TAB 5: NOMENCLATURES DES IMPÔTS — the reference list of taxes */}
      {activeTab === 'nomenclatures' && <NomenclaturesImpotsView userRole={userRole} />}

      {/* TAB 6: OFFLINE & SYSTEM STATUS */}
      {activeTab === 'system' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">
            Provincial Infrastructure & Offline Engine Specifications
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              <span className="font-bold text-slate-800">Database Engine</span>
              <p className="text-slate-600">Google Cloud Firestore with IndexedDB Multi-Tab Cache</p>
              <div className="font-mono text-[12px] text-slate-500">
                Database ID: {ACTIVE_DATABASE_ID}
              </div>
            </div>

            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              <span className="font-bold text-slate-800">Offline Resilience Profile</span>
              <p className="text-slate-600">
                Fully functional offline read/write with automatic optimistic updates and two-way sync on network recovery.
              </p>
              <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                Multi-Tab Manager Connected
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
