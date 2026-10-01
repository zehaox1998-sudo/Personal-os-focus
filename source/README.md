# Personal OS · Focus Timer

可运行的个人专注计时器。Calendar 与 AI 不在本版本范围。

## 当前交付状态

代码、本地预览、Notion 数据结构已完成。自动保存代码尚未连接真实 Notion 集成；未部署线上站点，也未做真实身份登录与写入的端到端验收。浏览器会明确显示本地状态。21 项自动测试通过。

## 每次使用

选择项目（或明确选择“不关联项目”）→ 可选具体行动 → 选时长 → 开始。离开时暂停，回来继续；结束时保存实际秒数。倒计时到零会停止累计并提示，由你点击结束保存。不会自动完成 Action。

刷新或长时间中断后，先确认离开时间是否计入；确认后保持暂停。提示音受浏览器后台、系统休眠影响。

未连接和保存失败的记录留在当前浏览器。点击“导出备份”可下载 JSON；不要清理浏览器数据。备份恢复目前需人工处理，界面没有导入按钮。浏览器正常保存不等于 Notion 已保存。

统计只读取 Notion 已保存数据，按 Europe/Paris 的开始日归属；跨午夜不拆分，周从周一开始。本地待保存队列单列，不加进统计。

## 本地运行与验收

Node.js 24，pnpm 11。安装后运行 `pnpm build`、`pnpm test`、`pnpm dev --offline`。开发地址默认 http://localhost:8787 。无密钥时服务拒绝数据库请求，计时器仍能本地使用。

函数编译检查：`pnpm exec tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --allowJs --skipLibCheck netlify/functions/focus.mts`。

## 线上配置（尚待执行）

1. 在获准新增的 Netlify 站点部署本目录。构建命令 `pnpm build`，发布目录 `dist`，函数目录 `netlify/functions`。使用 Node 24。保留既有 GitHub Pages 论文周期组件。
2. 开启 Netlify Identity，并设置仅邀请注册。由本人设置密码；不要通过聊天传送密码。站点只允许 `FOCUS_OWNER_ID` 指定的已认证账户访问数据，其他账户全部拒绝。
3. 在 Notion 中建立专用内部集成，仅授权 Focus Sessions、Planning & Records、Projects、Actions。需要读取及插入内容权限。不要在网页、公开仓库或嵌入 URL 中放入集成密钥。
4. 在 Netlify 的生产环境变量中填写 `.env.example` 的六项配置。NOTION_TOKEN 标为 secret，数据库使用 data source ID；FOCUS_OWNER_ID 使用 Identity 的用户 ID。
5. 修改环境变量后重新部署。正式写入仅允许 production，预览部署拒绝写入正式数据库。
6. 登录后先用真实的一段专注验证：项目列表、保存、Daily 关联、Focus Minutes 汇总、重复重试无重复、统计一致。通过后才能宣称自动保存已启用。
7. 将正式 HTTPS 地址嵌入 Notion。首次登录建议独立窗口；若 Notion 内嵌浏览器限制第三方存储或 Cookie，使用独立窗口。不同浏览器/分区的待保存队列不会自动互通。内嵌登录尚待真实部署后验证。

## 数据约定

Focus Sessions 字段：Session（标题）、Session ID（文本）、Date（开始日）、Start Time / End Time（时间戳）、Duration（实际秒数）、Minutes（换算公式）、Project / Daily / Task（关联）、No Project（复选）。

Projects 与 Planning & Records：Focus Sessions（反向关联）、Focus Seconds（Duration 总和）、Focus Minutes（分钟公式）。日记录以 Type=Day、Date=开始日查找；存在多条则报冲突，不擅自选择。无记录时仅创建最小 Day 条目，不覆盖正文和模板。

## 重试与异常恢复

固定 Session ID + 持久回执 + 原子条件创建，避免同编号重复写入。每次创建前验证锁的持有者。Notion 写入超时后先查询原编号；若找到且内容一致，返回原记录。

若创建请求结果不明确且 Notion 中仍查不到，系统保守地保持待确认，不自动释放锁重新创建。检查 Netlify Blobs `focus-receipts-v1` 对应的 `session/<UUID>` 或 `day/<date>`，同时核对 Notion。只有确定请求没有产生条目且没有仍在运行的请求时，管理员才可重置相应回执再重试；若条目已存在则恢复回执，不复制条目。不要批量清空回执。

Notion 本身没有唯一约束，人工复制记录、绕过计时服务写入，以及并行手动创建日记录仍可能产生冲突。数据库中同一 Session ID 多条时需要人工确认。统计对相同 ID 去重；正式上线验收必须检查没有同编号且不同内容的条目。

本地同一浏览器同一来源只能有一个可操作计时窗口；第二窗口会提示回到原窗口。多设备同时计时不在本版本限制范围内。

## 参考

- [Notion：创建页面](https://developers.notion.com/reference/post-page)
- [Notion：查询数据源](https://developers.notion.com/reference/query-a-data-source)
- [Netlify Blobs：条件写入与一致性](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- Netlify Identity API 以已安装的 `@netlify/identity` README 为准。
