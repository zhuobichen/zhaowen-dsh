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

      // 卡片星数徽章：从 sources label 的「★ N」提取，GitHub 来源才显示
      function aibStarsOf(entry) {
        for (const s of (entry.sources || [])) {
          const m = String(s.label || '').match(/★\s*([\d.]+k?)/)
          if (m) return el('span', { className: 'aib-stars', title: 'GitHub stars' }, '★ ' + m[1])
        }
        return null
      }

    let styleDone = false
    function useStyleOnce() {
      if (styleDone) return
      styleDone = true
      try {
        // 旧版浅色样式用的是 data-aiwb="1"，必须先删掉，否则界面停在旧皮肤
        const old = document.querySelector('style[data-aiwb="1"]')
        if (old) old.remove()
        if (document.querySelector('style[data-aiwb="y2k"]')) return
        const tag = document.createElement('style')
        tag.setAttribute('data-aiwb', 'y2k')
        const css = `
          /* ── Y2K 铬金属 / Chrome Future Retro ─────────────────────────── */
.aib-stars{font-family:ui-monospace,Consolas,monospace;font-size:10px;color:#fbbf24;border:1px solid rgba(251,191,36,.4);border-radius:999px;padding:0 6px;}
          .aib-wrap{--aib-ink:#e8f2ff;--aib-sub:#8ba8cc;--aib-line:rgba(120,170,240,.22);--aib-brand:#7dd3ff;--aib-glass:rgba(16,28,56,.78);
            display:flex;flex-direction:column;gap:14px;padding:18px 20px 44px;height:100%;overflow:auto;overflow-x:hidden;box-sizing:border-box;font-size:13px;color:var(--aib-ink);
            background-color:#060b1c;
            background-image:linear-gradient(rgba(90,140,220,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(90,140,220,.08) 1px,transparent 1px),radial-gradient(900px 400px at 20% 0%,rgba(60,100,200,.22),transparent 70%);
            background-size:34px 34px,34px 34px,auto;}
          .aib-hero{position:relative;display:flex;gap:18px;align-items:center;padding:18px 20px;border-radius:14px;overflow:hidden;
            background:linear-gradient(115deg,rgba(20,34,72,.85),rgba(8,16,40,.9));border:1px solid rgba(125,211,255,.28);}
          .aib-hero:after{content:"";position:absolute;right:-60px;top:-90px;width:300px;height:300px;border-radius:50%;border:1px solid rgba(125,211,255,.16);pointer-events:none;}
          .aib-hero-art{flex:0 0 118px;height:92px;filter:drop-shadow(0 0 6px rgba(125,211,255,.55));}
          .aib-kicker{font-family:ui-monospace,Consolas,monospace;font-size:10px;letter-spacing:.24em;color:#79b8ff;text-shadow:0 0 8px rgba(80,160,255,.6);}
          .aib-title{font-size:30px;font-weight:900;letter-spacing:.02em;margin:3px 0 5px;
            background:linear-gradient(180deg,#ffffff 0%,#d8eaff 28%,#5b8fd6 47%,#ffffff 54%,#a8d4ff 74%,#4a76bd 100%);
            -webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 12px rgba(125,211,255,.45));}
          .aib-line{font-size:12px;color:var(--aib-sub);}
          .aib-metrics{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:11px;color:var(--aib-sub);}
          .aib-metrics b{font-family:ui-monospace,Consolas,monospace;font-size:15px;color:#bfe9ff;margin-right:3px;text-shadow:0 0 8px rgba(125,211,255,.5);}
          .aib-subbar{display:flex;gap:8px;flex-wrap:wrap;}
          .aib-sw-title{font-size:11px;color:var(--aib-sub);margin-right:2px;}
          .aib-sub{display:flex;align-items:center;gap:8px;padding:8px 15px;border-radius:999px;border:1px solid rgba(125,211,255,.3);
            background:rgba(16,28,56,.7);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);cursor:pointer;font-size:13px;font-weight:600;color:var(--aib-ink);}
          .aib-sub:hover{border-color:rgba(125,211,255,.6);}
          .aib-sub-on{border-color:#7dd3ff;background:linear-gradient(180deg,rgba(125,211,255,.28),rgba(40,90,160,.25));color:#fff;box-shadow:0 0 14px rgba(125,211,255,.4);}
          .aib-sub-n{font-family:ui-monospace,Consolas,monospace;font-size:11px;opacity:.8;}
          .aib-layerbar{display:flex;gap:7px;flex-wrap:wrap;}
          .aib-chip{padding:3px 11px;border-radius:999px;border:1px solid var(--aib-line);background:rgba(16,28,56,.6);color:var(--aib-sub);cursor:pointer;font-size:11.5px;}
          .aib-chip:hover{border-color:rgba(125,211,255,.5);color:#cfeaff;}
          .aib-chip-on{background:rgba(125,211,255,.2);border-color:#7dd3ff;color:#eaf8ff;box-shadow:0 0 10px rgba(125,211,255,.3);}
          .aib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(290px,100%),1fr));gap:11px;}
          .aib-card{border:1px solid rgba(120,170,240,.2);border-radius:12px;background:linear-gradient(155deg,rgba(22,38,78,.8),rgba(10,18,42,.82));backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
            padding:13px 14px;display:flex;flex-direction:column;gap:7px;cursor:pointer;text-align:left;font:inherit;color:inherit;position:relative;overflow:hidden;}
          .aib-card:hover{border-color:rgba(125,211,255,.62);box-shadow:0 8px 24px rgba(30,70,150,.3),0 0 0 1px rgba(125,211,255,.18);transform:translateY(-2px);transition:.16s;}
          .aib-card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--aib-tone,var(--aib-brand));box-shadow:0 0 10px var(--aib-tone,var(--aib-brand));}
          .aib-card-name{font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:#f0f7ff;}
          .aib-origin{font-size:10px;padding:0 6px;border-radius:999px;border:1px solid rgba(125,211,255,.28);color:#8fc6e8;}
          .aib-stars{font-size:10px;color:#fbbf24;background:rgba(251,191,36,.10);border:1px solid rgba(251,191,36,.35);border-radius:999px;padding:0 6px;white-space:nowrap;}
          .aib-line2{font-size:11.5px;color:#9fb6d4;line-height:1.5;}
          .aib-tags{display:flex;gap:5px;flex-wrap:wrap;}
          .aib-tag{font-size:10px;padding:0 6px;border-radius:999px;border:1px solid var(--aib-line);color:#8fb0d4;background:rgba(125,211,255,.05);}
          .aib-modal{position:fixed;inset:0;z-index:9000;background:rgba(4,8,22,.66);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:24px;}
          .aib-modal-card{background:linear-gradient(155deg,#142250,#0a1330);border:1px solid rgba(125,211,255,.3);box-shadow:0 24px 70px rgba(0,0,0,.6),0 0 40px rgba(60,110,200,.18);
            border-radius:14px;width:min(860px,100%);max-height:88vh;overflow:auto;padding:18px 20px;display:flex;flex-direction:column;gap:12px;color:var(--aib-ink);}
          .aib-pre{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.6;background:rgba(4,10,28,.72);border:1px solid rgba(125,211,255,.2);border-radius:8px;padding:10px;max-height:300px;overflow:auto;color:#bfe4ff;}
          .aib-btn{font-family:inherit;font-size:12px;padding:5px 12px;border-radius:8px;border:1px solid rgba(125,211,255,.3);background:rgba(16,28,56,.7);color:var(--aib-ink);cursor:pointer;}
          .aib-btn:hover{border-color:#7dd3ff;}
          .aib-btn-primary{background:linear-gradient(180deg,rgba(125,211,255,.3),rgba(40,90,160,.3));border-color:#7dd3ff;color:#fff;box-shadow:0 0 12px rgba(125,211,255,.28);}
          .aib-close{margin-left:auto;width:26px;height:26px;border-radius:50%;border:1px solid rgba(125,211,255,.3);background:rgba(16,28,56,.6);color:#cfe8ff;cursor:pointer;}
          .aib-muted{font-size:11.5px;color:#93aed0;}
          .aib-empty{border:1px dashed rgba(125,211,255,.25);border-radius:9px;padding:14px;color:var(--aib-sub);font-size:12px;background:rgba(16,28,56,.4);}
          .aib-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:9600;background:rgba(16,30,64,.95);color:#d8f0ff;border:1px solid rgba(125,211,255,.4);font-size:12px;padding:6px 14px;border-radius:999px;box-shadow:0 0 18px rgba(125,211,255,.25);}
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

    // 从 sources 的 label 里取「★ N stars」，卡片上直接显示星数
    function starOf(entry) {
      for (const src of (entry.sources || [])) {
        const m = String(src.label || '').match(/★\s*([\d.]+k?)/)
        if (m) return '★ ' + m[1]
      }
      return ''
    }


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
            h('svg', { viewBox: '0 0 118 92', width: '100%', height: '100%', 'aria-hidden': 'true' },
              h('defs', null,
                h('linearGradient', { id: 'aib-chrome', x1: '0', y1: '0', x2: '0', y2: '1' },
                  h('stop', { offset: '0%', 'stop-color': '#ffffff' }),
                  h('stop', { offset: '30%', 'stop-color': '#d8eaff' }),
                  h('stop', { offset: '48%', 'stop-color': '#4a76bd' }),
                  h('stop', { offset: '56%', 'stop-color': '#ffffff' }),
                  h('stop', { offset: '100%', 'stop-color': '#6fa8e8' }),
                ),
              ),
              h('ellipse', { cx: 78, cy: 30, rx: 30, ry: 11, fill: 'none', stroke: 'rgba(125,211,255,.45)', 'stroke-width': 1.4, transform: 'rotate(-22 78 30)' }),
              h('ellipse', { cx: 78, cy: 30, rx: 20, ry: 7, fill: 'none', stroke: 'rgba(125,211,255,.22)', 'stroke-width': 1, transform: 'rotate(-22 78 30)' }),
              h('path', { d: 'M26 18 L29 33 L44 36 L29 39 L26 54 L23 39 L8 36 L23 33 Z', fill: 'url(#aib-chrome)' }),
              h('path', { d: 'M96 56 L97.5 62 L103 63.5 L97.5 65 L96 71 L94.5 65 L89 63.5 L94.5 62 Z', fill: 'url(#aib-chrome)', opacity: '.85' }),
              h('text', { x: 8, y: 86, fill: 'url(#aib-chrome)', 'font-size': 14, 'font-weight': 900, 'font-family': 'Arial, sans-serif', 'letter-spacing': '2' }, 'AI // WB'),
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
              h('span', { className: 'aib-origin' }, e.origin === 'referenced' ? '引用' : '自制'),
              aibStarsOf(e),
            ),
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
      // 隐式工作台开关（无 UI）：localStorage 里写 dsh-workbench-off 即可关掉某个 tab；默认全开
      try {
        const _off = JSON.parse(window.localStorage.getItem('dsh-workbench-off') || '{}');
        if (_off['ai-workbench'] === true) return;
      } catch (e) { /* localStorage 不可用就当全开 */ }
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view', id: 'ai-workbench', order: 22, label: () => TITLE,
        }, Workbench))
      },
    }
  },
})
