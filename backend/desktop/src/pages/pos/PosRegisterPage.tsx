// Punto de venta — counter-sale register. Keyboard-first: scan/type in the
// search box (Enter adds an exact barcode/SKU match; `3*` before a code or a
// tile adds 3 units), click products in the grid, F2 to charge, F4 removes the
// selected line, F8 puts the sale on hold ("Ventas en espera"). Completing a
// sale persists the ticket, discharges stock and prints the non-fiscal
// receipt. POS Phase 2: split payments, suspended sales, decimal quantities
// for weighable units, scale labels, quick-create on a barcode miss and
// per-device registers (openspec/changes/add-pos-phase-2 design §1–5).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Car, PauseCircle, Printer, RotateCcw, Settings2, SlidersHorizontal, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { EmptyState } from '@/components/common/EmptyState';
import { useToast } from '@/components/common/Toast';
import { useAppDispatch, useAppSelector } from '@/store';
import { selectCurrentCompany } from '@/store/selectors/companySelectors';
import { selectCurrentCompanyProducts } from '@/store/selectors/productSelectors';
import { selectActiveLocalUser, selectAuditActor } from '@/store/selectors/localUsersSelectors';
import { usePermissionCheck } from '@/hooks/useLocalUsers';
import { addProduct as addCatalogProduct, applyTicketStockDeduction } from '@/store/slices/productSlice';
import { Modal } from '@/components/common/Modal';
import { Product, TaxCategory, UnitOfMeasure } from '@/types/product';
import {
  PaymentMethod,
  Ticket,
  TicketLine,
  cashRoundingAdjustment,
  computeTicketAmounts,
  round2,
} from '@/types/ticket';
import { TicketDatabase, type OpenTicketPatch } from '@/services/tickets/TicketDatabase';
import { registerSettingsOf, scaleSettingsOf } from '@/services/tickets/PosSettingsStore';
import { formatTicketNumber, ticketShortLabel } from '@/services/tickets/ticketNumber';
import { useCarwashInit } from '@/components/carwash/useCarwashInit';
import { recordJobPayment, selectCarwashJobs, selectUnpaidCarwashJobs } from '@/store/slices/carwashSlice';
import type { CarwashJob } from '@/services/carwash/types';
import {
  buildCarwashPayments,
  buildCarwashQuickLine,
  cartHasCarwashJob,
  isChargeableJob,
} from '@/services/carwash/posCarwashLines';
import {
  formatQuantity,
  isWeighableUnit,
  parseMultiplierPrefix,
  parseQuantityInput,
  quantityErrorMessage,
  roundQuantity,
} from '@/services/tickets/posQuantity';
import { parseScaleBarcode, productMatchesPlu, scaleLabelQuantity } from '@/services/tickets/scaleBarcode';
import { isSingleCashSettlement, validateSplitPayments } from '@/services/tickets/splitPayments';
import { usePosSettings, useTickets } from '@/hooks/useTickets';
import { buildTicketReceipt, printReceipt } from '@/services/printing/PosPrinting';
import { PaymentModal, type CartPayment } from '@/components/pos/PaymentModal';
import { SuspendedSalesModal } from '@/components/pos/SuspendedSalesModal';
import { QuickCreateProductModal } from '@/components/pos/QuickCreateProductModal';
import { RegisterSettingsModal } from '@/components/pos/RegisterSettingsModal';
import { CashDrawerPanel, useThisRegisterId } from '@/components/pos/CashDrawerPanel';
import { DISCOUNT_PRESETS } from '@/config/discountPresets';

type CartItem = TicketLine;

let lineSeq = 0;
const nextLineId = () => `posline_${Date.now().toString(36)}_${(lineSeq += 1)}`;

const SEARCH_SELECTOR = '[data-testid="pos-search-input"]';

function focusSearch() {
  (document.querySelector(SEARCH_SELECTOR) as HTMLInputElement | null)?.focus();
}

/** Any modal (payment, espera, quick-create, settings, cash drawer…) is open. */
function dialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"]');
}

// ── Barcode scanner (keyboard wedge) detection ─────────────────────────────
// A scanner "types" the code in a burst (a few ms per character) and ends it
// with Enter, into WHATEVER has focus. Bursts are recognised globally: the
// Enter is swallowed (so it can't re-click a focused tile or ± button), the
// characters are taken back out of the field they landed in (a discount %
// field would otherwise clamp to 100 % = a free line), and the code is looked
// up as a scan. Slow typing never matches, so people can still type in any
// field normally.
const SCAN_MAX_GAP_MS = 50;
const SCAN_MIN_LENGTH = 5;
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

type ScanBurst = { chars: string; last: number; target: EventTarget | null; startValue: string | null };
const emptyBurst = (): ScanBurst => ({ chars: '', last: 0, target: null, startValue: null });

function isTextField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/** Put a React-controlled field back to `value` (native setter + input event → onChange). */
function restoreFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

type MissState = { code: string; suggestedUnit?: UnitOfMeasure; multiplier?: number };

