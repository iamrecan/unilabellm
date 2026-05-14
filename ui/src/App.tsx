import { useEffect, useState, useCallback } from 'react'
import { CanonicalClass, HarmonizationSession, ImageValidationResult, sessionsApi } from './api/client'
import { AddSourcePanel } from './components/AddSourcePanel'
import { ExportPanel } from './components/ExportPanel'
import { HarmonizationView } from './components/HarmonizationView'
import { InferencePanel } from './components/InferencePanel'
import { NewSessionForm } from './components/NewSessionForm'
import { SampleViewer } from './components/SampleViewer'
import { SessionList } from './components/SessionList'
import { ValidationPanel } from './components/ValidationPanel'

type View = 'list' | 'new' | 'session' | 'inference'

const STATUS_DOT: Record<string, string> = {
  pending:   '#f5a623',
  reviewing: '#0070f3',
  confirmed: '#50e3c2',
  exported:  '#444',
}

export default function App() {
  const [view, setView]                   = useState<View>('list')
  const [sessions, setSessions]           = useState<HarmonizationSession[]>([])
  const [activeSession, setActiveSession] = useState<HarmonizationSession | null>(null)
  const [classes, setClasses]             = useState<CanonicalClass[]>([])
  const [confirming, setConfirming]           = useState(false)
  const [saveStatus, setSaveStatus]           = useState<'saved' | 'error' | null>(null)
  const [validationResults, setValidationResults] = useState<ImageValidationResult[]>([])
  const [validationThreshold, setValidationThreshold] = useState(0.25)

  const loadSessions = useCallback(async () => {
    try { setSessions(await sessionsApi.list()) } catch {}
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  const openSession = async (id: string) => {
    const s = await sessionsApi.get(id)
    setActiveSession(s)
    setClasses(s.canonical_classes)
    setValidationResults([])
    setView('session')
  }

  const handleClassesChange = useCallback(async (updated: CanonicalClass[]) => {
    setClasses(updated)
    if (!activeSession) return
    try {
      await sessionsApi.updateClasses(activeSession.id, updated)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(null), 2000)
    } catch { setSaveStatus('error') }
  }, [activeSession])

  const handleConfirm = async () => {
    if (!activeSession) return
    setConfirming(true)
    try {
      const updated = await sessionsApi.confirm(activeSession.id)
      setActiveSession(updated)
      loadSessions()
    } catch (e: any) {
      alert(e.response?.data?.detail ?? e.message)
    } finally { setConfirming(false) }
  }

  const handleSourceAdded = (updated: HarmonizationSession) => {
    setActiveSession(updated)
    setClasses(updated.canonical_classes)
    loadSessions()
  }

  const goList = () => { setView('list'); loadSessions() }

  const dotColor = activeSession ? (STATUS_DOT[activeSession.status] ?? '#444') : '#444'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>

      {/* ── Nav ── */}
      <nav style={{
        height: 64,
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: 0,
        position: 'sticky',
        top: 0,
        background: 'rgba(0,0,0,0.8)',
        backdropFilter: 'blur(12px)',
        zIndex: 100,
      }}>
        {/* Wordmark */}
        <span
          onClick={goList}
          style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em', cursor: 'pointer', color: 'var(--text)', userSelect: 'none' }}
        >
          unilabellm
        </span>

        {/* Test Model nav link */}
        <button
          onClick={() => setView('inference')}
          style={{
            marginLeft: 'auto', background: 'none', fontSize: 13,
            color: view === 'inference' ? 'var(--text)' : 'var(--text-dim)',
            padding: '4px 10px', borderRadius: 'var(--radius)',
            border: view === 'inference' ? '1px solid var(--border)' : '1px solid transparent',
          }}
        >
          ▶ Test Model
        </button>

        {/* Breadcrumb */}
        {view === 'session' && activeSession && (
          <>
            <span style={{ color: 'var(--text-muted)', margin: '0 10px', fontSize: 18, fontWeight: 300 }}>/</span>
            <button onClick={goList} style={{ background: 'none', color: 'var(--text-dim)', fontSize: 13, padding: 0, height: 'auto' }}>
              Sessions
            </button>
            <span style={{ color: 'var(--text-muted)', margin: '0 10px', fontSize: 18, fontWeight: 300 }}>/</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-dim)' }}>
              {activeSession.id.slice(0, 8)}
            </span>

            {/* Status */}
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12, fontSize: 12, color: 'var(--text-dim)' }}>
              <span className="status-dot" style={{ background: dotColor }} />
              {activeSession.status}
            </span>

            {/* Autosave indicator */}
            {saveStatus && (
              <span style={{ marginLeft: 'auto', fontSize: 12, color: saveStatus === 'saved' ? 'var(--green)' : 'var(--red)' }}>
                {saveStatus === 'saved' ? 'Saved' : 'Save failed'}
              </span>
            )}
          </>
        )}

        {view === 'new' && (
          <>
            <span style={{ color: 'var(--text-muted)', margin: '0 10px', fontSize: 18, fontWeight: 300 }}>/</span>
            <button onClick={goList} style={{ background: 'none', color: 'var(--text-dim)', fontSize: 13, padding: 0, height: 'auto' }}>
              Sessions
            </button>
            <span style={{ color: 'var(--text-muted)', margin: '0 10px', fontSize: 18, fontWeight: 300 }}>/</span>
            <span style={{ fontSize: 13, color: 'var(--text)' }}>New</span>
          </>
        )}
      </nav>

      {/* ── Content ── */}
      <main style={{ flex: 1, maxWidth: 1100, width: '100%', margin: '0 auto', padding: '40px 24px' }}>

        {view === 'list' && (
          <SessionList sessions={sessions} onSelect={openSession} onNew={() => setView('new')} />
        )}

        {view === 'new' && (
          <NewSessionForm onCreated={async id => { await loadSessions(); openSession(id) }} />
        )}

        {view === 'inference' && <InferencePanel />}

        {view === 'session' && activeSession && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 32, alignItems: 'start' }}>

            <HarmonizationView
              classes={classes}
              onChange={handleClassesChange}
              onConfirm={handleConfirm}
              confirming={confirming}
              readOnly={activeSession.status === 'confirmed' || activeSession.status === 'exported'}
            />

            {/* Sidebar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

              {/* Sources */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Sources
                  </span>
                </div>
                {activeSession.sources.map((src, i) => (
                  <div
                    key={src.name}
                    style={{
                      padding: '12px 16px',
                      borderBottom: i < activeSession.sources.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{src.name}</span>
                      <span style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 4,
                        border: '1px solid var(--border)',
                        color: 'var(--text-dim)',
                        background: 'var(--surface2)',
                      }}>
                        {src.format.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                      {src.image_count.toLocaleString()} images · {src.classes.length} classes
                    </div>
                  </div>
                ))}
              </div>

              <AddSourcePanel sessionId={activeSession.id} onAdded={handleSourceAdded} />

              {/* CLIP Validation */}
              {activeSession.status !== 'pending' && (
                <div style={{ marginTop: 12 }}>
                  <ValidationPanel
                    sessionId={activeSession.id}
                    onResultsReady={(results, threshold) => {
                      setValidationResults(results)
                      setValidationThreshold(threshold)
                    }}
                  />
                </div>
              )}

              {/* Label preview — available in reviewing + confirmed + exported */}
              {activeSession.status !== 'pending' && (
                <div style={{ marginTop: 12 }}>
                  <SampleViewer
                    sessionId={activeSession.id}
                    classNames={activeSession.canonical_classes.map(c => c.name)}
                    validationResults={validationResults}
                    validationThreshold={validationThreshold}
                  />
                </div>
              )}

              {/* Export */}
              {(activeSession.status === 'confirmed' || activeSession.status === 'exported') && (
                <div style={{ marginTop: 12 }}>
                  <ExportPanel sessionId={activeSession.id} onExported={loadSessions} />
                </div>
              )}
            </div>

          </div>
        )}
      </main>
    </div>
  )
}
