import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CalendarClock, CreditCard, Search, WalletCards } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { DataTable, ColumnDef } from '@/components/common/DataTable';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { useToast } from '@/components/common/Toast';
import { PaymentModal } from '@/components/accounts/PaymentModal';
import { AccountsLedgerService } from '@/services/accounts/AccountsLedgerService';
import {
  selectAccountSummary,
  selectAccountsActiveDirection,
  selectAccountsError,
  selectAllCustomers,
  selectAllInvoices,
  selectLedgerCompras,
  selectCurrentCompany,
  selectFilteredAccounts,
  useAppDispatch,
  useAppSelector,
} from '@/store';
import {
  initComprasDatabase,
  loadCompras,
} from '@/store/slices/comprasSlice';
import {
  reconcileAccountsFromDocuments,
  recordAccountPayment,
  setAccountsActiveDirection,
  setAccountsSearchTerm,
  setAccountsStatusFilter,
} from '@/store/slices/accountsSlice';
import { AccountDirection, AccountEntry, AccountStatus } from '@/types/accounts';

type AccountRow = Record<string, unknown> & {
  id: string;
  party: string;
  documentNumber: string;
  issueDate: string;
  dueDate: string;
  originalAmount: number;
  adjustmentAmount: number;
  paidAmount: number;
  balance: number;
  agingBucket: string;
  status: AccountStatus;
};

const currency = new Intl.NumberFormat('es-SV', {
  style: 'currency',
  currency: 'USD',
});

const shortDate = new Intl.DateTimeFormat('es-SV', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

// Parse the ISO date as a local date (append midnight) so a YYYY-MM-DD value
// is not shifted a day backward by UTC conversion.
function formatIsoDate(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : shortDate.format(date);
}

const STATUS_VARIANT: Record<AccountStatus, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  open: 'info',
  partial: 'warning',
  paid: 'success',
  overdue: 'error',
  void: 'neutral',
};

function toRow(entry: AccountEntry): AccountRow {
  return {
    id: entry.id,
    party: entry.party.name,
    documentNumber: entry.documentNumber,
    issueDate: entry.issueDate,
    dueDate: entry.dueDate,
    originalAmount: entry.originalAmount + entry.adjustmentAmount,
    adjustmentAmount: entry.adjustmentAmount,
    paidAmount: entry.paidAmount,
    balance: entry.balance,
    agingBucket: AccountsLedgerService.agingLabel(entry.agingBucket),
    status: entry.status,
  };
}

