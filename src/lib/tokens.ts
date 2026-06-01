// 粗略 token 估算(纯逻辑,可单测;不碰 DB/Tauri/tokenizer)。
// 用途:判断「下一轮要发的整段 prompt」是否逼近上下文上限,触发自动压缩(见 summary-runner)。
// 刻意不内置真 tokenizer:BYOK 下模型未知,tokenizer 对非目标模型也不准,且徒增体积。
// 估算有误差没关系——70% 高水位本身留了 30% 余量;偏差靠这层 headroom 吸收。
//
// 启发式:CJK 字符按 ~1 token/字(分词器对汉字通常 1~2 token,取 1 是略偏激进 = 提前压缩,安全);
// 其余(拉丁字母/空格/标点)按 ~4 字符/token(与维护 agent 的 TRANSCRIPT_CHAR_BUDGET 假设一致)。
// 宁可高估:低估会真的撑爆上下文报错,高估只是早一点压缩。

// CJK 统一表意文字 + 扩展A + 兼容 + 假名 + 谚文,覆盖中日韩常见字。
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(CJK_RE)?.length ?? 0;
  const rest = text.length - cjk;
  return Math.ceil(cjk + rest / 4);
}

// 汇总一组消息文本的 token 估算。每条消息加少量固定开销(role/分隔符),粗略对齐真实协议。
const PER_MESSAGE_OVERHEAD = 4;

export function estimatePromptTokens(parts: string[]): number {
  return parts.reduce(
    (sum, p) => sum + estimateTokens(p) + PER_MESSAGE_OVERHEAD,
    0,
  );
}
