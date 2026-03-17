## Lime v0.89.0

### ✨ 主要更新

- **品牌正式更名为 Lime**：主程序名称、仓库链接、安装包命名、Tauri `productName` / `identifier`、深链 scheme、浏览器桥扩展目录与发布文案已统一从 `Proxycast` 切换到 `Lime`
- **版本事实源继续收口**：统一 `package.json`、Cargo workspace / package、两份 Tauri 配置与 `RELEASE_NOTES.md` 的版本入口，发布流程继续只读取这一套版本源
- **运行时命名继续收口**：Tool Calling、Web Search、Durable Memory、workspace sandbox、真实测试与浏览器桥接等运行时环境变量统一以 `LIME_*` / `__LIME_*` 为现役事实源，旧 `PROXYCAST_*` 仅保留兼容读取
- **生态入口同步完成**：README、插件升级入口、About 页、扩展说明与下载地址等对外入口统一使用 `Lime`

### ⚠️ 兼容性说明

- 旧 `proxycast` 数据目录、数据库文件与历史路径仍保留启动迁移兼容，现有数据会继续被识别并迁移到 `lime` 目录
- 后续对外暴露的现役命名统一使用 `Lime`；旧 `Proxycast` 命名仅作为兼容层保留，不再继续扩展

### 🧪 测试

- 发布前执行：`cargo test`、`cargo fmt --all`、`cargo clippy`、`npm run lint`

### 📝 文档

- 更新发布说明、仓库链接、安装与分发文案，统一使用 `Lime`

### 📦 Windows 下载说明

- `Lime_*_x64-offline-setup.exe`：推荐优先使用，内置 WebView2 离线安装器，安装更完整
- `Lime_*_x64-online-setup.exe`：体积更小，适合网络稳定且可访问微软下载源的环境
- 如果在线安装失败，请改用离线安装包

---

**完整变更**: v0.88.0...v0.89.0
