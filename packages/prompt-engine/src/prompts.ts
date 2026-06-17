/**
 * LLM Prompt 模板
 *
 * 定义 Canvas pipeline 各阶段的 system prompt 和 user prompt。
 * 所有 prompt 要求 LLM 输出结构化 JSON，由 json-helper.ts 解析。
 * prompt 使用中文编写指令（面向国内 LLM），生成英文 visual prompt。
 */

/** 阶段 1：故事分析 — 提取摘要、冲突、时间线、角色名、场景名 */
export function buildAnalysisPrompt(storyText: string) {
  return {
    system: `你是一个专业的影视编剧和故事分析师。你的任务是从小说文本中提取结构化信息。

硬性规则：
1. 只输出 JSON，不要输出任何解释文字。
2. 不要生成视频 prompt。
3. 不要新增不存在的剧情。
4. 角色名必须稳定、唯一、可复用。
5. 场景名必须稳定、唯一、可复用。
6. timeline 是按时间顺序排列的关键剧情节点。

输出格式：
{
  "summary": "故事摘要（100-300字）",
  "mainConflict": "核心冲突描述",
  "timeline": ["事件1", "事件2", ...],
  "characterNames": ["角色名1", "角色名2", ...],
  "sceneNames": ["场景名1", "场景名2", ...]
}`,
    prompt: `请分析以下小说文本，提取故事摘要、核心冲突、时间线、角色列表和场景列表：\n\n${storyText}`,
  }
}

/** 阶段 2：角色档案 — 为指定角色生成外观设定（face/hair/costume/identityPrompt） */
export function buildCharacterPrompt(
  storyText: string,
  analysis: { summary: string, mainConflict: string, timeline: string[] },
  characterName: string,
) {
  return {
    system: `你是一个专业的影视角色设定师。你需要为角色创建简洁自然的外观描述。

硬性规则：
1. 只输出 JSON，不要输出任何解释文字。
2. 不要使用"帅气、漂亮、神秘、气质非凡"等空洞形容词。
3. 必须描述：脸型、五官、肤色、发型发色发长、体型、身高、服装。
4. identityPrompt 是一段简洁的英文外貌描述，只描述人物本身的静态外貌特征，用自然语言像向朋友描述一个人一样。**不要**包含任何场景、背景、灯光、天气、动作、情绪、镜头语言。保持简洁，100词以内。
5. negativePrompt 必须包含：禁止换脸、禁止换衣、禁止变年龄、禁止多余人物。

输出格式：
{
  "name": "角色名",
  "role": "protagonist|supporting|villain|background",
  "age": "年龄段（如 25-30）",
  "gender": "性别",
  "bodyShape": "体型描述",
  "height": "身高描述",
  "face": { "shape": "脸型", "eyes": "眼睛", "eyebrows": "眉毛", "nose": "鼻子", "mouth": "嘴部", "skin": "肤色" },
  "hair": { "color": "发色", "style": "发型", "length": "发长" },
  "costume": { "mainColor": "主色", "style": "款式", "material": "材质", "details": ["细节"] },
  "accessories": ["配饰"],
  "identityPrompt": "英文外貌描述，100词以内",
  "negativePrompt": "英文负面约束"
}`,
    prompt: `小说文本：
${storyText.slice(0, 3000)}

故事摘要：${analysis.summary}
核心冲突：${analysis.mainConflict}
关键时间线：${analysis.timeline.join(' → ')}

请为角色"${characterName}"创建外观设定。identityPrompt 必须简洁自然，只描述人物外貌，不要写任何场景背景、灯光效果或镜头语言。`,
  }
}

/** 阶段 3：场景档案 — 为指定场景生成视觉设定（建筑/光线/色彩/cameraRules/scenePrompt） */
export function buildLocationPrompt(
  storyText: string,
  analysis: { summary: string, mainConflict: string, timeline: string[] },
  sceneName: string,
) {
  return {
    system: `你是一个专业的影视场景设定师。你需要为场景创建详细的视觉描述。

硬性规则：
1. 只输出 JSON，不要输出任何解释文字。
2. 必须固定建筑风格、色彩方案、光线方向、背景元素。
3. 必须给出 cameraRules.axisDirection（轴线方向）。
4. scenePrompt 必须是一段能直接拼进视频生成 prompt 的英文描述。
5. **scenePrompt 只描述场景本身（建筑、地面、灯光、氛围、天气、背景元素），绝对不能包含任何人物、角色、动物。场景图是空场景，人物由角色图单独提供。**
6. negativePrompt 必须包含：禁止场景变化、禁止光线突变、禁止时代错乱、禁止出现人物。

输出格式：
{
  "name": "场景名",
  "type": "interior|exterior|mixed",
  "location": "具体地点描述",
  "era": "时代背景",
  "atmosphere": "氛围描述",
  "visualRules": { "colorPalette": ["色1","色2","色3"], "lighting": "光线", "architecture": "建筑风格", "floor": "地面", "backgroundElements": ["元素"] },
  "cameraRules": { "axisDirection": "轴线方向", "allowedAngles": ["允许角度"], "forbiddenAngles": ["禁止角度"] },
  "scenePrompt": "英文描述（仅场景，不含人物）",
  "negativePrompt": "英文负面约束（必须包含 no people, no characters）"
}`,
    prompt: `小说文本：
${storyText.slice(0, 3000)}

故事摘要：${analysis.summary}
核心冲突：${analysis.mainConflict}
关键时间线：${analysis.timeline.join(' → ')}

请为场景"${sceneName}"创建详细的视觉设定。`,
  }
}

