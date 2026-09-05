// AnnoViewer 视觉对比探针 — Ink & Green 主题（因屏幕高度限制，单独渲染）
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const LOG = path.join(__dirname, 'probe-viewer-run2.log')
function log(m) { fs.appendFileSync(LOG, m + '\n') }
fs.writeFileSync(LOG, 'start ' + new Date().toISOString() + '\n')

app.commandLine.appendSwitch('use-gl', 'swiftshader')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('no-sandbox')

app.whenReady().then(async () => {
  log('ready')
  const w = new BrowserWindow({
    width: 860,
    height: 1180,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: { backgroundThrottling: false, sandbox: false }
  })
  await w.loadFile(path.join(__dirname, 'probe-viewer.html'))
  log('loaded')

  // 只显示 Ink & Green 两行，隐藏 Light/Dark
  await w.webContents.executeJavaScript(`
    (function(){
      var hs = document.querySelectorAll('h2');
      for (var i = 2; i < hs.length; i++) {
        var h = hs[i];
        h.style.display = 'block';
        if (h.nextElementSibling) h.nextElementSibling.style.display = 'flex';
      }
      for (var j = 0; j < 2 && j < hs.length; j++) {
        hs[j].style.display = 'none';
        if (hs[j].nextElementSibling) hs[j].nextElementSibling.style.display = 'none';
      }
    })()
  `)

  await new Promise(r => setTimeout(r, 1200))

  try {
    const img = await w.capturePage()
    const buf = img.toPNG()
    fs.writeFileSync(path.join(__dirname, 'probe-viewer-ig.png'), buf)
    log('saved bytes=' + buf.length)
  } catch (e) {
    log('capture err: ' + e.message)
  }

  app.quit()
})
