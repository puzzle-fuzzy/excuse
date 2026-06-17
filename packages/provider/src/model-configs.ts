import type { InputMapping, ModelConfig } from '@excuse/shared'

// ── 通用映射片段，减少重复 ──────────────────────────────
//
// 设计原则：inputMapping 按「参数名 → 请求体位置」声明式映射。
// buildRequestBody() 遍历用户提供的 params，查 inputMapping 放入正确位置。
// 未在 parameters[] 中声明的 mapping 条目不会被触发，所以共享 mapping 是安全的。

// 统一使用 Record<string, InputMapping> 类型，确保 spread 后类型兼容
const TEXT_MAPPING: Record<string, InputMapping> = {
  prompt: { target: 'prompt' },
  max_tokens: { target: 'parameter' },
  temperature: { target: 'parameter' },
  top_p: { target: 'parameter' },
  seed: { target: 'parameter' },
}

const IMAGE_MAPPING: Record<string, InputMapping> = {
  prompt: { target: 'prompt' },
  negative_prompt: { target: 'parameter' },
  size: { target: 'parameter' },
  n: { target: 'parameter' },
  watermark: { target: 'parameter' },
  prompt_extend: { target: 'parameter' },
  seed: { target: 'parameter' },
}

// 视频模型的 negative_prompt 在 input 层（非 parameters），用 mediaField 映射
const VIDEO_T2V_MAPPING: Record<string, InputMapping> = {
  prompt: { target: 'prompt' },
  negative_prompt: { target: 'mediaField', field: 'negative_prompt' },
  resolution: { target: 'parameter' },
  ratio: { target: 'parameter' },
  duration: { target: 'parameter' },
  prompt_extend: { target: 'parameter' },
  watermark: { target: 'parameter' },
  seed: { target: 'parameter' },
  // wan2.7-t2v 的 audio_url 在 input 层，HappyHorse-t2v 无此参数不会被触发
  audio_url: { target: 'mediaField', field: 'audio_url' },
}

// video-media 的通用参数映射（不含 media 类参数，由具体模型单独声明）
const VIDEO_MEDIA_MAPPING: Record<string, InputMapping> = {
  prompt: { target: 'prompt' },
  negative_prompt: { target: 'mediaField', field: 'negative_prompt' },
  resolution: { target: 'parameter' },
  ratio: { target: 'parameter' },
  duration: { target: 'parameter' },
  prompt_extend: { target: 'parameter' },
  watermark: { target: 'parameter' },
  seed: { target: 'parameter' },
  audio_setting: { target: 'parameter' },
}

// 音频模型（fun-music-v1）映射 — 所有字段置于 input 层（无 parameters 包裹）
// prompt 为音乐描述；lyrics/gender/format/enable_aigc_watermark 为模型特有 input 字段
const AUDIO_MAPPING: Record<string, InputMapping> = {
  prompt: { target: 'prompt' },
  lyrics: { target: 'mediaField', field: 'lyrics' },
  gender: { target: 'mediaField', field: 'gender' },
  format: { target: 'mediaField', field: 'format' },
  enable_aigc_watermark: { target: 'mediaField', field: 'enable_aigc_watermark' },
}

// ── 模型配置 ────────────────────────────────────────────

