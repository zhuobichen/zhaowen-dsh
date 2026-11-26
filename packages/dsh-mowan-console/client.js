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

    // 文案集中（改内容不碰组件）——和设计工作台同构
    const COPY = {
      kicker: 'BREAKER // CONSOLE',
      title: '破甲控制台',
      line: '粗描边贴纸当讲解员：它指哪儿，你就看哪儿',
      rulesHint: '每条只对指定会话生效；下一轮组装时读取',
      logHint: 'set_ = 改规则，inject = 规则真的被用上了',
      emptyTitle: '还没有任何会话被改过。',
      emptyLine: '用 mowan 指定 session_id 后调用规则工具，它就会贴在这儿。',
    }

    function apply(ctx) {
      // 工作台开关：默认全开；被用户关掉则不注册 tab（刷新页面生效）
      try {
        const _off = JSON.parse(window.localStorage.getItem('dsh-workbench-off') || '{}');
        if (_off['mowan-console'] === true) return;
      } catch (e) { /* localStorage 不可用就当全开 */ }
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
        .mw-scope{--dsw-alias-fg-1:#1a1a1a;--dsw-alias-fg-2:#4a453d;--dsw-alias-fg-3:#7a7266;--dsw-alias-bg-l1:#fffdf6;--dsw-alias-bg-l2:#f7f2e6;--dsw-alias-border-l2:#c9bda6;--dsw-alias-border-l3:#a89b84;}
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

        /* ── 粗描边贴纸人科普（cm-sticker-explainer）皮肤 ── */
        .st-hero{position:relative;display:flex;gap:18px;align-items:center;padding:14px 16px;border-radius:2px;background:#fffdf6;background-image:radial-gradient(rgba(60,50,40,.10) 1px,transparent 1px);background-size:6px 6px;border:3px solid #1a1a1a;box-shadow:5px 6px 0 #1a1a1a;transform:rotate(-.4deg);color:#1a1a1a;}
        .st-hero-art{flex:0 0 190px;height:114px;}
        .st-hero-copy{position:relative;z-index:1;flex:1;min-width:0;}
        .st-kicker{font-family:ui-monospace,Consolas,monospace;font-size:10px;letter-spacing:.22em;color:#c0392b;}
        .st-title{font-size:27px;font-weight:900;line-height:1.1;margin:3px 0 5px;color:#1a1a1a;letter-spacing:-.02em;}
        .st-line{font-size:12px;color:#4a453d;line-height:1.5;}
        .st-stickers{display:flex;gap:10px;flex-wrap:wrap;margin-top:11px;}
        .st-sticker{display:flex;align-items:center;gap:6px;padding:4px 11px;border:3px solid #1a1a1a;border-radius:6px;box-shadow:2px 3px 0 #1a1a1a;background:#fff;transform:rotate(-1.5deg);animation:stJitter 3.4s steps(2) infinite alternate;}
        .st-sticker b{font-family:ui-monospace,Consolas,monospace;font-size:15px;color:#1a1a1a;}
        .st-sticker span{font-size:10.5px;color:#4a453d;}
        .st-s1{background:#ffd23f;}.st-s2{background:#a3e635;transform:rotate(1.4deg);animation-delay:.4s;}
        .st-s3{background:#7dd3fc;transform:rotate(-.8deg);animation-delay:.8s;}
        @keyframes stJitter{from{translate:0 0}to{translate:1px -1px}}
        /* 规则卡 = 一张贴纸：粗黑描边 + 白边 + 硬阴影 + 错落 + 独立抖动 */
        .st-card{border:3px solid #1a1a1a;border-radius:6px;box-shadow:4px 5px 0 #1a1a1a,0 0 0 4px #fff;transform:rotate(-.5deg);background:#fffdf6;animation:stJitter 3.8s steps(2) infinite alternate;}
        .st-card:nth-child(even){transform:rotate(.7deg);animation-delay:.5s;}
        .st-card:hover{transform:rotate(0) translateY(-3px);box-shadow:6px 8px 0 #1a1a1a,0 0 0 4px #fff;}
        .st-card .mw-sess-title{color:#1a1a1a;}
        .st-card .mw-tag{border:2px solid #1a1a1a;border-radius:5px;background:#fff;color:#1a1a1a;box-shadow:1px 2px 0 #1a1a1a;}
        .st-card .mw-tag-warn{background:#ffd23f;}
        .st-card .mw-tag-model{background:#7dd3fc;}
        .st-card .mw-dot{border:2px solid #1a1a1a;}
        .st-card .mw-live{color:#1a1a1a;background:#a3e635;padding:0 6px;border:2px solid #1a1a1a;border-radius:4px;}
        .st-card .mw-pre{border:3px solid #1a1a1a;border-radius:6px;box-shadow:2px 3px 0 #1a1a1a;background:#fff;}
        /* 日志 = 贴纸条 */
        .mw-log{border:3px solid #1a1a1a;border-radius:6px;box-shadow:3px 4px 0 #1a1a1a;background:#fffdf6;}
        .mw-log-op{font-weight:700;}
        /* 入场：贴纸「啪」地贴上来 */
        .mw-wrap [data-reveal]{animation:stSlap .45s cubic-bezier(.2,1.4,.4,1) both;}
        .mw-wrap [data-reveal]:nth-child(even){animation-delay:.08s;}
        @keyframes stSlap{from{opacity:0;transform:translateY(18px) rotate(-6deg) scale(.94)}to{opacity:1;transform:none}}
      `
          const tag = document.createElement('style')
          tag.setAttribute('data-mowan-scope', '1')
          // CSS 隔离：每条选择器加 .mw-scope 前缀，避免污染别的面板
          tag.textContent = css.split('\n').map(function (line) {
            var t = line.trim()
            if (t === '' || t.charAt(0) === '/' || t.charAt(0) === '@') return line
            var brace = line.indexOf('{')
            if (brace < 0) return line
            var sel = line.slice(0, brace)
            if (/^(from|to|\d+(?:\.\d+)?%)\s*$/.test(sel.trim())) return line
            var parts = sel.split(',').map(function (one) {
              var v = one.trim()
              return v === '' ? one : '.mw-scope ' + v
            })
            return parts.join(',') + line.slice(brace)
          }).join('\n')
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

      /**
       * 首屏：粗描边贴纸人当「讲解员」（不是主角，是指针）。
       * 纯内联 SVG，粗黑描边 + 纯色填充 + 白边，不引外链图。
       */
      function StickerHero(props) {
        const stats = props.stats || {}
        return el('div', { className: 'st-hero' },
          el('div', { className: 'st-hero-art' },
            el('svg', { viewBox: '0 0 200 120', width: '100%', height: '100%', 'aria-hidden': 'true' },
              // 贴纸人：白边 + 粗黑描边 + 纯色填充
              el('g', { stroke: '#fff', 'stroke-width': 8, fill: 'none', 'stroke-linejoin': 'round' },
                el('circle', { cx: 70, cy: 42, r: 20, fill: '#ffd23f' }),
                el('rect', { x: 46, y: 64, width: 48, height: 44, rx: 10, fill: '#ff5d5d' }),
              ),
              el('g', { stroke: '#1a1a1a', 'stroke-width': 4, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' },
                el('circle', { cx: 70, cy: 42, r: 20, fill: '#ffd23f' }),
                el('rect', { x: 46, y: 64, width: 48, height: 44, rx: 10, fill: '#ff5d5d' }),
                el('circle', { cx: 63, cy: 40, r: 2.6, fill: '#1a1a1a', stroke: 'none' }),
                el('circle', { cx: 78, cy: 40, r: 2.6, fill: '#1a1a1a', stroke: 'none' }),
                el('path', { d: 'M64 50 q6 5 12 0' }),
                // 讲解员伸出的「指针」手臂，指着右边的数字
                el('path', { d: 'M92 80 q30 -6 54 -18' }),
                el('path', { d: 'M142 58 l8 4 l-8 5 z', fill: '#1a1a1a' }),
              ),
              // 被指的三个贴纸块
              el('rect', { x: 150, y: 30, width: 38, height: 18, rx: 4, fill: '#38bdf8', stroke: '#1a1a1a', 'stroke-width': 3 }),
              el('rect', { x: 150, y: 72, width: 38, height: 18, rx: 4, fill: '#a3e635', stroke: '#1a1a1a', 'stroke-width': 3 }),
            ),
          ),
          el('div', { className: 'st-hero-copy' },
            el('div', { className: 'st-kicker' }, COPY.kicker),
            el('div', { className: 'st-title' }, COPY.title),
            el('div', { className: 'st-line' }, COPY.line),
            el('div', { className: 'st-stickers' },
              el('div', { className: 'st-sticker st-s1' }, el('b', null, String(stats.rules || 0)), el('span', null, '被改会话')),
              el('div', { className: 'st-sticker st-s2' }, el('b', null, String(stats.live || 0)), el('span', null, '正在运行')),
              el('div', { className: 'st-sticker st-s3' }, el('b', null, String(stats.inj || 0)), el('span', null, '注入次数')),
            ),
          ),
        )
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

        return el('div', { className: 'mw-scope', style: { display: 'contents' } },
          el('div', { className: 'mw-wrap' },
          el(StickerHero, { stats: stats }),

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
              el('span', { className: 'mw-muted', style: { fontSize: 11.5 } }, COPY.rulesHint),
            ),
            rules.length === 0
              ? el('div', { className: 'mw-empty' },
                  el('div', null, COPY.emptyTitle),
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
                  return el('div', { className: 'mw-card st-card' + (isLive ? ' mw-card-live' : ''), key: r.sessionId, 'data-reveal': '1' },
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
              el('span', { className: 'mw-muted', style: { fontSize: 11.5 } }, COPY.logHint),
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
