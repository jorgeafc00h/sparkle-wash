// DTE (Electronic Tax Document) types matching Swift implementation

// Base DTE structure
export interface DTE_Base {
  identificacion: DTEIdentification;
  documentoRelacionado?: RelatedDocument[];
  emisor: DTEEmisor;
  receptor?: DTEReceptor;
  otrosDocumentos?: OtherDocument[];
  ventaTercero?: ThirdPartySale;
  cuerpoDocumento: DTEBody[];
  resumen: DTESummary;
  extension?: DTEExtension;
  apendice?: DTEAppendix[];

  // Swift includes this optional field for Sujeto Excluido DTEs
  sujetoExcluido?: DTEReceptor;
}

export type DTEEventType = '17' | '18';
export type SpecialOperationDocumentCode = '02' | '97';

export interface DTEEventIdentification {
  version: 1;
  ambiente: string;
  tipoModelo: number;
  tipoOperacion: number;
  tipoEvento: DTEEventType;
  codigoGeneracion: string;
  fecEmi: string;
  horEmi: string;
  tipoMoneda: 'USD';
  tipoContingencia?: number | null;
  motivoContin?: string | null;
  fusion?: string | null;
}

export interface DTEEventEmisor {
  nit: string;
  nombre: string;
  codEstableMH?: string;
  codEstable?: string | null;
  codPuntoVentaMH?: string;
  codPuntoVenta?: string | null;
  recintoFiscal?: string | null;
  tipoRegimen?: string | null;
  regimen?: string | null;
  tipoItemExpor?: number | null;
}

export interface DTEOperacionesEspecialesBody {
  numItem: number;
  codigoGeneracionRef: string | null;
  tipoDocumento: SpecialOperationDocumentCode | string;
  numDocumento: string | null;
  fechaEmision: string | null;
  cantidad: number;
  descripcion: string;
  docDel: string | null;
  docAl: string | null;
  precioUni: number;
  ventaNoSuj: number;
  ventaExenta: number;
  ventaGravada: number;
  tributos: string[] | null;
}

export interface DTEOperacionesEspecialesSummary {
  totalNoSuj: number;
  totalExenta: number;
  totalGravada: number;
  subTotal: number;
  tributos: DTETribute[] | null;
  total: number;
  totalLetras: string | null;
}

export interface DTE_OperacionesEspecialesRequest {
  identificacion: DTEEventIdentification & { tipoEvento: '17' };
  emisor: Pick<DTEEventEmisor, 'nit' | 'nombre'>;
  cuerpoDocumento: DTEOperacionesEspecialesBody[];
  resumen: DTEOperacionesEspecialesSummary;
  apendice: DTEAppendix[] | null;
}

export interface DTERetornoRelatedDocument {
  tipoDocumento: string;
  codigoGeneracion: string;
  fechaEmision: string;
}

export interface DTERetornoDocumento {
  tipoDocumento: string | null;
  numDocumento: string | null;
  nombre: string | null;
  codPais: string | null;
  nombrePais: string | null;
  telefono: string | null;
  correo: string | null;
}

export interface DTERetornoBody {
  numItem: number;
  tipoItem: number;
  codigoGeneracion: string;
  cantidad: number;
  precioUni: number;
  descripcion: string;
  codigo?: string | null;
  uniMedida: number;
  montoDescu: number;
  codTributo: string | null;
  ventaNoSuj: number;
  ventaExenta: number;
  ventaGravada: number;
  compra: number;
  tributos: string[] | null;
  psv: number;
  ivaItem: number;
  noGravado: number;
  seguro: number;
  flete: number;
  ivaRete: number;
  reteRenta: number;
}

export interface DTERetornoSummary {
  totalNoSuj: number;
  totalExenta: number;
  totalGravada: number;
  totalCompraExcluidos: number;
  subTotalVentas: number;
  tributos: DTETribute[] | null;
  totalSeguro: number | null;
  totalFlete: number | null;
  montoTotalOperacion: number;
  ivaRete: number;
  reteRenta: number | null;
  totalNoGravado: number;
  totalPagar: number;
  totalLetras: string | null;
  totalNoOnerosas: number;
  totalIva: number;
  saldoFavor: number;
}

export interface DTE_RetornoRequest {
  identificacion: DTEEventIdentification & { tipoEvento: '18' };
  documentoRelacionado: DTERetornoRelatedDocument[];
  emisor: Required<DTEEventEmisor>;
  documento: DTERetornoDocumento | null;
  ventaTercero: {
    nit: string | null;
    nombre: string | null;
    codDomiciliado: number | null;
  } | null;
  compraTercero: {
    numDocumento: string | null;
    nombre: string | null;
  } | null;
  cuerpoDocumento: DTERetornoBody[];
  resumen: DTERetornoSummary;
  apendice: DTEAppendix[] | null;
}

export type DTE_EventRequest = DTE_OperacionesEspecialesRequest | DTE_RetornoRequest;

