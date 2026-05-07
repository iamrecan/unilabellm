import { useState } from 'react'
import { filesystemApi } from '../api/client'
import { FolderBrowser } from './FolderBrowser'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onRemove?: () => void
  mode?: 'folder' | 'file'
  fileExtensions?: string[]
}

export function PathInput({ value, onChange, placeholder, onRemove, mode = 'folder', fileExtensions }: Props) {
  const [browserOpen, setBrowserOpen] = useState(false)
  const [picking, setPicking] = useState(false)

  const handleNativePick = async () => {
    // File mode: always use in-browser picker (no native file picker support)
    if (mode === 'file') { setBrowserOpen(true); return }

    setPicking(true)
    try {
      const { path, available } = await filesystemApi.pickFolder(value || undefined)
      if (!available) {
        setBrowserOpen(true)
      } else if (path) {
        onChange(path)
      }
    } catch {
      setBrowserOpen(true)
    } finally {
      setPicking(false)
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input
          value={value}
          placeholder={placeholder ?? '/path/to/dataset'}
          onChange={e => onChange(e.target.value)}
          style={{ flex: 1, fontFamily: 'monospace', fontSize: 13 }}
        />
        <button
          className="btn btn-ghost"
          style={{ padding: '6px 12px', fontSize: 13, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}
          onClick={handleNativePick}
          disabled={picking}
          title="Browse for folder"
        >
          {picking ? '…' : '📂 Browse'}
        </button>
        {onRemove && (
          <button
            className="btn btn-ghost"
            style={{ padding: '4px 10px' }}
            onClick={onRemove}
          >✕</button>
        )}
      </div>

      {browserOpen && (
        <FolderBrowser
          initialPath={value || undefined}
          onSelect={path => { onChange(path); setBrowserOpen(false) }}
          onClose={() => setBrowserOpen(false)}
          mode={mode}
          fileExtensions={fileExtensions}
        />
      )}
    </>
  )
}
