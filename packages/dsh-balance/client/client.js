window.__ModuleLoader__.load({
	id: '@zhuobichen/dsh-balance',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const jsx = require("react/jsx-runtime").jsx;

		// 这个文件是**手写的**，不是打包产物：DSH 的客户端模块 ABI 就是这层
		// `window.__ModuleLoader__.load({id, factory})` 信封 + 一个 `require` 垫片，
		// 所以直接照着写就不用引入 tsdown/React 构建链，改一行立刻生效。
		// 信封里的 `require` 只认静态表里的模块（react / react/jsx-runtime 等）。

		// 余额是**账户级**的（一个账号一个数），所以宿主只持有一份状态，这里每 15
		// 秒拉一次 `/dsh-balance/current`。**不要**再读会话投影：投影是会话级的，
		// 每个对话各存一份「最后一次采样时的快照」，结果不同对话显示的金额不一样
		// （本质是读数时间不同）——那正是这个插件修掉的 bug。
		//
		// 一行字（含 age 和时长条）全部由宿主算好放在 `line` 里。客户端不再抄一份
		// 措辞：抄的东西会漂移，而这里没有第二个说法。

		const REFRESH_MS = 15_000;
		const ENDPOINT = "/dsh-balance/current";

		//#region 样式：一行小字，贴着输入框上沿
		//
		// 照 DSH 自己的 StatsLine（会话底部那行 12px 灰字）的写法：12px +
		// --dsw-alias-label-tertiary + line-height 20px，宽度跟聊天栏对齐，
		// 左右留出 composer 的安全边距。**不要**自带 margin——父级
		// composerStack 已经用 --dsh-composer-stack-gap（6px）给我们排好了。
		const CSS =
			".dshbl_dock{box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width,748px);" +
			"margin:0 auto;padding:2px calc(var(--dsh-composer-side-clearance,16px) + 16px) 0}" +
			".dshbl_line{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary,#8a8a8a);" +
			"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}";
		const TAG_ID = "@zhuobichen/dsh-balance/balance.css";

		if (
			typeof document !== "undefined" &&
			document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]") === null
		) {
			const tag = document.createElement("style");

			tag.dataset.plugin = "@zhuobichen/dsh-balance";
			tag.dataset.pluginCss = TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		/**
		 * 输入框上方那一行。
		 *
		 * 数据只有一条路：`GET /dsh-balance/current` → `line`。非 200、网络错、
		 * 或者宿主还没给出可用的一行——这些情况都只是「不画」，不占布局、不往
		 * 页面上写错误，下一轮再问。已经拿到过的那一行在宿主短暂抽风时保持不动，
		 * 免得一行字一闪一闪的；宿主恢复后自然就更新了。
		 */
		function BalanceLine() {
			const [snapshot, setSnapshot] = react.useState(null);

			react.useEffect(() => {
				let alive = true;

				const load = () => {
					fetch(ENDPOINT, { cache: "no-store" })
						.then((response) => (response.ok ? response.json() : null))
						.then((body) => {
							if (!alive || body === null || typeof body.line !== "string") return;

							setSnapshot(body);
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

			if (!snapshot || typeof snapshot.line !== "string" || snapshot.line === "") return null;

			return jsx("div", {
				className: "dshbl_dock",
				children: jsx("div", { className: "dshbl_line", role: "status", children: snapshot.line }),
			});
		}

		/** 只需要槽位服务；数据靠上面那个路由拉，不用自己订阅别的东西。 */
		const inject = ["slots"];

		/**
		 * @param ctx - 客户端根上下文。
		 */
		function apply(ctx) {
			// `conversation.input.dock` 就是「输入框上沿」这个槽位。已有的 order：
			// todo=0、goal=10、queue=20，所以这里取 15——夹在目标条和队列之间，
			// 既不会让 goal 掉到我们下面，也不跟 queue 撞号。
			ctx.slots.inject("conversation.input.dock", () =>
				ctx.slots.register(
					{
						name: "conversation.input.dock",
						id: "balance",
						order: 15,
					},
					BalanceLine,
				),
			);
		}

		exports.BalanceLine = BalanceLine;
		exports.apply = apply;
		exports.inject = inject;

		return module.exports;
	},
});
