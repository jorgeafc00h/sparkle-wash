import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Star, Building2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { DataTable, ColumnDef } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { Card } from '@/components/common/Card';
import { useAppSelector } from '@/store';
import { selectAllCompanies } from '@/store';
import { selectCurrentTier, selectSelectedCompanyId } from '@/store';
import { Company, CompanyEnvironment } from '@/types/company';
import { SubscriptionTier } from '@/services/subscription/SubscriptionTypes';
import { SubscriptionModal } from '@/components/modals/SubscriptionModal';
import { getMaxCompanies } from '@/services/subscription/FeatureGate';

const TIER_LABELS: Record<SubscriptionTier, string> = {
  [SubscriptionTier.Lite]: 'Free',
  [SubscriptionTier.AdFree]: 'Pro',
  [SubscriptionTier.Pro]: 'Business',
  [SubscriptionTier.ProSync]: 'Pro+Sync',
  [SubscriptionTier.Enterprise]: 'Enterprise',
};

type CompanyRow = Record<string, unknown> & {
  id: string;
  nombreComercial: string;
  nit?: string;
  environment: CompanyEnvironment;
  hasValidCertificate: boolean;
  isDefault: boolean;
  isSelected: boolean;
};

function toRow(c: Company, selectedCompanyId: string | null | undefined): CompanyRow {
  return {
    id: c.id,
    nombreComercial: c.nombreComercial,
    nit: c.nit,
    environment: c.environment,
    hasValidCertificate: c.hasValidCertificate,
    isDefault: c.isDefault,
    isSelected: c.id === selectedCompanyId,
  };
}

export default function CompanyListPage() {
  const navigate = useNavigate();
  const companies = useAppSelector(selectAllCompanies);
  const tier = useAppSelector(selectCurrentTier);
  const selectedCompanyId = useAppSelector(selectSelectedCompanyId);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const limit = getMaxCompanies(tier);
  const atLimit = Number.isFinite(limit) && companies.length >= limit;
  const upgradeTargetTier = tier === SubscriptionTier.Lite
    ? SubscriptionTier.AdFree
    : SubscriptionTier.Pro;
  const upgradeFeatureName = tier === SubscriptionTier.Lite
    ? `Hasta ${getMaxCompanies(SubscriptionTier.AdFree)} empresas`
    : 'Empresas ilimitadas';

  const columns: ColumnDef<CompanyRow>[] = [
    {
      key: 'nombreComercial',
      label: 'Nombre Comercial',
      sortable: true,
      render: (val, row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-brand-900">{String(val)}</span>
          {/* The ACTIVE company is where new DTEs/tickets are created — show it
              explicitly so it can't be confused with the default star. */}
          {row.isSelected && (
            <Badge variant="purple" data-testid={`company-active-${row.id}`}>
              Activa
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'nit',
      label: 'NIT',
      render: (val) => <span className="font-mono text-xs">{String(val ?? '—')}</span>,
    },
    {
      key: 'environment',
      label: 'Ambiente',
      render: (val) => (
        <Badge variant={val === CompanyEnvironment.Production ? 'success' : 'info'}>
          {val === CompanyEnvironment.Production ? 'Producción' : 'Desarrollo'}
        </Badge>
      ),
    },
    {
      key: 'hasValidCertificate',
      label: 'Certificado',
      render: (val) => (
        <Badge variant={val ? 'success' : 'warning'}>
          {val ? 'Válido' : 'Sin certificado'}
        </Badge>
      ),
    },
    {
      key: 'isDefault',
      label: 'Predeterminada',
      render: (val) =>
        val ? (
          <Star size={16} className="text-amber-500 fill-amber-400" />
        ) : (
          <span className="text-brand-300">—</span>
        ),
    },
  ];

  return (
    <div data-testid="company-list">
      <PageHeader
        title="Empresas"
        subtitle="Gestión de empresas registradas"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            onClick={() => navigate('/companies/add')}
            disabled={atLimit}
            data-testid="new-company-btn"
          >
            Nueva Empresa
          </Button>
        }
      />

      {atLimit && tier !== SubscriptionTier.Pro && (
        <Card className="mb-4 bg-amber-50 border-amber-200" data-testid="company-limit-banner">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-amber-800">
              Tu plan <strong>{TIER_LABELS[tier]}</strong> permite hasta{' '}
              <strong>{limit === 1 ? '1 empresa' : `${limit} empresas`}</strong>.
              {tier === SubscriptionTier.Lite
                ? ` Actualiza a Pro para registrar hasta ${getMaxCompanies(SubscriptionTier.AdFree)} empresas.`
                : ' Actualiza a Business para empresas ilimitadas.'}
            </p>
            <Button
              variant="primary"
              size="sm"
              icon={<Star size={14} />}
              onClick={() => setShowUpgrade(true)}
              data-testid="company-limit-upgrade-btn"
            >
              Ver planes
            </Button>
          </div>
        </Card>
      )}

      <SubscriptionModal
        isOpen={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        requiredTier={upgradeTargetTier}
        featureName={upgradeFeatureName}
      />

      {companies.length === 0 ? (
        <EmptyState
          icon={<Building2 size={28} />}
          title="No hay empresas registradas"
          message="Agrega tu primera empresa para comenzar a facturar."
          action={{ label: 'Agregar Empresa', onClick: () => navigate('/companies/add') }}
        />
      ) : (
        <DataTable<CompanyRow>
          columns={columns}
          data={companies.map((c) => toRow(c, selectedCompanyId))}
          onRowClick={(row) => navigate(`/companies/${row.id}`)}
          emptyMessage="No hay empresas que coincidan con la búsqueda."
        />
      )}
    </div>
  );
}
