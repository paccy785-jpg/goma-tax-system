import React, { useState, useEffect, useMemo } from 'react';
import { 
  Award, 
  Search, 
  Filter, 
  Printer, 
  ShieldCheck, 
  AlertOctagon, 
  CheckCircle2, 
  Clock, 
  Calendar, 
  Building2, 
  User, 
  FileText, 
  Copy, 
  QrCode, 
  RefreshCw, 
  ExternalLink, 
  PlusCircle, 
  AlertTriangle, 
  BadgeAlert,
  ArrowUpDown,
  Download,
  Check
} from 'lucide-react';
import {
  BusinessLicenseCertificate,
  CertificateStatus,
  UserRole,
  Assessment,
  ApprovalRequest,
  normalizeAssessmentStatus
} from '../types';
import { 
  getCertificates, 
  subscribeToCertificates,
  getEffectiveCertificateStatus, 
  issueCertificateForAssessment 
} from '../services/certificateService';
import { getAssessments, subscribeToAssessments } from '../services/dbService';
import { OfficialCertificateModal } from './OfficialCertificateModal';
import { RequestRevocationModal } from './RequestRevocationModal';
import { VerifyCertificateView } from './VerifyCertificateView';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';
import { formatMoney } from '../utils/money';

interface CertificatesViewProps {
  currentUser: {
    uid: string;
    displayName: string;
    role: UserRole;
  };
  onNavigateToApprovals?: () => void;
}

