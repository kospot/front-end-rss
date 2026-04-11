/**
 * 从脚本所在目录加载 .env，不依赖 process.cwd()。
 * 优先 server/.env，不存在则用仓库根目录 .env。
 */
const path = require('path')
const fs = require('fs')

const serverEnv = path.join(__dirname, '.env')
const rootEnv = path.join(__dirname, '..', '.env')
const envPath = fs.existsSync(serverEnv) ? serverEnv : rootEnv
console.log('envPath', envPath)
require('dotenv').config({ path: envPath, multiline: true })
