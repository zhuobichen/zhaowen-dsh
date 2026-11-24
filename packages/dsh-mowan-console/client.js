/**
 * dsh-mowan-console · 浏览器半边
 *
 * 注册一个「破甲工作台」标签。数据来自主机侧的 /mowan-state。
 *
 * 这一版重做了呈现：
 *   ① 顶部三个数字当 dashboard（规则 / 运行中 / 注入次数），一眼看规模
 *   ② 每条规则一张卡：状态点 + 标题 + id + 三个指标 + 可展开的注入原文
 *   ③ 日志按 op 着色，可按类型筛
 *   ④ 空状态给的是「怎么让它有东西」的说明，不是一行灰字
 *
 * ⚠ DSH 的客户端模块 ABI 是 `window.__ModuleLoader__.load({id, factory})` 信封。
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
      const useMemo = react.useMemo

      // 会话标签栏横向滚动（标签多了不挤成两行）
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
        .mw-wrap{display:flex;flex-direction:column;gap:16px;padding:20px 22px 48px;height:100%;overflow:auto;font-size:13px;color:var(--dsw-alias-fg-1);}
        .mw-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
        .mw-title{font-size:16px;font-weight:650;letter-spacing:.01em;}
        .mw-muted{color:var(--dsw-alias-fg-3);}
        .mw-btn{padding:4px 11px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-fg-1);cursor:pointer;font-size:12px;transition:background .15s;}
        .mw-btn:hover{background:var(--dsw-alias-bg-l2);}
        .mw-btn-on{background:var(--dsw-alias-bg-l2);border-color:var(--dsw-alias-border-l3);}

        .mw-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:560px;}
        .mw-stat{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 14px;display:flex;flex-direction:column;gap:2px;}
        .mw-stat-n{font-size:24px;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums;}
        .mw-stat-k{font-size:11.5px;color:var(--dsw-alias-fg-3);letter-spacing:.02em;}

        .mw-sec{display:flex;flex-direction:column;gap:10px;}
        .mw-sec-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
        .mw-sec-t{font-size:13px;font-weight:600;}

        .mw-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:9px;background:var(--dsw-alias-bg-l1,transparent);}
        .mw-card-live{border-color:rgba(34,197,94,.35);}
        .mw-card-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
        .mw-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;}
        .mw-dot-live{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.15);}
        .mw-dot-idle{background:var(--dsw-alias-fg-3);opacity:.45;}
        .mw-live{color:#22c55e;font-size:12px;font-weight:600;}
        .mw-sleep{color:var(--dsw-alias-fg-3);font-size:12px;}
        .mw-sess-title{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46ch;}
        .mw-mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-fg-3);}
        .mw-metrics{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
        .mw-tag{font-size:11.5px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-fg-2);white-space:nowrap;}
        .mw-tag-warn{border-color:rgba(245,158,11,.35);color:#d6a13a;}
        .mw-tag-model{border-color:rgba(56,189,248,.32);color:#5aa9d6;}
        .mw-pre{white-space:pre-wrap;word-break:break-word;font-size:11.5px;line-height:1.6;background:var(--dsw-alias-bg-l2);padding:10px 12px;border-radius:8px;max-height:260px;overflow:auto;border-left:2px solid rgba(56,189,248,.4);}

        .mw-log{display:flex;flex-direction:column;gap:1px;max-height:42vh;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;}
        .mw-logline{display:flex;gap:8px;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;white-space:nowrap;overflow:hidden;padding:2px 0;}
        .mw-log-t{color:var(--dsw-alias-fg-3);flex:0 0 auto;}
        .mw-log-op{flex:0 0 78px;}
        .mw-log-s{color:var(--dsw-alias-fg-2);flex:0 0 auto;}
        .mw-log-x{color:var(--dsw-alias-fg-3);overflow:hidden;text-overflow:ellipsis;}
        .mw-op-inject{color:#38bdf8;}
        .mw-op-set{color:#f59e0b;}
        .mw-op-other{color:#a3a3a3;}

        .mw-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:18px 16px;color:var(--dsw-alias-fg-3);line-height:1.7;font-size:12.5px;}
        .mw-empty b{color:var(--dsw-alias-fg-2);font-weight:600;}
        .mw-code{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;background:var(--dsw-alias-bg-l2);padding:1px 6px;border-radius:4px;color:var(--dsw-alias-fg-1);}
        .mw-foot{font-size:11px;color:var(--dsw-alias-fg-3);line-height:1.8;word-break:break-all;}
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
          if (Number.isNaN(d.getTime())) return String(iso)
          const p = (n) => String(n).padStart(2, '0')
          return p(d.getHours()) + ':' + p(d.getMinutes())
        } catch {
          return String(iso)
        }
      }

      function ago(iso) {
        if (!iso) return ''
        try {
          const t = new Date(iso).getTime()
          if (Number.isNaN(t)) return ''
          const s = Math.max(0, Math.round((Date.now() - t) / 1000))
          const d = Math.round(s / 86400)
          const h = Math.round(s / 3600)
          if (d >= 1) return d + ' 天前'
          if (h >= 1) return h + ' 小时前'
          return Math.max(s, 1) + ' 秒前'
        } catch {
          return ''
        }
      }

      function opClass(op) {
        if (op === 'inject') return 'mw-log-op mw-op-inject'
        if (op && op.indexOf('set_') === 0) return 'mw-log-op mw-op-set'
        return 'mw-log-op mw-op-other'
      }

      function Panel() {
        useStyleOnce()
        const [state, setState] = useState(null)
        const [err, setErr] = useState('')
        const [openId, setOpenId] = useState('')
        const [logFilter, setLogFilter] = useState('all')

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
        const meta = (state && state.meta) || {}
        const logAll = (state && state.log) || []

        const stats = useMemo(function () {
          const inj = logAll.filter(function (e) { return e && e.op === 'inject' }).length
          const liveCount = rules.filter(function (r) { return live.indexOf(r.sessionId) >= 0 }).length
          return { rules: rules.length, live: liveCount, inj: inj }
        }, [rules, live, logAll])

        const log = useMemo(function () {
          if (logFilter === 'all') return logAll
          if (logFilter === 'inject') return logAll.filter(function (e) { return e && e.op === 'inject' })
          return logAll.filter(function (e) { return e && String(e.op || '').indexOf('set_') === 0 })
        }, [logAll, logFilter])

        return el('div', { className: 'mw-wrap' },

          // ── 头部 ──
          el('div', { className: 'mw-head' },
            el('div', { className: 'mw-title' }, TAB_LABEL),
            el('span', { className: 'mw-muted' }, state ? ('更新于 ' + when(state.at)) : '加载中…'),
            el('button', { className: 'mw-btn', onClick: load, style: { marginLeft: 'auto' } }, '刷新'),
          ),

          err ? el('div', { className: 'mw-card', style: { borderColor: '#ef4444' } }, '接口报错：' + err) : null,

          // ── 三个数字 ──
          el('div', { className: 'mw-stats' },
            el('div', { className: 'mw-stat' },
              el('div', { className: 'mw-stat-n' }, String(stats.rules)),
              el('div', { className: 'mw-stat-k' }, '被改过的会话'),
            ),
            el('div', { className: 'mw-stat' },
              el('div', { className: 'mw-stat-n', style: { color: stats.live > 0 ? '#22c55e' : undefined } }, String(stats.live)),
              el('div', { className: 'mw-stat-k' }, '正在运行'),
            ),
            el('div', { className: 'mw-stat' },
              el('div', { className: 'mw-stat-n' }, String(stats.inj)),
              el('div', { className: 'mw-stat-k' }, '规则被用过'),
            ),
          ),

          // ── 规则卡 ──
          el('div', { className: 'mw-sec' },
            el('div', { className: 'mw-sec-head' },
              el('div', { className: 'mw-sec-t' }, '规则'),
              el('span', { className: 'mw-muted', style: { fontSize: 11.5 } }, '每条只对指定会话生效；下一轮组装时读取'),
            ),
            rules.length === 0
              ? el('div', { className: 'mw-empty' },
                  el('div', null, '还没有任何会话被改过。'),
                  el('div', { style: { marginTop: 6 } },
                    '用 ',
                    el('span', { className: 'mw-code' }, 'mowan'),
                    ' 工具指定 ',
                    el('span', { className: 'mw-code' }, 'session_id'),
                    ' 后调用 ',
                    el('span', { className: 'mw-code' }, 'op=set_prompt'),
                    '（软注入）或 ',
                    el('span', { className: 'mw-code' }, 'op=set_model'),
                    '（换模型）。',
                  ),
                )
              : rules.map(function (r) {
                  const isLive = live.indexOf(r.sessionId) >= 0
                  const m = meta[r.sessionId] || {}
                  const open = openId === r.sessionId
                  return el('div', { className: 'mw-card' + (isLive ? ' mw-card-live' : ''), key: r.sessionId },
                    el('div', { className: 'mw-card-top' },
                      el('span', { className: 'mw-dot ' + (isLive ? 'mw-dot-live' : 'mw-dot-idle') }),
                      isLive ? el('span', { className: 'mw-live' }, '运行中') : el('span', { className: 'mw-sleep' }, '休眠'),
                      el('span', { className: 'mw-sess-title' }, titles[r.sessionId] || '(无标题)'),
                      el('span', { className: 'mw-mono' }, r.session),
                    ),
                    el('div', { className: 'mw-metrics' },
                      el('span', { className: 'mw-tag' + (r.promptChars > 0 ? ' mw-tag-warn' : '') }, '注入 ' + r.promptChars + ' 字'),
                      el('span', { className: 'mw-tag mw-tag-model' }, '模型 ' + (r.model && r.model.model ? r.model.model : '默认')),
                      el('span', { className: 'mw-muted', style: { fontSize: 11.5 } },
                        '最后改动 ' + when(r.changedAt) +
                        (m.lastActive ? ' · 会话活跃 ' + ago(m.lastActive) : '') +
                        (typeof m.messages === 'number' ? ' · ' + m.messages + ' 条消息' : '')),
                      el('button', {
                        className: 'mw-btn' + (open ? ' mw-btn-on' : ''),
                        style: { marginLeft: 'auto' },
                        onClick: function () { setOpenId(open ? '' : r.sessionId) },
                      }, open ? '收起' : '看注入'),
                    ),
                    open
                      ? el('div', { className: 'mw-pre' }, r.promptText || '（这条规则没有注入文本，只换了模型）')
                      : null,
                  )
                }),
          ),

          // ── 日志 ──
          el('div', { className: 'mw-sec' },
            el('div', { className: 'mw-sec-head' },
              el('div', { className: 'mw-sec-t' }, '操作记录'),
              el('span', { className: 'mw-muted', style: { fontSize: 11.5 } }, 'set_ = 改规则，inject = 规则真的被用上了'),
              el('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
                el('button', { className: 'mw-btn' + (logFilter === 'all' ? ' mw-btn-on' : ''), onClick: function () { setLogFilter('all') } }, '全部'),
                el('button', { className: 'mw-btn' + (logFilter === 'inject' ? ' mw-btn-on' : ''), onClick: function () { setLogFilter('inject') } }, '注入'),
                el('button', { className: 'mw-btn' + (logFilter === 'set' ? ' mw-btn-on' : ''), onClick: function () { setLogFilter('set') } }, '改动'),
              ),
            ),
            el('div', { className: 'mw-log' },
              log.length === 0
                ? el('div', { className: 'mw-muted', style: { padding: '6px 2px' } }, '（没有匹配的记录）')
                : log.slice().reverse().map(function (e, i) {
                    const extra = []
                    if (e.chars) extra.push('chars=' + e.chars)
                    if (e.model) extra.push('model=' + e.model)
                    if (e.to && e.to.model) extra.push('→ ' + e.to.model)
                    if (e.note) extra.push(e.note)
                    return el('div', { className: 'mw-logline', key: (e.at || '') + '-' + i },
                      el('span', { className: 'mw-log-t' }, when(e.at)),
                      el('span', { className: opClass(e.op) }, e.op || '?'),
                      el('span', { className: 'mw-log-s' }, e.session || ''),
                      el('span', { className: 'mw-log-x' }, extra.join(' · ')),
                    )
                  }),
            ),
          ),

          // ── 底部路径 ──
          state ? el('div', { className: 'mw-foot' },
            '规则：' + state.rulesPath,
            el('br'),
            '审计：' + state.logPath,
          ) : null,
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
