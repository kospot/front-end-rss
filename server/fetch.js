const Parser = require('rss-parser')
const Async = require('async')

const utils = require('./utils')

let rssConfig = {}
try {
  rssConfig = JSON.parse(process.env.RSS_CONFIG || '{}')
} catch (e) {
}

async function fetchFeed(rss) {
  const parser = new Parser({
    headers: {
      // 部分站点（如 Engadget）会拒绝过旧或移动 UA；使用常见桌面浏览器串更稳
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  })

  try {
    const feed = await parser.parseURL(rss)
    if (feed) {
      utils.logSuccess('成功 RSS: ' + rss)
      return feed
    }
  } catch (e) {}

  utils.logWarn('失败 RSS: ' + rss)
  return true
}

async function initFetch(rssItem, onFinish) {
  let rssArray = rssItem.rss

  if (typeof rssArray === 'string') {
    rssArray = [rssArray]
  }

  const envRss = rssConfig[rssItem.title]

  if (envRss) {
    rssArray.unshift(envRss)
  }

  const tasks = rssArray.map((rss) => ((callback) => {
    ((async () => {
      const feed = await fetchFeed(rss)

      if (feed === true) {
        callback(true)
      } else {
        callback(null, feed)
      }
    })())
  }))

  utils.log('开始 RSS: ' + rssItem.title)

  return new Promise((resolve) => {
    Async.tryEach(tasks, (err, res) => {
      utils.log('完成 RSS: ' + rssItem.title)
      resolve(err ? null : res)
    })
  })
}

module.exports = initFetch
