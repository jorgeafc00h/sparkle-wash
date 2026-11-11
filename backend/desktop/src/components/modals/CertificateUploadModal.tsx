import React, { useState, useCallback } from 'react';
import { Upload, Key, CheckCircle, AlertCircle, FileText, Eye, EyeOff } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { parseCertificateXML } from '@/services/signing/CertificateParser';
import { SecureStorageService } from '@/services/security/SecureStorageService';

export interface CertificateUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (certInfo: { subject: string; validTo: string }) => void;
  companyNit: string;
}

type Step = 'file' | 'password' | 'validating' | 'details' | 'error';

interface CertDetails {
  subject: string;
  nit: string;
  isActive: boolean;
}

export function CertificateUploadModal({
  isOpen,
  onClose,
  onSuccess,
  companyNit,
}: CertificateUploadModalProps) {
  const [step, setStep] = useState<Step>('file');
  const [filePath, setFilePath] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [certDetails, setCertDetails] = useState<CertDetails | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setStep('file');
    setFilePath('');
    setFileContent('');
    setPassword('');
    setShowPassword(false);
    setCertDetails(null);
    setErrorMessage('');
    setSaving(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handlePickFile = useCallback(async () => {
    try {
      const result = await window.electronAPI?.showOpenDialog({
        filters: [
          { name: 'Certificado MH', extensions: ['crt', 'xml', 'p12', 'pfx'] },
          { name: 'Todos los archivos', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });

      if (!result || result.length === 0) return;

      const path = result[0];
      setFilePath(path);

      // Read file content via Electron
      const content = await window.electronAPI?.readFile(path);
      if (!content) {
        setErrorMessage('No se pudo leer el archivo seleccionado.');
        setStep('error');
        return;
      }
      setFileContent(content);
      setStep('password');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Error al abrir el archivo.');
      setStep('error');
    }
  }, []);

  const handleValidate = useCallback(async () => {
    if (!fileContent) return;
    setStep('validating');
    try {
      const certData = parseCertificateXML(fileContent);
      setCertDetails({
        subject: certData.nit || companyNit,
        nit: certData.nit,
        isActive: certData.activo,
      });
      setStep('details');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'El archivo no es un certificado MH válido.'
      );
      setStep('error');
    }
  }, [fileContent, companyNit]);

  const handleSave = useCallback(async () => {
    if (!certDetails || !fileContent) return;
    setSaving(true);
    try {
      await SecureStorageService.storeCertificateData(companyNit, fileContent);
      if (password) {
        await SecureStorageService.storeCertificatePassword(companyNit, password);
      }
      onSuccess({ subject: certDetails.subject, validTo: '' });
      reset();
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Error al guardar el certificado.');
      setStep('error');
    } finally {
      setSaving(false);
    }
  }, [certDetails, fileContent, password, companyNit, onSuccess, reset, onClose]);

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Cargar Certificado Digital"
      size="md"
    >
      <div className="flex flex-col gap-6 py-2">
        {/* Step indicators */}
        <div className="flex items-center gap-2">
          {(['file', 'password', 'details'] as const).map((s, i) => {
            const labels = ['Archivo', 'Contraseña', 'Verificar'];
            const stepOrder: Step[] = ['file', 'password', 'validating', 'details'];
            const currentIndex = stepOrder.indexOf(step);
            const thisIndex = stepOrder.indexOf(s);
            const done = currentIndex > thisIndex;
            const active = step === s || (step === 'validating' && s === 'details');
            return (
              <React.Fragment key={s}>
                {i > 0 && (
                  <div
                    className={[
                      'flex-1 h-px',
                      done ? 'bg-accent-500' : 'bg-brand-200',
                    ].join(' ')}
                  />
                )}
                <div className="flex items-center gap-1.5">
                  <div
                    className={[
                      'w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold',
                      done
                        ? 'bg-accent-500 text-white'
                        : active
                        ? 'bg-accent-100 text-accent-700 border-2 border-accent-500'
                        : 'bg-brand-100 text-brand-400',
                    ].join(' ')}
                  >
                    {done ? <CheckCircle size={12} /> : i + 1}
                  </div>
                  <span
                    className={[
                      'text-xs font-medium',
                      active ? 'text-brand-800' : 'text-brand-400',
                    ].join(' ')}
                  >
                    {labels[i]}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Step: file */}
        {step === 'file' && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-16 h-16 rounded-full bg-accent-50 flex items-center justify-center">
              <Upload size={28} className="text-accent-600" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-brand-800">
                Selecciona el archivo de certificado
              </p>
              <p className="text-xs text-brand-500 mt-1">
                Formatos aceptados: .crt / .xml (CertificadoMH), .p12, .pfx
              </p>
            </div>
            <Button onClick={handlePickFile} icon={<Upload size={15} />}>
              Seleccionar archivo
            </Button>
          </div>
        )}

        {/* Step: password */}
        {step === 'password' && (
          <div className="flex flex-col gap-4">
            {fileName && (
              <div className="flex items-center gap-2 px-3 py-2 bg-brand-50 rounded-lg border border-brand-200">
                <FileText size={16} className="text-brand-500 shrink-0" />
                <span className="text-sm text-brand-700 truncate">{fileName}</span>
              </div>
            )}
            <div className="relative">
              <Input
                label="Contraseña del certificado"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Ingresa la contraseña (opcional)"
                onKeyDown={(e) => e.key === 'Enter' && handleValidate()}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 bottom-2 text-brand-400 hover:text-brand-600 transition-colors"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="text-xs text-brand-500">
              Si el certificado no requiere contraseña, puedes dejar este campo vacío.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setStep('file')}>
                Atrás
              </Button>
              <Button onClick={handleValidate} icon={<Key size={15} />}>
                Validar certificado
              </Button>
            </div>
          </div>
        )}

        {/* Step: validating */}
        {step === 'validating' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <LoadingSpinner size="lg" className="text-accent-600" />
            <p className="text-sm text-brand-600">Validando certificado...</p>
          </div>
        )}

        {/* Step: details */}
        {step === 'details' && certDetails && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 px-4 py-3 bg-green-50 rounded-lg border border-green-200">
              <CheckCircle size={20} className="text-green-600 shrink-0" />
              <p className="text-sm font-medium text-green-800">Certificado válido</p>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-brand-500">NIT</dt>
                <dd className="text-sm font-medium text-brand-900">{certDetails.nit || '—'}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-brand-500">Estado</dt>
                <dd>
                  <span
                    className={[
                      'text-xs px-2 py-0.5 rounded-full font-medium',
                      certDetails.isActive
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700',
                    ].join(' ')}
                  >
                    {certDetails.isActive ? 'Activo' : 'Inactivo'}
                  </span>
                </dd>
              </div>
            </dl>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setStep('password')}>
                Atrás
              </Button>
              <Button
                onClick={handleSave}
                loading={saving}
                icon={saving ? undefined : <CheckCircle size={15} />}
              >
                Guardar certificado
              </Button>
            </div>
          </div>
        )}

        {/* Step: error */}
        {step === 'error' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 px-4 py-3 bg-red-50 rounded-lg border border-red-200">
              <AlertCircle size={20} className="text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Error al procesar el certificado</p>
                <p className="text-xs text-red-600 mt-0.5">{errorMessage}</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={handleClose}>
                Cancelar
              </Button>
              <Button onClick={reset} icon={<Upload size={15} />}>
                Intentar de nuevo
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default CertificateUploadModal;
