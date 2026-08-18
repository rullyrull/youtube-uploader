/**
 * Server-only: baca isi folder Google Drive memakai token OAuth Google
 * yang sudah tersimpan di aplikasi (login lewat tombol "Hubungkan YouTube").
 * Tidak memakai konektor eksternal, jadi tetap jalan setelah di-remix.
 */

const DRIVE_API = "https://www.googleapis.com/drive/v3";

export function parseDriveFolderId(input: string): string | null {
  const url = (input ?? "").trim();
  if (!url) return null;
  const m =
    url.match(/\/folders\/([a-zA-Z0-9_-]{10,})/) ??
    url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m?.[1]) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) return url;
  return null;
}

export type DriveVideo = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  thumbnail: string | null;
  webViewLink: string;
};

export async function listFolderVideos(
  folderId: string,
  accessToken: string,
): Promise<DriveVideo[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false and (mimeType contains 'video/' or mimeType = 'application/vnd.google-apps.folder')`,
    fields: "files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink)",
    pageSize: "200",
    orderBy: "folder,modifiedTime desc",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.text();
  if (!res.ok) {
    if (res.status === 403 || res.status === 401) {
      throw new Error(
        `Akses Google Drive ditolak [${res.status}]. Klik "Tambah channel lain" untuk login ulang dan setujui izin Google Drive.`,
      );
    }
    throw new Error(`Gagal membaca folder Drive [${res.status}]: ${body.slice(0, 300)}`);
  }
  const json = JSON.parse(body) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      modifiedTime?: string;
      thumbnailLink?: string;
      webViewLink?: string;
    }>;
  };
  return (json.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size ? Number(f.size) : null,
    modifiedTime: f.modifiedTime ?? null,
    thumbnail: f.thumbnailLink ?? null,
    webViewLink: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
  }));
}

/** Unduh file Drive dengan token OAuth (untuk file yang tidak publik). */
export async function fetchDriveFileWithToken(fileId: string, accessToken: string) {
  return fetch(`${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
