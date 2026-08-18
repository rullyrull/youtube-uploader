import { createServerFn } from "@tanstack/react-start";

export const getDriveStatus = createServerFn({ method: "GET" }).handler(async () => {
  return {
    configured: Boolean(process.env["LOVABLE_API_KEY"] && process.env["GOOGLE_DRIVE_API_KEY"]),
  };
});

export const listDriveFolderVideos = createServerFn({ method: "POST" })
  .inputValidator((input: { folderUrl: string }) => {
    if (!input?.folderUrl?.trim()) throw new Error("Link folder Google Drive wajib diisi.");
    return { folderUrl: input.folderUrl.trim() };
  })
  .handler(async ({ data }) => {
    const { parseDriveFolderId, listFolderVideos } = await import("./drive.server");
    const folderId = parseDriveFolderId(data.folderUrl);
    if (!folderId) throw new Error("Link folder Google Drive tidak valid.");
    const files = await listFolderVideos(folderId);
    return {
      folderId,
      folders: files.filter((f) => f.mimeType === "application/vnd.google-apps.folder"),
      videos: files.filter((f) => f.mimeType !== "application/vnd.google-apps.folder"),
    };
  });
