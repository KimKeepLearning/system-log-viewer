import { useCallback, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Loader2, Radio, Save, Trash2 } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { LogFileContext } from "@renderer/lib/typings";
import {
  removeSSHProfile,
  saveSSHProfile,
  sshProfiles,
  SSHProfile,
  SSHSource
} from "@renderer/lib/ssh-profiles";
import { SSHLiveTail } from "./ssh-live-tail";

interface SSHConnectDialogProps {
  onConnect: (files: LogFileContext[]) => void;
  onError: (error: string) => void;
}

const FILE_PRESETS = [
  "/var/log/chrome/chrome",
  "/var/log/messages",
  "/var/log/ui/ui.LATEST",
  "/var/log/power_manager/powerd.LATEST",
  "/var/log/net.log"
];

// ChromeOS ships croslog rather than journalctl, and dmesg needs --raw: it
// keeps the <N> priority and the monotonic stamp the kernel parser reads, where
// -T rewrites the stamp into a form nothing here understands.
const COMMAND_PRESETS = [
  { label: "croslog (this boot)", command: "croslog --boot" },
  { label: "croslog errors", command: "croslog --priority=err" },
  { label: "dmesg", command: "dmesg --raw" },
  { label: "processes", command: "ps auxww" }
];

const FOLLOW_PRESETS = [
  { label: "croslog", command: "croslog --follow" },
  { label: "dmesg", command: "dmesg --raw -w" },
  { label: "tail messages", command: "tail -F /var/log/messages" },
  { label: "tail chrome", command: "tail -F /var/log/chrome/chrome" }
];

const EMPTY_FORM = {
  id: undefined as string | undefined,
  name: "",
  host: "",
  port: 22,
  username: "root",
  password: "",
  privateKeyPath: "~/.ssh/testing_rsa",
  source: "file" as SSHSource,
  path: "/var/log/chrome/chrome",
  command: "croslog --boot",
  // Set when the command writes a file rather than printing: the command runs
  // on the device, then this path is pulled back.
  fetchPath: "",
  followCommand: FOLLOW_PRESETS[0].command
};

type Form = typeof EMPTY_FORM;

