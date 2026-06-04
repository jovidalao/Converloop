/**
 * 切换主视图/路由。原生桌面 app 在视图间是「直切」,不做路由级交叉淡入(那是网页习惯,
 * 也是 designer 一眼看出「这是网页」的破绽之一),所以这里直接同步执行状态更新、不再包
 * View Transitions。保留这层薄封装是为了让调用点语义清晰、且日后若要做某个具名元素的
 * 形变过渡有统一入口。第二个参数为历史兼容保留,当前忽略。
 */
export function withViewTransition(update: () => void, _marker?: string): void {
  update();
}
