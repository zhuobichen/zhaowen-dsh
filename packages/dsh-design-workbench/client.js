/**
 * dsh-design-workbench · 浏览器半身
 *
 * 注册「设计工作台」标签，和「对话 / 轨迹 / 破甲工作台 / …」并排。
 *
 * 它要解决的问题很具体：**用户想说「我要那种风格」时，不该再去翻代码。**
 * 所以这里做三件事：
 *   ① 同一块迷你界面，用不同样式渲染 → 可以真正横向比；
 *   ② 点一下就能把「引用给 AI」的整段文本复制走；
 *   ③ 「选中它」落一条记录，AI 用 design_style 工具就能读到，不用用户复述。
 *
 * ⚠ 客户端 ABI 是 `window.__ModuleLoader__.load({id, factory})` 信封，少这层会报
 *   「loaded without registering "..." via __ModuleLoader__.load」。
 *   预览一律用 sandbox 的 iframe + srcDoc，样式互不污染，也不去读别人的 DOM。
 */
window.__ModuleLoader__.load({
  id: 'dsh-design-workbench',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports

    const react = require('react')

    const PLUGIN_ID = 'dsh-design-workbench'
    const TAB_LABEL = '设计工作台'
    const PANEL_ID = 'design-workbench-main'
    const API = '/design-workbench'

    // ── 预览模具 ──────────────────────────────────────────────────────
    //
    // 同一块界面（标题 + 计数 pill + 两行列表 + 一个输入框），只换 token。
    // 这样"比"才有意义：看到的是同一个界面在不同风格下的样子。
    function previewHtml(style, big) {
      const c = style.colors
      const s = style.shape
      const layout = style.layout
      const mono = s.mono
      const pad = Math.max(4, Math.min(8, s.density))  // 上限 8：迷你界面里密度差异靠其它线索体现，别把内容顶出框
      const radius = s.radius
      const radiusSm = s.radiusSm
      const shadow = s.shadow === 'none' ? 'none' : s.shadow
      const muted = c.muted
      const line = '1px solid ' + c.border
      const isGlass = layout === 'glass'
      const isDark = isGlass

      const pill = (text) =>
        `<span style="display:inline-flex;align-items:center;padding:0 7px;border-radius:999px;` +
        `border:1px solid ${c.border};color:${muted};font-size:10.5px;line-height:17px;white-space:nowrap">${text}</span>`

      /** 一行「id + 若干 pill + 状态」；行间用虚线，和破甲工作台一致。 */
      const row = (id, tags, live) =>
        `<div style="display:flex;align-items:center;gap:7px;padding:${pad}px 0;` +
        `border-bottom:1px dashed ${c.border};font-size:12px;color:${c.text};min-width:0">` +
        `<span style="font-family:${mono};font-size:11px;color:${muted};white-space:nowrap">${id}</span>` +
        `<span style="display:inline-flex;gap:5px;flex:0 1 auto;min-width:0;overflow:hidden">${tags.map(pill).join('')}</span>` +
        `<span style="margin-left:auto;flex:0 0 auto;white-space:nowrap;font-size:11px;color:${live ? c.ok : muted}">${live ? '● 运行中' : '○ 休眠'}</span>` +
        `</div>`

      /** 极简单行的三种真实用法（月相 / 余额 / 状态），不是一个空框。 */
      const simpleRow = (label, value, tag, color) =>
        `<div style="display:flex;align-items:center;gap:8px;padding:${pad + 2}px 0;font-size:12px;color:${muted}">` +
        `<span>${label}</span>` +
        `<span style="color:${color || muted};font-family:${mono};font-size:11.5px">${value}</span>` +
        (tag ? pill(tag) : '') +
        `</div>`

      const header =
        `<div style="display:flex;align-items:center;gap:7px;flex-wrap:nowrap;min-width:0">` +
        `<b style="font-size:${layout === 'row' ? 12.5 : 14.5}px;color:${c.text};white-space:nowrap">${layout === 'row' ? '月相 · 四月初七' : '工作台'}</b>` +
        (layout === 'row' ? '' : pill('规则 3') + pill('运行中 1')) +
        `<span style="margin-left:auto;font-size:11px;color:${muted};white-space:nowrap">21:04</span>` +
        `<span style="padding:1px 9px;border-radius:${radiusSm};border:1px solid ${c.border};font-size:11.5px;color:${c.text};white-space:nowrap">刷新</span>` +
        `</div>`

      const card = (rows) =>
        `<div style="border:${line};border-radius:${radius};padding:${pad + 2}px ${pad + 5}px;box-shadow:${shadow};background:${c.surface};min-height:0">` +
        `<div style="display:flex;align-items:baseline;gap:7px">` +
        `<b style="font-size:12px;color:${c.text}">被改过的会话</b>` +
        `<span style="font-size:10.5px;color:${muted}">点开看注入原文</span>` +
        `</div>` +
        rows +
        `</div>`

      const composer =
        `<div style="display:flex;align-items:center;gap:7px;margin-top:auto">` +
        `<div style="flex:1;border:${line};border-radius:${radiusSm};padding:4px ${pad}px;font-size:11.5px;color:${muted};background:${isDark ? 'rgba(255,255,255,.06)' : 'transparent'}">给这个面板加一条…</div>` +
        `<span style="padding:3px 11px;border-radius:${radiusSm};background:${c.accent};color:#fff;font-size:11.5px">确定</span>` +
        `</div>`

      const logs =
        `<div style="display:flex;flex-direction:column;gap:1px;min-height:0;overflow:hidden">` +
        [
          ['21:04:11', 'inject', 'session-…9fde4a  chars=746', c.ok],
          ['21:03:02', 'pick', 'design-workbench', c.accent],
          ['20:58:40', 'boot', '破甲工具台已加载', muted],
          ['20:57:12', 'set_model', 'session-…7c2a3c → flash', c.warn],
        ]
          .map(
            (l) =>
              `<div style="display:flex;gap:8px;font-family:${mono};font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">` +
              `<span style="color:${muted}">${l[0]}</span>` +
              `<span style="color:${l[3]};min-width:52px">${l[1]}</span>` +
              `<span style="color:${muted};overflow:hidden;text-overflow:ellipsis">${l[2]}</span>` +
              `</div>`,
          )
          .join('') +
        `</div>`

      /** 大图里补一块「最近操作」：把 300px 的详情框填满，也更接近真实面板。 */
      const recentBlock = () =>
        `<div style="border:${line};border-radius:${radius};padding:${pad + 2}px ${pad + 5}px;background:${c.surface}">` +
        `<b style="font-size:12px;color:${c.text}">最近操作</b>` +
        `<div style="display:flex;flex-direction:column;gap:1px;margin-top:3px">` +
        [
          ['21:04:11', 'inject', 'session-…9fde4a  chars=746', c.ok],
          ['21:03:02', 'pick', 'design-workbench  dash-compact', c.accent],
        ]
          .map(
            (l) =>
              `<div style="display:flex;gap:8px;font-family:${mono};font-size:10.5px;white-space:nowrap;overflow:hidden">` +
              `<span style="color:${muted}">${l[0]}</span>` +
              `<span style="color:${l[3]};min-width:48px">${l[1]}</span>` +
              `<span style="color:${muted};overflow:hidden;text-overflow:ellipsis">${l[2]}</span>` +
              `</div>`,
          )
          .join('') +
        `</div></div>`

      // 抽屉：左边压一块"主内容"，右边才是抽屉本身 —— 影子朝左才看得见。
      const drawer =
        `<div style="display:flex;flex:1;min-height:0;align-items:stretch">` +
        `<div style="flex:1;border:1px dashed ${c.border};border-radius:${radius};margin:0 6px 0 0;` +
        `display:flex;align-items:center;justify-content:center;font-size:10.5px;color:${muted}">主内容</div>` +
        `<div style="width:60%;background:${c.bg};border-left:1px solid ${c.border};box-shadow:${shadow};` +
        `border-radius:${radius} 0 0 ${radius};padding:${pad + 3}px ${pad + 5}px;display:flex;flex-direction:column;gap:4px">` +
        `<b style="font-size:12px;color:${c.text}">读书窗格</b>` +
        `<div style="font-size:${big ? 11 : 10.5}px;color:${muted};line-height:1.6">他把书签夹回第三卷，窗外的雨刚好停。</div>` +
        (big ? `<div style="font-size:11px;color:${muted};line-height:1.6">这一页读了两遍，还是没记住那个名字。</div>` : '') +
        `</div>` +
        `</div>`

      /** 大图里时间线/单行条下方会空出一截，用一句说明把它收住。 */
      const footNote = !big
        ? ''
        : `<div style="margin-top:auto;padding-top:5px;border-top:1px solid ${c.border};font-size:10.5px;color:${muted}">` +
          `${
            layout === 'timeline'
              ? '共 1,284 条 · 这里只画最近 4 条，长文本一律省略号'
              : '常驻在输入框上方一行：默认不抢视线，hover 才提亮'
          }</div>`

      let content
      if (layout === 'row') {
        content =
          header +
          simpleRow('月相', '四月初七 · 上弦', '月龄 7.2 天', c.text) +
          simpleRow('余额', '¥ 128.40', '今日 +2.10') +
          // 小图只放两行：120px 的卡片框里第三行会被裁掉
          (big ? simpleRow('状态', '一切正常', '● 在线', c.ok) + footNote : '')
      } else if (layout === 'timeline') {
        content = header + logs + footNote
      } else if (layout === 'drawer') {
        content = header + drawer
      } else if (layout === 'dashboard') {
        content =
          header +
          card(
            row('session-…9fde4a', ['注入 746 字'], true) +
              (big ? row('session-…7c2a3c', ['注入 0 字'], false) + row('session-…ec2d6e', ['注入 0 字'], false) : ''),
          ) +
          (big ? recentBlock() + composer : '')
      } else {
        content =
          header +
          card(
            // 小图只放一行：卡片框就 120px，宁可少一行也别被裁掉；
            // 大图（详情页 300px）放三行，把卡片撑满。
            // 玻璃卡是"小面积"风格：大图也只放两行，多了会把底部 composer 顶出框。
            row('session-…9fde4a', ['注入 746 字'], true) +
              (big
                ? row('session-…7c2a3c', ['注入 0 字'], false) + (layout === 'glass' ? '' : row('session-…ec2d6e', ['注入 0 字'], false))
                : ''),
          ) +
          (big ? recentBlock() + composer : '')
      }

      const body =
        `<div style="display:flex;flex-direction:column;gap:${Math.max(5, pad)}px;padding:${pad + 4}px ${pad + 6}px;` +
        `height:100%;box-sizing:border-box;background:${c.bg};color:${c.text};` +
        `font-family:${s.font};font-size:12px;line-height:1.45;overflow:hidden;` +
        `${isGlass ? 'backdrop-filter:blur(10px);' : ''}">` +
        content +
        `</div>`

      return (
        '<!doctype html><html><head><meta charset="utf-8"><style>' +
        'html,body{margin:0;padding:0;height:100%;background:transparent}*{box-sizing:border-box}' +
        '</style></head><body>' +
        body +
        '</body></html>'
      )
    }

    const PREVIEW_FRAME = { width: '100%', height: 120, border: '0', display: 'block', background: 'transparent' }
    const PREVIEW_FRAME_BIG = { width: '100%', height: 300, border: '0', display: 'block', background: 'transparent' }

    // ── 面板 ──────────────────────────────────────────────────────────
    function apply(ctx) {
      const el = react.createElement
      const useState = react.useState
      const useEffect = react.useEffect
      const useMemo = react.useMemo

      let styleDone = false
      function useStyleOnce() {
        if (styleDone) return
        styleDone = true
        try {
          const tag = document.createElement('style')
          tag.setAttribute('data-design-workbench', '1')
          tag.textContent = `
          .dw-wrap{display:flex;flex-direction:column;gap:12px;padding:16px 18px 40px;height:100%;overflow:auto;font-size:13px;color:var(--dsw-alias-label-primary);}
          .dw-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
          .dw-title{font-size:15px;font-weight:600;}
          .dw-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--dsw-alias-border-l2);}
          .dw-muted{color:var(--dsw-alias-label-tertiary);}
          .dw-btn{padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;}
          .dw-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));}
          .dw-btn-primary{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff;background:var(--dsw-alias-brand-primary,#4d6bfe);}
          .dw-search{flex:1;min-width:140px;max-width:280px;padding:4px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font-size:12px;}
          .dw-chips{display:flex;gap:6px;flex-wrap:wrap;}
          .dw-chip{padding:2px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);font-size:12px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);}
          .dw-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));}
          .dw-chip-on{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent;color:#fff;}
          .dw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;}
          .dw-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;background:var(--dsw-alias-bg-layer-1);}
          .dw-card:hover{border-color:var(--dsw-alias-border-l3);}
          .dw-card-on{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:-1px;}
          .dw-card-body{padding:9px 11px 10px;display:flex;flex-direction:column;gap:5px;}
          .dw-card-name{font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;}
          .dw-card-line{font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.45;}
          .dw-tags{display:flex;gap:5px;flex-wrap:wrap;}
          .dw-tag{font-size:10.5px;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);}
          .dw-detail{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-1);}
          .dw-detail-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
          .dw-two{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px;}
          @media (max-width:900px){.dw-two{grid-template-columns:1fr;}}
          .dw-pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.55;background:var(--dsw-alias-bg-layer-2);padding:9px 10px;border-radius:7px;max-height:300px;overflow:auto;}
          .dw-swatches{display:flex;gap:6px;flex-wrap:wrap;}
          .dw-swatch{width:60px;text-align:center;color:var(--dsw-alias-label-tertiary);}
          .dw-swatch-label{font-size:10.5px;}
          .dw-swatch-val{font-family:ui-monospace,Consolas,monospace;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
          .dw-swatch i{display:block;height:22px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2);margin-bottom:2px;}
          .dw-banner{display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);font-size:12.5px;flex-wrap:wrap;}
          .dw-toast{position:sticky;bottom:0;align-self:flex-start;padding:5px 12px;border-radius:999px;background:#22c55e;color:#fff;font-size:12px;}
          `
          tag.textContent = tag.textContent.replace(/^\s+/gm, '')
          document.head.appendChild(tag)
        } catch {
          /* 样式失败不影响功能 */
        }
      }

      function copyText(text) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
            return true
          }
        } catch {
          /* 落到下面的兜底 */
        }
        try {
          const ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
          return true
        } catch {
          return false
        }
      }

      function when(iso) {
        if (!iso) return '—'
        try {
          const d = new Date(iso)
          return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
        } catch {
          return String(iso)
        }
      }

      function Panel() {
        useStyleOnce()
        const [state, setState] = useState(null)
        const [err, setErr] = useState('')
        const [filter, setFilter] = useState('all')
        const [query, setQuery] = useState('')
        const [openId, setOpenId] = useState('')
        const [toast, setToast] = useState('')

        const load = function () {
          fetch(API + '/state', { cache: 'no-store' })
            .then(function (r) { return r.json() })
            .then(function (j) {
              if (!j || j.ok !== true) { setErr((j && j.error) || '状态接口返回异常'); return }
              setErr('')
              setState(j)
              setOpenId(function (cur) { return cur || (j.picked && j.picked.id) || '' })
            })
            .catch(function (e) { setErr(String((e && e.message) || e)) })
        }

        useEffect(function () { load() }, [])

        const styles = (state && state.styles) || []
        const chips = (state && state.filters) || []
        const picked = state && state.picked

        const shown = useMemo(function () {
          const q = query.trim().toLowerCase()
          return styles.filter(function (s) {
            if (filter !== 'all' && (s.tags || []).indexOf(filter) < 0) return false
            if (q === '') return true
            return (s.name + ' ' + s.oneLine + ' ' + (s.tags || []).join(' ') + ' ' + s.id).toLowerCase().indexOf(q) >= 0
          })
        }, [styles, filter, query])

        const open = styles.filter(function (s) { return s.id === openId })[0] || null

        const pickStyle = function (id) {
          fetch(API + '/pick', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: id }),
          })
            .then(function (r) { return r.json() })
            .then(function (j) {
              if (!j || j.ok !== true) { setErr((j && j.error) || '选中失败'); return }
              setErr('')
              setState(j)
              setToast('已选中「' + ((j.picked && j.picked.name) || id) + '」，AI 现在读得到')
              setTimeout(function () { setToast('') }, 2600)
            })
            .catch(function (e) { setErr(String((e && e.message) || e)) })
        }

        const copy = function (text, what) {
          const ok = copyText(text)
          setToast(ok ? what + ' 已复制' : '复制失败，手动选中下面的文本吧')
          setTimeout(function () { setToast('') }, 2400)
        }

        return el('div', { className: 'dw-wrap' },
          el('div', { className: 'dw-head' },
            el('div', { className: 'dw-title' }, TAB_LABEL),
            el('span', { className: 'dw-pill' }, '样式 ', el('b', null, String(styles.length))),
            el('span', { className: 'dw-pill' }, '来源 ', el('b', null, '全部取自本机代码')),
            picked
              ? el('span', { className: 'dw-pill' }, '当前 ', el('b', null, picked.name))
              : el('span', { className: 'dw-muted' }, '还没选样式'),
            el('input', {
              className: 'dw-search',
              placeholder: '搜样式名 / 用途 / 标签…',
              value: query,
              onChange: function (e) { setQuery(e.target.value) },
            }),
            el('button', { className: 'dw-btn', onClick: load }, '刷新'),
          ),

          err ? el('div', { className: 'dw-pill', style: { borderColor: '#ef4444', color: '#ef4444' } }, '接口报错：' + err) : null,

          el('div', { className: 'dw-chips' },
            chips.map(function (c) {
              return el('button', {
                key: c.id,
                className: 'dw-chip' + (filter === c.id ? ' dw-chip-on' : ''),
                onClick: function () { setFilter(c.id) },
              }, c.label)
            }),
            el('span', { className: 'dw-muted', style: { marginLeft: 'auto', fontSize: 11.5 } }, '点卡片看细节 · 「选中」= 让 AI 知道你要哪一种'),
          ),

          el('div', { className: 'dw-grid' },
            shown.map(function (s) {
              const isOn = picked && picked.id === s.id
              return el('div', {
                key: s.id,
                className: 'dw-card' + (isOn ? ' dw-card-on' : ''),
                onClick: function () { setOpenId(s.id) },
              },
                el('iframe', { srcDoc: previewHtml(s), sandbox: '', style: PREVIEW_FRAME, scrolling: 'no', title: s.name + ' 预览' }),
                el('div', { className: 'dw-card-body' },
                  el('div', { className: 'dw-card-name' },
                    s.name,
                    isOn ? el('span', { className: 'dw-tag', style: { color: 'var(--dsw-alias-brand-primary,#4d6bfe)' } }, '当前') : null,
                  ),
                  el('div', { className: 'dw-card-line' }, s.oneLine),
                  el('div', { className: 'dw-tags' },
                    (s.tags || []).map(function (t) { return el('span', { className: 'dw-tag', key: t }, t) }),
                  ),
                ),
              )
            }),
          ),

          shown.length === 0 ? el('div', { className: 'dw-muted' }, '没有匹配的样式，换个关键词或点「全部」。') : null,

          open ? el('div', { className: 'dw-detail' },
            el('div', { className: 'dw-detail-head' },
              el('b', { style: { fontSize: 14 } }, open.name),
              el('span', { className: 'dw-muted', style: { fontSize: 11.5 } }, open.id + ' · ' + open.source),
              el('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' } },
                el('button', { className: 'dw-btn dw-btn-primary', onClick: function () { pickStyle(open.id) } }, '选中它 → AI 可见'),
                el('button', { className: 'dw-btn', onClick: function () { copy(open.prompt, '「引用给 AI」') } }, '复制 引用给 AI'),
                el('button', { className: 'dw-btn', onClick: function () { copy(open.tokens.join('\n'), 'CSS') } }, '复制 CSS'),
              ),
            ),

            el('div', { className: 'dw-two' },
              el('div', null,
                el('iframe', { srcDoc: previewHtml(open, true), sandbox: '', style: PREVIEW_FRAME_BIG, scrolling: 'no', title: open.name + ' 大图' }),
                el('div', { className: 'dw-muted', style: { fontSize: 11, marginTop: 4 } },
                  '预览是同一块界面的换皮；实际落地时颜色应尽量用 var(--dsw-alias-*)，跟着主题走。'),
              ),
              el('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } },
                el('div', { className: 'dw-swatches' },
                  [['底', open.colors.bg], ['面', open.colors.surface], ['字', open.colors.text], ['次', open.colors.muted], ['强调', open.colors.accent], ['描边', open.colors.border]].map(function (p) {
                    return el('div', { className: 'dw-swatch', key: p[0], title: p[0] + ' ' + p[1] },
                      el('i', { style: { background: p[1] } }),
                      el('div', { className: 'dw-swatch-label' }, p[0]),
                      el('div', { className: 'dw-swatch-val' }, String(p[1]).replace('rgba(', '').replace(')', '')),
                    )
                  }),
                ),
                el('div', { style: { fontSize: 12, lineHeight: 1.6 } },
                  el('div', null, el('b', null, '圆角 '), open.shape.radius, '　', el('b', null, '小元素 '), open.shape.radiusSm),
                  el('div', null, el('b', null, '密度 '), open.shape.density + 'px 内边距', '　', el('b', null, '字体 '), open.shape.font),
                  el('div', { style: { fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 11, marginTop: 2 } }, open.shape.shadow),
                ),
                el('div', { style: { fontSize: 12, lineHeight: 1.6 } },
                  el('div', null, el('b', null, '适合：'), open.when),
                  el('div', { className: 'dw-muted' }, el('b', null, '别用在：'), open.avoid),
                ),
              ),
            ),

            el('div', null,
              el('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, '视觉手法'),
              el('div', { style: { fontSize: 12, lineHeight: 1.65 } }, (open.craft || []).map(function (x, i) {
                return el('div', { key: i }, '· ' + x)
              })),
            ),

            el('pre', { className: 'dw-pre' }, open.prompt),
          ) : null,

          picked ? el('div', { className: 'dw-banner' },
            el('span', null, '当前选用：', el('b', null, picked.name)),
            el('span', { className: 'dw-muted' }, when(picked.at) + ' · ' + (picked.by === 'user' ? '工作台里点的' : picked.by)),
            el('button', { className: 'dw-btn', onClick: function () { copy((state && state.pickedPrompt) || '', '当前样式的引用') } }, '复制引用'),
          ) : null,

          (state && state.recent && state.recent.length > 1) ? el('div', { className: 'dw-muted', style: { fontSize: 11.5 } },
            '最近：' + state.recent.slice(0, 6).map(function (r) { return r.name + '(' + when(r.at) + ')' }).join(' · ')) : null,

          toast ? el('div', { className: 'dw-toast' }, toast) : null,
        )
      }

      ctx.slots.inject('conversation.view', function () {
        return ctx.slots.register(
          { name: 'conversation.view', id: PANEL_ID, order: 75, label: function () { return TAB_LABEL } },
          function (props) { return el(Panel, props) },
        )
      })
    }

    exports.name = PLUGIN_ID
    exports.inject = ['slots']
    exports.apply = apply

    // 给离线校验用：contact sheet / 截图脚本可以拿到同一个模具函数，
    // 避免"面板里长这样、导出图长那样"的漂移。运行时不读它。
    exports.__preview = previewHtml

    return module.exports
  },
})
