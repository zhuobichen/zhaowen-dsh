window.__ModuleLoader__.load({
	id: '@zhuobichen/dsh-client-ui-moon-band',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const jsx = require("react/jsx-runtime").jsx;

		// moon-band 的浏览器半身：输入框上方一行压暗的月光。
		//
		// 月相、月龄和那句诗都由宿主算（语料 3.18 MB，不能下发到客户端），这里每
		// 20 秒问一次 `/dsh-moon-band/line`。20 秒对一分钟的换句格子是够的：最迟
		// 20 秒内就翻到新的一句，而不是最多晚一分钟。

		const REFRESH_MS = 20_000;
		const ENDPOINT = "/dsh-moon-band/line";

		//#region 样式：和余额行同一套尺寸，只是更暗一点
		const CSS =
			".dshmb_dock{box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width,748px);" +
			"margin:0 auto;padding:2px calc(var(--dsh-composer-side-clearance,16px) + 16px) 0}" +
			".dshmb_line{font-size:12px;line-height:20px;opacity:.78;" +
			"color:var(--dsw-alias-label-tertiary,#8a8a8a);" +
			"overflow:hidden;text-overflow:ellipsis;white-space:nowrap}";
		const TAG_ID = "@zhuobichen/dsh-client-ui-moon-band/moon.css";

		if (
			typeof document !== "undefined" &&
			document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]") === null
		) {
			const tag = document.createElement("style");

			tag.dataset.plugin = "@zhuobichen/dsh-client-ui-moon-band";
			tag.dataset.pluginCss = TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		/**
		 * 输入框上方那一行。
		 *
		 * 拿不到、被 `/moon` 收起、或者宿主那边语料没读到（`corpus:false` 时仍然
		 * 会回内置 8 句，所以照样画）——这些情况都只是「不画」，不往页面上写错误。
		 */
		function MoonLine() {
			const [state, setState] = react.useState(null);

			react.useEffect(() => {
				let alive = true;

				const load = () => {
					fetch(ENDPOINT, { cache: "no-store" })
						.then((r) => (r.ok ? r.json() : null))
						.then((j) => {
							if (alive && j && typeof j.text === "string") setState(j);
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

			return jsx("div", {
				className: "dshmb_dock",
				children: jsx("div", { className: "dshmb_line", role: "status", children: state.text }),
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