// DTE Identification
export interface DTEIdentification {
  version: number;
  ambiente: string; // Environment code (Swift-compatible): '01' = Production, '00' = Development/Test
  tipoDte: string; // Document type code
  tipoEvento?: DTEEventType;
  numeroControl: string;
  codigoGeneracion: string;
  tipoModelo: number;
  tipoOperacion: number;
  tipoContingencia?: number;
  motivoContin?: string;
  fusion?: string | null;
  fecEmi: string; // Format: YYYY-MM-DD
  horEmi: string; // Format: HH:mm:ss
  tipoMoneda: string; // Currency code
}

// Related Document (for credit/debit notes)
export interface RelatedDocument {
  tipoDocumento: string;
  tipoGeneracion: number;
  numeroDocumento: string;
  fechaEmision: string;
}

// Issuer (Company)
export interface DTEEmisor {
  nit: string;
  nrc: string;
  nombre: string;
  codActividad: string;
  descActividad?: string;
  nombreComercial?: string;
  tipoEstablecimiento: string;
  direccion: DTEAddress;
  telefono: string;
  correo: string;
  codEstableMH?: string;
  codEstable?: string;
  codPuntoVentaMH?: string;
  codPuntoVenta?: string;

  // Export-specific fields for FacturaExportacion (tipoDte="11")
  tipoItemExpor?: number;
  recintoFiscal?: string;
  tipoRegimen?: string;
  regimen?: string;
}

// Receiver (Customer)
export interface DTEReceptor {
  tipoDocumento?: string;
  numDocumento?: string;
  nrc?: string;
  nombre: string;
  codActividad?: string;
  descActividad?: string;
  nombreComercial?: string;
  direccion?: DTEAddress;
  telefono?: string;
  correo?: string;

  // Some DTE types include these
  nit?: string;
  bienTitulo?: string;
  complemento?: string;

  // Export-specific fields for FacturaExportacion
  codPais?: string;
  nombrePais?: string;
  tipoPersona?: number;
}

// Address structure
export interface DTEAddress {
  departamento: string;
  municipio: string;
  complemento: string;
  distrito?: string;
}

// Other documents
export interface OtherDocument {
  codDocAsociado: number;
  descDocumento?: string;
  detalleDocumento?: string;
  medico?: DTEMedico;
}

// Medical professional (for specific document types)
export interface DTEMedico {
  nombre: string;
  nit?: string;
  docIdentificacion?: string;
  tipoServicio?: number;
}

// Third party sales
export interface ThirdPartySale {
  nit: string;
  nombre: string;
}

// DTE Body (Line items)
export interface DTEBody {
  numItem: number;
  tipoItem: number;
  numeroDocumento?: string;
  cantidad: number;
  codigo?: string;
  codTributo?: string;
  uniMedida: number;
  descripcion: string;
  precioUni: number;
  montoDescu: number;
  ventaNoSuj: number;
  ventaExenta: number;
  ventaGravada: number;
  tributos?: DTETribute[];
  psv?: number;
  noGravado?: number;
  ivaItem?: number;

  // ComprobanteLiquidacion specific fields
  fechaGeneracion?: string;
  tipoGeneracion?: number;
  tipoDte?: string;
  obsItem?: string;
  observaciones?: string;
  fechaEmision?: string;

  // SujetoExcluido specific field
  compra?: number;
  ivaPerci?: number;
  totalIva?: number;
  ivaRete?: number;
  seguro?: number;
  flete?: number;
  reteRenta?: number;
}

// Tribute information
export interface DTETribute {
  codigo: string;
  descripcion: string;
  valor: number;
}

// DTE Summary
export interface DTESummary {
  totalNoSuj: number;
  totalExenta: number;
  totalGravada: number;
  subTotalVentas: number;
  descuNoSuj: number;
  descuExenta: number;
  descuGravada: number;
  porcentajeDescuento: number;
  totalDescu: number;
  tributos?: DTETribute[];
  subTotal: number;
  ivaRete1: number;
  ivaRete?: number;
  reteRenta: number;
  montoTotalOperacion: number;
  totalNoGravado: number;
  totalPagar: number;
  totalLetras: string;
  totalIva?: number;
  saldoFavor: number;
  condicionOperacion: number;
  pagos?: DTEPayment[];
  numPagoElectronico?: string;

  // Export-specific fields (FacturaExportacion)
  descuento?: number;
  seguro?: number;
  flete?: number;
  codIncoterms?: string;
  descIncoterms?: string;
  observaciones?: string;
  totalCompra?: number;
  ivaPerci1?: number;
  ivaPerci?: number;
  total?: number;
  totalExportacion?: number;
  exportacion?: number;
  totalNoOnerosas?: number;
  codigoRetencionMH?: string | null;
}

// Payment information
export interface DTEPayment {
  codigo: string;
  montoPago: number;
  referencia?: string;
  plazo?: string;
  periodo?: number;
}

// DTE Extension
export interface DTEExtension {
  nombEntrega?: string;
  docuEntrega?: string;
  nombRecibe?: string;
  docuRecibe?: string;
  observaciones?: string;
  placaVehiculo?: string;
}

