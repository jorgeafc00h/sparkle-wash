import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Building2, Plus } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { useAppSelector } from '@/store';
import { selectAllCompanies } from '@/store';
import { useNavigate } from 'react-router-dom';

/**
 * Route guard: blocks access to pages that require at least one configured
 * company. Hitting a gated URL redirects silently to /home so the user sees
 * the "Configura tu primera empresa" hero card.
 *
 * Use `mode="block"` to render a friendly inline blocker instead of redirecting
 * (used on pages whose sidebar link remains visible).
 */
export function RequireCompany({ mode = 'redirect' }: { mode?: 'redirect' | 'block' }) {
  const companies = useAppSelector(selectAllCompanies);
  const location = useLocation();
  const navigate = useNavigate();

  if (companies.length > 0) return <Outlet />;

  if (mode === 'redirect') {
    return <Navigate to="/home" replace state={{ from: location.pathname }} />;
  }

  return (
    <Card className="max-w-xl mx-auto mt-10 text-center">
      <div className="w-14 h-14 mx-auto rounded-xl bg-accent-600 text-white flex items-center justify-center mb-4">
        <Building2 size={28} />
      </div>
      <h2 className="text-xl font-bold text-brand-900 mb-2">
        Configura tu primera empresa
      </h2>
      <p className="text-sm text-brand-600 mb-5">
        Necesitas al menos una empresa emisora para acceder a esta sección.
      </p>
      <Button
        variant="primary"
        icon={<Plus size={16} />}
        onClick={() => navigate('/companies/add')}
      >
        Configurar empresa
      </Button>
    </Card>
  );
}

export default RequireCompany;