function metric(label: string, value: number, icon: ReactNode, tone: string, testId: string) {
  return (
    <Card className="flex items-center gap-4" data-testid={testId}>
      <div className={`${tone} p-3 rounded-lg shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-sm text-brand-500 truncate">{label}</p>
        <p className="text-2xl font-bold text-brand-900 truncate">{currency.format(value)}</p>
      </div>
    </Card>
  );
}

export default function AccountsPage() {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const currentCompany = useAppSelector(selectCurrentCompany);
  const invoices = useAppSelector(selectAllInvoices);
  const compras = useAppSelector(selectLedgerCompras);
  const customers = useAppSelector(selectAllCustomers);
  const activeDirection = useAppSelector(selectAccountsActiveDirection);
  const summary = useAppSelector(selectAccountSummary(currentCompany?.id));
  const entries = useAppSelector(selectFilteredAccounts(currentCompany?.id, activeDirection));
  const accountsError = useAppSelector(selectAccountsError);

  const [selectedEntry, setSelectedEntry] = useState<AccountEntry | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!currentCompany?.id) return;
    setIsLoading(true);
    void dispatch(initComprasDatabase())
      .unwrap()
      .then(() => dispatch(loadCompras(currentCompany.id)).unwrap())
      .catch((error) => {
        toast.error(error?.message || 'No se pudieron cargar las compras para cuentas por pagar');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [currentCompany?.id, dispatch, toast]);

  useEffect(() => {
    if (!currentCompany?.id) return;
    dispatch(
      reconcileAccountsFromDocuments({
        companyId: currentCompany.id,
        invoices,
        compras,
        customers,
      }),
    );
  }, [compras, currentCompany?.id, customers, dispatch, invoices]);

  useEffect(() => {
    if (accountsError) toast.error(accountsError);
  }, [accountsError, toast]);

  const columns: ColumnDef<AccountRow>[] = useMemo(
    () => [
      { key: 'party', label: activeDirection === 'receivable' ? 'Cliente' : 'Proveedor', sortable: true },
      { key: 'documentNumber', label: 'Documento', sortable: true },
      { key: 'issueDate', label: 'Emisión', sortable: true, render: (value) => formatIsoDate(value) },
      { key: 'dueDate', label: 'Vencimiento', sortable: true, render: (value) => formatIsoDate(value) },
      {
        key: 'originalAmount',
        label: 'Total ajustado',
        sortable: true,
        render: (value, row) => {
          const adjustment = Number(row.adjustmentAmount) || 0;
          return (
            <span className="inline-flex items-center gap-1.5">
              {currency.format(Number(value))}
              {adjustment !== 0 && (
                <span
                  className="text-xs text-brand-500"
                  title={`Incluye ajustes por notas de crédito/débito: ${currency.format(adjustment)}`}
                >
                  ({adjustment > 0 ? '+' : ''}{currency.format(adjustment)})
                </span>
              )}
            </span>
          );
        },
      },
      {
        key: 'paidAmount',
        label: activeDirection === 'receivable' ? 'Cobrado' : 'Pagado',
        sortable: true,
        render: (value) => currency.format(Number(value)),
      },
      {
        key: 'balance',
        label: 'Saldo',
        sortable: true,
        render: (value) => <span className="font-semibold">{currency.format(Number(value))}</span>,
      },
      { key: 'agingBucket', label: 'Antigüedad' },
      {
        key: 'status',
        label: 'Estado',
        render: (value) => {
          const status = value as AccountStatus;
          return (
            <Badge variant={STATUS_VARIANT[status]}>
              {AccountsLedgerService.statusLabel(status)}
            </Badge>
          );
        },
      },
    ],
    [activeDirection],
  );

  const rows = entries.map(toRow);
  const activeTitle = activeDirection === 'receivable' ? 'Cuentas por cobrar' : 'Cuentas por pagar';

  function openPayment(row: AccountRow) {
    const entry = entries.find((item) => item.id === row.id) ?? null;
    setSelectedEntry(entry);
    setPaymentOpen(!!entry);
  }

  function submitPayment(input: {
    paymentDate: string;
    amount: number;
    methodCode: string;
    reference?: string;
    notes?: string;
  }) {
    if (!selectedEntry) return;
    const liveEntry = entries.find((item) => item.id === selectedEntry.id);
    if (!liveEntry) {
      toast.error('Cuenta no encontrada');
      return;
    }
    const validation = AccountsLedgerService.validatePayment(liveEntry, input.amount);
    if (validation) {
      toast.error(validation);
      return;
    }
    dispatch(
      recordAccountPayment({
        entryId: liveEntry.id,
        companyId: liveEntry.companyId,
        direction: liveEntry.direction,
        paymentDate: input.paymentDate,
        amount: input.amount,
        methodCode: input.methodCode,
        reference: input.reference,
        notes: input.notes,
      }),
    );
    toast.success(
      liveEntry.direction === 'receivable'
        ? 'Cobro registrado'
        : 'Pago registrado',
    );
    setPaymentOpen(false);
    setSelectedEntry(null);
  }

  return (
    <div data-testid="cuentas.desktop" className="space-y-6">
      <PageHeader
        title="Cobros y pagos"
        subtitle="Seguimiento local de cuentas por cobrar y por pagar"
        actions={
          <Button
            variant="secondary"
            icon={<WalletCards size={16} />}
            onClick={() => dispatch(reconcileAccountsFromDocuments({
              companyId: currentCompany?.id ?? '',
              invoices,
              compras,
              customers,
            }))}
            disabled={!currentCompany?.id}
            data-testid="cuentas.reconcile"
          >
            Actualizar
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {metric('Por cobrar', summary.receivableTotal, <ArrowDownToLine size={22} />, 'bg-green-50 text-green-600', 'cuentas.summary.receivable')}
        {metric('Cobros vencidos', summary.receivableOverdue, <CalendarClock size={22} />, 'bg-red-50 text-red-600', 'cuentas.summary.receivableOverdue')}
        {metric('Por pagar', summary.payableTotal, <ArrowUpFromLine size={22} />, 'bg-blue-50 text-blue-600', 'cuentas.summary.payable')}
        {metric('Pagos vencidos', summary.payableOverdue, <CalendarClock size={22} />, 'bg-amber-50 text-amber-600', 'cuentas.summary.payableOverdue')}
      </div>

      <Card padding="none">
        <div className="px-5 py-4 border-b border-brand-100 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold text-brand-900">{activeTitle}</h2>
            <p className="text-sm text-brand-500">
              {activeDirection === 'receivable'
                ? `${summary.receivableCount} cuentas activas`
                : `${summary.payableCount} cuentas activas`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-brand-200 bg-brand-50 p-1">
              <button
                type="button"
                onClick={() => dispatch(setAccountsActiveDirection('receivable'))}
                data-testid="cuentas.segment.porCobrar"
                className={[
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  activeDirection === 'receivable'
                    ? 'bg-white text-brand-900 shadow-sm'
                    : 'text-brand-500 hover:text-brand-800',
                ].join(' ')}
              >
                Por cobrar
              </button>
              <button
                type="button"
                onClick={() => dispatch(setAccountsActiveDirection('payable'))}
                data-testid="cuentas.segment.porPagar"
                className={[
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  activeDirection === 'payable'
                    ? 'bg-white text-brand-900 shadow-sm'
                    : 'text-brand-500 hover:text-brand-800',
                ].join(' ')}
              >
                Por pagar
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-b border-brand-100 grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
          <Input
            aria-label="Buscar cuentas"
            placeholder="Buscar por cliente, proveedor, NIT o documento"
            onChange={(event) => dispatch(setAccountsSearchTerm(event.target.value))}
            rightAddon={<Search size={16} className="text-brand-400" />}
            data-testid="cuentas.search"
          />
          <Select
            aria-label="Filtrar cuentas por estado"
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'open', label: 'Al día' },
              { value: 'overdue', label: 'Vencidas' },
              { value: 'partial', label: 'Parciales' },
              { value: 'paid', label: 'Pagadas' },
            ]}
            defaultValue="all"
            onChange={(event) => dispatch(setAccountsStatusFilter(event.target.value as 'all' | AccountStatus))}
            data-testid="cuentas.statusFilter"
          />
        </div>

        <div className="p-4">
          <DataTable<AccountRow>
            columns={columns}
            data={rows}
            loading={isLoading}
            emptyMessage={`No hay ${activeDirection === 'receivable' ? 'cuentas por cobrar' : 'cuentas por pagar'} para mostrar.`}
            onRowClick={openPayment}
          />
          {rows.length > 0 && (
            <p className="mt-3 text-xs text-brand-500">
              Selecciona una fila para {activeDirection === 'receivable' ? 'registrar un cobro' : 'registrar un pago'}.
            </p>
          )}
        </div>
      </Card>

      <PaymentModal
        entry={selectedEntry}
        isOpen={paymentOpen}
        onClose={() => {
          setPaymentOpen(false);
          setSelectedEntry(null);
        }}
        onSubmit={submitPayment}
      />

      <Card className="bg-brand-50 border-brand-200">
        <div className="flex items-start gap-3">
          <CreditCard size={18} className="text-brand-500 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-brand-800">Registro local primero</p>
            <p className="text-sm text-brand-600 mt-1">
              Los cobros y pagos actualizan el saldo de la cuenta sin cambiar los totales fiscales del DTE o de la compra.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
