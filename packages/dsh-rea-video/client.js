/**
 * dsh-rea-video · 浏览器半边（浮世绘皮肤）
 *
 * 采用「浮世绘」：每一块内容都是一整张江户木版画——和纸底、粗细双线边框、
 * 竖排题签、朱印、平涂色块 + 墨线压色、套版微错位、横带堆叠纵深。
 * 数据仍只读 GET /rea-video/status，AI 通过 rea_video_view 读同一份。
 */
window.__ModuleLoader__.load({
  id: '@zhuobichen/dsh-rea-video',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const TITLE = 'rea-video 工作台'
    const ENDPOINT = '/rea-video/status'

    const COPY = {
      series: '大乱斗 · 视频拆解大系',
      title: '视频逆向拆解之图',
      kicker: '一图一话 · 如手卷般展开',
      empty: '还没有拆解版画。让 AI 调 rea_video_cli {"args":["decompose","<视频路径>"]}，结论就会印在这里。',
      view: '其之图',
    }

    // 版画颜料：蓝摺（Prussian blue）主调 + 红（朱印）/ 赭 / 若绿，和纸为白
    const PIGMENT = {
      sumi: '#2b2620',      // 墨
      indigo: '#2f5d8a',    // 蓝摺
      pale: '#a8c4d8',      // 淡蓝
      beni: '#b5462f',      // 红（朱印）
      ochre: '#c9a24b',     // 赭
      moss: '#6e8b5a',      // 若绿
      washi: '#f0e7d2',     // 和纸
    }

    let styleDone = false
    function useStyleOnce() {
      if (styleDone) return
      styleDone = true
      try {
        if (document.querySelector('style[data-ukiyoe]')) return
        const tag = document.createElement('style')
        tag.setAttribute('data-ukiyoe', '1')
        const css = `
          .uk-wrap{--sumi:#2b2620;--washi:#f0e7d2;--indigo:#2f5d8a;--beni:#b5462f;--ochre:#c9a24b;--moss:#6e8b5a;
            display:flex;flex-direction:column;gap:14px;padding:16px 18px 40px;height:100%;overflow:auto;overflow-x:hidden;box-sizing:border-box;font-size:13px;color:var(--sumi);
            background:#e2d6bb;background-image:repeating-linear-gradient(0deg,rgba(90,70,40,.04) 0 1px,transparent 1px 5px),radial-gradient(ellipse 90% 60% at 50% 0%,rgba(255,250,235,.7),transparent);}
          /* 一整张版画：和纸 + 粗细双线边框 + 套版微错位 */
          .uk-sheet{position:relative;background:var(--washi);padding:14px 16px;margin:0;box-shadow:3px 4px 0 rgba(43,38,32,.20);}
          .uk-sheet:before{content:"";position:absolute;inset:4px;border:1.5px solid var(--sumi);pointer-events:none;}
          .uk-sheet:after{content:"";position:absolute;inset:0;border:4px solid var(--sumi);pointer-events:none;opacity:.9;transform:translate(1.5px,1px);}
          .uk-sheet > *{position:relative;z-index:1;}
          /* 卷首：$\{series\} 题签 + 竖排标题 + 朱印 */
          .uk-head{display:flex;gap:16px;align-items:stretch;min-height:120px;}
          .uk-cartouche{flex:0 0 46px;background:#faf3e2;border:1.5px solid var(--sumi);box-shadow:2px 2px 0 var(--sumi);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 4px;gap:6px;}
          .uk-cart-title{writing-mode:vertical-rl;font-family:"Shippori Mincho",serif;font-size:15px;font-weight:700;letter-spacing:.18em;color:var(--sumi);}
          .uk-seal{width:24px;height:24px;border:2px solid var(--beni);color:var(--beni);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;transform:rotate(-4deg);}
          .uk-head-art{flex:0 0 180px;height:118px;}
          .uk-head-copy{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;}
          .uk-series{font-size:10px;letter-spacing:.2em;color:var(--beni);margin-bottom:4px;}
          .uk-title{font-size:23px;font-weight:800;letter-spacing:.06em;color:var(--sumi);font-family:"Shippori Mincho",serif;}
          .uk-kicker{font-size:11px;color:#6a5a45;margin-top:4px;letter-spacing:.05em;}
          .uk-nums{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;}
          .uk-num{font-family:ui-monospace,Consolas,monospace;font-size:11px;padding:3px 9px;border:1.5px solid var(--indigo);color:var(--indigo);background:#eef3f7;}
          .uk-num b{font-size:15px;color:var(--sumi);margin-right:3px;}
          /* 编号视图：墨圆盘 + 和纸数字（像版画题号） */
          .uk-view-tag{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:13px;}
          .uk-medallion{width:26px;height:26px;border-radius:50%;background:var(--indigo);color:var(--washi);display:inline-flex;align-items:center;justify-content:center;font-family:ui-monospace,Consolas,monospace;font-size:12px;flex:0 0 auto;border:1px solid var(--sumi);}
          .uk-band{height:6px;margin:2px 0 10px;background:var(--band,var(--indigo));opacity:.85;box-shadow:inset 0 -1px 0 rgba(43,38,32,.3);}
          .uk-muted{font-size:12px;line-height:1.7;color:#5a4b38;}
          .uk-list{margin:6px 0 0;padding-left:20px;font-size:12px;line-height:1.8;color:#4a3d2c;}
          .uk-list li{margin-bottom:4px;}
          .uk-verdict{font-size:13px;line-height:1.8;color:var(--sumi);}
          .uk-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}
          .uk-chip{font-size:11px;padding:3px 10px;border:1.5px solid var(--sumi);background:var(--tone,var(--pale));color:var(--sumi);box-shadow:1.5px 1.5px 0 rgba(43,38,32,.25);}
          .uk-empty{font-size:12px;color:#6a5a45;padding:6px 0;}
          .uk-btn{font-family:inherit;font-size:12px;padding:5px 12px;border:1.5px solid var(--sumi);background:var(--beni);color:#fff;cursor:pointer;box-shadow:2px 2px 0 var(--sumi);}
          .uk-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:9600;background:var(--sumi);color:var(--washi);font-size:12px;padding:7px 14px;border:1px solid var(--washi);}
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

    // 一帧版画（横带堆叠 + 远景淡、近景浓）
    function PrintArt() {
      return h('svg', { viewBox: '0 0 180 118', width: '100%', height: '100%', 'aria-hidden': 'true' },
        h('rect', { x: 0, y: 0, width: 180, height: 118, fill: '#dce7ef' }),
        // bokashi 天空（淡蓝横带，用多条近似渐变的横带模拟）
        h('rect', { x: 0, y: 0, width: 180, height: 30, fill: '#c5d9e8' }),
        h('rect', { x: 0, y: 30, width: 180, height: 16, fill: PIGMENT.pale, opacity: '.7' }),
        // 远山（平涂 + 墨线）
        h('path', { d: 'M0 52 L40 30 L78 52 Z', fill: '#8aa6b8', stroke: PIGMENT.sumi, 'stroke-width': 1.6 }),
        h('path', { d: 'M60 52 L108 26 L160 52 Z', fill: '#6f92a8', stroke: PIGMENT.sumi, 'stroke-width': 2 }),
        // 雾带（suyari-gasumi：两端渐隐的圆角带）
        h('rect', { x: 6, y: 48, width: 150, height: 7, rx: 3.5, fill: '#f0e7d2', opacity: '.85' }),
        // 中景横带（平行斜线，不收敛）
        h('path', { d: 'M0 62 L180 58 L180 78 L0 82 Z', fill: PIGMENT.moss, stroke: PIGMENT.sumi, 'stroke-width': 1.8 }),
        h('path', { d: 'M20 66 l16 -2 M44 66 l16 -2 M68 65 l16 -2 M92 65 l16 -2', stroke: PIGMENT.sumi, 'stroke-width': 1, opacity: '.5' }),
        // 前景——近景浓 + 墨线
        h('path', { d: 'M0 84 L180 80 L180 118 L0 118 Z', fill: PIGMENT.indigo, stroke: PIGMENT.sumi, 'stroke-width': 2.2 }),
        // 一位小人（画中人小，剪影清楚）
        h('circle', { cx: 128, cy: 74, r: 4, fill: PIGMENT.sumi }),
        h('path', { d: 'M124 78 l8 0 l3 12 l-14 0 z', fill: PIGMENT.beni, stroke: PIGMENT.sumi, 'stroke-width': 1.2 }),
        // 朱印
        h('rect', { x: 152, y: 96, width: 18, height: 18, fill: 'none', stroke: PIGMENT.beni, 'stroke-width': 2 }),
        h('text', { x: 161, y: 109, 'text-anchor': 'middle', fill: PIGMENT.beni, 'font-size': 11, 'font-family': 'serif' }, '拆'),
      )
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
      const copyIndex = `按 rea-video 拆解「${data.video || '最近一次'}」复刻：${(data.verdict || '').slice(0, 120)}。完整规格：rea_video_view op=status`

      return h('div', { className: 'uk-wrap' },
        // 卷首一图
        h('div', { className: 'uk-sheet' },
          h('div', { className: 'uk-head' },
            h('div', { className: 'uk-cartouche' },
              h('div', { className: 'uk-cart-title' }, COPY.title),
              h('div', { className: 'uk-seal' }, '解'),
            ),
            h('div', { className: 'uk-head-art' }, h(PrintArt)),
            h('div', { className: 'uk-head-copy' },
              h('div', { className: 'uk-series' }, COPY.series),
              h('div', { className: 'uk-title' }, '视频拆解大系'),
              h('div', { className: 'uk-kicker' }, COPY.kicker),
              h('div', { className: 'uk-nums' },
                h('span', { className: 'uk-num' }, h('b', null, String(data.duration ? data.duration.toFixed(1) : '—')), '秒'),
                h('span', { className: 'uk-num' }, h('b', null, String(data.shots ?? '—')), '景'),
                h('span', { className: 'uk-num' }, h('b', null, String(data.confidence ?? '—')), ' 置信度'),
              ),
            ),
          ),
        ),

        state.error ? h('div', { className: 'uk-sheet' }, h('div', { className: 'uk-empty' }, '接口报错：' + state.error)) : null,
        state.loading ? h('div', { className: 'uk-empty' }, '刷新中…') : null,
        !ok && !state.loading ? h('div', { className: 'uk-sheet' }, h('div', { className: 'uk-empty' }, COPY.empty)) : null,

        // 其之一：结论
        ok && h('div', { className: 'uk-sheet' },
          h('div', { className: 'uk-band', style: { '--band': PIGMENT.beni } }),
          h('div', { className: 'uk-view-tag' }, h('span', { className: 'uk-medallion' }, '一'), '判定'),
          h('div', { className: 'uk-verdict', style: { marginTop: 8 } }, data.verdict || '（无）'),
          mix.length > 0 && h('div', { className: 'uk-chips' }, mix.map((m, i) => h('span', {
            key: i, className: 'uk-chip',
            style: { '--tone': [PIGMENT.pale, PIGMENT.ochre, '#b9cfc0', '#d9c4cf'][i % 4] },
          }, `${m.label_zh || m.label} ${Math.round((m.ratio || 0) * 100)}%`))),
        ),

        // 其之二：画面与包装
        ok && (aspects.length > 0 || packaging.length > 0) && h('div', { className: 'uk-sheet' },
          h('div', { className: 'uk-band', style: { '--band': PIGMENT.indigo } }),
          h('div', { className: 'uk-view-tag' }, h('span', { className: 'uk-medallion' }, '二'), '画面与包装'),
          aspects.length > 0 && h('div', { style: { marginTop: 8 } }, h('div', { className: 'uk-muted' }, '画面构成'), h('ul', { className: 'uk-list' }, aspects.map((a, i) => h('li', { key: i }, a)))),
          packaging.length > 0 && h('div', { style: { marginTop: 8 } }, h('div', { className: 'uk-muted' }, '后期叠加'), h('ul', { className: 'uk-list' }, packaging.map((p, i) => h('li', { key: i }, p)))),
        ),

        // 其之三：可信度
        ok && data.vlm && h('div', { className: 'uk-sheet' },
          h('div', { className: 'uk-band', style: { '--band': PIGMENT.moss } }),
          h('div', { className: 'uk-view-tag' }, h('span', { className: 'uk-medallion' }, '三'), '可信度提示'),
          h('div', { className: 'uk-muted', style: { marginTop: 8 } }, data.vlm),
        ),

        // 其之四：产物
        ok && h('div', { className: 'uk-sheet' },
          h('div', { className: 'uk-band', style: { '--band': PIGMENT.ochre } }),
          h('div', { className: 'uk-view-tag' }, h('span', { className: 'uk-medallion' }, '四'), '产物'),
          h('div', { className: 'uk-muted', style: { marginTop: 8 } }, data.report || ''),
          h('div', { className: 'uk-muted', style: { marginTop: 4 } }, '完整报告含逐镜关键帧、证据、音轨图与复刻方案。'),
          h('button', { className: 'uk-btn', style: { marginTop: 10 }, onClick: () => copy(copyIndex, '复刻索引') }, '复制复刻索引 → AI'),
        ),

        toast ? h('div', { className: 'uk-toast' }, toast) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
      // 隐式工作台开关（无 UI）：localStorage 里写 dsh-workbench-off 即可关掉某个 tab；默认全开
      try {
        const _off = JSON.parse(window.localStorage.getItem('dsh-workbench-off') || '{}');
        if (_off['rea-video'] === true) return;
      } catch (e) { /* localStorage 不可用就当全开 */ }
        try {
          ctx.slots.inject('conversation.view', () => ctx.slots.register({
            name: 'conversation.view',
            id: 'rea-video',
            order: 25,
            label: () => TITLE,
          }, Workbench))
        } catch (error) { /* slot already taken by a stale instance */ }
      },
    }
  },
})
