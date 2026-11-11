// LinkCompraModal — links a compra (purchase) to a sales invoice or a
// customer of the same company. Modeled on ImportFromImageModal.tsx for the
// shell/styling conventions (Modal + Button + Input + useToast).
//
// Selecting an invoice auto-fills the linked customer from the invoice's
// own customer (or clears it when the invoice has none). Selecting a
// customer directly clears any invoice link (single-link rule — see
// spec-shared-contract.md).

import { useEffect, useMemo, useState } from 'react';
import { FileText, User } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { useToast } from '@/components/common/Toast';
import { InvoiceTypeBadge } from '@/components/invoices/InvoiceTypeBadge';
import { InvoiceStatusBadge } from '@/components/invoices/InvoiceStatusBadge';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectAllInvoices } from '@/store/selectors/invoiceSelectors';
import { selectAllCustomers } from '@/store/selectors/customerSelectors';
import { updateCompraLink } from '@/store/slices/comprasSlice';
import type { Compra } from '@/types/compras';

type LinkTab = 'invoices' | 'customers';

export interface LinkCompraModalProps {
  isOpen: boolean;
  onClose: () => void;
  compra: Compra;
  /** Which tab to open on — set by which button the user clicked. */
  initialTab?: LinkTab;
}

export function LinkCompraModal({ isOpen, onClose, compra, initialTab = 'invoices' }: LinkCompraModalProps) {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const allInvoices = useAppSelector(selectAllInvoices);
  const allCustomers = useAppSelector(selectAllCustomers);

  const [tab, setTab] = useState<LinkTab>(initialTab);
  const [search, setSearch] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(compra.linkedInvoiceId ?? null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    compra.linkedInvoiceId ? null : compra.linkedCustomerId ?? null,
  );
  const [note, setNote] = useState(compra.linkNote ?? '');
  const [saving, setSaving] = useState(false);

  // Reset local selection state whenever the modal re-opens (or a different
  // compra is targeted) so stale selections from a previous open don't leak.
  useEffect(() => {
    if (!isOpen) return;
    setTab(initialTab);
    setSearch('');
    setSelectedInvoiceId(compra.linkedInvoiceId ?? null);
    setSelectedCustomerId(compra.linkedInvoiceId ? null : compra.linkedCustomerId ?? null);
    setNote(compra.linkNote ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, compra.id, initialTab]);

  // Options are scoped to the compra's own company — never show
  // invoices/customers belonging to a different company.
  const companyInvoices = useMemo(
    () => allInvoices.filter((inv) => inv.companyId === compra.companyId),
    [allInvoices, compra.companyId],
  );
  const companyCustomers = useMemo(
    () => allCustomers.filter((c) => c.companyId === compra.companyId),
    [allCustomers, compra.companyId],
  );

  const filteredInvoices = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return companyInvoices;
    return companyInvoices.filter((inv) =>
      [inv.invoiceNumber, inv.controlNumber, inv.generationCode]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
    );
  }, [companyInvoices, search]);

  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return companyCustomers;
    return companyCustomers.filter((c) => {
      const name = c.businessName || `${c.firstName ?? ''} ${c.lastName ?? ''}`;
      return (
        name.toLowerCase().includes(term) ||
        (c.nit ?? '').toLowerCase().includes(term) ||
        (c.nationalId ?? '').toLowerCase().includes(term)
      );
    });
  }, [companyCustomers, search]);

  const canSave = tab === 'invoices' ? !!selectedInvoiceId : !!selectedCustomerId;

  async function handleSave() {
    setSaving(true);
    try {
      if (tab === 'invoices' && selectedInvoiceId) {
        const invoice = companyInvoices.find((inv) => inv.id === selectedInvoiceId);
        await dispatch(
          updateCompraLink({
            id: compra.id,
            companyId: compra.companyId,
            link: {
              linkedInvoiceId: selectedInvoiceId,
              linkedCustomerId: invoice?.customerId ?? null,
              linkNote: note.trim() || null,
            },
          }),
        ).unwrap();
      } else if (tab === 'customers' && selectedCustomerId) {
        await dispatch(
          updateCompraLink({
            id: compra.id,
            companyId: compra.companyId,
            link: {
              linkedInvoiceId: null,
              linkedCustomerId: selectedCustomerId,
              linkNote: note.trim() || null,
            },
          }),
        ).unwrap();
      } else {
        return;
      }
      toast.success('Vinculación guardada correctamente.');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar la vinculación.');
    } finally {
      setSaving(false);
    }
  }

  const footer = (
    <div className="flex items-center gap-2 w-full justify-end">
      <Button variant="secondary" onClick={onClose} disabled={saving}>
        Cancelar
      </Button>
      <Button
        variant="primary"
        onClick={handleSave}
        disabled={saving || !canSave}
        loading={saving}
        data-testid="link-compra-save"
      >
        Guardar
      </Button>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Vincular compra" size="md" footer={footer}>
      <div data-testid="link-compra-modal" className="space-y-4">
        <div className="flex gap-2 border-b border-brand-100">
          <button
            type="button"
            onClick={() => setTab('invoices')}
            data-testid="link-compra-tab-invoices"
            className={[
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === 'invoices'
                ? 'border-accent-600 text-accent-700'
                : 'border-transparent text-brand-500 hover:text-brand-700',
            ].join(' ')}
          >
            Facturas
          </button>
          <button
            type="button"
            onClick={() => setTab('customers')}
            data-testid="link-compra-tab-customers"
            className={[
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === 'customers'
                ? 'border-accent-600 text-accent-700'
                : 'border-transparent text-brand-500 hover:text-brand-700',
            ].join(' ')}
          >
            Clientes
          </button>
        </div>

        <Input
          placeholder={tab === 'invoices' ? 'Buscar factura por número...' : 'Buscar cliente por nombre o NIT...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="max-h-64 overflow-y-auto space-y-1 border border-brand-100 rounded-lg p-1">
          {tab === 'invoices' ? (
            filteredInvoices.length === 0 ? (
              <p className="text-sm text-brand-400 text-center py-6">No hay facturas para esta empresa.</p>
            ) : (
              filteredInvoices.map((inv) => (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => setSelectedInvoiceId(inv.id)}
                  data-testid={`link-compra-option-${inv.id}`}
                  className={[
                    'w-full flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    selectedInvoiceId === inv.id
                      ? 'bg-accent-50 border border-accent-300'
                      : 'hover:bg-brand-50 border border-transparent',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <FileText size={14} className="text-brand-400 shrink-0" />
                    <span className="truncate">{inv.controlNumber || inv.invoiceNumber}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <InvoiceTypeBadge type={inv.invoiceType} />
                    <InvoiceStatusBadge status={inv.status} />
                  </span>
                </button>
              ))
            )
          ) : filteredCustomers.length === 0 ? (
            <p className="text-sm text-brand-400 text-center py-6">No hay clientes para esta empresa.</p>
          ) : (
            filteredCustomers.map((c) => {
              const name = c.businessName || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCustomerId(c.id)}
                  data-testid={`link-compra-option-${c.id}`}
                  className={[
                    'w-full flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    selectedCustomerId === c.id
                      ? 'bg-accent-50 border border-accent-300'
                      : 'hover:bg-brand-50 border border-transparent',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <User size={14} className="text-brand-400 shrink-0" />
                    <span className="truncate">{name || '—'}</span>
                  </span>
                  <span className="text-xs text-brand-400 shrink-0">{c.nit || c.nationalId || '—'}</span>
                </button>
              );
            })
          )}
        </div>

        <Input
          label="Nota (opcional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          data-testid="link-compra-note"
          placeholder="Agrega una nota sobre esta vinculación..."
        />
      </div>
    </Modal>
  );
}

export default LinkCompraModal;
