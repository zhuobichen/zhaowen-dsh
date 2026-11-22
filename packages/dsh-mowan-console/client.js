/**
 * dsh-mowan-console · 浏览器半边
 *
 * 注册一个「破甲工作台」标签，和「对话 / 轨迹 / IG5 逆向工作台 / QQ 纪实」并排。
 * 数据来自主机侧的 /mowan-state（规则 + 审计日志 + 活会话）。
 *
 * 目的很具体：**看清楚"当前有哪些会话被动了、动了什么、最近一次是什么时候"**。
 *
 * ⚠ DSH 的客户端模块 ABI 是 `window.__ModuleLoader__.load({id, factory})` 信封。
 *   少这层信封会报 `loaded without registering "..." via __ModuleLoader__.load`。
 *   信封里的 require 只认静态表（react / react/jsx-runtime 等）。
 */
window.__ModuleLoader__.load({
  id: '@zhuobichen/dsh-mowan-console',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports

    const react = require('react')

    const PLUGIN_ID = 'dsh-mowan-console'
    const TAB_LABEL = '破甲工作台'
    const PANEL_ID = 'mowan-console-main'
    const POLL_MS = 4000

    function apply(ctx) {
      const el = react.createElement
      const useState = react.useState
      const useEffect = react.useEffect

      // ── 全局修一次：让会话标签栏横向滚动，而不是挤成多行 ──────────────
      //
      // 标签栏本身带 `data-conversation-tabs` 属性（不是 CSS Module 的哈希类名），
      // 所以属性选择器能稳定命中，且对**以后新增的每个工作台标签**都生效。
      // 不换行 + overflow-x:auto = 一排横向滑动，标签再多也不会把「对话」压成两行。
      ;(function injectTabBarScroll() {
        try {
          if (document.querySelector('style[data-mowan-tabbar]')) return
          const tag = document.createElement('style')
          tag.setAttribute('data-mowan-tabbar', '1')
          tag.textContent = [
            '[data-conversation-tabs]{flex-wrap:nowrap !important;overflow-x:auto !important;overflow-y:hidden !important;scrollbar-width:thin;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;}',
            '[data-conversation-tabs] > *{flex:0 0 auto;white-space:nowrap;}',
            '[data-conversation-tabs]::-webkit-scrollbar{height:6px;}',
            '[data-conversation-tabs]::-webkit-scrollbar-track{background:transparent;}',
            '[data-conversation-tabs]::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l3,rgba(128,128,128,.45));border-radius:3px;}',
            '[data-conversation-tabs]::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-fg-3,rgba(128,128,128,.65));}',
            '[data-conversation-tabs]{scrollbar-color:var(--dsw-alias-border-l3,rgba(128,128,128,.45)) transparent;}',
          ].join('\n')
          document.head.appendChild(tag)
        } catch {
          /* 注入失败不影响面板本体 */
        }
      })()

      let styleDone = false
      function useStyleOnce() {
        if (styleDone) return
        styleDone = true
        try {
          const css = `
        .mw-wrap{display:flex;flex-direction:column;gap:14px;padding:18px 20px 40px;height:100%;overflow:auto;font-size:13px;color:var(--dsw-alias-fg-1);}
        .mw-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
        .mw-title{font-size:15px;font-weight:600;}
        .mw-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--dsw-alias-border-l2);}
        .mw-muted{color:var(--dsw-alias-fg-3);}
        .mw-btn{padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-fg-1);cursor:pointer;font-size:12px;}
        .mw-btn:hover{background:var(--dsw-alias-bg-l2);}
        .mw-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;}
        .mw-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 0;border-bottom:1px dashed var(--dsw-alias-border-l2);}
        .mw-row:last-child{border-bottom:none;}
        .mw-mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;}
        .mw-live{color:#22c55e;font-weight:600;}
        .mw-tag{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-fg-2);}
        .mw-log{max-height:46vh;overflow:auto;display:flex;flex-direction:column;gap:2px;}
        .mw-logline{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-fg-2);}
        .mw-op-inject{color:#38bdf8;}
        .mw-op-set{color:#f59e0b;}
        .mw-op-boot,.mw-op-reload{color:#a3a3a3;}
        .mw-pre{white-space:pre-wrap;word-break:break-word;font-size:11.5px;line-height:1.5;background:var(--dsw-alias-bg-l2);padding:8px;border-radius:6px;max-height:180px;overflow:auto;}
      `
          const tag = document.createElement('style')
          tag.setAttribute('data-mowan', '1')
          tag.textContent = css
          document.head.appendChild(tag)
        } catch {
          /* 样式失败不影响功能 */
        }
      }

      function when(iso) {
        if (!iso) return '—'
        try {
          const d = new Date(iso)
          const hh = String(d.getHours()).padStart(2, '0')
          const mm = String(d.getMinutes()).padStart(2, '0')
          const ss = String(d.getSeconds()).padStart(2, '0')
          return hh + ':' + mm + ':' + ss
        } catch {
          return String(iso)
        }
      }

      function opClass(op) {
        if (op === 'inject') return 'mw-logline mw-op-inject'
        if (op && op.indexOf('set_') === 0) return 'mw-logline mw-op-set'
        return 'mw-logline mw-op-boot'
      }

      function Panel() {
        useStyleOnce()
        const [state, setState] = useState(null)
        const [err, setErr] = useState('')
        const [openText, setOpenText] = useState('')

        const load = function () {
          fetch('/mowan-state', { cache: 'no-store' })
            .then(function (r) { return r.json() })
            .then(function (j) {
              if (!j || j.ok !== true) { setErr((j && j.error) || '状态接口返回异常'); return }
              setErr('')
              setState(j)
            })
            .catch(function (e) { setErr(String((e && e.message) || e)) })
        }

        useEffect(function () {
          load()
          const t = setInterval(load, POLL_MS)
          return function () { clearInterval(t) }
        }, [])

        const rules = (state && state.rules) || []
        const live = (state && state.live) || []
        const titles = (state && state.titles) || {}
        const log = (state && state.log) || []
        const injCount = log.filter(function (e) { return e && e.op === 'inject' }).length

        return el('div', { className: 'mw-wrap' },
          el('div', { className: 'mw-head' },
            el('div', { className: 'mw-title' }, TAB_LABEL),
            el('span', { className: 'mw-pill' }, '规则 ', el('b', null, String(rules.length))),
            el('span', { className: 'mw-pill' }, '运行中 ', el('b', null, String(live.length))),
            el('span', { className: 'mw-pill' }, '注入次数 ', el('b', null, String(injCount))),
            el('span', { className: 'mw-muted' }, state ? ('更新于 ' + when(state.at)) : '加载中…'),
            el('button', { className: 'mw-btn', onClick: load }, '刷新'),
          ),

          err ? el('div', { className: 'mw-card', style: { borderColor: '#ef4444' } }, '接口报错：' + err) : null,

          el('div', { className: 'mw-card' },
            el('div', { className: 'mw-head' },
              el('b', null, '被改过的会话'),
              el('span', { className: 'mw-muted' }, '点「看注入」可以看原文'),
            ),
            rules.length === 0
              ? el('div', { className: 'mw-muted' }, '还没有任何会话被改过。用 mowan 工具 set_prompt / set_model 指定 session_id 即可。')
              : rules.map(function (r) {
                  const isLive = live.indexOf(r.sessionId) >= 0
                  return el('div', { className: 'mw-row', key: r.sessionId },
                    el('span', { className: 'mw-mono' }, r.session),
                    isLive ? el('span', { className: 'mw-live' }, '● 运行中') : el('span', { className: 'mw-muted' }, '○ 休眠'),
                    el('span', { className: 'mw-tag' }, '注入 ' + r.promptChars + ' 字'),
                    el('span', { className: 'mw-tag' }, '模型 ' + (r.model && r.model.model ? r.model.model : '默认')),
                    el('span', { className: 'mw-muted' }, (titles[r.sessionId] || '') + ' · ' + when(r.changedAt)),
                    el('button', {
                      className: 'mw-btn',
                      onClick: function () { setOpenText(openText === r.sessionId ? '' : r.sessionId) },
                    }, openText === r.sessionId ? '收起' : '看注入'),
                    openText === r.sessionId ? el('div', { className: 'mw-pre', style: { flexBasis: '100%' } }, r.promptText || '（空）') : null,
                  )
                }),
          ),

          el('div', { className: 'mw-card' },
            el('div', { className: 'mw-head' },
              el('b', null, '最近操作（实时）'),
              el('span', { className: 'mw-muted' }, 'set_prompt = 改了规则；inject = 规则真的被用上了'),
            ),
            el('div', { className: 'mw-log' },
              log.length === 0
                ? el('div', { className: 'mw-muted' }, '（还没有记录）')
                : log.slice().reverse().map(function (e, i) {
                    const parts = [when(e.at), (e.op || '?'), e.session || '']
                    if (e.chars) parts.push('chars=' + e.chars)
                    if (e.model) parts.push('model=' + e.model)
                    if (e.to && e.to.model) parts.push('→ ' + e.to.model)
                    if (e.note) parts.push('· ' + e.note)
                    return el('div', { className: opClass(e.op), key: e.at + '-' + i }, parts.join('  '))
                  }),
            ),
          ),

          state ? el('div', { className: 'mw-muted', style: { fontSize: 11 } },
            '规则文件：' + state.rulesPath + '　审计：' + state.logPath) : null,
        )
      }

      ctx.slots.inject('conversation.view', function () {
        return ctx.slots.register(
          { name: 'conversation.view', id: PANEL_ID, order: 70, label: function () { return TAB_LABEL } },
          function (props) { return el(Panel, props) },
        )
      })
    }

    exports.name = PLUGIN_ID
    exports.inject = ['slots']
    exports.apply = apply

    return module.exports
  },
})
