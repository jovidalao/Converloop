import { getProvider, loadConfig } from "../config";
import { getMaintainerData } from "../db/mastery";
import {
  formatRecentHistory,
  getRecentlyIntroduced,
  getTurnCount,
} from "../db/turns";
import { readProfile } from "./profile";
import { runMaintainer, type MaintainerResult } from "../agents/maintainer";

// 单飞:同一时间只允许一个维护任务。新触发在跑则直接跳过(下次再合并)。
let running = false;

const EVERY_N_TURNS = 10;

async function runJob(): Promise<MaintainerResult> {
  const provider = await getProvider();
  if (!provider) return { written: false, reason: "未配置 API key" };

  const config = loadConfig();
  const currentMd = await readProfile(config);
  const data = await getMaintainerData();
  const recentlyIntroduced = await getRecentlyIntroduced();
  const transcript = await formatRecentHistory(20);

  return runMaintainer(provider, {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
    currentMd,
    data,
    recentlyIntroduced,
    transcript,
  });
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
