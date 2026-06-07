# 跨平台(macOS + Windows)

桌面端从今往后**双平台并行开发**:macOS 与 Windows 都是一等目标。Windows 刻意不追求 macOS 那样的原生质感(无毛玻璃 / 无透明窗),换取最小适配面与稳定性。移动端(Tauri Mobile)与 Web(托管模型)在后续阶段再做,见 [architecture.md](./architecture.md) 与 [README.md](./README.md)。

## 三条约定(写新功能时遵守)

1. **原生能力 `cfg` 守卫。** 任何平台相关的 Rust 代码必须 `#[cfg(target_os = "...")]`,且为非目标平台留 no-op 兜底。范例:`src-tauri/src/lib.rs` 的红绿灯 / 毛玻璃只在 `cfg(target_os = "macos")`,`reapply_traffic_lights` 在其他平台是空操作;`window-vibrancy` 用 `[target.'cfg(target_os = "macos")'.dependencies]` 隔离,不在 Windows 编译。
2. **界面差异走 `data-platform`。** 前端不在组件里散落平台 `if`;统一在 `src/main.tsx` 把 `document.documentElement.dataset.platform`(`windows` / `macos` / `other`)写到 `<html>`,差异用 CSS `:root[data-platform="windows"] …` 覆盖。判断逻辑只在 `src/lib/platform.ts`(`isWindows` / `isMacOS`,基于 webview UA,同步、无插件)。
3. **平台 port 保持薄而集中。** 与原生交互只走少数窄口:DB(`src/db/client.ts`)、密钥(`src/keychain.ts`)、档案(`src/profile/profile.ts`)、LLM(`src/providers/*` → `invoke llm_*`)、TTS(`src/tts/edge.ts`)、OAuth(`src/oauth/*`)。新增原生能力时沿用这个边界,别让 `@tauri-apps/*` 渗进业务逻辑——这也是以后接 Web / 移动端的前提。

## Windows 适配现状(阶段 1)

- **窗口配置**:`src-tauri/tauri.windows.conf.json` 覆盖基础配置的 window —— `decorations: true`(用系统原生标题栏,窗口控制在右上)、`transparent: false`(避开 WebView2 透明窗问题),不带 macOS 专属的 `titleBarStyle: "Overlay"` / `hiddenTitle`。基础配置里残留的 `macOSPrivateApi` 在 Windows 被忽略,无害。
- **Rust 后端零改动**:`llm.rs` / `edge_tts.rs` / `oauth.rs` / `secrets.rs` / `profile.rs` 全是跨平台 crate;macOS 私有 API 已 `cfg` 守好。
- **前端 chrome**:Windows 下强制关玻璃(`theme-provider.tsx`)、设置页隐藏玻璃开关(`SettingsView.tsx`),并把顶栏左侧为红绿灯预留的空档收回(`index.css` 的 `:root[data-platform="windows"] .codex-topbar-left`)。
- **未保留**:macOS 的统一无边框外观 / 红绿灯内嵌 / 毛玻璃。如果以后要在 Windows 上做无边框 + 自绘 min/max/close,改 `tauri.windows.conf.json` 的 `decorations: false` 再补自绘控件即可,不影响现有结构。

## CI(阶段 2)

`.github/workflows/ci.yml`:

- **check(ubuntu)**:`pnpm check`(biome + tsc)+ `pnpm test`(vitest)。纯 JS,无原生依赖。
- **build 矩阵(macos-latest + windows-latest)**:`pnpm build` 产出 `dist/`(`generate_context!` 编译期要嵌入),再 `cargo build --locked` 编译 Rust 后端。这样任一平台被改坏会当场暴露,而不是发版前才发现。

> pnpm 用 v11(对齐本地 `corepack pnpm`);`cargo build --locked` 防止意外改动 `Cargo.lock`(注意 `bitflags` 已钉 2.9.1,别 `cargo update` 升回,见 architecture.md 踩坑记录)。

## 本地验证

```
pnpm check        # biome + tsc
pnpm test         # vitest
pnpm build        # 前端产物;cargo build 前置
# Windows 窗口 / 安装包需在 Windows 环境(或 CI windows-latest)实测
```
