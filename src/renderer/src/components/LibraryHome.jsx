// 图书馆主页：居中展示全部阅览室（工作目录）的图文卡片列表。
// 数据层级：图书馆（本页）- 阅览室（工作目录）- 书籍。
// 每张卡片：封面图（目录内 bg.png 优先，其次 bg.jpg，均无则展示目录名首字）+ 目录名。
// 由 App 传入已加载好封面的 rooms 数组；点击卡片进入对应阅览室。
export default function LibraryHome({ rooms = [], activeDir, onOpenRoom }) {
  return (
    <div className="library-home">
      {rooms.length === 0 ? (
        <div className="library-empty">
          图书馆还是空的：点击右上角设置 → 「打开工作目录」添加第一个阅览室。
        </div>
      ) : (
        <div className="library-grid">
          {rooms.map((room) => {
            const first = [...(room.name || '')][0] || '?'
            return (
              <button
                key={room.path}
                className={`room-card ${room.path === activeDir ? 'current' : ''}`}
                onClick={() => onOpenRoom(room.path)}
                title={room.path}
              >
                <div className="room-cover">
                  {room.cover ? (
                    <img src={room.cover} alt={room.name} draggable="false" />
                  ) : (
                    <span className="room-fallback">{first}</span>
                  )}
                </div>
                <div className="room-name">{room.name}</div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
