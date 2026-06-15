import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { Client } from 'pg'

export type AssetSource = 'generation_record' | 'canvas_asset' | 'uploaded_file'

export interface AssetReference {
  source: AssetSource
  id: string
  field: string
  url?: string
  storagePath?: string | null
  hidden?: boolean
}

export interface MissingFileIssue {
  type: 'missing_file'
  source: AssetSource
  id: string
  field: string
  storagePath: string
}

export interface DanglingFileIssue {
  type: 'dangling_file'
  storagePath: string
}

export interface HiddenReferencedIssue {
  type: 'hidden_but_referenced'
  source: 'generation_record' | 'canvas_asset'
  id: string
  referencedByShotId: string
}

export interface SkippedReference {
  source: AssetSource
  id: string
  field: string
  reason: 'external_url' | 'no_storage_path'
  url?: string
}

export interface AssetConsistencyReport {
  checkedAt: string
  storageRoot: string
  totals: {
    references: number
    localReferences: number
    scannedFiles: number
    missingFiles: number
    danglingFiles: number
    hiddenReferenced: number
    skipped: number
  }
  missingFiles: MissingFileIssue[]
  danglingFiles: DanglingFileIssue[]
  hiddenReferenced: HiddenReferencedIssue[]
  skipped: SkippedReference[]
}

interface CliOptions {
  json: boolean
  failOnIssues: boolean
  storageRoot: string
  publicBasePath: string
}

interface GenerationRecordRow {
  id: string
  hidden_at: Date | null
  output_result: unknown
}

interface CanvasAssetRow {
  id: string
  hidden_at: Date | null
  public_url: string | null
  storage_path: string | null
  output_json: unknown
}

interface UploadedFileRow {
  id: string
  public_url: string
  storage_path: string
}

interface CanvasShotReferenceRow {
  id: string
  reference_assets_json: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

export function extractGenerationRecordUrls(outputResult: unknown): string[] {
  if (!isRecord(outputResult))
    return []
  return [
    ...stringArray(outputResult.savedUrls),
    ...stringArray(outputResult.urls),
  ]
}

export function extractCanvasAssetUrls(outputJson: unknown): string[] {
  if (!isRecord(outputJson))
    return []
  return stringArray(outputJson.urls)
}

export function publicUrlToStoragePath(url: string, publicBasePath = '/api/uploads'): string | null {
  const normalizedBase = publicBasePath.endsWith('/') ? publicBasePath.slice(0, -1) : publicBasePath
  try {
    const parsed = new URL(url, 'http://local.invalid')
    if (!parsed.pathname.startsWith(`${normalizedBase}/`))
      return null
    return decodeURIComponent(parsed.pathname.slice(normalizedBase.length + 1))
  }
  catch {
    return null
  }
}

export function normalizeStoragePath(storagePath: string): string {
  return storagePath.replaceAll('\\', '/').replace(/^\/+/, '')
}

export function collectShotReferenceAssetIds(rows: CanvasShotReferenceRow[]): Map<string, string[]> {
  const refs = new Map<string, string[]>()
  for (const row of rows) {
    if (!Array.isArray(row.reference_assets_json))
      continue
    for (const item of row.reference_assets_json) {
      if (!isRecord(item) || typeof item.assetId !== 'string')
        continue
      const list = refs.get(item.assetId) ?? []
      list.push(row.id)
      refs.set(item.assetId, list)
    }
  }
  return refs
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = []

  async function walk(dir: string) {
    let entries: string[]
    try {
      entries = await readdir(dir)
    }
    catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const info = await stat(fullPath)
      if (info.isDirectory()) {
        await walk(fullPath)
        continue
      }
      if (info.isFile())
        files.push(relative(root, fullPath).split(sep).join('/'))
    }
  }

  await walk(root)
  return files
}

function addReference(
  references: AssetReference[],
  skipped: SkippedReference[],
  ref: AssetReference,
  publicBasePath: string,
) {
  if (ref.storagePath) {
    references.push({ ...ref, storagePath: normalizeStoragePath(ref.storagePath) })
    return
  }

  if (ref.url) {
    const storagePath = publicUrlToStoragePath(ref.url, publicBasePath)
    if (storagePath) {
      references.push({ ...ref, storagePath: normalizeStoragePath(storagePath) })
      return
    }
    skipped.push({ source: ref.source, id: ref.id, field: ref.field, reason: 'external_url', url: ref.url })
    return
  }

  skipped.push({ source: ref.source, id: ref.id, field: ref.field, reason: 'no_storage_path' })
}

