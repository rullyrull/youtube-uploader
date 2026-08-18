/**
 * Server-only helpers untuk OAuth YouTube + upload video dari Google Drive.
 * Jangan import file ini dari komponen React.
 */

export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.upload";

export function getGoogleCredentials() {
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
  return { clientId, clientSecret };
}

export function redirectUriFor(origin: string) {
  return `${origin}/api/public/youtube/callback`;
}

export function parseDriveFileId(input: string): string | null {
  const url = (input ?? "").trim();
  if (!url) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{10,})/,
    /\/document\/d\/([a-zA-Z0-9_-]{10,})/,
    /\/d\/([a-zA-Z0-9_-]{10,})/,
    /[?&]id=([a-zA-Z0-9_-]{10,})/,
    /\/uc\?[^ ]*id=([a-zA-Z0-9_-]{10,})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m?.[1]) return m[1];
  }
  // bare ID
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) return url;
  // last resort: longest id-looking segment in the URL
  const candidates = url.match(/[a-zA-Z0-9_-]{25,}/g);
  if (candidates?.length) {
    return candidates.sort((a, b) => b.length - a.length)[0];
  }
  return null;
}


export function driveDownloadUrl(fileId: string) {
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
}

type AccountRow = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  channel_title: string | null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function loadAccount(): Promise<AccountRow | null> {
  const db = await admin();
  const { data, error } = await db
    .from("youtube_account")
    .select("access_token, refresh_token, expires_at, channel_title")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw error;
  return (data as AccountRow | null) ?? null;
}

export async function saveAccount(row: {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  channel_id?: string | null;
  channel_title?: string | null;
}) {
  const db = await admin();
  const { error } = await db
    .from("youtube_account")
    .upsert({ id: "default", ...row, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw error;
}

export async function deleteAccount() {
  const db = await admin();
  await db.from("youtube_account").delete().eq("id", "default");
}

export async function exchangeCode(code: string, redirectUri: string) {
  const { clientId, clientSecret } = getGoogleCredentials();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Token exchange gagal [${res.status}]: ${body}`);
  return JSON.parse(body) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getGoogleCredentials();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Refresh token gagal [${res.status}]: ${body}`);
  return JSON.parse(body) as { access_token: string; expires_in: number };
}

/** Ambil access token yang valid, refresh otomatis kalau sudah mau habis. */
export async function getValidAccessToken(): Promise<string> {
  const account = await loadAccount();
  if (!account) throw new Error("Belum ada akun YouTube yang terhubung.");
  const expiresAt = new Date(account.expires_at).getTime();
  if (expiresAt - Date.now() > 60_000) return account.access_token;

  const refreshed = await refreshAccessToken(account.refresh_token);
  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await saveAccount({
    access_token: refreshed.access_token,
    refresh_token: account.refresh_token,
    expires_at: newExpiry,
  });
  return refreshed.access_token;
}

export async function listChannels(accessToken: string) {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const body = await res.text();
  if (!res.ok) throw new Error(`Gagal mengambil daftar channel [${res.status}]: ${body}`);
  const json = JSON.parse(body) as {
    items?: Array<{ id: string; snippet: { title: string; thumbnails?: { default?: { url?: string } } } }>;
  };
  return (json.items ?? []).map((i) => ({
    id: i.id,
    title: i.snippet.title,
    thumbnail: i.snippet.thumbnails?.default?.url ?? null,
  }));
}

export async function fetchChannelInfo(accessToken: string) {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return { id: null as string | null, title: null as string | null };
  const json = (await res.json()) as {
    items?: Array<{ id: string; snippet: { title: string } }>;
  };
  const item = json.items?.[0];
  return { id: item?.id ?? null, title: item?.snippet?.title ?? null };
}

/** Unduh dari Drive (link publik) lalu upload ke YouTube via resumable upload. */
export async function uploadDriveVideoToYouTube(opts: {
  fileId: string;
  title: string;
  description: string;
  privacy: "private" | "unlisted" | "public";
  channelId?: string | null;
  kind?: "video" | "reels";
}) {
  const accessToken = await getValidAccessToken();

  const driveRes = await fetch(driveDownloadUrl(opts.fileId));
  if (!driveRes.ok || !driveRes.body) {
    throw new Error(
      `Gagal mengunduh dari Google Drive [${driveRes.status}]. Pastikan link "anyone with the link".`,
    );
  }
  const contentType = driveRes.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    throw new Error(
      "Google Drive mengembalikan halaman HTML, bukan file video. Pastikan file dibagikan publik dan bukan folder.",
    );
  }
  const contentLength = driveRes.headers.get("content-length");

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": contentType || "video/*",
        ...(contentLength ? { "X-Upload-Content-Length": contentLength } : {}),
      },
      body: JSON.stringify({
        snippet: {
          title: opts.title,
          description: opts.description,
          ...(opts.channelId ? { channelId: opts.channelId } : {}),
        },
        status: { privacyStatus: opts.privacy, selfDeclaredMadeForKids: false },
      }),
    },
  );
  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`Inisialisasi upload YouTube gagal [${initRes.status}]: ${err}`);
  }
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube tidak mengembalikan URL upload.");

  const bodyInit: RequestInit = {
    method: "PUT",
    headers: {
      "Content-Type": contentType || "video/*",
      ...(contentLength ? { "Content-Length": contentLength } : {}),
    },
    body: contentLength ? driveRes.body : await driveRes.arrayBuffer(),
    // @ts-expect-error duplex diperlukan saat body berupa stream
    duplex: "half",
  };

  const uploadRes = await fetch(uploadUrl, bodyInit);
  const uploadBody = await uploadRes.text();
  if (!uploadRes.ok) {
    throw new Error(`Upload ke YouTube gagal [${uploadRes.status}]: ${uploadBody}`);
  }
  const video = JSON.parse(uploadBody) as { id: string };
  return video.id;
}
