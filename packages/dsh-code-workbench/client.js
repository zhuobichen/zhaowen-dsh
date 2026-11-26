/**
 * dsh-code-workbench · 浏览器半身
 *
 * 注册「代码工作台」标签，和「对话 / 轨迹 / 破甲工作台 / …」并排。
 *
 * 它要解决的问题很具体：**用户想说「我要那种风格」时，不该再去翻代码。**
 * 所以这里做三件事：
 *   ① 同一块迷你界面，用不同样式渲染 → 可以真正横向比；
 *   ② 点一下就能把「引用给 AI」的整段文本复制走；
 *   ③ 「选中它」落一条记录，AI 用 code_style 工具就能读到，不用用户复述。
 *
 * ⚠ 客户端 ABI 是 `window.__ModuleLoader__.load({id, factory})` 信封，少这层会报
 *   「loaded without registering "..." via __ModuleLoader__.load」。
 *   预览一律用 sandbox 的 iframe + srcDoc，样式互不污染，也不去读别人的 DOM。
 */
window.__ModuleLoader__.load({
  id: '@zhuobichen/dsh-code-workbench',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports

    const react = require('react')

    const PLUGIN_ID = 'dsh-code-workbench'
    const TAB_LABEL = '代码工作台'
    const PANEL_ID = 'code-workbench-main'
    const API = '/code-workbench'

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
      // ── 架构设计图：八种视觉语言（都是能动的 HTML/SVG，面板里直接看）────
      'arch-whiteboard': `<html><body style="margin:0;background:#f7f5f0;overflow:hidden;font-family:'Comic Sans MS',ui-rounded,system-ui">
<svg viewBox="0 0 320 180" width="100%" height="100%">
<defs><filter id="w"><feTurbulence baseFrequency="0.02" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="2.6"/></filter></defs>
<g filter="url(#w)" fill="none" stroke="#2b2b2b" stroke-width="2" stroke-linecap="round">
<rect x="18" y="30" width="74" height="34" rx="6"/><rect x="122" y="30" width="74" height="34" rx="6"/><rect x="226" y="30" width="74" height="34" rx="6"/>
<rect x="122" y="112" width="74" height="34" rx="6"/>
<path d="M92 47 H118"/><path d="M112 43 L120 47 L112 51"/>
<path d="M196 47 H222"/><path d="M216 43 L224 47 L216 51"/>
<path d="M159 64 V108"/><path d="M155 100 L159 108 L163 100"/>
</g>
<g fill="#2b2b2b" font-size="9" text-anchor="middle"><text x="55" y="51">用户</text><text x="159" y="51">网关</text><text x="263" y="51">服务</text><text x="159" y="133">数据库</text></g>
<text x="18" y="168" font-size="8" fill="#8a7f6a">手绘白板 · 想法期用它，别怕丑</text>
</svg></body></html>`,

      'arch-d2-light': `<html><body style="margin:0;background:#ffffff;overflow:hidden;font-family:Inter,system-ui">
<svg viewBox="0 0 320 180" width="100%" height="100%">
<defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity=".10"/></filter>
<marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#6b7280"/></marker></defs>
<g filter="url(#s)">
<rect x="16" y="26" width="78" height="36" rx="6" fill="#fff" stroke="#c9ced6"/>
<rect x="120" y="26" width="78" height="36" rx="6" fill="#fff" stroke="#0ea5e9" stroke-width="1.6"/>
<rect x="224" y="26" width="80" height="36" rx="6" fill="#fff" stroke="#c9ced6"/>
<rect x="120" y="108" width="78" height="36" rx="6" fill="#fff" stroke="#c9ced6"/>
</g>
<g stroke="#6b7280" stroke-width="1.2" fill="none" marker-end="url(#a)">
<path d="M94 44 H116"/><path d="M198 44 H220"/><path d="M159 62 V104"/></g>
<g font-size="9.5" fill="#111827" text-anchor="middle"><text x="55" y="49">Client</text><text x="159" y="49">API 网关</text><text x="264" y="49">订单服务</text><text x="159" y="131">PostgreSQL</text></g>
<g font-size="7.5" fill="#6b7280"><text x="16" y="16">系统架构 · C4 Container</text></g>
</svg></body></html>`,

      'arch-d2-dark': `<html><body style="margin:0;background:#14141f;overflow:hidden;font-family:ui-monospace,Consolas,monospace">
<svg viewBox="0 0 320 180" width="100%" height="100%">
<defs><marker id="ad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#7c7c9a"/></marker></defs>
<rect x="16" y="26" width="78" height="36" rx="8" fill="#1e1e2e" stroke="#c084fc"/>
<rect x="120" y="26" width="78" height="36" rx="8" fill="#1e1e2e" stroke="#38bdf8"/>
<rect x="224" y="26" width="80" height="36" rx="8" fill="#1e1e2e" stroke="#a3e635"/>
<rect x="120" y="108" width="78" height="36" rx="8" fill="#1e1e2e" stroke="#fbbf24"/>
<g stroke="#7c7c9a" stroke-width="1.1" fill="none" marker-end="url(#ad)"><path d="M94 44 H116"/><path d="M198 44 H220"/><path d="M159 62 V104"/></g>
<g font-size="9" fill="#e5e7eb" text-anchor="middle"><text x="55" y="49">client</text><text x="159" y="49">gateway</text><text x="264" y="49">orders</text><text x="159" y="131">postgres</text></g>
<g font-size="7" fill="#7c7c9a"><text x="16" y="16">dark-mauve theme · d2 --theme 200</text></g>
</svg></body></html>`,

      'arch-c4': `<html><body style="margin:0;background:#f4f6f8;overflow:hidden;font-family:Inter,system-ui">
<svg viewBox="0 0 320 180" width="100%" height="100%">
<defs><marker id="ac" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#707070"/></marker></defs>
<g><circle cx="42" cy="40" r="11" fill="#08427b"/><path d="M31 58 q11 -10 22 0" fill="#08427b"/></g>
<text x="42" y="76" font-size="7.5" fill="#08427b" text-anchor="middle">用户</text>
<rect x="96" y="26" width="120" height="40" rx="4" fill="#1168bd"/>
<text x="156" y="50" font-size="9.5" fill="#fff" text-anchor="middle">订单系统</text>
<rect x="234" y="26" width="70" height="40" rx="4" fill="#999999"/>
<text x="269" y="50" font-size="8.5" fill="#fff" text-anchor="middle">支付网关</text>
<rect x="60" y="112" width="90" height="34" rx="4" fill="#438dd5"/>
<text x="105" y="133" font-size="8" fill="#fff" text-anchor="middle">Web 前端</text>
<rect x="170" y="112" width="90" height="34" rx="4" fill="#85bbf0"/>
<text x="215" y="133" font-size="8" fill="#0b2b46" text-anchor="middle">订单服务</text>
<g stroke="#707070" stroke-width="1" fill="none" marker-end="url(#ac)">
<path d="M62 44 H92"/><path d="M216 46 H230"/>
<path d="M105 96 V108"/><path d="M215 96 V108"/><path d="M150 129 H166"/></g>
<g font-size="6.5" fill="#555"><text x="70" y="40">使用</text><text x="218" y="42">调用</text></g>
</svg></body></html>`,

      'arch-cloud': `<html><body style="margin:0;background:#fbfbfd;overflow:hidden;font-family:Inter,system-ui">
<svg viewBox="0 0 320 180" width="100%" height="100%">
<rect x="10" y="18" width="300" height="150" rx="10" fill="none" stroke="#94a3b8" stroke-dasharray="5 4"/>
<text x="18" y="32" font-size="7" fill="#64748b">VPC · 10.0.0.0/16</text>
<g fill="#fff" stroke="#cbd5e1">
<rect x="26" y="46" width="66" height="42" rx="6"/><rect x="106" y="46" width="66" height="42" rx="6"/>
<rect x="186" y="46" width="66" height="42" rx="6"/><rect x="106" y="112" width="66" height="42" rx="6"/></g>
<g fill="#f59e0b"><rect x="36" y="56" width="10" height="10" rx="2"/><rect x="116" y="56" width="10" height="10" rx="2"/></g>
<g fill="#3b82f6"><rect x="196" y="56" width="10" height="10" rx="2"/><rect x="116" y="122" width="10" height="10" rx="2"/></g>
<g font-size="8" fill="#334155"><text x="52" y="76">ALB</text><text x="132" y="76">EC2</text><text x="212" y="76">S3</text><text x="132" y="142">RDS</text></g>
<g stroke="#94a3b8" stroke-width="1.1" fill="none"><path d="M96 67 H102"/><path d="M176 67 H182"/><path d="M139 92 V108"/></g>
<text x="230" y="150" font-size="6.5" fill="#94a3b8">图标位：官方 cloud icons</text>
</svg></body></html>`,

      'arch-iso': `<html><body style="margin:0;background:radial-gradient(120% 100% at 30% 10%,#1e293b,#0b1220);overflow:hidden;font-family:Inter,system-ui">
<style>
.scene{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;perspective:900px}
.grid{transform:rotateX(58deg) rotateZ(-45deg);display:grid;grid-template-columns:repeat(3,54px);gap:16px}
.cube{width:54px;height:54px;border-radius:6px;background:linear-gradient(145deg,#38bdf8,#1d4ed8);box-shadow:0 12px 20px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.5);position:relative;animation:hop 3s ease-in-out infinite}
.cube:nth-child(2){background:linear-gradient(145deg,#a78bfa,#6d28d9);animation-delay:.3s}
.cube:nth-child(3){background:linear-gradient(145deg,#34d399,#047857);animation-delay:.6s}
.cube:nth-child(5){background:linear-gradient(145deg,#fbbf24,#b45309);animation-delay:.9s}
.t{position:absolute;left:14px;bottom:12px;color:#94a3b8;font-size:8.5px;letter-spacing:.14em}
@keyframes hop{0%,100%{transform:translateZ(0)}50%{transform:translateZ(10px)}}
</style>
<div class=scene><div class=grid><div class=cube></div><div class=cube></div><div class=cube></div><div class=cube></div><div class=cube></div><div class=cube></div></div></div>
<div class=t>ISOMETRIC · 立体块，适合汇报/发布会</div></body></html>`,

      'arch-blueprint': `<html><body style="margin:0;background:#0b2545;overflow:hidden;font-family:ui-monospace,Consolas,monospace">
<svg viewBox="0 0 320 180" width="100%" height="100%">
<defs><pattern id="g" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0 H0 V16" fill="none" stroke="#1b3a63" stroke-width=".6"/></pattern>
<marker id="ab" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#7fd1ff"/></marker></defs>
<rect width="320" height="180" fill="url(#g)"/>
<g fill="none" stroke="#7fd1ff" stroke-width="1.1">
<rect x="24" y="34" width="72" height="32"/><rect x="124" y="34" width="72" height="32"/><rect x="224" y="34" width="72" height="32"/>
<rect x="124" y="112" width="72" height="32"/></g>
<g stroke="#7fd1ff" stroke-width="1" fill="none" marker-end="url(#ab)"><path d="M96 50 H120"/><path d="M196 50 H220"/><path d="M160 66 V108"/></g>
<g fill="#bfe6ff" font-size="8" text-anchor="middle"><text x="60" y="54">EDGE</text><text x="160" y="54">CORE</text><text x="260" y="54">CACHE</text><text x="160" y="132">STORE</text></g>
<g fill="#5b86b5" font-size="6"><text x="24" y="26">DWG-01 / 架构总图</text><text x="24" y="168">SCALE 1:1 · REV B</text></g>
<g stroke="#5b86b5" stroke-width=".6"><path d="M20 160 H300"/></g>
</svg></body></html>`,

      'arch-mono': `<html><body style="margin:0;background:#fff;overflow:hidden;font-family:Inter,system-ui">
<svg viewBox="0 0 320 180" width="100%" height="100%">
<defs><marker id="am" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#111"/></marker></defs>
<g fill="none" stroke="#111" stroke-width="1">
<rect x="20" y="30" width="76" height="34"/><rect x="122" y="30" width="76" height="34"/><rect x="224" y="30" width="76" height="34"/>
<rect x="122" y="112" width="76" height="34"/></g>
<g stroke="#111" stroke-width=".9" fill="none" marker-end="url(#am)"><path d="M96 47 H118"/><path d="M198 47 H220"/><path d="M160 64 V108"/></g>
<g fill="#111" font-size="8.5" text-anchor="middle"><text x="58" y="51">WEB</text><text x="160" y="51">API</text><text x="262" y="51">WORKER</text><text x="160" y="133">DB</text></g>
<g fill="#666" font-size="6.5"><text x="20" y="22">最小线框 · 只留结构与层级</text></g>
</svg></body></html>`,
      // ── 视频风格（carl-motion 八种）：会动的预览，不再是空海报 ──────────
      'vid-carl-flat': `<html><body style="margin:0;background:#f7f4ec;overflow:hidden;font-family:Inter,system-ui">
<style>
.w{position:absolute;inset:0}
.s{position:absolute;border-radius:2px;animation:slide 4s ease-in-out infinite alternate}
.a{left:8%;top:34%;width:56px;height:56px;background:#2b59ff;animation-delay:0s}
.b{left:42%;top:20%;width:48px;height:48px;border-radius:50%;background:#ff5a3c;animation-delay:.4s}
.c{left:72%;top:44%;width:44px;height:44px;background:#ffd166;clip-path:polygon(50% 0,100% 100%,0 100%);animation-delay:.8s}
.ln{position:absolute;left:6%;right:6%;top:76%;height:3px;background:#232323}
@keyframes slide{from{transform:translateX(-10px)}to{transform:translateX(16px)}}
</style><div class=w><div class="s a"></div><div class="s b"></div><div class="s c"></div><div class=ln></div>
<div style="position:absolute;left:8%;bottom:8%;font-size:9px;color:#232323;letter-spacing:.14em">FLAT VECTOR</div></div></body></html>`,

      'vid-carl-ink': `<html><body style="margin:0;background:#f3efe6;overflow:hidden;font-family:Georgia,serif">
<style>
.w{position:absolute;inset:0}
.blot{position:absolute;border-radius:50%;background:radial-gradient(circle at 40% 40%,rgba(26,26,26,.85),rgba(26,26,26,.15) 60%,transparent 72%);filter:blur(1px);animation:spread 5s ease-out infinite}
.b1{left:18%;top:26%;width:74px;height:64px}
.b2{left:46%;top:38%;width:52px;height:46px;animation-delay:.7s}
.b3{left:64%;top:18%;width:38px;height:34px;animation-delay:1.4s}
.stroke{position:absolute;left:10%;top:20%;width:3px;height:60%;background:linear-gradient(#1a1a1a,rgba(26,26,26,0));transform-origin:top;animation:draw 5s ease-out infinite}
@keyframes spread{0%{transform:scale(.35);opacity:0}25%{opacity:1}100%{transform:scale(1.15);opacity:.85}}
@keyframes draw{0%{transform:scaleY(0)}40%{transform:scaleY(1)}100%{transform:scaleY(1);opacity:0}}
</style><div class=w><div class="blot b1"></div><div class="blot b2"></div><div class="blot b3"></div><div class=stroke></div>
<div style="position:absolute;right:8%;bottom:9%;font-size:9px;color:#6b6256;letter-spacing:.16em">CHINESE INK</div></div></body></html>`,

      'vid-carl-clay': `<html><body style="margin:0;background:#e8d5c0;overflow:hidden;font-family:Inter,system-ui">
<style>
.w{position:absolute;inset:0}
.grain{position:absolute;inset:0;background-image:radial-gradient(rgba(74,53,36,.14) 1px,transparent 1px);background-size:3px 3px;opacity:.7}
.blob{position:absolute;border-radius:26px;box-shadow:inset -6px -8px 14px rgba(74,53,36,.28),inset 5px 6px 12px rgba(255,255,255,.55);animation:jitter .5s steps(3) infinite alternate}
.c1{left:14%;top:32%;width:70px;height:62px;background:#d98f5a}
.c2{left:48%;top:24%;width:54px;height:50px;background:#b5651d;animation-delay:.15s}
.c3{left:70%;top:46%;width:46px;height:42px;background:#8f4a2a;animation-delay:.3s}
@keyframes jitter{from{transform:translate(0,0) rotate(-1.2deg)}to{transform:translate(1px,-2px) rotate(.8deg)}}
</style><div class=w><div class=grain></div><div class="blob c1"></div><div class="blob c2"></div><div class="blob c3"></div>
<div style="position:absolute;left:14%;bottom:9%;font-size:9px;color:#4a3524;letter-spacing:.14em">CLAYMATION · 12fps</div></div></body></html>`,

      'vid-carl-blueprint': `<html><body style="margin:0;background:#0b2545;overflow:hidden;font-family:ui-monospace,monospace">
<svg viewBox="0 0 320 180" width="100%" height="100%">
<defs><pattern id="bg" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M14 0 H0 V14" fill="none" stroke="#1b3a63" stroke-width=".5"/></pattern></defs>
<rect width="320" height="180" fill="url(#bg)"/>
<g fill="none" stroke="#dbeafe" stroke-width="1.1" stroke-dasharray="240" stroke-dashoffset="240">
<rect x="40" y="40" width="96" height="60" style="animation:draw 3s ease-out infinite"/>
<circle cx="230" cy="70" r="34" style="animation:draw 3s .4s ease-out infinite"/>
<path d="M136 70 H196" style="animation:draw 3s .8s ease-out infinite"/>
</g>
<g fill="#9ecbff" font-size="6.5"><text x="40" y="34">A-01 核心模块</text><text x="196" y="34">B-02 外部接口</text></g>
<text x="40" y="160" font-size="6" fill="#5b86b5">BLUEPRINT · DIM 120×60</text>
<style>@keyframes draw{0%{stroke-dashoffset:240}45%,100%{stroke-dashoffset:0}}</style>
</svg></body></html>`,

      'vid-carl-exploded': `<html><body style="margin:0;background:#0f172a;overflow:hidden;font-family:Inter,system-ui">
<style>
.w{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:6px}
.p{width:42px;height:42px;border-radius:6px;box-shadow:0 6px 16px rgba(0,0,0,.4);animation:fly 4s ease-in-out infinite alternate}
.p:nth-child(1){background:#38bdf8;animation-delay:0s}
.p:nth-child(2){background:#818cf8;animation-delay:.12s}
.p:nth-child(3){background:#a78bfa;animation-delay:.24s}
.p:nth-child(4){background:#f472b6;animation-delay:.36s}
@keyframes fly{from{transform:translate(0,0) rotate(0)}to{transform:translate(0,-18px) rotate(-8deg)}}
.tip{position:absolute;left:12%;bottom:12%;font-size:8.5px;color:#94a3b8;letter-spacing:.14em}
.line{position:absolute;left:18%;right:18%;top:52%;height:1px;background:rgba(148,163,184,.35)}
</style><div class=w><div class=p></div><div class=p></div><div class=p></div><div class=p></div></div>
<div class=line></div><div class=tip>EXPLODED VIEW · 沿轴分离</div></body></html>`,

      'vid-carl-brick': `<html><body style="margin:0;background:#f1f5f9;overflow:hidden;font-family:Inter,system-ui">
<style>
.w{position:absolute;left:14%;bottom:18%;display:flex;align-items:flex-end;gap:5px}
.b{width:34px;border-radius:4px;background:linear-gradient(180deg,#f43f5e,#be123c);box-shadow:inset 0 2px 0 rgba(255,255,255,.45);position:relative;animation:drop 3.6s ease-in-out infinite}
.b:after{content:'';position:absolute;left:5px;top:-5px;width:8px;height:8px;border-radius:50%;background:#fb7185;box-shadow:14px 0 0 #fb7185}
.b1{height:28px;animation-delay:0s}.b2{height:28px;animation-delay:.18s;background:linear-gradient(180deg,#38bdf8,#0369a1)}
.b3{height:28px;animation-delay:.36s;background:linear-gradient(180deg,#fbbf24,#b45309)}
.b4{height:56px;animation-delay:.5s;background:linear-gradient(180deg,#a3e635,#4d7c0f)}
@keyframes drop{0%{transform:translateY(-40px);opacity:0}22%{transform:translateY(0);opacity:1}78%{transform:translateY(0)}100%{transform:translateY(-40px);opacity:0}}
</style><div class=w><div class="b b1"></div><div class="b b2"></div><div class="b b3"></div><div class="b b4"></div></div>
<div style="position:absolute;left:14%;bottom:9%;font-size:9px;color:#64748b;letter-spacing:.14em">BRICK TOY · 一块块拼</div></body></html>`,

      'vid-carl-glass': `<html><body style="margin:0;background:linear-gradient(135deg,#1e1b4b,#0ea5e9 60%,#22d3ee);overflow:hidden;font-family:Inter,system-ui">
<style>
.blob{position:absolute;border-radius:50%;filter:blur(18px);opacity:.85}
.g1{left:8%;top:16%;width:120px;height:120px;background:#a855f7}
.g2{right:6%;top:32%;width:140px;height:140px;background:#f472b6}
.card{position:absolute;border-radius:14px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.45);backdrop-filter:blur(10px) saturate(160%);box-shadow:0 10px 30px rgba(0,0,0,.25);animation:float 5s ease-in-out infinite alternate}
.c1{left:16%;top:30%;width:110px;height:64px}
.c2{left:48%;top:22%;width:86px;height:50px;animation-delay:.6s}
.c3{left:40%;top:52%;width:130px;height:44px;animation-delay:1.2s}
@keyframes float{from{transform:translateY(-6px)}to{transform:translateY(6px)}}
</style><div class="blob g1"></div><div class="blob g2"></div>
<div class="card c1"></div><div class="card c2"></div><div class="card c3"></div>
<div style="position:absolute;left:16%;bottom:8%;font-size:9px;color:rgba(255,255,255,.8);letter-spacing:.14em">GLASS UI</div></body></html>`,

      'vid-carl-huashu': `<html><body style="margin:0;background:#f6f1e7;overflow:hidden;font-family:Inter,system-ui">
<style>
.port{position:absolute;left:50%;top:50%;width:120px;height:120px;transform:translate(-50%,-50%);border-radius:50%;
  background:radial-gradient(circle at 50% 46%,#1f2937 0 44%,transparent 45%),radial-gradient(circle at 50% 30%,#e4572e 0 26%,transparent 27%);
  -webkit-mask-image:radial-gradient(circle,#000 62%,transparent 63%);mask-image:radial-gradient(circle,#000 62%,transparent 63%);}
.dots{position:absolute;left:50%;top:50%;width:150px;height:150px;transform:translate(-50%,-50%);border-radius:50%;
  background-image:radial-gradient(#1f2937 1.4px,transparent 1.5px);background-size:5px 5px;opacity:.5;mix-blend-mode:multiply;
  -webkit-mask-image:radial-gradient(circle,#000 55%,transparent 62%);mask-image:radial-gradient(circle,#000 55%,transparent 62%);}
.bar{position:absolute;left:0;right:0;height:34%;bottom:0;background:#e4572e;mix-blend-mode:multiply;opacity:.35}
</style><div class=bar></div><div class=dots></div><div class=port></div>
<div style="position:absolute;left:8%;bottom:9%;font-size:9px;color:#4b5563;letter-spacing:.14em">HUASHU PORTRAITS · 半调双色</div></body></html>`,
      // ── 动效设计（10 条）：每条都配一段会动的预览 ───────────────────────
      'mo-easing': `<html><body style="margin:0;background:#0f172a;overflow:hidden;font-family:Inter,system-ui">
<style>
.row{position:absolute;left:14px;right:14px;height:26px;display:flex;align-items:center;gap:8px}
.dot{width:14px;height:14px;border-radius:50%;background:#38bdf8;flex:0 0 auto}
.r1{top:22px}.r2{top:66px}.r3{top:110px}
.r1 .dot{animation:m1 2.2s infinite}
.r2 .dot{animation:m2 2.2s infinite}
.r3 .dot{animation:m3 2.2s infinite}
.lb{font-size:9px;color:#94a3b8}
@keyframes m1{0%{transform:translateX(0)}50%,100%{transform:translateX(190px)}}
@keyframes m2{0%{transform:translateX(0)}50%,100%{transform:translateX(190px)}}
@keyframes m3{0%{transform:translateX(0)}50%,100%{transform:translateX(190px)}}
.r1 .dot{animation-timing-function:cubic-bezier(.33,1,.68,1)}
.r2 .dot{animation-timing-function:cubic-bezier(.34,1.56,.64,1)}
.r3 .dot{animation-timing-function:cubic-bezier(.87,0,.13,1)}
</style>
<div class="row r1"><div class="dot"></div><span class="lb">easeOutCubic</span></div>
<div class="row r2"><div class="dot"></div><span class="lb">easeOutBack（过冲）</span></div>
<div class="row r3"><div class="dot"></div><span class="lb">easeInOutQuart</span></div>
</body></html>`,

      'mo-vivus': `<html><body style="margin:0;background:#faf8f4;overflow:hidden">
<svg viewBox="0 0 320 180" width="100%" height="100%">
<g fill="none" stroke="#111827" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
   stroke-dasharray="520" stroke-dashoffset="520" style="animation:draw 3.2s ease-in-out infinite">
<path d="M60 120 L60 60 L110 60"/><circle cx="150" cy="90" r="32"/><path d="M200 60 L250 60 L250 120 L200 120 Z"/>
</g>
<text x="24" y="160" font-size="9" fill="#6b7280">stroke-dashoffset：线条像被笔一点点画出来</text>
<style>@keyframes draw{0%{stroke-dashoffset:520}60%,100%{stroke-dashoffset:0}}</style>
</svg></body></html>`,

      'mo-barba': `<html><body style="margin:0;background:#0b1020;overflow:hidden;font-family:Inter,system-ui">
<style>
.page{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#e5e7eb;font-size:13px;letter-spacing:.2em}
.p1{background:#1e293b;animation:out1 4s ease-in-out infinite}
.p2{background:#312e81;animation:in2 4s ease-in-out infinite;transform:translateX(100%)}
.curtain{position:absolute;inset:0;background:#6366f1;transform-origin:left;animation:cur 4s ease-in-out infinite}
@keyframes out1{0%,45%{transform:translateX(0);opacity:1}70%,100%{transform:translateX(-18%);opacity:0}}
@keyframes in2{0%,45%{transform:translateX(100%)}70%,100%{transform:translateX(0)}}
@keyframes cur{0%,40%{transform:scaleX(0)}55%{transform:scaleX(1)}70%{transform:scaleX(0);transform-origin:right}
                 100%{transform:scaleX(0);transform-origin:right}}
</style>
<div class="page p1">PAGE A</div><div class="page p2">PAGE B</div><div class="curtain"></div></body></html>`,

      'mo-interior': `<html><body style="margin:0;background:#f8fafc;overflow:hidden;font-family:Inter,system-ui">
<style>
.btn{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);width:120px;height:40px;border-radius:999px;
     background:#4d6bfe;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;
     box-shadow:0 6px 18px rgba(77,107,254,.35);animation:press 3s ease-in-out infinite}
.ripple{position:absolute;left:50%;top:46%;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;
        background:rgba(77,107,254,.35);animation:rip 3s ease-out infinite}
@keyframes press{0%,20%{transform:translate(-50%,-50%) scale(1)}28%{transform:translate(-50%,-50%) scale(.94)}
                 36%,100%{transform:translate(-50%,-50%) scale(1)}}
@keyframes rip{0%,24%{transform:scale(1);opacity:0}30%{opacity:1}50%{transform:scale(4);opacity:0}100%{opacity:0}}
</style><div class=btn>提交</div><div class=ripple></div>
<div style="position:absolute;left:0;right:0;bottom:14px;text-align:center;font-size:9px;color:#94a3b8">点下去那 500ms：按压 → 涟漪 → 状态确认</div></body></html>`,

      'mo-rewards': `<html><body style="margin:0;background:#111827;overflow:hidden;font-family:Inter,system-ui">
<style>
.n{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);color:#fff;font-size:34px;font-weight:800;letter-spacing:-.02em}
.n span{animation:up 3.4s ease-out infinite;display:inline-block}
.k{position:absolute;left:50%;top:56%;font-size:11px;color:#34d399;transform:translateX(-50%);opacity:0;animation:fade 3.4s infinite}
.p{position:absolute;width:7px;height:7px;border-radius:2px;left:50%;top:44%;animation:fly 3.4s ease-out infinite}
.p:nth-child(1){background:#f43f5e}.p:nth-child(2){background:#fbbf24}.p:nth-child(3){background:#34d399}
.p:nth-child(4){background:#38bdf8}.p:nth-child(5){background:#a78bfa}.p:nth-child(6){background:#f472b6}
.p:nth-child(2){animation-delay:.06s}.p:nth-child(3){animation-delay:.12s}.p:nth-child(4){animation-delay:.18s}
.p:nth-child(5){animation-delay:.24s}.p:nth-child(6){animation-delay:.3s}
@keyframes fly{0%,10%{transform:translate(0,0) rotate(0);opacity:0}18%{opacity:1}
  60%{transform:translate(var(--x,40px),90px) rotate(220deg);opacity:1}100%{opacity:0}}
@keyframes up{0%,8%{transform:translateY(8px);opacity:0}22%,100%{transform:none;opacity:1}}
@keyframes fade{0%,40%{opacity:0}55%,80%{opacity:1}100%{opacity:0}}
</style>
<div class=n><span>+1</span></div><div class=k>完成</div>
<div class=p style="--x:-52px"></div><div class=p style="--x:-20px"></div><div class=p style="--x:16px"></div>
<div class=p style="--x:46px"></div><div class=p style="--x:-34px"></div><div class=p style="--x:30px"></div>
</body></html>`,

      'mo-animejs': `<html><body style="margin:0;background:#0b1020;overflow:hidden">
<style>
.g{position:absolute;inset:24px;display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.s{border-radius:6px;background:linear-gradient(135deg,#38bdf8,#6366f1);transform:translateY(0) scale(1);
   animation:stg 2.6s ease-in-out infinite;animation-delay:calc(var(--i) * 90ms)}
@keyframes stg{0%,55%{transform:translateY(0) scale(1);opacity:.55}25%{transform:translateY(-14px) scale(1.08);opacity:1}80%,100%{transform:translateY(0) scale(1);opacity:.55}}
</style>
<div class=g>
<div class=s style="--i:0"></div><div class=s style="--i:1"></div><div class=s style="--i:2"></div><div class=s style="--i:3"></div><div class=s style="--i:4"></div>
<div class=s style="--i:5"></div><div class=s style="--i:6"></div><div class=s style="--i:7"></div><div class=s style="--i:8"></div><div class=s style="--i:9"></div>
<div class=s style="--i:10"></div><div class=s style="--i:11"></div><div class=s style="--i:12"></div><div class=s style="--i:13"></div><div class=s style="--i:14"></div>
</div></body></html>`,

      'mo-mojs': `<html><body style="margin:0;background:#1a0f1f;overflow:hidden">
<style>
.c{position:absolute;left:50%;top:52%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;
   background:#f472b6;animation:burst 2.4s cubic-bezier(.2,1.6,.4,1) infinite;animation-delay:calc(var(--d) * 1ms)}
@keyframes burst{0%{transform:translate(0,0) scale(.4);opacity:0}18%{opacity:1}
  70%{transform:translate(var(--x),var(--y)) scale(1);opacity:1}100%{transform:translate(var(--x),var(--y)) scale(.2);opacity:0}}
</style>
<div class=c style="--x:-70px;--y:-40px;--d:0"></div><div class=c style="--x:-30px;--y:-70px;--d:60"></div>
<div class=c style="--x:40px;--y:-60px;--d:120"></div><div class=c style="--x:76px;--y:-10px;--d:180"></div>
<div class=c style="--x:50px;--y:56px;--d:240"></div><div class=c style="--x:-46px;--y:60px;--d:300"></div>
<div class=c style="--x:-78px;--y:16px;--d:360"></div></body></html>`,

      'mo-motionity': `<html><body style="margin:0;background:#0f1117;overflow:hidden;font-family:Inter,system-ui">
<style>
.canvas{position:absolute;left:10px;top:10px;right:10px;height:104px;border-radius:8px;background:#171a23;border:1px solid #2a3142;overflow:hidden}
.layer{position:absolute;left:18px;top:26px;width:54px;height:54px;border-radius:8px;background:linear-gradient(135deg,#f472b6,#8b5cf6);
  animation:move 3.4s ease-in-out infinite}
.path{position:absolute;left:18px;top:56px;width:210px;height:1px;border-top:1px dashed #3b465c}
.tl{position:absolute;left:10px;right:10px;bottom:12px;height:26px;border-radius:6px;background:#171a23;border:1px solid #2a3142}
.head{position:absolute;top:0;bottom:0;width:2px;background:#f472b6;animation:head 3.4s linear infinite}
.kf{position:absolute;top:9px;width:6px;height:6px;background:#3b465c;border-radius:1px}
.kf.on{background:#f472b6}
@keyframes move{0%{transform:translateX(0)}50%{transform:translateX(148px)}100%{transform:translateX(0)}}
@keyframes head{0%{left:0}100%{left:100%}}
</style>
<div class=canvas><div class=path></div><div class=layer></div></div>
<div class=tl><div class=head></div>
<div class="kf on" style="left:6%"></div><div class="kf on" style="left:50%"></div><div class="kf on" style="left:94%"></div></div>
</body></html>`,

      'mo-principles': `<html><body style="margin:0;background:#f8fafc;overflow:hidden;font-family:Inter,system-ui">
<style>
.half{position:absolute;top:0;bottom:0;width:50%}
.l{left:0;background:#eff6ff}.r{left:50%;background:#fef2f2}
.card{position:absolute;top:44px;left:50%;transform:translateX(-50%);width:100px;height:52px;border-radius:8px;background:#fff;border:1px solid #dbeafe;box-shadow:0 6px 16px rgba(0,0,0,.08)}
.l .card{animation:enter 2.6s cubic-bezier(.2,.9,.2,1) infinite}
.r .card{animation:snap 2.6s steps(1) infinite}
.t{position:absolute;bottom:16px;width:50%;text-align:center;font-size:9px}
.tl{left:0;color:#1d4ed8}.tr{left:50%;color:#b91c1c}
@keyframes enter{0%{transform:translate(-50%,14px) scale(.96);opacity:0}30%,100%{transform:translate(-50%,0) scale(1);opacity:1}}
@keyframes snap{0%,49%{opacity:0}50%,100%{opacity:1}}
</style>
<div class="half l"><div class=card></div></div><div class="half r"><div class=card></div></div>
<div class="t tl">该动：有空间关系变化 → 给 200–300ms</div><div class="t tr">别动：只是换状态 → 直接切</div></body></html>`,

      'mo-motion-skill': `<html><body style="margin:0;background:#0f172a;overflow:hidden;font-family:Inter,system-ui">
<style>
.b{position:absolute;left:24px;width:96px;height:26px;border-radius:6px;background:#1e293b;border:1px solid #334155;
   display:flex;align-items:center;padding-left:8px;color:#cbd5e1;font-size:9px;
   animation:slidein 2.8s cubic-bezier(.22,1,.36,1) infinite}
.b1{top:34px;animation-delay:0ms}.b2{top:74px;animation-delay:80ms}.b3{top:114px;animation-delay:160ms}
@keyframes slidein{0%,20%{transform:translateX(-16px);opacity:0}45%,100%{transform:translateX(0);opacity:1}}
.tip{position:absolute;right:14px;bottom:12px;font-size:9px;color:#64748b}
</style>
<div class="b b1">timing 0ms</div><div class="b b2">+80ms</div><div class="b b3">+160ms</div>
<div class=tip>choreography：错开 80ms 就有节奏</div></body></html>`,
    }

    function demoHtml(id) {
      return DEMOS[id] || ''
    }

    /**
     * 把一个 demo 的 HTML/CSS 渲染进 Shadow DOM：样式不外泄、动画在宿主文档里跑，
     * 不依赖 iframe（iframe 会被某些宿主节流，用户看到的就是「有一帧但不动」）。
     */
    /** 内页单项的规范索引（和 catalog.js 的 memberRef 一个模板）。 */
    function memberIndexText(entry, index) {
      const mem = entry.members && entry.members[index]
      if (!mem) return ''
      const tier = mem.tier ? '（' + mem.tier + '）' : ''
      return [
        '用代码工作台里的「' + entry.name + '」第 ' + (index + 1) + ' 种「' + mem.name + '」' + tier + '，按这个设计来。',
        '原始材料：' + (mem.raw || mem.cover || ''),
        '要看完整规格：code_style op=get ' + entry.id + ' member=' + (index + 1),
      ].join(String.fromCharCode(10))
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
    // 所有面板文案集中在这里（developerFolio 的做法：改内容不碰组件）
    const COPY = {
      heroTitle: '开发者工具库',
      heroKicker: 'DEVELOPER // WORKBENCH',
      heroLine: '别人做好的东西：skill 包 / MCP 服务 / 开发工具 / 规范',
      heroFoot: '点卡片看细节 · 复制引用粘给 AI · AI 用 code_style 读写、code_scan 扫目录',
      empty: '这一层里没有匹配的条目，换个关键词或点「全部」。',
    }

    function apply(ctx) {
      // 隐式工作台开关（无 UI）：localStorage 里写 dsh-workbench-off 即可关掉某个 tab；默认全开
      try {
        const _off = JSON.parse(window.localStorage.getItem('dsh-workbench-off') || '{}');
        if (_off['code-workbench'] === true) return;
      } catch (e) { /* localStorage 不可用就当全开 */ }
      const el = react.createElement
      const useState = react.useState
      const useEffect = react.useEffect
      const useMemo = react.useMemo
      const useRef = react.useRef || null

      // 从 sources 的 label 提取「★ N」用于卡片/详情展示
      function starOf(entry) {
        for (const src of (entry.sources || [])) {
          const m = String(src.label || '').match(/★\s*([\d.]+k?)/)
          if (m) return '★ ' + m[1]
        }
        return ''
      }

      let styleDone = false
      function useStyleOnce() {
        if (styleDone) return
        styleDone = true
        try {
          const tag = document.createElement('style')
          tag.setAttribute('data-cw-scope', '1')
          tag.textContent = [
            // developerFolio 全深色：在本面板内覆盖宿主 token，下面所有用 var(--dsw-alias-*) 的元素一起变深
            '.dw-wrap{display:flex;flex-direction:column;gap:12px;padding:16px 18px 40px;height:100%;overflow:auto;overflow-x:hidden;box-sizing:border-box;max-width:100%;font-size:13px;color:var(--dsw-alias-label-primary);}',
            '.dw-modal-card{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2);}',
            
            
            

            '.dw-modal{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px;}',
            '.dw-modal-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.35);width:min(1040px,100%);max-height:88vh;overflow:auto;padding:16px 18px 18px;display:flex;flex-direction:column;gap:12px;}',
            '.dw-modal-head{display:flex;align-items:flex-start;gap:10px;}',
            '.dw-close{margin-left:auto;width:26px;height:26px;line-height:24px;text-align:center;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:15px;flex:0 0 auto;}',
            '.dw-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));}',
            '.dw-origin{font-size:10px;padding:0 6px;border-radius:999px;line-height:16px;border:1px solid transparent;white-space:nowrap;}',
            '.dw-origin-mine{color:#0f766e;background:rgba(15,118,110,.10);border-color:rgba(15,118,110,.25);}',
            '.dw-origin-ref{color:#9a3412;background:rgba(154,52,18,.10);border-color:rgba(154,52,18,.25);}',
            '.dw-stars{font-size:10px;color:#d97706;background:rgba(217,119,6,.10);border:1px solid rgba(217,119,6,.3);border-radius:999px;padding:0 6px;white-space:nowrap;}',
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
            '.dw-card-flat{display:flex;flex-direction:column;}',
            '.dw-card-flat .dw-card-body{padding-top:10px;}',
            '.dw-stripe{height:4px;width:100%;flex:0 0 auto;border-radius:6px 6px 0 0;opacity:.9;}',
            '.dw-one{display:block;}',
            '.dw-cover{height:150px;background:var(--dsw-alias-bg-layer-2);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;cursor:pointer;}',
            '.dw-cover iframe,.dw-cover img,.dw-cover .dw-poster,.dw-cover .dw-cover-ph{pointer-events:none;}',
            '.dw-cover-hit{position:absolute;inset:0;cursor:pointer;}',
            '.dw-demo{width:100%;height:132px;display:block;overflow:hidden;background:#fff;}',
            '.dw-demo-big{height:300px;border-radius:8px;}',
            '.dw-nature{font-size:10px;padding:0 5px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);}',
            '.dw-members{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;max-height:340px;overflow:auto;padding:2px;}',
            '.dw-member{display:flex;flex-direction:column;gap:3px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);cursor:pointer;text-align:left;}',
            '.dw-member:hover{border-color:var(--dsw-alias-brand-primary,#4d6bfe);}',
            '.dw-member img{width:100%;height:74px;object-fit:cover;display:block;}',
            '.dw-member-ph{height:74px;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--dsw-alias-label-tertiary);}',
            '.dw-member-name{font-size:10.5px;line-height:1.3;padding:0 6px 4px;color:var(--dsw-alias-label-secondary);}',
            '.dw-member-tier{font-size:9.5px;padding:0 6px 5px;color:var(--dsw-alias-label-tertiary);}',
            '.dw-lightbox{z-index:9700;}',
            '.dw-lightbox-card{background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:12px;max-width:min(880px,94vw);max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.35);}',
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

            // ── developerFolio 皮肤（局部，只作用于本面板）────────────────
            '.df-hero{position:relative;display:flex;gap:18px;align-items:center;padding:16px 18px;border-radius:14px;overflow:hidden;background:linear-gradient(120deg,#eef4ff 0%,#f6f2ff 55%,#eef9f7 100%);border:1px solid var(--dsw-alias-border-l2);color:#1f2937;}',
            '.df-hero:after{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(59,89,130,.10) 1px,transparent 1px);background-size:18px 18px;pointer-events:none;}',
            '.df-hero-art{flex:0 0 200px;height:108px;opacity:.95;}',
            '.df-hero-copy{position:relative;z-index:1;flex:1;min-width:0;}',
            '.df-kicker{font-family:ui-monospace,Consolas,monospace;font-size:10px;letter-spacing:.22em;color:#38bdf8;}',
            '.df-title{font-size:26px;font-weight:800;letter-spacing:-.02em;line-height:1.15;margin:3px 0 4px;color:#1f2937;}',
            '.df-line{font-size:12px;color:#5b6b82;line-height:1.5;}',
            '.df-skills{display:flex;gap:14px;flex-wrap:wrap;margin-top:11px;}',
            '.df-skill{display:flex;align-items:center;gap:6px;min-width:130px;flex:1 1 130px;max-width:210px;}',
            '.df-skill-name{font-size:10.5px;color:#415069;white-space:nowrap;}',
            '.df-skill-bar{flex:1;height:4px;border-radius:999px;background:#dbe3ef;overflow:hidden;}',
            '.df-skill-fill{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#38bdf8,#a78bfa);transform-origin:left;animation:dfGrow .9s ease-out both;}',
            '.df-skill-n{font-family:ui-monospace,Consolas,monospace;font-size:10px;color:#64748b;}',
            '@keyframes dfGrow{from{transform:scaleX(0)}to{transform:scaleX(1)}}',
            // 滚动入场：默认下沉 24px + 透明，进入视口后归位
            // 入场动画用纯 CSS 自动播放 + stagger：不依赖 IntersectionObserver，
            // 否则离线/受限环境里卡片会永远停在 opacity:0（变成一片空白）。
            '.dw-wrap [data-reveal]{animation:dfRise .55s cubic-bezier(.2,.8,.2,1) both;}',
            '.dw-wrap [data-reveal]:nth-child(3n+2){animation-delay:.06s;}',
            '.dw-wrap [data-reveal]:nth-child(3n+3){animation-delay:.12s;}',
            '@keyframes dfRise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}',
            // 皮肤内的 chips / 卡片微调，贴近 developerFolio 的「标签化技能」
            '.df-hero + .dw-head .dw-title{font-size:14px;font-weight:700;}',
            
            

          ].map(function (rule) {
            var t = rule.trim()
            if (t === '' || t.charAt(0) === '/' || t.charAt(0) === '@') return rule
            var brace = rule.indexOf('{')
            if (brace < 0) return rule
            var sel = rule.slice(0, brace)
            if (/^(from|to|\d+(?:\.\d+)?%)\s*$/.test(sel.trim())) return rule
            var parts = sel.split(',').map(function (one) {
              var v = one.trim()
              return v === '' ? one : '.cw-scope ' + v
            })
            return parts.join(',') + rule.slice(brace)
          }).join('\n')
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

      const KIND_LABEL = { image: '图', tokens: '样式', text: '条目', demo: '可动' }

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
        // 动效类：Shadow DOM 内联渲染（不走 iframe —— iframe 在某些宿主里会被节流/拦掉，
        // 表现就是「画面有一帧但不动」）
        if (e.kind === 'demo' && demoHtml(e.id) !== '') {
          return el(DemoHost, { id: e.id, big: big, title: e.name })
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

      function DemoHost(props) {
        const html = demoHtml(props.id)
        return el('div', {
          className: 'dw-demo' + (props.big === true ? ' dw-demo-big' : ''),
          title: props.title || '',
          ref: function (node) {
            if (!node) return
            // 已经注入过就跳过（React 每次渲染都会调用 callback ref）
            if (node.dataset.demoId === props.id) return
            try {
              const root = node.shadowRoot || node.attachShadow({ mode: 'open' })
              // demo 是整页 HTML：剥掉 html/body 外壳，把 body 的 style 挪到 :host。
              // 不这么做的话绝对定位会以视口为准，画面散掉（表现得就像「不动」）。
              const m = /<body([^>]*)>([\s\S]*)<\/body>/i.exec(html)
              const bodyAttrs = m ? m[1] : ''
              const inner = m ? m[2] : html
              const bg = /style="([^"]*)"/.exec(bodyAttrs)
              root.innerHTML =
                '<style>:host{display:block;width:100%;height:100%;position:relative;overflow:hidden;' +
                (bg ? bg[1] : '') +
                '}</style>' +
                inner
              node.dataset.demoId = props.id
            } catch {
              // 极老环境没有 shadow DOM：退回 iframe
              node.innerHTML = '<iframe sandbox="" scrolling="no" style="width:100%;height:100%;border:0" srcdoc="' +
                html.replace(/"/g, '&quot;') + '"></iframe>'
              node.dataset.demoId = props.id
            }
          },
        })
      }


      /**
       * 首屏：插画 + 大字（developerFolio 的 hero）。
       * 插画用内联 SVG，不引外链图——面板裂不起。
       */
      function Hero(props) {
        const counts = props.counts || []
        const total = props.total || 0
        return el('div', { className: 'df-hero' },
          el('div', { className: 'df-hero-art' },
            el('svg', { viewBox: '0 0 220 120', width: '100%', height: '100%', 'aria-hidden': 'true' },
              el('defs', null,
                el('linearGradient', { id: 'df-glow', x1: '0', y1: '0', x2: '1', y2: '1' },
                  el('stop', { offset: '0%', 'stop-color': '#38bdf8' }),
                  el('stop', { offset: '100%', 'stop-color': '#a78bfa' }),
                ),
              ),
              el('circle', { cx: 120, cy: 52, r: 40, fill: 'url(#df-glow)', opacity: '.18' }),
              el('rect', { x: 18, y: 24, width: 118, height: 74, rx: 7, fill: '#0f172a', stroke: '#1e293b' }),
              el('rect', { x: 18, y: 24, width: 118, height: 16, rx: 7, fill: '#1e293b' }),
              el('circle', { cx: 30, cy: 32, r: 3, fill: '#f87171' }),
              el('circle', { cx: 41, cy: 32, r: 3, fill: '#fbbf24' }),
              el('circle', { cx: 52, cy: 32, r: 3, fill: '#34d399' }),
              el('rect', { x: 28, y: 50, width: 34, height: 5, rx: 2, fill: '#38bdf8' }),
              el('rect', { x: 28, y: 62, width: 66, height: 5, rx: 2, fill: '#334155' }),
              el('rect', { x: 28, y: 74, width: 50, height: 5, rx: 2, fill: '#a78bfa' }),
              el('rect', { x: 28, y: 86, width: 72, height: 5, rx: 2, fill: '#334155' }),
              el('path', { d: 'M150 44 l16 -14 l0 28 z', fill: '#38bdf8', opacity: '.9' }),
              el('circle', { cx: 190, cy: 30, r: 5, fill: '#a78bfa' }),
              el('circle', { cx: 204, cy: 72, r: 3, fill: '#38bdf8' }),
            ),
          ),
          el('div', { className: 'df-hero-copy' },
            el('div', { className: 'df-kicker' }, COPY.heroKicker),
            el('div', { className: 'df-title' }, COPY.heroTitle),
            el('div', { className: 'df-line' }, COPY.heroLine),
            el('div', { className: 'df-skills' },
              counts.map(function (c, i) {
                const pct = total ? Math.round((c.count / total) * 100) : 0
                return el('div', { className: 'df-skill', key: c.id },
                  el('span', { className: 'df-skill-name' }, c.name),
                  el('span', { className: 'df-skill-bar' },
                    el('span', { className: 'df-skill-fill', style: { width: Math.max(pct, 6) + '%', animationDelay: (i * 120) + 'ms' } }),
                  ),
                  el('span', { className: 'df-skill-n' }, String(c.count)),
                )
              }),
            ),
          ),
        )
      }

      /** 滚动入场：元素进入视口就加 df-in（上浮 24px + 淡入），只做一次。 */
      function useReveal() {
        useEffect(function () {
          if (typeof IntersectionObserver === 'undefined') return
          const nodes = document.querySelectorAll('.dw-wrap [data-reveal]')
          if (!nodes || nodes.length === 0) return
          const io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
              if (en.isIntersecting) {
                en.target.classList.add('df-in')
                io.unobserve(en.target)
              }
            })
          }, { threshold: 0.08 })
          nodes.forEach(function (n) { io.observe(n) })
          return function () { io.disconnect() }
        })
      }

      function Panel() {
        useStyleOnce()
        useReveal()
        const [state, setState] = useState(null)
        const [err, setErr] = useState('')
        const [layer, setLayer] = useState('')
        const [scope, setScope] = useState('all')
        const [tag, setTag] = useState('')
        const [origin, setOrigin] = useState('')
        const [query, setQuery] = useState('')
        const [openId, setOpenId] = useState('')
        const [memberOpen, setMemberOpen] = useState(-1)
        const [toast, setToast] = useState('')
        const [moreOpen, setMoreOpen] = useState(false)

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

        // 「有视觉」= 真截图 / 会动的预览 / 换皮预览；只剩色卡和纯文字的收进垃圾箱

        const shown = useMemo(function () {
          if (current === null) return []
          const q = query.trim().toLowerCase()
          const kept = current.entries.filter(function (e) {
            if (origin !== '' && e.origin !== origin) return false
            if (tag !== '' && (e.tags || []).indexOf(tag) < 0) return false
            if (scope === 'style' && (e.nature || 'style') !== 'style') return false
            if (scope === 'both' && (e.nature || 'style') === 'method') return false
            if (q === '') return true
            return (e.name + ' ' + e.oneLine + ' ' + (e.tags || []).join(' ') + ' ' + e.id + ' ' + e.source).toLowerCase().indexOf(q) >= 0
          })
          // 顺序：别人的（referenced）在前，自制的沉到末尾；同组内保持原顺序（sort 稳定）
          return kept.slice().sort(function (a, b) {
            return (a.origin === 'mine' ? 1 : 0) - (b.origin === 'mine' ? 1 : 0)
          })
        }, [current, tag, origin, query, scope])

        // 当前层里各类条目有多少（芯片上显示，知道被藏了多少）
        const scopeCounts = useMemo(function () {
          const list = current ? current.entries : []
          return {
            style: list.filter(function (e) { return (e.nature || 'style') === 'style' }).length,
            both: list.filter(function (e) { return (e.nature || 'style') !== 'method' }).length,
            all: list.length,
          }
        }, [current])

        // 这一层全都是风格时，scope 的三个按钮点了也没变化——整组不显示
        const scopeUseful = scopeCounts.style !== scopeCounts.all

        // 同理：层内来源只有一种（比如整层都是引用），来源筛选也没意义
        const originUseful = useMemo(function () {
          if (current === null) return false
          const kinds = {}
          current.entries.forEach(function (e) { kinds[e.origin || ''] = 1 })
          return Object.keys(kinds).length > 1
        }, [current])

        // 标签芯片：优先用 catalog 给这一层定死的 filters（语义不重叠、每个至少命中 2 条、覆盖主要群体）；
        // 没定 filters 的层才回退到自动提取（>=2 次、且不是「几乎每条都有」）
        const allTags = useMemo(function () {
          if (current === null) return []
          if (Array.isArray(current.filters) && current.filters.length > 0) return current.filters
          const freq = {}
          current.entries.forEach(function (e) {
            (e.tags || []).forEach(function (t) { freq[t] = (freq[t] || 0) + 1 })
          })
          const n = current.entries.length || 1
          return Object.keys(freq)
            .filter(function (t) { return freq[t] >= 2 && freq[t] < n * 0.6 })
            .sort(function (a, b) { return freq[b] - freq[a] })
            .slice(0, 8)
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

        return el('div', { className: 'cw-scope', style: { display: 'contents' } },
          el('div', { className: 'dw-wrap' },
          el(Hero, { counts: counts, total: state ? state.total : 0 }),
          el('div', { className: 'dw-head' },
            el('div', { className: 'dw-title' }, TAB_LABEL),
            counts.map(function (c) {
              return el('span', { className: 'dw-pill', key: c.id }, c.name, ' ', el('b', null, String(c.count)))
            }),
            el('span', { className: 'dw-pill', title: (state && state.channel) || '' }, 'AI 通道 ', el('b', null, 'code_style')),
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
                onClick: function () { setLayer(l.id); setTag(''); setOrigin(''); setShowTrash(false) },
                title: l.hint,
              }, l.name, el('span', { className: 'dw-layer-n' }, String((l.entries || []).length)))
            }),
            current ? el('span', { className: 'dw-muted', style: { marginLeft: 'auto', fontSize: 11.5 } }, current.hint) : null,
          ),

          el('div', { className: 'dw-chips' },
            // 数据性质筛选（风格/方法/素材、自制/引用）收进「更多筛选」，默认不占版面
            (scopeUseful || originUseful) ? el('button', {
              key: 'more',
              className: 'dw-chip' + (moreOpen || scope !== 'style' || origin !== '' ? ' dw-chip-on' : ''),
              onClick: function () { setMoreOpen(!moreOpen) },
              title: '按数据性质筛：风格 / 方法 / 素材，自制 / 引用',
            }, '更多筛选 ' + (moreOpen ? '▴' : '▾')) : null,
            // 整层都是风格时不显示 scope 三连（三个数字一样，点了没变化）
            (moreOpen && scopeUseful) ? [
              el('button', { key: 'sc-style', className: 'dw-chip' + (scope === 'style' ? ' dw-chip-on' : ''), onClick: function () { setScope('style') }, title: '只显示能照着做的视觉风格' }, '只看风格 ' + scopeCounts.style),
              el('button', { key: 'sc-both', className: 'dw-chip' + (scope === 'both' ? ' dw-chip-on' : ''), onClick: function () { setScope('both') }, title: '风格 + 项目素材，隐藏方法与工程' }, '风格+素材 ' + scopeCounts.both),
              el('button', { key: 'sc-all', className: 'dw-chip' + (scope === 'all' ? ' dw-chip-on' : ''), onClick: function () { setScope('all') }, title: '连方法/工程一起看' }, '全部 ' + scopeCounts.all),
              el('span', { key: 'sc-sep', style: { width: 1, height: 16, background: 'var(--dsw-alias-border-l2)' } }),
            ] : null,
            // 整层只有一个来源时不显示来源筛选
            (moreOpen && originUseful) ? [
              el('button', { key: 'or-all', className: 'dw-chip' + (origin === '' ? ' dw-chip-on' : ''), onClick: function () { setOrigin(''); setTag('') } }, '全部来源'),
              el('button', { key: 'or-mine', className: 'dw-chip' + (origin === 'mine' ? ' dw-chip-on' : ''), onClick: function () { setOrigin(origin === 'mine' ? '' : 'mine') } }, '只看自制'),
              el('button', { key: 'or-ref', className: 'dw-chip' + (origin === 'referenced' ? ' dw-chip-on' : ''), onClick: function () { setOrigin(origin === 'referenced' ? '' : 'referenced') } }, '只看引用'),
              el('span', { key: 'or-sep', style: { width: 1, height: 16, background: 'var(--dsw-alias-border-l2)' } }),
            ] : null,
            allTags.map(function (t) {
              return el('button', { key: t, className: 'dw-chip' + (tag === t ? ' dw-chip-on' : ''), onClick: function () { setTag(tag === t ? '' : t) } }, t)
            }),
            el('span', { className: 'dw-muted', style: { marginLeft: 'auto', fontSize: 11.5 } }, COPY.heroFoot),
          ),

          el('div', { className: 'dw-grid' },
            shown.map(function (e) {
              // 用 <button> 而不是 <div>：宿主里按钮的点击最可靠，div 的 onClick 有过不触发的情况
              return el('button', {
                key: e.id,
                type: 'button',
                className: 'dw-card dw-card-flat',
                'data-reveal': '1',
                onClick: function () { setOpenId(e.id) },
              },
                // 代码库不摆示意图：顶部一条强调色代替封面，卡片就是「一条资料」
                el('div', {
                  className: 'dw-stripe',
                  style: { background: (e.swatch && e.swatch.accent) || 'var(--dsw-alias-brand-primary,#4d6bfe)' },
                }),
                el('div', { className: 'dw-card-body' },
                  el('div', { className: 'dw-card-name' },
                    e.name,
                    el('span', { className: 'dw-origin ' + (e.origin === 'referenced' ? 'dw-origin-ref' : 'dw-origin-mine') }, e.origin === 'referenced' ? '引用' : '自制'),
                    starOf(e) ? el('span', { className: 'dw-stars' }, starOf(e)) : null,
                    e.nature === 'method' ? el('span', { className: 'dw-nature' }, '方法') : null,
                    e.nature === 'reference' ? el('span', { className: 'dw-nature' }, '参考') : null,
                  ),
                  el('div', { className: 'dw-card-line' }, e.oneLine),
                  el('div', { className: 'dw-tags' }, (e.tags || []).map(function (t) { return el('span', { className: 'dw-tag', key: t }, t) })),
                ),
              )
            }),
          ),

          shown.length === 0 ? el('div', { className: 'dw-muted' }, COPY.empty) : null,

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
                    starOf(open) ? el('span', { className: 'dw-stars' }, starOf(open)) : null,
                    el('span', { className: 'dw-tag' }, (layerNameOf(open) || '')),
                  ),
                  el('div', { className: 'dw-muted', style: { fontSize: 12, marginTop: 3 } }, open.oneLine),
                  el('div', { className: 'dw-src', style: { marginTop: 3 } }, open.source),
                ),
                el('button', { className: 'dw-close', onClick: function () { setOpenId('') }, title: '关闭' }, '×'),
              ),

              el('div', { className: (open.kind === 'image' || open.kind === 'demo' || open.kind === 'tokens') ? 'dw-two' : 'dw-one' },
                (open.kind === 'image' || open.kind === 'demo' || open.kind === 'tokens')
                  ? el('div', null, el(Visual, { entry: open, big: true }))
                  : null,
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
                (open.members && open.members.length > 0) ? el('div', null,
                  el('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 6 } }, '内页 · ', open.members.length, ' 种风格（点开看大图）'),
                  el('div', { className: 'dw-members' },
                    open.members.map(function (m, i) {
                      return el('button', {
                        key: i,
                        type: 'button',
                        className: 'dw-member',
                        onClick: function () { setMemberOpen(i) },
                        title: m.name,
                      },
                        m.cover !== ''
                          ? el('img', { src: API + '/member/' + encodeURIComponent(open.id) + '/' + i, alt: m.name, loading: 'lazy', draggable: false })
                          : el('div', { className: 'dw-member-ph' }, '无样张'),
                        el('span', { className: 'dw-member-name' }, m.name.replace(/（.*?）$/, '')),
                        m.tier ? el('span', { className: 'dw-member-tier' }, m.tier) : null,
                      )
                    }),
                  ),
                ) : null,

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

          (open && memberOpen >= 0 && open.members && open.members[memberOpen]) ? el('div', {
            className: 'dw-modal dw-lightbox',
            onClick: function (ev) { if (ev.target === ev.currentTarget) setMemberOpen(-1) },
          },
            el('div', { className: 'dw-lightbox-card' },
              el('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
                el('b', { style: { fontSize: 13, flex: 1 } }, open.members[memberOpen].name),
                open.members[memberOpen].tier ? el('span', { className: 'dw-nature' }, open.members[memberOpen].tier) : null,
                el('button', { className: 'dw-close', onClick: function () { setMemberOpen(-1) }, title: '关闭' }, '×'),
              ),
              el('img', { src: API + '/member/' + encodeURIComponent(open.id) + '/' + memberOpen, alt: '', style: { width: '100%', display: 'block', borderRadius: 8 } }),
              el('pre', { className: 'dw-pre', style: { marginTop: 8 } }, memberIndexText(open, memberOpen)),
              el('div', { style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } },
                el('button', { className: 'dw-btn dw-btn-primary', onClick: function () { copy(memberIndexText(open, memberOpen), '这一条的索引') } }, '复制这一条的索引'),
                el('button', { className: 'dw-btn', onClick: function () { copy(open.members[memberOpen].raw, '『' + open.members[memberOpen].name + '』原图地址') } }, '复制原图地址'),
                el('button', { className: 'dw-btn', onClick: function () { setMemberOpen(-1) } }, '返回内页'),
              ),
            ),
          ) : null,

          toast ? el('div', { className: 'dw-toast' }, toast) : null,
          )
        )
      }

      ctx.slots.inject('conversation.view', function () {
        return ctx.slots.register(
          { name: 'conversation.view', id: PANEL_ID, order: 30, label: function () { return TAB_LABEL } },
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
