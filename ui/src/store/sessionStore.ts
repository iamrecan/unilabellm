import { useState, useCallback } from 'react'
import { HarmonizationSession, CanonicalClass, sessionsApi } from '../api/client'

export function useSessionStore() {
  const [sessions, setSessions] = useState<HarmonizationSession[]>([])
  const [activeSession, setActiveSession] = useState<HarmonizationSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSessions = useCallback(async () => {
    setLoading(true)
    try {
      const data = await sessionsApi.list()
      setSessions(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const openSession = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const data = await sessionsApi.get(id)
      setActiveSession(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const updateClasses = useCallback(async (classes: CanonicalClass[]) => {
    if (!activeSession) return
    const updated = await sessionsApi.updateClasses(activeSession.id, classes)
    setActiveSession(updated)
  }, [activeSession])

  const confirmSession = useCallback(async () => {
    if (!activeSession) return null
    const updated = await sessionsApi.confirm(activeSession.id)
    setActiveSession(updated)
    return updated
  }, [activeSession])

  return {
    sessions, activeSession, loading, error,
    loadSessions, openSession, updateClasses, confirmSession,
    setActiveSession,
  }
}
