import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Youtube, Link2, LogOut, UploadCloud, CheckCircle2, XCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import {
  disconnectYoutube,
  getYoutubeAuthUrl,
  getYoutubeStatus,
  getAppSettings,
  listUploads,
  listYoutubeChannels,
  saveAppSettings,
  uploadFromDrive,
} from "@/lib/youtube.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Drive to YouTube — Upload Video dari Link Drive" },
      {
        name: "description",
        content:
          "Tempel link Google Drive publik, hubungkan akun YouTube Anda, dan unggah videonya langsung ke channel tanpa mengunduh manual.",
      },
      { property: "og:title", content: "Drive to YouTube — Upload Video dari Link Drive" },
      {
        property: "og:description",
        content:
          "Tempel link Google Drive publik dan unggah videonya langsung ke channel YouTube Anda.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["yt-status"], queryFn: () => getYoutubeStatus() });
  const uploads = useQuery({ queryKey: ["yt-uploads"], queryFn: () => listUploads() });
  const settings = useQuery({ queryKey: ["yt-settings"], queryFn: () => getAppSettings() });
  const saveSettingsFn = useServerFn(saveAppSettings);
  const channels = useQuery({
    queryKey: ["yt-channels"],
    queryFn: () => listYoutubeChannels(),
  });

  const authUrlFn = useServerFn(getYoutubeAuthUrl);
  const disconnectFn = useServerFn(disconnectYoutube);
  const uploadFn = useServerFn(uploadFromDrive);

  const [driveUrl, setDriveUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState("private");
  const [channelId, setChannelId] = useState("");
  const [kind, setKind] = useState<"video" | "reels">("video");

  // Terapkan pengaturan tersimpan sekali saat dimuat, supaya tetap sama setelah remix.
  const [settingsApplied, setSettingsApplied] = useState(false);
  useEffect(() => {
    if (settingsApplied || !settings.data) return;
    setChannelId(settings.data.channelId);
    setKind(settings.data.kind === "reels" ? "reels" : "video");
    setPrivacy(settings.data.privacy);
    if (settings.data.description) setDescription(settings.data.description);
    setSettingsApplied(true);
  }, [settings.data, settingsApplied]);

  useEffect(() => {
    const first = channels.data?.[0]?.id;
    if (settingsApplied && first && !channelId) setChannelId(first);
  }, [channels.data, channelId, settingsApplied]);

  const saveSettings = useMutation({
    mutationFn: () =>
      saveSettingsFn({
        data: {
          channelId,
          channelTitle: channels.data?.find((c) => c.id === channelId)?.title ?? null,
          kind,
          privacy,
          description,
        },
      }),
    onSuccess: () => {
      toast.success("Pengaturan default disimpan.");
      queryClient.invalidateQueries({ queryKey: ["yt-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("yt_connected")) {
      toast.success("Akun YouTube berhasil terhubung.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    const err = params.get("yt_error");
    if (err) {
      toast.error(err);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const connect = useMutation({
    mutationFn: () => authUrlFn(),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: (channelId?: string | null) => disconnectFn({ data: { channelId: channelId ?? null } }),
    onSuccess: (_res, channelId) => {
      toast.success(channelId ? "Channel diputus." : "Semua channel diputus.");
      queryClient.invalidateQueries({ queryKey: ["yt-status"] });
      queryClient.invalidateQueries({ queryKey: ["yt-channels"] });
      if (!channelId || channelId === channelIdState) setChannelId("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const upload = useMutation({
    mutationFn: () => uploadFn({ data: { driveUrl, title, description, privacy, channelId, kind } }),
    onSuccess: (res) => {
      toast.success("Video berhasil diunggah ke YouTube!");
      setDriveUrl("");
      setTitle("");
      setDescription("");
      queryClient.invalidateQueries({ queryKey: ["yt-uploads"] });
      window.open(res.url, "_blank", "noopener");
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["yt-uploads"] }),
  });

  const connected = status.data?.connected ?? false;
  const configured = status.data?.configured ?? false;
  const accounts = status.data?.accounts ?? [];

  return (
    <main className="min-h-screen px-4 py-12">
      <Toaster />
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-80"
        style={{ background: "var(--gradient-hero)" }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-2xl space-y-8">
        <header className="space-y-3 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs tracking-widest text-muted-foreground uppercase">
            <Youtube className="size-4 text-primary" /> Drive → YouTube
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">Unggah video Drive ke YouTube</h1>
          <p className="text-muted-foreground">
            Tempel link Google Drive yang aksesnya publik, lalu sistem mengunggahnya langsung ke
            channel YouTube Anda.
          </p>
        </header>

        <section
          className="rounded-2xl border border-border bg-card p-6"
          style={{ boxShadow: "var(--shadow-panel)" }}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium">Akun YouTube</h2>
                <p className="text-sm text-muted-foreground">
                  {!configured
                    ? "Kredensial Google OAuth belum diatur."
                    : connected
                      ? `${accounts.length} channel terhubung`
                      : "Belum terhubung"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={connected ? "secondary" : "default"}
                  disabled={!configured || connect.isPending}
                  onClick={() => connect.mutate()}
                >
                  {connected ? <Plus className="size-4" /> : <Youtube className="size-4" />}
                  {connected ? "Tambah channel lain" : "Login YouTube"}
                </Button>
                {connected && (
                  <Button variant="ghost" onClick={() => disconnect.mutate(null)}>
                    <LogOut className="size-4" /> Putuskan semua
                  </Button>
                )}
              </div>
            </div>

            {accounts.length > 0 && (
              <ul className="space-y-2">
                {accounts.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-2"
                  >
                    <span className="truncate text-sm">{a.title ?? a.id}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => disconnect.mutate(a.id)}
                    >
                      Putuskan
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section
          className="space-y-5 rounded-2xl border border-border bg-card p-6"
          style={{ boxShadow: "var(--shadow-panel)" }}
        >
          <div className="space-y-2">
            <Label htmlFor="drive">Link Google Drive (akses publik)</Label>
            <div className="relative">
              <Link2 className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="drive"
                className="pl-9"
                placeholder="https://drive.google.com/file/d/.../view?usp=sharing"
                value={driveUrl}
                onChange={(e) => setDriveUrl(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Channel tujuan</Label>
            <Select value={channelId} onValueChange={setChannelId} disabled={!connected}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    channels.isLoading ? "Memuat channel…" : "Pilih channel YouTube"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {channels.data?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {connected && (
              <p className="text-xs text-muted-foreground">
                Channel lain belum muncul? Klik "Tambah channel lain" lalu pilih akun/channel
                tersebut saat login Google.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Jenis unggahan</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={kind === "video" ? "default" : "secondary"}
                onClick={() => setKind("video")}
              >
                Video biasa
              </Button>
              <Button
                type="button"
                variant={kind === "reels" ? "default" : "secondary"}
                onClick={() => setKind("reels")}
              >
                Reels / Shorts
              </Button>
            </div>
            {kind === "reels" && (
              <p className="text-xs text-muted-foreground">
                Tag #Shorts ditambahkan otomatis. Agar tampil sebagai Shorts, video harus
                vertikal (9:16) dan maksimal 3 menit.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Judul video</Label>
            <Input
              id="title"
              placeholder="Judul yang akan tampil di YouTube"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="desc">Deskripsi (opsional)</Label>
            <Textarea
              id="desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Visibilitas</Label>
            <Select value={privacy} onValueChange={setPrivacy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="unlisted">Unlisted</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="secondary"
            className="w-full"
            disabled={saveSettings.isPending}
            onClick={() => saveSettings.mutate()}
          >
            Simpan sebagai pengaturan default
          </Button>

          <Button
            className="w-full"
            size="lg"
            disabled={!connected || upload.isPending}
            onClick={() => upload.mutate()}
          >
            <UploadCloud className="size-4" />
            {upload.isPending ? "Mengunggah…" : "Upload ke YouTube"}
          </Button>
          {!connected && (
            <p className="text-center text-xs text-muted-foreground">
              Login akun YouTube dulu untuk mengaktifkan tombol upload.
            </p>
          )}
        </section>

        {(uploads.data?.length ?? 0) > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm tracking-widest text-muted-foreground uppercase">
              Riwayat upload
            </h2>
            <ul className="space-y-2">
              {uploads.data?.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
                >
                  {item.status === "done" ? (
                    <CheckCircle2 className="mt-0.5 size-4 text-accent" />
                  ) : item.status === "error" ? (
                    <XCircle className="mt-0.5 size-4 text-destructive" />
                  ) : (
                    <UploadCloud className="mt-0.5 size-4 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.status === "done" && item.video_id ? (
                        <a
                          className="underline"
                          href={`https://youtu.be/${item.video_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          youtu.be/{item.video_id}
                        </a>
                      ) : (
                        (item.error ?? item.status)
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
