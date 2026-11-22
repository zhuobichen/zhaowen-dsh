/**
 * 条目性质判定：这条到底是「风格」还是「方法/工程/素材」。
 *
 * 故意做成**规则打分**（0 token、毫秒级），不用模型：
 *   - 风格 = 能指着它说「照这个样子做」：有配色/字号/圆角/CSS 这类可抄的参数，或有视觉样张；
 *   - 方法 = 讲流程、工程、选型、规范、复刻步骤的（OpenMotion 的渲染栈、参考片重构…）；
 *   - 素材 = 项目/站点/截图集，能当参照但本身不是一套样式。
 *
 * 兜底原则：判不准就往「素材」放，别把方法混进风格里。
 */

const STYLE_TAGS = [
  '风格', '网页风格', 'App 风格', '主题', '版式', '海报', '排版哲学', '中文版式', '风格库', '配色',
  '视频风格', '动效风格', '界面范式', '范式', 'App 原型', '设计语言', '样张',
]
/** 标签里出现这些词就算「风格」信号（'方法层' 除外） */
const STYLE_TAG_RE = /风格|范式|版式|配色|主题/
const METHOD_TAG_RE = /^(?!方法层$)(方法|工程|流程|规范|理论|复刻|拆解|渲染|选型|对比|管线|链路|引擎)/
const METHOD_TAGS = ['方法', '工程', '渲染', '复刻', '拆解', '规范', '理论', '流程', '对比', '选型', '方法层', 'Motion.md', 'HTML 即视频', '开源']

const STYLE_NAME = /风格|主义|式|玻璃|面板|卡片|版式|海报|排版|配色|主题|typography|brutalism|bento|swiss|claymation|ink|flat-vector|blueprint|exploded|brick|portrait|isometric/i
const METHOD_NAME = /方法|流程|重构|渲染栈|工程|模板库|什么时候|选型|对比|规范|理论|文档|哲学|SKILL|README|管线|链路/i

const CSS_HINT = /\b\d+px\b|#[0-9a-f]{3,8}\b|border-radius|font-size|letter-spacing|line-height|backdrop-filter|oklch|grid-template|flex|box-shadow|padding/i

export function classifyEntry(entry) {
  let score = 0
  const why = []

  // ① 有没有「可抄的参数」
  if (entry.style && typeof entry.style === 'object') {
    score += 3
    why.push('有颜色/圆角令牌 +3')
  }
  if (entry.kind === 'demo') {
    score += 3
    why.push('有可播放预览 +3')
  }
  if (entry.kind === 'tokens') {
    score += 3
    why.push('是 token 表 +3')
  }

  // ② 标签
  const tags = Array.isArray(entry.tags) ? entry.tags : []
  const styleHits = tags.filter((t) => STYLE_TAGS.includes(t) || STYLE_TAG_RE.test(t)).length
  const methodHits = tags.filter((t) => METHOD_TAGS.includes(t) || METHOD_TAG_RE.test(t)).length
  if (styleHits > 0) {
    score += Math.min(2, styleHits)
    why.push(`风格标签 ${styleHits} 个 +${Math.min(2, styleHits)}`)
  }
  if (methodHits > 0) {
    score -= Math.min(3, methodHits * 1.5)
    why.push(`方法标签 ${methodHits} 个 -${Math.min(3, methodHits * 1.5)}`)
  }

  // ③ 分区风格库（huashu 那几区）：本身就是一个可挑的库，算风格
  if (/风格库|图库/.test(entry.name || '')) {
    score += 2
    why.push('分区风格库 +2')
  }

  // ④ 名字
  if (STYLE_NAME.test(entry.name || '')) {
    score += 1.5
    why.push('名字像风格 +1.5')
  }
  if (METHOD_NAME.test(entry.name || '')) {
    score -= 3
    why.push('名字像方法 -3')
  }

  // ④ 要点里有没有具体数值/属性（风格条目通常有）
  const bullets = (entry.bullets || []).join(' ')
  if (CSS_HINT.test(bullets)) {
    score += 2
    why.push('要点含具体参数 +2')
  }

  // ⑤ 视觉证据：有真样张/封面
  if (entry.cover || entry.coverUrl) {
    score += 1
    why.push('有视觉样张 +1')
  }

  // ⑥ 只有文字、没有样子、也没有参数 → 不像风格
  if (entry.kind === 'text' && !entry.swatch && !entry.cover) {
    score -= 1
    why.push('纯文字无样张 -1')
  }

  // ⑦ source 指向文档/SKILL/README 的，多半是方法
  if (/(SKILL\.md|README\.md|\/docs\/|design-.*\.md|design-philosophy)/i.test(String(entry.source || ''))) {
    score -= 1.5
    why.push('出处是文档 -1.5')
  }

  let nature = 'reference'
  if (score >= 2) nature = 'style'
  else if (score <= -1) nature = 'method'

  // 分区风格库（huashu 的六个区）：结构上就是「一排可挑的样式」，一律算风格
  if (/^fe-huasu-.*-zone$/.test(entry.id || '')) nature = 'style'

  return { nature, score: Math.round(score * 10) / 10, why }
}

/** 批量：返回带 nature 的副本（不改原对象）。 */
export function classifyAll(entries) {
  return entries.map((e) => {
    const r = classifyEntry(e)
    return { ...e, nature: r.nature, natureScore: r.score, natureWhy: r.why }
  })
}