export function SSHConnectDialog({ onConnect, onError }: SSHConnectDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<SSHProfile[]>(() => sshProfiles());
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  // Frozen when the stream starts: editing the form behind the live view must
  // not tear the connection down and reconnect.
  const [follow, setFollow] = useState<{
    target: SSHTarget;
    command: string;
    label: string;
  } | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const target = useMemo(
    () => ({
      host: form.host,
      port: form.port,
      username: form.username,
      password: form.password || undefined,
      privateKeyPath: form.privateKeyPath || undefined
    }),
    [form.host, form.port, form.username, form.password, form.privateKeyPath]
  );

  const persist = useCallback((): void => {
    if (!form.host || !form.username) return;
    setProfiles(
      saveSSHProfile({
        id: form.id,
        name: form.name,
        host: form.host,
        port: form.port,
        username: form.username,
        password: form.password || undefined,
        privateKeyPath: form.privateKeyPath || undefined,
        source: form.source,
        path: form.path,
        command: form.command
      })
    );
  }, [form]);

  const loadProfile = (profile: SSHProfile) => {
    setForm((prev) => ({
      ...prev,
      id: profile.id,
      name: profile.name,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      password: profile.password ?? "",
      privateKeyPath: profile.privateKeyPath ?? "",
      source: profile.source,
      path: profile.path || prev.path,
      command: profile.command || prev.command
    }));
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      persist();

      let content: string;
      let name: string;

      if (form.source === "file") {
        content = await window.api.ssh.readFile(target, form.path);
        name = form.path.split("/").pop() || "ssh_log";
      } else if (form.fetchPath) {
        content = await window.api.ssh.collect(target, form.command, form.fetchPath);
        name = form.fetchPath.split("/").pop() || "ssh_log";
      } else {
        const result = await window.api.ssh.exec(target, form.command);
        if (result.code !== 0 && result.code !== null && !result.stdout) {
          throw new Error(result.stderr || `Command exited with ${result.code}`);
        }
        content = result.stdout;
        name = `${form.command.split(/\s+/)[0]}.log`;
      }

      if (!content.trim()) throw new Error("The device returned nothing");

      onConnect([{ id: `ssh://${form.host}/${name}`, name, content }]);
      setOpen(false);
    } catch (err: unknown) {
      console.error(err);
      setOpen(false);
      onError("SSH Error: " + ((err as Error).message || String(err)));
    } finally {
      setLoading(false);
    }
  };

  const startFollow = () => {
    if (!form.host || !form.username) {
      onError("SSH Error: host and username are required");
      return;
    }
    persist();
    setFollow({
      target,
      command: form.followCommand,
      label: `${form.name || form.host} — ${form.followCommand}`
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">Connect via SSH</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Connect to a device</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-[200px_1fr] gap-4">
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Saved devices
                </span>
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => setForm(EMPTY_FORM)}
                >
                  New
                </button>
              </div>

              {profiles.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">Nothing saved yet.</p>
              )}

              <div className="flex flex-col gap-0.5 max-h-[320px] overflow-auto">
                {profiles.map((profile) => (
                  <div
                    key={profile.id}
                    className={cn(
                      "group flex items-center gap-1 rounded px-1.5 py-1 cursor-pointer transition-colors",
                      profile.id === form.id ? "bg-primary/10 text-primary" : "hover:bg-muted"
                    )}
                    onClick={() => loadProfile(profile)}
                    title={`${profile.username}@${profile.host}:${profile.port}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs truncate">{profile.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {profile.host}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-600 transition-opacity"
                      title="Forget this device"
                      onClick={(event) => {
                        event.stopPropagation();
                        setProfiles(removeSSHProfile(profile.id));
                        if (form.id === profile.id) setForm((prev) => ({ ...prev, id: undefined }));
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 min-w-0">
              <div className="grid grid-cols-4 items-center gap-2">
                <Label htmlFor="ssh-name" className="text-right text-xs">
                  Label
                </Label>
                <Input
                  id="ssh-name"
                  value={form.name}
                  onChange={(event) => set("name", event.target.value)}
                  className="col-span-3 h-8"
                  placeholder="dut-orthrus"
                />
              </div>

              <div className="grid grid-cols-4 items-center gap-2">
                <Label htmlFor="ssh-host" className="text-right text-xs">
                  Host
                </Label>
                <Input
                  id="ssh-host"
                  value={form.host}
                  onChange={(event) => set("host", event.target.value)}
                  className="col-span-2 h-8"
                  placeholder="192.168.1.1"
                />
                <Input
                  aria-label="Port"
                  type="number"
                  value={form.port}
                  onChange={(event) => set("port", parseInt(event.target.value) || 22)}
                  className="h-8"
                />
              </div>

              <div className="grid grid-cols-4 items-center gap-2">
                <Label htmlFor="ssh-user" className="text-right text-xs">
                  User
                </Label>
                <Input
                  id="ssh-user"
                  value={form.username}
                  onChange={(event) => set("username", event.target.value)}
                  className="col-span-3 h-8"
                  placeholder="root"
                />
              </div>

              <div className="grid grid-cols-4 items-center gap-2">
                <Label htmlFor="ssh-password" className="text-right text-xs">
                  Password
                </Label>
                <Input
                  id="ssh-password"
                  type="password"
                  value={form.password}
                  onChange={(event) => set("password", event.target.value)}
                  className="col-span-3 h-8"
                  placeholder="Optional if using a key"
                />
              </div>

              <div className="grid grid-cols-4 items-center gap-2">
                <Label htmlFor="ssh-key" className="text-right text-xs">
                  Key
                </Label>
                <Input
                  id="ssh-key"
                  value={form.privateKeyPath}
                  onChange={(event) => set("privateKeyPath", event.target.value)}
                  className="col-span-3 h-8"
                  placeholder="~/.ssh/testing_rsa"
                />
              </div>

              <div className="flex rounded-md border p-0.5 w-fit">
                {(["file", "command"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => set("source", option)}
                    className={cn(
                      "h-6 px-3 rounded text-xs font-medium capitalize transition-colors",
                      form.source === option
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {option === "file" ? "Read a file" : "Run a command"}
                  </button>
                ))}
              </div>

              {form.source === "file" ? (
                <>
                  <Input
                    value={form.path}
                    onChange={(event) => set("path", event.target.value)}
                    className="h-8"
                    placeholder="/var/log/messages"
                  />
                  <div className="flex flex-wrap gap-1">
                    {FILE_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => set("path", preset)}
                        className="text-[10px] rounded border px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                      >
                        {preset.split("/").pop()}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <Input
                    value={form.command}
                    onChange={(event) => set("command", event.target.value)}
                    className="h-8 font-mono text-xs"
                    placeholder="croslog --boot"
                  />
                  <div className="flex flex-wrap gap-1">
                    {COMMAND_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => set("command", preset.command)}
                        className="text-[10px] rounded border px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-4 items-center gap-2">
                    <Label htmlFor="ssh-fetch" className="text-right text-xs">
                      Then fetch
                    </Label>
                    <Input
                      id="ssh-fetch"
                      value={form.fetchPath}
                      onChange={(event) => set("fetchPath", event.target.value)}
                      className="col-span-3 h-8 font-mono text-xs"
                      placeholder="Leave empty to take the command's output"
                    />
                  </div>
                </>
              )}

              <div className="grid grid-cols-4 items-center gap-2">
                <Label htmlFor="ssh-follow" className="text-right text-xs">
                  Follow
                </Label>
                <Input
                  id="ssh-follow"
                  value={form.followCommand}
                  onChange={(event) => set("followCommand", event.target.value)}
                  className="col-span-3 h-8 font-mono text-xs"
                />
              </div>
              <div className="flex flex-wrap gap-1 justify-end">
                {FOLLOW_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => set("followCommand", preset.command)}
                    className="text-[10px] rounded border px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <Button variant="ghost" size="sm" onClick={persist} title="Save this device">
              <Save className="size-4" />
              Save
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={startFollow}>
                <Radio className="size-4" />
                Follow live
              </Button>
              <Button onClick={handleConnect} disabled={loading || !form.host}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Connect &amp; Read
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <SSHLiveTail
        open={follow !== null}
        target={follow?.target ?? null}
        command={follow?.command ?? ""}
        label={follow?.label ?? ""}
        onOpenChange={(next) => !next && setFollow(null)}
        onOpenInViewer={(text, label) => {
          setFollow(null);
          setOpen(false);
          onConnect([{ id: `ssh://${form.host}/live`, name: label, content: text }]);
        }}
      />
    </>
  );
}
