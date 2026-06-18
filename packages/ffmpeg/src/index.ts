export {
  checkFFmpegAsync,
  extractAudioFromVideo,
  getMediaDurationMs,
  getVideoResolution,
} from './audio-extractor'
export type { AudioExtractionResult } from './audio-extractor'
export { concatVideos, hasAudioStream, mixBgmTrack } from './compose'
export type { ConcatResult, MixBgmResult } from './compose'
export { FfmpegTimeoutError, spawnFfmpeg } from './ffmpeg-spawn'
export type { FfmpegSpawnOptions, FfmpegSpawnResult } from './ffmpeg-spawn'
export { burnSubtitlesToVideo } from './subtitle-burner'
export type { BurnResult } from './subtitle-burner'
