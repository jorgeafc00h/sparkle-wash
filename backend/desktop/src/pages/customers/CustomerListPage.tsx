import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { SearchBar } from '@/components/common/SearchBar';
import { StickyToolbar } from '@/components/common/StickyToolbar';
import { DataTable, ColumnDef } from '@/components/common/DataTable';
import { Badge } from '@/components/common/Badge';
import { EmptyState } from '@/components/common/EmptyState';
import { useAppSelector, useAppDispatch } from '@/store';
import { selectFilteredCustomers, selectCustomerSearchTerm } from '@/store/selectors/customerSelectors';
import { setSearchTerm } from '@/store/slices/customerSlice';
import { Customer, CustomerType } from '@/types/customer';

const customerTypeLabel: Record<CustomerType, string> = {
  [CustomerType.Individual]: 'Individual',
  [CustomerType.Business]: 'Empresa',
  [CustomerType.Government]: 'Gobierno',
};

const customerTypeVariant: Record<CustomerType, 'info' | 'purple' | 'neutral'> = {
  [CustomerType.Individual]: 'info',
  [CustomerType.Business]: 'purple',
  [CustomerType.Government]: 'neutral',
};

const columns: ColumnDef<Record<string, unknown>>[] = [
  {
    key: 'fullName',
    label: 'Nombre',
    sortable: true,
    render: (_val, row) => {
      const c = row as unknown as Customer;
      return (
        <span className="font-medium text-brand-900">
          {c.businessName || `${c.firstName} ${c.lastName}`}
        </span>
      );
    },
  },
  {
    key: 'nationalId',
    label: 'NIT/DUI',
    sortable: true,
    render: (_val, row) => {
      const c = row as unknown as Customer;
      return (
        <span className="text-brand-600 font-mono text-xs">
          {c.nit || c.nationalId || '—'}
        </span>
      );
    },
  },
  {
    key: 'customerType',
    label: 'Tipo',
    sortable: true,
    render: (_val, row) => {
      const c = row as unknown as Customer;
      return (
        <Badge variant={customerTypeVariant[c.customerType]}>
          {customerTypeLabel[c.customerType]}
        </Badge>
      );
    },
  },
  {
    key: 'phone',
    label: 'Teléfono',
    render: (_val, row) => {
      const c = row as unknown as Customer;
      return <span>{c.phone || '—'}</span>;
    },
  },
  {
    key: 'email',
    label: 'Email',
    render: (_val, row) => {
      const c = row as unknown as Customer;
      return <span className="text-brand-600">{c.email || '—'}</span>;
    },
  },
  {
    key: 'isActive',
    label: 'Estado',
    render: (_val, row) => {
      const c = row as unknown as Customer;
      return c.isActive ? (
        <Badge variant="success">Activo</Badge>
      ) : (
        <Badge variant="error">Inactivo</Badge>
      );
    },
  },
];

export default function CustomerListPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const customers = useAppSelector(selectFilteredCustomers);
  const searchTerm = useAppSelector(selectCustomerSearchTerm);

  function handleSearch(value: string) {
    dispatch(setSearchTerm(value));
  }

  function handleRowClick(row: Record<string, unknown>) {
    const c = row as unknown as Customer;
    navigate(`/customers/${c.id}`);
  }

  const tableData = customers as unknown as Record<string, unknown>[];

  return (
    <div data-testid="customer-list">
      <PageHeader
        title="Clientes"
        subtitle="Gestión de clientes registrados"
        actions={
          <Button
            variant="primary"
            onClick={() => navigate('/customers/add')}
            data-testid="add-customer-btn"
          >
            Agregar Cliente
          </Button>
        }
      />

      <StickyToolbar>
        <SearchBar
          value={searchTerm}
          onChange={handleSearch}
          placeholder="Buscar por nombre, NIT o DUI..."
          data-testid="customer-search"
        />
      </StickyToolbar>

      {customers.length === 0 && !searchTerm ? (
        <EmptyState
          icon={<Users size={28} />}
          title="No hay clientes"
          message="Comience agregando su primer cliente."
          action={{ label: 'Agregar Cliente', onClick: () => navigate('/customers/add') }}
        />
      ) : (
        <DataTable
          columns={columns}
          data={tableData}
          onRowClick={handleRowClick}
          emptyMessage="No se encontraron clientes con ese criterio de búsqueda."
        />
      )}
    </div>
  );
}
