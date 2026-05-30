// 增量分句器:在流式回复不断增长时,把已经完整的句子尽早切出来送去合成。
//
// 边界规则(兼顾英文与 CJK):
// - 全角终止符 。！？… 一出现就算句末(CJK 句末通常不跟空格)。
// - 半角 . ! ? 必须后跟空白才算句末——避免把 "3.14"、"U.S." 这类切碎。
// - 终止符后允许跟引号/括号等收尾符,一并并入本句。
// - 终止符落在缓冲区末尾时先不切(可能还没写完),留给 flush 收尾。

const TERMINATOR = /[.!?。！？…]/;
const FULLWIDTH_TERMINATOR = /[。！？…]/;
const CLOSER = /[")'\]}）」』】》”’]/;

export class SentenceSegmenter {
  private consumed = 0;

  /** 喂入到目前为止的完整文本,返回自上次调用以来新切出的完整句子。 */
  push(full: string): string[] {
    const out: string[] = [];
    let i = this.consumed;
    while (i < full.length) {
      if (!TERMINATOR.test(full[i])) {
        i++;
        continue;
      }
      // 吞掉连续终止符与其后的收尾符。
      let cjk = FULLWIDTH_TERMINATOR.test(full[i]);
      let j = i + 1;
      while (j < full.length && (TERMINATOR.test(full[j]) || CLOSER.test(full[j]))) {
        if (FULLWIDTH_TERMINATOR.test(full[j])) cjk = true;
        j++;
      }
      // 句末确认:后面必须还有字符(否则可能没写完);CJK 任意字符即可,半角需空白。
      const confirmed = j < full.length && (cjk || /\s/.test(full[j]));
      if (confirmed) {
        const seg = full.slice(this.consumed, j).trim();
        if (seg) out.push(seg);
        this.consumed = j;
        i = j;
      } else {
        i = j;
      }
    }
    return out;
  }

  /** 流结束时调用:把剩余的尾巴作为最后一句(若非空)。 */
  flush(full: string): string[] {
    const tail = full.slice(this.consumed).trim();
    this.consumed = full.length;
    return tail ? [tail] : [];
  }
}