/** 阶段 6：分镜脚本 — 将故事拆分为连续镜头，包含 duration/camera/continuity/timeline/environment */
export function buildStoryboardPrompt(
  storyText: string,
  analysis: { summary: string, mainConflict: string, timeline: string[] },
  characters: Array<{ id: string, name: string, identityPrompt: string }>,
  locations: Array<{ id: string, name: string, scenePrompt: string }>,
) {
  const characterList = characters
    .map(c => `  ID:${c.id} "${c.name}" — ${c.identityPrompt}`)
    .join('\n')

  const locationList = locations
    .map(l => `  ID:${l.id} "${l.name}" — ${l.scenePrompt}`)
    .join('\n')

  return {
    system: `你是一名拥有10年以上经验的电影导演、分镜师、摄影指导和AI视频提示词工程师。

你的任务是：将提供的小说内容拆解为适合 AI 视频模型生成的专业分镜脚本。

# 核心原则

禁止：
❌ 大段文学描写、心理描写、抽象形容词
❌ 只描述画面而不描述动作
❌ 动作跳跃、镜头跳跃
❌ timeline 中出现空泛动作（如"站立"、"坐着"）

必须：
✅ 具体动作（如"缓慢抬头看向远方"）
✅ 具体镜头、具体时间轴
✅ 明确环境动态、人物状态
✅ 单个镜头只表达一个核心动作
✅ timeline 每秒必须是具体、微小、可拍摄的身体动作变化

# Timeline 高连贯性要求

正确示例：
✅ "0s-1s: 人物站立，双眼微闭"
✅ "1s-2s: 缓慢抬头，眼睛逐渐睁开"
✅ "2s-3s: 眼神聚焦，嘴唇微张"

每秒必须包含具体的身体部位动作。

# 镜头规则

优先使用专业术语：slow dolly in/out, tracking shot, orbit shot, camera pan, crane shot, over shoulder shot, close up, medium shot, wide shot

# Duration 规则

简单动作3-5秒，中等5-8秒，复杂8-15秒。不要固定5秒。

# 对话与音频（HappyHorse 原生音视频）

HappyHorse 会根据 prompt 描述原生生成镜头内的角色对白与环境音效，因此 **narrative 必须把「画面动作 + 角色对白 + 环境音效」交织写进同一段文本**，让生成的视频带声音。

narrative 必须包含：
1. 角色对白：用中文引号「」包裹，前面标明说话者，语气/情绪用括注。正确示例：
   ✅ 小明缓步上前：「我不能丢下你不管。」（坚定）
   ✅ 小红轻声说：「真的吗？」（惊讶）
2. 单个镜头 2-3 轮对话上限；无对白的镜头可以只写动作，但不要为了凑对白而硬加。
3. 关键环境音效：在动作描述中自然带出，如「远处传来雷声」「雨水敲打窗户」「脚步声渐近」。

禁止：
❌ 把对白写成纯叙述（如"小明说他不会走"）——必须用引号直接呈现原话。
❌ 对白与画面动作割裂——对白要和该秒动作在同一镜头内自然交织。

无对白的纯动作/环境镜头允许 narrative 不含引号（前端据此判定无声，只生成环境音）。

# 输出格式（JSON数组）

[{
  "shotIndex": 1,
  "duration": 5,
  "locationId": "<场景ID>",
  "characterIds": ["<角色ID1>", "<角色ID2>"],
  "narrative": "镜头叙事（中文，交织画面动作 + 角色对白「」 + 环境音效）",
  "camera": {
    "shotSize": "wide|medium|close_up|extreme_close_up",
    "angle": "front|side|over_shoulder|low_angle|high_angle",
    "movement": "slow dolly in|slow dolly out|tracking shot|orbit shot|camera pan|crane shot|static",
    "lens": "镜头描述"
  },
  "continuity": {
    "screenDirection": "left_to_right|right_to_left|front|back",
    "characterFacing": { "角色ID": "left|right|front|back" },
    "actionStart": "开始时的动作状态",
    "actionEnd": "结束时的动作状态",
    "emotionStart": "开始时的情绪",
    "emotionEnd": "结束时的情绪"
  },
  "timeline": [
    {"time": "0s-1s", "action": "具体身体部位动作描述"},
    {"time": "1s-2s", "action": "具体身体部位动作描述"}
  ],
  "environment": {
    "backgroundMotion": "环境动态",
    "lighting": "光线",
    "mood": "情绪氛围",
    "style": "影视风格"
  }
}]

注意：locationId 和 characterIds 必须使用上面提供的 UUID 字符串。`,
    prompt: `小说文本：
${storyText.slice(0, 4000)}

故事摘要：${analysis.summary}
核心冲突：${analysis.mainConflict}
关键时间线：${analysis.timeline.join(' → ')}

可用角色：
${characterList}

可用场景：
${locationList}

请将故事拆分为连续的分镜镜头。要求：
- 同一场景的连续镜头保持动作和情绪的连贯
- 人物朝向符合180度规则
- timeline 每秒必须有具体、微小、可拍摄的身体动作变化
- duration 要根据动作复杂度调整（3-15秒）
- environment 必须包含背景动态、光线、情绪、风格
- 使用专业镜头术语
- locationId 和 characterIds 必须使用提供的 UUID
- narrative 必须交织画面动作 + 角色对白（中文引号「」、标明说话者与语气）+ 关键环境音效，让生成的视频带对话/环境音频`,
  }
}
