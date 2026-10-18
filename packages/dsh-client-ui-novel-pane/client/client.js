window.__ModuleLoader__.load({
	id: '@zhuobichen/dsh-client-ui-novel-pane',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const jsx = require("react/jsx-runtime").jsx;

		// novel-pane 的浏览器半身：输入框上方一间可以收起的读书窗格。
		//
		// 分页、折行、书单全在宿主，这里只做三件事：按行画一屏、把按钮和滚轮
		// 翻译成 `POST /dsh-novel-pane/move`、每 3 秒取一次状态（这样在提示框里
		// 敲 `/novel n` 时，窗格也会跟着翻）。

		const API = "/dsh-novel-pane";
		const ROWS = 18; // 窗格总行数：表头 1 行 + 正文 17 行
		const LINE = 20; // 和 CSS 的 line-height 一致
		const POLL_MS = 3000;

		//#region 样式
		const CSS =
			".dshnp_dock{box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width,748px);" +
			"margin:0 auto;padding:4px calc(var(--dsh-composer-side-clearance,16px) + 16px) 0}" +
			".dshnp_pane{border:1px solid var(--dsw-alias-border-tertiary,#dcdcdc);border-radius:10px;" +
			"background:var(--dsw-alias-bg-secondary,rgba(255,255,255,.55));overflow:hidden}" +
			".dshnp_head{display:flex;align-items:center;gap:6px;padding:4px 8px;" +
			"border-bottom:1px solid var(--dsw-alias-border-tertiary,#e6e6e6);font-size:12px}" +
			".dshnp_btn{appearance:none;border:1px solid transparent;background:transparent;cursor:pointer;" +
			"font:inherit;color:var(--dsw-alias-label-secondary,#555);padding:1px 6px;border-radius:6px;line-height:18px}" +
			".dshnp_btn:hover{background:var(--dsw-alias-bg-hover,rgba(0,0,0,.06))}" +
			".dshnp_title{font-weight:600;color:var(--dsw-alias-label-primary,#222);" +
			"max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
			".dshnp_grow{flex:1}" +
			".dshnp_prog{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-variant-numeric:tabular-nums}" +
			".dshnp_body{margin:0;padding:6px 10px;font:12px/20px var(--dsw-font-mono,ui-monospace,monospace);" +
			"white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#222);overflow:hidden}" +
			".dshnp_empty{color:var(--dsw-alias-label-tertiary,#8a8a8a)}" +
			".dshnp_book{display:block;width:100%;text-align:left;appearance:none;border:0;background:transparent;" +
			"cursor:pointer;font:12px/20px var(--dsw-font-mono,ui-monospace,monospace);color:var(--dsw-alias-label-primary,#222);" +
			"padding:0 4px;border-radius:4px}" +
			".dshnp_book:hover{background:var(--dsw-alias-bg-hover,rgba(0,0,0,.06))}";
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

		const fetchState = (shelf) =>
			fetch(API + "/state?rows=" + ROWS + (shelf ? "&shelf=1" : ""), { cache: "no-store" })
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null);

		const move = (body) =>
			fetch(API + "/move", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ rows: ROWS, ...body }),
			})
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null);

		/**
		 * 窗格本体。
		 *
		 * `shelf` 为真时正文区画书单（宿主给的 `shelf` 数组），否则画 `text`。
		 */
		function NovelPane() {
			const [state, setState] = react.useState(null);
			const [shelf, setShelf] = react.useState(false);
			// 滚轮累积：一格一格地调接口太密，攒够一行再发
			const wheel = react.useRef(0);

			react.useEffect(() => {
				let alive = true;

				const load = () => {
					fetchState(shelf).then((j) => {
						if (alive && j) setState(j);
					});
				};

				load();

				const ticker = setInterval(load, POLL_MS);

				return () => {
					alive = false;
					clearInterval(ticker);
				};
			}, [shelf]);

			if (state === null || state.open !== true) return null;

			const apply = (j) => {
				if (j) setState(j);
			};

			const click = (body) => {
				move(body).then(apply);
			};

			const onWheel = (event) => {
				event.preventDefault();

				wheel.current += event.deltaY;

				if (Math.abs(wheel.current) < LINE) return;

				const direction = wheel.current > 0 ? 1 : -1;

				wheel.current = 0;
				click({ op: "wheel", delta: direction });
			};

			const head = jsx("div", {
				className: "dshnp_head",
				children: [
					jsx("span", { className: "dshnp_title", title: state.file || "", children: state.title || "未打开" }),
					jsx("button", {
						className: "dshnp_btn",
						onClick: () => click({ op: "mode" }),
						children: state.mode === "scroll" ? "⇄ 卷轴" : "⇄ 整屏",
					}),
					jsx("button", { className: "dshnp_btn", onClick: () => click({ op: "up" }), children: "↑" }),
					jsx("button", { className: "dshnp_btn", onClick: () => click({ op: "down" }), children: "↓" }),
					jsx("button", { className: "dshnp_btn", onClick: () => click({ op: "top" }), children: "⌂" }),
					jsx("button", {
						className: "dshnp_btn",
						title: "书单",
						onClick: () => setShelf((on) => !on),
						children: "☰",
					}),
					jsx("span", { className: "dshnp_grow" }),
					jsx("span", { className: "dshnp_prog", children: state.progress || "" }),
					jsx("button", {
						className: "dshnp_btn",
						title: "收起",
						onClick: () => click({ op: "close" }),
						children: "✕",
					}),
				],
			});

			const body =
				shelf && Array.isArray(state.shelf)
					? jsx("div", {
							className: "dshnp_body",
							style: { height: (ROWS - 1) * LINE + "px", overflowY: "auto" },
							children:
								state.shelf.length === 0
									? jsx("div", { className: "dshnp_empty", children: "这个目录里没有能读的文件" })
									: state.shelf.map((name) =>
											jsx("button", {
												key: name,
												className: "dshnp_book",
												onClick: () => {
													setShelf(false);
													click({ op: "open-book", name });
												},
												children: name,
											}),
										),
						})
					: jsx("pre", {
							className: "dshnp_body",
							style: { height: (ROWS - 1) * LINE + "px" },
							onWheel,
							children: (state.text || []).join("\n"),
						});

			return jsx("div", {
				className: "dshnp_dock",
				children: jsx("div", { className: "dshnp_pane", children: [head, body] }),
			});
		}

		/** 只需要槽位服务。 */
		const inject = ["slots"];

		function apply(ctx) {
			// 压在余额（15）下面、队列（20）上面：两行小字在上面，窗格贴着输入框
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

		return module.exports;
	},
});
