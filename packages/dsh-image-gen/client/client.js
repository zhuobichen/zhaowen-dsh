window.__ModuleLoader__.load({
	id: '@zhuobichen/dsh-image-gen',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const runtime = require("react/jsx-runtime");
		const jsx = runtime.jsx;
		const jsxs = runtime.jsxs;

		// dsh-image-gen 的浏览器半身：把 generate_image / edit_image 的调用卡片
		// 画成「生图中 → 图片 + 路径 → 错误」。
		//
		// 图片不走 tool.call.images 子槽位（内置 read_image 已经占用了，重复声明
		// 会在加载时抛错），而是直接用 toolview 拿到的 loadImage(attachment)。

		//#region 样式
		const CSS = `
.dshig_card{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:10px;
  border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px;
  background:var(--dsw-alias-bg-layer-1,#fff);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif)}
.dshig_figure{margin:0}
.dshig_pending{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.dshig_spin{flex:none;width:13px;height:13px;border:2px solid var(--dsw-alias-border-l2,rgba(0,0,0,.15));
  border-top-color:var(--dsw-alias-brand-primary,#4d6bfe);border-radius:50%;animation:dshig_spin .9s linear infinite}
@keyframes dshig_spin{to{transform:rotate(360deg)}}
.dshig_prompt{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a8a8a);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshig_img{display:block;max-width:100%;max-height:480px;object-fit:contain;border-radius:10px;
  background:var(--dsw-alias-bg-base,#f7f7f8);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));cursor:zoom-in}
.dshig_caption{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;font-size:12px;
  color:var(--dsw-alias-label-tertiary,#8a8a8a);min-width:0}
.dshig_link{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  appearance:none;border:0;background:none;padding:0;font:inherit;color:inherit;
  text-decoration:underline;text-underline-offset:2px;cursor:pointer;text-align:left}
.dshig_link:hover{color:var(--dsw-alias-label-primary,#222)}
.dshig_meta{font-variant-numeric:tabular-nums;white-space:nowrap}
.dshig_note{font-size:11px;color:var(--dsw-alias-label-tertiary,#999)}
.dshig_error{font-size:12px;line-height:18px;color:var(--dsw-alias-label-error,#c0392b);white-space:pre-wrap}
`;
		const TAG_ID = "@zhuobichen/dsh-image-gen/card.css";

		if (
			typeof document !== "undefined" &&
			document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]") === null
		) {
			const tag = document.createElement("style");

			tag.dataset.plugin = "@zhuobichen/dsh-image-gen";
			tag.dataset.pluginCss = TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		const truncate = (value, max) => {
			const text = String(value || "").replace(/\s+/g, " ").trim();

			return text.length > max ? text.slice(0, max) + "…" : text;
		};

		const firstText = (content) => {
			for (const part of content || []) {
				if (part && part.type === "text" && typeof part.text === "string") return part.text;
			}

			return "";
		};

		const findImage = (content) => {
			for (const part of content || []) {
				if (part && part.type === "image" && part.attachment) return part.attachment;
			}

			return null;
		};

		const metaOf = (block) => {
			const meta = block && block.meta;

			return meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
		};

		/** 从 args（result 阶段）或 argsRaw（start 阶段）里取 prompt。 */
		const promptOf = (block) => {
			try {
				if (block && block.args && typeof block.args.text === "function") {
					const value = block.args.text("prompt");

					if (typeof value === "string") return value;
				}
				if (block && typeof block.argsRaw === "string") {
					const match = /"prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(block.argsRaw);

					if (match) return JSON.parse('"' + match[1] + '"');
				}
			} catch {
				// 流式参数不完整时解析失败是正常的
			}

			return "";
		};

		const pathOf = (block) => {
			const meta = metaOf(block);

			if (typeof meta.path === "string") return meta.path;

			const match = /(?:已生成图片|已编辑并保存):\s*(.+)/.exec(firstText(block && block.content));

			return match ? match[1].trim() : "";
		};

		/** 加载附件图片；peek 命中时同步出图，避免闪烁。 */
		const useImageUrl = (loadImage, attachment) => {
			const [src, setSrc] = react.useState(null);
			const [error, setError] = react.useState(null);

			react.useEffect(() => {
				let alive = true;

				setSrc(null);
				setError(null);

				if (!attachment || !loadImage) return undefined;

				try {
					const peeked = typeof loadImage.peek === "function" ? loadImage.peek(attachment) : undefined;

					if (peeked) {
						setSrc(peeked);

						return undefined;
					}
				} catch {
					// peek 只是优化，失败就走完整加载
				}

				Promise.resolve(loadImage(attachment)).then(
					(url) => {
						if (alive) setSrc(url);
					},
					(reason) => {
						if (alive) setError(String((reason && reason.message) || reason));
					},
				);

				return () => {
					alive = false;
				};
			}, [loadImage, attachment && attachment.attachmentId]);

			return { src, error };
		};

		function ImageGenRow(props) {
			const { phase, block, loadImage, openFile } = props || {};
			const isResult = phase === "result";
			const failed = isResult && block && block.isError === true;
			const attachment = isResult && !failed ? findImage(block && block.content) : null;
			// hooks 必须无条件调用
			const loaded = useImageUrl(loadImage, attachment);

			if (phase === "preparing" || phase === "start") {
				const prompt = promptOf(block);

				return jsxs("div", {
					className: "dshig_card",
					children: [
						jsxs("div", {
							className: "dshig_pending",
							children: [
								jsx("span", { className: "dshig_spin" }),
								jsx("span", { children: "豆包正在画图…（通常 15–35 秒，最长约 4 分钟）" }),
							],
						}),
						prompt ? jsx("div", { className: "dshig_prompt", title: prompt, children: truncate(prompt, 120) }) : null,
					].filter((node) => node !== null),
				});
			}

			if (failed) {
				const reason = (block && block.error && block.error.reason) || firstText(block && block.content) || "未知错误";

				return jsx("div", {
					className: "dshig_card",
					children: jsx("div", { className: "dshig_error", children: "生成失败：" + reason }),
				});
			}

			const path = pathOf(block);
			const meta = metaOf(block);
			const dims = meta.width && meta.height ? meta.width + "×" + meta.height : "";
			const prompt = typeof meta.prompt === "string" ? meta.prompt : promptOf(block);

			const caption = jsxs("div", {
				className: "dshig_caption",
				children: [
					path
						? jsx("button", {
								className: "dshig_link",
								title: path,
								onClick: () => openFile && openFile(path),
								children: path,
							})
						: jsx("span", { children: "（路径未知）" }),
					dims ? jsx("span", { className: "dshig_meta", children: dims }) : null,
					jsx("span", { className: "dshig_note", children: "豆包 AI 生成 · 未裁剪" }),
				].filter((node) => node !== null),
			});

			if (!attachment) {
				return jsxs("div", {
					className: "dshig_card",
					children: [
						caption,
						jsx("div", { className: "dshig_note", children: "内联预览不可用（附件未挂载或图片过大）" }),
					],
				});
			}

			if (loaded.error) {
				return jsxs("div", {
					className: "dshig_card",
					children: [
						caption,
						jsx("div", { className: "dshig_error", children: "图片加载失败：" + loaded.error }),
					],
				});
			}

			return jsxs("figure", {
				className: "dshig_card dshig_figure",
				children: [
					loaded.src
						? jsx("img", {
								className: "dshig_img",
								src: loaded.src,
								alt: prompt || "生成图片",
								onClick: () => path && openFile && openFile(path),
							})
						: jsxs("div", {
								className: "dshig_pending",
								children: [
									jsx("span", { className: "dshig_spin" }),
									jsx("span", { children: "图片加载中…" }),
								],
							}),
					caption,
				],
			});
		}

		/** 只需要槽位服务。 */
		const inject = ["slots"];

		function apply(ctx) {
			// key 必须和宿主注册的工具名完全一致。
			ctx.slots.inject("tool.call.toolview", () =>
				ctx.slots.register({ name: "tool.call.toolview", key: "generate_image" }, ImageGenRow),
			);
			ctx.slots.inject("tool.call.toolview", () =>
				ctx.slots.register({ name: "tool.call.toolview", key: "edit_image" }, ImageGenRow),
			);
		}

		exports.ImageGenRow = ImageGenRow;
		exports.apply = apply;
		exports.inject = inject;

		return module.exports;
	},
});