export const CertificatesView: React.FC<CertificatesViewProps> = ({
  currentUser,
  onNavigateToApprovals,
}) => {
  const [activeTab, setActiveTab] = useState<'list' | 'verify'>('list');
  const [certificates, setCertificates] = useState<BusinessLicenseCertificate[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  
  // Modals
  const [selectedCertForModal, setSelectedCertForModal] = useState<BusinessLicenseCertificate | null>(null);
  const [selectedCertForRevoke, setSelectedCertForRevoke] = useState<BusinessLicenseCertificate | null>(null);
  const [verifyPrefill, setVerifyPrefill] = useState<{ certNumber?: string; businessName?: string }>({});
  
  // Copied feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  const reloadData = async () => {
    setLoading(true);
    try {
      const [certs, asmts] = await Promise.all([
        getCertificates(),
        getAssessments(),
      ]);
      setCertificates(certs || []);
      setAssessments(asmts || []);
    } catch (err) {
      console.warn('[CertificatesView] Load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadData();

    const unsubCerts = subscribeToCertificates((updatedList) => {
      setCertificates(updatedList || []);
      setLoading(false);
    });

    const unsubAsmts = subscribeToAssessments((updatedAsmts) => {
      setAssessments(updatedAsmts || []);
    });

    return () => {
      unsubCerts();
      unsubAsmts();
    };
  }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {
      setNotification({ type: 'error', message: 'Copy failed — clipboard blocked. Copy manually.' });
    });
  };

  // Find paid assessments without certificate
  const paidAssessmentsWithoutCert = useMemo(() => {
    const existingAsmtNumbers = new Set(certificates.map((c) => c.assessmentNumber).filter(Boolean));
    return assessments.filter((a) => {
      if (!a.assessmentNumber || existingAsmtNumbers.has(a.assessmentNumber)) return false;
      const remaining = typeof a.remainingBalanceUSD === 'number'
        ? a.remainingBalanceUSD
        : ((a.amountDueUSD || 0) - (a.amountPaidUSD || 0));
      const isPaid = normalizeAssessmentStatus(a.status) === 'Paid' && remaining <= 0.01;
      return isPaid;
    });
  }, [assessments, certificates]);

  const handleGenerateMissingCerts = async () => {
    if (paidAssessmentsWithoutCert.length === 0) return;
    setLoading(true);
    let count = 0;
    try {
      for (const asmt of paidAssessmentsWithoutCert) {
        await issueCertificateForAssessment(asmt, {
          uid: currentUser.uid,
          displayName: currentUser.displayName,
          role: currentUser.role,
        });
        count++;
      }
      setNotification({
        type: 'success',
        message: `Issued ${count} new official business license certificate(s).`,
      });
      await reloadData();
    } catch (err) {
      console.error('[Generate Missing Certs] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Derived Metrics
  const metrics = useMemo(() => {
    let validCount = 0;
    let expiredCount = 0;
    let revokedCount = 0;

    certificates.forEach((c) => {
      const eff = getEffectiveCertificateStatus(c);
      if (eff === 'Valid') validCount++;
      else if (eff === 'Expired') expiredCount++;
      else if (eff === 'Revoked') revokedCount++;
    });

    return {
      total: certificates.length,
      validCount,
      expiredCount,
      revokedCount,
    };
  }, [certificates]);

  // Distinct fiscal years in certificates
  const distinctYears = useMemo(() => {
    const set = new Set<number>();
    certificates.forEach((c) => {
      if (c.taxYearCovered) set.add(c.taxYearCovered);
    });
    return Array.from(set).sort((a, b) => b - a);
  }, [certificates]);

  // Filtered certificates
  const filteredCertificates = useMemo(() => {
    return certificates.filter((cert) => {
      const effStatus = getEffectiveCertificateStatus(cert);

      if (statusFilter !== 'all') {
        if (statusFilter === 'valid' && effStatus !== 'Valid') return false;
        if (statusFilter === 'expired' && effStatus !== 'Expired') return false;
        if (statusFilter === 'revoked' && effStatus !== 'Revoked') return false;
      }

      if (yearFilter !== 'all') {
        if (String(cert.taxYearCovered ?? '') !== yearFilter) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const num = (cert.certificateNumber || '').toLowerCase();
        const biz = (cert.businessName || '').toLowerCase();
        const trade = (cert.tradeName || '').toLowerCase();
        const owner = (cert.ownerName || '').toLowerCase();
        const rccm = (cert.businessRegistrationNumber || '').toLowerCase();
        const commune = (cert.commune || '').toLowerCase();
        const quartier = (cert.quartier || '').toLowerCase();
        const sector = (cert.activitySector || '').toLowerCase();

        return (
          num.includes(q) ||
          biz.includes(q) ||
          trade.includes(q) ||
          owner.includes(q) ||
          rccm.includes(q) ||
          commune.includes(q) ||
          quartier.includes(q) ||
          sector.includes(q)
        );
      }

      return true;
    });
  }, [certificates, statusFilter, yearFilter, searchQuery]);

  const handleRevocationSubmitted = (req: ApprovalRequest) => {
    setSelectedCertForRevoke(null);
    setNotification({
      type: 'info',
      message: `Revocation request (${req.id}) submitted to Maker-Checker queue. Awaiting Supervisor authorization.`,
    });
    reloadData();
  };

  const handleOpenVerifyTab = (certNumber: string, businessName?: string) => {
    setVerifyPrefill({ certNumber, businessName });
    setActiveTab('verify');
    if (selectedCertForModal) setSelectedCertForModal(null);
  };

  return (
    <div id="certificates-view-root" className="space-y-8 font-sans">
      
      {/* Top PageHeader */}
      <PageHeader
        eyebrow="Licensing"
        title="Business License Certificates (Patentes)"
        description="Issuance, secure archiving, and compliance verification of DPRNK business licenses issued to compliant taxpayers in Goma."
        actions={
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={reloadData}
              disabled={loading}
              icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
            >
              Refresh
            </Button>

            {paidAssessmentsWithoutCert.length > 0 && (
              <Button
                variant="primary"
                size="md"
                onClick={handleGenerateMissingCerts}
                disabled={loading}
                icon={<PlusCircle className="w-4 h-4" />}
                title="Generate licenses for all settled assessments"
              >
                Issue ({paidAssessmentsWithoutCert.length}) Pending
              </Button>
            )}
          </>
        }
      />

      {/* Notification banner */}
      {notification && (
        <div className={`p-4 rounded-[14px] text-xs flex items-center justify-between gap-3 transition-premium ${
          notification.type === 'success' 
            ? 'bg-sage/15 border border-sage/30 text-ink' 
            : 'bg-accent-soft/70 border border-line text-ink'
        }`}>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-sage" />
            <span className="font-semibold">{notification.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-muted hover:text-ink font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Metric Summary Strip */}
      <MetricStrip
        columns={4}
        items={[
          {
            label: 'Total Licenses',
            value: metrics.total.toString(),
            trend: 'Registered certificates',
            trendType: 'muted',
            subline: 'Official municipal register',
            icon: <Award className="w-4 h-4 text-accent" />,
          },
          {
            label: 'Valid & Active',
            value: metrics.validCount.toString(),
            trend: 'Statutorily current',
            trendType: 'sage',
            subline: 'Authorized trading rights',
            icon: <CheckCircle2 className="w-4 h-4 text-sage" />,
          },
          {
            label: 'Expired',
            value: metrics.expiredCount.toString(),
            trend: metrics.expiredCount > 0 ? 'Pending renewal' : 'None',
            trendType: metrics.expiredCount > 0 ? 'warn' : 'muted',
            subline: 'Past annual close',
            icon: <Clock className="w-4 h-4 text-warn" />,
          },
          {
            label: 'Revoked',
            value: metrics.revokedCount.toString(),
            trend: metrics.revokedCount > 0 ? 'Audit sanction' : 'None',
            trendType: metrics.revokedCount > 0 ? 'danger' : 'muted',
            subline: 'Maker-Checker revocations',
            icon: <AlertOctagon className="w-4 h-4 text-danger" />,
          },
        ]}
      />

      {/* Main Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-line pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('list')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold transition-premium cursor-pointer ${
            activeTab === 'list'
              ? 'bg-accent text-white shadow-xs font-bold'
              : 'text-muted hover:text-ink hover:bg-surface2'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>License Registry ({certificates.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('verify')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold transition-premium cursor-pointer ${
            activeTab === 'verify'
              ? 'bg-accent text-white shadow-xs font-bold'
              : 'text-muted hover:text-ink hover:bg-surface2'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Certificate Verification (Lookup)</span>
        </button>
      </div>

      {/* TAB CONTENT 1: REGISTRY LIST */}
      {activeTab === 'list' && (
        <Panel
          title="Issued Business License Certificates"
          subtitle={`Displaying ${filteredCertificates.length} of ${certificates.length} municipal licenses in registry`}
          padding="none"
        >
          {/* Filters and Search Bar */}
          <div 
            id="certificates-filter-bar"
            className="p-4 border-b border-line flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-surface"
          >
            {/* Search input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2 text-xs bg-surface2 border border-line rounded-[10px] focus:ring-2 focus:ring-accent focus:border-accent text-ink placeholder:text-muted transition-premium font-sans"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-ink cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Filter Dropdowns */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {/* Status filter */}
              <div className="flex items-center gap-1.5 text-xs text-muted bg-surface2 px-3 py-1.5 rounded-[10px] border border-line">
                <Filter className="w-3.5 h-3.5 text-muted" />
                <span className="font-semibold text-ink">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-transparent font-bold text-ink focus:outline-none cursor-pointer font-sans"
                >
                  <option value="all">All ({certificates.length})</option>
                  <option value="valid">Valid ({metrics.validCount})</option>
                  <option value="expired">Expired ({metrics.expiredCount})</option>
                  <option value="revoked">Revoked ({metrics.revokedCount})</option>
                </select>
              </div>

              {/* Tax Year filter */}
              <div className="flex items-center gap-1.5 text-xs text-muted bg-surface2 px-3 py-1.5 rounded-[10px] border border-line">
                <Calendar className="w-3.5 h-3.5 text-muted" />
                <span className="font-semibold text-ink">Fiscal Year:</span>
                <select
                  value={yearFilter}
                  onChange={(e) => setYearFilter(e.target.value)}
                  className="bg-transparent font-bold text-ink focus:outline-none cursor-pointer font-sans"
                >
                  <option value="all">All Years</option>
                  {distinctYears.map((yr) => (
                    <option key={yr} value={yr.toString()}>{yr}</option>
                  ))}
                </select>
              </div>

              {(searchQuery || statusFilter !== 'all' || yearFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('all');
                    setYearFilter('all');
                  }}
                  className="px-3 py-1.5 text-xs text-accent hover:text-accent-dark transition-premium cursor-pointer font-medium"
                >
                  Reset Filters
                </button>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto">
            <table className="premium-table w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-surface2/60 text-faint font-bold uppercase tracking-[0.1em] text-[11px] border-b border-line">
                  <th className="py-3 px-4">License / Cert #</th>
                  <th className="py-3 px-4">Business & Taxpayer</th>
                  <th className="py-3 px-4">Sector / Class</th>
                  <th className="py-3 px-4">Fiscal Year & Expiry</th>
                  <th className="py-3 px-4">Tax Paid</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink">
                {filteredCertificates.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted">
                      <Award className="w-8 h-8 mx-auto mb-2 text-faint stroke-[1.5]" />
                      <p className="font-semibold text-ink">No matching license certificates found</p>
                      <p className="text-[12px] text-muted mt-1">
                        Try adjusting your search filters or generate licenses for settled assessments.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredCertificates.map((cert) => {
                    const effStatus = getEffectiveCertificateStatus(cert);
                    const isValid = effStatus === 'Valid';
                    const isExpired = effStatus === 'Expired';
                    const isRevoked = effStatus === 'Revoked';
                    const initials = (cert.businessName || '')
                      .split(' ')
                      .map((w) => w[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join('')
                      .toUpperCase() || 'GP';

                    return (
                      <tr 
                        key={cert.id} 
                        className="hover:bg-surface2/40 transition-premium"
                      >
                        {/* Certificate Number with Copy button */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-ink tabular-nums">
                              {cert.certificateNumber}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(cert.certificateNumber, cert.id)}
                              className="p-1 text-muted hover:text-ink transition-premium cursor-pointer"
                              title="Copy certificate number"
                            >
                              {copiedId === cert.id ? (
                                <Check className="w-3 h-3 text-sage" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                          <span className="text-[11px] text-muted font-mono tabular-nums">
                            Notice: {cert.assessmentNumber}
                          </span>
                        </td>

                        {/* Business Name & Owner with Initials Tile */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-[30px] h-[30px] rounded-[8px] bg-accent-soft text-accent font-display font-bold text-xs flex items-center justify-center shrink-0">
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-ink text-xs truncate">
                                {cert.businessName}
                              </div>
                              <div className="text-[12px] text-muted flex items-center gap-1.5 mt-0.5 truncate">
                                <span>Owner: {cert.ownerName}</span>
                                <span>•</span>
                                <span className="font-mono text-muted">{cert.businessRegistrationNumber}</span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Sector & Size Class */}
                        <td className="py-3.5 px-4">
                          <div className="capitalize font-semibold text-ink">
                            {cert.activitySector}
                          </div>
                          <div className="text-[12px] text-muted">
                            Class {cert.sizeClass} • {cert.commune}
                          </div>
                        </td>

                        {/* Tax Year & Expiry Date */}
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-ink tabular-nums">
                            Fiscal Year {cert.taxYearCovered}
                          </div>
                          <div className="text-[12px] text-muted flex items-center gap-1">
                            <span>Expires:</span>
                            <strong className={isExpired ? 'text-warn font-bold tabular-nums' : 'text-ink tabular-nums'}>
                              {cert.expiryDate}
                            </strong>
                          </div>
                        </td>

                        {/* Amount Paid */}
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-ink tabular-nums">
                            {formatMoney(cert.amountPaidUSD)}
                          </div>
                        </td>

                        {/* Status Badge */}
                        <td className="py-3.5 px-4 text-center">
                          <Badge 
                            variant={isValid ? 'sage' : isExpired ? 'warn' : 'danger'}
                            size="sm"
                          >
                            {isValid && <CheckCircle2 className="w-3 h-3 mr-1 inline" />}
                            {isExpired && <Clock className="w-3 h-3 mr-1 inline" />}
                            {isRevoked && <AlertOctagon className="w-3 h-3 mr-1 inline" />}
                            {isValid ? 'VALID' : isExpired ? 'EXPIRED' : 'REVOKED'}
                          </Badge>
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Open Printable Certificate */}
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => setSelectedCertForModal(cert)}
                              icon={<Printer className="w-3.5 h-3.5" />}
                              title="View and print official license certificate"
                            >
                              View & Print
                            </Button>

                            {/* Request Revocation via Maker-Checker */}
                            {isValid && (
                              <button
                                type="button"
                                onClick={() => setSelectedCertForRevoke(cert)}
                                className="p-1.5 rounded-[10px] text-danger hover:bg-danger/10 border border-line transition-premium cursor-pointer"
                                title="Request administrative revocation (Maker-Checker)"
                              >
                                <AlertOctagon className="w-3.5 h-3.5 text-danger" />
                              </button>
                            )}

                            {/* Quick Verify */}
                            <button
                              type="button"
                              onClick={() => handleOpenVerifyTab(cert.certificateNumber, cert.businessName)}
                              className="p-1.5 rounded-[10px] text-muted hover:text-ink hover:bg-surface2 border border-line transition-premium cursor-pointer"
                              title="Verify validity on security lookup portal"
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-sage" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="px-4 py-3 bg-surface2/50 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted">
            <span>
              Showing <strong className="text-ink">{filteredCertificates.length}</strong> of <strong className="text-ink">{certificates.length}</strong> certificates in registry
            </span>
            <div className="flex items-center gap-4 text-[12px]">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-sage" />
                <span>Active & Certified</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-warn" />
                <span>Expired (Annual close)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-danger" />
                <span>Revoked via Maker-Checker</span>
              </span>
            </div>
          </div>
        </Panel>
      )}

      {/* TAB CONTENT 2: VERIFICATION LOOKUP */}
      {activeTab === 'verify' && (
        <VerifyCertificateView
          initialCertNumber={verifyPrefill.certNumber}
          initialBusinessName={verifyPrefill.businessName}
          onViewCertificate={(c) => {
            setSelectedCertForModal(c);
          }}
        />
      )}

      {/* MODAL: Printable Certificate View */}
      {selectedCertForModal && (
        <OfficialCertificateModal
          certificate={selectedCertForModal}
          currentUserRole={currentUser.role}
          onClose={() => setSelectedCertForModal(null)}
          onVerify={(certNum, biz) => handleOpenVerifyTab(certNum, biz)}
          onRequestRevocation={(c) => {
            setSelectedCertForModal(null);
            setSelectedCertForRevoke(c);
          }}
        />
      )}

      {/* MODAL: Maker-Checker Revocation Request */}
      {selectedCertForRevoke && (
        <RequestRevocationModal
          certificate={selectedCertForRevoke}
          currentUser={currentUser}
          onClose={() => setSelectedCertForRevoke(null)}
          onSubmitted={handleRevocationSubmitted}
        />
      )}
    </div>
  );
};
