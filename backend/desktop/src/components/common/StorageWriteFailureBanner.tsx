import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import {
  clearStorageWriteFailure,
  getLastStorageWriteFailure,
  onStorageWriteFailure,
  type StorageWriteFailure,
} from '@/services/storage/storageHealth';

/**
 * Persistent warning when a save to disk failed — the data stays only in memory
 * and is lost on the next restart, so the user must know before closing the app.
 */
export function StorageWriteFailureBanner() {
  const [failure, setFailure] = useState<StorageWriteFailure | null>(() => getLastStorageWriteFailure());

  useEffect(() => onStorageWriteFailure(setFailure), []);

  if (!failure) return null;

  return (
    <div
      role="alert"
      data-testid="storage-write-failure"
      className="fixed bottom-4 left-1/2 z-50 w-[min(640px,calc(100%-2rem))] -translate-x-1/2 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 shrink-0" size={18} />
        <div className="flex-1">
          <p className="font-semibold">No se pudieron guardar los últimos cambios en este equipo.</p>
          <p className="mt-1">
            Lo que registraste después de este aviso podría perderse al cerrar la aplicación. Exporta tus
            documentos (DTE y Eventos → Exportar) y contacta a soporte. Detalle: {failure.message}
          </p>
        </div>
        <button
          type="button"
          aria-label="Cerrar aviso"
          className="text-red-700 hover:text-red-900"
          onClick={() => {
            clearStorageWriteFailure();
            setFailure(null);
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
