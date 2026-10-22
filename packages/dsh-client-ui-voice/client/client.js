window.__ModuleLoader__.load({
	id: '@zhuobichen/dsh-client-ui-voice',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const jsx = require("react/jsx-runtime").jsx;

		// 语音输入按钮：挂在输入框卡片内工具行的左端（槽位 conversation.input.left）。
		//
		// 点一下开始听，再点一下停；最终识别文本写进**当前会话的输入框草稿**，不发送。
		//
		// 草稿写入有两条路，都只改草稿、不提交：
		//   1. 槽位标准件 inputActions.setDraft —— DSH 的会话槽位组件都能拿到
		//      （conversation.input.left 的 standard props 里有 inputActions），
		//      这是官方公开的草稿写入口；
		//   2. 注入面里的 setDraft —— apply 时通过
		//      ctx.sessions.scope(sessionId) 找到会话作用域 ctx，再调
		//      conversation.input.for(actx).setDraft(text)。
		// 两条最终都进同一台 input machine 的 draft-changed 事件。
		//
		// 这里**不用** ctx.conversation.send(text)：它会把这一句当成 prompt 立刻
		// 发出去，和「说完自己改完再发」正好相反。send 不是退路，是错误路径。

		//#region 样式：28×28 的圆形图标按钮，和工具行里的「+」同尺寸
		const CSS =
			".dshv_wrap{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:280px}" +
			".dshv_btn{width:28px;height:28px;flex:none;display:grid;place-items:center;padding:0;" +
			"cursor:pointer;border:none;border-radius:999px;background:0 0;" +
			"color:var(--dsw-alias-label-primary,#222);font-size:15px;line-height:1}" +
			".dshv_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid,rgba(127,127,127,.16))}" +
			".dshv_btn:disabled{opacity:.5;cursor:default}" +
			".dshv_btn svg{display:block;pointer-events:none}" +
			".dshv_on{background:var(--dsw-alias-state-business-tertiary,rgba(77,107,254,.16));" +
			"color:var(--dsw-alias-state-business-primary,#4d6bfe);animation:dshv_pulse 1.2s ease-in-out infinite}" +
			".dshv_hint{min-width:0;font-size:11px;line-height:16px;overflow:hidden;" +
			"text-overflow:ellipsis;white-space:nowrap;" +
			"color:var(--dsw-alias-label-tertiary,#8a8a8a)}" +
			".dshv_hint_error{color:var(--dsw-alias-state-error-primary,#d97070)}" +
			"@keyframes dshv_pulse{0%,100%{opacity:1}50%{opacity:.55}}";
		const TAG_ID = "@zhuobichen/dsh-client-ui-voice/voice.css";

		if (
			typeof document !== "undefined" &&
			document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]") === null
		) {
			const tag = document.createElement("style");

			tag.dataset.plugin = "@zhuobichen/dsh-client-ui-voice";
			tag.dataset.pluginCss = TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region 纯函数：追加草稿、错误话术
		//
		// setDraft 写的是**整份草稿**，没有光标/选区接口，所以识别结果只能追加到
		// 末尾：已有内容时不覆盖，只在两边都不是空白时补一个空格。
		/**
		 * @param base - 开始录音那一刻的草稿。
		 * @param text - 这次识别出的文本。
		 * @returns 下一份草稿。
		 */
		const appendToDraft = (base, text) => {
			const left = typeof base === "string" ? base : "";
			const right = typeof text === "string" ? text : "";

			if (right === "") return left;
			if (left === "") return right;

			return /\s$/.test(left) ? left + right : left + " " + right;
		};

		/** Web Speech API 的 error code → 用户能看懂的一句话。 */
		const errorTextOf = (code) => {
			switch (code) {
				case "not-allowed":
				case "service-not-allowed":
					return "没有麦克风权限：在浏览器地址栏允许本站使用麦克风后重试";
				case "audio-capture":
					return "找不到麦克风，检查一下系统输入设备";
				case "no-speech":
					return "没有听到声音，请再说一次";
				case "network":
					return "语音识别请求失败（Chrome 的识别需要联网）";
				case "language-not-supported":
					return "当前浏览器不支持中文语音识别";
				case "aborted":
					return "语音识别已取消";
				default:
					return "语音识别失败：" + code;
			}
		};

		const messageOf = (failure) =>
			failure && typeof failure.message === "string" && failure.message !== ""
				? failure.message
				: String(failure);

		const UNSUPPORTED =
			"当前浏览器不支持语音识别（需要 Chrome / Edge / Safari 的 webkitSpeechRecognition；Firefox 没有）";
		//#endregion

		/**
		 * 焦点是不是在输入区（textarea / contenteditable）。
		 *
		 * 不判断这个，快捷键会在侧栏、搜索框里也生效。
		 */
		const focusInComposer = () => {
			const doc = typeof document === "undefined" ? undefined : document;
			const active = doc === undefined || doc === null ? undefined : doc.activeElement;

			if (!active) return false;
			if (active.tagName === "TEXTAREA") return true;
			if (active.isContentEditable === true) return true;

			return false;
		};

		/**
		 * 输入框工具行里的麦克风按钮。
		 *
		 * 说话 -> 识别 -> 最终文本写进当前会话草稿。按钮只在这次点击的生命周期里
		 * 持有 SpeechRecognition 实例；`continuous = true` + `interimResults = true`：
		 * 边说边出字（interim 只做预览），结束时机由用户按 Ctrl+Alt 或点按钮决定。
		 *
		 * @param props - 槽位标准件 + 注入面：
		 *   `inputActions`（首选写入路径）、`input.draft`（当前草稿）、
		 *   `setDraft` / `notify`（注入的退路与提示通道）。
		 */
		function VoiceButton(props) {
			const [phase, setPhase] = react.useState("idle");
			const [hint, setHint] = react.useState(null);
			const recognition = react.useRef(null);
			const baseDraft = react.useRef("");
			const spoken = react.useRef("");
			// 正在说的那半句（浏览器会反复改写它，所以只做预览、每次整段替换）
			const interimText = react.useRef("");
			const failed = react.useRef(false);
			const writeFailure = react.useRef(null);
			const latest = react.useRef(props);

			// 每次渲染後同步最新 props：识别回调是在上一次渲染里创建的长生命周期
			// 闭包，不能靠它读到 click 之后的 props。
			react.useEffect(() => {
				latest.current = props;
			});

			// 会话切换 / 组件卸载时别把麦克风留在开着的状态。
			react.useEffect(
				() => () => {
					const rec = recognition.current;

					recognition.current = null;
					if (rec !== null) {
						// 先摘掉回调：卸载不该再往已经消失的会话里发"已取消"提示
						rec.onresult = null;
						rec.onerror = null;
						rec.onend = null;
						try {
							rec.abort();
						} catch {
							// 已经结束了：没有要收的尾
						}
					}
				},
				[],
			);

			/** 用户可读的提示：先写本地一行小字，再（如果有）走 composer 的通知通道。 */
			const notify = (level, text) => {
				setHint({ level, text });

				const face = latest.current || {};

				if (typeof face.notify === "function") {
					try {
						face.notify(level, text);
					} catch {
						// 注入面的 notify 只是锦上添花，本地那行才是兜底
					}
				}
			};

			/**
			 * 把整份下一稿写进当前会话。
			 * @returns 是否有一条可用路径接住了它。
			 */
			const writeDraft = (text) => {
				const face = latest.current || {};

				if (face.inputActions && typeof face.inputActions.setDraft === "function") {
					try {
						face.inputActions.setDraft(text);

						return true;
					} catch (failure) {
						// 标准件挂了就退到注入面；两条都失败才把错误报出去
						writeFailure.current = failure;
					}
				}

				if (typeof face.setDraft === "function") {
					try {
						face.setDraft(text);

						return true;
					} catch (failure) {
						writeFailure.current = failure;
					}
				}

				return false;
			};

			const stop = () => {
				const rec = recognition.current;

				recognition.current = null;
				setPhase("idle");

				if (rec !== null) {
					try {
						rec.stop();
					} catch {
						// 浏览器可能已经自己停了
					}
				}
			};

			const start = () => {
				// 同一 tick 里的第二次点击（state 还没重画）也不该再开一个识别器
				if (recognition.current !== null) {
					stop();

					return;
				}

				const scope = typeof window !== "undefined" ? window : undefined;
				const Ctor =
					scope === undefined ? undefined : scope.SpeechRecognition || scope.webkitSpeechRecognition;

				if (typeof Ctor !== "function") {
					notify("error", UNSUPPORTED);

					return;
				}

				if (scope.isSecureContext === false) {
					notify("error", "浏览器只允许在 HTTPS 或 localhost 下使用麦克风");

					return;
				}

				let rec;

				try {
					rec = new Ctor();
				} catch (failure) {
					notify("error", "语音识别启动失败：" + messageOf(failure));

					return;
				}

				rec.lang = "zh-CN";
				rec.interimResults = true;
				// continuous：边说边出字，一直听直到用户按 Ctrl+Alt 或点按钮结束。
				// 不再靠浏览器"说完一句就停"来决定收尾。
				rec.continuous = true;

				const face = latest.current || {};

				baseDraft.current =
					face.input && typeof face.input.draft === "string" ? face.input.draft : "";
				spoken.current = "";
				interimText.current = "";
				failed.current = false;
				writeFailure.current = null;
				setHint(null);

				rec.onresult = (event) => {
					const results = event && event.results;

					if (!results) return;

					const from = typeof event.resultIndex === "number" ? event.resultIndex : 0;
					let interim = "";

					for (let index = from; index < results.length; index += 1) {
						const result = results[index];
						const alternative = result && result[0];
						const transcript =
							alternative && typeof alternative.transcript === "string"
								? alternative.transcript
								: "";

						// final 落进 spoken（累积）；interim 只是"正在说的那半句"的预览，
						// 浏览器下一帧会改写它，所以整段替换、绝不追加。
						if (result && result.isFinal === true) spoken.current += transcript;
						else interim += transcript;
					}

					interimText.current = interim;

					// 实时预览：每来一帧都把 base + 已确定 + 正在说的 拼回去，
					// 所以屏幕上是你边说话边长出来的字。
					const text = (spoken.current + interimText.current).trim();

					if (text === "") return;

					if (!writeDraft(appendToDraft(baseDraft.current, text))) {
						const failure = writeFailure.current;

						notify(
							"error",
							"识别到了文字，但没能写进输入框" + (failure ? "：" + messageOf(failure) : ""),
						);
						stop();
					}
				};

				rec.onerror = (event) => {
					const code = event && typeof event.error === "string" ? event.error : "unknown";

					failed.current = true;
					recognition.current = null;
					setPhase("idle");
					notify("error", errorTextOf(code));
				};

				rec.onend = () => {
					recognition.current = null;
					// 收尾时把"正在说的那半句"清掉：它没被确认，留着会变成残句
					interimText.current = "";
					setPhase("idle");

					// 说完了但一个字都没有：给一句可读提示，别静默回到 🎙。
					if (spoken.current.trim() === "" && failed.current === false) {
						setHint({ level: "info", text: "没有听清，再点一次试试" });
					}
				};

				recognition.current = rec;

				try {
					rec.start();
					setPhase("listening");
				} catch (failure) {
					recognition.current = null;
					notify("error", "无法开始录音：" + messageOf(failure));
				}
			};

			const listening = phase === "listening";

			// 快捷键：单独按 Ctrl+Alt（不带第三个键）开始 / 结束。
			//
			// 修饰键自己不产生字符，不能直接当按键用，所以判定是：
			//   按下 Ctrl+Alt → 期间没按别的键 → 松开任一修饰键 才算触发。
			// 这样 Ctrl+Alt+C 之类的真组合键不会被抢。
			//
			// 只在焦点位于输入区（有文本光标）时生效：在侧栏、搜索框里按不生效。
			react.useEffect(() => {
				const view = typeof window === "undefined" ? undefined : window;

				if (view === undefined || typeof view.addEventListener !== "function") return undefined;

				const chord = { armed: false, used: false };

				const reset = () => {
					chord.armed = false;
					chord.used = false;
				};

				const onKeyDown = (event) => {
					if (event === null || event === undefined) return;

					const key = event.key;

					// 两个修饰键都按着的时候，任何"第三个键"都作废这次触发
					if (chord.armed && key !== "Control" && key !== "Alt") chord.used = true;

					if (key !== "Control" && key !== "Alt") return;
					if (event.ctrlKey === true && event.altKey === true) chord.armed = true;
				};

				const onKeyUp = (event) => {
					if (event === null || event === undefined) return;

					const key = event.key;

					if (key !== "Control" && key !== "Alt") return;

					const fire = chord.armed === true && chord.used === false && focusInComposer();

					// 先复位再动作：start()/stop() 里可能触发重渲染
					reset();

					if (!fire) return;

					if (recognition.current !== null || phase === "listening") stop();
					else start();
				};

				view.addEventListener("keydown", onKeyDown, true);
				view.addEventListener("keyup", onKeyUp, true);
				view.addEventListener("blur", reset);

				return () => {
					view.removeEventListener("keydown", onKeyDown, true);
					view.removeEventListener("keyup", onKeyUp, true);
					view.removeEventListener("blur", reset);
				};
			}, [phase]);

			// 图标用 inline SVG：emoji（🎙）在有些中文字体下会渲染成抽象符号。
			const icon = listening
				? jsx("svg", {
						viewBox: "0 0 24 24",
						width: 15,
						height: 15,
						"aria-hidden": "true",
						focusable: "false",
						fill: "currentColor",
						children: jsx("rect", { x: 6.5, y: 6.5, width: 11, height: 11, rx: 2.5 }),
					})
				: jsx("svg", {
						viewBox: "0 0 24 24",
						width: 16,
						height: 16,
						"aria-hidden": "true",
						focusable: "false",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: 1.8,
						strokeLinecap: "round",
						strokeLinejoin: "round",
						children: [
							jsx("rect", { key: "body", x: 9, y: 2.5, width: 6, height: 11, rx: 3 }),
							jsx("path", { key: "arc", d: "M5.5 11.5a6.5 6.5 0 0 0 13 0" }),
							jsx("path", { key: "stem", d: "M12 18v3" }),
						],
					});

			return jsx("span", {
				className: "dshv_wrap",
				children: [
					jsx("button", {
						key: "button",
						type: "button",
						className: listening ? "dshv_btn dshv_on" : "dshv_btn",
						title: listening
							? "正在听…按 Ctrl+Alt（松开）或点这里结束"
							: "语音输入：Ctrl+Alt 按下再松开即可开始 / 结束（光标要在输入框里）；结果只写进草稿，不会自动发送",
						"aria-label": listening ? "停止语音输入" : "开始语音输入",
						"aria-pressed": listening,
						onMouseDown: (event) => {
							// 点工具行按钮不该把输入框的焦点/光标弄丢
							if (event && typeof event.preventDefault === "function") event.preventDefault();
						},
						onClick: () => {
							if (listening || recognition.current !== null) stop();
							else start();
						},
						children: icon,
					}),
					hint === null
						? null
						: jsx("span", {
								key: "hint",
								className:
									hint.level === "error" ? "dshv_hint dshv_hint_error" : "dshv_hint",
								title: hint.text,
								children: hint.text,
							}),
				].filter(Boolean),
			});
		}

		//#region 会话作用域里的草稿写入口（注入面 / send 不用）
		/**
		 * 找到某个会话的 SessionInput 门面。
		 *
		 * 顺序：会话作用域 ctx 上的 conversation（和官方 queue dock 同一写法）→
		 * 插件根 ctx 上的 conversation。两条最终都是同一个
		 * ConversationController，`input.for(actx)` 按 actx 的会话标签找门面。
		 *
		 * @param ctx - 客户端根上下文。
		 * @param sessionId - 槽位 inject 给的那个会话 id。
		 * @returns SessionInput 门面。
		 */
		const sessionInputOf = (ctx, sessionId) => {
			let sessions;

			if (ctx !== undefined) {
				sessions = typeof ctx.get === "function" ? ctx.get("sessions") : undefined;
				if (sessions === undefined) sessions = ctx.sessions;
			}

			const scope =
				sessions && typeof sessions.scope === "function" ? sessions.scope(sessionId) : undefined;

			if (scope === undefined) {
				throw new Error('ui-voice: session "' + String(sessionId) + '" resolved no scope');
			}

			let conversation = typeof scope.get === "function" ? scope.get("conversation") : undefined;

			if (conversation === undefined && ctx !== undefined) {
				conversation = typeof ctx.get === "function" ? ctx.get("conversation") : undefined;
				if (conversation === undefined) conversation = ctx.conversation;
			}

			if (conversation === undefined || conversation.input === undefined) {
				throw new Error("ui-voice: conversation service unavailable");
			}

			return conversation.input.for(scope);
		};

		/**
		 * 惰性 writer：注册时还不一定有会话，真正写的时候才解析门面；失败缓存并
		 * 原样抛出，组件会把消息挂到输入框旁边的提示行上。
		 *
		 * @param ctx - 客户端根上下文。
		 * @param sessionId - 会话 id。
		 * @returns `{ setDraft, notify }`。
		 */
		const createWriter = (ctx, sessionId) => {
			let input;
			let failure;

			const resolve = () => {
				if (input !== undefined) return input;
				if (failure !== undefined) throw failure;

				try {
					input = sessionInputOf(ctx, sessionId);

					return input;
				} catch (error) {
					failure = error;
					throw error;
				}
			};

			return {
				setDraft: (text) => {
					resolve().setDraft(text);
				},
				notify: (level, text) => {
					try {
						resolve().notify(level, text);
					} catch {
						// 本地提示行已经显示了同一句话
					}
				},
			};
		};
		//#endregion

		/** 槽位 + 会话作用域解析（inject 工厂拿 sessionId 要它）。 */
		const inject = ["slots", "sessions"];

		/**
		 * @param ctx - 客户端根上下文。
		 */
		function apply(ctx) {
			// conversation.input.left：输入框卡片内工具行左端、常驻的一个小控件。
			// 该槽位目前没有 shipped occupant，order 取 50 只是给它一个稳定位置。
			ctx.slots.inject("conversation.input.left", () =>
				ctx.slots.register(
					{
						name: "conversation.input.left",
						id: "voice-input",
						order: 50,
						inject: (sessionId) => {
							const writer = createWriter(ctx, sessionId);

							return {
								// 退路：conversation.input.for(actx).setDraft(text)
								setDraft: (text) => writer.setDraft(text),
								notify: (level, text) => writer.notify(level, text),
							};
						},
					},
					VoiceButton,
				),
			);
		}

		exports.VoiceButton = VoiceButton;
		exports.apply = apply;
		exports.inject = inject;
		// 给 test/contract.test.ts 用：纯函数与路径解析单独可测。
		exports.appendToDraft = appendToDraft;
		exports.errorTextOf = errorTextOf;
		exports.sessionInputOf = sessionInputOf;

		return module.exports;
	},
});
