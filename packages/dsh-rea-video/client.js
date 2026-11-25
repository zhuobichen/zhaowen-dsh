/**
 * dsh-rea-video · 浏览器半边（UPA 扁平卡通皮肤）
 *
 * 采用「50s 扁平卡通（UPA）」：色与线分在两张片、刻意印偏几像素（off-register），
 * 几何化图形、编号步骤卡、暖纸底 + 原子时代柔和补色、有限动画。
 * 数据仍只读 host 的 GET /rea-video/status，AI 通过 rea_video_view 读同一份。
 */
window.__ModuleLoader__.load({
  id: '@zhuobichen/dsh-rea-video',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const TITLE = 'rea-video 工作台'
    const ENDPOINT = '/rea-video/status'

    // 文案集中（改内容不碰组件）
    const COPY = {
      kicker: 'STEP BY STEP // LIMITED ANIMATION',
      title: '视频逆向拆解',
      line: '编号卡片，一次讲一件事：它怎么做的、用了什么、怎么复刻',
      empty: '还没有拆解记录。让 AI 调 rea_video_cli {"args":["decompose","<视频路径>"]}，跑完这里就出现结论。',
    }

    // UPA 配色：暖纸底 + 柔和原子时代补色（不用纯色/霓虹）
    const TONES = { coral: '#e07a5f', mustard: '#e9b44c', teal: '#5aa9a3', olive: '#8ba36b', plum: '#a97b9b' }

    let styleDone = false
    function useStyleOnce() {
      if (styleDone) return
      styleDone = true
      try {
        if (document.querySelector('style[data-upa]')) return
        const tag = document.createElement('style')
        tag.setAttribute('data-upa', '1')
        const css = `
          .upa-wrap{--ink:#33291f;--paper:#f4ecd8;--coral:#e07a5f;--mustard:#e9b44c;--teal:#5aa9a3;display:flex;flex-direction:column;gap:14px;padding:18px 20px 40px;height:100%;overflow:auto;overflow-x:hidden;box-sizing:border-box;font-size:13px;color:var(--ink);
            background:var(--paper);background-image:repeating-linear-gradient(0deg,rgba(80,60,40,.03) 0 1px,transparent 1px 4px),radial-gradient(ellipse 80% 50% at 50% 0%,rgba(255,250,235,.9),transparent);}
          /* off-register：色片印偏线稿几像素（右下 3px），并轻微抖动，像手工套印 */
          .upa-card{position:relative;border:0;background:#fff8e8;padding:14px 16px;box-shadow:3px 4px 0 rgba(51,41,31,.18);}
          .upa-card:before{content:"";position:absolute;inset:-3px 3px 3px -3px;border:3px solid var(--ink);border-radius:2px;pointer-events:none;opacity:.85;animation:upaJitter 2.6s steps(2) infinite alternate;}
          .upa-card:after{content:"";position:absolute;inset:0;background:var(--tone,var(--mustard));opacity:.10;pointer-events:none;transform:translate(3px,3px);}
          @keyframes upaJitter{from{transform:translate(0,0)}to{transform:translate(1.5px,1px)}}
          .upa-hero{position:relative;display:flex;gap:16px;align-items:center;padding:12px 16px;background:var(--ink);color:var(--paper);overflow:hidden;}
          .upa-hero:after{content:"";position:absolute;right:-30px;top:-40px;width:150px;height:150px;background:repeating-conic-gradient(from 0deg,var(--coral) 0deg 12deg,transparent 12deg 24deg);opacity:.18;pointer-events:none;}
          .upa-hero-art{flex:0 0 150px;height:100px;position:relative;z-index:1;}
          .upa-copy{position:relative;z-index:1;flex:1;min-width:0;}
          .upa-kicker{font-family:ui-monospace,Consolas,monospace;font-size:10px;letter-spacing:.2em;color:var(--mustard);}
          .upa-title{font-size:24px;font-weight:800;margin:3px 0 5px;letter-spacing:-.01em;}
          .upa-line{font-size:12px;color:#e8dcc4;line-height:1.5;}
          .upa-nums{display:flex;gap:8px;margin-top:9px;flex-wrap:wrap;}
          .upa-num{display:inline-flex;align-items:center;gap:5px;font-family:ui-monospace,Consolas,monospace;font-size:11px;padding:3px 9px;border:2px solid var(--paper);color:var(--paper);}
          .upa-num b{font-size:15px;color:var(--mustard);}
          /* 编号徽章：ink 圆盘 + 纸色数字 */
          .upa-step{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:700;}
          .upa-medallion{display:inline-flex;width:26px;height:26px;border-radius:50%;background:var(--ink);color:var(--paper);align-items:center;justify-content:center;font-family:ui-monospace,Consolas,monospace;font-size:12px;flex:0 0 auto;}
          .upa-heading{display:flex;align-items:center;gap:8px;font-weight:800;font-size:13px;margin-bottom:8px;letter-spacing:.04em;}
          .upa-muted{font-size:12px;color:#6b5a45;line-height:1.6;}
          .upa-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px;}
          .upa-chip{font-size:11px;padding:2px 9px;border:2px solid var(--ink);background:var(--tone,var(--mustard));color:var(--ink);position:relative;}
          .upa-chip:after{content:"";position:absolute;inset:0;border:2px solid var(--ink);transform:translate(2px,2px);pointer-events:none;opacity:.55;}
          .upa-list{margin:6px 0 0;padding-left:18px;font-size:12px;line-height:1.7;color:#4a3b2c;}
          .upa-list li{margin-bottom:4px;}
          .upa-verdict{font-size:13.5px;line-height:1.7;color:var(--ink);}
          .upa-empty{font-size:12px;color:#6b5a45;padding:6px 0;}
          .upa-btn{font-family:inherit;font-size:12px;padding:4px 10px;border:2px solid var(--ink);background:var(--mustard);color:var(--ink);cursor:pointer;box-shadow:2px 2px 0 var(--ink);}
          .upa-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:9600;background:var(--ink);color:var(--paper);font-size:12px;padding:6px 14px;border:2px solid var(--paper);}
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

    function Workbench() {
      useStyleOnce()
      const [state, setState] = React.useState({ loading: true, data: null, error: null })
      const [toast, setToast] = React.useState('')

      React.useEffect(() => {
        let alive = true
        const load = () => {
          fetch(ENDPOINT + '?t=' + Date.now(), { headers: { accept: 'application/json' } })
            .then((r) => r.json())
            .then((d) => { if (alive) setState({ loading: false, data: d, error: null }) })
            .catch((e) => { if (alive) setState({ loading: false, data: null, error: String((e && e.message) || e) }) })
        }
        load()
        const timer = setInterval(load, 60000)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      const copy = (text, what) => copyText(text).then((ok) => {
        setToast(ok ? what + ' 已复制' : '复制被拦了：手动选中上面那段')
        setTimeout(() => setToast(''), 2400)
      })

      const data = state.data || {}
      const ok = Boolean(data && data.ok)
      const mix = data.mix || []
      const packaging = data.packaging || []
      const aspects = data.aspects || []
      const copyIndex = `按 rea-video 工作台里的「${data.video || '最近一次拆解'}」的拆解结论复刻：${(data.verdict || '').slice(0, 120)}。要看完整规格：rea_video_view op=status`

      return h('div', { className: 'upa-wrap' },
        // Hero：几何化 presenter（身体静止，只有手在动——有限的动作）
        h('div', { className: 'upa-hero' },
          h('div', { className: 'upa-hero-art' },
            h('svg', { viewBox: '0 0 150 100', width: '100%', height: '100%', 'aria-hidden': 'true' },
              // 几何化的人：蛋头 + 圆柱身体（held drawing）
              h('rect', { x: 34, y: 34, width: 44, height: 50, rx: 6, fill: TONES.teal, stroke: '#f4ecd8', 'stroke-width': 3 }),
              h('circle', { cx: 56, cy: 24, r: 18, fill: '#f0c9a0', stroke: '#f4ecd8', 'stroke-width': 3 }),
              h('circle', { cx: 50, cy: 24, r: 2, fill: '#33291f' }),
              h('circle', { cx: 62, cy: 24, r: 2, fill: '#33291f' }),
              // 只有手在动：指向右边的数据卡
              h('path', { d: 'M78 58 q22 -6 40 -18', stroke: '#f4ecd8', 'stroke-width': 6, fill: 'none', 'stroke-linecap': 'round' }),
              h('path', { d: 'M114 36 l10 4 l-9 6 z', fill: TONES.mustard, stroke: '#f4ecd8', 'stroke-width': 2 }),
              // 编号圆盘 + 数据卡（off-register 色片）
              h('circle', { cx: 128, cy: 26, r: 12, fill: TONES.coral, stroke: '#f4ecd8', 'stroke-width': 3 }),
              h('text', { x: 128, y: 31, 'text-anchor': 'middle', fill: '#33291f', 'font-size': 13, 'font-family': 'monospace' }, '1'),
              // 原子星芒装饰
              h('path', { d: 'M18 18 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 z', fill: TONES.mustard, opacity: '.9' }),
            ),
          ),
          h('div', { className: 'upa-copy' },
            h('div', { className: 'upa-kicker' }, COPY.kicker),
            h('div', { className: 'upa-title' }, COPY.title),
            h('div', { className: 'upa-line' }, COPY.line),
            h('div', { className: 'upa-nums' },
              h('span', { className: 'upa-num' }, h('b', null, String(data.duration ? data.duration.toFixed(1) : '—')), ' 秒'),
              h('span', { className: 'upa-num' }, h('b', null, String(data.shots ?? '—')), ' 镜头'),
              h('span', { className: 'upa-num' }, h('b', null, String(data.confidence ?? '—')), ' 置信度'),
            ),
          ),
        ),

        state.error ? h('div', { className: 'upa-card', style: { '--tone': TONES.coral } }, '接口报错：' + state.error) : null,
        state.loading ? h('div', { className: 'upa-empty' }, '读取中…') : null,

        !ok && !state.loading ? h('div', { className: 'upa-card', style: { '--tone': TONES.mustard } }, h('div', { className: 'upa-empty' }, COPY.empty)) : null,

        // 步骤 1：结论（编号卡片）
        ok && h('div', { className: 'upa-card', style: { '--tone': TONES.coral } },
          h('div', { className: 'upa-heading' }, h('span', { className: 'upa-medallion' }, '1'), '结论'),
          h('div', { className: 'upa-verdict' }, data.verdict || '（无）'),
          mix.length > 0 && h('div', { className: 'upa-chips' }, mix.map((m, i) => h('span', {
            key: i, className: 'upa-chip', style: { '--tone': [TONES.coral, TONES.mustard, TONES.teal, TONES.olive][i % 4] },
          }, `${m.label_zh || m.label} ${Math.round((m.ratio || 0) * 100)}%`))),
        ),

        // 步骤 2：画面与包装
        ok && (aspects.length > 0 || packaging.length > 0) && h('div', { className: 'upa-card', style: { '--tone': TONES.teal } },
          h('div', { className: 'upa-heading' }, h('span', { className: 'upa-medallion' }, '2'), '画面与包装'),
          aspects.length > 0 && h('div', null, h('div', { className: 'upa-muted' }, '画面构成'), h('ul', { className: 'upa-list' }, aspects.map((a, i) => h('li', { key: i }, a)))),
          packaging.length > 0 && h('div', null, h('div', { className: 'upa-muted', style: { marginTop: 6 } }, '后期叠加'), h('ul', { className: 'upa-list' }, packaging.map((p, i) => h('li', { key: i }, p)))),
        ),

        // 步骤 3：可信度提示
        ok && data.vlm && h('div', { className: 'upa-card', style: { '--tone': TONES.olive } },
          h('div', { className: 'upa-heading' }, h('span', { className: 'upa-medallion' }, '3'), '可信度提示'),
          h('div', { className: 'upa-muted' }, data.vlm),
        ),

        // 步骤 4：产物 + 复制索引
        ok && h('div', { className: 'upa-card', style: { '--tone': TONES.mustard } },
          h('div', { className: 'upa-heading' }, h('span', { className: 'upa-medallion' }, '4'), '产物'),
          h('div', { className: 'upa-muted' }, data.report || ''),
          h('div', { className: 'upa-muted', style: { marginTop: 4 } }, '完整报告含逐镜关键帧、证据、音轨图与复刻方案。'),
          h('button', { className: 'upa-btn', style: { marginTop: 8 }, onClick: () => copy(copyIndex, '复刻索引') }, '复制复刻索引 → AI'),
        ),

        toast ? h('div', { className: 'upa-toast' }, toast) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          ctx.slots.inject('conversation.view', () => ctx.slots.register({
            name: 'conversation.view',
            id: 'rea-video',
            order: 27,
            label: () => TITLE,
          }, Workbench))
        } catch (error) { /* slot already taken by a stale instance */ }
      },
    }
  },
})
