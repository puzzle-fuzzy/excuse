/**
 * Canvas 核心业务服务 — barrel re-export
 *
 * 函数已按职责拆分到独立文件，本文件仅做统一导出。
 * routes/canvas.ts 通过 `import * as svc from './service'` 引用。
 */

export { analyzeProject } from './analysis'

export { assembleProject } from './assemble'

export { getCanvasAssetsPoll } from './asset-poll'

export { generateBgm } from './bgm'
export { generateCharacters } from './characters'
export { checkContinuity, rebuildShotPrompts } from './continuity-rebuild'
export { generateDialogue } from './dialogue'
export { generateLocations } from './locations'
export { generateCharacterRefs, generateLocationRefs } from './references'
export { regenerateCharacter, regenerateLocation, regenerateShotVideo } from './regenerate'
export {
  applyShotReferenceAssets,
  createProject,
  deleteCharacter,
  deleteLocation,
  deleteShot,
  getCharacterDetail,
  getLocationDetail,
  getProjectDetail,
  getProjectSummary,
  getShotDetail,
  listProjects,
  saveCanvasLayout,
  softDeleteProject,
  updateCharacterData,
  updateLocationData,
  updateModelPreferences,
  updateProjectProperties,
  updateShotData,
} from './service-crud'
export { generateStoryboard } from './storyboard'
export { generateVideos, retryFailedShots, retryShotVideo } from './videos'
