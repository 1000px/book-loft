// 按当前阅读主题生成标注配色。
// - 高亮：每种主题 5 种，背景半透明保证可读、文本保持对比度；色相错开避免相似。
// - 划线：每种主题 2 种"主色"，分别对应实线 / 虚线（颜色一致，线型不同即可区分）。
//
// 返回：{ highlights: [{ key, bg, fg }], underlineSolid, underlineDashed }
// - key 用于持久化 style（与主题无关的稳定 id），色值随主题变化
// - 渲染层在创建标注时落库 { style: key, color: bg }，恢复时按当前主题重新算色值
//   （不做主题感知：色值已是绝对 rgba，重启后用主题色覆盖可换肤）

const PALETTES = {
  light: {
    highlights: [
      { key: 'c1', bg: 'rgba(255, 213,  79, 0.55)', fg: '#3b2f00' }, // 琥珀
      { key: 'c2', bg: 'rgba(255, 138, 101, 0.50)', fg: '#5a1f00' }, // 珊瑚
      { key: 'c3', bg: 'rgba(129, 199, 132, 0.55)', fg: '#0d3a13' }, // 草绿
      { key: 'c4', bg: 'rgba(100, 181, 246, 0.55)', fg: '#0a2f66' }, // 天蓝
      { key: 'c5', bg: 'rgba(186, 104, 200, 0.50)', fg: '#3a0a4d' }  // 紫罗兰
    ],
    underlineSolid:   'rgba(217, 119,   6, 0.95)', // 琥珀
    underlineDashed:  'rgba(192,  38,  79, 0.95)'  // 玫红
  },
  green: {
    highlights: [
      { key: 'c1', bg: 'rgba(255, 213,  79, 0.65)', fg: '#3b2f00' },
      { key: 'c2', bg: 'rgba(239, 154, 154, 0.60)', fg: '#5a1f1f' },
      { key: 'c3', bg: 'rgba(174, 213, 129, 0.65)', fg: '#1d3a0a' },
      { key: 'c4', bg: 'rgba(128, 203, 196, 0.65)', fg: '#0d3a3a' },
      { key: 'c5', bg: 'rgba(202, 169, 221, 0.60)', fg: '#321a4d' }
    ],
    underlineSolid:   'rgba(217, 119,   6, 0.95)',
    underlineDashed:  'rgba(160,  46,  46, 0.95)'
  },
  dark: {
    highlights: [
      { key: 'c1', bg: 'rgba(255, 202,  87, 0.35)', fg: '#ffe07a' },
      { key: 'c2', bg: 'rgba(239, 154, 154, 0.32)', fg: '#ffb4ad' },
      { key: 'c3', bg: 'rgba(129, 199, 132, 0.32)', fg: '#b6e2b8' },
      { key: 'c4', bg: 'rgba(100, 181, 246, 0.32)', fg: '#a8caf6' },
      { key: 'c5', bg: 'rgba(186, 104, 200, 0.32)', fg: '#d6a8e6' }
    ],
    underlineSolid:   'rgba(255, 202,  87, 0.95)',
    underlineDashed:  'rgba(239, 154, 154, 0.95)'
  },
  ink: {
    highlights: [
      { key: 'c1', bg: 'rgba(232, 184,  77, 0.55)', fg: '#3a2a06' },
      { key: 'c2', bg: 'rgba(199, 110,  86, 0.55)', fg: '#4a1a0a' },
      { key: 'c3', bg: 'rgba(118, 153,  92, 0.55)', fg: '#1f3a14' },
      { key: 'c4', bg: 'rgba( 96, 138, 196, 0.55)', fg: '#0f2a4d' },
      { key: 'c5', bg: 'rgba(154, 110, 174, 0.55)', fg: '#2f124d' }
    ],
    underlineSolid:   'rgba(192, 102,  20, 0.95)',
    underlineDashed:  'rgba(160,  44,  56, 0.95)'
  }
}

export function getAnnotationPalette(theme) {
  return PALETTES[theme] || PALETTES.light
}

// 标注 / 笔记 图标与下划线的主色：4 个主题各一组，明色/暗色背景都保持对比度。
// - annotation：琥珀系
// - note：蓝色系（与标注区分）
const MARKER_COLORS = {
  light: { annotation: '#d97706', note: '#1976d2' },
  green: { annotation: '#a16207', note: '#1d4ed8' },
  dark:  { annotation: '#fbbf24', note: '#60a5fa' },
  ink:   { annotation: '#c2410c', note: '#1e40af' }
}

export function getAnnotationMarkerColors(theme) {
  return MARKER_COLORS[theme] || MARKER_COLORS.light
}
