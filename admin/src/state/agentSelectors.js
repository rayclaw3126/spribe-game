// 纯函数选择器 —— 从 /agent/tree（全子树平铺+path）和 /agent/downline
// （登录代理自己的直属下级，agent+player 混合）两份原始数据里，
// 推导"当前焦点代理"维度的各种视图。不发请求、不持状态。
//
// 关键限制（后端契约决定，前端只能如实呈现）：
//  - /agent/tree 只含代理，不含玩家；且不含"我自己"这一行（排除自己）。
//  - /agent/downline 只返回"登录代理本人"的直属下级，无法查询任意下钻节点的下级。
// 所以：
//  - 焦点 = 自己 时，直属下级(含玩家)用 downline 数据，是完整真实数据。
//  - 焦点 = 某个下钻到的代理 时，直属下级只能从 tree 里反推"直属子代理"，
//    玩家层不可见（这是后端接口边界，不是 bug）。

/** 某条 tree 记录的直属父代理 id（path 数组最后一位是自己，倒数第二位是父级）。 */
function parentIdOf(item) {
  if (!Array.isArray(item.path) || item.path.length < 2) return null
  return item.path[item.path.length - 2]
}

/** 在 treeFlat 里找 agentId 的直属子代理（不含玩家）。 */
export function directChildAgents(treeFlat, agentId) {
  const key = String(agentId)
  return treeFlat.filter((item) => parentIdOf(item) === key)
}

/** 在 treeFlat 里按 id 找到该代理自身的记录（用于取 credit/level/role/status）。 */
export function findAgentInTree(treeFlat, agentId) {
  return treeFlat.find((item) => String(item.id) === String(agentId)) || null
}

/**
 * 焦点代理的汇总视图。
 * @param {Array} treeFlat  getTree() 原始数组
 * @param {Array} downlineOfSelf  getDownline() 原始数组（登录代理本人的）
 * @param {{id:number|string, username:string}} focus  当前焦点
 * @param {number|string} selfId  登录代理自己的 id
 * @param {{credit:string|null, winLossPct:string|null}|null} [meInfo]  getMe() 返回的登录代理自身数据
 *   （仅焦点=自己时用得上；/tree、/downline 均不含自己这一行，需要单独接口补齐）
 */
export function buildFocusView(treeFlat, downlineOfSelf, focus, selfId, meInfo) {
  const isSelf = String(focus.id) === String(selfId)
  const treeRecord = isSelf ? null : findAgentInTree(treeFlat, focus.id)

  let rows
  let downlineComplete
  if (isSelf) {
    rows = downlineOfSelf.map((r) => ({
      id: r.id,
      username: r.username,
      kind: r.kind,
      level: r.level,
      role: r.role,
      status: r.status,
      credit: r.credit,
      balance: r.balance,
    }))
    downlineComplete = true
  } else {
    rows = directChildAgents(treeFlat, focus.id).map((r) => ({
      id: r.id,
      username: r.username,
      kind: 'agent',
      level: r.level,
      role: r.role,
      status: r.status,
      credit: r.credit,
    }))
    downlineComplete = false // 玩家层对非自己节点不可见（接口限制）
  }

  return {
    isSelf,
    credit: isSelf ? meInfo?.credit ?? null : treeRecord?.credit ?? null,
    creditAvailable: isSelf ? Boolean(meInfo) : Boolean(treeRecord),
    winLossPct: isSelf ? meInfo?.winLossPct ?? null : null,
    winLossPctAvailable: isSelf ? Boolean(meInfo) : false,
    downlineCount: rows.length,
    downlineComplete,
    rows,
  }
}
