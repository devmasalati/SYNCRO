"use client"

import { createContext, useContext, useState, useEffect, useCallback } from "react"
import { type Currency, DEFAULT_CURRENCY } from "@/lib/currency-utils"
import { DEFAULT_TIMEZONE, getUserTimezone } from "@/lib/timezone-utils"
import { fetchUserPreferences, updateUserPreferences } from "@/lib/api/user-preferences"

interface UserSettings {
  currency: Currency
  timezone: string
  locale: string
}

interface UserSettingsContextType {
  settings: UserSettings
  updateSettings: (updates: Partial<UserSettings>) => Promise<void>
  isLoading: boolean
}

const UserSettingsContext = createContext<UserSettingsContextType | undefined>(undefined)

export function UserSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>({
    currency: DEFAULT_CURRENCY,
    timezone: DEFAULT_TIMEZONE,
    locale: "en-US",
  })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadSettings() {
      try {
        const prefs = await fetchUserPreferences()
        if (prefs) {
          setSettings({
            currency: (prefs as any).currency || DEFAULT_CURRENCY,
            timezone: prefs.quiet_hours_timezone || getUserTimezone() || DEFAULT_TIMEZONE,
            locale: (prefs as any).locale || "en-US",
          })
        }
      } catch (error) {
        console.error("Failed to load user settings:", error)
        // Fallback to browser timezone
        setSettings(prev => ({
          ...prev,
          timezone: getUserTimezone() || DEFAULT_TIMEZONE
        }))
      } finally {
        setIsLoading(false)
      }
    }
    loadSettings()
  }, [])

  const updateSettings = useCallback(async (updates: Partial<UserSettings>) => {
    // Optimistic update
    setSettings((prev) => ({ ...prev, ...updates }))

    try {
      await updateUserPreferences({
        // Map UI settings to backend preference fields
        // Since we are adding currency and timezone to user_preferences
        ...(updates.currency && { currency: updates.currency }),
        ...(updates.timezone && { quiet_hours_timezone: updates.timezone }),
        ...(updates.locale && { locale: updates.locale }),
      } as any)
    } catch (error) {
      console.error("Failed to persist user settings:", error)
      // Revert on error if necessary, or just log
    }
  }, [])

  return (
    <UserSettingsContext.Provider value={{ settings, updateSettings, isLoading }}>
      {children}
    </UserSettingsContext.Provider>
  )
}

export function useUserSettings() {
  const context = useContext(UserSettingsContext)
  if (context === undefined) {
    throw new Error("useUserSettings must be used within a UserSettingsProvider")
  }
  return context
}
