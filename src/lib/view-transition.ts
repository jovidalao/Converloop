import { flushSync } from "react-dom";

/**
 * 把一次会改变布局/视图的 React 状态更新包进 View Transitions,让浏览器自动做
 * 交叉淡入 + 位置/尺寸插值(切页、侧栏收展)。不支持该 API、或用户在系统里开了
 * 「减弱动态效果」时,直接同步执行,零动画降级。
 *
 * 关键:必须在 startViewTransition 的回调里用 flushSync 同步刷新 DOM——React 默认
 * 异步批处理,不 flush 的话浏览器捕捉到的「新状态」还是旧的,过渡就没效果。
 *
 * marker:可选,在过渡期间挂到 <html> 上的类名,让 CSS 按场景精确开启某些具名元素的
 * 过渡(如侧栏滑动只在收/展时,不在选对话时)。过渡结束后自动移除。
 */
export function withViewTransition(update: () => void, marker?: string): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { finished?: Promise<unknown> };
  };
  if (
    !doc.startViewTransition ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return;
  }
  if (marker) document.documentElement.classList.add(marker);
  const transition = doc.startViewTransition(() => {
    flushSync(update);
  });
  if (marker) {
    const cleanup = () => document.documentElement.classList.remove(marker);
    if (transition.finished) void transition.finished.finally(cleanup);
    else cleanup();
  }
}
