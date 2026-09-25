import { Select } from './ui'
import { CITIES } from '../data/chapters'

export const FILTER_DEFAULTS = { city: 'All', mode: 'All', date: 'All', source: 'All' }

const CITY_OPTS = ['All', ...CITIES, 'Online', 'Other cities'].map((c) => ({ value: c, label: c === 'All' ? 'All cities' : c }))
const MODE_OPTS = [
  { value: 'All', label: 'All modes' },
  { value: 'Online', label: 'Online' },
  { value: 'In-person', label: 'In-person' },
]
const DATE_OPTS = [
  { value: 'All', label: 'Any date' },
  { value: 'This Week', label: 'This Week' },
  { value: 'This Month', label: 'This Month' },
  { value: 'Upcoming', label: 'Upcoming' },
]
const SOURCE_OPTS = [
  { value: 'All', label: 'All sources' },
  { value: 'codefolio', label: 'Bookable on Codefolio' },
  { value: 'gdg', label: 'Live · GDG Community' },
  { value: 'devfolio', label: 'Live · Devfolio' },
]

export default function EventFilters({ values, onChange, layout = 'row' }) {
  const set = (k) => (e) => onChange({ ...values, [k]: e.target.value })
  return (
    <div className={`filters filters--${layout}`}>
      <Select label="City" value={values.city} onChange={set('city')} options={CITY_OPTS} />
      <Select label="Mode" value={values.mode} onChange={set('mode')} options={MODE_OPTS} />
      <Select label="Date" value={values.date} onChange={set('date')} options={DATE_OPTS} />
      <Select label="Source" value={values.source} onChange={set('source')} options={SOURCE_OPTS} />
    </div>
  )
}
