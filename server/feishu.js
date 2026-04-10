/**
 * 飞书多维表：将本轮新增的 RSS 链接写入表（字段与多维表「字段配置」中文名一致）
 * 需配置环境变量：FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_APP_TOKEN、FEISHU_TABLE_ID
 */
const axios = require('axios')

const FEISHU_BASE = 'https://open.feishu.cn'
const TOKEN_BUFFER_MS = 5 * 60 * 1000

/** 逻辑名 -> 多维表里可能出现的字段名候选 */
const CREATE_FIELD_ALIASES = {
  日期: ['日期', 'Date', 'date'],
  原标题: ['原标题', 'Original title', 'original title', '标题', 'Title'],
  中文标题: ['中文标题', 'Chinese title', 'chinese title'],
  推荐度: ['推荐度', 'Recommendation', 'recommendation'],
  所属源: ['所属源', 'Source', 'source', '来源'],
}

let cachedToken = null
let tokenExpireAt = 0

function parseToTimestamp(value) {
  if (value == null || value === '') return undefined
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    if (!Number.isNaN(ms)) return ms
  }
  return undefined
}

function throwFeishuError(data, defaultMsg) {
  if (data.code === 91403) {
    throw new Error(
      '多维表权限不足(91403)：请在飞书开放平台开通多维表权限并发布版本，且在该多维表内「…」→ 更多 → 添加文档应用 → 添加本应用',
    )
  }
  throw new Error(data.msg || defaultMsg)
}

async function getTenantAccessToken() {
  if (cachedToken && Date.now() < tokenExpireAt) {
    return cachedToken
  }
  const appId = process.env.FEISHU_APP_ID || ''
  const appSecret = process.env.FEISHU_APP_SECRET || ''
  if (!appId || !appSecret) {
    throw new Error('请配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET')
  }
  const { data } = await axios.post(
    `${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`,
    { app_id: appId, app_secret: appSecret },
    { headers: { 'Content-Type': 'application/json' } },
  )
  if (data.code !== 0) {
    throw new Error(data.msg || '获取飞书 token 失败')
  }
  cachedToken = data.tenant_access_token
  tokenExpireAt = Date.now() + (data.expire || 7200) * 1000 - TOKEN_BUFFER_MS
  return cachedToken
}

function getBitableConfig() {
  const appToken = process.env.FEISHU_APP_TOKEN || ''
  const tableId = process.env.FEISHU_TABLE_ID || ''
  if (!appToken || !tableId) {
    throw new Error('请配置 FEISHU_APP_TOKEN（多维表 app_token）与 FEISHU_TABLE_ID（数据表 table_id）')
  }
  return { appToken, tableId }
}

function isFeishuSyncEnabled() {
  if (process.env.FEISHU_SYNC === '0' || process.env.FEISHU_SYNC === 'false') {
    return false
  }
  return hasFeishuCredentials()
}

function hasFeishuCredentials() {
  return !!(
    process.env.FEISHU_APP_ID &&
    process.env.FEISHU_APP_SECRET &&
    process.env.FEISHU_APP_TOKEN &&
    process.env.FEISHU_TABLE_ID
  )
}

async function getTableFields(appToken, tableId, accessToken) {
  const { data } = await axios.get(
    `${FEISHU_BASE}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (data.code !== 0) return null
  const dataObj = data.data || {}
  let rawItems = []
  if (Array.isArray(dataObj.items)) rawItems = dataObj.items
  else if (Array.isArray(dataObj)) rawItems = dataObj
  const items = rawItems.map((f) => (f && f.field ? f.field : f))
  const nameToId = {}
  items.forEach((f) => {
    const fid = f.field_id || f.id
    const fname = f.name || f.field_name || f.fieldName || f.title
    if (fid && fname) {
      nameToId[fname] = fid
    }
  })
  return { nameToId, tableFieldNames: Object.keys(nameToId) }
}

function resolveFieldsForTable(rawFields, tableFieldNames) {
  const fields = {}
  Object.keys(rawFields).forEach((ourName) => {
    const val = rawFields[ourName]
    if (val === undefined) return
    const candidates = CREATE_FIELD_ALIASES[ourName] || [ourName]
    const tableName = candidates.find((c) => tableFieldNames.includes(c))
    if (!tableName) return
    fields[tableName] = val
  })
  return fields
}

/**
 * @param {Array<{ title: string, link: string, date: string, source: string, category?: string, zhTitle?: string }>} rows
 * @param {{ force?: boolean }} [options] force=true 时忽略 FEISHU_SYNC 关闭开关（供一次性导入脚本使用）
 */
async function syncNewLinks(rows, options = {}) {
  const force = options.force === true
  if (!rows || rows.length === 0) {
    return { skipped: true, count: 0 }
  }
  if (!force && !isFeishuSyncEnabled()) {
    return { skipped: true, count: 0 }
  }
  if (force && !hasFeishuCredentials()) {
    throw new Error('请配置 FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_APP_TOKEN、FEISHU_TABLE_ID')
  }

  const accessToken = await getTenantAccessToken()
  const { appToken, tableId } = getBitableConfig()
  const fieldInfo = await getTableFields(appToken, tableId, accessToken)
  const tableFieldNames =
    fieldInfo && fieldInfo.tableFieldNames && fieldInfo.tableFieldNames.length > 0
      ? fieldInfo.tableFieldNames
      : Object.values(CREATE_FIELD_ALIASES).flat()

  const recordPayloads = []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const dateTs = parseToTimestamp(row.date) ?? Date.now()
    const rawFields = {
      日期: dateTs,
      原标题: row.title != null ? String(row.title) : '',
      中文标题: row.zhTitle != null ? String(row.zhTitle) : '',
      推荐度: row.category != null ? String(row.category) : '',
      所属源: row.source != null ? String(row.source) : '',
    }
    const fields = resolveFieldsForTable(rawFields, tableFieldNames)
    if (Object.keys(fields).length === 0) {
      throw new Error(
        '多维表字段与代码不匹配：未找到 日期/原标题/中文标题/推荐度/所属源 中任一列。当前表字段: ' +
          tableFieldNames.join('、'),
      )
    }
    recordPayloads.push({ fields })
  }

  const BATCH = 100
  let created = 0
  for (let off = 0; off < recordPayloads.length; off += BATCH) {
    const chunk = recordPayloads.slice(off, off + BATCH)
    const { data } = await axios.post(
      `${FEISHU_BASE}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      { records: chunk },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      },
    )
    if (data.code !== 0) {
      throwFeishuError(data, '批量写入飞书记录失败')
    }
    const recs = (data.data && data.data.records) || []
    created += recs.length
  }

  return { skipped: false, count: created }
}

module.exports = {
  isFeishuSyncEnabled,
  hasFeishuCredentials,
  syncNewLinks,
}
