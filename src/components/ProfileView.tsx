import { useEffect, useState } from "react";
import { loadConfig } from "../config";
import { readProfile, writeProfile } from "../profile/profile";
import { runMaintainerNow } from "../profile/maintainer-runner";

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
      const r = await runMaintainerNow();
      if (r.written && r.profile) {
        setMd(r.profile);
        setStatus("✓ 档案已更新(通过 sanity check)。");
      } else {
        setStatus("未更新:" + r.reason);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form">
      <h2>学习者档案</h2>
      <p className="muted">
        对话 agent 读这份档案做个性化回复。<code>## My notes</code> 是你的手写区,AI 永不改动。
      </p>
      <textarea
        className="profile-editor"
        value={md}
        onChange={(e) => setMd(e.target.value)}
        spellCheck={false}
      />
      <div className="row" style={{ marginTop: "0.75rem" }}>
        <button onClick={save}>保存我的编辑</button>
        <button className="secondary" onClick={refresh} disabled={busy}>
          {busy ? "刷新中…" : "用 AI 刷新档案"}
        </button>
      </div>
      {status && <p className="status">{status}</p>}
    </div>
  );
}
