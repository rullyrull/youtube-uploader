import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const getYoutubeStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { getGoogleCredentials, loadAccounts } = await import("./youtube.server");
  const { clientId, clientSecret } = getGoogleCredentials();
  const configured = Boolean(clientId && clientSecret);
  if (!configured) return { configured: false, connected: false, channelTitle: null, accounts: [] };
  const accounts = await loadAccounts();
  return {
    configured: true,
    connected: accounts.length > 0,
    channelTitle: accounts[0]?.channel_title ?? null,
    accounts: accounts.map((a) => ({ id: a.channel_id, title: a.channel_title })),
  };
});

export const getYoutubeAuthUrl = createServerFn({ method: "POST" }).handler(async () => {
  const { getGoogleCredentials, redirectUriFor, YOUTUBE_SCOPE } = await import("./youtube.server");
  const { clientId, clientSecret } = getGoogleCredentials();
  if (!clientId || !clientSecret) {
    throw new Error("Kredensial Google OAuth belum diatur.");
  }
  const origin = new URL(getRequest().url).origin;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUriFor(origin),
    response_type: "code",
    scope: `${YOUTUBE_SCOPE} https://www.googleapis.com/auth/youtube.readonly`,
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
});

export const listYoutubeChannels = createServerFn({ method: "GET" }).handler(async () => {
  const { getValidAccessToken, listChannels, loadAccounts } = await import("./youtube.server");
  const accounts = await loadAccounts();
  const results: Array<{ id: string; title: string; thumbnail: string | null }> = [];
  for (const account of accounts) {
    try {
      const token = await getValidAccessToken(account.channel_id);
      const channels = await listChannels(token);
      for (const c of channels) {
        if (!results.some((r) => r.id === c.id)) results.push(c);
      }
    } catch {
      // token channel ini bermasalah — tetap tampilkan data dasar dari DB
      if (!results.some((r) => r.id === account.channel_id)) {
        results.push({
          id: account.channel_id,
          title: account.channel_title ?? account.channel_id,
          thumbnail: null,
        });
      }
    }
  }
  return results;
});

export const getAppSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("default_channel_id, default_channel_title, default_kind, default_privacy, default_description")
    .eq("id", "default")
    .maybeSingle();
  return {
    channelId: data?.default_channel_id ?? "",
    channelTitle: data?.default_channel_title ?? "",
    kind: data?.default_kind === "reels" ? "reels" : "video",
    privacy: data?.default_privacy ?? "private",
    description: data?.default_description ?? "",
  };
});

export const saveAppSettings = createServerFn({ method: "POST" })
  .inputValidator((input: {
    channelId?: string | null;
    channelTitle?: string | null;
    kind?: string;
    privacy?: string;
    description?: string;
  }) => ({
    channelId: input.channelId?.trim() || null,
    channelTitle: input.channelTitle?.trim() || null,
    kind: input.kind === "reels" ? "reels" : "video",
    privacy: ["private", "unlisted", "public"].includes(input.privacy ?? "")
      ? input.privacy!
      : "private",
    description: (input.description ?? "").slice(0, 4500),
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert(
      {
        id: "default",
        default_channel_id: data.channelId,
        default_channel_title: data.channelTitle,
        default_kind: data.kind,
        default_privacy: data.privacy,
        default_description: data.description,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const disconnectYoutube = createServerFn({ method: "POST" })
  .inputValidator((input?: { channelId?: string | null }) => ({
    channelId: input?.channelId?.trim() || null,
  }))
  .handler(async ({ data }) => {
    const { deleteAccount } = await import("./youtube.server");
    await deleteAccount(data.channelId);
    return { ok: true };
  });

export const listUploads = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("uploads")
    .select("id, title, drive_url, status, video_id, error, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  return data ?? [];
});

export const uploadFromDrive = createServerFn({ method: "POST" })
  .inputValidator((input: {
    driveUrl: string;
    title: string;
    description?: string;
    privacy?: string;
    channelId?: string | null;
    kind?: string;
  }) => {
    if (!input?.driveUrl?.trim()) throw new Error("Link Google Drive wajib diisi.");
    if (!input?.title?.trim()) throw new Error("Judul video wajib diisi.");
    const privacy = ["private", "unlisted", "public"].includes(input.privacy ?? "")
      ? (input.privacy as "private" | "unlisted" | "public")
      : ("private" as const);
    const kind = input.kind === "reels" ? ("reels" as const) : ("video" as const);
    return {
      kind,
      channelId: input.channelId?.trim() || null,
      driveUrl: input.driveUrl.trim(),
      title: input.title.trim().slice(0, 100),
      description: (input.description ?? "").slice(0, 4500),
      privacy,
    };
  })
  .handler(async ({ data }) => {
    const { parseDriveFileId, uploadDriveVideoToYouTube } = await import("./youtube.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const fileId = parseDriveFileId(data.driveUrl);
    if (!fileId) throw new Error("Link Google Drive tidak valid.");

    // YouTube Shorts/Reels dikenali dari durasi/rasio + tag #Shorts.
    const title =
      data.kind === "reels" && !/#shorts/i.test(data.title)
        ? `${data.title} #Shorts`.slice(0, 100)
        : data.title;
    const description =
      data.kind === "reels" && !/#shorts/i.test(data.description)
        ? `${data.description}\n\n#Shorts`.trim().slice(0, 4500)
        : data.description;

    const { data: row } = await supabaseAdmin
      .from("uploads")
      .insert({
        drive_url: data.driveUrl,
        title,
        description,
        privacy: data.privacy,
        status: "uploading",
      })
      .select("id")
      .single();

    try {
      const videoId = await uploadDriveVideoToYouTube({
        fileId,
        title,
        description,
        privacy: data.privacy,
        channelId: data.channelId,
        kind: data.kind,
      });
      if (row?.id) {
        await supabaseAdmin
          .from("uploads")
          .update({ status: "done", video_id: videoId, updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }
      return { videoId, url: `https://youtu.be/${videoId}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (row?.id) {
        await supabaseAdmin
          .from("uploads")
          .update({ status: "error", error: message, updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }
      throw new Error(message);
    }
  });