// DTE Appendix
export interface DTEAppendix {
  campo: string;
  etiqueta: string;
  valor: string;
}

// API Response wrapper
export interface DTEResponseWrapper {
  version: number;
  ambiente: string;
  versionApp: number;
  estado: string;
  codigoGeneracion: string;
  selloRecibido: string;
  fhProcesamiento: string;
  fechaTransmision?: string;
  horaTransmision?: string;
  clasificaMsg: string;
  codigoMsg: string;
  descripcionMsg: string;
  observaciones?: string[];
  numeroControl?: string;
}

// Error response wrapper
export interface DTEErrorResponseWrapper {
  estado: string;
  codigoGeneracion?: string;
  descripcionMsg: string;
  observaciones: string[];
}

// Motivo (Invalidation reason) - matches Swift Motivo struct
export interface Motivo {
  tipoAnulacion: number;
  motivoAnulacion?: string;
  nombreResponsable: string;
  tipDocResponsable: string;
  numDocResponsable: string;
  nombreSolicita: string;
  tipDocSolicita: string;
  numDocSolicita: string;
  codEstableMH?: string;
  codEstable?: string;
  codPuntoVentaMH?: string;
  codPuntoVenta?: string;
}

// DTE Invalidation Request (matches Swift DTE_InvalidationRequest exactly)
export interface DTE_InvalidationRequest {
  identificacion: {
    version: number;
    ambiente: string;
    codigoGeneracion: string;
    fecEmi: string; // Format: YYYY-MM-DD
    horEmi: string; // Format: HH:mm:ss
    fusion: string | null;
  };
  emisor: {
    nit: string;
    nombre: string;
    codEstableMH: string;
    codEstable?: string | null;
    codPuntoVentaMH: string;
    codPuntoVenta?: string | null;
    telefono: string;
    correo: string;
  };
  documento: {
    tipoDte: string;
    codigoGeneracion: string;
    selloRecibido: string;
    numeroControl: string | null;
    fecEmi: string; // Format: YYYY-MM-DD
    codigoGeneracionR: string | null;
    tipoDocumento: string | null; // Customer document type (13 for DUI, 36 for NIT)
    numDocumento: string | null; // Customer document number
    nombre: string | null; // Customer name
    telefono: string | null; // Customer phone
    correo: string | null; // Customer email
  };
  motivo: {
    tipoAnulacion: number;
    motivoAnulacion?: string;
    nombreResponsable: string;
    tipDocResponsable: string;
    numDocResponsable: string;
    nombreSolicita: string;
    tipDocSolicita: string;
    numDocSolicita: string;
    codEstableMH?: string | null;
    codEstable?: string;
    codPuntoVentaMH?: string | null;
    codPuntoVenta?: string;
  };
}

// Service credentials for API calls
export interface ServiceCredentials {
  user: string;
  credential: string;
  key: string;
  invoiceNumber: string;
}

// Contingency request
export interface ContingenciaRequest {
  identificacion: {
    version: number;
    ambiente: string;
    codigoGeneracion: string;
    fTransmision: string;
    hTransmision: string;
  };
  emisor: {
    nit: string;
    nombre: string;
    nombreResponsable: string;
    tipoDocResponsable: string;
    numeroDocResponsable: string;
    tipoEstablecimiento: string;
    codEstableMH?: string | null;
    codEstable?: string;
    codPuntoVentaMH?: string | null;
    codPuntoVenta?: string;
    telefono: string;
    correo: string;
  };
  detalleDTE: ContingencyDetail[];
  motivo?: {
    fInicio: string;
    fFin: string;
    hInicio: string;
    hFin: string;
    tipoContingencia: number;
    motivoContingencia?: string;
  };
}

export interface ContingencyDetail {
  noItem?: number;
  codigoGeneracion: string;
  tipoDoc?: string;
  tipodte?: string;
  fechaEmi?: string;
  montoImpuesto?: number;
  numeroControl?: string;
  tipoContingencia?: number;
  motivoContingencia?: string;
}

// DTE validation types
export interface DTEValidationErrors {
  identificacion?: string[];
  emisor?: string[];
  receptor?: string[];
  cuerpoDocumento?: string[];
  resumen?: string[];
  general?: string[];
}

export interface DTEValidationResult {
  isValid: boolean;
  errors: DTEValidationErrors;
  warnings: string[];
}

// DTE state for Redux
export interface DTEState {
  currentDTE: DTE_Base | null;
  lastResponse: DTEResponseWrapper | null;
  validationResult: DTEValidationResult | null;
  submitting: boolean;
  error: string | null;
}

// DTE generation input
export interface DTEGenerationInput {
  companyId: string;
  invoiceId: string;
  environment: 'PRODUCTION' | 'TEST';
  documentType: string;
  credentials: ServiceCredentials;
}

// DTE PDF upload
export interface DTEPDFUpload {
  pdfData: string; // Base64 encoded
  controlNumber: string;
  companyNit: string;
  environment: 'PRODUCTION' | 'TEST';
}
