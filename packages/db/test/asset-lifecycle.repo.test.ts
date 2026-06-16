import type { CanvasAssetInsert, CanvasShotInsert } from '../src/types'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '../src/db'
import {
  getAssetReferences,
  hardDeleteCanvasAsset,
  isCanvasAssetRetainedGlobal,
  listCanvasAssetRetentionCandidates,
  restoreCanvasAsset,
  softDeleteCanvasAsset,
} from '../src/repositories/asset-lifecycle.repo'
import { createCanvasAsset, getCanvasAssetByIdForAccount } from '../src/repositories/canvas-assets.repo'
import { createCanvasProject } from '../src/repositories/canvas-projects.repo'
import { createCanvasShot } from '../src/repositories/canvas-shots.repo'
import { accounts } from '../src/schema/accounts'
import { canvasAssets } from '../src/schema/canvas-assets'
import { teardownTestDb, useMigratedTestDb } from './helpers/test-db'

/**
 * asset-lifecycle repository 真实 PG 集成测试。
 *
 * 使用 useMigratedTestDb（不开启 per-test raw BEGIN，因部分 repo 内含 drizzle
 * transaction 不能嵌套），靠唯一 accountId + afterEach DELETE 隔离。
 */
describe('asset-lifecycle repository', () => {
  let accountId: string
  let projectId: string

  beforeAll(async () => {
    await useMigratedTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  beforeEach(async () => {
    const [account] = await getDb().insert(accounts).values({
      username: `asset-${crypto.randomUUID().slice(0, 8)}`,
      email: `asset-${crypto.randomUUID().slice(0, 8)}@x.com`,
      password: 'x',
    }).returning()
    accountId = account!.id
    const project = await createCanvasProject({ accountId, title: 't', storyText: 'A story.' })
    projectId = project.id
  })

  afterEach(async () => {
    await getDb().delete(canvasAssets).where(eq(canvasAssets.accountId, accountId))
  })

  function assetInsert(overrides: Partial<CanvasAssetInsert> = {}): CanvasAssetInsert {
    return {
      accountId,
      projectId,
      category: 'characterPortrait',
      targetEntityType: 'character',
      targetEntityId: crypto.randomUUID(),
      status: 'succeeded',
      isActive: true,
      ...overrides,
    }
  }

  async function shotReferencingAsset(assetId: string): Promise<void> {
    const insert: CanvasShotInsert = {
      projectId,
      shotIndex: 0,
      narrative: 'A shot.',
      cameraJson: { shotSize: 'medium', angle: 'eye', movement: 'static', lens: '35mm' },
      continuityJson: {
        screenDirection: 'left',
        characterFacing: {},
        actionStart: '',
        actionEnd: '',
        emotionStart: '',
        emotionEnd: '',
      },
      referenceAssetsJson: [{ assetId, url: 'http://x', role: 'character' }],
    }
    await createCanvasShot(insert)
  }

  // ── 引用守卫 ─────────────────────────────────────────────

  describe('getAssetReferences', () => {
    it('isActive 版本视为 retained（保护 Canvas 预览）', async () => {
      const asset = await createCanvasAsset(assetInsert({ isActive: true }))
      const refs = await getAssetReferences('canvas_asset', accountId, asset.id)
      expect(refs.isActiveVersion).toBe(true)
      expect(refs.retained).toBe(true)
    })

    it('被镜头引用 → shots > 0、retained=true', async () => {
      const asset = await createCanvasAsset(assetInsert({ isActive: false }))
      await shotReferencingAsset(asset.id)
      const refs = await getAssetReferences('canvas_asset', accountId, asset.id)
      expect(refs.shots).toBe(1)
      expect(refs.retained).toBe(true)
    })

    it('无引用且非 active → retained=false', async () => {
      const asset = await createCanvasAsset(assetInsert({ isActive: false }))
      const refs = await getAssetReferences('canvas_asset', accountId, asset.id)
      expect(refs.shots).toBe(0)
      expect(refs.isActiveVersion).toBe(false)
      expect(refs.retained).toBe(false)
    })

    it('不存在的资产 → retained=false', async () => {
      const refs = await getAssetReferences('canvas_asset', accountId, crypto.randomUUID())
      expect(refs.retained).toBe(false)
    })
  })

  // ── 软删除 / 恢复 ────────────────────────────────────────

  describe('softDelete / restore', () => {
    it('软删除置 deletedAt，恢复清空', async () => {
      const asset = await createCanvasAsset(assetInsert())
      expect(await softDeleteCanvasAsset(asset.id, accountId)).toBe(true)
      expect((await getCanvasAssetByIdForAccount(asset.id, accountId))!.deletedAt).not.toBeNull()

      expect(await restoreCanvasAsset(asset.id, accountId)).toBe(true)
      expect((await getCanvasAssetByIdForAccount(asset.id, accountId))!.deletedAt).toBeNull()
    })

    it('跨用户软删除被拒绝（返回 false）', async () => {
      const asset = await createCanvasAsset(assetInsert())
      // 用一个随机 UUID 模拟其他用户（不存在 → 不命中 → 返回 false）
      expect(await softDeleteCanvasAsset(asset.id, crypto.randomUUID())).toBe(false)
    })
  })

  // ── retention GC 候选 + retained 复核 ─────────────────────

  describe('retention 候选 + 全局 retained', () => {
    it('软删除超过 grace 的资产进入候选', async () => {
      const asset = await createCanvasAsset(assetInsert({ isActive: false }))
      await softDeleteCanvasAsset(asset.id, accountId)
      await getDb().update(canvasAssets).set({ deletedAt: sql`now() - interval '40 days'` }).where(eq(canvasAssets.id, asset.id))

      const candidates = await listCanvasAssetRetentionCandidates(new Date(Date.now() - 30 * 86400000))
      expect(candidates.some(c => c.id === asset.id)).toBe(true)
    })

    it('被引用的软删除资产 → isCanvasAssetRetainedGlobal=true（GC 跳过）', async () => {
      const asset = await createCanvasAsset(assetInsert({ isActive: false }))
      await shotReferencingAsset(asset.id)
      await softDeleteCanvasAsset(asset.id, accountId)
      expect(await isCanvasAssetRetainedGlobal(asset.id)).toBe(true)
    })

    it('未引用的软删除资产可物理清除', async () => {
      const asset = await createCanvasAsset(assetInsert({ isActive: false }))
      await softDeleteCanvasAsset(asset.id, accountId)
      expect(await isCanvasAssetRetainedGlobal(asset.id)).toBe(false)

      await hardDeleteCanvasAsset(asset.id)
      const after = await getDb().select().from(canvasAssets).where(eq(canvasAssets.id, asset.id))
      expect(after).toHaveLength(0)
    })
  })
})
