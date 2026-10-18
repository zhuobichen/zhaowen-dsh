// 冒烟：插件能注册两个工具，且工具形状完整（不碰任何真实会话文件）。
import { apply } from "../lib/index.js";

const registered = [];
apply({ tools: { register: (def) => (registered.push(def), () => {}) } }, {});

const names = registered.map((t) => t.name).sort();
const expected = ["agent_sessions_import", "agent_sessions_scan"];
if (JSON.stringify(names) !== JSON.stringify(expected)) {
  console.error("unexpected tools:", names);
  process.exit(1);
}
for (const tool of registered) {
  if (!tool.parameters || tool.parameters.type !== "object") throw new Error(`${tool.name}: parameters`);
  if (!tool.output?.schema || typeof tool.output.render !== "function") throw new Error(`${tool.name}: output`);
  if (typeof tool.execute !== "function") throw new Error(`${tool.name}: execute`);
}
console.log("tools:", names.join(", "));
