/**
 * 軽量 SVG バーチャート（外部ライブラリ不使用）
 *
 * 直近 N 日の数値推移をシンプルなバーで描画する。
 */

export interface BarDatum {
  label: string // 表示ラベル（例: '5/1'）
  value: number
  meta?: string // ホバー時の追加情報
}

interface Props {
  data: BarDatum[]
  height?: number
  color?: string
  showValues?: boolean
  unit?: string
  emptyText?: string
}

export default function MiniBarChart({
  data,
  height = 120,
  color = 'rgb(15, 23, 42)',
  showValues = false,
  unit = '',
  emptyText = 'データなし',
}: Props) {
  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-slate-400" style={{ height }}>
        {emptyText}
      </div>
    )
  }

  const max = Math.max(...data.map((d) => d.value), 1)
  const barCount = data.length
  const gap = 2
  const totalGap = gap * (barCount - 1)

  return (
    <div className="w-full" style={{ height }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${barCount * 10} 100`} preserveAspectRatio="none">
        {data.map((d, i) => {
          const barHeight = Math.max(((d.value / max) * 100 * 0.9), d.value > 0 ? 1 : 0)
          const x = (i * (10 + gap)) - (i > 0 ? gap : 0)
          const width = (1000 - totalGap) / barCount / 100
          return (
            <g key={i}>
              <rect
                x={(i * (100 / barCount)) + (gap / 2)}
                y={100 - barHeight}
                width={(100 / barCount) - gap}
                height={barHeight}
                fill={color}
                opacity={0.85}
              >
                <title>{`${d.label}: ${d.value}${unit}${d.meta ? ` (${d.meta})` : ''}`}</title>
              </rect>
              {/* x スケール用透明 spacer */}
              <rect x={x} y={0} width={width} height={0} fill="transparent" />
            </g>
          )
        })}
      </svg>
      <div className="flex justify-between mt-1.5 px-1 text-[10px] text-slate-400">
        <span>{data[0]?.label}</span>
        {data.length > 4 && <span>{data[Math.floor(data.length / 2)]?.label}</span>}
        <span>{data[data.length - 1]?.label}</span>
      </div>
      {showValues && (
        <div className="text-[10px] text-slate-500 mt-1 text-right">
          最大 {max}{unit}
        </div>
      )}
    </div>
  )
}
