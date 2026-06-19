import type { CanvasAssetDTO } from '../../api/client'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { statusBadgeClass, statusToneClass } from '@/lib/status-tokens'
import { activateCanvasAsset, listCanvasAssetsByTarget, lockCanvasAsset } from '../../api/client'

interface AssetHistoryProps {
  targetEntityType: 'character' | 'location' | 'shot'
  targetEntityId: string
  /** 资产类别：角色肖像 / 角色转面图 / 场景参考图 / 镜头视频 */
  category?: 'characterPortrait' | 'characterTurnaround' | 'locationRef' | 'shotVideo'
  /** 重新加载项目数据的回调 */
  onUpdate: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  characterPortrait: '角色肖像',
  characterTurnaround: '角色转面图',
  locationRef: '场景参考图',
  shotVideo: '镜头视频',
  characterProfile: '角色 Profile',
  locationProfile: '场景 Profile',
}

export default function AssetHistory({
  targetEntityType,
  targetEntityId,
  category,
  onUpdate,
}: AssetHistoryProps) {
  const [assets, setAssets] = useState<CanvasAssetDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const loadAssets = useCallback(async () => {
    try {
      const data = await listCanvasAssetsByTarget(targetEntityType, targetEntityId)
      // 过滤只显示有 URL 的成功资产（图片/视频类）+ 按类别过滤
      const filtered = data
        .filter(a => a.status === 'succeeded' && a.publicUrl)
        .filter(a => !category || a.category === category)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      setAssets(filtered)
    }
    catch {
      // 静默失败，不影响主面板
    }
    finally {
      setLoading(false)
    }
  }, [targetEntityType, targetEntityId, category])

  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  // 如果没有历史资产，不显示此区域
  if (loading)
    return null
  if (assets.length <= 1)
    return null // 只有当前活跃版本，无需历史展示

  async function handleActivate(assetId: string) {
    try {
      await activateCanvasAsset(assetId)
      toast.success('已切换为当前版本')
      onUpdate()
      loadAssets() // 刷新资产列表
    }
    catch {
      toast.error('切换版本失败')
    }
  }

  async function handleLockToggle(assetId: string, currentLocked: boolean) {
    try {
      await lockCanvasAsset(assetId, !currentLocked)
      toast.success(currentLocked ? '已取消锁定' : '已锁定此版本')
      loadAssets() // 刷新资产列表（锁定状态变化）
    }
    catch {
      toast.error('锁定操作失败')
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        历史资产 (
        {assets.length}
        个版本)
      </button>

      {expanded && (
        <div className="space-y-2">
          {assets.map(asset => (
            <div
              key={asset.id}
              className={`border rounded p-2 space-y-1 ${
                asset.isActive ? statusToneClass('success') : 'border-border bg-muted/50'
              }`}
            >
              {/* 缩略图 */}
              {asset.category === 'shotVideo'
                ? (
                    <video
                      src={asset.publicUrl!}
                      className="w-full h-20 object-cover rounded"
                      muted
                    />
                  )
                : (
                    <img
                      src={asset.publicUrl!}
                      alt={CATEGORY_LABELS[asset.category] || asset.category}
                      className="w-full h-20 object-cover rounded"
                    />
                  )}

              {/* 状态标签 */}
              <div className="flex items-center gap-1 text-xs">
                {asset.isActive && (
                  <span className={statusBadgeClass('success', 'px-1.5 font-medium')}>
                    当前版本
                  </span>
                )}
                {!asset.isActive && (
                  <button
                    onClick={() => handleActivate(asset.id)}
                    className={statusToneClass('info', 'rounded border px-1.5 py-0.5 hover:opacity-90')}
                  >
                    切换为当前
                  </button>
                )}
                {asset.locked && (
                  <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                    🔒 锁定
                  </span>
                )}
                {!asset.locked && asset.isActive && (
                  <button
                    onClick={() => handleLockToggle(asset.id, false)}
                    className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
                  >
                    锁定此版本
                  </button>
                )}
                {asset.locked && asset.isActive && (
                  <button
                    onClick={() => handleLockToggle(asset.id, true)}
                    className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
                  >
                    取消锁定
                  </button>
                )}
                <span className="text-muted-foreground">
                  {CATEGORY_LABELS[asset.category] || asset.category}
                </span>
                <span className="text-muted-foreground">
                  {new Date(asset.createdAt).toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
