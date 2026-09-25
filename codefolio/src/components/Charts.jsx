import { useState } from 'react'
import Icon from './Icon'

// Single-series bar charts (one hue, no legend needed: the title names the series).
// Each bar is focusable and shows a tooltip on hover/focus; a table view is one click away.

function ChartFrame({ title, subtitle, rows, valueLabel, children }) {
  const [asTable, setAsTable] = useState(false)
  return (
    <figure className="chart card">
      <figcaption className="chart__head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        <button className="chip" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}>
          <Icon name={asTable ? 'bar' : 'table'} size={14} /> {asTable ? 'Chart' : 'Table'}
        </button>
      </figcaption>
      {asTable ? (
        <table className="chart__table">
          <thead>
            <tr>
              <th scope="col">Label</th>
              <th scope="col">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        children
      )}
    </figure>
  )
}

const niceMax = (v) => {
  if (v <= 5) return 5
  const p = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / p) * p
}

export function ColumnChart({ title, subtitle, data, valueLabel = 'Value' }) {
  const [hover, setHover] = useState(null)
  const max = niceMax(Math.max(...data.map((d) => d.value), 1))
  const ticks = [0, max / 2, max]
  return (
    <ChartFrame title={title} subtitle={subtitle} rows={data} valueLabel={valueLabel}>
      <div className="colchart" role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}>
        <div className="colchart__grid" aria-hidden="true">
          {ticks
            .slice()
            .reverse()
            .map((t) => (
              <span key={t}>
                <em>{t}</em>
              </span>
            ))}
        </div>
        <div className="colchart__bars">
          {data.map((d, i) => (
            <div
              key={d.label}
              className="colchart__col"
              tabIndex={0}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${d.label}: ${d.value} ${valueLabel.toLowerCase()}`}
            >
              <div className="colchart__track">
                <span className={`colchart__bar ${hover === i ? 'is-hover' : ''}`} style={{ height: `${(d.value / max) * 100}%` }} />
                {hover === i && (
                  <span className="chart-tip" role="tooltip" style={{ bottom: `calc(${(d.value / max) * 100}% + 8px)` }}>
                    <strong>{d.value}</strong> {valueLabel.toLowerCase()}
                    <small>{d.full || d.label}</small>
                  </span>
                )}
              </div>
              <span className="colchart__label">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
    </ChartFrame>
  )
}

export function BarList({ title, subtitle, data, valueLabel = 'Value' }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <ChartFrame title={title} subtitle={subtitle} rows={data} valueLabel={valueLabel}>
      <ul className="barlist">
        {data.map((d, i) => (
          <li
            key={d.label}
            tabIndex={0}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            className={hover === i ? 'is-hover' : undefined}
          >
            <span className="barlist__label">{d.label}</span>
            <span className="barlist__track">
              <span className="barlist__bar" style={{ width: `${(d.value / max) * 100}%` }} />
            </span>
            <span className="barlist__value">{d.value}</span>
          </li>
        ))}
      </ul>
    </ChartFrame>
  )
}
