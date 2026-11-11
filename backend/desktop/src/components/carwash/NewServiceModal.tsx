// "Nuevo servicio" — opens a walk-in job (works offline: the slice creates a
// local job and queues it), then auto-prints the work ticket when enabled.

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Select } from '@/components/common/Select';
import { useToast } from '@/components/common/Toast';
import { useAppDispatch, useAppSelector } from '@/store';
import {
  createWalkInJob,
  selectCarwashEmployees,
  selectCarwashPackages,
  selectCarwashSettings,
} from '@/store/slices/carwashSlice';
import type { CarwashJob, Employee, PackageCatalog } from '@/services/carwash/types';
import { isValidPlate, normalizePlate, packagePrice } from './carwashUi';
import { useWorkTicketPrinter } from './useWorkTicketPrinter';

interface NewServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (job: CarwashJob) => void;
}

export function NewServiceModal({ isOpen, onClose, onCreated }: NewServiceModalProps) {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const catalog = useAppSelector(selectCarwashPackages) as PackageCatalog | null | undefined;
  const employees = (useAppSelector(selectCarwashEmployees) as Employee[] | undefined) ?? [];
  const carwash = useAppSelector(selectCarwashSettings);
  const { print } = useWorkTicketPrinter();

  const [plate, setPlate] = useState('');
  const [classId, setClassId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const classes = catalog?.vehicleClasses ?? [];
  const packages = catalog?.packages ?? [];
  const activeEmployees = useMemo(() => employees.filter((e) => e.active !== false), [employees]);

  useEffect(() => {
    if (!isOpen) return;
    setPlate('');
    setPackageId('');
    setEmployeeId('');
    setCustomerName('');
    setNote('');
    setTouched(false);
    setSaving(false);
    setClassId(classes[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !classId && classes[0]) setClassId(classes[0].id);
  }, [isOpen, classId, classes]);

  const plateValid = isValidPlate(plate);
  const selectedPackage = packages.find((p) => p.id === packageId);
  const selectedPrice = selectedPackage ? packagePrice(selectedPackage, classId) : null;
  const canSubmit = plateValid && !!classId && !!selectedPackage && selectedPrice !== null && !saving;

  async function submit() {
    setTouched(true);
    if (!canSubmit) return;
    setSaving(true);
    try {
      const job = await dispatch(
        createWalkInJob({
          plate,
          vehicleClass: classId,
          packageId,
          employeeId: employeeId || undefined,
          customerName: customerName.trim() || undefined,
          note: note.trim() || undefined,
        }),
      ).unwrap();
      onCreated?.(job);
      onClose();
      toast.success(`Servicio creado — ${job.plate} · ${job.ticketNumber ?? 'sin número'}`);
      if (carwash.autoPrintWorkTicket) {
        const result = await print(job);
        if (!result.ok) toast.warning(`Servicio guardado — no se imprimió el ticket: ${result.error}`);
      }
    } catch (err) {
      toast.error(`No se pudo crear el servicio: ${err instanceof Error ? err.message : String(err)}`);
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Nuevo servicio"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} data-testid="carwash-cancel">Cancelar</Button>
          <Button onClick={() => void submit()} disabled={!canSubmit} loading={saving} data-testid="carwash-create">
            {carwash.autoPrintWorkTicket ? 'Crear e imprimir ticket' : 'Crear servicio'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input
          label="Placa"
          id="carwash-plate"
          data-testid="carwash-plate-input"
          value={plate}
          autoComplete="off"
          autoFocus
          placeholder="P123-456"
          className="uppercase font-mono text-lg tracking-wider"
          onChange={(e) => setPlate(normalizePlate(e.target.value))}
          error={touched && !plateValid ? 'Ingresa una placa válida (3–10 letras o números)' : undefined}
        />

        <div>
          <p className="text-sm font-medium text-brand-700 mb-1">Tipo de vehículo</p>
          {classes.length === 0 ? (
            <p className="text-sm text-slate-500">Sin catálogo — sincroniza para cargar los tipos de vehículo.</p>
          ) : (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de vehículo">
              {classes.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={classId === c.id}
                  data-testid={`carwash-class-${c.id}`}
                  onClick={() => setClassId(c.id)}
                  className={`px-3 py-1.5 rounded-full text-sm border ${classId === c.id ? 'bg-accent-600 text-white border-accent-600' : 'bg-white text-brand-700 border-brand-300 hover:bg-brand-50'}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-brand-700 mb-1">Paquete</p>
          {packages.length === 0 ? (
            <p className="text-sm text-slate-500">Sin paquetes en caché. Conéctate para descargar el catálogo.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Paquete">
              {packages.map((p) => {
                const price = packagePrice(p, classId);
                const selected = packageId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={price === null}
                    data-testid={`carwash-package-${p.id}`}
                    onClick={() => setPackageId(p.id)}
                    className={`text-left p-3 rounded-lg border transition-colors ${selected ? 'border-accent-600 bg-accent-50 ring-1 ring-accent-400' : 'border-brand-200 bg-white hover:border-accent-400'} ${price === null ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-brand-900 text-sm">{p.name}</span>
                      <span className="font-bold text-accent-700" data-testid={`carwash-package-price-${p.id}`}>
                        {price === null ? '—' : `$${price.toFixed(2)}`}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.items.join(' · ')}</p>
                  </button>
                );
              })}
            </div>
          )}
          {touched && !selectedPackage && <p className="text-xs text-error mt-1">Elige un paquete</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Empleado (opcional)"
            id="carwash-employee"
            data-testid="carwash-employee-select"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            placeholder="Sin asignar"
            options={activeEmployees.map((e) => ({ label: e.name, value: e.id }))}
          />
          <Input
            label="Cliente (opcional)"
            id="carwash-customer"
            data-testid="carwash-customer-input"
            value={customerName}
            maxLength={80}
            onChange={(e) => setCustomerName(e.target.value)}
          />
        </div>
        <Input
          label="Nota (opcional)"
          id="carwash-note"
          data-testid="carwash-note-input"
          value={note}
          maxLength={200}
          placeholder="Ej. rayón en puerta, aspirar cajuela"
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
