const fs = require('fs-extra')
const Async = require('async')
const moment = require('moment')
const simpleGit = require('simple-git')

const utils = require('./utils')
const writemd = require('./writemd')
const createFeed = require('./feed')
const fetch = require('./fetch')
const { syncNewLinks, isFeishuSyncEnabled } = require('./feishu')

const {
  RESP_PATH,
  RSS_PATH,
  LINKS_PATH,
} = utils.PATH

const git = simpleGit(RESP_PATH)

let rssJson = null
let linksJson = null
let newData = null
/** @type {Array<{ title: string, link: string, date: string, source: string, category?: string }>} */
let feishuNewRows = null

/**
 * 更新 git 仓库
 */
function handleUpdate() {
  utils.log('开始更新抓取')

  git.pull().exec(handleFeed)
}

/**
 * 提交修改到 git 仓库
 */
function handleCommit() {
  utils.log('完成抓取，即将上传')

  git.add('./*')
    .commit('更新: ' + newData.titles.join('、'))
    .push(['-u', 'origin', 'master'], () => utils.logSuccess('完成抓取和上传！'))
}

/**
 * 处理订阅源
 */
function handleFeed() {
  rssJson = fs.readJsonSync(RSS_PATH)
  const linksExist = fs.readJsonSync(LINKS_PATH)
  linksJson = []
  feishuNewRows = []
  // 只保留最近 N 天的数据
  const KEEP_DAYS = 30
  const cutoffDate = moment().subtract(KEEP_DAYS - 1, 'days').format('YYYY-MM-DD')

  newData = {
    length: 0,
    titles: [],
    rss: {},
    links: {}
  }

  const tasks = rssJson.map((rssItem, rssIndex) => ((callback) => {
    ((async () => {
      const feed = await fetch(rssItem)
      const items = linksExist.find((el) => el.title === rssItem.title)?.items || []
      const newItems = (feed?.items || []).reduce((prev, curr) => {
        const exist = items.find((el) => utils.isSameLink(el.link, curr.link))
        if (exist) {
          return prev
        } else {
          let date = moment().format('YYYY-MM-DD')

          try {
            date = moment(curr.isoDate).format('YYYY-MM-DD')
          } catch (e) {}

          newData.rss[rssItem.title] = true
          newData.links[curr.link] = true

          return [...prev, {
            title: curr.title,
            link: curr.link,
            date
          }]
        }
      }, [])

      let allItems = items
      if (newItems.length) {
        utils.logSuccess('更新 RSS: ' + rssItem.title)
        newData.titles.push(rssItem.title)
        newData.length += newItems.length
        newItems.forEach((item) => {
          feishuNewRows.push({
            title: item.title,
            link: item.link,
            date: item.date,
            source: rssItem.title,
            category: rssItem.category || '',
          })
        })
        allItems = newItems.concat(items).sort(function (a, b) {
          return a.date < b.date ? 1 : -1
        })
      }
      // 统一按日期过滤，只保留最近 KEEP_DAYS 天
      allItems = allItems.filter((item) => {
        return item.date && item.date >= cutoffDate
      })

      linksJson[rssIndex] = {
        title: rssItem.title,
        items: allItems
      }
      callback(null)
    })())
  }))

  Async.series(tasks, async () => {
    if (newData.length) {
      fs.outputJsonSync(LINKS_PATH, linksJson)
      if (isFeishuSyncEnabled() && feishuNewRows.length) {
        try {
          const r = await syncNewLinks(feishuNewRows)
          if (!r.skipped && r.count) {
            utils.logSuccess('已同步 ' + r.count + ' 条链接到飞书多维表')
          }
        } catch (e) {
          utils.logWarn('飞书同步失败（已保留本地 links 更新）: ' + (e && e.message ? e.message : String(e)))
        }
      }
      await writemd(newData, linksJson)
      await createFeed(linksJson)
      handleCommit()
    } else {
      utils.logSuccess('无需更新')
    }
    rssJson = null
    linksJson = null
    newData = null
    feishuNewRows = null
  })
}

module.exports = handleUpdate
