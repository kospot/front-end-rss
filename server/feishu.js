/**
 * 飞书多维表：将本轮新增的 RSS 链接写入表（字段与多维表「字段配置」中文名一致）
 * 需配置环境变量：FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_APP_TOKEN、FEISHU_TABLE_ID
 */
const axios = require('axios')

const FEISHU_BASE = 'https://open.feishu.cn'
const TOKEN_BUFFER_MS = 5 * 60 * 1000
const LOG_BODY_MAX_LEN = 8000

function stringifyForLog(obj) {
  try {
    const s = JSON.stringify(obj, null, 2)
    if (s.length > LOG_BODY_MAX_LEN) {
      return `${s.slice(0, LOG_BODY_MAX_LEN)}\n... (truncated, ${s.length} chars)`
    }
    return s
  } catch (_) {
    return String(obj)
  }
}

/** 请求体脱敏后用于日志 */
function sanitizeRequestBodyForLog(data) {
  if (data == null) return data
  let parsed = data
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data)
    } catch (_) {
      return data.length > 500 ? `${data.slice(0, 500)}...` : data
    }
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (parsed.app_secret != null) {
      return { ...parsed, app_secret: '***' }
    }
  }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.records)) {
    const n = parsed.records.length
    return {
      recordsCount: n,
      recordsSample: parsed.records.slice(0, 2),
    }
  }
  return parsed
}

function logFeishuHttpError(label, err) {
  const cfg = err.config || {}
  const method = (cfg.method || 'get').toUpperCase()
  const url = cfg.url || ''
  const res = err.response
  console.error(`[feishu] ${label}`)
  console.error('  接口:', method, url)
  console.error('  请求参数/体:', stringifyForLog(sanitizeRequestBodyForLog(cfg.data)))
  if (res) {
    console.error('  HTTP状态:', res.status, res.statusText || '')
    console.error('  响应体:', stringifyForLog(res.data))
  } else {
    console.error('  网络/其它错误:', err.message || String(err))
  }
}

/** @param {string} label @param {object} config axios 请求配置 */
async function feishuRequest(label, config) {
  try {
    return await axios(config)
  } catch (err) {
    logFeishuHttpError(label, err)
    throw err
  }
}

function logFeishuBusinessError(label, url, method, requestSummary, data) {
  console.error(`[feishu] ${label}（HTTP 200 但业务 code 非 0）`)
  console.error('  接口:', method, url)
  if (requestSummary !== undefined) {
    console.error('  请求概要:', stringifyForLog(requestSummary))
  }
  console.error('  响应体:', stringifyForLog(data))
}

/** 逻辑名 -> 多维表里可能出现的字段名候选 */
const CREATE_FIELD_ALIASES = {
  日期: ['日期', 'Date', 'date'],
  原标题: ['原标题', 'Original title', 'original title', '标题', 'Title'],
  中文标题: ['中文标题', 'Chinese title', 'chinese title'],
  推荐度: ['推荐度', 'Recommendation', 'recommendation'],
  所属源: ['所属源', 'Source', 'source', '来源'],
  链接: ['链接', 'Link', 'link', 'URL', 'url', '文章链接', '原文链接'],
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
  const tokenUrl = `${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`
  const { data } = await feishuRequest('获取 tenant_access_token', {
    method: 'POST',
    url: tokenUrl,
    data: { app_id: appId, app_secret: appSecret },
    headers: { 'Content-Type': 'application/json' },
  })
  if (data.code !== 0) {
    logFeishuBusinessError(
      '获取 tenant_access_token',
      tokenUrl,
      'POST',
      { app_id: appId, app_secret: '***' },
      data,
    )
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
  const fieldsUrl = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`
  const { data } = await feishuRequest('获取数据表字段列表', {
    method: 'GET',
    url: fieldsUrl,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (data.code !== 0) {
    logFeishuBusinessError('获取数据表字段列表', fieldsUrl, 'GET', { appToken, tableId }, data)
    return null
  }
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
      链接: row.link != null ? String(row.link) : '',
    }
    const fields = resolveFieldsForTable(rawFields, tableFieldNames)
    if (Object.keys(fields).length === 0) {
      throw new Error(
        '多维表字段与代码不匹配：未找到 日期/原标题/中文标题/推荐度/所属源/链接 中任一列。当前表字段: ' +
          tableFieldNames.join('、'),
      )
    }
    recordPayloads.push({ fields })
  }

  const BATCH = 100
  let created = 0
  for (let off = 0; off < recordPayloads.length; off += BATCH) {
    const chunk = recordPayloads.slice(off, off + BATCH)
    const batchUrl = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`
    const body = { records: chunk }
    const { data } = await feishuRequest(`批量创建记录 (offset=${off}, size=${chunk.length})`, {
      method: 'POST',
      url: batchUrl,
      data: body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })
    if (data.code !== 0) {
      logFeishuBusinessError(
        '批量写入飞书记录',
        batchUrl,
        'POST',
        sanitizeRequestBodyForLog(body),
        data,
      )
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
