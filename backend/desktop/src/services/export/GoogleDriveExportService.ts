// Google Drive Export Service
// Uses Google Drive REST API v3 directly with the access token from GoogleAuthService

import axios from 'axios';
import GoogleAuthService, { GOOGLE_SCOPES } from '../auth/GoogleAuthService';

// ── Types ─────────────────────────────────────────────────────────────────

export interface BackupData {
  version: string;
  exportDate: string;
  companies: unknown[];
  customers: unknown[];
  products: unknown[];
  invoices: unknown[];
}

export interface DriveFile {
  id: string;
  name: string;
  createdTime: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const BACKUP_FILE_PREFIX = 'SparkleWash_Backup';

// Drive access is requested on first use, not at sign-in. User-initiated
// calls may open the Google consent page (first Drive use, or the stored grant
// was revoked); background listings never do.
async function getAuthHeader(interactive = true): Promise<Record<string, string>> {
  const accessToken = await GoogleAuthService.getAccessTokenForScope(GOOGLE_SCOPES.DRIVE_FILE, { interactive });
  return { Authorization: `Bearer ${accessToken}` };
}

// ── Service ───────────────────────────────────────────────────────────────

const GoogleDriveExportService = {
  /**
   * Exports all app data as a JSON backup to Google Drive.
   * Returns the Drive file ID and shareable link.
   */
  async exportBackup(data: BackupData): Promise<{ fileId: string; webViewLink: string }> {
    const headers = await getAuthHeader();
    const fileName = `${BACKUP_FILE_PREFIX}_${new Date().toISOString().slice(0, 10)}.json`;
    const jsonContent = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });

    // Multipart upload: metadata + content
    const metadata = {
      name: fileName,
      mimeType: 'application/json',
      description: 'Respaldo automático de Car Spa',
    };

    const formData = new FormData();
    formData.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
    );
    formData.append('file', blob);

    const resp = await axios.post<{ id: string; webViewLink: string }>(
      `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,webViewLink`,
      formData,
      {
        headers: {
          ...headers,
          // Axios sets Content-Type automatically for FormData (multipart/form-data with boundary)
        },
      },
    );

    return { fileId: resp.data.id, webViewLink: resp.data.webViewLink ?? '' };
  },

  /**
   * Lists existing backup files on Google Drive.
   */
  async listBackups(): Promise<DriveFile[]> {
    const headers = await getAuthHeader(false);

    const resp = await axios.get<{ files: DriveFile[] }>(DRIVE_API, {
      headers,
      params: {
        q: `name contains '${BACKUP_FILE_PREFIX}' and trashed = false`,
        fields: 'files(id,name,createdTime,modifiedTime,size,webViewLink)',
        orderBy: 'createdTime desc',
        pageSize: 20,
      },
    });

    return resp.data.files ?? [];
  },

  /**
   * Upload an arbitrary file (CSV/PDF/Excel/JSON/etc.) to Google Drive.
   * Optionally places it inside `folderId`. Returns the created file's id
   * and webViewLink.
   */
  async uploadFile(params: {
    content: Blob | string;
    fileName: string;
    mimeType: string;
    folderId?: string;
    description?: string;
  }): Promise<{ fileId: string; webViewLink: string }> {
    const headers = await getAuthHeader();
    const blob =
      typeof params.content === 'string'
        ? new Blob([params.content], { type: params.mimeType })
        : params.content;

    const metadata: Record<string, unknown> = {
      name: params.fileName,
      mimeType: params.mimeType,
    };
    if (params.description) metadata.description = params.description;
    if (params.folderId) metadata.parents = [params.folderId];

    const formData = new FormData();
    formData.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
    );
    formData.append('file', blob);

    const resp = await axios.post<{ id: string; webViewLink: string }>(
      `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,webViewLink`,
      formData,
      { headers },
    );
    return { fileId: resp.data.id, webViewLink: resp.data.webViewLink ?? '' };
  },

  /**
   * Find a folder by name at the Drive root (or under `parentId`), creating
   * it if missing. Returns the folder id.
   */
  async ensureFolder(name: string, parentId?: string): Promise<string> {
    const headers = await getAuthHeader();
    const escaped = name.replace(/'/g, "\\'");
    const q = [
      `name = '${escaped}'`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `trashed = false`,
      parentId ? `'${parentId}' in parents` : `'root' in parents`,
    ].join(' and ');

    const existing = await axios.get<{ files: Array<{ id: string }> }>(DRIVE_API, {
      headers,
      params: { q, fields: 'files(id)', pageSize: 1 },
    });
    if (existing.data.files?.[0]?.id) return existing.data.files[0].id;

    const created = await axios.post<{ id: string }>(
      `${DRIVE_API}?fields=id`,
      {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined,
      },
      { headers: { ...headers, 'Content-Type': 'application/json' } },
    );
    return created.data.id;
  },

  /**
   * Downloads and parses a backup file from Google Drive.
   */
  async downloadBackup(fileId: string): Promise<BackupData> {
    const headers = await getAuthHeader();

    const resp = await axios.get<BackupData>(
      `${DRIVE_API}/${fileId}`,
      {
        headers,
        params: { alt: 'media' },
      },
    );

    return resp.data;
  },
};

export default GoogleDriveExportService;
