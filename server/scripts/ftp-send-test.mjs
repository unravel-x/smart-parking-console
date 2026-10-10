import 'dotenv/config'
import path from 'node:path'
import { Client } from 'basic-ftp'
import { ftpConfigFromEnv } from '../ftp-poller.mjs'

const filePath = process.argv[2]
if (!filePath) {
  console.error('用法：node server/scripts/ftp-send-test.mjs <本地图片路径>（请在仓库根目录运行）')
  process.exit(1)
}
const config = ftpConfigFromEnv()
if (!config) {
  console.error('FTP 未配置：请先在项目根目录的 .env 填写 FTP_HOST、FTP_USER、FTP_PASSWORD、FTP_INBOX_DIR')
  process.exit(1)
}

const client = new Client()
try {
  await client.access(config)
  await client.ensureDir(config.inboxDir)
  const remote = `${config.inboxDir}/${Date.now()}_${path.basename(filePath)}`.replace(/\/{2,}/g, '/')
  await client.uploadFrom(filePath, remote)
  console.log(`已上传：${remote}`)
} catch (error) {
  const code = error?.code
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') console.error('无法连接 FTP 服务器，请检查 FTP_HOST/FTP_PORT 及网络')
  else if (code === 'ENOENT') console.error(`本地图片不存在：${filePath}`)
  else if (code === '530' || /login|password|530/i.test(error?.message ?? '')) console.error('FTP 登录失败，请检查 FTP_USER/FTP_PASSWORD')
  else console.error(`上传失败：${error?.message ?? String(error)}`)
  process.exitCode = 1
} finally {
  client.close()
}
