import { useEffect, useState } from "react";
import { loadConfig } from "../config";
import { readProfile, writeProfile } from "../profile/profile";
import { runMaintainerNow } from "../profile/maintainer-runner";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export function ProfileView() {
  const [md, setMd] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    readProfile(loadConfig()).then(setMd);
  }, []);

  async function save() {
    await writeProfile(md);
    setStatus("已保存。");
  }

  async function refresh() {
    setBusy(true);
    setStatus("AI 正在根据掌握数据 + 近期对话刷新档案…");
    try {
      await writeProfile(md);
      const r = await runMaintainerNow();
      if (r.written && r.profile) {
        setMd(r.profile);
        setStatus("✓ 档案已更新(通过 sanity check)。");
      } else {
        const fresh = await readProfile(loadConfig());
        setMd(fresh);
        setStatus(`未更新：${r.reason}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`刷新失败：${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full max-w-[660px] flex-col overflow-y-auto px-6 pt-[3.4rem] pb-6">
      <h2 className="mt-0 mb-2 text-lg font-semibold tracking-tight">
        学习者档案
      </h2>
      <p className="text-[0.82rem] leading-snug text-muted-foreground">
        对话 agent 读这份档案做个性化回复。
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
          ## My notes
        </code>{" "}
        是你的手写区,AI 永不改动。
      </p>
      <Textarea
        className="mt-3 min-h-[120px] flex-1 resize-none font-mono text-[0.85rem] leading-normal"
        value={md}
        onChange={(e) => setMd(e.target.value)}
        spellCheck={false}
      />
      <div className="mt-3 flex items-end gap-2">
        <Button onClick={save}>保存我的编辑</Button>
        <Button variant="secondary" onClick={refresh} disabled={busy}>
          {busy ? "刷新中…" : "用 AI 刷新档案"}
        </Button>
      </div>
      {status && (
        <p
          className={`mt-2 break-words text-[0.82rem] ${
            status.startsWith("✓") ? "text-primary" : "text-warning"
          }`}
        >
          {status}
        </p>
      )}
    </div>
  );
}
