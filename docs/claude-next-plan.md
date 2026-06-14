# Claude 下一轮执行计划

更新时间：2026-06-14

本文是下一轮交给 Claude 执行的短期计划。长期事项仍维护在 `docs/TODO.md`，不要新增“项目整改总清单”等平行清单。

## 本轮复核结论

当前分支：

```bash
feat/unified-asset-library
```

上一轮 Claude 已完成 P1-2「参考资产复用」v0.2：镜头详情支持从资产库选择参考图片。

实际提交：

- `4fb64b3 feat(canvas): support shot reference assets`
- `e886876 feat(canvas): select shot reference assets from library`

本轮复核确认：

- `apps/client/src/components/canvas/ShotReferenceAssets.tsx` 已从 `NodeDetailPanel` 抽出独立组件。
- 镜头参考资产保留手动 URL 入口，同时新增“从资产库选择”弹窗。
- 资产选择器通过 `fetchAssetLibrary({ status: 'succeeded', search, projectId, limit: 80 })` 获取资产，再由前端纯函数过滤可用图片资产。
- `apps/client/src/lib/asset-library.ts` 已提供参考资产选择相关纯函数：
  - `isReferenceAssetCandidate`
  - `inferReferenceRole`
  - `assetToShotReferenceAsset`
  - `mergeShotReferenceAssets`
  - `isReferenceAssetAdded`
- 选择逻辑已覆盖 Canvas 角色图、场景图、普通图片和上传图片，不再只依赖 `kind=image`。
- 视频、文本、字幕、项目、无 URL 资产不会进入参考图选择器。
- 用户添加资产后仍可以调整 role、label，也可以删除。
- 选择结果继续保存到 `canvas_shots.reference_assets_json`，复用 v0.1 已打通的视频生成链路。
- `docs/TODO.md` 已把 P1-2 当前状态修正为 `4fb64b3`、`e886876`，但该文档修改目前仍未提交。

已执行验证：

```bash
bun run --cwd apps/client test -- asset-library.test.ts shot-reference-assets.test.tsx
bun run --cwd apps/client test
bun run --cwd apps/client typecheck
bun run --cwd apps/server typecheck
```

结果：

- `asset-library.test.ts` + `shot-reference-assets.test.tsx`：94 pass。
- client vitest 全量：10 files / 148 tests pass。
- client typecheck 通过。
- server typecheck 通过。

## 当前文档状态

当前工作区有两个文档修改：

- `docs/TODO.md`：已把 P1-2 v0.2 commit 从占位改为 `e886876`。
- `docs/claude-next-plan.md`：本文已重写为下一轮计划。

下一轮 Claude 开始前请注意：

- 保留 `docs/TODO.md` 中 P1-2 的 commit 修正。
- 完成本轮功能后，必须继续更新 `docs/TODO.md`，把本轮新增 commit 标到 P1-2。
- 不要创建新的平行清单或恢复已删除的旧文档。

## 下一轮目标

继续 P1-2「参考资产复用」，做 v0.3：服务端严格校验 `referenceAssetsJson` 的归属和 URL 可信度。

为什么先做这一轮：

- v0.2 已经把“从资产库选择参考资产”的前端体验打通。
- 但当前 `PATCH /api/canvas/shots/:shotId` 主要做 schema 校验，尚未严格验证 `referenceAssetsJson` 中的 `assetId/url/source` 是否属于当前用户。
- 如果不补这一层，前端虽然正常，但后端仍可能接受任意 URL、错误 source、其他用户的 assetId，后续 I2V/R2V 使用参考图时会留下权限和数据污染风险。

本轮目标：

- 服务端保存镜头参考资产前，对每一项做账号归属校验。
- 服务端校验 `url` 必须与对应资产记录中的可信 URL 匹配。
- 手动 URL 继续允许，但必须限制为合法 `http(s)` URL。
- 服务端统一归一化、去重、截断最多 8 个参考资产。
- 更新 `docs/TODO.md`，把“服务端严格校验 referenceAssetsJson 中 assetId/url 属于当前用户”标为已完成并写入 commit。

本轮不要处理：

- 自动推荐 T2V/I2V/R2V 模型。
- 把参考资产批量应用到一组镜头或整个项目。
- 资产中心删除策略。
- 收藏、标签、复杂权限后台。
- 大规模重构资产中心接口。

