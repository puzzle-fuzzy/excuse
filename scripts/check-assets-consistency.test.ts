import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import {
  buildAssetConsistencyReport,
  collectShotReferenceAssetIds,
  extractCanvasAssetUrls,
  extractGenerationRecordUrls,
  publicUrlToStoragePath,
} from './check-assets-consistency'

describe('check-assets-consistency', () => {
  it('从 generation_record 输出中提取 savedUrls 和 urls', () => {
    expect(extractGenerationRecordUrls({
      savedUrls: ['/api/uploads/gen/a.png', 1],
      urls: ['https://provider.example/a.png'],
    })).toEqual(['/api/uploads/gen/a.png', 'https://provider.example/a.png'])
  })

  it('从 canvas asset outputJson.urls 提取 URL', () => {
    expect(extractCanvasAssetUrls({ urls: ['/api/uploads/canvas/a.mp4', null, ''] })).toEqual(['/api/uploads/canvas/a.mp4'])
  })

  it('只把本地公开 URL 映射成 storagePath', () => {
    expect(publicUrlToStoragePath('/api/uploads/users/a.png')).toBe('users/a.png')
    expect(publicUrlToStoragePath('https://example.com/api/uploads/users/a%20b.png')).toBe('users/a b.png')
    expect(publicUrlToStoragePath('https://oss.example.com/generated/a.png')).toBeNull()
  })

  it('收集镜头引用的 assetId', () => {
    const refs = collectShotReferenceAssetIds([
      { id: 'shot-1', reference_assets_json: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }] },
      { id: 'shot-2', reference_assets_json: [{ assetId: 'asset-1' }, { assetId: 123 }] },
    ])

    expect(refs.get('asset-1')).toEqual(['shot-1', 'shot-2'])
    expect(refs.get('asset-2')).toEqual(['shot-1'])
  })

  it('报告 missing、dangling、hidden-but-referenced 与 external skipped', async () => {
    const root = await mkdtemp(join(tmpdir(), 'excuse-assets-'))
    await mkdir(join(root, 'ok'), { recursive: true })
    await mkdir(join(root, 'dangling'), { recursive: true })
    await writeFile(join(root, 'ok/file.png'), 'ok')
    await writeFile(join(root, 'dangling/orphan.png'), 'orphan')

    const report = await buildAssetConsistencyReport({
      storageRoot: root,
      generationRecords: [
        {
          id: 'gen-1',
          hidden_at: null,
          output_result: { savedUrls: ['/api/uploads/ok/file.png', '/api/uploads/missing/file.png', 'https://oss.example.com/a.png'] },
        },
      ],
      canvasAssets: [
        {
          id: 'asset-1',
          hidden_at: new Date('2026-06-16T00:00:00.000Z'),
          public_url: '/api/uploads/ok/file.png',
          storage_path: null,
          output_json: { urls: [] },
        },
      ],
      uploadedFiles: [],
      canvasShots: [
        { id: 'shot-1', reference_assets_json: [{ assetId: 'asset-1' }] },
      ],
    })

    expect(report.missingFiles).toEqual([
      {
        type: 'missing_file',
        source: 'generation_record',
        id: 'gen-1',
        field: 'output_result',
        storagePath: 'missing/file.png',
      },
    ])
    expect(report.danglingFiles).toEqual([{ type: 'dangling_file', storagePath: 'dangling/orphan.png' }])
    expect(report.hiddenReferenced).toEqual([
      {
        type: 'hidden_but_referenced',
        source: 'canvas_asset',
        id: 'asset-1',
        referencedByShotId: 'shot-1',
      },
    ])
    expect(report.skipped).toEqual([
      {
        source: 'generation_record',
        id: 'gen-1',
        field: 'output_result',
        reason: 'external_url',
        url: 'https://oss.example.com/a.png',
      },
    ])
  })
})
