/**
 * dsh-qq-panel · 浏览器半边
 *
 * 注册一个「朝闻录」标签，和「对话 / 轨迹 / IG5 逆向工作台」并排。
 * 数据来自主机侧挂的 /qq-panel-data（读 qchat-cli 的私有文件）。
 *
 * 刻意做得朴素：这是给自己看状态的，不是产品。信息密度优先，装饰其次。
 *
 * ⚠ DSH 的客户端模块 ABI 是 `window.__ModuleLoader__.load({id, factory})` 信封。
 *   少这层信封，脚本会「加载了但没注册」——报错原文是
 *   `loaded without registering "dsh-qq-panel" via __ModuleLoader__.load`。
 *   信封里的 `require` 只认静态表（react / react/jsx-runtime 等）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-qq-panel',
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;

    const react = require('react');

    const PLUGIN_ID = 'dsh-qq-panel';
    const TAB_LABEL = 'QQ纪实';
    const PANEL_ID = 'qq-panel-main';
    const POLL_MS = 5000;

    let diagEnabled = false;
    function diag() {
      if (!diagEnabled) return;
      try {
        console.debug('[qq-panel]', ...arguments);
      } catch {
        /* noop */
      }
    }

    function apply(ctx) {
      // 工作台开关：默认全开；被用户关掉则不注册 tab（刷新页面生效）
      try {
        const _off = JSON.parse(window.localStorage.getItem('dsh-workbench-off') || '{}');
        if (_off['qq-panel'] === true) return;
      } catch (e) { /* localStorage 不可用就当全开 */ }
      const el = react.createElement;
      const useState = react.useState;
      const useEffect = react.useEffect;
      const useCallback = react.useCallback;
      const useRef = react.useRef;

      // ── 样式（只注入一次）──────────────────────────────
      let styleDone = false;
      function useStyleOnce() {
        if (styleDone) return;
        styleDone = true;
        try {
          const css = `
        .qp-wrap{display:flex;flex-direction:column;gap:14px;padding:18px 20px 40px;height:100%;overflow:auto;font-size:13px;color:var(--dsw-alias-fg-1);}
        .qp-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
        .qp-title{font-size:15px;font-weight:600;}
        .qp-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--dsw-alias-border-l2);}
        .qp-dot{width:7px;height:7px;border-radius:50%;display:inline-block;}
        .qp-ok{background:#22c55e;}
        .qp-bad{background:#ef4444;}
        .qp-warn{background:#f59e0b;}
        .qp-muted{color:var(--dsw-alias-fg-3);}
        .qp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;}
        .qp-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-width:0;}
        .qp-card-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}
        .qp-card-t{font-weight:600;font-size:13px;}
        .qp-big{font-size:22px;font-weight:650;font-variant-numeric:tabular-nums;}
        .qp-kv{display:flex;justify-content:space-between;gap:10px;font-size:12px;}
        .qp-kv span:last-child{font-variant-numeric:tabular-nums;color:var(--dsw-alias-fg-2);}
        .qp-row{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px dashed var(--dsw-alias-border-l2);font-size:12px;}
        .qp-row:last-child{border-bottom:none;}
        .qp-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .qp-tag{font-size:11px;padding:1px 6px;border-radius:6px;background:var(--dsw-alias-bg-2);}
        .qp-log{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;line-height:1.7;color:var(--dsw-alias-fg-3);white-space:pre-wrap;word-break:break-all;max-height:140px;overflow:auto;}
        .qp-empty{color:var(--dsw-alias-fg-3);font-size:12px;padding:6px 0;}
        .qp-btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;border-radius:7px;padding:3px 10px;font-size:12px;cursor:pointer;}
        .qp-btn:hover{background:var(--dsw-alias-bg-2);}
        .qp-err{border:1px solid #ef4444;border-radius:8px;padding:10px;color:#ef4444;font-size:12px;}

        /* ── 纸片立体书皮肤（paper-popup）──────────────────────── */
        .qp-scope{--pp-ink:#5b3a22;--pp-paper:#faf5e8;--pp-edge:#e6dbc4;--pp-brown:#8b6b45;}
        .qp-wrap{background:#d9c6a4;background-image:radial-gradient(ellipse 70% 40% at 50% 0%,rgba(255,248,225,.85),transparent),repeating-linear-gradient(92deg,rgba(90,60,35,.10) 0 2px,transparent 2px 22px);color:var(--pp-ink);}
        .pp-hero{position:relative;display:flex;gap:16px;align-items:center;padding:12px 16px;margin-bottom:2px;background:linear-gradient(180deg,#fdf8ec,#f0e5d0);border:2px solid var(--pp-ink);border-radius:4px;box-shadow:4px 6px 0 rgba(91,58,34,.22);}
        .pp-hero-art{flex:0 0 190px;height:112px;}
        .pp-hero-copy{position:relative;z-index:1;flex:1;min-width:0;}
        .pp-kicker{font-family:ui-monospace,Consolas,monospace;font-size:10px;letter-spacing:.2em;color:#b4532a;}
        .pp-title{font-size:24px;font-weight:800;margin:3px 0 5px;color:var(--pp-ink);letter-spacing:-.02em;}
        .pp-line{font-size:12px;color:#8b6b45;line-height:1.5;}
        .pp-stickers{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;}
        .pp-sticker{display:flex;align-items:center;gap:6px;padding:4px 11px;border:2px solid var(--pp-ink);border-radius:3px;background:#fff;box-shadow:2px 3px 0 var(--pp-ink);transform:rotate(-2deg);}
        .pp-sticker b{font-family:ui-monospace,Consolas,monospace;font-size:15px;color:var(--pp-ink);}
        .pp-sticker span{font-size:10.5px;color:#8b6b45;}
        .pp-s1{background:#ffd166;}.pp-s2{background:#ff8a5b;transform:rotate(1.5deg);}.pp-s3{background:#9acd6e;transform:rotate(-1deg);}
        /* 纸片卡：厚白边 + 灰卡纸边 + 剪纸阴影 + V折弹起 */
        .pp-card{position:relative;border:2px solid var(--pp-ink);border-radius:3px;background:#fffdf7;box-shadow:4px 5px 0 rgba(91,58,34,.30),inset 0 0 0 3px #fff,inset 0 0 0 5px var(--pp-edge);transform-origin:bottom center;animation:ppRise .5s cubic-bezier(.34,1.56,.64,1) both;overflow:hidden;}
        .pp-card-band{height:7px;margin:-2px -2px 8px;background:var(--pp-tone,#8b6b45);border-bottom:2px solid var(--pp-ink);}
        .pp-card:nth-child(odd){transform:rotate(-.6deg);}
        .pp-card:nth-child(even){transform:rotate(.5deg);animation-delay:.07s;}
        .pp-card:hover{transform:rotate(0) translateY(-3px);}
        @keyframes ppRise{from{transform:perspective(500px) rotateX(-70deg);opacity:0}to{opacity:1}}
        .pp-card .qp-big{color:var(--pp-tone,#8b6b45);}
        .pp-card .qp-card-t{color:var(--pp-tone,#8b6b45);font-weight:800;}
        .pp-card .qp-tag{background:#fff;border:1.5px solid var(--pp-tone,#8b6b45);color:var(--pp-tone,#8b6b45);}
        .pp-card .qp-row{border-bottom-color:rgba(91,58,34,.18);}
        .qp-head .qp-title{color:var(--pp-ink);}
        .qp-pill{border-color:var(--pp-edge);color:var(--pp-ink);background:#fff;}
      `;
          const style = document.createElement('style');
          style.setAttribute('data-plugin', PLUGIN_ID);
          style.textContent = css.split('\n').map(function (line) {
            var t = line.trim();
            if (t === '' || t.charAt(0) === '/' || t.charAt(0) === '@') return line;
            var brace = line.indexOf('{');
            if (brace < 0) return line;
            var sel = line.slice(0, brace);
            if (/^(from|to|\d+(?:\.\d+)?%)\s*$/.test(sel.trim())) return line;
            var parts = sel.split(',').map(function (one) {
              var v = one.trim();
              return v === '' ? one : '.qp-scope ' + v;
            });
            return parts.join(',') + line.slice(brace);
          }).join('\n');
          document.head.appendChild(style);
        } catch {
          /* 注入样式失败不致命 */
        }
      }

      // 一个跨页一个主色调（paper-popup 的颜色逻辑）
      const TONES = {
        '表情库': '#e8a317', '梗库': '#e2693a', '关系': '#4e9d5a', '任务': '#3d7cc0',
        '最近偷到的表情': '#e8a317', '最近互动的人': '#4e9d5a', '最近任务': '#3d7cc0',
      };
      function Card(props) {
        const tone = TONES[props.title] || '#8b6b45';
        return el(
          'div',
          { className: 'qp-card pp-card', 'data-pop': '1', style: { '--pp-tone': tone } },
          el('div', { className: 'pp-card-band' }),
          el('div', { className: 'qp-card-h' }, el('div', { className: 'qp-card-t' }, props.title), props.extra || null),
          props.children,
        );
      }

      function KV(props) {
        return el('div', { className: 'qp-kv' }, el('span', { className: 'qp-muted' }, props.k), el('span', null, props.v));
      }

      function useSnapshot() {
        const state = useState({ data: null, error: null, loading: true, at: 0 });
        const snap = state[0];
        const setSnap = state[1];
        const alive = useRef(true);

        const load = useCallback(() => {
          fetch('/qq-panel-data', { cache: 'no-store' })
            .then(async (r) => {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            })
            .then((data) => {
              if (!alive.current) return;
              setSnap({ data, error: null, loading: false, at: Date.now() });
            })
            .catch((error) => {
              if (!alive.current) return;
              setSnap((prev) => ({ ...prev, error: String(error.message || error), loading: false }));
            });
        }, []);

        useEffect(() => {
          alive.current = true;
          load();
          const timer = setInterval(load, POLL_MS);
          return () => {
            alive.current = false;
            clearInterval(timer);
          };
        }, [load]);

        return { snap, load };
      }

      function fmtAgo(ts) {
        if (!ts) return '—';
        const sec = Math.floor((Date.now() - ts) / 1000);
        if (sec < 60) return sec + ' 秒前';
        if (sec < 3600) return Math.floor(sec / 60) + ' 分钟前';
        if (sec < 86400) return Math.floor(sec / 3600) + ' 小时前';
        return Math.floor(sec / 86400) + ' 天前';
      }

      // 文案集中（改内容不碰组件）
      const COPY = {
        kicker: 'A POP-UP BOOK OF CHATS',
        title: 'QQ 纪实 · 立体书',
        line: '翻开桌面上的小书：每一页纸片弹起，讲一段群聊的故事',
      };

      /** 首屏：写实桌面 + 一本翻开的立体书（纯内联 SVG，不引外链图） */
      function PopupHero(props) {
        const em = (props.data && props.data.emoji) || {};
        const meme = (props.data && props.data.meme) || {};
        const aff = (props.data && props.data.affinity) || {};
        return el('div', { className: 'pp-hero' },
          el('div', { className: 'pp-hero-art' },
            el('svg', { viewBox: '0 0 220 130', width: '100%', height: '100%', 'aria-hidden': 'true' },
              // 写实桌面（暖木色 + 接触阴影）
              el('ellipse', { cx: 110, cy: 112, rx: 96, ry: 9, fill: '#000', opacity: '.10' }),
              el('rect', { x: 18, y: 96, width: 184, height: 14, rx: 4, fill: '#c9a97e' }),
              // 书：封面 + 立起的背板（V 折）
              el('path', { d: 'M40 96 L110 84 L180 96 Z', fill: '#f4efe3', stroke: '#6b5436', 'stroke-width': 2 }),
              el('rect', { x: 106, y: 30, width: 74, height: 56, rx: 3, fill: '#e8dcc4', stroke: '#6b5436', 'stroke-width': 2, transform: 'rotate(-6 106 30)' }),
              // 弹起的纸片角色（厚白边 + 深棕描边）
              el('g', { stroke: '#fff', 'stroke-width': 6, 'stroke-linejoin': 'round' },
                el('path', { d: 'M70 60 q10 -18 22 0 l4 26 h-30 z', fill: '#ff8a5b' }),
                el('circle', { cx: 81, cy: 52, r: 12, fill: '#ffd166' }),
              ),
              el('g', { stroke: '#5b3a22', 'stroke-width': 2.4, fill: 'none', 'stroke-linejoin': 'round' },
                el('path', { d: 'M70 60 q10 -18 22 0 l4 26 h-30 z', fill: '#ff8a5b' }),
                el('circle', { cx: 81, cy: 52, r: 12, fill: '#ffd166' }),
                el('circle', { cx: 77, cy: 52, r: 1.6, fill: '#5b3a22', stroke: 'none' }),
                el('circle', { cx: 85, cy: 52, r: 1.6, fill: '#5b3a22', stroke: 'none' }),
              ),
              // 另一张弹起的纸景（草坡）
              el('path', { d: 'M120 86 q20 -22 54 0 z', fill: '#9acd6e', stroke: '#fff', 'stroke-width': 5 }),
              el('path', { d: 'M120 86 q20 -22 54 0 z', fill: '#9acd6e', stroke: '#5b3a22', 'stroke-width': 2 }),
              // 剪纸形状阴影
              el('ellipse', { cx: 81, cy: 94, rx: 16, ry: 3, fill: '#5b3a22', opacity: '.18' }),
            ),
          ),
          el('div', { className: 'pp-hero-copy' },
            el('div', { className: 'pp-kicker' }, COPY.kicker),
            el('div', { className: 'pp-title' }, COPY.title),
            el('div', { className: 'pp-line' }, COPY.line),
            el('div', { className: 'pp-stickers' },
              el('div', { className: 'pp-sticker pp-s1' }, el('b', null, String(em.total ?? 0)), el('span', null, '表情')),
              el('div', { className: 'pp-sticker pp-s2' }, el('b', null, String(meme.total ?? 0)), el('span', null, '梗图')),
              el('div', { className: 'pp-sticker pp-s3' }, el('b', null, String(aff.total ?? 0)), el('span', null, '亲和力')),
            ),
          ),
        );
      }

      function Panel() {
        useStyleOnce();
        const { snap, load } = useSnapshot();
        const d = snap.data;

        if (snap.error && !d) {
          return el('div', { className: 'qp-scope', style: { display: 'contents' } }, el('div', { className: 'qp-wrap' }, el('div', { className: 'qp-err' }, '读不到数据：' + snap.error)));
        }
        if (!d) {
          return el('div', { className: 'qp-scope', style: { display: 'contents' } }, el('div', { className: 'qp-wrap' }, el('div', { className: 'qp-empty' }, '载入中…')));
        }

        const ob = d.onebot || {};
        const em = d.emoji || {};
        const meme = d.meme || {};
        const aff = d.affinity || {};
        const tasks = d.tasks || {};

        return el(
          'div',
          { className: 'qp-scope', style: { display: 'contents' } },
          el('div', { className: 'qp-wrap' },
          el(PopupHero, { data: d }),
          // 头部
          el(
            'div',
            { className: 'qp-head' },
            el('div', { className: 'qp-title' }, '朝闻录'),
            el(
              'span',
              { className: 'qp-pill' },
              el('i', { className: 'qp-dot ' + (ob.ready ? 'qp-ok' : 'qp-bad') }),
              ob.ready ? `${ob.nickname || ''} ${ob.uin || ''}`.trim() + ' 在线' : '离线：' + (ob.reason || '未知'),
            ),
            ob.ready ? null : el('span', { className: 'qp-pill qp-muted' }, ob.endpoint || ''),
            el('span', { className: 'qp-pill qp-muted' }, '刷新于 ' + new Date(d.at).toLocaleTimeString('zh-CN', { hour12: false })),
            el('button', { className: 'qp-btn', onClick: load }, '刷新'),
          ),

          // 四块统计
          el(
            'div',
            { className: 'qp-grid' },
            el(
              Card,
              { title: '表情库' },
              el('div', { className: 'qp-big' }, em.total ?? 0),
              el(KV, { k: '偷来的', v: em.stolen ?? 0 }),
              el(KV, { k: '已打标', v: `${em.labeled ?? 0} / 待标 ${em.unlabeled ?? 0}` }),
              el(KV, { k: '用过', v: em.used ?? 0 }),
              el(KV, {
                k: '有人接的比率',
                v: em.feedback?.rate == null ? '样本不足' : `${Math.round(em.feedback.rate * 100)}%（${em.feedback.engaged}/${em.feedback.resolved}）`,
              }),
            ),
            el(
              Card,
              { title: '梗库' },
              el('div', { className: 'qp-big' }, meme.total ?? 0),
              el(KV, { k: '现在能用', v: meme.usable ?? 0 }),
              el(KV, { k: '年龄未知', v: meme.unknownAge ?? 0 }),
              el(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 } },
                Object.entries(meme.bySource || {}).map(([k, v]) =>
                  el('span', { key: k, className: 'qp-tag' }, `${k} ${v}`),
                ),
              ),
            ),
            el(
              Card,
              { title: '关系' },
              el('div', { className: 'qp-big' }, aff.total ?? 0),
              el(KV, { k: '有互动记录的人', v: aff.total ?? 0 }),
              (aff.rows || []).slice(0, 3).map((r) =>
                el('div', { key: r.uin, className: 'qp-row' }, el('span', { className: 'qp-name' }, r.name), el('span', { className: 'qp-muted' }, `${r.tag} ${r.score.toFixed(1)}`)),
              ),
            ),
            el(
              Card,
              { title: '任务' },
              el('div', { className: 'qp-big' }, tasks.pending ?? 0),
              el(KV, { k: '未完成', v: tasks.pending ?? 0 }),
              el(KV, { k: '历史总数', v: tasks.total ?? 0 }),
            ),
          ),

          // 偷来的图
          el(
            Card,
            { title: '最近偷到的表情' },
            (em.recentStolen || []).length === 0
              ? el('div', { className: 'qp-empty' }, '还没有。等群里有人发表情。')
              : em.recentStolen.map((r, i) =>
                  el('div', { key: i, className: 'qp-row' }, el('span', { className: 'qp-name' }, r.label || '(无标签)'), el('span', { className: 'qp-muted' }, r.from || '')),
                ),
          ),

          // 关系榜
          el(
            Card,
            { title: '关系榜' },
            (aff.rows || []).length === 0
              ? el('div', { className: 'qp-empty' }, '还没有互动记录。')
              : aff.rows.map((r) =>
                  el(
                    'div',
                    { key: r.uin, className: 'qp-row' },
                    el('span', { className: 'qp-name' }, `${r.name}（${r.uin}）`),
                    el('span', { className: 'qp-muted' }, `${r.tag} · ${r.score.toFixed(1)} · 聊过 ${r.msgsFrom} · 接过话 ${r.engaged}`),
                  ),
                ),
          ),

          // 任务
          el(
            Card,
            { title: '最近任务' },
            (tasks.recent || []).length === 0
              ? el('div', { className: 'qp-empty' }, '还没有任务记录。')
              : tasks.recent.map((t) =>
                  el(
                    'div',
                    { key: t.id, className: 'qp-row' },
                    el('span', { className: 'qp-name' }, `${t.type} · ${t.status} · ${t.target || '—'}`),
                    el('span', { className: 'qp-muted' }, fmtAgo(t.at)),
                  ),
                ),
          ),

          // 素材库
          el(MediaCard, { stats: d.media }),

          // 日记
          el(DiaryCard, { total: d.diary && d.diary.total }),

          // 梗库检索
          el(WikiCard, { stats: d.wiki }),

          // 表情检索
          el(StickerCard, null),

          // 热更日志
          el(
            Card,
            { title: '梗库热更日志' },
            (d.refreshLog || []).length === 0
              ? el('div', { className: 'qp-empty' }, '没有日志。')
              : el('div', { className: 'qp-log' }, d.refreshLog.join('\n')),
          ),
          )
        );
      }

      // 梗库检索卡片：一个输入框 + 结果列表。
      // 搜索走后端 /qq-panel-wiki（服务端过滤，只回命中的几十条），
      // 不把 2700 条全量塞进浏览器。
      function WikiCard(props) {
        const st = useState({ q: '', busy: false, data: null, err: null });
        const s = st[0];
        const setS = st[1];
        const alive = useRef(true);

        useEffect(() => {
          alive.current = true;
          return () => {
            alive.current = false;
          };
        }, []);

        const run = useCallback(
          (kw) => {
            const q = String(kw ?? '').trim();
            if (q === '') {
              setS({ q: '', busy: false, data: null, err: null });
              return;
            }
            setS({ q, busy: true, data: null, err: null });
            fetch('/qq-panel-wiki?q=' + encodeURIComponent(q) + '&limit=40', { cache: 'no-store' })
              .then(async (r) => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
              })
              .then((data) => {
                if (!alive.current) return;
                setS({ q, busy: false, data, err: null });
              })
              .catch((e) => {
                if (!alive.current) return;
                setS({ q, busy: false, data: null, err: String(e.message || e) });
              });
          },
          [setS],
        );

        const stats = props.stats || {};
        const months = Object.entries(stats.byMonth || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
        const hits = (s.data && s.data.hits) || [];

        return el(
          Card,
          { title: '梗库检索', extra: el('span', { className: 'qp-tag' }, (stats.total ?? 0) + ' 条') },
          el(
            'div',
            { style: { display: 'flex', gap: 6 } },
            el('input', {
              className: 'qp-input',
              placeholder: '查梗，如 狗奶 / 崩 / 雪王',
              defaultValue: s.q,
              onKeyDown: (e) => {
                if (e.key === 'Enter') run(e.target.value);
              },
              style: {
                flex: 1,
                minWidth: 0,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'transparent',
                color: 'inherit',
                borderRadius: 7,
                padding: '4px 8px',
                fontSize: 12,
                outline: 'none',
              },
            }),
            el('button', { className: 'qp-btn', onClick: (e) => run(e.target.parentNode.firstChild.value) }, s.busy ? '查…' : '查'),
          ),
          s.err ? el('div', { className: 'qp-err' }, s.err) : null,
          s.data
            ? hits.length === 0
              ? el('div', { className: 'qp-empty' }, '没查到「' + s.q + '」。')
              : hits.map((h) =>
                  el(
                    'div',
                    { key: h.term, style: { padding: '6px 0', borderBottom: '1px dashed var(--dsw-alias-border-l2)' } },
                    el(
                      'div',
                      { style: { display: 'flex', gap: 6, alignItems: 'baseline' } },
                      el('b', { style: { fontSize: 13 } }, h.term),
                      h.risky ? el('span', { className: 'qp-tag', style: { color: '#ef4444' } }, '擦边') : null,
                      el('span', { className: 'qp-muted', style: { fontSize: 11 } }, h.era || ''),
                    ),
                    el('div', { style: { fontSize: 12, lineHeight: 1.6, marginTop: 2 } }, h.meaning),
                  ),
                )
            : el(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                months.map(([m, n]) => el('span', { key: m, className: 'qp-tag' }, m + ' ' + n)),
              ),
        );
      }

      // 素材库：生成过的图和视频摊开看。
      // 之前它们散在插件 output 和 qchat output 两个目录里，想不起来生成过什么。
      function MediaCard(props) {
        const st = useState({ data: null, err: null, kind: 'all' });
        const s2 = st[0];
        const setS = st[1];
        const alive = useRef(true);
        const load = useCallback((kind) => {
          fetch('/qq-panel-media?limit=18&kind=' + kind, { cache: 'no-store' })
            .then((r) => r.json())
            .then((data) => { if (alive.current) setS({ data, err: null, kind }); })
            .catch((e) => { if (alive.current) setS({ data: null, err: String(e.message || e), kind }); });
        }, [setS]);
        useEffect(() => { alive.current = true; load('all'); return () => { alive.current = false; }; }, [load]);

        const m = props.stats || {};
        const items = (s2.data && s2.data.items) || [];
        const tabs = [['all', '全部'], ['image', '图'], ['video', '视频']];
        return el(
          Card,
          { title: '素材库', extra: el('span', { className: 'qp-tag' }, (m.images ?? 0) + ' 图 / ' + (m.videos ?? 0) + ' 视频') },
          el('div', { style: { display: 'flex', gap: 6, marginBottom: 6 } },
            tabs.map(([k, label]) => el('button', {
              key: k,
              className: 'qp-btn',
              style: k === s2.kind ? { background: 'var(--dsw-alias-bg-2)' } : {},
              onClick: () => load(k),
            }, label))),
          s2.err ? el('div', { className: 'qp-err' }, s2.err) : null,
          items.length === 0
            ? el('div', { className: 'qp-empty' }, '还没有生成的素材。')
            : el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(88px,1fr))', gap: 6 } },
                items.map((it) => el('div', { key: it.dir + it.name, style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                  it.kind === 'video'
                    ? el('div', { style: { height: 88, borderRadius: 8, background: 'var(--dsw-alias-bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 } }, '▶')
                    : el('img', {
                        src: '/qq-panel-file?dir=' + it.dir + '&name=' + encodeURIComponent(it.name),
                        loading: 'lazy', alt: it.name, title: it.name,
                        style: { width: '100%', height: 88, objectFit: 'cover', borderRadius: 8, background: 'var(--dsw-alias-bg-2)' },
                      }),
                  el('div', { style: { fontSize: 9, color: 'var(--dsw-alias-fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.name),
                ))),
        );
      }

      // 日记：我自己写的工作记录（scripts/diary.mjs 写入，这里只读）
      function DiaryCard(props) {
        const st = useState({ data: null, err: null });
        const s2 = st[0];
        const setS = st[1];
        const alive = useRef(true);
        useEffect(() => {
          alive.current = true;
          fetch('/qq-panel-diary?limit=8', { cache: 'no-store' })
            .then((r) => r.json())
            .then((data) => { if (alive.current) setS({ data, err: null }); })
            .catch((e) => { if (alive.current) setS({ data: null, err: String(e.message || e) }); });
          return () => { alive.current = false; };
        }, [setS]);

        const entries = (s2.data && s2.data.entries) || [];
        return el(
          Card,
          { title: '日记', extra: el('span', { className: 'qp-tag' }, (props.total ?? 0) + ' 篇') },
          s2.err ? el('div', { className: 'qp-err' }, s2.err) : null,
          entries.length === 0
            ? el('div', { className: 'qp-empty' }, '还没写过。用 node scripts/diary.mjs write ... 写一篇。')
            : entries.map((e, i) => el('div', { key: i, style: { padding: '6px 0', borderBottom: '1px dashed var(--dsw-alias-border-l2)' } },
                el('div', { style: { display: 'flex', gap: 6, alignItems: 'baseline' } },
                  el('b', { style: { fontSize: 12 } }, e.title || '(无标题)'),
                  el('span', { className: 'qp-muted', style: { fontSize: 10 } }, String(e.at || '').slice(0, 16).replace('T', ' '))),
                e.body ? el('div', { style: { fontSize: 11, lineHeight: 1.6, marginTop: 2, color: 'var(--dsw-alias-fg-2)' } }, String(e.body).slice(0, 160)) : null,
              )),
        );
      }

      // 表情检索卡片：输入关键词 → 显示匹配的表情缩略图。
      // 表情没有名字，label 是自动生成的整句描述，所以只能按 label 关键词搜。
      function StickerCard() {
        const st = useState({ q: '', busy: false, data: null, err: null });
        const s = st[0];
        const setS = st[1];
        const alive = useRef(true);

        useEffect(() => {
          alive.current = true;
          return () => {
            alive.current = false;
          };
        }, []);

        const run = useCallback(
          (kw) => {
            const q = String(kw ?? '').trim();
            if (q === '') {
              setS({ q: '', busy: false, data: null, err: null });
              return;
            }
            setS({ q, busy: true, data: null, err: null });
            fetch('/qq-panel-wiki?kind=sticker&limit=24&q=' + encodeURIComponent(q), { cache: 'no-store' })
              .then(async (r) => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
              })
              .then((data) => {
                if (!alive.current) return;
                setS({ q, busy: false, data, err: null });
              })
              .catch((e) => {
                if (!alive.current) return;
                setS({ q, busy: false, data: null, err: String(e.message || e) });
              });
          },
          [setS],
        );

        const hits = (s.data && s.data.hits) || [];
        return el(
          Card,
          { title: '表情检索', extra: el('span', { className: 'qp-tag' }, '963 张') },
          el(
            'div',
            { style: { display: 'flex', gap: 6 } },
            el('input', {
              placeholder: '如 熊猫头 / 无语 / 退退退',
              onKeyDown: (e) => {
                if (e.key === 'Enter') run(e.target.value);
              },
              style: {
                flex: 1,
                minWidth: 0,
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'transparent',
                color: 'inherit',
                borderRadius: 7,
                padding: '4px 8px',
                fontSize: 12,
                outline: 'none',
              },
            }),
            el(
              'button',
              { className: 'qp-btn', onClick: (e) => run(e.target.parentNode.firstChild.value) },
              s.busy ? '找…' : '找图',
            ),
          ),
          s.err ? el('div', { className: 'qp-err' }, s.err) : null,
          s.data && hits.length === 0 ? el('div', { className: 'qp-empty' }, '没找到匹配的表情。') : null,
          el(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(96px,1fr))', gap: 8 } },
            hits.map((h) =>
              el(
                'div',
                { key: h.file, style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                el('img', {
                  src: '/qq-panel-emoji/' + encodeURIComponent(h.file),
                  alt: h.label,
                  title: h.label,
                  loading: 'lazy',
                  style: {
                    width: '100%',
                    height: 96,
                    objectFit: 'contain',
                    borderRadius: 8,
                    background: 'var(--dsw-alias-bg-2)',
                  },
                }),
                el(
                  'div',
                  { style: { fontSize: 10, color: 'var(--dsw-alias-fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  h.label,
                ),
              ),
            ),
          ),
        );
      }

      // ── 注册标签 ──────────────────────────────────────
      ctx.slots.inject('conversation.view', function () {
        diag('view-tab-slot 就绪');
        return ctx.slots.register(
          { name: 'conversation.view', id: PANEL_ID, order: 60, label: function () { return TAB_LABEL; } },
          function (props) { return el(Panel, props); },
        );
      });
    }

    exports.name = PLUGIN_ID;
    // cordis 的 inject 是「依赖的服务名数组」，不是函数
    exports.inject = ['slots'];
    exports.apply = apply;

    return module.exports;
  },
});
