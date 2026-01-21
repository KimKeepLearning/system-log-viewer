import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Loader2, Save } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { LogFileContext } from "@renderer/lib/typings";

interface SSHConnectDialogProps {
  onConnect: (files: LogFileContext[]) => void;
  onError: (error: string) => void;
}

interface SSHProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  path: string;
  privateKeyPath: string;
}

export function SSHConnectDialog({ onConnect, onError }: SSHConnectDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<SSHProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");

  const [config, setConfig] = useState({
    host: "",
    port: 22,
    username: "",
    password: "",
    privateKeyPath: "",
    path: "/var/log/chrome/chrome"
  });

  useEffect(() => {
    const saved = localStorage.getItem("ssh_profiles");
    if (saved) {
      try {
        setProfiles(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load profiles", e);
      }
    }
  }, []);

  const saveProfile = () => {
    const newProfile: SSHProfile = {
      id: Date.now().toString(),
      name: `${config.username}@${config.host}`,
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      path: config.path,
      privateKeyPath: config.privateKeyPath
    };

    // Check if exists/update
    const existingIndex = profiles.findIndex(
      (p) => p.host === config.host && p.username === config.username
    );
    let newProfiles;
    if (existingIndex >= 0) {
      newProfiles = [...profiles];
      newProfiles[existingIndex] = { ...newProfile, id: profiles[existingIndex].id };
    } else {
      newProfiles = [...profiles, newProfile];
    }

    setProfiles(newProfiles);
    localStorage.setItem("ssh_profiles", JSON.stringify(newProfiles));
  };

  const loadProfile = (id: string) => {
    const profile = profiles.find((p) => p.id === id);
    if (profile) {
      setConfig((prev) => ({
        ...prev,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        path: profile.path,
        privateKeyPath: profile.privateKeyPath,
        password: profile.password
      }));
      setSelectedProfileId(id);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      // Auto-save on connect if not exists
      saveProfile();

      const content = await window.api.readRemoteFile(
        {
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          privateKeyPath: config.privateKeyPath || undefined
        },
        config.path
      );

      const fileName = config.path.split("/").pop() || "ssh_log";
      onConnect([
        {
          id: `ssh://${config.host}${config.path}`,
          name: fileName,
          content: content
        }
      ]);
      setOpen(false);
    } catch (err: unknown) {
      console.error(err);
      setOpen(false);
      onError("SSH Error: " + ((err as Error).message || String(err)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Connect via SSH</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Connect via SSH</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {profiles.length > 0 && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Saved</Label>
              <Select value={selectedProfileId} onValueChange={loadProfile}>
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select a saved profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="host" className="text-right">
              Host
            </Label>
            <Input
              id="host"
              value={config.host}
              onChange={(e) => setConfig({ ...config, host: e.target.value })}
              className="col-span-3"
              placeholder="192.168.1.1"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="port" className="text-right">
              Port
            </Label>
            <Input
              id="port"
              type="number"
              value={config.port}
              onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) })}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="username" className="text-right">
              Username
            </Label>
            <Input
              id="username"
              value={config.username}
              onChange={(e) => setConfig({ ...config, username: e.target.value })}
              className="col-span-3"
              placeholder="root"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="password" className="text-right">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              value={config.password}
              onChange={(e) => setConfig({ ...config, password: e.target.value })}
              className="col-span-3"
              placeholder="Optional if using Key"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="private-key-path" className="text-right">
              Key Path
            </Label>
            <div className="col-span-3 flex gap-2">
              <Input
                id="private-key-path"
                value={config.privateKeyPath}
                onChange={(e) => setConfig({ ...config, privateKeyPath: e.target.value })}
                placeholder="/home/user/.ssh/id_rsa"
                defaultValue="/home/vibeosdev/.ssh/id_rsa"
              />
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="path" className="text-right">
              Remote Path
            </Label>
            <Input
              id="path"
              value={config.path}
              onChange={(e) => setConfig({ ...config, path: e.target.value })}
              className="col-span-3"
              placeholder="/var/log/messages"
              defaultValue="/var/log/chrome/chrome"
            />
          </div>
        </div>
        <div className="flex justify-between">
          <Button variant="ghost" size="icon" onClick={saveProfile} title="Save Profile">
            <Save className="h-4 w-4" />
          </Button>
          <Button onClick={handleConnect} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Connect & Read
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
