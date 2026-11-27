/**
 * dsh-writing-workbench · 浏览器半边（1930s 橡皮管卡通皮肤）
 *
 * 黑白手绘、万物随爵士呼吸、橡皮管肢体、pie eyes、4:3 胶片门、
 * line boil 抖动、胶片划痕与闪烁。题材标签页切换。
 * 数据从 /writing-workbench/state 读，与 writing_style 工具同一份。
 */
window.__ModuleLoader__.load({
  id: '@zhuobichen/dsh-writing-workbench',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    const TITLE = '写作工作台'
    const API = '/writing-workbench/state'

    const COPY = {
      kicker: 'THE WRITING WORKS // EVERY PAGE IS ALIVE',
      title: '写作工作台',
      line: '翻开一页，每种题材都跟着爵士乐跳起来',
      cards: '点卡片看写法 · 复制引用粘给 AI',
    }

    // 4:3 gate 里的橡皮管小人：肢体是等宽管子，pie eyes，白手套，随拍子呼吸
    function HoseDancer() {
      return h('svg', { viewBox: '0 0 200 120', width: '100%', height: '100%', 'aria-hidden': 'true' },
        // 胶片门（4:3 居中，圆角，内阴影）
        h('rect', { x: 4, y: 4, width: 192, height: 112, rx: 10, fill: '#e8e8e6', stroke: '#1a1a1a', 'stroke-width': 4 }),
        // 背景水彩横带（中灰，随呼吸轻微缩放）
        h('g', { className: 'rh-bg' },
          h('path', { d: 'M10 84 q40 -14 90 0 t90 0 V112 H10 Z', fill: '#bdbdbd', opacity: '.7' }),
          h('path', { d: 'M10 96 q50 -8 90 0 t90 0 V112 H10 Z', fill: '#a8a8a8', opacity: '.55' }),
        ),
        // 橡皮管身体：等宽管子，圆帽，一个弯
        h('path', { className: 'rh-limb', d: 'M70 96 q-14 -26 8 -40', fill: 'none', stroke: '#1a1a1a', 'stroke-width': 9, 'stroke-linecap': 'round' }),
        h('path', { className: 'rh-limb rh-limb2', d: 'M98 96 q16 -24 -4 -38', fill: 'none', stroke: '#1a1a1a', 'stroke-width': 9, 'stroke-linecap': 'round' }),
        // 胳膊举起来打拍子
        h('path', { className: 'rh-arm', d: 'M78 62 q-20 -12 -30 -30', fill: 'none', stroke: '#1a1a1a', 'stroke-width': 7, 'stroke-linecap': 'round' }),
        h('circle', { cx: 46, cy: 30, r: 8, fill: '#fafafa', stroke: '#1a1a1a', 'stroke-width': 3 }),
        // 大圆鞋
        h('ellipse', { cx: 64, cy: 100, rx: 14, ry: 5, fill: '#1a1a1a' }),
        h('ellipse', { cx: 100, cy: 100, rx: 14, ry: 5, fill: '#1a1a1a' }),
        // 头（白）：pie eyes + 笑嘴
        h('circle', { cx: 84, cy: 46, r: 22, fill: '#fafafa', stroke: '#1a1a1a', 'stroke-width': 4 }),
        h('ellipse', { cx: 77, cy: 44, rx: 7, ry: 10, fill: '#fff', stroke: '#1a1a1a', 'stroke-width': 2.5 }),
        h('ellipse', { cx: 91, cy: 44, rx: 7, ry: 10, fill: '#fff', stroke: '#1a1a1a', 'stroke-width': 2.5 }),
        h('circle', { cx: 79, cy: 45, r: 4.2, fill: '#1a1a1a' }),
        h('circle', { cx: 93, cy: 45, r: 4.2, fill: '#1a1a1a' }),
        h('path', { d: 'M72 42 l5 -2 M89 42 l5 -2', stroke: '#1a1a1a', 'stroke-width': 2 }), // wedge cut
        h('path', { d: 'M76 54 q8 8 16 0', fill: 'none', stroke: '#1a1a1a', 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
        // 翻飞的稿纸（万物有生命）
        h('g', { className: 'rh-paper' },
          h('path', { d: 'M130 40 l22 -6 l3 20 l-22 6 z', fill: '#fafafa', stroke: '#1a1a1a', 'stroke-width': 2.5 }),
          h('path', { d: 'M135 46 l12 -3 M135 51 l10 -2', stroke: '#1a1a1a', 'stroke-width': 1.6 }),
        ),
        // 音符随拍子跳
        h('text', { x: 156, y: 34, className: 'rh-note', fill: '#1a1a1a', 'font-size': 20, 'font-family': 'serif' }, '♪'),
        h('text', { x: 170, y: 56, className: 'rh-note rh-note2', fill: '#1a1a1a', 'font-size': 16, 'font-family': 'serif' }, '♫'),
      )
    }

      // 卡片星数徽章：从 sources label 的「★ N」提取，GitHub 来源才显示
      function wrStarsOf(entry) {
        for (const s of (entry.sources || [])) {
          const m = String(s.label || '').match(/★\s*([\d.]+k?)/)
          if (m) return el('span', { className: 'wr-stars', title: 'GitHub stars' }, '★ ' + m[1])
        }
        return null
      }

    let styleDone = false
    function useStyleOnce() {
      if (styleDone) return
      styleDone = true
      try {
        if (document.querySelector('style[data-wrubber]')) return
        const tag = document.createElement('style')
        tag.setAttribute('data-wrubber', '1')
        tag.textContent = `
          /* 1930s 橡皮管卡通：严格灰阶、线稿毛边、4:3 胶片门 */
.wr-stars{display:none;font-family:ui-monospace,Consolas,monospace;font-size:10px;color:#1a1a1a;border:2px solid #1a1a1a;border-radius:999px;padding:0 6px;background:#fafafa;}
          .wr-wrap{--ink:#1a1a1a;--paper:#fafafa;--mid:#bdbdbd;--grey:#8a8a8a;--line:rgba(26,26,26,.28);
            display:flex;flex-direction:column;gap:14px;padding:18px 20px 48px;height:100%;overflow:auto;overflow-x:hidden;box-sizing:border-box;
            font-family:Georgia,'Times New Roman',serif;color:var(--ink);
            background:#e6e6e4;background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.025) 0 1px,transparent 1px 4px);}
          /* 胶片门：4:3 圆角 + 内阴影 + 轻微 gate weave */
          .wr-gate{position:relative;border:4px solid var(--ink);border-radius:14px;background:var(--paper);box-shadow:inset 0 0 26px rgba(0,0,0,.28),6px 7px 0 rgba(26,26,26,.18);
            overflow:hidden;animation:gateWeave 5.5s steps(1) infinite;}
          @keyframes gateWeave{0%{transform:translate(0,0)}24%{transform:translate(.6px,-.4px)}48%{transform:translate(-.5px,.5px)}72%{transform:translate(.4px,.6px)}100%{transform:translate(0,0)}}
          /* 划痕与灰尘 */
          .wr-gate:after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;
            background:linear-gradient(90deg,transparent 18%,rgba(0,0,0,.16) 18.3%,transparent 18.6%),linear-gradient(90deg,transparent 71%,rgba(0,0,0,.12) 71.2%,transparent 71.5%);}
          .wr-hero{display:flex;gap:16px;align-items:center;padding:14px 16px;}
          .wr-hero-art{flex:0 0 190px;height:114px;}
          .wr-kicker{font-family:ui-monospace,Consolas,monospace;font-size:10px;letter-spacing:.22em;color:#444;}
          .wr-title{font-size:30px;font-weight:900;letter-spacing:.02em;margin:4px 0 6px;color:var(--ink);text-shadow:2px 2px 0 rgba(0,0,0,.12);}
          .wr-line{font-size:13px;color:#333;line-height:1.5;}
          .wr-metrics{display:flex;gap:12px;flex-wrap:wrap;margin-top:9px;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#555;}
          .wr-metrics b{font-size:15px;color:var(--ink);}
          /* 题材标签页：像纸片一样翻起 */
          .wr-tabs{display:flex;gap:9px;flex-wrap:wrap;}
          .wr-tab{font-family:Georgia,serif;font-size:14px;font-weight:700;padding:7px 17px;border:3px solid var(--ink);border-radius:20px;background:var(--paper);color:var(--ink);cursor:pointer;
            box-shadow:2px 3px 0 var(--ink);transform-origin:bottom center;animation:tabBreathe 1.6s ease-in-out infinite;transition:background .15s;}
          .wr-tab:hover{transform:translateY(-2px) rotate(-2deg);}
          .wr-tab-on{background:var(--ink);color:var(--paper);animation:tabBounce .5s cubic-bezier(.2,1.6,.4,1);}
          .wr-tab-n{font-family:ui-monospace,Consolas,monospace;font-size:10px;opacity:.7;margin-left:4px;}
          @keyframes tabBreathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.94)}}
          @keyframes tabBounce{0%{transform:translateY(-14px) rotate(-8deg)}60%{transform:translateY(2px) rotate(2deg)}100%{transform:none}}
          .wr-hint{font-size:12px;color:#555;font-family:ui-monospace,Consolas,monospace;}
          /* 卡片：像橡皮管一样随拍子挤压伸展 */
          .wr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr));gap:12px;}
          .wr-card{border:3px solid var(--ink);border-radius:12px;padding:13px 15px;background:var(--paper);cursor:pointer;text-align:left;font:inherit;color:inherit;
            box-shadow:3px 4px 0 var(--ink);transform-origin:bottom center;animation:cardBreathe 1.6s ease-in-out infinite;}
          .wr-card:nth-child(2n){animation-delay:.2s}.wr-card:nth-child(3n){animation-delay:.4s}
          .wr-card:hover{animation:none;transform:translateY(-4px) rotate(-1.5deg) scaleY(1.03);box-shadow:5px 7px 0 var(--ink);}
          @keyframes cardBreathe{0%,100%{transform:scaleY(1) scaleX(1)}50%{transform:scaleY(.965) scaleX(1.02)}}
          .wr-card-name{font-size:15px;font-weight:800;display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
          .wr-origin{font-family:ui-monospace,Consolas,monospace;font-size:10px;padding:0 6px;border:1.5px solid var(--ink);border-radius:999px;}
          .wr-line2{font-size:12px;color:#333;line-height:1.55;margin-top:5px;}
          .wr-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px;}
          .wr-tag{font-size:10px;padding:0 6px;border:1.5px solid var(--ink);border-radius:999px;color:#333;}
          .wr-empty{border:2px dashed var(--ink);border-radius:10px;padding:16px;font-size:13px;color:#444;}
          /* 详情弹层：老式片尾字幕卡 */
          .wr-modal{position:fixed;inset:0;z-index:9000;background:rgba(26,26,26,.65);display:flex;align-items:center;justify-content:center;padding:24px;}
          .wr-modal-card{background:var(--paper);border:4px double var(--ink);border-radius:8px;box-shadow:8px 9px 0 rgba(0,0,0,.4);width:min(860px,100%);max-height:88vh;overflow:auto;padding:18px 20px;display:flex;flex-direction:column;gap:12px;}
          .wr-modal-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
          .wr-b{font-size:17px;font-weight:800;}
          .wr-pre{white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.6;border:2px solid var(--ink);border-radius:6px;padding:10px;background:#f2f2f0;}
          .wr-btn{font-family:Georgia,serif;font-size:13px;font-weight:700;padding:5px 13px;border:3px solid var(--ink);border-radius:8px;background:var(--paper);color:var(--ink);cursor:pointer;box-shadow:2px 3px 0 var(--ink);}
          .wr-btn:active{transform:translate(2px,3px);box-shadow:none;}
          .wr-close{margin-left:auto;width:28px;height:28px;border-radius:50%;border:2px solid var(--ink);background:transparent;cursor:pointer;font-weight:700;}
          .wr-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:9600;background:var(--ink);color:var(--paper);font-size:12px;padding:7px 16px;border-radius:999px;}
          /* 部件动画：随爵士呼吸 */
          .rh-bg{transform-origin:center bottom;animation:rhBreathe 1.6s ease-in-out infinite;}
          .rh-limb,.rh-limb2{transform-origin:center bottom;animation:rhStretch 1.6s ease-in-out infinite;}
          .rh-limb2{animation-delay:.8s}
          .rh-arm{transform-origin:78px 62px;animation:rhWave .8s ease-in-out infinite;}
          .rh-paper{transform-origin:140px 46px;animation:rhPaper 1.6s ease-in-out infinite;}
          .rh-note{animation:rhNote 1.6s ease-in-out infinite;}
          .rh-note2{animation:rhNote 1.6s ease-in-out .8s infinite;}
          @keyframes rhBreathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.04)}}
          @keyframes rhStretch{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.06)}}
          @keyframes rhWave{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(10deg)}}
          @keyframes rhPaper{0%,100%{transform:rotate(-6deg) translateY(0)}50%{transform:rotate(8deg) translateY(-6px)}}
          @keyframes rhNote{0%,100%{transform:translateY(0);opacity:.9}50%{transform:translateY(-9px);opacity:1}}
          @media(prefers-reduced-motion:reduce){.wr-tab,.wr-card,.rh-bg,.rh-limb,.rh-limb2,.rh-arm,.rh-paper,.rh-note,.wr-gate{animation:none}}
        `
        document.head.appendChild(tag)
      } catch (e) { /* 样式失败不影响功能 */ }
    }

    function copyText(t) {
      try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(() => true, () => false) } catch (e) {}
      return Promise.resolve(false)
    }

    function Workbench() {
      useStyleOnce()
      const [state, setState] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [pageId, setPageId] = React.useState('')
      const [openId, setOpenId] = React.useState('')
      const [toast, setToast] = React.useState('')

      React.useEffect(() => {
        fetch(API, { cache: 'no-store' }).then((r) => r.json()).then((j) => {
          if (!j || j.ok !== true) { setErr((j && j.error) || '状态接口异常'); return }
          setErr(''); setState(j)
        }).catch((e) => setErr(String((e && e.message) || e)))
      }, [])

      const copy = (t, what) => copyText(t).then((ok) => {
        setToast(ok ? what + ' 已复制' : '复制被拦了：手动选中上面那段')
        setTimeout(() => setToast(''), 2400)
      })

      const pages = (state && state.pages) || []
      const page = pages.find((p) => p.id === pageId) || pages[0] || null
      const entries = page ? page.entries : []
      const open = (function () {
        for (const p of pages) { const e = p.entries.find((x) => x.id === openId); if (e) return e }
        return null
      })()
      const refText = (e) => [
        `用写作工作台里的「${e.name}」（${page ? page.name : ''} · ${e.id}），按这个写法来。`,
        (e.sources || []).find((s) => s.url || s.path) ? `原始材料：${((e.sources || []).find((s) => s.url || s.path).url || (e.sources || []).find((s) => s.url || s.path).path)}` : '',
        `要看完整规格：writing_style op=get ${e.id}`,
      ].filter(Boolean).join('\n')

      return h('div', { className: 'wr-wrap' },
        h('div', { className: 'wr-gate' },
          h('div', { className: 'wr-hero' },
            h('div', { className: 'wr-hero-art' }, h(HoseDancer)),
            h('div', null,
              h('div', { className: 'wr-kicker' }, COPY.kicker),
              h('div', { className: 'wr-title' }, COPY.title),
              h('div', { className: 'wr-line' }, COPY.line),
              h('div', { className: 'wr-metrics' },
                h('span', null, h('b', null, String(pages.length)), ' 种题材'),
                h('span', null, h('b', null, String(state ? state.total : 0)), ' 种写法'),
                h('span', null, h('b', null, 'writing_style'), ' AI 通道'),
              ),
            ),
          ),
        ),

        err ? h('div', { className: 'wr-empty' }, '接口报错：' + err) : null,
        !state ? h('div', { className: 'wr-empty' }, '胶片装载中…') : null,

        h('div', { className: 'wr-tabs' },
          pages.map((p) => h('button', {
            key: p.id, type: 'button',
            className: 'wr-tab' + (page && page.id === p.id ? ' wr-tab-on' : ''),
            onClick: () => setPageId(p.id), title: p.hint,
          }, p.name, h('span', { className: 'wr-tab-n' }, String(p.entries.length)))),
        ),
        page ? h('div', { className: 'wr-hint' }, page.hint + ' · ' + COPY.cards) : null,

        h('div', { className: 'wr-grid' },
          entries.map((e) => h('div', {
            key: e.id, role: 'button', tabIndex: 0,
            className: 'wr-card',
            onClick: () => setOpenId(e.id),
            onKeyDown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setOpenId(e.id) } },
          },
            h('div', { className: 'wr-card-name' }, e.name,
              h('span', { className: 'wr-origin' }, e.origin === 'mine' ? '自制' : '引用')),wrStarsOf(e),
            h('div', { className: 'wr-line2' }, e.oneLine),
            h('div', { className: 'wr-tags' }, (e.tags || []).map((t) => h('span', { key: t, className: 'wr-tag' }, t))),
          )),
        ),
        entries.length === 0 ? h('div', { className: 'wr-empty' }, '这一页还没写到东西。') : null,

        open ? h('div', { className: 'wr-modal', onClick: (ev) => { if (ev.target === ev.currentTarget) setOpenId('') } },
          h('div', { className: 'wr-modal-card' },
            h('div', { className: 'wr-modal-head' },
              h('b', { className: 'wr-b' }, open.name),
              h('span', { className: 'wr-origin' }, open.origin === 'mine' ? '自制' : '引用'),
              h('button', { className: 'wr-close', onClick: () => setOpenId(''), title: '关闭' }, '×'),
            ),
            h('div', { className: 'wr-line2' }, open.oneLine),
            h('div', { style: { fontSize: 12, fontWeight: 700 } }, '要点'),
            h('ul', { style: { margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8 } }, (open.bullets || []).map((b, i) => h('li', { key: i }, b))),
            h('div', { className: 'wr-line2' }, '怎么用：' + open.howto),
            (open.sources || []).length > 0 ? h('div', null,
              h('div', { style: { fontSize: 12, fontWeight: 700 } }, '原始材料'),
              (open.sources || []).map((s, i) => h('div', { key: i, className: 'wr-line2' }, `${s.label}：${s.url || s.path}`)),
            ) : null,
            h('pre', { className: 'wr-pre' }, refText(open)),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              h('button', { className: 'wr-btn', onClick: () => copy(refText(open), '引用') }, '复制引用（索引）'),
              h('button', { className: 'wr-btn', onClick: () => setOpenId('') }, '关闭'),
            ),
          ),
        ) : null,

        toast ? h('div', { className: 'wr-toast' }, toast) : null,
      )
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view', id: 'writing-workbench', order: 26, label: () => TITLE,
      }, Workbench))
    }

    exports.name = 'dsh-writing-workbench'
    exports.inject = ['slots']
    exports.apply = apply

    return module.exports
  },
})
