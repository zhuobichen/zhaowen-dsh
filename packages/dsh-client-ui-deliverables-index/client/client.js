window.__ModuleLoader__.load({
	id: '@zhuobichen/dsh-client-ui-deliverables-index',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const runtime = require("react/jsx-runtime");
		const jsx = runtime.jsx;
		const jsxs = runtime.jsxs;

		// 文档总览的浏览器半身：右下角一个悬浮按钮，点开是「每个会话各自产出了哪些文档」。
		//
		// 数据来自宿主半身（@zhuobichen/dsh-deliverables-index）的
		// `GET /dsh-deliverables/list`；它读的是会话日志里的 `deliverables/presented`
		// 事件，所以这里**不扫盘、不猜**，只画宿主给的清单。
		//
		// 点一行怎么打开，两条路都用（README 里有区别说明）：
		//   1. 文件条目里的 `url`（= `api/present.open?sessionId&seq&index`，和
		//      @deepseek-ai/dsh-client-ui-deliverables 的 presentedFileUrl() 同一个
		//      路由），**POST** 上去 = 宿主原生打开，动作靠 `&action=reveal` 传；
		//   2. 宿主没有桌面（或原生打开失败）时，退到 `api/file?path=…` 在浏览器新
		//      标签里直读——PDF / md / txt 浏览器自己就能看，docx 会下载。
		//
		// 灰掉的规则只有一条：`exists === false` 的行不可点。文件不在了就是不在，
		// 点进去只会看到一个错误，不如现在就说清楚。

		/** 宿主路由前缀；宿主那半写死同一个串。 */
		const API = "/dsh-deliverables";

		/** 面板/按钮的样式命名空间，也是 style 标签和根节点的 data-plugin 值。 */
		const PLUGIN_ID = "dsh-deliverables-index";

		/** 位置 / 开合落在 localStorage（切会话会卸载重挂这个组件）。 */
		const POS_KEY = "dshdi-pos";
		const OPEN_KEY = "dshdi-open";

		/** 面板尺寸（与 CSS 里的值保持一致；拖拽默认位置要用它算）。 */
		const PANEL_WIDTH = 396;
		const PANEL_HEIGHT_RATIO = 0.6;
		const EDGE = 16;

		/** 类型筛选：全部 / md / pdf / docx / txt / 其他。 */
		const KINDS = [
			{ id: "all", label: "全部" },
			{ id: "md", label: "md" },
			{ id: "pdf", label: "pdf" },
			{ id: "docx", label: "docx" },
			{ id: "txt", label: "txt" },
			{ id: "other", label: "其他" },
		];

		/** 有独立筛选页的类型；其余一律算「其他」。 */
		const KNOWN_KINDS = ["md", "pdf", "docx", "txt"];

		//#region 图标
		/** 16×16 线性图标；比 emoji 稳，也不受系统字体影响。 */
		const icon = (paths, size = 15) =>
			jsxs("svg", {
				viewBox: "0 0 16 16",
				width: size,
				height: size,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: paths.map((d, index) => jsx("path", { key: index, d })),
			});

		const ICON = {
			files: ["M4 2.5h5l3 3v8a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5v-10a.5.5 0 01.5-.5z", "M9 2.5v3h3", "M5.5 8.5h5", "M5.5 11h3.5"],
			folder: ["M2.5 5.2c0-.7.5-1.2 1.2-1.2h2.3l1.2 1.4h5.1c.7 0 1.2.5 1.2 1.2v5.2c0 .7-.5 1.2-1.2 1.2H3.7c-.7 0-1.2-.5-1.2-1.2z"],
			refresh: ["M13 8a5 5 0 11-1.6-3.7", "M13 2.8v2.6h-2.6"],
			x: ["M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"],
		};
		//#endregion

		//#region 样式
		//
		// 全部规则都挂在 `.dshdi_root` 这一层下面：根节点是 `position:fixed;inset:0`
		// 但 `pointer-events:none`（整页覆盖、不吃点击），只有按钮和面板自己 opt-in。
		// 类名前缀 + style 标签上的 data-plugin 保证不污染任何全局选择器。
		const CSS = `
.dshdi_root{position:fixed;inset:0;z-index:120;pointer-events:none;
  font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);
  color:var(--dsw-alias-label-primary,#222)}

/* 右下角悬浮球 */
.dshdi_root .dshdi_fab{position:fixed;right:16px;bottom:16px;pointer-events:auto;box-sizing:border-box;
  width:40px;height:40px;display:flex;align-items:center;justify-content:center;padding:0;
  appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:50%;
  background:var(--dsw-alias-bg-layer-1,#fff);cursor:pointer;
  color:var(--dsw-alias-label-secondary,#666);box-shadow:0 2px 10px rgba(0,0,0,.12)}
.dshdi_root .dshdi_fab:hover{color:var(--dsw-alias-label-primary,#222);
  background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}
.dshdi_root .dshdi_fab:active{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.08))}
.dshdi_root .dshdi_fab[aria-pressed="true"]{color:var(--dsw-alias-brand-primary,#4d6bfe);
  border-color:var(--dsw-alias-brand-primary,#4d6bfe)}

/* 面板：默认贴右下；拖过之后由内联 left/top 接管 */
.dshdi_root .dshdi_panel{position:fixed;right:16px;bottom:66px;pointer-events:auto;box-sizing:border-box;
  width:${PANEL_WIDTH}px;max-width:calc(100vw - 24px);height:60vh;max-height:72vh;
  display:flex;flex-direction:column;overflow:hidden;
  background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));
  border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.16);animation:dshdi_in .16s ease-out}
@keyframes dshdi_in{from{opacity:.5;transform:translateY(6px)}to{opacity:1;transform:none}}

/* 表头（拖拽把手） */
.dshdi_root .dshdi_head{display:flex;align-items:center;gap:6px;flex:none;height:42px;padding:0 8px 0 12px;
  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));cursor:move;touch-action:none;
  user-select:none;-webkit-user-select:none}
.dshdi_root .dshdi_head:active{cursor:grabbing}
.dshdi_root .dshdi_title{font:600 13px/20px inherit;white-space:nowrap}
.dshdi_root .dshdi_meta{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;white-space:nowrap;
  font-variant-numeric:tabular-nums}
.dshdi_root .dshdi_grow{flex:1;min-width:0}
.dshdi_root .dshdi_ib{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;
  padding:0;appearance:none;border:0;border-radius:6px;background:transparent;cursor:pointer;flex:none;
  color:var(--dsw-alias-label-secondary,#666)}
.dshdi_root .dshdi_ib:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));
  color:var(--dsw-alias-label-primary,#222)}
.dshdi_root .dshdi_ib:disabled{opacity:.4;cursor:default;background:transparent}

/* 搜索 + 类型筛选 */
.dshdi_root .dshdi_tools{flex:none;padding:8px 10px 6px;display:flex;flex-direction:column;gap:6px}
.dshdi_root .dshdi_search{box-sizing:border-box;width:100%;height:28px;padding:0 8px;
  border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:7px;
  background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.02));color:inherit;
  font:12px/18px inherit;outline:none}
.dshdi_root .dshdi_search:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dshdi_root .dshdi_tabs{display:flex;gap:4px}
.dshdi_root .dshdi_tab{flex:1;height:24px;padding:0 4px;appearance:none;cursor:pointer;
  border:1px solid transparent;border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));
  color:var(--dsw-alias-label-secondary,#666);font:11px/16px inherit;white-space:nowrap}
.dshdi_root .dshdi_tab[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.08));
  color:var(--dsw-alias-label-primary,#222);border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.12))}

/* 列表 */
.dshdi_root .dshdi_body{flex:1;min-height:0;overflow-y:auto;padding:2px 8px 10px}
.dshdi_root .dshdi_group{margin-top:6px}
.dshdi_root .dshdi_grouphead{display:flex;align-items:center;gap:6px;padding:4px 4px 3px;
  color:var(--dsw-alias-label-secondary,#666);font:11px/16px inherit;letter-spacing:.01em}
.dshdi_root .dshdi_gtitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-weight:600}
.dshdi_root .dshdi_gcount{flex:none;color:var(--dsw-alias-label-tertiary,#999);font-variant-numeric:tabular-nums}
.dshdi_root .dshdi_gerr{margin:0 4px 4px;padding:5px 7px;border-radius:6px;font-size:11px;line-height:16px;
  background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));color:var(--dsw-alias-label-secondary,#666);
  word-break:break-all}
.dshdi_root .dshdi_item{display:flex;align-items:center;gap:2px;border-radius:7px}
.dshdi_root .dshdi_item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.045))}
.dshdi_root .dshdi_row{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:6px 6px;
  border:0;border-radius:7px;background:transparent;cursor:pointer;text-align:left;color:inherit;
  font:12px/17px inherit}
.dshdi_root .dshdi_row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:-2px}
.dshdi_root .dshdi_row--missing{color:var(--dsw-alias-label-tertiary,#999);cursor:default;opacity:.62}
.dshdi_root .dshdi_item:has(.dshdi_row--missing):hover{background:transparent}
.dshdi_root .dshdi_ext{flex:none;min-width:30px;padding:0 4px;border-radius:4px;text-align:center;
  background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05));color:var(--dsw-alias-label-secondary,#666);
  font:9px/15px inherit;letter-spacing:.04em;text-transform:lowercase}
.dshdi_root .dshdi_main{flex:1;min-width:0}
.dshdi_root .dshdi_name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshdi_root .dshdi_desc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:15px}
.dshdi_root .dshdi_time{flex:none;color:var(--dsw-alias-label-tertiary,#999);font-size:10px;
  font-variant-numeric:tabular-nums;white-space:nowrap}
.dshdi_root .dshdi_state{flex:none;color:var(--dsw-alias-label-tertiary,#999);font-size:10px;white-space:nowrap}
.dshdi_root .dshdi_reveal{opacity:0}
.dshdi_root .dshdi_item:hover .dshdi_reveal,.dshdi_root .dshdi_reveal:focus-visible{opacity:1}

/* 空态 / 错误 / 提示 */
.dshdi_root .dshdi_empty{padding:22px 14px;text-align:center;color:var(--dsw-alias-label-tertiary,#999);
  font-size:12px;line-height:19px}
.dshdi_root .dshdi_err{margin:10px 6px;padding:8px 10px;border-radius:7px;font-size:11px;line-height:17px;
  background:rgba(220,60,60,.08);color:#b4342f;word-break:break-all}
.dshdi_root .dshdi_retry{margin:8px auto 0;display:block;height:26px;padding:0 12px;appearance:none;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:7px;background:transparent;
  color:var(--dsw-alias-label-secondary,#666);font:11px/18px inherit}
.dshdi_root .dshdi_foot{flex:none;display:flex;align-items:center;gap:8px;padding:6px 12px;
  border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));
  color:var(--dsw-alias-label-tertiary,#999);font-size:10px;line-height:15px;min-height:26px}
.dshdi_root .dshdi_notice{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--dsw-alias-label-secondary,#666)}
`;

		const CSS_TAG_ID = `${PLUGIN_ID}/panel.css`;

		if (
			typeof document !== "undefined" &&
			document !== null &&
			typeof document.querySelector === "function" &&
			document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_TAG_ID)}]`) === null
		) {
			const tag = document.createElement("style");

			tag.dataset.plugin = PLUGIN_ID;
			tag.dataset.pluginCss = CSS_TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region 纯函数（测试直接钉这些）
		/** 扩展名 → 筛选类型：认识的那四种保留，其余（含空）算 other。 */
		const kindOf = (ext) => {
			const value = typeof ext === "string" ? ext.toLowerCase() : "";

			return KNOWN_KINDS.includes(value) ? value : "other";
		};

		const lower = (value) => (typeof value === "string" ? value.toLowerCase() : "");

		/** 一行文件是否命中搜索词（文件名 / 描述 / 会话标题）。 */
		const fileMatches = (file, query, sessionTitle) => {
			if (query === "") return true;
			const needle = lower(query);

			return (
				lower(file.name).includes(needle) ||
				lower(file.description).includes(needle) ||
				lower(sessionTitle).includes(needle) ||
				lower(file.path).includes(needle)
			);
		};

		/**
		 * 按会话分组 + 搜索 + 类型筛选。
		 *
		 * 空组丢掉（不然列表里全是一堆空标题）；读不到事件的会话在**没有筛选**时
		 * 留一行错误说明——那不是"空"，是"读不到"，两者不该长得一样。
		 *
		 * @param {readonly any[]} sessions - 宿主 `/list` 给的 sessions。
		 * @param {{ query?: string, kind?: string }} options - 过滤条件。
		 * @returns {Array<{ sessionId: string, title: string, updatedAt?: string, error?: string, files: any[] }>}
		 */
		const filterGroups = (sessions, options) => {
			const query = typeof options?.query === "string" ? options.query.trim() : "";
			const kind = typeof options?.kind === "string" ? options.kind : "all";

			const groups = [];

			for (const session of Array.isArray(sessions) ? sessions : []) {
				if (session === null || typeof session !== "object") continue;

				const files = (Array.isArray(session.files) ? session.files : []).filter(
					(file) =>
						file !== null &&
						typeof file === "object" &&
						(kind === "all" || kindOf(file.ext) === kind) &&
						fileMatches(file, query, session.title),
				);

				if (files.length > 0) {
					groups.push({
						sessionId: session.sessionId,
						title: typeof session.title === "string" && session.title !== "" ? session.title : "",
						updatedAt: session.updatedAt,
						files,
					});

					continue;
				}

				const unfiltered = query === "" && kind === "all";

				if (unfiltered && typeof session.error === "string" && session.error !== "") {
					groups.push({
						sessionId: session.sessionId,
						title: typeof session.title === "string" && session.title !== "" ? session.title : "",
						updatedAt: session.updatedAt,
						error: session.error,
						files: [],
					});
				}
			}

			return groups;
		};

		/** 命中的文件总数（不含错误行）。 */
		const countFiles = (groups) =>
			(Array.isArray(groups) ? groups : []).reduce(
				(total, group) => total + (Array.isArray(group.files) ? group.files.length : 0),
				0,
			);

		/**
		 * 「宿主原生打开」的地址：文件条目里的 `url` 再补 action。
		 *
		 * `url` 已经是 `api/present.open?sessionId&seq&index`（文档相对，和
		 * presentedFileUrl() 一致），所以这里只追加 `&action=reveal`；`open` 是宿主
		 * 那边的默认值，不重复传。
		 */
		const presentUrl = (file, action) => {
			const base = typeof file?.url === "string" ? file.url : "";

			if (base === "") return "";

			return action === "reveal" ? `${base}&action=reveal` : base;
		};

		/** 默认位置（右下角，和 CSS 的 right/bottom 对齐）。 */
		const defaultPos = () => {
			const width = typeof window !== "undefined" && Number.isFinite(window.innerWidth) ? window.innerWidth : 1440;
			const height = typeof window !== "undefined" && Number.isFinite(window.innerHeight) ? window.innerHeight : 900;
			const panelWidth = Math.min(PANEL_WIDTH, Math.max(280, width - EDGE * 2));
			const panelHeight = Math.round(height * PANEL_HEIGHT_RATIO);

			return {
				x: Math.max(EDGE, width - panelWidth - EDGE),
				y: Math.max(EDGE, height - panelHeight - EDGE - 50),
			};
		};

		/**
		 * 把面板左上角夹进视口（留一点边，别让表头拖出屏幕抓不回来）。
		 *
		 * @param {{ x: number, y: number } | null} pos - 期望位置。
		 * @param {{ width: number, height: number }} viewport - 视口尺寸。
		 * @returns {{ x: number, y: number }} 夹好的位置。
		 */
		const clampPos = (pos, viewport) => {
			const width = Number.isFinite(viewport?.width) && viewport.width > 0 ? viewport.width : 1440;
			const height = Number.isFinite(viewport?.height) && viewport.height > 0 ? viewport.height : 900;
			const maxX = Math.max(EDGE, width - 120);
			const maxY = Math.max(EDGE, height - 44);
			const x = Number.isFinite(pos?.x) ? pos.x : EDGE;
			const y = Number.isFinite(pos?.y) ? pos.y : EDGE;

			return {
				x: Math.min(Math.max(Math.round(x), 0), maxX),
				y: Math.min(Math.max(Math.round(y), 0), maxY),
			};
		};

		/** 列表里的时间：`MM-DD HH:mm`（时间戳不像时间就给空串）。 */
		const timeLabel = (time) => {
			if (typeof time !== "number" || !Number.isFinite(time) || time <= 0) return "";

			try {
				const date = new Date(time);
				const pad = (value) => String(value).padStart(2, "0");

				return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
			} catch {
				return "";
			}
		};

		/** 打开失败的原因，翻成一句人话（不把 HTTP 状态码直接甩给用户）。 */
		const reasonOf = (failure) => {
			if (failure === undefined || failure === null) return "未知原因";
			if (failure.status === 0) return "宿主没有响应";

			switch (failure.status) {
				case 400:
					return "坐标不对（这条记录可能已经过期）";
				case 401:
				case 403:
					return "没有权限（页面登录态可能过期了，刷新一下）";
				case 404:
					return "宿主那边找不到这个文件";
				case 409:
					return "这个宿主没有桌面，不能交给系统应用打开";
				case 501:
					return "这个宿主没有原生打开能力";
				default:
					return `宿主返回 ${String(failure.status)}`;
			}
		};
		//#endregion

		//#region 跨会话 / 跨刷新记住开合与位置
		const readStorage = (key) => {
			try {
				return typeof window !== "undefined" && window.localStorage ? window.localStorage.getItem(key) : null;
			} catch {
				return null;
			}
		};

		const writeStorage = (key, value) => {
			try {
				if (typeof window !== "undefined" && window.localStorage) window.localStorage.setItem(key, value);
			} catch {
				// 隐私模式：退化成「只在本次页面有效」
			}
		};

		const loadPanelState = () => {
			const state = { open: false, pos: null, query: "", kind: "all" };

			if (readStorage(OPEN_KEY) === "1") state.open = true;

			const raw = readStorage(POS_KEY);

			if (raw !== null) {
				try {
					const parsed = JSON.parse(raw);

					if (parsed !== null && typeof parsed === "object" && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
						state.pos = { x: parsed.x, y: parsed.y };
					}
				} catch {
					state.pos = null;
				}
			}

			return state;
		};

		/**
		 * 面板状态挂在模块作用域：DSH 切会话会把组件卸载重挂（有时连插件模块一起
		 * 重来），只放组件 `useState` 里会「一换会话就收起」。开合和位置另外落
		 * localStorage，刷新也记得。
		 */
		const panelState = loadPanelState();
		let savedJson = "";

		const savePanelState = () => {
			const json = JSON.stringify({ open: panelState.open, pos: panelState.pos });

			if (json === savedJson) return;

			savedJson = json;

			// 回到「什么都没设过」的状态就别在 localStorage 里留垃圾
			if (panelState.open === false && panelState.pos === null) {
				try {
					if (typeof window !== "undefined" && window.localStorage) {
						window.localStorage.removeItem(OPEN_KEY);
						window.localStorage.removeItem(POS_KEY);
					}
				} catch {
					// 隐私模式：本来就没写进去
				}

				return;
			}

			writeStorage(OPEN_KEY, panelState.open ? "1" : "0");
			writeStorage(POS_KEY, JSON.stringify(panelState.pos));
		};
		//#endregion

		/** 面板本体。 */
		function DeliverablesIndex() {
			const [open, setOpen] = react.useState(() => panelState.open);
			const [pos, setPos] = react.useState(() => panelState.pos);
			const [query, setQuery] = react.useState(() => panelState.query);
			const [kind, setKind] = react.useState(() => panelState.kind);
			const [data, setData] = react.useState(null);
			const [loading, setLoading] = react.useState(false);
			const [error, setError] = react.useState("");
			const [note, setNote] = react.useState("");
			const [busy, setBusy] = react.useState("");
			// 点「刷新」自增：既触发重新取数，也让宿主那边 ?refresh=1 绕开缓存
			const [tick, setTick] = react.useState(0);
			const drag = react.useRef(null);

			// 每次渲染写回模块级：重挂（切会话）时从这里恢复
			panelState.open = open;
			panelState.pos = pos;
			panelState.query = query;
			panelState.kind = kind;
			savePanelState();

			// 打开时才取数；关着不占任何网络
			react.useEffect(() => {
				if (!open) return undefined;

				let cancelled = false;

				setLoading(true);

				const url = `${API}/list${tick > 0 ? "?refresh=1" : ""}`;

				fetch(url, { cache: "no-store" })
					.then((response) => (response && response.ok ? response.json() : null))
					.then((payload) => {
						if (cancelled) return;

						if (payload === null || payload.ok !== true) {
							setData(null);
							setError(
								payload !== null && typeof payload.message === "string"
									? payload.message
									: `文档索引服务返回了看不懂的东西（${API}/list）。`,
							);

							return;
						}

						setError("");
						setData(payload);
					})
					.catch(() => {
						if (cancelled) return;

						setData(null);
						setError(`连不上文档索引服务（${API}/list 没有响应）。确认 @zhuobichen/dsh-deliverables-index 插件开着，再点「重试」。`);
					})
					.then(() => {
						if (!cancelled) setLoading(false);
					});

				return () => {
					cancelled = true;
				};
			}, [open, tick]);

			const groups = react.useMemo(
				() => filterGroups(data === null ? [] : data.sessions, { query, kind }),
				[data, query, kind],
			);
			const total = data !== null && Number.isFinite(data.totalFiles) ? data.totalFiles : 0;
			const missing = data !== null && Number.isFinite(data.totalMissing) ? data.totalMissing : 0;
			const shown = countFiles(groups);

			/** 调宿主原生打开（POST 到 presentedFileUrl 那条路由）。 */
			const callNative = async (file, action) => {
				const url = presentUrl(file, action);

				if (url === "") return { ok: false, status: 0 };

				try {
					const response = await fetch(url, { method: "POST", cache: "no-store" });

					if (response && response.ok) return { ok: true };

					return { ok: false, status: response && Number.isFinite(response.status) ? response.status : 0 };
				} catch {
					return { ok: false, status: 0 };
				}
			};

			/** 浏览器兜底：`api/file?path=…` 新标签直读。返回是否真的打开了。 */
			const openInBrowser = (file) => {
				const url = typeof file?.fileUrl === "string" ? file.fileUrl : "";

				if (url === "") return false;
				if (typeof window === "undefined" || typeof window.open !== "function") return false;

				const handle = window.open(url, "_blank");

				if (handle === null || handle === undefined) return false;

				// 传 noopener 时 window.open 按规范返回 null，会误报「被拦截」；
				// 所以两参调用 + 手动断开 opener。
				try {
					handle.opener = null;
				} catch {
					// 跨域句柄改不了：不影响已经打开这件事
				}

				return true;
			};

			const onOpen = async (file) => {
				// exists 是宿主真实探测过的，false 就是不在——不点，不猜
				if (file === null || file === undefined || file.exists === false) return;
				if (busy !== "") return;

				setBusy(file.url ?? file.path ?? "");

				const native = await callNative(file, "open");

				if (native.ok) {
					setNote(`已用系统默认应用打开：${file.name}`);
					setBusy("");

					return;
				}

				const fallback = openInBrowser(file);

				setNote(
					fallback
						? `宿主没能原生打开（${reasonOf(native)}），已在浏览器新标签打开：${file.name}`
						: `打开失败：${reasonOf(native)}`,
				);
				setBusy("");
			};

			const onReveal = async (file) => {
				if (file === null || file === undefined || file.exists === false) return;

				const native = await callNative(file, "reveal");

				setNote(native.ok ? `已在文件管理器里定位：${file.name}` : `不能在文件夹里显示（${reasonOf(native)}）`);
			};

			/**
			 * 拖拽：按住表头跟指针走（表头上的按钮自己 stopPropagation 除外）。
			 * 位置只在松手时落 localStorage（拖动期间不写盘）。
			 */
			const startDrag = (event) => {
				if (event === null || event === undefined) return;
				if (event.button !== undefined && event.button !== 0) return;
				if (typeof event.preventDefault === "function") event.preventDefault();
				if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;

				const origin = pos === null ? defaultPos() : pos;
				const startX = Number.isFinite(event.clientX) ? event.clientX : 0;
				const startY = Number.isFinite(event.clientY) ? event.clientY : 0;

				drag.current = { origin, startX, startY };

				const move = (next) => {
					if (drag.current === null) return;

					const dx = (Number.isFinite(next?.clientX) ? next.clientX : startX) - startX;
					const dy = (Number.isFinite(next?.clientY) ? next.clientY : startY) - startY;

					setPos(
						clampPos(
							{ x: origin.x + dx, y: origin.y + dy },
							{
								width: typeof window.innerWidth === "number" ? window.innerWidth : 1440,
								height: typeof window.innerHeight === "number" ? window.innerHeight : 900,
							},
						),
					);
				};

				const up = () => {
					drag.current = null;

					if (typeof window.removeEventListener === "function") {
						window.removeEventListener("pointermove", move);
						window.removeEventListener("pointerup", up);
					}
				};

				window.addEventListener("pointermove", move);
				window.addEventListener("pointerup", up);
			};

			/** 表头按钮：别把点击变成一次拖拽。 */
			const stopDrag = (event) => {
				if (event !== null && event !== undefined && typeof event.stopPropagation === "function") event.stopPropagation();
			};

			const fab = jsx("button", {
				type: "button",
				className: "dshdi_fab",
				title: open ? "收起文档总览" : "文档总览:每个会话产出了哪些文档",
				"aria-label": "文档总览",
				"aria-pressed": open,
				"data-plugin": PLUGIN_ID,
				onClick: () => setOpen(!open),
				children: icon(ICON.files),
			});

			if (!open) {
				return jsx("div", { className: "dshdi_root", "data-plugin": PLUGIN_ID, children: fab });
			}

			const panelStyle =
				pos === null
					? {}
					: { left: `${pos.x}px`, top: `${pos.y}px`, right: "auto", bottom: "auto" };

			const head = jsxs("div", {
				className: "dshdi_head",
				onPointerDown: startDrag,
				children: [
					jsx("div", { className: "dshdi_title", children: "文档总览" }),
					jsx("div", { className: "dshdi_meta", children: `${String(total)} 个文件` }),
					jsx("div", { className: "dshdi_grow" }),
					jsx("button", {
						type: "button",
						className: "dshdi_ib dshdi_refresh",
						title: "重新读一遍会话日志",
						"aria-label": "刷新",
						onPointerDown: stopDrag,
						onClick: () => setTick(tick + 1),
						children: icon(ICON.refresh, 14),
					}),
					jsx("button", {
						type: "button",
						className: "dshdi_ib dshdi_close",
						title: "收起",
						"aria-label": "收起",
						onPointerDown: stopDrag,
						onClick: () => setOpen(false),
						children: icon(ICON.x, 14),
					}),
				],
			});

			const tools = jsxs("div", {
				className: "dshdi_tools",
				children: [
					jsx("input", {
						className: "dshdi_search",
						type: "search",
						placeholder: "搜索文件名 / 描述 / 会话标题",
						value: query,
						onChange: (event) => setQuery(event === undefined || event === null || event.target === undefined ? "" : String(event.target.value ?? "")),
						onInput: (event) => setQuery(event === undefined || event === null || event.target === undefined ? "" : String(event.target.value ?? "")),
					}),
					jsxs("div", {
						className: "dshdi_tabs",
						children: KINDS.map((item) =>
							jsx(
								"button",
								{
									key: item.id,
									type: "button",
									className: "dshdi_tab",
									"aria-pressed": kind === item.id,
									"data-kind": item.id,
									onClick: () => setKind(item.id),
									children: item.label,
								},
								item.id,
							),
						),
					}),
				],
			});

			const rowOf = (file) => {
				const isMissing = file.exists === false;
				const time = timeLabel(file.time);

				const row = jsxs("div", {
					className: isMissing ? "dshdi_row dshdi_row--missing" : "dshdi_row",
					role: "button",
					tabIndex: isMissing ? -1 : 0,
					"aria-disabled": isMissing,
					title: file.path,
					onClick: isMissing ? undefined : () => onOpen(file),
					onContextMenu: (event) => {
						if (event !== null && event !== undefined && typeof event.preventDefault === "function") event.preventDefault();

						if (!isMissing) onReveal(file);
					},
					children: [
						jsx("span", { className: "dshdi_ext", children: typeof file.ext === "string" ? file.ext : "" }),
						jsxs("div", {
							className: "dshdi_main",
							children: [
								jsx("div", { className: "dshdi_name", children: String(file.name ?? "") }),
								typeof file.description === "string" && file.description !== ""
									? jsx("div", { className: "dshdi_desc", children: file.description })
									: null,
							],
						}),
						isMissing
							? jsx("span", { className: "dshdi_state", children: "文件不在了" })
							: jsx("span", { className: "dshdi_time", children: time }),
					],
				});

				return jsxs(
					"div",
					{
						className: "dshdi_item",
						children: [
							row,
							isMissing
								? null
								: jsx("button", {
										type: "button",
										className: "dshdi_ib dshdi_reveal",
										title: "在文件夹里显示",
										"aria-label": "在文件夹里显示",
										onClick: (event) => {
											if (event !== null && event !== undefined && typeof event.stopPropagation === "function") event.stopPropagation();

											onReveal(file);
										},
										children: icon(ICON.folder, 13),
									}),
						],
					},
					file.url ?? file.path,
				);
			};

			const groupNodes = groups.map((group) =>
				jsxs(
					"div",
					{
						className: "dshdi_group",
						children: [
							jsxs("div", {
								className: "dshdi_grouphead",
								children: [
									jsx("span", { className: "dshdi_gtitle", children: group.title === "" ? "(未命名会话)" : group.title }),
									jsx("span", { className: "dshdi_gcount", children: String(group.files.length) }),
								],
							}),
							typeof group.error === "string" && group.error !== ""
								? jsx("div", { className: "dshdi_gerr", children: `这个会话读不到：${group.error}` })
								: null,
							...group.files.map((file) => rowOf(file)),
						],
					},
					group.sessionId,
				),
			);

			const emptyState =
				data !== null && total === 0
					? jsx("div", {
							className: "dshdi_empty",
							children: "还没有任何会话产出过文档。需要有会话调用过 present 工具，它呈现的文件才会出现在这里。",
						})
					: jsx("div", { className: "dshdi_empty", children: "没有匹配的文档：清掉搜索词或换一个类型。" });

			const body =
				error !== "" && data === null
					? jsxs("div", {
							children: [
								jsx("div", { className: "dshdi_err", children: error }),
								jsx("button", {
									type: "button",
									className: "dshdi_retry",
									onClick: () => setTick(tick + 1),
									children: "重试",
								}),
							],
						})
					: loading && data === null
						? jsx("div", { className: "dshdi_empty", children: "正在读会话日志…" })
						: groups.length === 0
							? emptyState
							: jsx("div", { className: "dshdi_groups", children: groupNodes });

			const footLeft =
				data === null
					? ""
					: shown === total
						? `${String(total)} 个文件`
						: `${String(shown)} / ${String(total)} 个文件`;

			const foot = jsxs("div", {
				className: "dshdi_foot",
				children: [
					jsx("span", { children: footLeft }),
					missing > 0 ? jsx("span", { children: `· ${String(missing)} 个不在了` }) : null,
					note === ""
						? null
						: jsx("span", { className: "dshdi_notice", title: note, children: note }),
				],
			});

			const panel = jsxs("div", {
				className: "dshdi_panel",
				"data-plugin": PLUGIN_ID,
				style: panelStyle,
				children: [head, tools, body, foot],
			});

			return jsxs("div", {
				className: "dshdi_root",
				"data-plugin": PLUGIN_ID,
				children: [fab, panel],
			});
		}

		/** 只需要槽位服务。 */
		const inject = ["slots"];

		function apply(ctx) {
			// shell.overlay 是「整帧覆盖层」的列表槽：加成式，不抢别人的位置。
			ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register(
					{
						name: "shell.overlay",
						id: "deliverables-index",
						order: 120,
					},
					DeliverablesIndex,
				),
			);
		}

		exports.DeliverablesIndex = DeliverablesIndex;
		exports.apply = apply;
		exports.inject = inject;
		// 给测试用：开合/位置/筛选是模块级状态，用例之间必须能复位
		exports.panelState = panelState;
		// 给测试用：过滤与 URL 规则是纯函数，单独钉住
		exports.filterGroups = filterGroups;
		exports.countFiles = countFiles;
		exports.kindOf = kindOf;
		exports.presentUrl = presentUrl;
		exports.clampPos = clampPos;
		exports.defaultPos = defaultPos;
		exports.timeLabel = timeLabel;
		exports.KINDS = KINDS;

		return module.exports;
	},
});
