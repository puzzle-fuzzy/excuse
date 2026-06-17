import type { CharacterProfile, LocationProfile } from '@excuse/shared/domain-types'
/**
 * 主体资产库 Repository — 跨项目复用角色/场景
 *
 * 见 docs/TODO.md §二、1
 */
import { and, asc, count, eq, ilike, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { projectSubjectRefs, subjectLibrary } from '../schema'

// ── 类型 ───────────────────────────────────────────────

export type SubjectLibraryRow = typeof subjectLibrary.$inferSelect

export interface CreateSubjectInput {
  accountId: string
  subjectType: 'character' | 'location'
  name: string
  identityPrompt?: string | null
  negativePrompt?: string | null
  scenePrompt?: string | null
  profileJson?: CharacterProfile | LocationProfile | null
  referenceImageUrl?: string | null
  turnaroundSheetUrl?: string | null
  sourceProjectId?: string | null
  sourceEntityId?: string | null
  tags?: string[] | null
}

export interface UpdateSubjectInput {
  name?: string
  identityPrompt?: string | null
  negativePrompt?: string | null
  scenePrompt?: string | null
  profileJson?: CharacterProfile | LocationProfile | null
  referenceImageUrl?: string | null
  turnaroundSheetUrl?: string | null
  tags?: string[] | null
  isFavorite?: boolean
}

export interface SubjectListQuery {
  accountId: string
  subjectType?: 'character' | 'location'
  search?: string
  tagIds?: string[]
  isFavorite?: boolean
  limit?: number
  offset?: number
}

export interface SubjectListResult {
  items: SubjectLibraryRow[]
  total: number
}

// ── CRUD ───────────────────────────────────────────────

export async function createSubject(input: CreateSubjectInput): Promise<SubjectLibraryRow> {
  const [row] = await getDb()
    .insert(subjectLibrary)
    .values({
      accountId: input.accountId,
      subjectType: input.subjectType,
      name: input.name,
      identityPrompt: input.identityPrompt ?? null,
      negativePrompt: input.negativePrompt ?? null,
      scenePrompt: input.scenePrompt ?? null,
      profileJson: input.profileJson ?? null,
      referenceImageUrl: input.referenceImageUrl ?? null,
      turnaroundSheetUrl: input.turnaroundSheetUrl ?? null,
      sourceProjectId: input.sourceProjectId ?? null,
      sourceEntityId: input.sourceEntityId ?? null,
      tags: input.tags ?? null,
    })
    .returning()
  return row!
}

export async function getSubjectById(id: string): Promise<SubjectLibraryRow | null> {
  const row = await getDb()
    .select()
    .from(subjectLibrary)
    .where(eq(subjectLibrary.id, id))
    .limit(1)
  return row[0] ?? null
}

export async function updateSubject(id: string, input: UpdateSubjectInput): Promise<SubjectLibraryRow | null> {
  const [row] = await getDb()
    .update(subjectLibrary)
    .set({
      ...input,
      updatedAt: new Date(),
    })
    .where(eq(subjectLibrary.id, id))
    .returning()
  return row ?? null
}

export async function deleteSubject(id: string): Promise<boolean> {
  const [row] = await getDb()
    .delete(subjectLibrary)
    .where(eq(subjectLibrary.id, id))
    .returning({ id: subjectLibrary.id })
  return !!row
}

export async function listSubjects(query: SubjectListQuery): Promise<SubjectListResult> {
  const { accountId, subjectType, search, isFavorite, limit = 20, offset = 0 } = query

  const conditions = [eq(subjectLibrary.accountId, accountId)]

  if (subjectType) {
    conditions.push(eq(subjectLibrary.subjectType, subjectType))
  }

  if (search) {
    conditions.push(ilike(subjectLibrary.name, `%${search}%`))
  }

  if (isFavorite !== undefined) {
    conditions.push(eq(subjectLibrary.isFavorite, isFavorite))
  }

  const where = and(...conditions)

  const [items, countResult] = await Promise.all([
    getDb()
      .select()
      .from(subjectLibrary)
      .where(where)
      .orderBy(asc(subjectLibrary.name))
      .limit(limit)
      .offset(offset),
    getDb().select({ value: count() }).from(subjectLibrary).where(where),
  ])

  return { items, total: countResult[0]?.value ?? 0 }
}

export async function incrementSubjectUsage(id: string): Promise<void> {
  await getDb()
    .update(subjectLibrary)
    .set({
      usageCount: sql`${subjectLibrary.usageCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(subjectLibrary.id, id))
}

export async function toggleSubjectFavorite(id: string): Promise<boolean | null> {
  const subject = await getSubjectById(id)
  if (!subject)
    return null
  const newValue = !subject.isFavorite
  await updateSubject(id, { isFavorite: newValue })
  return newValue
}

// ── 项目 ↔ 主体关联 ──────────────────────────────────

export async function linkProjectSubject(projectId: string, subjectId: string, overrideJson?: Record<string, unknown> | null) {
  const [row] = await getDb()
    .insert(projectSubjectRefs)
    .values({ projectId, subjectId, overrideJson: overrideJson ?? null })
    .returning()
  return row!
}

export async function unlinkProjectSubject(projectId: string, subjectId: string): Promise<boolean> {
  const [row] = await getDb()
    .delete(projectSubjectRefs)
    .where(and(
      eq(projectSubjectRefs.projectId, projectId),
      eq(projectSubjectRefs.subjectId, subjectId),
    ))
    .returning({ id: projectSubjectRefs.id })
  return !!row
}

export async function listProjectSubjects(projectId: string): Promise<SubjectLibraryRow[]> {
  const rows = await getDb()
    .select({ subject: subjectLibrary })
    .from(projectSubjectRefs)
    .innerJoin(subjectLibrary, eq(projectSubjectRefs.subjectId, subjectLibrary.id))
    .where(eq(projectSubjectRefs.projectId, projectId))

  return rows.map(r => r.subject)
}

export async function searchSubjectsByName(accountId: string, name: string, subjectType?: 'character' | 'location'): Promise<SubjectLibraryRow[]> {
  const conditions: ReturnType<typeof sql>[] = [
    eq(subjectLibrary.accountId, accountId),
    ilike(subjectLibrary.name, `%${name}%`),
  ]
  if (subjectType) {
    conditions.push(eq(subjectLibrary.subjectType, subjectType))
  }

  return getDb()
    .select()
    .from(subjectLibrary)
    .where(and(...conditions))
    .orderBy(asc(subjectLibrary.name))
    .limit(10)
}
