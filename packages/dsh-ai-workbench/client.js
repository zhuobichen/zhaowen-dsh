/**
 * dsh-ai-workbench · 浏览器半边
 *
 * 嵌套结构：AI 工作台（tab）→ 子工作台（目前 Agent 设计）→ 分类 → 条目卡片。
 * 数据从 /ai-workbench/state 读，与 ai_style 工具同一份。
 */
window.__ModuleLoader__.load({
  id: '@zhuobichen/dsh-ai-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const TITLE = 'AI 工作台'
    const ENDPOINT = '/ai-workbench/state'

    const COPY = {
      kicker: 'AI WORKBENCH // SUB-WORKBENCHES',
      title: 'AI 工作台',
      line: '嵌套小工作台 · 每块都能被引擎读到',
      foot: '点卡片看细节 · 复制引用粘给 AI · AI 用 ai_style op=get 读规格',
      empty: '这个分类里还没有条目。',
    }

    const SECTION_DESC = {
      agent: '怎么设计一个好 Agent：架构模式 / Skill 设计 / 上下文工程 / 评估安全',
    }

    const LAYER_ICON = { pattern: '◇', skill: '◈', context: '◎', eval: '⊕', local: '⌂' }

    let styleDone = false
    function useStyleOnce() {
      if (styleDone) return
      styleDone = true
      try {
        if (document.querySelector('style[data-aiwb]')) return
        const tag = document.createElement('style')
        tag.setAttribute('data-aiwb', '1')
        const css = `
          .aib-wrap{--aib-ink:#1b2440;--aib-sub:#5c6b8a;--aib-line:rgba(60,80,130,.16);--aib-brand:#4f46e5;
            display:flex;flex-direction:column;gap:13px;padding:16px 18px 40px;height:100%;overflow:auto;overflow-x:hidden;box-sizing:border-box;font-size:13px;color:var(--aib-ink);}
          .aib-hero{display:flex;gap:16px;align-items:center;padding:14px 16px;border-radius:12px;background:linear-gradient(115deg,#eef2ff,#f5f3ff 55%,#ecfeff);border:1px solid var(--aib-line);}
          .aib-hero-art{flex:0 0 110px;height:78px;}
          .aib-kicker{font-family:ui-monospace,Consolas,monospace;font-size:10px;letter-spacing:.2em;color:var(--aib-brand);}
          .aib-title{font-size:24px;font-weight:800;margin:3px 0 4px;background:linear-gradient(92deg,#1e293b,#4f46e5 60%,#0891b2);-webkit-background-clip:text;background-clip:text;color:transparent;}
          .aib-line{font-size:12px;color:var(--aib-sub);}
          .aib-metrics{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:11px;color:var(--aib-sub);}
          .aib-metrics b{font-family:ui-monospace,Consolas,monospace;font-size:15px;color:var(--aib-ink);margin-right:3px;}
          .aib-subbar{display:flex;gap:8px;flex-wrap:wrap;}
          .aib-sub{display:flex;align-items:center;gap:8px;padding:8px 13px;border-radius:9px;border:1px solid var(--aib-line);background:#fff;cursor:pointer;font-size:13px;font-weight:600;}
          .aib-sub-on{border-color:var(--aib-brand);background:var(--aib-brand);color:#fff;}
          .aib-sub-n{font-family:ui-monospace,Consolas,monospace;font-size:11px;opacity:.75;}
          .aib-layerbar{display:flex;gap:6px;flex-wrap:wrap;}
          .aib-chip{padding:2px 10px;border-radius:999px;border:1px solid var(--aib-line);background:transparent;color:var(--aib-sub);cursor:pointer;font-size:11.5px;}
          .aib-chip:hover{background:rgba(79,70,229,.06);}
          .aib-chip-on{background:var(--aib-brand);border-color:var(--aib-brand);color:#fff;}
          .aib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(290px,100%),1fr));gap:10px;}
          .aib-card{border:1px solid var(--aib-line);border-radius:10px;background:#fff;padding:12px 13px;display:flex;flex-direction:column;gap:7px;cursor:pointer;text-align:left;font:inherit;color:inherit;position:relative;overflow:hidden;}
          .aib-card:hover{border-color:var(--aib-brand);box-shadow:0 6px 18px rgba(79,70,229,.10);transform:translateY(-2px);transition:.15s;}
          .aib-card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--aib-tone,var(--aib-brand));}
          .aib-card-name{font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
          .aib-origin{font-size:10px;padding:0 6px;border-radius:999px;border:1px solid var(--aib-line);color:var(--aib-sub);}
          .aib-line2{font-size:11.5px;color:var(--aib-sub);line-height:1.5;}
          .aib-tags{display:flex;gap:5px;flex-wrap:wrap;}
          .aib-tag{font-size:10px;padding:0 6px;border-radius:999px;border:1px solid var(--aib-line);color:var(--aib-sub);}
          .aib-modal{position:fixed;inset:0;z-index:9000;background:rgba(15,20,40,.45);display:flex;align-items:center;justify-content:center;padding:24px;}
          .aib-modal-card{background:#fff;border-radius:12px;box-shadow:0 24px 64px rgba(15,20,40,.3);width:min(860px,100%);max-height:88vh;overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px;}
          .aib-pre{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.6;background:#f6f7fb;border:1px solid var(--aib-line);border-radius:7px;padding:10px;max-height:300px;overflow:auto;}
          .aib-btn{font-family:inherit;font-size:12px;padding:4px 11px;border-radius:7px;border:1px solid var(--aib-line);background:#fff;cursor:pointer;}
          .aib-btn-primary{background:var(--aib-brand);color:#fff;border-color:var(--aib-brand);}
          .aib-close{margin-left:auto;width:26px;height:26px;border-radius:50%;border:1px solid var(--aib-line);background:transparent;cursor:pointer;}
          .aib-muted{font-size:11.5px;color:var(--aib-sub);}
          .aib-empty{border:1px dashed var(--aib-line);border-radius:9px;padding:14px;color:var(--aib-sub);font-size:12px;}
          .aib-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:9600;background:#1e293b;color:#fff;font-size:12px;padding:6px 14px;border-radius:999px;}
        `
        tag.textContent = css
        document.head.appendChild(tag)
      } catch (e) { /* 样式失败不影响功能 */ }
    }

    function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false)
      } catch (e) { /* fall through */ }
      return Promise.resolve(false)
    }

    const TONES = ['#4f46e5', '#0891b2', '#7c3aed', '#059669', '#d97706']

    function Workbench() {
      useStyleOnce()
      const [state, setState] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [sectionId, setSectionId] = React.useState('')
      const [layerId, setLayerId] = React.useState('')
      const [openId, setOpenId] = React.useState('')
      const [toast, setToast] = React.useState('')

      const load = () => {
        fetch(ENDPOINT, { cache: 'no-store' })
          .then((r) => r.json())
          .then((j) => { if (!j || j.ok !== true) { setErr((j && j.error) || '状态接口异常'); return } setErr(''); setState(j) })
          .catch((e) => setErr(String((e && e.message) || e)))
      }
      React.useEffect(() => { load() }, [])

      const copy = (text, what) => copyText(text).then((ok) => {
        setToast(ok ? what + ' 已复制' : '复制被拦了：手动选中上面那段')
        setTimeout(() => setToast(''), 2400)
      })

      const sections = (state && state.sections) || []
      const section = sections.find((s) => s.id === sectionId) || sections[0] || null
      const layers = section ? section.layers : []
      const layer = layers.find((l) => l.id === layerId) || layers[0] || null
      const entries = layer ? layer.entries : []

      const open = (function () {
        for (const s of sections) for (const l of s.layers) {
          const e = l.entries.find((x) => x.id === openId)
          if (e) return e
        }
        return null
      })()

      const refText = (e) => [
        `用 AI 工作台里的「${e.name}」（${section ? section.name : ''} · ${layer ? layer.name : ''} · ${e.id}），按这个来做。`,
        (e.sources || []).find((s) => s.url || s.path) ? `原始材料：${(e.sources || []).find((s) => s.url || s.path).url || (e.sources || []).find((s) => s.url || s.path).path}` : '',
        `要看完整规格：ai_style op=get ${e.id}`,
      ].filter(Boolean).join('\n')

      return h('div', { className: 'aib-wrap' },
        h('div', { className: 'aib-hero' },
          h('div', { className: 'aib-hero-art' },
            h('svg', { viewBox: '0 0 110 78', width: '100%', height: '100%', 'aria-hidden': 'true' },
              h('rect', { x: 8, y: 8, width: 94, height: 62, rx: 8, fill: '#1e293b' }),
              h('circle', { cx: 22, cy: 20, r: 3, fill: '#f87171' }),
              h('circle', { cx: 33, cy: 20, r: 3, fill: '#fbbf24' }),
              h('circle', { cx: 44, cy: 20, r: 3, fill: '#34d399' }),
              h('rect', { x: 18, y: 34, width: 40, height: 5, rx: 2, fill: '#818cf8' }),
              h('rect', { x: 18, y: 46, width: 66, height: 5, rx: 2, fill: '#22d3ee' }),
              h('rect', { x: 18, y: 58, width: 52, height: 5, rx: 2, fill: '#475569' }),
            ),
          ),
          h('div', null,
            h('div', { className: 'aib-kicker' }, COPY.kicker),
            h('div', { className: 'aib-title' }, COPY.title),
            h('div', { className: 'aib-line' }, COPY.line),
            h('div', { className: 'aib-metrics' },
              h('span', null, h('b', null, String(sections.length)), ' 个小工作台'),
              h('span', null, h('b', null, String(state ? state.total : 0)), ' 条资料'),
              h('span', null, h('b', null, 'ai_style'), ' AI 通道'),
            ),
          ),
        ),

        err ? h('div', { className: 'aib-empty' }, '接口报错：' + err) : null,
        !state ? h('div', { className: 'aib-empty' }, '读取中…') : null,

        // 子工作台选择器（嵌套第一层）
        h('div', { className: 'aib-subbar' },
          sections.map((s) => h('button', {
            key: s.id, type: 'button',
            className: 'aib-sub' + (section && section.id === s.id ? ' aib-sub-on' : ''),
            onClick: () => { setSectionId(s.id); setLayerId('') },
            title: s.hint,
          }, s.name, h('span', { className: 'aib-sub-n' }, String(s.layers.reduce((n, l) => n + l.entries.length, 0))))),
        ),

        section ? h('div', { className: 'aib-muted' }, SECTION_DESC[section.id] || section.hint) : null,

        // 分类（嵌套第二层）
        h('div', { className: 'aib-layerbar' },
          layers.map((l, i) => h('button', {
            key: l.id, type: 'button',
            className: 'aib-chip' + (layer && layer.id === l.id ? ' aib-chip-on' : ''),
            onClick: () => setLayerId(l.id),
          }, (LAYER_ICON[l.id] || '·') + ' ' + l.name + ' ' + l.entries.length)),
        ),

        h('div', { className: 'aib-grid' },
          entries.map((e, i) => h('button', {
            key: e.id, type: 'button',
            className: 'aib-card',
            style: { '--aib-tone': TONES[i % TONES.length] },
            onClick: () => setOpenId(e.id),
          },
            h('div', { className: 'aib-card-name' }, e.name,
              h('span', { className: 'aib-origin' }, e.origin === 'referenced' ? '引用' : '自制')),
            h('div', { className: 'aib-line2' }, e.oneLine),
            h('div', { className: 'aib-tags' }, (e.tags || []).map((t) => h('span', { key: t, className: 'aib-tag' }, t))),
          )),
        ),
        entries.length === 0 ? h('div', { className: 'aib-empty' }, COPY.empty) : null,

        // 详情弹层
        open ? h('div', { className: 'aib-modal', onClick: (ev) => { if (ev.target === ev.currentTarget) setOpenId('') } },
          h('div', { className: 'aib-modal-card' },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('b', { style: { fontSize: 15 } }, open.name),
              h('button', { className: 'aib-close', onClick: () => setOpenId(''), title: '关闭' }, '×'),
            ),
            h('div', { className: 'aib-muted' }, open.oneLine),
            h('div', { className: 'aib-muted' }, '出处：' + open.source),
            h('div', { style: { fontSize: 12, fontWeight: 600 } }, '要点'),
            h('ul', { style: { margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.8 } }, (open.bullets || []).map((b, i) => h('li', { key: i }, b))),
            h('div', { className: 'aib-muted' }, '怎么用：' + open.howto),
            (open.sources || []).length > 0 ? h('div', null,
              h('div', { style: { fontSize: 12, fontWeight: 600 } }, '原始材料'),
              (open.sources || []).map((s, i) => h('div', { key: i, className: 'aib-muted' }, `${s.label}：${s.url || s.path}`)),
            ) : null,
            h('pre', { className: 'aib-pre' }, refText(open)),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              h('button', { className: 'aib-btn aib-btn-primary', onClick: () => copy(refText(open), '引用') }, '复制引用（索引）'),
              h('button', { className: 'aib-btn', onClick: () => setOpenId('') }, '关闭'),
            ),
          ),
        ) : null,

        toast ? h('div', { className: 'aib-toast' }, toast) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view', id: 'ai-workbench', order: 22, label: () => TITLE,
        }, Workbench))
      },
    }
  },
})
