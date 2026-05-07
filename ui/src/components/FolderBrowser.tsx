import { useEffect, useState } from 'react'
import { BrowseResponse, DirEntry, filesystemApi } from '../api/client'

interface Props {
  initialPath?: string
  onSelect: (path: string) => void
  onClose: () => void
  /** 'folder' (default) = select directories  |  'file' = select individual files */
  mode?: 'folder' | 'file'
  /** only show/allow these extensions in file mode, e.g. ['.pt', '.jpg'] */
  fileExtensions?: string[]
}

export function FolderBrowser({ initialPath, onSelect, onClose, mode = 'folder', fileExtensions }: Props) {
  const [browse, setBrowse] = useState<BrowseResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const navigate = async (path?: string) => {
    setLoading(true)
    setError(null)
    setSelected(null)
    try {
      const data = await filesystemApi.browse(path)
      setBrowse(data)
    } catch (e: any) {
      setError(e.response?.data?.detail ?? e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { navigate(initialPath) }, [])

  // Breadcrumb parts
  const breadcrumbs = browse
    ? browse.path.split('/').filter(Boolean).reduce<{ label: string; path: string }[]>((acc, part, i, arr) => {
        const path = '/' + arr.slice(0, i + 1).join('/')
        acc.push({ label: part, path })
        return acc
      }, [{ label: '/', path: '/' }])
    : []

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.65)', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, width: 600, maxHeight: '75vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>
            {mode === 'file' ? `Select File${fileExtensions ? ` (${fileExtensions.join(', ')})` : ''}` : 'Select Dataset Folder'}
          </span>
          <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onClose}>✕</button>
        </div>

        {/* Breadcrumb */}
        <div style={{ padding: '8px 18px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
          {breadcrumbs.map((bc, i) => (
            <span key={bc.path} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {i > 0 && <span style={{ opacity: 0.4, margin: '0 2px' }}>/</span>}
              <button
                onClick={() => navigate(bc.path)}
                style={{
                  background: 'none', color: i === breadcrumbs.length - 1 ? 'var(--text)' : 'var(--accent)',
                  fontWeight: i === breadcrumbs.length - 1 ? 600 : 400,
                  padding: '1px 3px', borderRadius: 4, fontSize: 12,
                }}
              >
                {bc.label}
              </button>
            </span>
          ))}
        </div>

        {/* File list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
          {loading && (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>Loading…</div>
          )}
          {error && (
            <div style={{ color: 'var(--red)', padding: '12px 8px', fontSize: 13 }}>{error}</div>
          )}
          {!loading && browse && (
            <>
              {browse.parent && (
                <FolderRow
                  entry={{ name: '..', path: browse.parent, is_dir: true, is_dataset: false }}
                  selected={false}
                  onClick={() => navigate(browse.parent!)}
                  isParent
                />
              )}
              {browse.entries.length === 0 && (
                <div style={{ color: 'var(--text-dim)', padding: '20px 8px', fontSize: 13 }}>Empty folder</div>
              )}
              {browse.entries
                // In file mode: show dirs + matching files; in folder mode: show dirs + datasets only
                .filter(entry => {
                  if (entry.is_dir) return true
                  if (mode === 'file') {
                    if (!fileExtensions) return true
                    const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
                    return fileExtensions.includes(ext)
                  }
                  return false  // hide plain files in folder mode
                })
                .map(entry => (
                  <FolderRow
                    key={entry.path}
                    entry={entry}
                    selected={selected === entry.path}
                    onClick={() => {
                      if (entry.is_dir) {
                        if (mode === 'folder') setSelected(entry.path)
                        navigate(entry.path)
                      } else {
                        // file mode: click selects the file
                        setSelected(entry.path)
                      }
                    }}
                    onDoubleClick={() => {
                      if (entry.is_dir) navigate(entry.path)
                      else onSelect(entry.path)  // double-click file = confirm
                    }}
                    isFile={!entry.is_dir}
                  />
                ))}
            </>
          )}
        </div>

        {/* Selected path + actions */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10, fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {selected
              ? <><span style={{ color: 'var(--green)' }}>✓</span> {selected}</>
              : browse
                ? <span style={{ opacity: 0.5 }}>
                    {mode === 'file' ? 'Click a file to select it' : `Or use current folder: ${browse.path}`}
                  </span>
                : null
            }
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            {mode === 'folder' && (
              <button
                className="btn btn-primary"
                onClick={() => onSelect(selected ?? browse?.path ?? '')}
                disabled={!browse}
              >
                Select{selected ? '' : ' Current Folder'}
              </button>
            )}
            {mode === 'file' && (
              <button
                className="btn btn-primary"
                onClick={() => selected && onSelect(selected)}
                disabled={!selected}
              >
                Select File
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface RowProps {
  entry: DirEntry
  selected: boolean
  onClick: () => void
  onDoubleClick?: () => void
  isParent?: boolean
  isFile?: boolean
}

function FolderRow({ entry, selected, onClick, onDoubleClick, isParent, isFile }: RowProps) {
  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
        background: selected ? 'var(--accent-dim)' : 'transparent',
        border: `1px solid ${selected ? 'var(--accent)' : 'transparent'}`,
        transition: 'background 0.1s',
        marginBottom: 2,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--surface2)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>
        {isParent ? '↑' : entry.is_dataset ? '📂' : entry.is_dir ? '📁'
          : entry.name.endsWith('.pt') || entry.name.endsWith('.onnx') ? '🤖'
          : entry.name.match(/\.(jpg|jpeg|png|bmp|webp)$/i) ? '🖼️'
          : '📄'}
      </span>
      <span style={{ flex: 1, fontSize: 13, fontFamily: isParent ? 'inherit' : 'monospace' }}>
        {isParent ? 'Parent directory' : entry.name}
      </span>
      {entry.is_dataset && (
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 12,
          background: 'var(--green)22', color: 'var(--green)',
          border: '1px solid var(--green)44',
        }}>
          YOLO dataset
        </span>
      )}
      {entry.is_dir && !isParent && (
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>›</span>
      )}
      {isFile && selected && (
        <span style={{ color: 'var(--green)', fontSize: 12 }}>✓</span>
      )}
    </div>
  )
}
