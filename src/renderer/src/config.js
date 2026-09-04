// 阅读器全局配置常量

// 正文字号（px），用于 Toolbar 的字体放大/缩小与 Reader 的主题注册
export const FONT_SIZE_DEFAULT = 16
export const FONT_SIZE_MIN = 14
export const FONT_SIZE_MAX = 28
export const FONT_SIZE_STEP = 2

// 阅读主题：循环切换顺序与显示名
// light=浅色系 / green=保护色（豆沙绿护眼） / dark=深色系 / ink=水墨（Kindle 纸质书感）
export const THEME_ORDER = ['light', 'green', 'dark', 'ink']
export const THEME_LABELS = {
  light: '浅色',
  green: '护眼',
  dark: '夜间',
  ink: '水墨'
}
