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
  id: '@zhuobichen/dsh-design-workbench',
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
    // ── 代码生视频：八种风格的真预览 ─────────────────────────────────
    //
    // 这些不是截图，是**能动的 HTML/CSS**：面板里 iframe 一挂，风格自己就在演。
    // 纯 CSS 动画，无脚本（sandbox=""），所以既安全也不拖慢面板。
    const DEMOS = {
      'cv-style-kinetic-type': `<html><body style="margin:0;background:#0e0e10;overflow:hidden;font-family:Inter,system-ui,-apple-system,sans-serif">
<style>
.w{position:absolute;inset:0;overflow:hidden}
.a{position:absolute;left:7%;top:18%;font-size:clamp(34px,11vw,64px);font-weight:900;letter-spacing:-.04em;color:#fff;animation:cycle 4.4s cubic-bezier(.2,.9,.2,1) infinite}
.b{position:absolute;left:7%;top:50%;font-size:clamp(34px,11vw,64px);font-weight:900;letter-spacing:-.04em;color:#ff4d4d;animation:cycle 4.4s .28s cubic-bezier(.2,.9,.2,1) infinite}
.t{position:absolute;right:7%;bottom:16%;font-size:10px;letter-spacing:.22em;color:#9a9a9a;animation:fade .8s 1.1s both}
.bar{position:absolute;left:0;bottom:0;height:4px;width:0;background:#ff4d4d;animation:grow 2.2s ease-out both}
@keyframes cycle{0%{transform:translateY(60%) scale(.94);opacity:0}12%{transform:none;opacity:1}76%{transform:none;opacity:1}100%{transform:translateY(-8%);opacity:0}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes grow{to{width:100%}}
</style><div class=w><div class=a>CODE</div><div class=b>VIDEO</div><div class=t>KINETIC TYPE</div><div class=bar></div></div></body></html>`,

      'cv-style-dataviz': `<html><body style="margin:0;background:#0b1220;overflow:hidden;font-family:Inter,system-ui,sans-serif;color:#e2e8f0">
<style>
.w{position:absolute;inset:0;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.h{font-size:11px;color:#94a3b8;letter-spacing:.06em}
.n{font-size:26px;font-weight:800;color:#f8fafc;animation:up .8s ease-out both}
.chart{display:flex;align-items:flex-end;gap:6px;flex:1;min-height:0;border-bottom:1px solid #1e293b}
.b{flex:1;background:linear-gradient(180deg,#38bdf8,#1d4ed8);border-radius:3px 3px 0 0;transform-origin:bottom;animation:g .9s cubic-bezier(.2,.9,.2,1) both}
.grid{position:absolute;inset:44px 16px 18px;background-image:linear-gradient(#1e293b 1px,transparent 1px);background-size:100% 25%;opacity:.5;pointer-events:none}
@keyframes g{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes up{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}
</style><div class=w><div class=h>Q3 增长</div><div class=n>+38.4%</div><div class=grid></div><div class=chart>
<div class=b style="height:28%;animation-delay:.05s"></div><div class=b style="height:44%;animation-delay:.15s"></div>
<div class=b style="height:36%;animation-delay:.25s"></div><div class=b style="height:62%;animation-delay:.35s"></div>
<div class=b style="height:74%;animation-delay:.45s"></div><div class=b style="height:56%;animation-delay:.55s"></div>
<div class=b style="height:88%;animation-delay:.65s"></div></div></div></body></html>`,

      'cv-style-terminal': `<html><body style="margin:0;background:#0b0f14;overflow:hidden;font-family:ui-monospace,Consolas,monospace;color:#c9d4e3">
<style>
.w{position:absolute;inset:0;padding:0;display:flex;flex-direction:column}
.bar{display:flex;gap:5px;padding:7px 9px;background:#121a22;border-bottom:1px solid #1e2a36}
.d{width:8px;height:8px;border-radius:50%}
.p{padding:9px 11px;font-size:10.5px;line-height:1.75;flex:1}
.i{color:#22c55e}.m{color:#94a3b8}.ok{color:#38bdf8}
.l{width:0;overflow:hidden;white-space:nowrap;animation:type .7s steps(28) both}
.l:nth-child(2){animation-delay:.5s}.l:nth-child(3){animation-delay:1.1s}.l:nth-child(4){animation-delay:1.7s}
.c{display:inline-block;width:7px;height:12px;background:#c9d4e3;animation:blink 1s steps(1) infinite;vertical-align:-2px}
@keyframes type{to{width:100%}}
@keyframes blink{50%{opacity:0}}
</style><div class=w><div class=bar><span class=d style="background:#ff5f57"></span><span class=d style="background:#febc2e"></span><span class=d style="background:#28c840"></span></div>
<div class=p><div class=l><span class=i>$</span> npm run build</div><div class=l><span class=m>→ bundling 42 modules…</span></div><div class=l><span class=ok>✓ built in 1.8s</span></div><div>$ <span class=c></span></div></div></div></body></html>`,

      'cv-style-whiteboard': `<html><body style="margin:0;background:#f7f5f0;overflow:hidden;font-family:Georgia,serif;color:#2b2b2b">
<style>
svg{position:absolute;inset:0;width:100%;height:100%}
path,rect,line{stroke:#2b2b2b;stroke-width:2.4;fill:none;stroke-linecap:round;stroke-linejoin:round;
  stroke-dasharray:600;stroke-dashoffset:600;animation:draw 1.6s ease-out both}
rect{animation-delay:.15s} line{animation-delay:.9s} path.a{animation-delay:1.2s}
.t{position:absolute;left:26%;top:26%;font-size:13px;opacity:0;animation:pop .5s 1.6s both}
.s{position:absolute;right:9%;bottom:12%;font-size:10px;color:#8a7f6a;opacity:0;animation:pop .6s 2s both}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
</style>
<svg viewBox="0 0 320 180"><rect x="34" y="46" width="118" height="62" rx="4"/><line x1="152" y1="77" x2="206" y2="77"/><path class=a d="M198 71 L208 77 L198 83"/><circle cx="238" cy="77" r="26"/><path class=a d="M238 63 v28 M224 77 h28"/></svg>
<div class=t>SIGN UP</div><div class=s>先画问题，再画答案</div></body></html>`,

      'cv-style-product-ui': `<html><body style="margin:0;background:#12151c;overflow:hidden;font-family:Inter,system-ui,sans-serif">
<style>
.w{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.phone{width:41%;height:88%;border-radius:18px;background:#0b0e13;border:1px solid #2a3242;overflow:hidden;position:relative}
.scr{position:absolute;inset:6px;border-radius:13px;background:#f7f8fb;overflow:hidden}
.list{position:absolute;left:0;right:0;top:0;animation:scroll 4s ease-in-out infinite alternate}
.row{height:26px;margin:5px 7px;border-radius:6px;background:#e8ecf5;display:flex;align-items:center;padding:0 7px;font-size:8px;color:#5b6478}
.row.hi{background:#4d6bfe;color:#fff}
.cur{position:absolute;width:12px;height:12px;border-radius:50%;background:rgba(255,255,255,.9);box-shadow:0 0 0 1.5px #4d6bfe;animation:tap 4s ease-in-out infinite}
.cap{position:absolute;right:8%;top:14%;font-size:9px;color:#8a93a6;letter-spacing:.14em}
@keyframes scroll{0%{transform:translateY(0)}100%{transform:translateY(-52px)}}
@keyframes tap{0%,55%{transform:translate(96px,86px) scale(1)}62%{transform:translate(96px,86px) scale(.82)}70%,100%{transform:translate(96px,86px) scale(1)}}
</style><div class=w><div class=cap>PRODUCT UI</div><div class=phone><div class=scr><div class=list>
<div class=row>今日任务</div><div class=row hi>发布新版本</div><div class=row>查看数据</div><div class=row>邀请成员</div><div class=row>设置</div><div class=row>帮助</div></div>
<div class=cur></div></div></div></div></body></html>`,

      'cv-style-parallax-cards': `<html><body style="margin:0;background:radial-gradient(120% 120% at 30% 20%,#241b3d,#0f0b18);overflow:hidden;font-family:Inter,system-ui,sans-serif">
<style>
.w{position:absolute;inset:0;perspective:600px}
.l{position:absolute;left:50%;top:50%;border-radius:12px;border:1px solid rgba(255,255,255,.16);
   background:rgba(255,255,255,.06);backdrop-filter:blur(6px);animation:float 6s ease-in-out infinite alternate}
.a{width:46%;height:58%;transform:translate(-50%,-50%) rotate(-6deg);animation-delay:0s}
.b{width:34%;height:44%;transform:translate(-50%,-50%) rotate(4deg);animation-delay:.7s;background:rgba(167,139,250,.18)}
.c{width:22%;height:30%;transform:translate(-50%,-50%) rotate(-2deg);animation-delay:1.4s;background:rgba(255,255,255,.12)}
.t{position:absolute;left:7%;bottom:9%;color:#e9e2ff;font-size:10px;letter-spacing:.18em;opacity:.8}
@keyframes float{from{translate:0 -6px}to{translate:0 6px}}
</style><div class=w><div class="l a"></div><div class="l b"></div><div class="l c"></div><div class=t>PARALLAX DEPTH</div></div></body></html>`,

      'cv-style-logo-reveal': `<html><body style="margin:0;background:#0b0b0d;overflow:hidden;font-family:Inter,system-ui,sans-serif">
<style>
.w{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.mark{width:46px;height:46px;border:2px solid #d4af37;border-radius:50%;position:relative;animation:in 1s cubic-bezier(.2,.9,.2,1) both}
.mark:after{content:'';position:absolute;inset:10px;border-radius:50%;background:#d4af37;animation:in .8s .3s both}
.word{margin-left:14px;font-size:22px;letter-spacing:.28em;color:#f5f5f5;clip-path:inset(0 100% 0 0);animation:wipe 1.1s .5s cubic-bezier(.2,.9,.2,1) both}
.sweep{position:absolute;top:0;bottom:0;width:40%;left:-40%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent);animation:sw 1.2s 1.3s both}
@keyframes in{from{transform:scale(.6);opacity:0}to{transform:none;opacity:1}}
@keyframes wipe{to{clip-path:inset(0 0 0 0)}}
@keyframes sw{to{left:120%}}
</style><div class=w><div style="display:flex;align-items:center;position:relative"><div class=mark></div><div class=word>NEXUS</div><div class=sweep></div></div></div></body></html>`,

      'cv-style-sprite-2d': `<html><body style="margin:0;background:#f3e9d2;overflow:hidden;font-family:Inter,system-ui,sans-serif">
<style>
.w{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;padding-bottom:18px}
.ch{width:56px;height:64px;position:relative;animation:bob .9s ease-in-out infinite alternate}
.head{position:absolute;left:6px;top:0;width:44px;height:42px;border-radius:22px 22px 18px 18px;background:#e07a5f}
.eye{position:absolute;top:18px;width:5px;height:6px;border-radius:50%;background:#3a2f22;animation:blink 3.2s infinite}
.body{position:absolute;left:12px;top:40px;width:32px;height:22px;border-radius:10px;background:#3a2f22}
.sh{position:absolute;bottom:10px;width:52px;height:6px;border-radius:50%;background:rgba(58,47,34,.16)}
.bub{position:absolute;left:58%;top:24%;background:#fff;border:2px solid #3a2f22;border-radius:10px;padding:5px 8px;font-size:10px;color:#3a2f22;animation:pop 2.6s ease-in-out infinite}
@keyframes bob{from{transform:translateY(0)}to{transform:translateY(-6px)}}
@keyframes blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
@keyframes pop{0%,20%{opacity:0;transform:scale(.9)}30%,80%{opacity:1;transform:none}100%{opacity:0}}
</style><div class=w><div class=ch><div class=head></div><div class=eye style="left:19px"></div><div class=eye style="left:33px"></div><div class=body></div></div><div class=bub>帧率 12–15 才像手绘</div><div class=sh style="position:absolute"></div></div></body></html>`,
    }

    function demoHtml(id) {
      return DEMOS[id] || ''
    }

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
          tag.textContent = [
            '.dw-wrap{display:flex;flex-direction:column;gap:12px;padding:16px 18px 40px;height:100%;overflow:auto;overflow-x:hidden;box-sizing:border-box;max-width:100%;font-size:13px;color:var(--dsw-alias-label-primary);}',
            '.dw-modal{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px;}',
            '.dw-modal-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.35);width:min(1040px,100%);max-height:88vh;overflow:auto;padding:16px 18px 18px;display:flex;flex-direction:column;gap:12px;}',
            '.dw-modal-head{display:flex;align-items:flex-start;gap:10px;}',
            '.dw-close{margin-left:auto;width:26px;height:26px;line-height:24px;text-align:center;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:15px;flex:0 0 auto;}',
            '.dw-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));}',
            '.dw-origin{font-size:10px;padding:0 6px;border-radius:999px;line-height:16px;border:1px solid transparent;white-space:nowrap;}',
            '.dw-origin-mine{color:#0f766e;background:rgba(15,118,110,.10);border-color:rgba(15,118,110,.25);}',
            '.dw-origin-ref{color:#9a3412;background:rgba(154,52,18,.10);border-color:rgba(154,52,18,.25);}',
            '.dw-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
            '.dw-title{font-size:15px;font-weight:600;}',
            '.dw-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--dsw-alias-border-l2);}',
            '.dw-muted{color:var(--dsw-alias-label-tertiary);}',
            '.dw-btn{padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;}',
            '.dw-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));}',
            '.dw-btn-primary{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff;background:var(--dsw-alias-brand-primary,#4d6bfe);}',
            '.dw-search{flex:1;min-width:140px;max-width:260px;padding:4px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font-size:12px;}',
            '.dw-layers{display:flex;gap:6px;flex-wrap:wrap;}',
            '.dw-layer{display:flex;align-items:center;gap:7px;padding:5px 13px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);font-size:12.5px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);}',
            '.dw-layer:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));}',
            '.dw-layer-on{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent;color:#fff;}',
            '.dw-layer-n{font-family:ui-monospace,Consolas,monospace;font-size:11px;opacity:.75;}',
            '.dw-chips{display:flex;gap:6px;flex-wrap:wrap;}',
            '.dw-chip{padding:1px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);font-size:11.5px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);}',
            '.dw-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));}',
            '.dw-chip-on{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent;color:#fff;}',
            '.dw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:12px;}',
            '.dw-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;background:var(--dsw-alias-bg-layer-1);padding:0;text-align:left;font:inherit;color:inherit;width:100%;}',
            '.dw-card:hover{border-color:var(--dsw-alias-border-l3);}',
            '.dw-card-on{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:-1px;}',
            '.dw-cover{height:150px;background:var(--dsw-alias-bg-layer-2);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;cursor:pointer;}',
            '.dw-cover iframe,.dw-cover img,.dw-cover .dw-poster,.dw-cover .dw-cover-ph{pointer-events:none;}',
            '.dw-cover-hit{position:absolute;inset:0;cursor:pointer;}',
            '.dw-nature{font-size:10px;padding:0 5px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);}',
            '.dw-cover img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block;}',
            '.dw-cover-ph{padding:16px;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary);text-align:center;}',
            '.dw-kind{position:absolute;top:6px;left:6px;padding:0 7px;border-radius:999px;font-size:10px;line-height:17px;background:rgba(0,0,0,.55);color:#fff;}',
            '.dw-poster{position:relative;width:100%;height:100%;display:flex;align-items:flex-end;overflow:hidden;}',
            '.dw-poster-big{min-height:260px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;}',
            '.dw-poster-pat{position:absolute;inset:0;opacity:.35;}',
            '.dw-poster[data-pattern=grid] .dw-poster-pat{background-image:linear-gradient(rgba(255,255,255,.35) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.35) 1px,transparent 1px);background-size:22px 22px;}',
            '.dw-poster[data-pattern=dots] .dw-poster-pat{background-image:radial-gradient(rgba(255,255,255,.5) 1.5px,transparent 1.6px);background-size:14px 14px;}',
            '.dw-poster[data-pattern=stripes] .dw-poster-pat{background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.28) 0 2px,transparent 2px 12px);}',
            '.dw-poster[data-pattern=blot] .dw-poster-pat{background:radial-gradient(circle at 25% 35%,rgba(255,255,255,.35),transparent 55%),radial-gradient(circle at 70% 68%,rgba(255,255,255,.22),transparent 50%);}',
            '.dw-poster[data-pattern=rays] .dw-poster-pat{background:repeating-conic-gradient(from 0deg at 50% 130%,rgba(255,255,255,.25) 0deg 4deg,transparent 4deg 10deg);}',
            '.dw-poster-txt{position:relative;padding:10px 12px;display:flex;flex-direction:column;gap:2px;min-width:0;}',
            '.dw-poster-name{font-size:12.5px;font-weight:600;line-height:1.35;}',
            '.dw-poster-tags{font-size:10.5px;opacity:.85;}',
            '.dw-card-body{padding:9px 11px 10px;display:flex;flex-direction:column;gap:5px;}',
            '.dw-card-name{font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;}',
            '.dw-card-line{font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
            '.dw-tags{display:flex;gap:5px;flex-wrap:wrap;}',
            '.dw-tag{font-size:10.5px;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);}',
            '.dw-detail{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-1);}',
            '.dw-detail-head{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;}',
            '.dw-two{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:14px;}',
            '@media (max-width:900px){.dw-two{grid-template-columns:1fr;}}',
            '.dw-big{width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);}',
            '.dw-big img{width:100%;max-height:340px;object-fit:contain;object-position:top center;display:block;}',
            '.dw-src{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary);word-break:break-all;line-height:1.5;}',
            '.dw-pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.55;background:var(--dsw-alias-bg-layer-2);padding:9px 10px;border-radius:7px;max-height:300px;overflow:auto;}',
            '.dw-bullets{margin:0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:4px;font-size:12px;line-height:1.6;}',
            '.dw-bullets li:before{content:"· ";color:var(--dsw-alias-label-tertiary);}',
                        '.dw-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:26px;z-index:9600;padding:6px 14px;border-radius:999px;background:#16a34a;color:#fff;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,.25);}',
          ].join('\n')
          document.head.appendChild(tag)
        } catch {
          /* 样式失败不影响功能 */
        }
      }

      /** 先试 Clipboard API（要 await，失败会 reject），再退回 execCommand。 */
      function copyText(text) {
        function legacy() {
          try {
            const ta = document.createElement('textarea')
            ta.value = text
            ta.style.position = 'fixed'
            ta.style.left = '-9999px'
            ta.setAttribute('readonly', '')
            document.body.appendChild(ta)
            ta.select()
            ta.setSelectionRange(0, ta.value.length)
            const ok = document.execCommand('copy')
            document.body.removeChild(ta)
            return ok === true
          } catch {
            return false
          }
        }
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          return navigator.clipboard.writeText(text).then(
            function () { return true },
            function () { return legacy() },
          )
        }
        return Promise.resolve(legacy())
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

      const KIND_LABEL = { image: '图', tokens: '样式', text: '文档' }

      /** 纯文字条目的海报：用自己的配色画一个可辨认的图案，不假装是成品帧。 */
      function Poster(props) {
        const e = props.entry
        const sw = e.swatch
        return el('div', {
          className: 'dw-poster' + (props.big === true ? ' dw-poster-big' : ''),
          'data-pattern': sw.pattern,
          style: { background: 'linear-gradient(135deg,' + sw.a + ',' + sw.b + ')', color: sw.fg },
        },
          el('div', { className: 'dw-poster-pat' }),
          el('div', { className: 'dw-poster-txt' },
            el('div', { className: 'dw-poster-tags', style: { color: sw.accent } }, (e.tags || []).join(' · ')),
          ),
        )
      }


      /** 卡片/详情共用的视觉区：有封面放图，样式类放换皮预览，纯文字给个摘要。 */
      function Visual(props) {
        const e = props.entry
        const big = props.big === true
        if (e.kind === 'tokens' && e.style) {
          return el('iframe', {
            srcDoc: previewHtml(e.style, big),
            sandbox: '',
            style: big ? PREVIEW_FRAME_BIG : PREVIEW_FRAME,
            scrolling: 'no',
            title: e.name + ' 预览',
          })
        }
        // 代码生视频的风格：直接跑一段会动的 HTML/CSS
        if (e.kind === 'demo' && demoHtml(e.id) !== '') {
          return el('iframe', {
            srcDoc: demoHtml(e.id),
            sandbox: '',
            style: big ? { width: '100%', height: 280, border: '0', display: 'block' } : { width: '100%', height: 132, border: '0', display: 'block' },
            scrolling: 'no',
            title: e.name + ' 预览',
          })
        }
        // 本地副本优先（工作台不该因为没网就白屏），没有才用远程 URL
        const src = e.cover ? API + '/cover/' + encodeURIComponent(e.id) : e.coverUrl || ''
        if (e.kind === 'image' && src !== '') {
          return big
            ? el('div', { className: 'dw-big' }, el('img', { src: src, alt: e.name, draggable: false }))
            : el('img', { src: src, alt: e.name, loading: 'lazy', draggable: false })
        }
        // 有点配色就用海报；没有才退回文字块
        if (e.swatch) return el(Poster, { entry: e, big: big })
        return el('div', { className: 'dw-cover-ph' },
          (e.bullets || []).slice(0, 2).map(function (b, i) { return el('div', { key: i }, '· ' + b) }),
          (e.bullets || []).length === 0 ? e.oneLine : null,
        )
      }

      function Panel() {
        useStyleOnce()
        const [state, setState] = useState(null)
        const [err, setErr] = useState('')
        const [layer, setLayer] = useState('')
        const [scope, setScope] = useState('both')
        const [tag, setTag] = useState('')
        const [origin, setOrigin] = useState('')
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
            })
            .catch(function (e) { setErr(String((e && e.message) || e)) })
        }

        useEffect(function () { load() }, [])

        const layers = (state && state.layers) || []
        const activeLayer = layer || (layers[0] && layers[0].id) || 'app'
        const current = layers.filter(function (l) { return l.id === activeLayer })[0] || layers[0] || null

        // scope：只看风格 / 风格+素材（默认，隐藏方法）/ 全部
        const keepNature = function (e) {
          const n = e.nature || 'style'
          if (scope === 'style') return n === 'style'
          if (scope === 'all') return true
          return n !== 'method'
        }

        const shown = useMemo(function () {
          if (current === null) return []
          const q = query.trim().toLowerCase()
          return current.entries.filter(function (e) {
            if (origin !== '' && e.origin !== origin) return false
            if (tag !== '' && (e.tags || []).indexOf(tag) < 0) return false
            if (scope === 'style' && (e.nature || 'style') !== 'style') return false
            if (scope === 'both' && (e.nature || 'style') === 'method') return false
            if (q === '') return true
            return (e.name + ' ' + e.oneLine + ' ' + (e.tags || []).join(' ') + ' ' + e.id + ' ' + e.source).toLowerCase().indexOf(q) >= 0
          })
        }, [current, tag, origin, query, scope])

        const allTags = useMemo(function () {
          if (current === null) return []
          const set = []
          current.entries.forEach(function (e) { (e.tags || []).forEach(function (t) { if (set.indexOf(t) < 0) set.push(t) }) })
          return set.slice(0, 10)
        }, [current])

        const open = (function () {
          const flat = layers.reduce(function (acc, l) { return acc.concat(l.entries) }, [])
          return flat.filter(function (e) { return e.id === openId })[0] || null
        })()

        const copy = function (text, what) {
          copyText(text).then(function (ok) {
            setToast(ok ? what + ' 已复制' : '复制被拦了：手动选中下面那段文本再 Ctrl+C')
            setTimeout(function () { setToast('') }, 2600)
          })
        }

        const counts = (state && state.counts) || []
        const layerNameOf = function (entry) {
          const hit = layers.filter(function (l) { return (l.entries || []).some(function (x) { return x.id === entry.id }) })[0]
          return hit ? hit.name : ''
        }

        return el('div', { className: 'dw-wrap' },
          el('div', { className: 'dw-head' },
            el('div', { className: 'dw-title' }, TAB_LABEL),
            counts.map(function (c) {
              return el('span', { className: 'dw-pill', key: c.id }, c.name, ' ', el('b', null, String(c.count)))
            }),
            el('span', { className: 'dw-pill', title: (state && state.channel) || '' }, 'AI 通道 ', el('b', null, 'design_style')),
            el('input', {
              className: 'dw-search',
              placeholder: '搜名称 / 用途 / 出处…',
              value: query,
              onChange: function (e) { setQuery(e.target.value) },
            }),
            el('button', { className: 'dw-btn', onClick: load }, '刷新'),
          ),

          err ? el('div', { className: 'dw-pill', style: { borderColor: '#ef4444', color: '#ef4444' } }, '接口报错：' + err) : null,

          el('div', { className: 'dw-layers' },
            layers.map(function (l) {
              return el('button', {
                key: l.id,
                className: 'dw-layer' + (l.id === activeLayer ? ' dw-layer-on' : ''),
                onClick: function () { setLayer(l.id); setTag(''); setOrigin('') },
                title: l.hint,
              }, l.name, el('span', { className: 'dw-layer-n' }, String((l.entries || []).length)))
            }),
            current ? el('span', { className: 'dw-muted', style: { marginLeft: 'auto', fontSize: 11.5 } }, current.hint) : null,
          ),

          el('div', { className: 'dw-chips' },
            el('button', { className: 'dw-chip' + (scope === 'style' ? ' dw-chip-on' : ''), onClick: function () { setScope('style') }, title: '只显示能照着做的视觉风格' }, '只看风格'),
            el('button', { className: 'dw-chip' + (scope === 'both' ? ' dw-chip-on' : ''), onClick: function () { setScope('both') }, title: '风格 + 项目素材，隐藏方法与工程' }, '风格+素材'),
            el('button', { className: 'dw-chip' + (scope === 'all' ? ' dw-chip-on' : ''), onClick: function () { setScope('all') }, title: '连方法/工程一起看' }, '全部'),
            el('span', { style: { width: 1, height: 16, background: 'var(--dsw-alias-border-l2)' } }),
            el('button', { className: 'dw-chip' + (origin === '' ? ' dw-chip-on' : ''), onClick: function () { setOrigin(''); setTag('') } }, '全部来源'),
            el('button', { className: 'dw-chip' + (origin === 'mine' ? ' dw-chip-on' : ''), onClick: function () { setOrigin(origin === 'mine' ? '' : 'mine') } }, '只看自制'),
            el('button', { className: 'dw-chip' + (origin === 'referenced' ? ' dw-chip-on' : ''), onClick: function () { setOrigin(origin === 'referenced' ? '' : 'referenced') } }, '只看引用'),
            allTags.map(function (t) {
              return el('button', { key: t, className: 'dw-chip' + (tag === t ? ' dw-chip-on' : ''), onClick: function () { setTag(tag === t ? '' : t) } }, t)
            }),
            el('span', { className: 'dw-muted', style: { marginLeft: 'auto', fontSize: 11.5 } }, '点卡片看细节 · 复制引用粘给 AI · AI 用 design_style 读、design_scan 把新目录扫进来'),
          ),

          el('div', { className: 'dw-grid' },
            shown.map(function (e) {
              // 用 <button> 而不是 <div>：宿主里按钮的点击最可靠，div 的 onClick 有过不触发的情况
              return el('button', {
                key: e.id,
                type: 'button',
                className: 'dw-card',
                onClick: function () { setOpenId(e.id) },
              },
                el('div', { className: 'dw-cover' },
                  el(Visual, { entry: e }),
                  el('span', { className: 'dw-kind' }, e.swatch ? '风格' : (KIND_LABEL[e.kind] || e.kind)),
                  el('div', { className: 'dw-cover-hit', onClick: function () { setOpenId(e.id) }, title: '看细节' }),
                ),
                el('div', { className: 'dw-card-body' },
                  el('div', { className: 'dw-card-name' },
                    e.name,
                    el('span', { className: 'dw-origin ' + (e.origin === 'referenced' ? 'dw-origin-ref' : 'dw-origin-mine') }, e.origin === 'referenced' ? '引用' : '自制'),
                    e.nature === 'method' ? el('span', { className: 'dw-nature' }, '方法') : null,
                    e.nature === 'reference' ? el('span', { className: 'dw-nature' }, '素材') : null,
                  ),
                  el('div', { className: 'dw-card-line' }, e.oneLine),
                  el('div', { className: 'dw-tags' }, (e.tags || []).map(function (t) { return el('span', { className: 'dw-tag', key: t }, t) })),
                ),
              )
            }),
          ),

          shown.length === 0 ? el('div', { className: 'dw-muted' }, '这一层里没有匹配的条目，换个关键词或点「全部」。') : null,

          open ? el('div', {
            className: 'dw-modal',
            onClick: function (ev) { if (ev.target === ev.currentTarget) setOpenId('') },
          },
            el('div', { className: 'dw-modal-card' },
              el('div', { className: 'dw-modal-head' },
                el('div', { style: { flex: 1, minWidth: 0 } },
                  el('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                    el('b', { style: { fontSize: 15 } }, open.name),
                    el('span', { className: 'dw-origin ' + (open.origin === 'referenced' ? 'dw-origin-ref' : 'dw-origin-mine') }, open.origin === 'referenced' ? '引用' : '自制'),
                    el('span', { className: 'dw-tag' }, (layerNameOf(open) || '')),
                  ),
                  el('div', { className: 'dw-muted', style: { fontSize: 12, marginTop: 3 } }, open.oneLine),
                  el('div', { className: 'dw-src', style: { marginTop: 3 } }, open.source),
                ),
                el('button', { className: 'dw-close', onClick: function () { setOpenId('') }, title: '关闭' }, '×'),
              ),

              el('div', { className: 'dw-two' },
                el('div', null, el(Visual, { entry: open, big: true })),
                el('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } },
                  el('div', { style: { fontSize: 12, fontWeight: 600 } }, '要点'),
                  el('ul', { className: 'dw-bullets' }, (open.bullets || []).map(function (b, i) { return el('li', { key: i }, b) })),
                  el('div', { style: { fontSize: 12, lineHeight: 1.6 } }, el('b', null, '怎么用：'), open.howto),
                  open.originNote
                    ? el('div', { className: 'dw-muted', style: { fontSize: 11.5, lineHeight: 1.6 } }, open.originNote)
                    : null,
                ),
              ),

              open.style ? el('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                [['底', open.style.colors.bg], ['面', open.style.colors.surface], ['字', open.style.colors.text], ['强调', open.style.colors.accent], ['描边', open.style.colors.border]].map(function (p) {
                  return el('div', { key: p[0], title: p[0] + ' ' + p[1], style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } },
                    el('span', { style: { width: 16, height: 16, borderRadius: 4, border: '1px solid var(--dsw-alias-border-l2)', background: p[1] } }),
                    p[0])
                }),
              ) : null,

              (open.sources && open.sources.length > 0) ? el('div', null,
                el('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 4 } }, '原始材料'),
                el('div', { style: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, lineHeight: 1.5 } },
                  open.sources.map(function (src, i) {
                    const href = src.url || src.path || ''
                    return el('div', { key: i, style: { display: 'flex', gap: 6, alignItems: 'baseline' } },
                      el('span', { className: 'dw-muted', style: { flex: '0 0 auto' } }, src.label + '：'),
                      el('span', { className: 'dw-src', style: { flex: 1 } }, href),
                      el('button', {
                        className: 'dw-btn',
                        style: { flex: '0 0 auto', padding: '0 7px', fontSize: 10.5 },
                        onClick: function () { copy(href, src.label) },
                      }, '复制'),
                    )
                  }),
                ),
              ) : null,

              el('pre', { className: 'dw-pre' }, open.prompt),

              el('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                el('button', { className: 'dw-btn dw-btn-primary', onClick: function () { copy(open.prompt, '「引用给 AI」') } }, '复制引用（一行索引）'),
                el('button', { className: 'dw-btn', onClick: function () { setOpenId('') } }, '关闭'),
              ),
            ),
          ) : null,

          toast ? el('div', { className: 'dw-toast' }, toast) : null,
        )
      }

      ctx.slots.inject('conversation.view', function () {
        return ctx.slots.register(
          { name: 'conversation.view', id: PANEL_ID, order: 25, label: function () { return TAB_LABEL } },
          function (props) { return el(Panel, props) },
        )
      })
    }

    exports.name = PLUGIN_ID
    exports.inject = ['slots']
    exports.apply = apply
    exports.__preview = previewHtml

    return module.exports
  },
})