## 第一阶段：梳理现有可引用资产来源

重点查看：

- `apps/server/src/routes/canvas.ts`
- `apps/server/src/modules/canvas/service-crud.ts`
- `packages/db/src/repositories/canvas-assets.repo.ts`
- `packages/db/src/repositories/uploaded-files.repo.ts`
- `packages/db/src/repositories/generation-records.repo.ts`
- `apps/client/src/api/asset-library.ts`
- `apps/client/src/lib/asset-library.ts`

当前前端会产生三类 `source`：

- `asset_library`
- `uploaded_file`
- `manual`

服务端需要理解这些来源：

- `uploaded_file`：必须来自当前用户的上传文件。
- `asset_library`：可以来自当前用户的 Canvas 资产或生成记录资产。
- `manual`：没有 assetId 归属可查，只做 URL 合法性校验，并保留为高级兜底入口。

请不要只按 `source` 字符串信任前端。后端必须用 `assetId` 查询真实记录，再判断账号和 URL。

## 第二阶段：补账号归属查询能力

按需新增仓库函数，命名要清晰，避免复用无账号约束的函数。

建议新增：

```ts
// packages/db/src/repositories/canvas-assets.repo.ts
export async function getCanvasAssetByIdForAccount(id: string, accountId: string)

// packages/db/src/repositories/generation-records.repo.ts
export async function getGenerationRecordByIdForAccount(id: string, accountId: string)

// packages/db/src/repositories/uploaded-files.repo.ts
export async function getUploadedFileByIdForAccount(id: string, accountId: string)
```

要求：

- 查询条件必须包含 `accountId`。
- 不要删除现有无账号函数，避免影响其他调用。
- 如果已有等价 account-scoped 函数，优先复用，不重复造。

## 第三阶段：新增参考资产服务端校验模块

建议新增文件：

- `apps/server/src/modules/canvas/reference-assets.ts`

推荐导出：

```ts
export async function validateShotReferenceAssetsForAccount(
  accountId: string,
  assets: CanvasShotReferenceAsset[] | undefined,
): Promise<CanvasShotReferenceAsset[] | undefined>
```

校验规则：

- `undefined`：保持 `undefined`，表示本次 PATCH 不修改参考资产。
- 空数组：允许，表示清空参考资产。
- 最多 8 个：超过 8 个时建议直接拒绝，避免前后端认知不一致。
- `role`：沿用现有 role 枚举，不额外扩展。
- `label`：trim 后最多 100 字符；空字符串可以转为 `undefined`。
- 去重：按 `assetId` 优先，其次按 `url` 去重，保留第一次出现的项。
- `url`：必须是合法 `http:` 或 `https:` URL。
- `manual`：
  - 允许没有可查资产。
  - `url` 必须是合法 `http(s)`。
  - 如果传了明显不可信协议，例如 `javascript:`、`file:`、空 URL，必须拒绝。
- `uploaded_file`：
  - 必须有 `assetId`。
  - `assetId` 必须属于当前账号。
  - 文件必须是图片类型或至少能被现有上传记录判断为图片。
  - `url` 必须匹配该上传文件的可信公开 URL。
- `asset_library`：
  - 必须有 `assetId`。
  - 先按当前账号查询 `canvas_assets`。
  - 如果不是 canvas asset，再按当前账号查询 `generation_records`。
  - 只允许成功状态、且能提取图片 URL 的记录。
  - `url` 必须匹配记录中可提取的可信 URL。

URL 匹配建议：

- 优先精确匹配规范化后的 URL。
- 允许同一记录中多个可信 URL，例如 `publicUrl`、`previewUrl`、`downloadUrl`、`savedUrls`、`outputResult` 中明确的图片 URL。
- 不要只判断 host 或前缀，否则仍可能被伪造。

错误处理建议：

- 格式错误、非法 URL、超出数量：返回 400/422 类错误。
- assetId 不存在、不属于当前账号、URL 与资产不匹配：返回 403 或 422 均可，但要保持当前项目错误风格一致。
- 错误文案要能指导定位，例如：
  - `参考资产 URL 不合法`
  - `参考资产不存在或无权限访问`
  - `参考资产 URL 与资产记录不匹配`

## 第四阶段：接入 PATCH 镜头接口

修改：

- `apps/server/src/routes/canvas.ts`
- 如有必要，少量修改 `apps/server/src/modules/canvas/service-crud.ts`

