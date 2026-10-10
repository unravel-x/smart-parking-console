import 'dotenv/config'
import { createApp } from './app.mjs'
import { ftpConfigFromEnv } from './ftp-poller.mjs'

const port = 3001
const app = createApp()
app.listen(port, '127.0.0.1', () => {
  console.log(`OCR 代理已启动：http://127.0.0.1:${port}`)
  const configured = Boolean(process.env.TENCENTCLOUD_SECRET_ID?.trim() && process.env.TENCENTCLOUD_SECRET_KEY?.trim())
  console.log(`腾讯云 OCR 密钥：${configured ? '已加载' : '未配置'}`)
  const ftp = ftpConfigFromEnv()
  console.log(ftp
    ? `FTP 轮询：已配置（${ftp.host}:${ftp.port}，收件目录 ${ftp.inboxDir}，每 3 秒检查一次）`
    : 'FTP 轮询：未配置（缺 FTP_HOST/FTP_USER/FTP_PASSWORD/FTP_INBOX_DIR，可在 .env 填写后自动重启）')
  app.startFtpPoller()
})