export const MODELS: Record<string, ModelConfig> = {
  // ===== 文本生成模型 =====

  'qwen-max': {
    id: 'qwen-max',
    name: '千问 Max',
    category: 'text',
    type: 'generation',
    description: '阿里云最强文本生成模型，适合复杂任务',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
    async: false,
    pricing: { inputPriceCents: 240, outputPriceCents: 960, unit: 'token' },
    requestType: 'chat',
    inputMapping: TEXT_MAPPING,
    parameters: [
      { name: 'prompt', type: 'text', required: true, description: '输入文本' },
      { name: 'max_tokens', type: 'number', defaultValue: 1500, min: 1, max: 8000, description: '最大输出 Token 数' },
      { name: 'temperature', type: 'number', defaultValue: 0.7, min: 0, max: 2, description: '随机性控制' },
      { name: 'top_p', type: 'number', defaultValue: 0.9, min: 0, max: 1, description: '核采样参数' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子，固定可提升稳定性' },
    ],
  },

  'qwen-plus': {
    id: 'qwen-plus',
    name: '千问 Plus',
    category: 'text',
    type: 'generation',
    description: '高性价比文本生成模型',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
    async: false,
    pricing: { inputPriceCents: 80, outputPriceCents: 200, unit: 'token' },
    requestType: 'chat',
    inputMapping: TEXT_MAPPING,
    parameters: [
      { name: 'prompt', type: 'text', required: true, description: '输入文本' },
      { name: 'max_tokens', type: 'number', defaultValue: 1500, min: 1, max: 8000, description: '最大输出 Token 数' },
      { name: 'temperature', type: 'number', defaultValue: 0.7, min: 0, max: 2, description: '随机性控制' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子' },
    ],
  },

  'qwen-turbo': {
    id: 'qwen-turbo',
    name: '千问 Turbo',
    category: 'text',
    type: 'generation',
    description: '超高速文本生成模型',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
    async: false,
    pricing: { inputPriceCents: 30, outputPriceCents: 60, unit: 'token' },
    requestType: 'chat',
    inputMapping: TEXT_MAPPING,
    parameters: [
      { name: 'prompt', type: 'text', required: true, description: '输入文本' },
      { name: 'max_tokens', type: 'number', defaultValue: 1500, min: 1, max: 8000, description: '最大输出 Token 数' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子' },
    ],
  },

  'qwen-long': {
    id: 'qwen-long',
    name: '千问 Long',
    category: 'text',
    type: 'generation',
    description: '超长上下文文本生成模型',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
    async: false,
    pricing: { inputPriceCents: 50, outputPriceCents: 200, unit: 'token' },
    requestType: 'chat',
    inputMapping: TEXT_MAPPING,
    parameters: [
      { name: 'prompt', type: 'text', required: true, description: '输入文本' },
      { name: 'max_tokens', type: 'number', defaultValue: 1500, min: 1, max: 8000, description: '最大输出 Token 数' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子' },
    ],
  },

  'qwen3.7-plus': {
    id: 'qwen3.7-plus',
    name: '千问 3.7 Plus',
    category: 'text',
    type: 'generation',
    description: '最新千问推理模型，适合复杂分析和创作任务',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    async: false,
    pricing: { inputPriceCents: 160, outputPriceCents: 640, unit: 'token' },
    requestType: 'openai-chat',
    inputMapping: TEXT_MAPPING,
    parameters: [
      { name: 'prompt', type: 'text', required: true, description: '输入文本' },
      { name: 'max_tokens', type: 'number', defaultValue: 1500, min: 1, max: 8000, description: '最大输出 Token 数' },
      { name: 'temperature', type: 'number', defaultValue: 0.7, min: 0, max: 2, description: '随机性控制' },
      { name: 'top_p', type: 'number', defaultValue: 0.9, min: 0, max: 1, description: '核采样参数' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子' },
    ],
  },

  // ===== 文生图模型 =====

  'qwen-image-2.0-pro': {
    id: 'qwen-image-2.0-pro',
    name: '千问图像 2.0 Pro',
    category: 'image',
    type: 'generation',
    description: '最强图像生成模型，擅长复杂文本渲染',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    async: false,
    pricing: { inputPriceCents: 25, unit: 'image', note: '0.25元/张' },
    requestType: 'image',
    inputMapping: IMAGE_MAPPING,
    parameters: [
      { name: 'prompt', type: 'text', required: true, description: '正向提示词' },
      { name: 'negative_prompt', type: 'text', description: '反向提示词' },
      { name: 'size', type: 'select', defaultValue: '2048*2048', description: '图像分辨率', options: [
        { label: '2048x2048 (1:1)', value: '2048*2048' },
        { label: '2688x1536 (16:9)', value: '2688*1536' },
        { label: '1536x2688 (9:16)', value: '1536*2688' },
        { label: '2368x1728 (4:3)', value: '2368*1728' },
        { label: '1728x2368 (3:4)', value: '1728*2368' },
      ] },
      { name: 'n', type: 'number', defaultValue: 1, min: 1, max: 6, description: '生成数量' },
      { name: 'watermark', type: 'boolean', defaultValue: false, description: '添加水印' },
      { name: 'prompt_extend', type: 'boolean', defaultValue: true, description: '智能改写提示词' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子' },
    ],
  },

  'qwen-image-max': {
    id: 'qwen-image-max',
    name: '千问图像 Max',
    category: 'image',
    type: 'generation',
    description: '高真实感图像生成模型',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    async: false,
    pricing: { inputPriceCents: 25, unit: 'image', note: '0.25元/张' },
    requestType: 'image',
    // qwen-image-max 的 n 固定为 1，不暴露给用户；无 n 映射 → 不发送
    inputMapping: {
      prompt: { target: 'prompt' },
      negative_prompt: { target: 'parameter' },
      size: { target: 'parameter' },
      watermark: { target: 'parameter' },
      prompt_extend: { target: 'parameter' },
      seed: { target: 'parameter' },
    },
    parameters: [
      { name: 'prompt', type: 'text', required: true, description: '正向提示词' },
      { name: 'negative_prompt', type: 'text', description: '反向提示词' },
      { name: 'size', type: 'select', defaultValue: '1664*928', description: '图像分辨率', options: [
        { label: '1664x928 (16:9)', value: '1664*928' },
        { label: '1472x1104 (4:3)', value: '1472*1104' },
        { label: '1328x1328 (1:1)', value: '1328*1328' },
        { label: '1104x1472 (3:4)', value: '1104*1472' },
        { label: '928x1664 (9:16)', value: '928*1664' },
      ] },
      { name: 'watermark', type: 'boolean', defaultValue: false, description: '添加水印' },
      { name: 'prompt_extend', type: 'boolean', defaultValue: true, description: '智能改写提示词' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子' },
    ],
  },

  // ===== 音频生成模型 =====

  'fun-music-v1': {
    id: 'fun-music-v1',
    name: 'FunMusic 音乐生成',
    category: 'audio',
    type: 'generation',
    description: '阿里云音乐生成模型，按文本描述生成 BGM（邀测期模型）',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/audio/music/generation',
    async: false,
    // 定价：0.002 元 / 1000 秒（邀测期，见 docs/bailian/模型调用价格.md）= 0.0002 分/秒。
    // 按秒计费（unit=audio），currency.js precision=4 可精确表示。
    pricing: { inputPriceCents: 0.0002, unit: 'audio', note: '0.002元/1000秒（邀测期）' },
    requestType: 'audio',
    inputMapping: AUDIO_MAPPING,
    parameters: [
      { name: 'prompt', type: 'text', required: true, description: '音乐描述（风格/情绪/乐器/场景，1~2000 字符）' },
      { name: 'lyrics', type: 'text', description: '歌词（与 prompt 二选一，中文 5~350 字符）' },
      { name: 'gender', type: 'select', defaultValue: 'female', description: '演唱声性别', options: [
        { label: '女声', value: 'female' },
        { label: '男声', value: 'male' },
      ] },
      { name: 'format', type: 'select', defaultValue: 'mp3', description: '音频编码格式', options: [
        { label: 'MP3（网络传输）', value: 'mp3' },
        { label: 'WAV（高质量）', value: 'wav' },
      ] },
      { name: 'enable_aigc_watermark', type: 'boolean', defaultValue: false, description: 'AIGC 水印（追加摩尔斯电码标识）' },
    ],
  },

  // ===== HappyHorse 视频模型 =====

  'happyhorse-1.0-t2v': {
    id: 'happyhorse-1.0-t2v',
    name: 'HappyHorse 文生视频',
    category: 'video',
    type: 'generation',
    description: '高质量文生视频模型',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
    async: true,
    pricing: { inputPriceCents: 90, inputPrice1080Cents: 160, unit: 'video', note: '720P: 0.9元/秒, 1080P: 1.6元/秒' },
    requestType: 'video-t2v',
    inputMapping: VIDEO_T2V_MAPPING,
    parameters: [
      { name: 'prompt', type: 'text', required: true, description: '文本提示词' },
      { name: 'resolution', type: 'select', defaultValue: '1080P', description: '视频分辨率', options: [
        { label: '720P (0.9元/秒)', value: '720P' },
        { label: '1080P (1.6元/秒)', value: '1080P' },
      ] },
      { name: 'ratio', type: 'select', defaultValue: '16:9', description: '宽高比', options: [
        { label: '16:9', value: '16:9' },
        { label: '9:16', value: '9:16' },
        { label: '1:1', value: '1:1' },
        { label: '4:3', value: '4:3' },
        { label: '3:4', value: '3:4' },
        { label: '4:5', value: '4:5' },
        { label: '5:4', value: '5:4' },
        { label: '9:21', value: '9:21' },
        { label: '21:9', value: '21:9' },
      ] },
      { name: 'duration', type: 'number', defaultValue: 5, min: 3, max: 15, description: '视频时长（秒）' },
      { name: 'watermark', type: 'boolean', defaultValue: true, description: '添加水印' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子' },
    ],
  },

  'happyhorse-1.0-i2v': {
    id: 'happyhorse-1.0-i2v',
    name: 'HappyHorse 图生视频',
    category: 'video',
    type: 'generation',
    description: '基于首帧图像生成视频',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
    async: true,
    pricing: { inputPriceCents: 90, inputPrice1080Cents: 160, unit: 'video', note: '720P: 0.9元/秒, 1080P: 1.6元/秒' },
    requestType: 'video-media',
    inputMapping: {
      ...VIDEO_MEDIA_MAPPING,
      // 文档：media type = "first_frame"
      first_frame_url: { target: 'media', mediaType: 'first_frame' } as const,
    },
    parameters: [
      { name: 'prompt', type: 'text', description: '文本提示词' },
      { name: 'first_frame_url', type: 'text', required: true, mediaUpload: { accept: 'image/*' }, description: '首帧图像' },
      { name: 'resolution', type: 'select', defaultValue: '1080P', description: '视频分辨率', options: [
        { label: '720P (0.9元/秒)', value: '720P' },
        { label: '1080P (1.6元/秒)', value: '1080P' },
      ] },
      { name: 'duration', type: 'number', defaultValue: 5, min: 3, max: 15, description: '视频时长（秒）' },
      { name: 'watermark', type: 'boolean', defaultValue: true, description: '添加水印' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子' },
    ],
  },

  'happyhorse-1.0-r2v': {
    id: 'happyhorse-1.0-r2v',
    name: 'HappyHorse 参考生视频',
    category: 'video',
    type: 'generation',
    description: '参考图像生成多角色视频',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
    async: true,
    pricing: { inputPriceCents: 90, inputPrice1080Cents: 160, unit: 'video', note: '720P: 0.9元/秒, 1080P: 1.6元/秒' },
    requestType: 'video-media',
    inputMapping: VIDEO_MEDIA_MAPPING,
    // referenceUrls → input.media[{ type: "reference_image", url }]
    referenceMediaType: 'reference_image',
    fallbackModel: 'happyhorse-1.0-t2v',
    parameters: [
      { name: 'prompt', type: 'text', required: true, description: '文本提示词' },
      { name: 'resolution', type: 'select', defaultValue: '1080P', description: '视频分辨率', options: [
        { label: '720P (0.9元/秒)', value: '720P' },
        { label: '1080P (1.6元/秒)', value: '1080P' },
      ] },
      { name: 'ratio', type: 'select', defaultValue: '16:9', description: '宽高比', options: [
        { label: '16:9', value: '16:9' },
        { label: '9:16', value: '9:16' },
        { label: '1:1', value: '1:1' },
        { label: '4:3', value: '4:3' },
        { label: '3:4', value: '3:4' },
        { label: '4:5', value: '4:5' },
        { label: '5:4', value: '5:4' },
        { label: '9:21', value: '9:21' },
        { label: '21:9', value: '21:9' },
      ] },
      { name: 'duration', type: 'number', defaultValue: 5, min: 3, max: 15, description: '视频时长（秒）' },
      { name: 'watermark', type: 'boolean', defaultValue: true, description: '添加水印' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子' },
    ],
  },

  'happyhorse-1.0-video-edit': {
    id: 'happyhorse-1.0-video-edit',
    name: 'HappyHorse 视频编辑',
    category: 'video',
    type: 'editing',
    description: '视频编辑模型，支持风格变换和局部替换',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
    async: true,
    pricing: { inputPriceCents: 90, inputPrice1080Cents: 160, unit: 'video', note: '720P: 0.9元/秒, 1080P: 1.6元/秒' },
    requestType: 'video-media',
    inputMapping: {
      ...VIDEO_MEDIA_MAPPING,
      video_url: { target: 'media', mediaType: 'video' } as const,
      reference_image_url: { target: 'media', mediaType: 'reference_image' } as const,
    },
    parameters: [
      { name: 'prompt', type: 'text', required: true, description: '编辑指令' },
      { name: 'video_url', type: 'text', required: true, mediaUpload: { accept: 'video/*' }, description: '原视频' },
      { name: 'reference_image_url', type: 'text', mediaUpload: { accept: 'image/*', multiple: true }, description: '参考图（最多5张）' },
      { name: 'resolution', type: 'select', defaultValue: '1080P', description: '视频分辨率', options: [
        { label: '720P (0.9元/秒)', value: '720P' },
        { label: '1080P (1.6元/秒)', value: '1080P' },
      ] },
      { name: 'audio_setting', type: 'select', defaultValue: 'auto', description: '音频设置', options: [
        { label: '自动', value: 'auto' },
        { label: '保留原声', value: 'origin' },
      ] },
      { name: 'watermark', type: 'boolean', defaultValue: true, description: '添加水印' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子' },
    ],
  },

  // ===== 万相 2.7 视频模型 =====

  'wan2.7-t2v': {
    id: 'wan2.7-t2v',
    name: '万相 2.7 文生视频',
    category: 'video',
    type: 'generation',
    description: '最新万相文生视频模型',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
    async: true,
    pricing: { inputPriceCents: 60, inputPrice1080Cents: 100, unit: 'video', note: '720P: 0.6元/秒, 1080P: 1元/秒' },
    requestType: 'video-t2v',
    inputMapping: VIDEO_T2V_MAPPING,
    parameters: [
      { name: 'prompt', type: 'text', required: true, description: '文本提示词' },
      { name: 'negative_prompt', type: 'text', description: '反向提示词' },
      { name: 'audio_url', type: 'text', mediaUpload: { accept: 'audio/*' }, description: '自定义音频（wav/mp3, 2-30秒）' },
      { name: 'resolution', type: 'select', defaultValue: '1080P', description: '视频分辨率', options: [
        { label: '720P (0.6元/秒)', value: '720P' },
        { label: '1080P (1元/秒)', value: '1080P' },
      ] },
      { name: 'ratio', type: 'select', defaultValue: '16:9', description: '宽高比', options: [
        { label: '16:9', value: '16:9' },
        { label: '9:16', value: '9:16' },
        { label: '1:1', value: '1:1' },
        { label: '4:3', value: '4:3' },
        { label: '3:4', value: '3:4' },
      ] },
      { name: 'duration', type: 'number', defaultValue: 5, min: 2, max: 15, description: '视频时长（秒）' },
      { name: 'prompt_extend', type: 'boolean', defaultValue: true, description: '智能改写提示词' },
      { name: 'watermark', type: 'boolean', defaultValue: false, description: '添加水印' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子' },
    ],
  },

  'wan2.7-i2v': {
    id: 'wan2.7-i2v',
    name: '万相 2.7 图生视频',
    category: 'video',
    type: 'generation',
    description: '基于首帧/首尾帧/视频片段生成视频',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
    async: true,
    pricing: { inputPriceCents: 60, inputPrice1080Cents: 100, unit: 'video', note: '720P: 0.6元/秒, 1080P: 1元/秒' },
    requestType: 'video-media',
    inputMapping: {
      ...VIDEO_MEDIA_MAPPING,
      // 文档 media type：first_frame / last_frame / first_clip / driving_audio
      first_frame_url: { target: 'media', mediaType: 'first_frame' } as const,
      last_frame_url: { target: 'media', mediaType: 'last_frame' } as const,
      video_url: { target: 'media', mediaType: 'first_clip' } as const,
      audio_url: { target: 'media', mediaType: 'driving_audio' } as const,
    },
    parameters: [
      { name: 'prompt', type: 'text', description: '文本提示词' },
      { name: 'negative_prompt', type: 'text', description: '反向提示词' },
      { name: 'first_frame_url', type: 'text', required: true, mediaUpload: { accept: 'image/*' }, description: '首帧图像' },
      { name: 'last_frame_url', type: 'text', mediaUpload: { accept: 'image/*' }, description: '尾帧图像' },
      { name: 'video_url', type: 'text', mediaUpload: { accept: 'video/*' }, description: '视频片段（续写）' },
      { name: 'audio_url', type: 'text', mediaUpload: { accept: 'audio/*' }, description: '驱动音频（wav/mp3）' },
      { name: 'resolution', type: 'select', defaultValue: '1080P', description: '视频分辨率', options: [
        { label: '720P (0.6元/秒)', value: '720P' },
        { label: '1080P (1元/秒)', value: '1080P' },
      ] },
      // 文档：i2v 无 ratio 参数，输出宽高比跟随输入媒体
      { name: 'duration', type: 'number', defaultValue: 5, min: 2, max: 15, description: '视频时长（秒）' },
      { name: 'prompt_extend', type: 'boolean', defaultValue: true, description: '智能改写提示词' },
      { name: 'watermark', type: 'boolean', defaultValue: false, description: '添加水印' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子' },
    ],
  },

  'wan2.7-r2v': {
    id: 'wan2.7-r2v',
    name: '万相 2.7 参考生视频',
    category: 'video',
    type: 'generation',
    description: '参考图像/视频生成多角色互动视频',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
    async: true,
    pricing: { inputPriceCents: 60, inputPrice1080Cents: 100, unit: 'video', note: '720P: 0.6元/秒, 1080P: 1元/秒' },
    requestType: 'video-media',
    inputMapping: VIDEO_MEDIA_MAPPING,
    // referenceUrls → input.media[{ type: "reference_image", url }]
    referenceMediaType: 'reference_image',
    fallbackModel: 'wan2.7-t2v',
    parameters: [
      { name: 'prompt', type: 'text', required: true, description: '文本提示词' },
      { name: 'negative_prompt', type: 'text', description: '反向提示词' },
      { name: 'resolution', type: 'select', defaultValue: '1080P', description: '视频分辨率', options: [
        { label: '720P (0.6元/秒)', value: '720P' },
        { label: '1080P (1元/秒)', value: '1080P' },
      ] },
      { name: 'ratio', type: 'select', defaultValue: '16:9', description: '宽高比', options: [
        { label: '16:9', value: '16:9' },
        { label: '9:16', value: '9:16' },
        { label: '1:1', value: '1:1' },
        { label: '4:3', value: '4:3' },
        { label: '3:4', value: '3:4' },
      ] },
      { name: 'duration', type: 'number', defaultValue: 5, min: 2, max: 15, description: '视频时长（秒）' },
      { name: 'prompt_extend', type: 'boolean', defaultValue: true, description: '智能改写提示词' },
      { name: 'watermark', type: 'boolean', defaultValue: false, description: '添加水印' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子' },
    ],
  },

  'wan2.7-videoedit': {
    id: 'wan2.7-videoedit',
    name: '万相 2.7 视频编辑',
    category: 'video',
    type: 'editing',
    description: '视频编辑模型，支持风格变换和局部替换',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
    async: true,
    pricing: { inputPriceCents: 60, inputPrice1080Cents: 100, unit: 'video', note: '720P: 0.6元/秒, 1080P: 1元/秒' },
    requestType: 'video-media',
    inputMapping: {
      ...VIDEO_MEDIA_MAPPING,
      video_url: { target: 'media', mediaType: 'video' } as const,
      reference_image_url: { target: 'media', mediaType: 'reference_image' } as const,
    },
    parameters: [
      { name: 'prompt', type: 'text', description: '编辑指令（可选）' },
      { name: 'negative_prompt', type: 'text', description: '反向提示词' },
      { name: 'video_url', type: 'text', required: true, mediaUpload: { accept: 'video/*' }, description: '原视频（2-10秒）' },
      { name: 'reference_image_url', type: 'text', mediaUpload: { accept: 'image/*', multiple: true }, description: '参考图（最多4张）' },
      { name: 'resolution', type: 'select', defaultValue: '1080P', description: '视频分辨率', options: [
        { label: '720P (0.6元/秒)', value: '720P' },
        { label: '1080P (1元/秒)', value: '1080P' },
      ] },
      { name: 'ratio', type: 'select', description: '宽高比', options: [
        { label: '16:9', value: '16:9' },
        { label: '9:16', value: '9:16' },
        { label: '1:1', value: '1:1' },
        { label: '4:3', value: '4:3' },
        { label: '3:4', value: '3:4' },
      ] },
      // 文档：duration 默认 0 = 使用原视频时长，仅用于截断
      { name: 'duration', type: 'number', defaultValue: 0, min: 2, max: 10, description: '视频时长（秒，0=跟随原视频）' },
      { name: 'audio_setting', type: 'select', defaultValue: 'auto', description: '音频设置', options: [
        { label: '自动', value: 'auto' },
        { label: '保留原声', value: 'origin' },
      ] },
      { name: 'prompt_extend', type: 'boolean', defaultValue: true, description: '智能改写提示词' },
      { name: 'watermark', type: 'boolean', defaultValue: false, description: '添加水印' },
      { name: 'seed', type: 'number', min: 0, max: 2147483647, description: '随机数种子' },
    ],
  },
}

export function getModelById(id: string): ModelConfig | undefined {
  return MODELS[id]
}

export function getModelsByCategory(category: string): ModelConfig[] {
  return Object.values(MODELS).filter(m => m.category === category)
}
