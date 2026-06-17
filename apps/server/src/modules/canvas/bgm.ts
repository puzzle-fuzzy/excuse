/**
 * BGM 生成服务 — Phase 10
 *
 * TODO: 使用 FunMusic (fun-music-v1) 按项目 genre/mood 生成 BGM，
 * 存 OSS 并写入 canvas_projects.bgm_url。
 * 需要 provider 层新增 fun-music-v1 模型配置 + audio generation 支持。
 */

export async function generateBgm(_projectId: string, ..._args: unknown[]) {
  throw new Error('BGM 阶段尚未实现：需添加 fun-music-v1 模型配置 + provider audio 支持')
}
