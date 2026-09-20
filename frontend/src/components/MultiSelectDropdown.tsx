import { useEffect, useRef, useState } from 'react'

interface Props {
  label: string
  options: string[]
  selected: string[]
  onChange: (values: string[]) => void
}

export default function MultiSelectDropdown({ label, options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-[9rem] items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
      >
        <span>{label}</span>
        <span className="rounded-full bg-brand-100 px-1.5 text-xs text-brand-700">
          {selected.length > 0 ? selected.length : 'All'}
        </span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          {options.length === 0 && <div className="px-2 py-1 text-xs text-slate-400">No options</div>}
          {options.map((opt) => (
            <label key={opt} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="rounded text-brand-600" />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
