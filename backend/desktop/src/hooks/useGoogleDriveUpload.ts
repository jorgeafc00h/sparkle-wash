/**
 * useGoogleDriveUpload — Hook para operaciones de Google Drive
 *
 * Envuelve GoogleDriveExportService con estado de carga, error
 * y registro de la última subida exitosa.
 */

import { useState, useCallback } from 'react';
import GoogleDriveExportService, { BackupData, DriveFile } from '@/services/export/GoogleDriveExportService';

export interface LastUploadInfo {
  fileId: string;
  webViewLink: string;
  uploadedAt: string;
}

export interface UseGoogleDriveUploadReturn {
  /**
   * Sube un respaldo a Google Drive.
   * @param data - Datos del respaldo a subir
   * @returns Información del archivo creado, o null si falló
   */
  upload: (data: BackupData) => Promise<LastUploadInfo | null>;
  /**
   * Lista los respaldos existentes en Google Drive.
   * @returns Lista de archivos de respaldo
   */
  listBackups: () => Promise<DriveFile[]>;
  /** true mientras se procesa una subida o listado */
  isUploading: boolean;
  /** Último error ocurrido (null si no hay error) */
  error: string | null;
  /** Información de la última subida exitosa */
  lastUpload: LastUploadInfo | null;
  /** Limpia el estado de error */
  clearError: () => void;
}

export function useGoogleDriveUpload(): UseGoogleDriveUploadReturn {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [lastUpload, setLastUpload]   = useState<LastUploadInfo | null>(null);

  const upload = useCallback(async (data: BackupData): Promise<LastUploadInfo | null> => {
    setIsUploading(true);
    setError(null);
    try {
      const { fileId, webViewLink } = await GoogleDriveExportService.exportBackup(data);
      const info: LastUploadInfo = {
        fileId,
        webViewLink,
        uploadedAt: new Date().toISOString(),
      };
      setLastUpload(info);
      return info;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al subir a Google Drive';
      setError(message);
      return null;
    } finally {
      setIsUploading(false);
    }
  }, []);

  const listBackups = useCallback(async (): Promise<DriveFile[]> => {
    setIsUploading(true);
    setError(null);
    try {
      return await GoogleDriveExportService.listBackups();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al listar respaldos de Google Drive';
      setError(message);
      return [];
    } finally {
      setIsUploading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    upload,
    listBackups,
    isUploading,
    error,
    lastUpload,
    clearError,
  };
}
