import { type MaintainerResult, runMaintainer } from "../agents/maintainer";
import { getProvider, loadConfig } from "../config";
import { getMaintainerData } from "../db/mastery";
import {
  formatHistorySince,
  getRecentlyIntroduced,
  getTurnCount,
} from "../db/turns";
import { readProfile } from "./profile";

// 单飞:同一时间只允许一个维护任务。新触发在跑则直接跳过(下次再合并)。
let running = false;

const EVERY_N_TURNS = 10;

// 转写字符预算(粗略对应 ~1500 token;中英混排按 ~4 字符/token 留余量)。
const TRANSCRIPT_CHAR_BUDGET = 6000;

// 上次成功维护的时间戳(运行态,非用户配置)。下次只喂这之后的 turns。
const WATERMARK_KEY = "lang-agent.lastMaintainedAt";

function getLastMaintainedAt(): number {
  const raw = localStorage.getItem(WATERMARK_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

function setLastMaintainedAt(ts: number): void {
  localStorage.setItem(WATERMARK_KEY, String(ts));
}

async function runJob(): Promise<MaintainerResult> {
  const provider = await getProvider();
  if (!provider) return { written: false, reason: "未配置 API key" };

  const config = loadConfig();
  // 先于查询取水位,避免漏掉运行期间到达的 turn(它们 > watermark,下次再喂)。
  const watermark = Date.now();
  const currentMd = await readProfile(config);
  const data = await getMaintainerData();
  const recentlyIntroduced = await getRecentlyIntroduced();
  const transcript = await formatHistorySince(
    getLastMaintainedAt(),
    TRANSCRIPT_CHAR_BUDGET,
  );

  const result = await runMaintainer(provider, {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
    currentMd,
    data,
    recentlyIntroduced,
    transcript,
  });
  // 只在真正写入后推进水位;失败保留旧水位,下次连同这批 turn 一起重试。
  if (result.written) setLastMaintainedAt(watermark);
  return result;
}

// 手动触发(档案页"刷新档案")。单飞。
export async function runMaintainerNow(): Promise<MaintainerResult> {
  if (running) return { written: false, reason: "维护任务进行中" };
  running = true;
  try {
    return await runJob();
  } finally {
    running = false;
  }
}

// 每 N 轮触发一次,后台跑,绝不阻塞热路径、绝不抛。
export async function maybeRunMaintainer(): Promise<void> {
  if (running) return;
  const turns = await getTurnCount();
  if (turns > 0 && turns % EVERY_N_TURNS === 0) {
    void runMaintainerNow().catch(() => {});
  }
}
