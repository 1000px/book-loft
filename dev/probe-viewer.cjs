// AnnoViewer 视觉对比探针：直接加载 HTML，不用 epub.js。
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const LOG = path.join(__dirname, 'probe-viewer.log')
function log(m) { fs.appendFileSync(LOG, m + '\n') }
fs.writeFileSync(LOG, 'start ' + new Date().toISOString() + '\n')

app.commandLine.appendSwitch('use-gl', 'swiftshader')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('no-sandbox')

app.whenReady().then(async () => {
  log('ready')
  const w = new BrowserWindow({
    width: 820,
    height: 2360,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: { backgroundThrottling: false, sandbox: false }
  })
  await w.loadFile(path.join(__dirname, 'probe-viewer.html'))
  log('loaded')

  await new Promise(r => setTimeout(r, 2500))

  try {
    const img = await w.capturePage()
    const buf = img.toPNG()
    fs.writeFileSync(path.join(__dirname, 'probe-viewer.png'), buf)
    log('saved bytes=' + buf.length)
  } catch (e) {
    log('capture err: ' + e.message)
  }

  app.quit()
})
