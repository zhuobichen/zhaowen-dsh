window.__ModuleLoader__.load({
	id: '@zhuobichen/dsh-client-ui-balance',
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
		const TAG_ID = "@zhuobichen/dsh-client-ui-balance/balance.css";

		if (
			typeof document !== "undefined" &&
			document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]") === null
		) {
			const tag = document.createElement("style");

			tag.dataset.plugin = "@zhuobichen/dsh-client-ui-balance";
			tag.dataset.pluginCss = TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region 措辞：和宿主侧 src/balance.ts 的 hourlyTextOf/ageOf/lineOf 逐字一致
		//
		// 为什么这里另写一份而不是共享：客户端信封只能 require 静态表里的包，拿不到
		// 宿主源码。所以两边各一份，靠 test/parity.test.ts **同时加载宿主与这个真实
		// 产物**来钉住一致性——漂移会当场变红。
		const hourlyTextOf = (hours) => {
			if (!Array.isArray(hours) || hours.length === 0) return "";

			const cells = hours.map((one) => {
				if (one === null) return "?";
				if (one < 0) return `+${Math.abs(one).toFixed(2)}`;

				return one.toFixed(2);
			});

			return `· ${hours.length}h ${cells.join(" ")}`;
		};

		const ageOf = (atMs, nowMs) => {
			const minutes = Math.round((nowMs - atMs) / 60000);

			if (minutes < 1) return "just now";
			if (minutes < 60) return `${minutes}m ago`;

			const hours = Math.round(minutes / 60);

			return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
		};

		/** 和宿主 lineOf 同一个分支表；`reading.hours` 由宿主算好带过来。 */
		const lineOf = (reading, nowMs) => {
			if (reading === null || reading === undefined) return "";

			const strip = hourlyTextOf(reading.hours);
			const tail = strip === "" ? "" : ` ${strip}`;

			switch (reading.kind) {
				case "pending":
					return "DeepSeek balance: reading…";
				case "no-key":
				case "refused":
					return `DeepSeek balance: ${reading.note ?? "not available"}`;
				case "failed":
					return reading.amount === null
						? `DeepSeek balance: ${reading.note ?? "the request failed"}`
						: `DeepSeek ${reading.amount} · ${ageOf(reading.atMs, nowMs)} · refresh failed: ${reading.note ?? "unknown"}${tail}`;
				case "ok":
					return `DeepSeek ${reading.amount} · ${ageOf(reading.atMs, nowMs)}${tail}`;
				default:
					return "";
			}
		};
		//#endregion

		/**
		 * 输入框上方那一行。
		 *
		 * `useProjection` 是槽位框架给的钩子，读宿主算好的 `balance` 投影
		 * （还没读过时是 null，就不画）。
		 *
		 * 每 30 秒自己重画一次：投影只在**读数变化**时才更新（省日志），而
		 * 「3m ago」这种字得自己走，不然会一直停在「just now」。
		 */
		function BalanceLine({ useProjection }) {
			const projection = useProjection("balance");
			const [, bump] = react.useState(0);

			react.useEffect(() => {
				const ticker = setInterval(() => bump((n) => n + 1), 30000);

				return () => clearInterval(ticker);
			}, []);

			if (projection === undefined || projection === null) return null;

			const text = lineOf(projection, Date.now());

			if (text === "") return null;

			return jsx("div", {
				className: "dshbl_dock",
				children: jsx("div", { className: "dshbl_line", role: "status", children: text }),
			});
		}

		/** 只需要槽位服务；投影由 `useProjection` 给，不用自己订阅。 */
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
		// 给 test/parity.test.ts 用：拿真实产物和宿主对表。
		exports.lineOf = lineOf;
		exports.ageOf = ageOf;
		exports.hourlyTextOf = hourlyTextOf;

		return module.exports;
	},
});
