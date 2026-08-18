import { createServerFn } from "@tanstack/react-start";

export const listDriveFolderVideos = createServerFn({ method: "POST" })
  .inputValidator((input: { folderUrl: string; channelId?: string | null }) => {
    if (!input?.folderUrl?.trim()) throw new Error("Link folder Google Drive wajib diisi.");
    return {
      folderUrl: input.folderUrl.trim(),
      channelId: input.channelId?.trim() || null,
    };
  })
  .handler(async ({ data }) => {
    const { parseDriveFolderId, listFolderVideos } = await import("./drive.server");
    const { getValidAccessToken } = await import("./youtube.server");
    const folderId = parseDriveFolderId(data.folderUrl);
    if (!folderId) throw new Error("Link folder Google Drive tidak valid.");
    const accessToken = await getValidAccessToken(data.channelId);
    const files = await listFolderVideos(folderId, accessToken);
    return {
      folderId,
      folders: files.filter((f) => f.mimeType === "application/vnd.google-apps.folder"),
      videos: files.filter((f) => f.mimeType !== "application/vnd.google-apps.folder"),
    };
  });
