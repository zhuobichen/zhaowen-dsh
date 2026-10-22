window.__ModuleLoader__.load({
	id: '@zhuobichen/dsh-client-ui-novel-pane',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const runtime = require("react/jsx-runtime");
		const jsx = runtime.jsx;
		const jsxs = runtime.jsxs;

		// novel-pane 的浏览器半身：输入框上方一行入口 + 右侧一块阅读区。
		//
		// 分页、折行、书单、记位置全在宿主（`/dsh-novel-pane`）。这里只做三件事：
		// 把宿主给的快照画出来、把点击/滚轮翻译成 `POST /move`、阅读模式开着时给
		// `#root` 让出右边那条宽度（`html.dshnp-reading` + 一条注入的 CSS）。
		//
		// 关着时只有一行「读书」；点开是**书库**（宿主 `/state?shelf=1` 给的
		// `shelf`），点一本书才进正文。整块阅读区是 `position: fixed` 的，不占
		// 对话流的布局，所以打开/关闭不会推着消息列表重排。

		const API = "/dsh-novel-pane";
		const READING_CLASS = "dshnp-reading";
		const LINE = 26; // 与正文 CSS 的 line-height 一致
		const POLL_MS = 3000;
		const OFFLINE =
			"连不上读书服务（/dsh-novel-pane 没有响应）。确认 dsh-novel-pane 插件开着，再点「读书」重试。";

		//#region 图标
		/** 14×14 线性图标；比 emoji 稳，也不受系统字体影响。 */
		const icon = (paths, size = 14) =>
			jsxs("svg", {
				viewBox: "0 0 16 16",
				width: size,
				height: size,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.5,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: paths.map((d, i) => jsx("path", { key: i, d })),
			});

		const ICON = {
			book: [
				"M8 3.2C6.6 2.4 4.8 2.4 3.4 3.1v9.1c1.4-.7 3.2-.7 4.6.1",
				"M8 3.2c1.4-.8 3.2-.8 4.6-.1v9.1c-1.4-.7-3.2-.7-4.6.1",
				"M8 3.2v9.3",
			],
			doc: ["M4 2.5h5l3 3v8a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5v-10a.5.5 0 01.5-.5z", "M9 2.5v3h3"],
			up: ["M4 10l4-4 4 4"],
			down: ["M4 6l4 4 4-4"],
			top: ["M4 3.5h8", "M12 7.5l-4-4-4 4"],
			list: ["M5.5 4h7M5.5 8h7M5.5 12h7", "M2.5 4h.01M2.5 8h.01M2.5 12h.01"],
			folder: [
				"M2.5 5.2c0-.7.5-1.2 1.2-1.2h2.3l1.2 1.4h5.1c.7 0 1.2.5 1.2 1.2v5.2c0 .7-.5 1.2-1.2 1.2H3.7c-.7 0-1.2-.5-1.2-1.2z",
			],
			x: ["M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"],
		};
		//#endregion

		//#region 样式
		const CSS = `
/* 阅读区宽度只在这一个自定义属性里定义：面板和 #root 的让位共用它，
   两边永远不会对不上。窄屏按视口比例走，宽屏封顶 520px。 */
:root{--dshnp-w:min(46vw,520px);
  --dshnp-sans:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);
  --dshnp-serif:"Noto Serif SC","Source Han Serif SC","Songti SC","SimSun",Georgia,serif;
  --dshnp-brand:var(--dsw-alias-brand-primary,#4d6bfe)}

/* 布局让位：只缩 #root，不碰 body 的 padding/margin。 */
html.dshnp-reading #root { width: calc(100vw - var(--dshnp-w, 440px)); overflow: hidden; }

/* 输入框上方那一行入口（阅读区关着时唯一的痕迹） */
.dshnp_dock{box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;
  padding:2px calc(var(--dsh-composer-side-clearance,16px) + 16px) 0;
  font-family:var(--dshnp-sans);color:var(--dsw-alias-label-primary,#222)}
.dshnp_launchrow{display:flex;align-items:center;gap:2px}
.dshnp_launch{display:flex;align-items:center;gap:8px;flex:1;min-width:0;height:30px;padding:0 8px;
  appearance:none;border:0;border-radius:8px;background:transparent;cursor:pointer;
  color:var(--dsw-alias-label-secondary,#666);font:12px/18px var(--dshnp-sans);text-align:left}
.dshnp_launch:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));
  color:var(--dsw-alias-label-primary,#222)}
.dshnp_launch:active{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.08))}
.dshnp_launch[aria-pressed="true"]{color:var(--dsw-alias-label-primary,#222)}
.dshnp_launch svg{flex:none;opacity:.7}
.dshnp_launch_label{font-weight:500;letter-spacing:.01em}
.dshnp_launch_grow{flex:1}
.dshnp_launch_meta{max-width:58%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--dsw-alias-label-tertiary,#999);font-variant-numeric:tabular-nums}

/* 阅读区：固定贴右边，整块自成一体 */
.dshnp_panel{position:fixed;right:0;top:0;bottom:0;z-index:100;box-sizing:border-box;
  width:var(--dshnp-w,min(46vw,520px));display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-layer-1,#fff);
  border-left:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));
  box-shadow:-14px 0 36px rgba(0,0,0,.07),-1px 0 0 rgba(0,0,0,.02);
  font-family:var(--dshnp-sans);color:var(--dsw-alias-label-primary,#222);
  animation:dshnp_slide .18s ease-out}
@keyframes dshnp_slide{from{opacity:.4;transform:translateX(12px)}to{opacity:1;transform:none}}

/* 拖拽条：贴在面板左缘，左右拖改宽度；双击恢复默认宽度。
   它自己绝对定位在面板里，所以不会参与面板内部的 flex 布局。 */
.dshnp_grip{position:absolute;left:-3px;top:0;bottom:0;width:7px;cursor:col-resize;
  background:transparent;touch-action:none;border:0;padding:0}
.dshnp_grip:hover,.dshnp_grip[data-drag="true"]{background:var(--dsw-alias-border-l2,rgba(0,0,0,.16))}
.dshnp_grip:focus-visible{outline:2px solid var(--dshnp-brand);outline-offset:-2px}

/* 表头：标题 + 位置 + 几个图标按钮 */
.dshnp_phead{display:flex;align-items:center;gap:2px;height:44px;padding:0 8px 0 16px;flex:none;
  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}
.dshnp_ptitle{max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font:600 13px/20px var(--dshnp-sans);color:var(--dsw-alias-label-primary,#222)}
.dshnp_ppos{margin-left:8px;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;
  font-variant-numeric:tabular-nums;white-space:nowrap;flex:none}
.dshnp_grow{flex:1;min-width:0}
.dshnp_ib{display:inline-flex;align-items:center;justify-content:center;width:27px;height:27px;padding:0;
  appearance:none;border:0;border-radius:7px;background:transparent;cursor:pointer;flex:none;
  color:var(--dsw-alias-label-secondary,#666)}
.dshnp_ib:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));
  color:var(--dsw-alias-label-primary,#222)}
.dshnp_ib:active{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.08))}
.dshnp_mode{width:auto;padding:0 8px;font:11px/18px var(--dshnp-sans)}
.dshnp_bar{height:2px;flex:none;background:var(--dsw-alias-fill-l1,rgba(0,0,0,.05))}
.dshnp_bar i{display:block;height:100%;background:var(--dshnp-brand);opacity:.55;
  transition:width .22s ease}

/* 书库 */
.dshnp_shelfbody{display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;
  padding:10px 10px 14px}
.dshnp_shelf{display:flex;flex-direction:column;gap:1px}
.dshnp_book{display:flex;align-items:center;gap:9px;width:100%;padding:8px 10px;
  appearance:none;border:0;border-radius:8px;background:transparent;cursor:pointer;
  font:13px/20px var(--dshnp-sans);color:var(--dsw-alias-label-primary,#222);text-align:left}
.dshnp_book:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dshnp_book svg{flex:none;opacity:.5}
.dshnp_book span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshnp_continue{color:var(--dshnp-brand);margin-bottom:4px}

/* 书库索引：搜索框 + 短标题 + 类型徽标 + 目录 */
.dshnp_searchrow{display:flex;align-items:center;gap:6px;margin:0 2px 8px}
.dshnp_search{flex:1;min-width:0}
.dshnp_tabs{display:flex;gap:4px;margin:0 2px 8px}
.dshnp_tab{flex:1;height:26px;padding:0 6px;appearance:none;border:1px solid transparent;border-radius:7px;
  background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));cursor:pointer;
  color:var(--dsw-alias-label-secondary,#666);font:11px/16px var(--dshnp-sans);white-space:nowrap}
.dshnp_tab[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.08));
  color:var(--dsw-alias-label-primary,#222);border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.12))}
.dshnp_more{width:100%;margin-top:8px;padding:8px 10px;appearance:none;
  border:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:8px;background:transparent;
  cursor:pointer;color:var(--dsw-alias-label-secondary,#666);font:12px/18px var(--dshnp-sans)}
.dshnp_more:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));
  color:var(--dsw-alias-label-primary,#222)}
.dshnp_sec{margin:2px 4px 4px;color:var(--dsw-alias-label-tertiary,#999);
  font:11px/16px var(--dshnp-sans);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshnp_badge{flex:none;padding:0 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05));
  color:var(--dsw-alias-label-secondary,#666);font:9px/15px var(--dshnp-sans);letter-spacing:.05em}
.dshnp_book .dshnp_libtitle{flex:1;min-width:0}
.dshnp_libdir{flex:none;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--dsw-alias-label-tertiary,#999);font-size:10px}
.dshnp_dirsec{margin-top:12px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}
.dshnp_dircwd{margin:0 4px 6px;color:var(--dsw-alias-label-tertiary,#999);
  font:11px/16px var(--dshnp-sans);word-break:break-all}
.dshnp_muted{display:flex;align-items:center;justify-content:center;gap:8px;padding:22px 12px;
  text-align:center;font:13px/20px var(--dshnp-sans);color:var(--dsw-alias-label-tertiary,#999)}
.dshnp_sub{padding:0 12px 18px;font-size:12px;line-height:18px}
.dshnp_empty{display:flex;flex-direction:column;justify-content:center;flex:1;min-height:120px}
.dshnp_hint{margin:2px 2px 8px;padding:8px 10px;border-radius:8px;
  background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));
  color:var(--dsw-alias-label-secondary,#666);font:12px/18px var(--dshnp-sans);word-break:break-word}
.dshnp_dirbtn{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;
  margin-top:10px;padding:8px 10px;appearance:none;border:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.14));
  border-radius:8px;background:transparent;cursor:pointer;
  color:var(--dsw-alias-label-secondary,#666);font:12px/18px var(--dshnp-sans)}
.dshnp_dirbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));
  color:var(--dsw-alias-label-primary,#222)}
.dshnp_dirrow{display:flex;align-items:center;gap:6px;margin-top:10px}
.dshnp_input{flex:1;min-width:0;height:30px;padding:0 10px;
  border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:8px;outline:none;
  background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,#222);
  font:12px/18px var(--dshnp-sans)}
.dshnp_input::placeholder{color:var(--dsw-alias-label-tertiary,#999)}
.dshnp_input:focus{border-color:var(--dshnp-brand)}
.dshnp_ok{height:30px;padding:0 14px;flex:none;appearance:none;border:0;border-radius:8px;cursor:pointer;
  background:var(--dsw-alias-button-primary-fill,var(--dshnp-brand));
  color:var(--dsw-alias-label-primary-inverted,#fff);font:500 12px/18px var(--dshnp-sans)}
.dshnp_ok:hover{background:var(--dsw-alias-button-primary-hover,#3d5be0)}
.dshnp_cancel{height:30px;padding:0 8px;flex:none;appearance:none;border:0;border-radius:8px;cursor:pointer;
  background:transparent;color:var(--dsw-alias-label-secondary,#666);font:12px/18px var(--dshnp-sans)}
.dshnp_cancel:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}

/* 正文 */
.dshnp_readbody{display:flex;flex-direction:column;flex:1;min-height:0}
.dshnp_textbox{flex:1;min-height:0;overflow-y:auto;padding:18px 22px 20px}
.dshnp_text{margin:0;font:15px/26px var(--dshnp-serif);letter-spacing:.01em;
  white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#222);
  animation:dshnp_in .16s ease-out}
@keyframes dshnp_in{from{opacity:.3}to{opacity:1}}
.dshnp_foot{display:flex;align-items:center;gap:4px;flex:none;height:42px;padding:0 10px;
  border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06))}
.dshnp_num{width:66px;height:26px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));
  border-radius:7px;outline:none;background:transparent;color:var(--dsw-alias-label-primary,#222);
  font:11px/16px var(--dshnp-sans);text-align:center}
.dshnp_num:focus{border-color:var(--dshnp-brand)}

/* 灵台阅读器：整块 iframe 占满阅读区（跨源，但它的响应头没有 X-Frame-Options，
   所以 3080 的页面可以嵌 8769）。 */
.dshnp_framebody{display:flex;flex-direction:column;flex:1;min-height:0;padding:10px 10px 12px}
/* iframe 外面套一层定位盒：遮罩要绝对定位在它上面 */
.dshnp_framebox{position:relative;flex:1;min-height:0;display:flex;overflow:hidden}
/* 按住 Ctrl 才可吃事件：平时 pointer-events:none，灵台自己照常响应点击与滚动 */
.dshnp_frameveil{position:absolute;inset:0;pointer-events:none;border-radius:8px;
  background:transparent;transition:background .12s ease}
.dshnp_frameveil_on{pointer-events:auto;background:rgba(77,107,254,.04)}
.dshnp_frame{flex:1;width:100%;min-height:0;border:0;border-radius:8px;
  background:var(--dsw-alias-bg-layer-1,#fff)}
.dshnp_frameerr{display:flex;flex-direction:column;gap:2px;padding:4px 2px}
.dshnp_actions{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.dshnp_btn{height:28px;padding:0 12px;appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));
  border-radius:8px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-primary,#222);
  font:12px/18px var(--dshnp-sans)}
.dshnp_btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
/* dock 那行下面的行内提示：不用 alert，也不占面板 */
.dshnp_note{margin:4px 8px 0;color:var(--dsw-alias-label-secondary,#666);
  font:11px/16px var(--dshnp-sans);word-break:break-word}
.dshnp_manual{display:block;margin:4px 8px 0;padding:4px 8px;appearance:none;border:1px dashed
  var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:7px;background:transparent;cursor:pointer;
  color:var(--dshnp-brand);font:11px/16px var(--dshnp-sans);text-align:left}
.dshnp_manual:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
/* 次要入口：切回内置面板（书库 / 索引 / 翻页） */
.dshnp_builtin{flex:none;height:30px;padding:0 8px;appearance:none;border:0;border-radius:8px;
  background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,#999);
  font:11px/18px var(--dshnp-sans)}
.dshnp_builtin:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));
  color:var(--dsw-alias-label-primary,#222)}
.dshnp_builtin[aria-pressed="true"]{color:var(--dsw-alias-label-primary,#222)}
.dshnp_launch:disabled{opacity:.6;cursor:default}
.dshnp_launch:disabled:hover{background:transparent;color:var(--dsw-alias-label-secondary,#666)}

@media (max-width:560px){
  .dshnp_ppos{display:none}
  .dshnp_textbox{padding:14px 16px 16px}
  .dshnp_phead{padding:0 6px 0 12px}
}
`;
		const TAG_ID = "@zhuobichen/dsh-client-ui-novel-pane/pane.css";

		if (
			typeof document !== "undefined" &&
			document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]") === null
		) {
			const tag = document.createElement("style");

			tag.dataset.plugin = "@zhuobichen/dsh-client-ui-novel-pane";
			tag.dataset.pluginCss = TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		/** 一屏大概能放几行：按视口高度算，宿主据此切正文窗口。 */
		const rowsNow = () => {
			const height =
				typeof window !== "undefined" && typeof window.innerHeight === "number" ? window.innerHeight : 0;

			if (height <= 0) return 20;

			return Math.max(6, Math.min(60, Math.floor((height - 150) / LINE)));
		};

		/** 取宿主快照；`shelf` 为真时要书单（宿主此时 `text` 是空数组）。 */
		const fetchState = (shelf) =>
			fetch(API + "/state?rows=" + rowsNow() + (shelf ? "&shelf=1" : ""), { cache: "no-store" })
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null);

		/** 取书库索引：本机各目录里的书（宿主扫一遍，缓存 60 秒）。 */
		const fetchLibrary = () =>
			fetch(API + "/library", { cache: "no-store" })
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null);

		/** 发一个 `/move`；返回 `{ ok, data }`，失败也带上（好写提示）。 */
		const send = (body) =>
			fetch(API + "/move", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ rows: rowsNow(), ...body }),
			})
				.then(async (r) => {
					let data = null;

					try {
						data = await r.json();
					} catch {
						data = null;
					}

					return { ok: r.ok, data };
				})
				.catch(() => ({ ok: false, data: null }));

		/**
		 * `POST /dsh-novel-pane/lingtai`：确保灵台阅读器在跑。
		 *
		 * 宿主那边是「探测 → 没在跑就 spawn → 最多等 12 秒」，成功回
		 * `{ok:true, launched, url}`，失败回 `{ok:false, code, message, url}`；
		 * 整个宿主连不上时这里拿 null（调用方据此退回内置面板）。
		 */
		const requestLingTai = () =>
			fetch(API + "/lingtai", { method: "POST" })
				.then(async (r) => {
					try {
						return await r.json();
					} catch {
						return null;
					}
				})
				.catch(() => null);

		//#region 阅读区宽度（可拖拽）

		/** 太窄读不了，太宽把对话挤没。 */
		const MIN_W = 320;
		const MAX_W = 900;
		const WIDTH_KEY = "dshnp-width";

		/**
		 * 把一个候选宽度夹进 [320, min(900, 80% 视口)]。
		 *
		 * 纯函数，测试直接调；`raw` 不是数字时返回 null（调用方据此"恢复默认"）。
		 */
		const clampWidth = (raw, viewportWidth) => {
			const value = Math.round(Number(raw));

			if (!Number.isFinite(value)) return null;

			const vw = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1440;
			const max = Math.min(MAX_W, Math.round(vw * 0.8));

			return Math.min(Math.max(value, MIN_W), Math.max(MIN_W, max));
		};

		/** 上次拖到多宽；读不到就是 null（用 CSS 里的默认宽度）。 */
		const storedWidth = () => {
			try {
				const raw = window.localStorage.getItem(WIDTH_KEY);

				return raw === null ? null : clampWidth(Number(raw), window.innerWidth);
			} catch {
				return null;
			}
		};

		/** 记住宽度；存不进去只影响"下次还记不记得"。 */
		const rememberWidth = (px) => {
			try {
				if (px === null) window.localStorage.removeItem(WIDTH_KEY);
				else window.localStorage.setItem(WIDTH_KEY, String(px));
			} catch {
				// 隐私模式 / 禁用 storage：忽略
			}
		};

		//#endregion

		//#region 阅读区缩放（只缩正文，不缩整页）

		/** 字号倍数下限/上限：再小看不清，再大撑破行宽。 */
		const ZOOM_MIN = 0.7;
		const ZOOM_MAX = 2.2;
		const ZOOM_STEP = 0.1;
		const ZOOM_KEY = "dshnp-zoom";

		/** 正文基准字号与行高（与 CSS 里的 `font:15px/26px` 保持一致）。 */
		const BASE_FONT = 15;
		const BASE_LINE = 26;

		/**
		 * 把候选倍数夹进 [0.7, 2.2]，保留一位小数。
		 *
		 * 纯函数，测试直接调；非数字回 1（默认），不会把正文缩成 0。
		 */
		const clampZoom = (raw) => {
			const value = Number(raw);

			if (!Number.isFinite(value)) return 1;

			return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 10) / 10));
		};

		/** 上次的缩放倍数；读不到就是 1。 */
		const storedZoom = () => {
			try {
				const raw = window.localStorage.getItem(ZOOM_KEY);

				return raw === null ? 1 : clampZoom(raw);
			} catch {
				return 1;
			}
		};

		const rememberZoom = (value) => {
			try {
				window.localStorage.setItem(ZOOM_KEY, String(value));
			} catch {
				// 隐私模式：只影响"下次记不记得"
			}
		};

		const LITE_ZOOM_KEY = "dshnp-lite-zoom";

		/** 灵台的缩放倍数（iframe 整体缩放，范围同正文）。 */
		const storedLiteZoom = () => {
			try {
				const raw = window.localStorage.getItem(LITE_ZOOM_KEY);

				return raw === null ? 1 : clampZoom(raw);
			} catch {
				return 1;
			}
		};

		const rememberLiteZoom = (value) => {
			try {
				window.localStorage.setItem(LITE_ZOOM_KEY, String(value));
			} catch {
				// 同上
			}
		};

		//#endregion

		/**
		 * 面板的跨会话状态。
		 *
		 * 这个组件挂在会话作用域的 `conversation.input.dock` 上：**切换会话会把它卸载重挂**，
		 * 组件内的 `useState` 因此清零（表现就是"一换会话读书面板就收起"）。
		 * 把开合/视图/灵台地址放在模块作用域，重挂时从这里恢复；页面刷新才丢。
		 */
		const panelState = { open: false, view: "shelf", liteUrl: "" };

		/**
		 * 窗格本体。
		 *
		 * `open` 是右侧阅读区；`view` 是它里面的两页：`shelf`（书库）和 `read`
		 * （正文）。两者都从宿主快照渲染，这里不缓存正文。
		 */
		function NovelPane() {
			const [snap, setSnap] = react.useState(null);
			// 面板状态挂在模块级：切换会话时这个组件会被卸载重挂，放组件 state 里
			// 会"一换会话就收起"。模块级只在页面刷新时丢，恰好是我们想要的粒度。
			const [open, setOpen] = react.useState(() => panelState.open);
			const [view, setView] = react.useState(() => panelState.view);
			// failed：连不上宿主且手里还什么都没有。这时不缩 #root —— 没有内容可看，
			// 就别白缩一块布局。
			const [failed, setFailed] = react.useState(false);
			const [notice, setNotice] = react.useState("");
			const [dirDraft, setDirDraft] = react.useState("");
			const [dirOpen, setDirOpen] = react.useState(false);
			const [jump, setJump] = react.useState("");
			// 灵台阅读器：POST /lingtai 拉着走的那几个状态。
			// starting → dock 那行「正在启动…」；liteUrl → iframe 的 src；
			// liteError → 面板里那句可读错误（超时 / 没配目录）；dockNote → dock 下方的行内提示。
			const [starting, setStarting] = react.useState(false);
			const [liteUrl, setLiteUrl] = react.useState(() => panelState.liteUrl);
			const [liteError, setLiteError] = react.useState("");
			const [dockNote, setDockNote] = react.useState("");
			// window.open 被浏览器拦截时的兜底：这条提示自己可点（走 location.href）
			const [manualUrl, setManualUrl] = react.useState("");
			// 书库索引（宿主 /library）；null = 还没拿到，[] = 拿不到 / 真的空
			const [library, setLibrary] = react.useState(null);
			// 书库搜索框：纯前端过滤标题 / 原名
			const [query, setQuery] = react.useState("");
			// 分组：全部 / 电子书（epub+txt+md）/ PDF
			const [group, setGroup] = react.useState("all");
			// 列表可能上百条：先渲染 50 条，点「显示更多」再放 50 条
			const [limit, setLimit] = react.useState(50);
			// 用户主动「换个目录」之后，索引之外再把那个目录的文件列出来
			const [browsing, setBrowsing] = react.useState(false);
			// 滚轮累积：一格一格地调接口太密，攒够一行再发
			const wheel = react.useRef(0);
			// effect 里只想知道「手里有没有旧内容」，用 ref 免得把 snap 塞进依赖
			const snapRef = react.useRef(null);
			// 阅读区宽度：null = 用 CSS 里的默认值（min(46vw,520px)）
			const [paneW, setPaneW] = react.useState(storedWidth);
			// 拖拽过程中要知道"当前多宽"，而 setPaneW 是异步的
			const paneWRef = react.useRef(paneW);
			// 阅读区字号倍数：只作用于正文 <pre>，不动整页
			const [zoom, setZoom] = react.useState(storedZoom);
			// 灵台（iframe）的缩放：跨源改不了它内部的字号，只能整体缩放 iframe
			const [liteZoom, setLiteZoom] = react.useState(storedLiteZoom);
			// 按住 Ctrl 时在 iframe 上盖一层遮罩，把滚轮从 iframe 手里抢回来
			const [ctrlHeld, setCtrlHeld] = react.useState(false);
			// Ctrl+滚轮要 preventDefault 才拦得住浏览器整页缩放，得用非 passive 的原生监听
			const textboxRef = react.useRef(null);
			// 滚轮回调是长生命周期闭包：读当前是「正文」还是「灵台」得走 ref
			const viewRef = react.useRef(view);

			viewRef.current = view;

			snapRef.current = snap;
			paneWRef.current = paneW;
			// 每次渲染把这三个写回模块级：下次重挂（切会话）从这里恢复
			panelState.open = open;
			panelState.view = view;
			panelState.liteUrl = liteUrl;

			const reading = open && !failed;

			// 把宽度写进 CSS 变量：面板和 #root 的让位都读这一个值，永远对得上。
			// null 时删掉属性，回到 CSS 里的默认宽度。
			react.useEffect(() => {
				if (typeof document === "undefined" || document === null) return undefined;

				const root = document.documentElement;

				if (!root || !root.style) return undefined;

				const apply = () => {
					try {
						if (paneW === null) root.style.removeProperty("--dshnp-w");
						else root.style.setProperty("--dshnp-w", `${paneW}px`);
					} catch {
						// 老浏览器 / 假环境：宽度就停在默认值
					}
				};

				apply();

				return () => {
					try {
						root.style.removeProperty("--dshnp-w");
					} catch {
						// 同上
					}
				};
			}, [paneW]);

			// 记住缩放倍数（拖动/按键都会改它）
			react.useEffect(() => {
				rememberZoom(zoom);
			}, [zoom]);

			// Ctrl+滚轮缩放：挂在 **window 的捕获阶段**，而不是正文容器上。
			//
			// 挂容器时只有鼠标正好在正文上才拦得住；在表头、边距、页面别处按
			// Ctrl+滚轮，浏览器照样缩整页。用户要的是"阅读器开着就优先缩阅读器"，
			// 所以只要阅读区开着就整页接管。
			//
			// 灵台那页是 iframe（跨源）：滚轮事件进到 iframe 内部，这里根本收不到。
			// 对策是按住 Ctrl 时给 iframe 盖一层遮罩（见 dshnp_frameveil），
			// 把事件截在父页面里，再整体缩放 iframe 自己。
			//
			// 必须用非 passive 监听，`preventDefault` 才拦得住浏览器缩放。
			react.useEffect(() => {
				if (!reading) return undefined;

				const view = typeof window === "undefined" ? undefined : window;

				if (!view || typeof view.addEventListener !== "function") return undefined;

				const onZoomWheel = (event) => {
					if (!event || event.ctrlKey !== true) return;

					if (typeof event.preventDefault === "function") event.preventDefault();
					if (typeof event.stopPropagation === "function") event.stopPropagation();

					const step = Number(event.deltaY) > 0 ? -ZOOM_STEP : ZOOM_STEP;

					if (viewRef.current === "lingtai") setLiteZoom((current) => clampZoom(current + step));
					else setZoom((current) => clampZoom(current + step));
				};

				view.addEventListener("wheel", onZoomWheel, { passive: false, capture: true });

				return () => view.removeEventListener("wheel", onZoomWheel, { capture: true });
			}, [reading]);

			// 灵台开着的时候盯住 Ctrl：按下才把遮罩变成"可吃事件"，松开就还回去。
			react.useEffect(() => {
				if (!reading || view !== "lingtai") return undefined;

				const scope = typeof window === "undefined" ? undefined : window;

				if (!scope || typeof scope.addEventListener !== "function") return undefined;

				const down = (event) => {
					if (event && event.key === "Control") setCtrlHeld(true);
				};

				const up = (event) => {
					if (event && event.key === "Control") setCtrlHeld(false);
				};

				const blur = () => setCtrlHeld(false);

				scope.addEventListener("keydown", down, true);
				scope.addEventListener("keyup", up, true);
				scope.addEventListener("blur", blur);

				return () => {
					scope.removeEventListener("keydown", down, { capture: true });
					scope.removeEventListener("keyup", up, { capture: true });
					scope.removeEventListener("blur", blur);
					setCtrlHeld(false);
				};
			}, [reading, view]);

			// 灵台缩放记忆
			react.useEffect(() => {
				rememberLiteZoom(liteZoom);
			}, [liteZoom]);

			/** 拖拽条：按下后跟指针走，松手才落盘（拖动期间不写 localStorage）。 */
			const startDrag = (event) => {
				if (event && typeof event.preventDefault === "function") event.preventDefault();

				const view = typeof window === "undefined" ? undefined : window;

				if (!view || typeof view.addEventListener !== "function") return;

				const move = (moveEvent) => {
					const next = clampWidth(view.innerWidth - moveEvent.clientX, view.innerWidth);

					if (next !== null) setPaneW(next);
				};

				const stop = () => {
					view.removeEventListener("pointermove", move);
					view.removeEventListener("pointerup", stop);
					view.removeEventListener("pointercancel", stop);
					rememberWidth(paneWRef.current);
				};

				view.addEventListener("pointermove", move);
				view.addEventListener("pointerup", stop);
				view.addEventListener("pointercancel", stop);
			};

			/** 双击恢复默认宽度。 */
			const resetWidth = () => {
				setPaneW(null);
				rememberWidth(null);
			};

			// 布局让位：只在阅读区真能显示内容时缩 #root；关闭、失败、卸载都要摘掉，
			// 不留半缩的页面。
			react.useEffect(() => {
				if (typeof document === "undefined" || document === null) return undefined;

				const root = document.documentElement;

				if (!root || !root.classList) return undefined;

				if (reading) root.classList.add(READING_CLASS);
				else root.classList.remove(READING_CLASS);

				return () => {
					root.classList.remove(READING_CLASS);
				};
			}, [reading]);

			react.useEffect(() => {
				if (!open) return undefined;
				// 灵台阅读器视图是宿主拉起来的独立 app：iframe 自己活着，不用取 /state
				if (view === "lingtai") return undefined;

				let alive = true;
				const load = () => {
					fetchState(view === "shelf").then((next) => {
						if (!alive) return;

						if (!next) {
							// 已经有内容：只提示，布局不动；手里空的：认输，把让位收回来
							if (snapRef.current === null) setFailed(true);
							setNotice(OFFLINE);

							return;
						}

						setSnap(next);
						setFailed(false);
						setNotice("");
					});

					// 书库页要索引；拿不到就退成「按目录列文件」（老宿主也能用）
					if (view !== "shelf") return;

					fetchLibrary().then((next) => {
						if (!alive) return;

						setLibrary(
							next && Array.isArray(next.books) ? next : { books: [], skipped: [] },
						);
					});
				};

				load();

				// 书库只在打开/换视图时取一次；正文每 3 秒跟一次，这样在提示框里敲
				// `/novel n`，右边的正文也会跟着翻。
				if (view !== "read") {
					return () => {
						alive = false;
					};
				}

				const ticker = setInterval(load, POLL_MS);

				return () => {
					alive = false;
					clearInterval(ticker);
				};
			}, [open, view]);

			/** 把一次 POST 的结果收进快照；成功返回 true。 */
			const accept = (result) => {
				if (!result || result.ok !== true || result.data === null || result.data === undefined) return false;

				setSnap(result.data);
				setFailed(false);

				return true;
			};

			/** 失败原因：宿主给了人能读的 message 就照抄，否则用 error / 连不上。 */
			const why = (result) => {
				const data = result && result.data ? result.data : null;
				const message = data && typeof data.message === "string" ? data.message : "";

				if (message !== "") return message;

				const error = data ? data.error : null;

				return typeof error === "string" && error !== "" ? "操作失败：" + error : OFFLINE;
			};

			const openShelf = () => {
				setFailed(false);
				setNotice("");
				setView("shelf");
				setOpen(true);
			};

			/**
			 * 点「读书」：先让宿主确保灵台阅读器在跑，成功就把右侧面板换成 iframe。
			 *
			 * 失败分两种：
			 * - 宿主**认** /lingtai 但没起来（超时 / 没配目录）→ 面板里给可读错误 + 重试；
			 * - 宿主连不上 / 是旧版没有这条路由（回执不带 `ok` 布尔）→ 退回内置面板，
			 *   书库 / 索引 / 翻页一条都不能因此消失。
			 */
			const startLingTai = () => {
				if (starting) return;

				setStarting(true);
				setDockNote("");
				setLiteError("");
				setManualUrl("");

				requestLingTai().then((data) => {
					setStarting(false);

					const url = data && typeof data.url === "string" ? data.url : "";

					if (data && data.ok === true && url !== "") {
						setLiteUrl(url);
						setLiteError("");
						setView("lingtai");
						setOpen(true);
						setFailed(false);
						setNotice("");

						return;
					}

					if (data && typeof data.ok === "boolean") {
						// 宿主认这条路由、但没起来：在面板里说清楚，给「重试」
						const message =
							typeof data.message === "string" && data.message !== ""
								? data.message
								: "灵台阅读器没能起来";

						setLiteUrl(url);
						setLiteError(message);
						setView("lingtai");
						setOpen(true);
						setFailed(false);
						setNotice("");
						setDockNote(message);

						return;
					}

					// 旧版宿主 / 整个宿主连不上：退回内置面板
					setDockNote(OFFLINE);
					openShelf();
				});
			};

			/** iframe 的退路：新标签打开。被拦就把「点这里手动打开」放出来（提示自己可点）。 */
			const openInTab = (url) => {
				const target = typeof url === "string" && url !== "" ? url : liteUrl;

				if (target === "") return;

				let opened = null;

				try {
					if (typeof window !== "undefined" && typeof window.open === "function") {
						opened = window.open(target, "_blank", "noopener");
					}
				} catch {
					opened = null;
				}

				if (opened === null || opened === undefined) {
					setManualUrl(target);
					setDockNote("被浏览器拦截了，点这里手动打开");
				}
			};

			/** 手动打开提示自己的点击：整页跳过去（不依赖 popup）。 */
			const openManually = () => {
				if (manualUrl === "") return;

				try {
					window.location.href = manualUrl;
				} catch {
					// 假环境 / 被拦：什么也做不了
				}
			};

			const close = () => {
				setOpen(false);
				setFailed(false);
				setNotice("");
				setDirOpen(false);
				// 让宿主那半也收起；失败无所谓，这边已经退出阅读模式了
				send({ op: "close" });
			};

			/** 翻页 / 换行 / 开关模式：一律走 `/move`，把回执当新快照。 */
			const act = (body) => {
				send(body).then((result) => {
					if (accept(result)) {
						setNotice("");

						return;
					}

					setNotice(why(result));
				});
			};

			/** 从书库开一本：宿主收 `{op:"open-book", name}`，name 相对书库目录。 */
			const openNamed = (name) => {
				send({ op: "open-book", name }).then((result) => {
					if (!accept(result)) {
						setNotice(why(result));

						return;
					}

					setView("read");
					setNotice("");
				});
			};

			/** 从书库索引开一本：宿主收 `{op:"open-path", path}`（绝对路径）。 */
			const openPath = (path) => {
				send({ op: "open-path", path }).then((result) => {
					if (!accept(result)) {
						setNotice(why(result));

						return;
					}

					setView("read");
					setNotice("");
				});
			};

			/** 接着读上次那本：宿主收 `{op:"open"}`，顺手把窗格打开。 */
			const continueLast = () => {
				send({ op: "open" }).then((result) => {
					if (!accept(result)) {
						setNotice(why(result));

						return;
					}

					setView("read");
					setNotice("");
				});
			};

			/** 书库里的「换个目录」：先当文件开（open-path），不是文件再当目录（browse）。 */
			const submitPath = () => {
				const raw = dirDraft.trim();

				if (raw === "") {
					setNotice("先填一个目录或文件路径");

					return;
				}

				setNotice("");
				send({ op: "open-path", path: raw }).then((first) => {
					if (accept(first)) {
						setView("read");
						setDirOpen(false);
						setDirDraft("");

						return;
					}

					const reason = first && first.data ? first.data.error : null;

					if (reason !== "not a file") {
						setNotice("打不开这个路径：" + raw);

						return;
					}

					send({ op: "browse", dir: raw, shelf: true }).then((second) => {
						if (!second || second.ok !== true || !second.data) {
							setNotice(why(second));

							return;
						}

						setSnap(second.data);
						setFailed(false);
						setNotice("");
						setBrowsing(true);
						setDirOpen(false);
						setDirDraft("");
					});
				});
			};

			const jumpTo = () => {
				const line = Number(jump.trim());

				if (!Number.isFinite(line) || line <= 0) {
					setNotice("填一个从 1 开始的行号");

					return;
				}

				setJump("");
				// 宿主按 0 起的行号记账
				act({ op: "goto", line: Math.floor(line) - 1 });
			};

			const onWheel = (event) => {
				// Ctrl+滚轮是缩放，不是翻页：交给下面的原生监听处理
				if (event && event.ctrlKey) return;

				if (event && typeof event.preventDefault === "function") event.preventDefault();

				wheel.current += Number(event && event.deltaY ? event.deltaY : 0);

				if (Math.abs(wheel.current) < LINE) return;

				const direction = wheel.current > 0 ? 1 : -1;

				wheel.current = 0;
				act({ op: "wheel", delta: direction });
			};

			const title = snap && typeof snap.title === "string" ? snap.title : "";
			const file = snap && typeof snap.file === "string" ? snap.file : "";
			const dir = snap && typeof snap.dir === "string" ? snap.dir : "";
			const shelfNames = snap && Array.isArray(snap.shelf) ? snap.shelf : null;
			// 书库索引：null = 还没拿到；[] = 没扫到 / 宿主不认这个路由
			const indexBooks = library && Array.isArray(library.books) ? library.books : null;
			const skipped = library && Array.isArray(library.skipped) ? library.skipped : [];
			// 真不支持的格式（mobi / azw3）：宿主会带 reason，这里只汇总个数和类型
			const skippedKinds = [
				...new Set(skipped.map((entry) => String((entry && entry.kind) || "").toUpperCase())),
			].filter((kind) => kind !== "");
			const needle = query.trim().toLowerCase();
			// 先按搜索词过滤，再按分组（电子书 = epub + txt + md），最后只渲染前 limit 条
			const matchedBooks =
				indexBooks === null
					? null
					: indexBooks.filter((book) => {
							if (needle === "") return true;

							const bookTitle = String(book && book.title ? book.title : "");
							const bookName = String(book && book.name ? book.name : "");

							return (
								bookTitle.toLowerCase().includes(needle) ||
								bookName.toLowerCase().includes(needle)
							);
						});
			const groupOfBook = (book) => (String(book && book.kind) === "pdf" ? "pdf" : "ebook");
			const groupedBooks =
				matchedBooks === null
					? null
					: matchedBooks.filter((book) => group === "all" || groupOfBook(book) === group);
			const visibleBooks = groupedBooks === null ? null : groupedBooks.slice(0, limit);
			const restBooks = groupedBooks === null ? 0 : Math.max(0, groupedBooks.length - visibleBooks.length);
			const countOf = (key) => {
				if (indexBooks === null) return 0;

				return key === "all"
					? indexBooks.length
					: indexBooks.filter((book) => groupOfBook(book) === key).length;
			};
			const hasIndex = matchedBooks !== null && matchedBooks.length > 0;
			const text = snap && Array.isArray(snap.text) ? snap.text : null;
			const total = snap && typeof snap.total === "number" ? snap.total : 0;
			const rows = snap && typeof snap.rows === "number" ? snap.rows : rowsNow();
			const seen = snap && typeof snap.line === "number" ? snap.line : 0;
			const mode = snap && snap.mode === "page" ? "page" : "scroll";
			const position = snap && typeof snap.position === "string" ? snap.position : "";
			const pct =
				total <= 0 ? 0 : Math.min(100, Math.round((Math.min(total, seen + rows) / total) * 100));

			const meta = open
				? view === "lingtai"
					? "灵台阅读器"
					: view === "read"
						? title || "阅读中"
						: "书库"
				: title === ""
					? null
					: "上次 · " + title;

			const launch = jsxs("div", {
				className: "dshnp_launchrow",
				children: [
					jsxs("button", {
						className: "dshnp_launch",
						title:
							open && view !== "lingtai"
								? "收起阅读区"
								: "用灵台阅读器打开（没在跑会自动拉起）",
						"aria-pressed": open === true,
						disabled: starting,
						onClick: startLingTai,
						children: [
							icon(ICON.book),
							jsx("span", {
								className: "dshnp_launch_label",
								children: starting ? "正在启动…" : "读书",
							}),
							jsx("span", { className: "dshnp_launch_grow" }),
							meta === null ? null : jsx("span", { className: "dshnp_launch_meta", children: meta }),
						].filter((node) => node !== null),
					}),
					// 次要入口：内置面板（书库 / 索引 / 翻页）原样保留
					jsx("button", {
						className: "dshnp_builtin",
						title: "内置阅读面板：书库 / 索引 / 翻页",
						"aria-pressed": open && view !== "lingtai",
						onClick: () => {
							if (open && view !== "lingtai") close();
							else openShelf();
						},
						children: "内置",
					}),
				],
			});

			const headline =
				view === "lingtai" ? "灵台阅读器" : view === "shelf" ? "书库" : title || "阅读";
			const liteHost = liteUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
			const sub =
				view === "lingtai"
					? liteError === ""
						? liteHost
						: "没起来"
					: view === "shelf"
						? indexBooks !== null && indexBooks.length > 0
							? indexBooks.length + " 本"
							: shelfNames === null
								? ""
								: shelfNames.length + " 本"
						: position;

			const head = jsxs("div", {
				className: "dshnp_phead",
				children: [
					jsx("span", {
						className: "dshnp_ptitle",
						title:
							view === "lingtai"
								? liteUrl
								: view === "shelf"
									? dir || "书库"
									: file || title,
						children: headline,
					}),
					sub === "" ? null : jsx("span", { className: "dshnp_ppos", title: position, children: sub }),
					jsx("span", { className: "dshnp_grow" }),
					// 字号：只缩阅读区的正文，不动整页（Ctrl+滚轮等价于这两个按钮）
					view === "read"
						? jsx("button", {
								className: "dshnp_ib",
								title: "缩小正文（Ctrl+滚轮也行）",
								onClick: () => setZoom((current) => clampZoom(current - ZOOM_STEP)),
								children: "A−",
							})
						: null,
					view === "read"
						? jsx("button", {
								className: "dshnp_ib",
								title: "放大正文（Ctrl+滚轮也行）",
								onClick: () => setZoom((current) => clampZoom(current + ZOOM_STEP)),
								children: "A+",
							})
						: null,
					view === "read" && zoom !== 1
						? jsx("button", {
								className: "dshnp_ib dshnp_mode",
								title: "恢复默认字号",
								onClick: () => setZoom(1),
								children: `${Math.round(zoom * 100)}%`,
							})
						: null,
					view === "read"
						? jsx("button", {
								className: "dshnp_ib dshnp_mode",
								title: "切换翻页方式（卷轴 / 整屏）",
								onClick: () => act({ op: "mode" }),
								children: mode === "page" ? "整屏" : "卷轴",
							})
						: null,
					view === "read"
						? jsx("button", {
								className: "dshnp_ib",
								title: "书库",
								onClick: () => {
									setView("shelf");
									setDirOpen(false);
								},
								children: icon(ICON.list),
							})
						: view === "shelf"
							? jsx("button", {
									className: "dshnp_ib",
									title: "换个目录",
									onClick: () => setDirOpen((on) => !on),
									children: icon(ICON.folder),
								})
							: null,
					// 灵台（iframe）也得能缩：跨源改不了它的字号，只能整体缩放
					view === "lingtai"
						? jsx("button", {
								className: "dshnp_ib",
								title: "缩小灵台（Ctrl+滚轮也行）",
								onClick: () => setLiteZoom((current) => clampZoom(current - ZOOM_STEP)),
								children: "A−",
							})
						: null,
					view === "lingtai"
						? jsx("button", {
								className: "dshnp_ib",
								title: "放大灵台（Ctrl+滚轮也行）",
								onClick: () => setLiteZoom((current) => clampZoom(current + ZOOM_STEP)),
								children: "A+",
							})
						: null,
					view === "lingtai" && liteZoom !== 1
						? jsx("button", {
								className: "dshnp_ib dshnp_mode",
								title: "恢复灵台默认缩放",
								onClick: () => setLiteZoom(1),
								children: `${Math.round(liteZoom * 100)}%`,
							})
						: null,
					// 灵台阅读器：iframe 出问题时的退路，以及切回内置面板的入口
					view === "lingtai" && liteUrl !== ""
						? jsx("button", {
								className: "dshnp_ib dshnp_mode",
								title: "在新标签页打开（iframe 被拦时的退路）",
								onClick: () => openInTab(liteUrl),
								children: "新标签打开",
							})
						: null,
					view === "lingtai"
						? jsx("button", {
								className: "dshnp_ib dshnp_mode",
								title: "切回内置阅读面板",
								onClick: () => {
									setView("shelf");
									setDirOpen(false);
								},
								children: "内置",
							})
						: null,
					jsx("button", {
						className: "dshnp_ib",
						title: "关闭阅读区",
						onClick: close,
						children: icon(ICON.x),
					}),
				].filter((node) => node !== null),
			});

			const bar =
				view === "read"
					? jsx("div", { className: "dshnp_bar", children: jsx("i", { style: { width: pct + "%" } }) })
					: null;

			const dirRow = jsxs("div", {
				className: "dshnp_dirrow",
				children: [
					jsx("input", {
						className: "dshnp_input",
						placeholder: "目录或文件路径，如 D:\\books 或 ~/book.txt",
						value: dirDraft,
						autoFocus: true,
						onChange: (event) => {
							setDirDraft(event.target.value);
							setNotice("");
						},
						onKeyDown: (event) => {
							if (event.key === "Enter") submitPath();
							if (event.key === "Escape") {
								setDirOpen(false);
								setDirDraft("");
							}
						},
					}),
					jsx("button", { className: "dshnp_ok", onClick: submitPath, children: "打开" }),
					jsx("button", {
						className: "dshnp_cancel",
						onClick: () => {
							setDirOpen(false);
							setDirDraft("");
							setNotice("");
						},
						children: "取消",
					}),
				],
			});

			let body;

			if (view === "shelf") {
				const shelfVisible =
					shelfNames !== null && shelfNames.length > 0 && (!hasIndex || browsing);
				const empty =
					matchedBooks !== null &&
					matchedBooks.length === 0 &&
					(shelfNames === null || shelfNames.length === 0);

				body = jsxs("div", {
					className: "dshnp_shelfbody",
					children: [
						notice === "" ? null : jsx("div", { className: "dshnp_hint", children: notice }),
						snap !== null && file !== ""
							? jsxs("button", {
									className: "dshnp_book dshnp_continue",
									title: "接着读上次那本",
									onClick: continueLast,
									children: [icon(ICON.book), jsx("span", { children: "接着读 · " + (title || file) })],
								})
							: null,
						// 书库索引：短标题 + 类型徽标 + 所在目录，点一本走 open-path
						indexBooks === null || indexBooks.length === 0
							? null
							: jsxs("div", {
									className: "dshnp_index",
									children: [
										jsxs("div", {
											className: "dshnp_searchrow",
											children: [
												jsx("input", {
													className: "dshnp_input dshnp_search",
													placeholder: "搜书名 / 文件名",
													value: query,
													onChange: (event) => {
														setQuery(event.target.value);
														setLimit(50);
														setNotice("");
													},
												}),
												query === ""
													? null
													: jsx("button", {
															className: "dshnp_cancel",
															onClick: () => {
																setQuery("");
																setLimit(50);
															},
															children: "清空",
														}),
											].filter((node) => node !== null),
										}),
										jsx("div", {
											className: "dshnp_tabs",
											children: [
												["all", "全部"],
												["ebook", "电子书"],
												["pdf", "PDF"],
											].map(([key, label]) =>
												jsx("button", {
													key,
													className: "dshnp_tab",
													"data-group": key,
													"aria-pressed": group === key,
													onClick: () => {
														setGroup(key);
														setLimit(50);
													},
													children: label + " " + countOf(key),
												}),
											),
										}),
										jsx("div", {
											className: "dshnp_sec",
											children:
												"书库 · 共 " +
												indexBooks.length +
												" 本" +
												(needle === "" ? "" : "（匹配 " + matchedBooks.length + " 本）"),
										}),
										visibleBooks.length === 0
											? jsx("div", {
													className: "dshnp_muted dshnp_sub",
													children: needle === "" ? "这个分组下没有书" : "没有匹配的书",
												})
											: jsx("div", {
													className: "dshnp_shelf",
													children: visibleBooks.map((book) =>
														jsxs(
															"button",
															{
																key: String(book.id || book.path || book.name),
																className: "dshnp_book dshnp_libbook",
																title: String(book.path || book.name || ""),
																onClick: () => openPath(String(book.path || "")),
																children: [
																	icon(ICON.doc),
																	jsx("span", {
																		className: "dshnp_libtitle",
																		children: String(book.title || book.name || ""),
																	}),
																	jsx("span", {
																		className: "dshnp_badge",
																		"data-kind": String(book.kind || ""),
																		children: String(book.kind || "").toUpperCase(),
																	}),
																	book.dir
																		? jsx("span", {
																				className: "dshnp_libdir",
																				title: String(book.dir),
																				children: String(book.dir),
																			})
																		: null,
																].filter((node) => node !== null),
															},
														),
													),
												}),
										restBooks === 0
											? null
											: jsx("button", {
													className: "dshnp_more",
													onClick: () => setLimit(limit + 50),
													children: "显示更多（还有 " + restBooks + " 本）",
												}),
										skipped.length === 0
											? null
											: jsx("div", {
													className: "dshnp_hint",
													children:
														skipped.length +
														" 个文件暂不支持" +
														(skippedKinds.length === 0 ? "" : "（" + skippedKinds.join(" / ") + "）") +
														"：转成 EPUB 或 TXT 再放进书库就能读。",
												}),
									].filter((node) => node !== null),
								}),
						shelfVisible
							? jsxs("div", {
									className: "dshnp_dirsec",
									children: [
										jsx("div", { className: "dshnp_sec", children: "目录 · " + dir }),
										jsx("div", {
											className: "dshnp_shelf",
											children: shelfNames.map((name) =>
												jsxs("button", {
													key: name,
													className: "dshnp_book",
													title: name,
													onClick: () => openNamed(name),
													children: [icon(ICON.doc), jsx("span", { children: name })],
												}),
											),
										}),
									],
								})
							: null,
						shelfNames === null && matchedBooks === null
							? jsx("div", {
									className: "dshnp_muted",
									children: failed ? "书库没能加载" : "正在读书库…",
								})
							: null,
						empty
							? jsxs("div", {
									className: "dshnp_empty",
									children: [
										jsx("div", { className: "dshnp_muted", children: "这个目录里没有书" }),
										jsx("div", {
											className: "dshnp_muted dshnp_sub",
											children:
												dir === ""
													? "还没有选中目录——给一个目录，或直接打开一个文件"
													: "当前目录：" + dir,
										}),
									],
								})
							: null,
						dirOpen
							? dirRow
							: jsxs("button", {
									className: "dshnp_dirbtn",
									onClick: () => setDirOpen(true),
									children: [icon(ICON.folder), jsx("span", { children: "换个目录…" })],
								}),
					].filter((node) => node !== null),
				});
			} else if (view === "lingtai") {
				// 整块 iframe：灵台阅读器自己的书架 / 阅读 / 笔记都在里面跑。
				// 跨源（3080 → 8769）嵌得进来，但浏览器层面读不到它的 DOM / localStorage，
				// 所以「渲染失败」这里检测不到 —— 头部的「新标签」就是那条退路。
				body = jsxs("div", {
					className: "dshnp_framebody",
					children: [
						liteError !== ""
							? jsxs("div", {
									className: "dshnp_frameerr",
									children: [
										jsx("div", { className: "dshnp_hint", children: liteError }),
										jsxs("div", {
											className: "dshnp_actions",
											children: [
												jsx("button", {
													className: "dshnp_btn",
													onClick: startLingTai,
													children: "重试",
												}),
												liteUrl === ""
													? null
													: jsx("button", {
															className: "dshnp_btn",
															onClick: () => openInTab(liteUrl),
															children: "新标签打开",
														}),
											].filter((node) => node !== null),
										}),
									],
								})
							: jsxs("div", {
									className: "dshnp_framebox",
									children: [
										jsx("iframe", {
											className: "dshnp_frame",
											src: liteUrl,
											title: "灵台阅读器",
											allow: "clipboard-read; clipboard-write",
											// 跨源改不了它内部字号，只能整体缩放 iframe。
											// 用 CSS `zoom` 而不是 `transform: scale()`：后者是把已经画好的位图
											// 放大，文字会糊；`zoom` 会按新比例重新排版重绘，字形仍然锐利。
											// 宽高按 1/zoom 反算，视觉上仍然铺满面板。
											style: {
												zoom: liteZoom,
												flex: "none",
												width: `${Math.round((100 / liteZoom) * 100) / 100}%`,
												height: `${Math.round((100 / liteZoom) * 100) / 100}%`,
											},
										}),
										// 按住 Ctrl 时这层变成可点，把滚轮从 iframe 手里截下来
										jsx("div", {
											className: ctrlHeld
												? "dshnp_frameveil dshnp_frameveil_on"
												: "dshnp_frameveil",
											title: ctrlHeld ? "Ctrl+滚轮缩放灵台" : "",
										}),
									],
								}),
					],
				});
			} else {
				body = jsxs("div", {
					className: "dshnp_readbody",
					children: [
						jsxs("div", {
							className: "dshnp_textbox",
							ref: textboxRef,
							onWheel,
							children: [
								notice === "" ? null : jsx("div", { className: "dshnp_hint", children: notice }),
								text === null || text.length === 0
									? jsx("div", {
											className: "dshnp_muted",
											children: "读不到这本书了（文件可能被移动或删除了）",
										})
									: jsx("pre", {
											// 换页时换 key，让淡入动画重新跑一次
											key: seen + ":" + mode,
											className: "dshnp_text",
											// 字号/行高跟着缩放倍数走；只影响正文，不动整页
											style: {
												fontSize: `${Math.round(BASE_FONT * zoom * 10) / 10}px`,
												lineHeight: `${Math.round(BASE_LINE * zoom * 10) / 10}px`,
											},
											children: text.join("\n"),
										}),
							].filter((node) => node !== null),
						}),
						jsxs("div", {
							className: "dshnp_foot",
							children: [
								jsx("button", {
									className: "dshnp_ib",
									title: "上一页",
									onClick: () => act({ op: "up" }),
									children: icon(ICON.up),
								}),
								jsx("button", {
									className: "dshnp_ib",
									title: "下一页",
									onClick: () => act({ op: "down" }),
									children: icon(ICON.down),
								}),
								jsx("button", {
									className: "dshnp_ib",
									title: "回到开头",
									onClick: () => act({ op: "top" }),
									children: icon(ICON.top),
								}),
								jsx("span", { className: "dshnp_grow" }),
								jsx("input", {
									className: "dshnp_num",
									placeholder: "行号",
									value: jump,
									onChange: (event) => {
										setJump(event.target.value);
										setNotice("");
									},
									onKeyDown: (event) => {
										if (event.key === "Enter") jumpTo();
									},
								}),
								jsx("span", { className: "dshnp_ppos", children: position }),
							],
						}),
					],
				});
			}

			// 左缘的拖拽条：拖动改宽度，双击回默认。放在最前面，绝对定位不参与 flex。
			const grip = jsx("div", {
				className: "dshnp_grip",
				role: "separator",
				"aria-orientation": "vertical",
				"aria-label": "拖动调整阅读区宽度，双击恢复默认",
				title: "拖动调整宽度 · 双击恢复默认",
				onPointerDown: startDrag,
				onDoubleClick: resetWidth,
			});

			const panel = open
				? jsxs("aside", {
						className: "dshnp_panel",
						"aria-label": "阅读区",
						onKeyDown: (event) => {
							if (event.key === "Escape") close();
						},
						children: [grip, head, bar, body].filter((node) => node !== null),
					})
				: null;

			// dock 下方的行内提示：启动失败 / 新标签被拦都在这里说一句，不用 alert
			const dockNoteNode =
				dockNote === "" ? null : jsx("div", { className: "dshnp_note", children: dockNote });
			const manualNode =
				manualUrl === ""
					? null
					: jsx("button", {
							className: "dshnp_manual",
							onClick: openManually,
							children: "被浏览器拦截了，点这里手动打开",
						});

			return jsxs("div", {
				className: "dshnp_dock",
				children: [launch, dockNoteNode, manualNode, panel].filter((node) => node !== null),
			});
		}

		/** 只需要槽位服务。 */
		const inject = ["slots"];

		function apply(ctx) {
			// 压在余额（15）下面、队列（20）上面：两行小字在上面，入口贴着输入框
			ctx.slots.inject("conversation.input.dock", () =>
				ctx.slots.register(
					{
						name: "conversation.input.dock",
						id: "novel-pane",
						order: 16,
					},
					NovelPane,
				),
			);
		}

		exports.NovelPane = NovelPane;
		exports.apply = apply;
		exports.inject = inject;
		// 给测试用：宽度夹取是纯函数，单独钉住边界
		exports.clampWidth = clampWidth;
		// 给测试用：缩放倍数夹取，同样只测边界
		exports.clampZoom = clampZoom;
		// 给测试用：跨会话状态要能在用例之间复位
		exports.panelState = panelState;

		return module.exports;
	},
});
