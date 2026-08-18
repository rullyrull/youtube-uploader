/** Server-only: baca isi folder Google Drive via Lovable connector gateway. */

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";

function gatewayHeaders() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connKey = process.env["GOOGLE_DRIVE_API_KEY"];
  if (!lovableKey || !connKey) {
    throw new Error("Koneksi Google Drive belum diatur pada proyek ini.");
  }
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
  };
}

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

export async function listFolderVideos(folderId: string): Promise<DriveVideo[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false and (mimeType contains 'video/' or mimeType = 'application/vnd.google-apps.folder')`,
    fields:
      "files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink)",
    pageSize: "200",
    orderBy: "folder,modifiedTime desc",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await fetch(`${GATEWAY}/drive/v3/files?${params.toString()}`, {
    headers: gatewayHeaders(),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Gagal membaca folder Drive [${res.status}]: ${body}`);
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

/** Unduh file lewat gateway (dipakai kalau link publik gagal). */
export async function fetchDriveFileViaGateway(fileId: string) {
  const res = await fetch(
    `${GATEWAY}/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: gatewayHeaders() },
  );
  return res;
}