接入位置：

- 在 `PATCH /api/canvas/shots/:shotId` 中，已经通过 `getCanvasShotForAccount(shotId, userId)` 确认镜头属于当前用户之后。
- 在调用 `svc.updateShotData(...)` 之前，对 `body.referenceAssetsJson` 执行 `validateShotReferenceAssetsForAccount(userId, body.referenceAssetsJson)`。
- 用校验后的结果替换传入 `updateShotData` 的 `referenceAssetsJson`。

要求：

- 未传 `referenceAssetsJson` 时，不改变现有参考资产。
- 传空数组时，可以清空参考资产。
- 不要影响镜头的 title、description、prompt、status 等其他 PATCH 字段。
- 不要把校验逻辑写散在 route 里，route 只负责调用 helper 和处理响应。

## 第五阶段：测试

优先补 server 测试，建议扩展：

- `apps/server/test/canvas-routes-extended.test.ts`

至少覆盖：

1. 当前用户上传的图片文件可以作为 `uploaded_file` 参考资产保存。
2. 其他用户上传的文件不能作为参考资产保存。
3. 上传文件存在但 `url` 与记录不匹配时拒绝。
4. 当前用户的 Canvas 图片资产可以作为 `asset_library` 参考资产保存。
5. 其他用户的 Canvas 资产不能作为参考资产保存。
6. 当前用户的成功图片生成记录可以作为 `asset_library` 参考资产保存。
7. 失败、处理中或非图片生成记录不能作为参考资产保存。
8. `manual` 的 `https://...` URL 可以保存。
9. `manual` 的 `javascript:`、`file:`、空 URL 会被拒绝。
10. 重复 assetId/url 会被服务端去重，最多保留 8 个。
11. 未传 `referenceAssetsJson` 时，PATCH 其他字段不会清空已有参考资产。
12. 传 `referenceAssetsJson: []` 时，可以清空已有参考资产。

如 route 测试 mock 成本过高，可以同时新增 helper 单测，但最终至少要有一组 route 层测试证明接口真实接入。

## 第六阶段：更新 TODO

修改：

- `docs/TODO.md`

把 P1-2 当前状态更新为：

```md
当前状态：部分完成（镜头额外参考资产 v0.1 + 资产库选择 v0.2 + 服务端归属校验 v0.3，commit：`4fb64b3`、`e886876`、`本轮新增 commit`）。
```

并从 P1-2 待办中移除或标注已完成：

- 服务端严格校验 `referenceAssetsJson` 中 `assetId/url` 属于当前用户。

P1-2 仍不要标为全部完成，因为还剩：

- 根据参考资产数量自动推荐 T2V/I2V/R2V 模型，并在 UI 上解释选择原因。
- 支持将资产应用到一个镜头、一组镜头或整个项目。

## 验证命令

本轮完成后请至少执行：

```bash
bun test apps/server/test/canvas-routes-extended.test.ts
bun run --cwd apps/server typecheck
bun run --cwd apps/client typecheck
bun run lint
```

如果修改了前端参考资产类型或纯函数，再补：

```bash
bun run --cwd apps/client test -- asset-library.test.ts shot-reference-assets.test.tsx
```

如果 route 测试覆盖到共享 mock 状态，必要时使用 isolate：

```bash
bun test --isolate apps/server/test/canvas-routes-extended.test.ts
```

## 提交要求

完成后提交一个独立 commit：

```bash
git add packages/db/src/repositories apps/server/src/modules/canvas apps/server/src/routes/canvas.ts apps/server/test docs/TODO.md
git commit -m "feat(canvas): validate shot reference assets"
```

如果实际修改文件更多，请按真实变更调整 `git add`，但不要把无关文件带入提交。

提交后在 `docs/TODO.md` 中把 `本轮新增 commit` 替换为真实短 hash。

## 下一轮之后的建议方向

本轮 v0.3 做完后，P1-2 剩余工作建议按这个顺序继续：

1. v0.4：根据参考资产类型和数量自动推荐 T2V/I2V/R2V 模型，并在 UI 上解释选择原因。
2. v0.5：支持把参考资产应用到一个镜头、一组镜头或整个项目。
3. 完成 P1-2 后，再回到 P1 其他资产中心增强项，而不是继续陷入底层 packages 拆包。
