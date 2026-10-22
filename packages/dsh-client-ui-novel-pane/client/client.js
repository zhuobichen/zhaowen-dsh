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

		/**
		 * 窗格本体。
		 *
		 * `open` 是右侧阅读区；`view` 是它里面的两页：`shelf`（书库）和 `read`
		 * （正文）。两者都从宿主快照渲染，这里不缓存正文。
		 */
		function NovelPane() {
			const [snap, setSnap] = react.useState(null);
			const [open, setOpen] = react.useState(false);
			const [view, setView] = react.useState("shelf");
			// failed：连不上宿主且手里还什么都没有。这时不缩 #root —— 没有内容可看，
			// 就别白缩一块布局。
			const [failed, setFailed] = react.useState(false);
			const [notice, setNotice] = react.useState("");
			const [dirDraft, setDirDraft] = react.useState("");
			const [dirOpen, setDirOpen] = react.useState(false);
			const [jump, setJump] = react.useState("");
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

			snapRef.current = snap;
			paneWRef.current = paneW;

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
				? view === "read"
					? title || "阅读中"
					: "书库"
				: title === ""
					? null
					: "上次 · " + title;

			const launch = jsx("div", {
				className: "dshnp_launchrow",
				children: jsxs("button", {
					className: "dshnp_launch",
					title: open ? "收起阅读区" : "打开书库",
					"aria-pressed": open === true,
					onClick: () => {
						if (open) close();
						else openShelf();
					},
					children: [
						icon(ICON.book),
						jsx("span", { className: "dshnp_launch_label", children: "读书" }),
						jsx("span", { className: "dshnp_launch_grow" }),
						meta === null ? null : jsx("span", { className: "dshnp_launch_meta", children: meta }),
					].filter((node) => node !== null),
				}),
			});

			const headline = view === "shelf" ? "书库" : title || "阅读";
			const sub =
				view === "shelf"
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
						title: view === "shelf" ? dir || "书库" : file || title,
						children: headline,
					}),
					sub === "" ? null : jsx("span", { className: "dshnp_ppos", title: position, children: sub }),
					jsx("span", { className: "dshnp_grow" }),
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
						: jsx("button", {
								className: "dshnp_ib",
								title: "换个目录",
								onClick: () => setDirOpen((on) => !on),
								children: icon(ICON.folder),
							}),
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
			} else {
				body = jsxs("div", {
					className: "dshnp_readbody",
					children: [
						jsxs("div", {
							className: "dshnp_textbox",
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

			return jsxs("div", {
				className: "dshnp_dock",
				children: [launch, panel].filter((node) => node !== null),
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

		return module.exports;
	},
});
