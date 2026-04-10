/**
 * 读取 data/links.json，将全部条目批量写入飞书多维表（与 update 抓取时字段一致）。
 *
 * 用法（在 server 目录）：
 *   node sync-links-to-feishu.js
 *
 * 环境变量：同 feishu.js（FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_APP_TOKEN、FEISHU_TABLE_ID）
 * 可选：
 *   FEISHU_IMPORT_LIMIT=500   只导入前 N 条（调试用）
 *   FEISHU_SYNC=0            本脚本仍会通过 force 写入；仅说明可忽略
 *
 * 注意：重复执行会为同一批链接再建记录；需要去重请在飞书侧处理或先清空表。
 */
require('dotenv').config({ multiline: true })

const fs = require('fs-extra')
const path = require('path')
const { syncNewLinks } = require('./feishu')

const ROOT = path.join(__dirname, '..')
const LINKS_PATH = path.join(ROOT, 'data/links.json')
const RSS_PATH = path.join(ROOT, 'data/rss.json')

function buildCategoryBySource() {
  let rss = []
  try {
    rss = fs.readJsonSync(RSS_PATH)
  } catch (e) {
    return {}
  }
  const map = {}
  if (!Array.isArray(rss)) return map
  rss.forEach((entry) => {
    if (entry && entry.title) {
      map[entry.title] = entry.category != null ? String(entry.category) : ''
    }
  })
  return map
}

function flattenLinks(linksJson, categoryBySource) {
  const rows = []
  if (!Array.isArray(linksJson)) return rows
  linksJson.forEach((sourceBlock) => {
    if (!sourceBlock || !sourceBlock.title) return
    const source = sourceBlock.title
    const category = categoryBySource[source] || ''
    const items = sourceBlock.items || []
    items.forEach((item) => {
      if (!item || !item.link) return
      rows.push({
        title: item.title != null ? String(item.title) : '',
        link: String(item.link),
        date: item.date != null ? String(item.date) : '',
        source,
        category,
      })
    })
  })
  return rows
}

async function main() {
  const linksJson = await fs.readJson(LINKS_PATH)
  const categoryBySource = buildCategoryBySource()
  let rows = flattenLinks(linksJson, categoryBySource)

  const limitRaw = process.env.FEISHU_IMPORT_LIMIT
  if (limitRaw) {
    const n = parseInt(limitRaw, 10)
    if (Number.isFinite(n) && n > 0) {
      console.log('FEISHU_IMPORT_LIMIT=%d，仅导入前 %d 条', n, n)
      rows = rows.slice(0, n)
    }
  }

  console.log('共 %d 条链接，开始写入飞书…', rows.length)
  const result = await syncNewLinks(rows, { force: true })
  console.log('完成，新建记录数: %d', result.count)
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err)
  process.exit(1)
})
