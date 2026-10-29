window.__ModuleLoader__.load({
	id: '@zhuobichen/dsh-moon-band',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const jsx = require("react/jsx-runtime").jsx;

		// moon-band 的浏览器半身：输入框上方一行压暗的月光。
		//
		// 月相、月龄、那句诗、朝代都由宿主算（语料 3.18 MB，不能下发到客户端），
		// 这里每 20 秒问一次 `/dsh-moon-band/line`。20 秒对一分钟的换句格子是够的。
		//
		// 右边那个按钮点开会问 `/dsh-moon-band/about`：宿主命中缓存就直接回，
		// 没命中才问一次 AI 并落盘——所以同一句诗第二次点开是瞬间的。

		const REFRESH_MS = 20_000;
		const ENDPOINT = "/dsh-moon-band/line";
		const ABOUT_ENDPOINT = "/dsh-moon-band/about";

		//#region 样式：和余额行同一套尺寸，只是更暗一点
		const CSS =
			".dshmb_dock{box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width,748px);" +
			"margin:0 auto;padding:2px calc(var(--dsh-composer-side-clearance,16px) + 16px) 0}" +
			".dshmb_row{display:flex;align-items:baseline;gap:8px;min-width:0}" +
			".dshmb_line{font-size:12px;line-height:20px;opacity:.78;" +
			"color:var(--dsw-alias-label-tertiary,#8a8a8a);" +
			"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}" +
			".dshmb_dyn{flex:none;font-size:11px;line-height:20px;opacity:.72;" +
			"color:var(--dsw-alias-label-tertiary,#8a8a8a)}" +
			".dshmb_btn{flex:none;cursor:pointer;background:0 0;border-radius:999px;font-size:11px;line-height:16px;" +
			"height:18px;padding:0 8px;display:inline-flex;align-items:center;" +
			"border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35));" +
			"color:var(--dsw-alias-label-secondary,#9a9a9a)}" +
			".dshmb_btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));" +
			"color:var(--dsw-alias-label-primary,#ddd)}" +
			".dshmb_btn:disabled{opacity:.5;cursor:default}" +
			".dshmb_panel{margin:2px 0 6px;padding:6px 10px;font-size:12px;line-height:19px;white-space:pre-wrap;" +
			"color:var(--dsw-alias-label-secondary,#9a9a9a);" +
			"border-left:2px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4))}" +
			".dshmb_head{color:var(--dsw-alias-label-tertiary,#8a8a8a);margin-bottom:3px}" +
			".dshmb_err{color:var(--dsw-alias-state-error-primary,#d97070)}";
		const TAG_ID = "@zhuobichen/dsh-moon-band/moon.css";

		if (
			typeof document !== "undefined" &&
			document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]") === null
		) {
			const tag = document.createElement("style");

			tag.dataset.plugin = "@zhuobichen/dsh-moon-band";
			tag.dataset.pluginCss = TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		/**
		 * 输入框上方那一行。
		 *
		 * 拿不到、被 `/moon` 收起、或者宿主那边没数据——这些情况都只是「不画」，
		 * 不往页面上写错误。
		 */
		function MoonLine() {
			const [state, setState] = react.useState(null);
			const [about, setAbout] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(null);

			react.useEffect(() => {
				let alive = true;

				const load = () => {
					fetch(ENDPOINT, { cache: "no-store" })
						.then((r) => (r.ok ? r.json() : null))
						.then((j) => {
							if (!alive || !j || typeof j.text !== "string") return;

							// 换诗了就把上一条的详解收起来（免得文不对题）
							setState((prev) => {
								if (prev !== null && prev.line !== j.line) {
									setAbout(null);
									setError(null);
								}

								return j;
							});
						})
						.catch(() => {
							// 宿主还没起来／路由还没挂上：下一轮再问
						});
				};

				load();

				const ticker = setInterval(load, REFRESH_MS);

				return () => {
					alive = false;
					clearInterval(ticker);
				};
			}, []);

			if (state === null || state.hidden === true || state.text === "") return null;

			const toggleAbout = async () => {
				if (busy) return;

				if (about !== null) {
					setAbout(null);

					return;
				}

				setBusy(true);
				setError(null);

				try {
					const response = await fetch(ABOUT_ENDPOINT + "?line=" + encodeURIComponent(state.line), {
						cache: "no-store",
					});

					if (!response.ok) throw new Error(`HTTP ${response.status}`);

					setAbout(await response.json());
				} catch (failure) {
					setError(String((failure && failure.message) || failure));
				} finally {
					setBusy(false);
				}
			};

			const dynasty = state.dynasty || state.year || null;
			const label = busy ? "生成中…" : about !== null ? "收起" : state.aboutCached ? "直接看" : "详解";

			return jsx("div", {
				className: "dshmb_dock",
				children: [
					jsx("div", {
						key: "row",
						className: "dshmb_row",
						children: [
							jsx("div", {
								key: "t",
								className: "dshmb_line",
								role: "status",
								title: state.from,
								children: state.text,
							}),
							dynasty === null
								? null
								: jsx("span", { key: "d", className: "dshmb_dyn", children: dynasty }),
							jsx("button", {
								key: "b",
								type: "button",
								className: "dshmb_btn",
								onClick: toggleAbout,
								disabled: busy,
								title: state.aboutCached
									? "已缓存，点开即看"
									: "点开生成诗意与创作背景（会问一次 AI，之后缓存）",
								children: label,
							}),
						],
					}),
					error === null
						? null
						: jsx("div", { key: "e", className: "dshmb_panel dshmb_err", children: "详解失败：" + error }),
					about === null
						? null
						: jsx("div", {
								key: "p",
								className: "dshmb_panel",
								children: [
									jsx("div", {
										key: "h",
										className: "dshmb_head",
										children: [about.dynasty, about.year].filter(Boolean).join(" · ") || "出处补注",
									}),
									jsx("div", { key: "m", children: "诗意：" + about.meaning }),
									jsx("div", { key: "g", children: "背景：" + about.background }),
									about.cached === true
										? jsx("div", {
												key: "c",
												className: "dshmb_head",
												children: "（这次没问 AI，读的是缓存）",
											})
										: null,
								],
							}),
				].filter(Boolean),
			});
		}

		/** 只需要槽位服务。 */
		const inject = ["slots"];

		/**
		 * @param ctx - 客户端根上下文。
		 */
		function apply(ctx) {
			// order：todo=0、goal=10、queue=20，余额行取 15。这里取 14——
			// 月光压在余额上面一行，两行都贴着输入框上沿。
			ctx.slots.inject("conversation.input.dock", () =>
				ctx.slots.register(
					{
						name: "conversation.input.dock",
						id: "moon-band",
						order: 14,
					},
					MoonLine,
				),
			);
		}

		exports.MoonLine = MoonLine;
		exports.apply = apply;
		exports.inject = inject;

		return module.exports;
	},
});