export async function buildAssetConsistencyReport(opts: {
  storageRoot: string
  publicBasePath?: string
  generationRecords: GenerationRecordRow[]
  canvasAssets: CanvasAssetRow[]
  uploadedFiles: UploadedFileRow[]
  canvasShots: CanvasShotReferenceRow[]
}): Promise<AssetConsistencyReport> {
  const storageRoot = resolve(opts.storageRoot)
  const publicBasePath = opts.publicBasePath ?? '/api/uploads'
  const references: AssetReference[] = []
  const skipped: SkippedReference[] = []

  for (const row of opts.generationRecords) {
    for (const url of extractGenerationRecordUrls(row.output_result)) {
      addReference(references, skipped, {
        source: 'generation_record',
        id: row.id,
        field: 'output_result',
        url,
        hidden: row.hidden_at !== null,
      }, publicBasePath)
    }
  }

  for (const row of opts.canvasAssets) {
    addReference(references, skipped, {
      source: 'canvas_asset',
      id: row.id,
      field: 'storage_path',
      storagePath: row.storage_path,
      url: row.public_url ?? undefined,
      hidden: row.hidden_at !== null,
    }, publicBasePath)
    for (const url of extractCanvasAssetUrls(row.output_json)) {
      addReference(references, skipped, {
        source: 'canvas_asset',
        id: row.id,
        field: 'output_json',
        url,
        hidden: row.hidden_at !== null,
      }, publicBasePath)
    }
  }

  for (const row of opts.uploadedFiles) {
    addReference(references, skipped, {
      source: 'uploaded_file',
      id: row.id,
      field: 'storage_path',
      storagePath: row.storage_path,
      url: row.public_url,
    }, publicBasePath)
  }

  const referencedPaths = new Set(references.map(ref => ref.storagePath).filter((path): path is string => Boolean(path)))
  const scannedFiles = await listFiles(storageRoot)
  const scannedSet = new Set(scannedFiles)
  const shotRefs = collectShotReferenceAssetIds(opts.canvasShots)

  const missingFiles: MissingFileIssue[] = []
  for (const ref of references) {
    if (!ref.storagePath)
      continue
    const fullPath = join(storageRoot, ref.storagePath)
    if (!existsSync(fullPath)) {
      missingFiles.push({
        type: 'missing_file',
        source: ref.source,
        id: ref.id,
        field: ref.field,
        storagePath: ref.storagePath,
      })
    }
  }

  const danglingFiles = scannedFiles
    .filter(path => !referencedPaths.has(path))
    .map((storagePath): DanglingFileIssue => ({ type: 'dangling_file', storagePath }))

  const hiddenReferenced: HiddenReferencedIssue[] = []
  for (const ref of references) {
    if (!ref.hidden || (ref.source !== 'generation_record' && ref.source !== 'canvas_asset'))
      continue
    for (const shotId of shotRefs.get(ref.id) ?? []) {
      hiddenReferenced.push({
        type: 'hidden_but_referenced',
        source: ref.source,
        id: ref.id,
        referencedByShotId: shotId,
      })
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    storageRoot,
    totals: {
      references: references.length,
      localReferences: references.filter(ref => ref.storagePath && scannedSet.has(ref.storagePath)).length,
      scannedFiles: scannedFiles.length,
      missingFiles: missingFiles.length,
      danglingFiles: danglingFiles.length,
      hiddenReferenced: hiddenReferenced.length,
      skipped: skipped.length,
    },
    missingFiles,
    danglingFiles,
    hiddenReferenced,
    skipped,
  }
}

function parseArgs(argv: string[]): CliOptions {
  const storageRootArg = argv.find(arg => arg.startsWith('--storage-root='))?.slice('--storage-root='.length)
  const publicBaseArg = argv.find(arg => arg.startsWith('--public-base-path='))?.slice('--public-base-path='.length)
  return {
    json: argv.includes('--json'),
    failOnIssues: argv.includes('--fail-on-issues'),
    storageRoot: storageRootArg || process.env.STORAGE_ROOT || './uploads',
    publicBasePath: publicBaseArg || process.env.PUBLIC_UPLOAD_BASE_PATH || '/api/uploads',
  }
}

async function queryRows(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const [generationRecords, canvasAssets, uploadedFiles, canvasShots] = await Promise.all([
      client.query<GenerationRecordRow>('select id, hidden_at, output_result from generation_records where output_result is not null'),
      client.query<CanvasAssetRow>('select id, hidden_at, public_url, storage_path, output_json from canvas_assets where public_url is not null or storage_path is not null or output_json is not null'),
      client.query<UploadedFileRow>('select id, public_url, storage_path from uploaded_files'),
      client.query<CanvasShotReferenceRow>('select id, reference_assets_json from canvas_shots where jsonb_array_length(reference_assets_json) > 0'),
    ])
    return {
      generationRecords: generationRecords.rows,
      canvasAssets: canvasAssets.rows,
      uploadedFiles: uploadedFiles.rows,
      canvasShots: canvasShots.rows,
    }
  }
  finally {
    await client.end()
  }
}

function printHumanReport(report: AssetConsistencyReport) {
  console.log(`Asset consistency check: ${report.checkedAt}`)
  console.log(`Storage root: ${report.storageRoot}`)
  console.log(`References: ${report.totals.references}, local ok: ${report.totals.localReferences}, scanned files: ${report.totals.scannedFiles}`)
  console.log(`Issues: missing=${report.totals.missingFiles}, dangling=${report.totals.danglingFiles}, hiddenReferenced=${report.totals.hiddenReferenced}, skipped=${report.totals.skipped}`)

  for (const issue of report.missingFiles)
    console.log(`[missing_file] ${issue.source}:${issue.id} ${issue.field} -> ${issue.storagePath}`)
  for (const issue of report.danglingFiles)
    console.log(`[dangling_file] ${issue.storagePath}`)
  for (const issue of report.hiddenReferenced)
    console.log(`[hidden_but_referenced] ${issue.source}:${issue.id} referenced by shot ${issue.referencedByShotId}`)
}

if (import.meta.main) {
  const options = parseArgs(Bun.argv.slice(2))
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  const rows = await queryRows(databaseUrl)
  const report = await buildAssetConsistencyReport({
    ...rows,
    storageRoot: options.storageRoot,
    publicBasePath: options.publicBasePath,
  })

  if (options.json)
    console.log(JSON.stringify(report, null, 2))
  else
    printHumanReport(report)

  const issueCount = report.totals.missingFiles + report.totals.danglingFiles + report.totals.hiddenReferenced
  if (options.failOnIssues && issueCount > 0)
    process.exit(1)
}
