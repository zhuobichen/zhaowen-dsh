/**
 * dsh-client-ui-voice —— 客户端插件的**宿主半身**。
 *
 * 纯 UI 插件：这个 `apply` 是空的，存在的唯一理由是让包作为一行出现在宿主的
 * Cordis 组合树里。浏览器那半通过 package.json 的 `dsh.client` 声明 +
 * `exports["./client"]` 被发现并下发给前端。
 *
 * 这个文件是手写的源码（不是构建产物），所以故意放在包根而不是 `lib/`——
 * 本仓库的 .gitignore 忽略 `lib/`，放进去就进不了仓库。
 */
export function apply() {}