export default function PosRegisterPage() {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const company = useAppSelector(selectCurrentCompany);
  const products = useAppSelector(selectCurrentCompanyProducts);
  // Local user control: the signed-in cashier goes on the ticket ("Cajero: …").
  const cashier = useAppSelector(selectActiveLocalUser);
  const auditActor = useAppSelector(selectAuditActor);
  // Shortcuts out of the register only for users who may open their target
  // (a cashier without Configuración/Productos would land on "Acceso restringido").
  const { can, canOpen } = usePermissionCheck();
  // "Excluir de Libros IVA" is an accounting decision: admin or Libros IVA users only.
  const canExcludeLibros = can('librosIva');
  // Quick-create on a barcode miss: admin or users who manage products.
  const canQuickCreate = can('products');
  const canConfigureRegister = canOpen('/settings/printer');
  const { settings, save: saveSettings } = usePosSettings(company?.id);
  const register = registerSettingsOf(settings);
  const scale = scaleSettingsOf(settings);
  // This device is a register: its Device Sync device id goes on every new ticket.
  const registerId = useThisRegisterId();

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [ticketDiscountPct, setTicketDiscountPct] = useState<number>(0);
  const [excludeFromLibros, setExcludeFromLibros] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  // The OPEN ticket currently loaded into the cart (resumed from "Ventas en espera").
  const [resumed, setResumed] = useState<Ticket | null>(null);
  const [suspendedOpen, setSuspendedOpen] = useState(false);
  const [miss, setMiss] = useState<MissState | null>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useCarwashInit();
  const [carwashOpen, setCarwashOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const unpaidCarwashJobs = (useAppSelector(selectUnpaidCarwashJobs) as CarwashJob[] | undefined) ?? [];
  const allCarwashJobs = (useAppSelector(selectCarwashJobs) as CarwashJob[] | undefined) ?? [];
  const lastTouchedRef = useRef<string | null>(null);
  // Lines added from a scale label stay separate (each label is its own package).
  const scaleLineIds = useRef<Set<string>>(new Set());
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const lineWeighable = useCallback(
    (line: CartItem) => isWeighableUnit(line.productId ? productById.get(line.productId)?.unitOfMeasure : undefined),
    [productById],
  );

  // Suspended sales of THIS register (legacy OPEN tickets without a register count as ours).
  const { tickets: openTickets } = useTickets({ companyId: company?.id ?? '', status: 'OPEN' });
  const suspended = useMemo(
    () => openTickets.filter((t) => (!t.registerId || t.registerId === registerId) && t.id !== resumed?.id),
    [openTickets, registerId, resumed?.id],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort();
  }, [products]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // "3*" typed before a code/tile = quantity for the next product.
  const parsedSearch = useMemo(() => parseMultiplierPrefix(search), [search]);

  const filtered = useMemo(() => {
    const term = parsedSearch.term.trim().toLowerCase();
    return products
      // isActive defaults to true: seeded/legacy products may not carry it.
      .filter((p) => p.isActive !== false && p.status !== 'DISCONTINUED')
      .filter((p) => (activeCategory ? p.category === activeCategory : true))
      .filter((p) =>
        term
          ? p.productName.toLowerCase().includes(term) ||
            (p.productCode ?? '').toLowerCase().includes(term) ||
            (p.barcode ?? '').includes(term)
          : true,
      )
      .slice(0, 60);
  }, [products, parsedSearch.term, activeCategory]);

  // Ticket discounts are applied as a PERCENTAGE of the (post-line-discount)
  // lines total; the derived amount can never exceed it, so the rounding base
  // and the stored totalAmount can't disagree.
  const linesGross = useMemo(
    () => round2(cart.reduce((s, l) => s + l.quantity * l.unitPrice - (l.discount ?? 0), 0)),
    [cart],
  );
  const clampedTicketPct = Math.max(0, Math.min(ticketDiscountPct, 100));
  const effectiveTicketDiscount = round2(Math.min(clampedTicketPct / 100, 1) * linesGross);

  // $0.05 rounding applies to a sale paid with ONE cash payment only
  // (US-coin scarcity): card, "otro" and split payments charge the exact amount.
  const cashRounding = useMemo(
    () => cashRoundingAdjustment(
      round2(linesGross - effectiveTicketDiscount),
      settings.roundingMode,
    ),
    [linesGross, effectiveTicketDiscount, settings.roundingMode],
  );

  const amounts = useMemo(
    () => computeTicketAmounts({ lines: cart, discountTotal: effectiveTicketDiscount }),
    [cart, effectiveTicketDiscount],
  );
  const cashAmounts = useMemo(
    () => computeTicketAmounts({ lines: cart, discountTotal: effectiveTicketDiscount, roundingAdjustment: cashRounding }),
    [cart, effectiveTicketDiscount, cashRounding],
  );

  // ── Cart ops ─────────────────────────────────────────────────────────────

  // Sets a line's quantity and re-derives its discount: percentage-based
  // discounts (the normal path) scale with the new gross; amount-only
  // discounts (legacy lines) carry over unchanged, still clamped to gross.
  const withQuantity = (l: CartItem, rawQuantity: number): CartItem => {
    // A carwash line is one service at its pending balance: quantity is fixed.
    if (l.carwashJobId) return l;
    const quantity = roundQuantity(rawQuantity);
    const gross = round2(quantity * l.unitPrice);
    const raw = l.discountPct && l.discountPct > 0
      ? round2((gross * Math.min(l.discountPct, 100)) / 100)
      : (l.discount ?? 0);
    const discount = Math.min(Math.max(0, raw), gross);
    return {
      ...l,
      quantity,
      discount: discount > 0 ? discount : undefined,
      discountPct: discount > 0 ? l.discountPct : undefined,
      lineTotal: round2(gross - discount),
    };
  };

  /** Adds `quantity` of a product (merging into its line unless `separate`). */
  const addProductToCart = useCallback((product: Product, quantity = 1, separate = false) => {
    setCart((prev) => {
      const existing = separate
        ? undefined
        : prev.find((l) => l.productId === product.id && !scaleLineIds.current.has(l.id));
      if (existing) {
        lastTouchedRef.current = existing.id;
        return prev.map((l) => (l.id === existing.id ? withQuantity(l, l.quantity + quantity) : l));
      }
      const id = nextLineId();
      lastTouchedRef.current = id;
      if (separate) scaleLineIds.current.add(id);
      const qty = roundQuantity(quantity);
      return [
        ...prev,
        {
          id,
          productId: product.id,
          productCode: product.productCode,
          productName: product.productName,
          quantity: qty,
          unitPrice: product.unitPrice,
          lineTotal: round2(qty * product.unitPrice),
          taxCategory: product.taxCategory ?? TaxCategory.GRAVADO,
        },
      ];
    });
  }, []);

  /** Validates an `N*` multiplier against the product's unit; null = refused (toast shown). */
  const quantityFor = useCallback((product: Product, multiplier?: number): number | null => {
    if (multiplier === undefined) return 1;
    const parsed = parseQuantityInput(String(multiplier), isWeighableUnit(product.unitOfMeasure));
    if (!parsed.ok) {
      toast.error(`${product.productName}: ${quantityErrorMessage(parsed.reason)}`);
      return null;
    }
    return parsed.quantity;
  }, [toast]);

  const addProductById = (productId: string) => {
    const product = productById.get(productId);
    if (!product) return;
    const qty = quantityFor(product, parsedSearch.multiplier);
    if (qty === null) return;
    addProductToCart(product, qty);
    if (parsedSearch.multiplier !== undefined) setSearch('');
  };

  const setLineQuantity = (lineId: string, quantity: number) => {
    lastTouchedRef.current = lineId;
    setCart((prev) => prev.map((l) => (l.id === lineId ? withQuantity(l, quantity) : l)));
  };

  const changeQty = (lineId: string, delta: number) => {
    lastTouchedRef.current = lineId;
    setCart((prev) =>
      prev
        .map((l) => (l.id === lineId ? withQuantity(l, l.quantity + delta) : l))
        .filter((l) => l.quantity > 0),
    );
  };

  // Typed quantity: decimals (3) only for weighable units; a fraction on a
  // unit product is refused and the line keeps its quantity.
  const commitQtyDraft = (line: CartItem) => {
    const draft = qtyDrafts[line.id];
    setQtyDrafts((prev) => {
      const next = { ...prev };
      delete next[line.id];
      return next;
    });
    if (draft === undefined || draft.trim() === formatQuantity(line.quantity)) return;
    const parsed = parseQuantityInput(draft, lineWeighable(line));
    if (!parsed.ok) {
      if (parsed.reason !== 'empty') toast.error(quantityErrorMessage(parsed.reason));
      return;
    }
    setLineQuantity(line.id, parsed.quantity);
  };

  // Line-level discount, entered as a PERCENTAGE of the line gross. The
  // derived amount (IVA incl.) is what flows into totals and persistence;
  // the percentage rides along so quantity changes re-apply it.
  const changeLineDiscountPct = (lineId: string, pct: number) => {
    lastTouchedRef.current = lineId;
    setCart((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        const clamped = Math.min(Math.max(0, pct || 0), 100);
        const gross = round2(l.quantity * l.unitPrice);
        const discount = round2((gross * clamped) / 100);
        return {
          ...l,
          discountPct: clamped > 0 ? clamped : undefined,
          discount: clamped > 0 ? discount : undefined,
          lineTotal: round2(gross - discount),
        };
      }),
    );
  };

  const removeLine = (lineId: string) => {
    setCart((prev) => prev.filter((l) => l.id !== lineId));
    scaleLineIds.current.delete(lineId);
    if (selectedLineId === lineId) setSelectedLineId(null);
    if (lastTouchedRef.current === lineId) lastTouchedRef.current = null;
  };

  const clearCartState = () => {
    setCart([]);
    setTicketDiscountPct(0);
    setExcludeFromLibros(false);
    setCustomerName('');
    setSelectedLineId(null);
    setQtyDrafts({});
    setResumed(null);
    scaleLineIds.current.clear();
    lastTouchedRef.current = null;
  };

  const resetSale = () => {
    if (resumed) toast.info(`La venta ${ticketShortLabel(resumed)} sigue en "Ventas en espera"`);
    clearCartState();
    focusSearch();
  };

  const findByCode = useCallback((code: string) => {
    const term = code.trim().toLowerCase();
    if (!term) return undefined;
    return products.find(
      (p) =>
        (p.barcode && p.barcode.toLowerCase() === term) ||
        (p.productCode && p.productCode.toLowerCase() === term),
    );
  }, [products]);

  /**
   * A scanned or typed code: scale label first (when enabled), then an exact
   * barcode/SKU. Returns false on a miss (the "Crear producto" banner shows).
   */
  const handleCode = useCallback((rawCode: string, multiplier?: number): boolean => {
    const code = rawCode.trim();
    if (!code) return true;
    const label = parseScaleBarcode(code, scale);
    if (label) {
      const product = products.find((p) => p.isActive !== false && productMatchesPlu(p, label.plu));
      if (!product) {
        const plu = label.plu.replace(/^0+(?=.)/, '');
        toast.error(`Código no encontrado: PLU ${plu} (etiqueta de balanza)`);
        setMiss({ code: plu, suggestedUnit: UnitOfMeasure.KILOGRAMO });
        return false;
      }
      const quantity = scaleLabelQuantity(label, product);
      if (quantity === null || quantity <= 0) {
        toast.error(`No se pudo leer la cantidad de la etiqueta de ${product.productName}`);
        return true;
      }
      addProductToCart(product, quantity, true);
      setMiss(null);
      toast.success(`Agregado: ${product.productName} × ${formatQuantity(quantity)}`);
      return true;
    }
    const exact = findByCode(code);
    if (exact) {
      const qty = quantityFor(exact, multiplier);
      if (qty === null) return true;
      addProductToCart(exact, qty);
      setMiss(null);
      toast.success(qty === 1 ? `Agregado: ${exact.productName}` : `Agregado: ${exact.productName} × ${formatQuantity(qty)}`);
      return true;
    }
    toast.error(`Código no encontrado: ${code}`);
    setMiss({ code, multiplier });
    return false;
  }, [scale, products, findByCode, quantityFor, addProductToCart, toast]);

  // Barcode / SKU typed (or scanned) into the search box: Enter adds an exact
  // match. A miss clears the box when nothing matches at all, so the next scan
  // doesn't append to a stale code; a partial name search stays put.
  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const { term, multiplier } = parsedSearch;
    if (!term.trim()) return;
    const isLabel = !!parseScaleBarcode(term.trim(), scale);
    if (isLabel || findByCode(term) || filtered.length === 0) {
      handleCode(term, multiplier);
      setSearch('');
    }
  };

  // Latest values for the global scanner listener (registered once).
  const scanState = useRef({ handleCode, payOpen });
  scanState.current = { handleCode, payOpen };

  useEffect(() => {
    let burst = emptyBurst();
    const onKeyDown = (e: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(e.key)) return;
      const now = e.timeStamp || performance.now();
      if (e.key === 'Enter') {
        const { chars, last, target, startValue } = burst;
        burst = emptyBurst();
        if (chars.length < SCAN_MIN_LENGTH || now - last > SCAN_MAX_GAP_MS) return;
        const { handleCode: handle, payOpen: paying } = scanState.current;
        // Another dialog (quick-create, settings…) owns its fields: a scan
        // there is typed into the focused field, as the user intends.
        if (!paying && dialogOpen()) return;
        // A scan: keep the Enter away from the focused element.
        e.preventDefault();
        e.stopPropagation();
        let multiplier: number | undefined;
        if (isTextField(target)) {
          if (target.matches(SEARCH_SELECTOR)) {
            // "3*" typed before the scan → 3 units.
            const prefix = parseMultiplierPrefix(startValue ?? '');
            if (prefix.multiplier !== undefined && !prefix.term.trim()) multiplier = prefix.multiplier;
            setSearch('');
          } else {
            restoreFieldValue(target, startValue ?? '');
          }
        }
        if (paying) {
          toastRef.current.warning('Escaneo ignorado — termina o cancela el cobro primero');
          return;
        }
        handle(chars, multiplier);
        focusSearch();
        return;
      }
      if (e.key.length !== 1 || e.repeat || e.ctrlKey || e.metaKey || e.altKey) {
        burst = emptyBurst();
        return;
      }
      if (burst.chars && now - burst.last > SCAN_MAX_GAP_MS) burst = emptyBurst();
      if (!burst.chars) {
        burst.target = e.target;
        burst.startValue = isTextField(e.target) ? e.target.value : null;
      }
      burst.chars += e.key;
      burst.last = now;
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Oversell guard (BLOCK mode) against LIVE stock — another register, a
  // synced sale or a stock adjustment may have changed it since the line was
  // added. Quantities of the same product are summed across lines.
  const findOversold = useCallback((lines: CartItem[]) => {
    if (settings.oversell !== 'BLOCK') return [];
    const wanted = new Map<string, number>();
    for (const l of lines) if (l.productId) wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.quantity);
    return lines.filter((l) => {
      if (!l.productId) return false;
      const product = productById.get(l.productId);
      if (!product || product.isService || !product.trackInventory) return false;
      return (wanted.get(l.productId) ?? 0) > Math.max(0, product.stockQuantity ?? product.stock ?? 0) + 1e-9;
    });
  }, [productById, settings.oversell]);
  const oversoldLines = useMemo(() => findOversold(cart), [findOversold, cart]);

  // ── Carwash jobs ("Lavados por cobrar") ─────────────────────────────────

  /** Adds a carwash job as a quick line at its pending balance (once per job). */
  const addCarwashJob = useCallback((job: CarwashJob) => {
    if (!isChargeableJob(job)) {
      toastRef.current.info(`${job.plate}: no tiene saldo por cobrar`);
      return;
    }
    setCart((prev) => {
      if (cartHasCarwashJob(prev, job.id)) return prev;
      const line = buildCarwashQuickLine(job, nextLineId());
      lastTouchedRef.current = line.id;
      return [...prev, line];
    });
  }, []);

  const pickCarwashJob = (job: CarwashJob) => {
    if (cartHasCarwashJob(cart, job.id)) {
      toast.info(`${job.plate} ya está en la venta`);
      return;
    }
    addCarwashJob(job);
    setCarwashOpen(false);
    focusSearch();
  };

  // /pos?carwashJob=<id> (from the Lavado board "Cobrar") preloads that job.
  const carwashParam = searchParams.get('carwashJob');
  useEffect(() => {
    if (!carwashParam) return;
    const job = allCarwashJobs.find((j) => j.id === carwashParam);
    if (!job) return; // not loaded yet — retried when the jobs arrive
    addCarwashJob(job);
    const next = new URLSearchParams(searchParams);
    next.delete('carwashJob');
    setSearchParams(next, { replace: true });
  }, [carwashParam, allCarwashJobs, addCarwashJob, searchParams, setSearchParams]);

  // ── Shortcuts: F2 cobrar · F4 quitar línea · F8 poner en espera ─────────

  const openPayment = () => {
    if (cart.length === 0 || payOpen) return;
    if (oversoldLines.length > 0) {
      toast.error(`Stock insuficiente: ${oversoldLines[0].productName}`);
      return;
    }
    setPayOpen(true);
  };

  const removeSelectedLine = () => {
    if (cart.length === 0) return;
    const target =
      cart.find((l) => l.id === selectedLineId) ??
      cart.find((l) => l.id === lastTouchedRef.current) ??
      cart[cart.length - 1];
    removeLine(target.id);
    toast.info(`Quitado: ${target.productName}`);
    focusSearch();
  };

  const draftTotals = () => ({
    items: cart.map((line) => ({ ...line })),
    totalAmount: amounts.totalAmount,
    taxIncluded: amounts.taxIncluded,
    exemptTotal: amounts.exemptTotal,
    discountTotal: effectiveTicketDiscount || undefined,
    discountPct: clampedTicketPct || undefined,
    customerName: customerName || undefined,
    excludeFromLibrosIVA: (canExcludeLibros && excludeFromLibros) || undefined,
  });

  // F8: the cart becomes an OPEN ticket — no stock movement, no print. A
  // resumed sale is updated in place (it keeps its id and number).
  const suspendSale = async () => {
    if (!company) return;
    if (cart.length === 0) {
      toast.info('No hay productos en la venta actual');
      return;
    }
    const draft = draftTotals();
    try {
      let ticket: Ticket | null;
      if (resumed) {
        ticket = await TicketDatabase.updateOpen(company.id, resumed.id, {
          ...draft,
          payments: [],
          roundingAdjustment: undefined,
          cashierName: cashier?.displayName ?? resumed.cashierName,
        });
        if (!ticket) {
          toast.error('Esta venta en espera ya no está abierta (se cobró o se descartó en otra caja).');
          return;
        }
      } else {
        ticket = await TicketDatabase.create({
          companyId: company.id,
          ...draft,
          payments: [],
          cashierName: cashier?.displayName,
          registerId: registerId ?? undefined,
          registerCode: register.code || undefined,
          complete: false,
        });
      }
      clearCartState();
      focusSearch();
      toast.success(`Venta en espera: ${ticketShortLabel(ticket)}`);
    } catch (err) {
      toast.error(`No se pudo poner en espera: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const resumeSale = (ticket: Ticket) => {
    if (cart.length > 0) {
      toast.warning('Pon en espera o limpia la venta actual antes de reanudar otra.');
      return;
    }
    const gross = round2(ticket.items.reduce((s, l) => s + l.quantity * l.unitPrice - (l.discount ?? 0), 0));
    const pct = ticket.discountPct ??
      (ticket.discountTotal && gross > 0 ? Math.round((ticket.discountTotal / gross) * 10000) / 100 : 0);
    scaleLineIds.current.clear();
    setCart(ticket.items.map((line) => ({ ...line })));
    setTicketDiscountPct(pct || 0);
    setCustomerName(ticket.customerName ?? '');
    setExcludeFromLibros(!!ticket.excludeFromLibrosIVA);
    setSelectedLineId(null);
    setQtyDrafts({});
    setResumed(ticket);
    setSuspendedOpen(false);
    lastTouchedRef.current = ticket.items[ticket.items.length - 1]?.id ?? null;
    toast.success(`Venta ${ticketShortLabel(ticket)} reanudada`);
    focusSearch();
  };

  const discardSale = async (ticket: Ticket) => {
    if (!company) return;
    try {
      await TicketDatabase.void(company.id, ticket.id, 'Venta en espera descartada');
      toast.success(`Venta en espera ${ticketShortLabel(ticket)} descartada`);
    } catch (err) {
      toast.error(`No se pudo descartar: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const keyState = useRef({ openPayment, removeSelectedLine, suspendSale });
  keyState.current = { openPayment, removeSelectedLine, suspendSale };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2' && e.key !== 'F4' && e.key !== 'F8') return;
      // Shortcuts are ignored while any dialog is open.
      if (dialogOpen()) return;
      e.preventDefault();
      if (e.key === 'F2') keyState.current.openPayment();
      else if (e.key === 'F4') keyState.current.removeSelectedLine();
      else void keyState.current.suspendSale();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Complete sale ────────────────────────────────────────────────────────

  // Receipts print one at a time in the background: the register is free for
  // the next customer while a slow USB/network print runs (8–60 s), and a late
  // print result never touches the cart.
  const printQueue = useRef<Promise<void>>(Promise.resolve());

  const printSaleReceipt = (ticket: Ticket) => {
    if (!company) return;
    const companySnapshot = company;
    const settingsSnapshot = settings;
    const label = ticketShortLabel(ticket);
    printQueue.current = printQueue.current.then(async () => {
      try {
        const payload = buildTicketReceipt(ticket, companySnapshot, settingsSnapshot, { purpose: 'sale' });
        const result = await printReceipt(payload, settingsSnapshot);
        if (!result.ok) {
          toast.warning(`Ticket ${label} guardado — impresión falló: ${result.error}`);
          return;
        }
        toast.success(`Ticket ${label} impreso`);
        try {
          await TicketDatabase.incrementPrinted(companySnapshot.id, ticket.id);
        } catch (err) {
          console.warn('POS: no se pudo registrar la impresión', err);
        }
      } catch (err) {
        toast.warning(`Ticket ${label} guardado — impresión falló: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  };

  const completeSale = async (payments: CartPayment[]) => {
    if (!company) return;
    const shortNow = findOversold(cart);
    if (shortNow.length > 0) {
      toast.error(`Stock insuficiente: ${shortNow[0].productName}`);
      return;
    }
    const timestamp = new Date().toISOString();
    // Rounding only when the whole sale is one cash payment (design §2).
    const paidCash = isSingleCashSettlement(payments);
    const sale = paidCash ? cashAmounts : amounts;
    const rounding = paidCash ? cashRounding : 0;
    const saleLines = cart.map((line) => ({ ...line }));
    const ticketPayments = payments.map((p) => ({
      id: `pay_${nextLineId()}`,
      method: p.method as PaymentMethod,
      // Single payment: it covers the method-specific total exactly.
      amount: payments.length === 1 ? sale.totalAmount : round2(p.amount),
      tendered: p.tendered,
      change: p.change,
      posAuthCode: p.posAuthCode,
      posLast4: p.posLast4,
      posCardType: p.posCardType,
      posReference: p.posReference,
    }));
    const invalid = validateSplitPayments(sale.totalAmount, ticketPayments);
    if (invalid) {
      toast.error(`No se pudo completar la venta: ${invalid}`);
      return;
    }
    const fields: OpenTicketPatch = {
      items: saleLines,
      payments: ticketPayments,
      discountTotal: effectiveTicketDiscount || undefined,
      discountPct: clampedTicketPct || undefined,
      roundingAdjustment: rounding || undefined,
      totalAmount: sale.totalAmount,
      taxIncluded: sale.taxIncluded,
      exemptTotal: sale.exemptTotal,
      customerName: customerName || undefined,
      cashierName: cashier?.displayName,
      excludeFromLibrosIVA: (canExcludeLibros && excludeFromLibros) || undefined,
    };

    let ticket: Ticket;
    try {
      if (resumed) {
        // A resumed suspended sale is charged IN PLACE: same id and number.
        const completed = await TicketDatabase.complete(company.id, resumed.id, fields);
        if (!completed) throw new Error('la venta en espera ya no existe');
        ticket = completed;
      } else {
        ticket = await TicketDatabase.create({
          companyId: company.id,
          items: saleLines,
          payments: ticketPayments,
          discountTotal: fields.discountTotal,
          discountPct: fields.discountPct,
          roundingAdjustment: fields.roundingAdjustment,
          totalAmount: sale.totalAmount,
          taxIncluded: sale.taxIncluded,
          exemptTotal: sale.exemptTotal,
          customerName: fields.customerName,
          cashierName: fields.cashierName,
          excludeFromLibrosIVA: fields.excludeFromLibrosIVA,
          registerId: registerId ?? undefined,
          registerCode: register.code || undefined,
          complete: true,
        });
      }
    } catch (err) {
      // Nothing was saved: keep the cart so the sale can be retried.
      const message = err instanceof Error ? err.message : String(err);
      toast.error(
        resumed && /Transición inválida|ya no existe/.test(message)
          ? 'Esta venta en espera ya se cobró o se descartó en otra caja. Limpia la venta y vuelve a registrarla si corresponde.'
          : `No se pudo completar la venta: ${message}`,
      );
      return;
    }

    // The sale EXISTS from here on. Everything below is best-effort: an error
    // must never leave the cart up for a second (duplicate) charge.
    const label = ticketShortLabel(ticket);
    try {
      dispatch(applyTicketStockDeduction({
        ticketId: ticket.id,
        ticketSequential: ticket.sequential,
        items: saleLines
          .filter((l) => !!l.productId)
          .map((l) => ({ productId: l.productId!, quantity: l.quantity, productName: l.productName })),
        createdAt: timestamp,
        createdBy: cashier ? auditActor.name : 'POS',
      }));
    } catch (err) {
      toast.warning(`Ticket ${label} guardado, pero no se pudo descontar el inventario: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Carwash lines: record the payment on each job (API / outbox). Best-effort —
    // the sale is already saved and must never fail because of the carwash API.
    try {
      const dispatches = buildCarwashPayments(saleLines, ticketPayments, formatTicketNumber(ticket));
      for (const { jobId, payment } of dispatches) {
        // A rejected thunk resolves (it does not throw) unless unwrapped: surface it, or the
        // customer is charged while the job stays "Por cobrar" with no trace.
        dispatch(recordJobPayment({ jobId, payment })).unwrap().catch((err: unknown) => {
          const message = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
          console.warn('POS: no se pudo registrar el pago del lavado', err);
          toast.warning(`Ticket ${label} guardado, pero el pago del lavado no se registró: ${message}`);
        });
      }
    } catch (err) {
      toast.warning(`Ticket ${label} guardado, pero no se pudo registrar el pago del lavado: ${err instanceof Error ? err.message : String(err)}`);
    }

    setPayOpen(false);
    clearCartState();
    focusSearch();

    if (settings.printer) {
      toast.info(`Ticket ${label} guardado — imprimiendo…`);
      printSaleReceipt(ticket);
    } else {
      toast.success(`Ticket ${label} guardado (sin impresora configurada)`);
    }
  };

  // ── Quick-create on a barcode miss ──────────────────────────────────────

  const existingCodes = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.barcode) set.add(p.barcode.toLowerCase());
      if (p.productCode) set.add(p.productCode.toLowerCase());
    }
    return set;
  }, [products]);

  const createFromMiss = (product: Product) => {
    dispatch(addCatalogProduct(product));
    const qty = miss?.multiplier !== undefined ? quantityFor(product, miss.multiplier) ?? 1 : 1;
    addProductToCart(product, qty);
    setQuickCreateOpen(false);
    setMiss(null);
    toast.success(`Producto creado y agregado: ${product.productName}`);
    focusSearch();
  };

  if (!company) return null;

  const registerLabel = register.code ? `${register.name} (${register.code})` : register.name;

  return (
    <div data-testid="pos-register" className="space-y-4">
      <PageHeader
        title="Punto de Venta"
        subtitle={`Venta rápida — descarga inventario y registra el pago · ${registerLabel}`}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              data-testid="btn-pos-suspended"
              onClick={() => setSuspendedOpen(true)}
              title="Ventas puestas en espera con F8"
            >
              <PauseCircle size={16} /> Ventas en espera ({suspended.length})
            </Button>
            {canConfigureRegister && (
              <Button
                variant="ghost"
                size="sm"
                data-testid="btn-pos-register-settings"
                onClick={() => setSettingsOpen(true)}
              >
                <SlidersHorizontal size={16} /> Caja
              </Button>
            )}
            {canConfigureRegister && (
              <Button
                variant="ghost"
                size="sm"
                data-testid="btn-pos-printer-settings"
                onClick={() => window.location.hash = '#/settings/printer'}
              >
                <Settings2 size={16} /> Impresora
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              data-testid="pos-carwash-pending"
              onClick={() => setCarwashOpen(true)}
              title="Servicios de lavado pendientes de cobro"
            >
              <Car size={16} /> Lavados por cobrar ({unpaidCarwashJobs.length})
            </Button>
            <Button variant="secondary" size="sm" onClick={resetSale} data-testid="btn-pos-clear">
              <RotateCcw size={16} /> Limpiar
            </Button>
          </>
        }
      />

      {/* Cash drawer (POS Phase 2 §6): "Caja sin abrir" / Abrir caja / Entradas y salidas (pos.cash). */}
      <CashDrawerPanel companyId={company.id} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ── Left: catalog ── */}
        <div className="lg:col-span-3 space-y-3">
          <Input
            data-testid="pos-search-input"
            placeholder="Escanear código de barras / buscar producto… (Enter agrega el código exacto · 3* = 3 unidades)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
            autoFocus
          />
          {parsedSearch.multiplier !== undefined && (
            <p data-testid="pos-multiplier" className="text-xs text-accent-700">
              Cantidad para el próximo producto: <strong>{parsedSearch.multiplierText}</strong> — escanea o toca un producto.
            </p>
          )}
          {/* Barcode miss: users who manage products may create it right here
              (everyone else only gets the "Código no encontrado" toast). */}
          {miss && canQuickCreate && (
            <div
              data-testid="pos-miss-banner"
              className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
            >
              <span className="text-amber-800">
                El código <span className="font-mono">{miss.code}</span> no está en el catálogo.
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" data-testid="btn-quick-create" onClick={() => setQuickCreateOpen(true)}>
                  Crear producto
                </Button>
                <button
                  type="button"
                  className="text-xs text-amber-700 hover:underline"
                  data-testid="btn-miss-dismiss"
                  onClick={() => { setMiss(null); focusSearch(); }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-testid="pos-category-chips">
              <button
                data-testid="pos-category-all"
                onClick={() => { setActiveCategory(null); focusSearch(); }}
                className={`px-2.5 py-1 rounded-full text-xs border ${activeCategory === null ? 'bg-accent-600 text-white border-accent-600' : 'bg-white text-brand-700 border-brand-300 hover:bg-brand-50'}`}
              >
                Todas
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  data-testid={`pos-category-${c}`}
                  onClick={() => { setActiveCategory(activeCategory === c ? null : c); focusSearch(); }}
                  className={`px-2.5 py-1 rounded-full text-xs border ${activeCategory === c ? 'bg-accent-600 text-white border-accent-600' : 'bg-white text-brand-700 border-brand-300 hover:bg-brand-50'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="space-y-3">
              <EmptyState
                icon={<Printer size={32} />}
                title="Sin productos"
                message="Agrega productos con precio y código de barras para venderlos aquí."
              />
              {canOpen('/products/add') && (
                <div className="text-center">
                  <Link to="/products/add" className="text-accent-600 hover:underline text-sm">Crear producto</Link>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2" data-testid="pos-product-grid">
              {filtered.map((p) => {
                const stock = p.trackInventory ? (p.stockQuantity ?? 0) : undefined;
                const out = stock !== undefined && stock <= 0;
                return (
                  <button
                    key={p.id}
                    data-testid={`pos-product-${p.id}`}
                    disabled={out}
                    onClick={() => { addProductById(p.id); focusSearch(); }}
                    className={`text-left p-3 rounded-lg border bg-white transition-colors ${out ? 'opacity-40 cursor-not-allowed border-brand-200' : 'border-brand-200 hover:border-accent-500 hover:shadow-sm'}`}
                  >
                    <p className="text-sm font-medium text-brand-900 leading-tight line-clamp-2">{p.productName}</p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-base font-bold text-accent-700">
                        ${p.unitPrice.toFixed(2)}{isWeighableUnit(p.unitOfMeasure) ? <span className="text-[10px] font-normal text-slate-500"> /{p.unitOfMeasure}</span> : null}
                      </span>
                      {stock !== undefined && (
                        <span data-testid={`pos-stock-${p.id}`} className={`text-[10px] px-1.5 py-0.5 rounded ${stock <= (p.lowStockThreshold ?? 5) ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                          {out ? 'Agotado' : `Stock ${formatQuantity(stock)}`}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right: cart ── */}
        <div className="lg:col-span-2">
          <Card className="p-4 sticky top-4" data-testid="pos-cart">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-brand-900">
                {resumed ? `Venta en espera ${ticketShortLabel(resumed)}` : 'Venta actual'}
              </h2>
              {resumed && (
                <span data-testid="pos-resumed-badge" className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                  Reanudada
                </span>
              )}
            </div>
            {cart.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">Escanea o toca un producto para empezar…</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1" data-testid="pos-cart-lines">
                {cart.map((l) => {
                  const weighable = lineWeighable(l);
                  const selected = l.id === selectedLineId;
                  return (
                    <div
                      key={l.id}
                      data-testid={`pos-cart-line-${l.id}`}
                      data-selected={selected ? 'true' : undefined}
                      onClick={() => setSelectedLineId(l.id)}
                      className={`flex items-center gap-2 border-b border-brand-100 pb-2 rounded ${selected ? 'bg-accent-50 ring-1 ring-accent-300' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-brand-900 truncate">{l.productName}</p>
                        <p className="text-xs text-slate-500">
                          ${l.unitPrice.toFixed(2)} {weighable ? `/${productById.get(l.productId ?? '')?.unitOfMeasure ?? ''}` : 'c/u'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button data-testid={`pos-qty-minus-${l.id}`} onClick={() => { changeQty(l.id, -1); focusSearch(); }} className="w-7 h-7 rounded border border-brand-300 text-brand-700 hover:bg-brand-50">−</button>
                        <input
                          data-testid={`pos-qty-input-${l.id}`}
                          inputMode={weighable ? 'decimal' : 'numeric'}
                          title={weighable ? 'Cantidad (hasta 3 decimales)' : 'Cantidad (unidades enteras)'}
                          className="w-14 text-center text-sm font-semibold rounded border border-brand-200 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent-500"
                          value={qtyDrafts[l.id] ?? formatQuantity(l.quantity)}
                          onFocus={() => setSelectedLineId(l.id)}
                          onChange={(e) => setQtyDrafts((prev) => ({ ...prev, [l.id]: e.target.value }))}
                          onBlur={() => commitQtyDraft(l)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              (e.target as HTMLInputElement).blur();
                              focusSearch();
                            } else if (e.key === 'Escape') {
                              setQtyDrafts((prev) => {
                                const next = { ...prev };
                                delete next[l.id];
                                return next;
                              });
                            }
                          }}
                        />
                        <button data-testid={`pos-qty-plus-${l.id}`} onClick={() => { changeQty(l.id, 1); focusSearch(); }} className="w-7 h-7 rounded border border-brand-300 text-brand-700 hover:bg-brand-50">+</button>
                      </div>
                      <Input
                        data-testid={`pos-line-discount-${l.id}`}
                        type="number"
                        min={0}
                        max={100}
                        step="1"
                        title="Descuento de la línea (%)"
                        className="!w-14 !py-1 text-right"
                        value={l.discountPct ?? ''}
                        placeholder="%"
                        onChange={(e) => changeLineDiscountPct(l.id, Number(e.target.value))}
                      />
                      <span data-testid={`pos-line-total-${l.id}`} className="w-16 text-right text-sm font-semibold">${l.lineTotal.toFixed(2)}</span>
                      <button data-testid={`pos-remove-${l.id}`} onClick={(e) => { e.stopPropagation(); removeLine(l.id); focusSearch(); }} className="text-slate-400 hover:text-error" title="Quitar (F4)">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-600 flex-1">Descuento (%)</label>
                <div className="flex items-center gap-1">
                  {DISCOUNT_PRESETS.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      data-testid={`pos-ticket-disc-chip-${pct}`}
                      onClick={() => { setTicketDiscountPct(pct); focusSearch(); }}
                      className={`px-2 py-1 rounded-full text-xs border whitespace-nowrap ${
                        ticketDiscountPct === pct
                          ? 'bg-accent-600 text-white border-accent-600'
                          : 'bg-white text-brand-700 border-brand-300 hover:bg-brand-50'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                  <Input
                    data-testid="pos-ticket-discount"
                    type="number"
                    min={0}
                    max={100}
                    step="1"
                    title="Descuento del ticket (%)"
                    className="!w-16 !py-1 text-right"
                    value={ticketDiscountPct || ''}
                    placeholder="%"
                    onChange={(e) => setTicketDiscountPct(Math.max(0, Number(e.target.value) || 0))}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-600 flex-1">Cliente (opcional)</label>
                <Input
                  data-testid="pos-customer-name"
                  className="!w-36 !py-1"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Consumidor final"
                />
              </div>
              {canExcludeLibros && (
                <label className="flex items-center gap-2 text-xs text-slate-600" title="La factura generada al consolidar quedará fuera del libro IVA (criterio del contador)">
                  <input
                    type="checkbox"
                    data-testid="pos-exclude-libros"
                    checked={excludeFromLibros}
                    onChange={(e) => setExcludeFromLibros(e.target.checked)}
                  />
                  Excluir de Libros IVA al consolidar
                </label>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-brand-200 space-y-1 text-sm" data-testid="pos-totals">
              <div className="flex justify-between text-slate-600" data-testid="pos-totals-subtotal">
                <span>Subtotal (IVA incl.)</span>
                <span>${amounts.linesTotal.toFixed(2)}</span>
              </div>
              {effectiveTicketDiscount > 0 && (
                <div className="flex justify-between text-slate-600" data-testid="pos-totals-discount">
                  <span>Descuento{ticketDiscountPct > 0 ? ` (${Math.min(ticketDiscountPct, 100)}%)` : ''}</span>
                  <span>−${effectiveTicketDiscount.toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between text-slate-600" data-testid="pos-totals-iva">
                <span>IVA incluido</span>
                <span>${amounts.taxIncluded.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-2xl font-bold text-brand-900 pt-1" data-testid="pos-total">
                <span>TOTAL</span>
                <span>${amounts.totalAmount.toFixed(2)}</span>
              </div>
              {cashRounding !== 0 && (
                <div className="flex justify-between text-xs text-slate-500" data-testid="pos-totals-rounding">
                  <span>En efectivo (redondeo {cashRounding >= 0 ? '+' : '−'}${Math.abs(cashRounding).toFixed(2)})</span>
                  <span>${cashAmounts.totalAmount.toFixed(2)}</span>
                </div>
              )}
            </div>

            {oversoldLines.length > 0 && (
              <p data-testid="pos-oversell-warning" className="mt-2 text-xs text-error">
                Stock insuficiente: {oversoldLines.map((l) => l.productName).join(', ')}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <Button
                data-testid="btn-suspend"
                variant="secondary"
                size="lg"
                disabled={cart.length === 0}
                onClick={() => void suspendSale()}
                title="Poner la venta en espera (F8)"
              >
                <PauseCircle size={18} /> F8
              </Button>
              <Button
                data-testid="btn-charge"
                size="lg"
                className="flex-1"
                disabled={cart.length === 0 || oversoldLines.length > 0}
                onClick={() => setPayOpen(true)}
              >
                Cobrar (F2) · ${amounts.totalAmount.toFixed(2)}
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400 text-center">F2 cobrar · F4 quitar línea · F8 poner en espera</p>
          </Card>
        </div>
      </div>

      <Modal isOpen={carwashOpen} onClose={() => { setCarwashOpen(false); focusSearch(); }} title="Lavados por cobrar" size="md">
        {unpaidCarwashJobs.length === 0 ? (
          <p data-testid="pos-carwash-empty" className="text-sm text-slate-500 py-4 text-center">No hay lavados pendientes de cobro.</p>
        ) : (
          <ul className="divide-y divide-brand-100" data-testid="pos-carwash-list">
            {unpaidCarwashJobs.map((job) => {
              const inCart = cartHasCarwashJob(cart, job.id);
              const balance = Math.max(0, round2(job.priceUsd - (job.paidUsd ?? 0)));
              return (
                <li key={job.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-brand-900"><span className="font-mono">{job.plate}</span> · {job.packageName}</p>
                    <p className="text-xs text-slate-500">{job.ticketNumber ?? 'Sin orden'}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={inCart ? 'secondary' : 'primary'}
                    disabled={inCart}
                    data-testid={`pos-carwash-job-${job.id}`}
                    onClick={() => pickCarwashJob(job)}
                  >
                    {inCart ? 'En la venta' : `Agregar $${balance.toFixed(2)}`}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
      <PaymentModal
        isOpen={payOpen}
        total={amounts.totalAmount}
        cashTotal={cashAmounts.totalAmount}
        onClose={() => { setPayOpen(false); focusSearch(); }}
        onConfirm={completeSale}
      />
      <SuspendedSalesModal
        isOpen={suspendedOpen}
        tickets={suspended}
        onClose={() => { setSuspendedOpen(false); focusSearch(); }}
        onResume={resumeSale}
        onDiscard={discardSale}
      />
      <QuickCreateProductModal
        isOpen={quickCreateOpen}
        code={miss?.code ?? ''}
        suggestedUnit={miss?.suggestedUnit}
        companyId={company.id}
        existingCodes={existingCodes}
        onClose={() => { setQuickCreateOpen(false); focusSearch(); }}
        onCreate={createFromMiss}
      />
      <RegisterSettingsModal
        isOpen={settingsOpen}
        settings={settings}
        onClose={() => { setSettingsOpen(false); focusSearch(); }}
        onSave={async (next) => {
          await saveSettings(next);
          toast.success('Configuración de caja guardada');
        }}
      />
    </div>
  );
}
