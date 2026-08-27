import { Navigate, Route, Routes } from 'react-router-dom'
import { OnboardingGate } from './components/onboarding/OnboardingFlow'
import { StudioShell } from './components/StudioShell'
import { DesignProfilesProvider } from './hooks/useDesignProfiles'
import { LibraryProvider } from './hooks/useLibrary'
import { PrefsProvider } from './hooks/usePrefs'
import { CollectionPage } from './pages/CollectionPage'
import { CapabilityGapsPage } from './pages/CapabilityGapsPage'
import { DesignListPage } from './pages/DesignListPage'
import { DesignProfilePage } from './pages/DesignProfilePage'
import { LibraryPage } from './pages/LibraryPage'
import { McpConnectPage } from './pages/McpConnectPage'
import { TeamToolsPage } from './pages/TeamToolsPage'
import { SettingsPage } from './pages/SettingsPage'
import { ToolDetailPage } from './pages/ToolDetailPage'
import { ToolFormPage } from './pages/ToolFormPage'

export default function App() {
  return (
    <PrefsProvider>
      <LibraryProvider>
        <DesignProfilesProvider>
        <OnboardingGate>
          <StudioShell>
          <Routes>
            <Route path="/" element={<LibraryPage mode="all" />} />
            <Route path="/favorites" element={<LibraryPage mode="favorites" />} />
            <Route path="/running" element={<LibraryPage mode="running" />} />
            <Route path="/recent" element={<LibraryPage mode="recent" />} />
            <Route path="/gaps" element={<CapabilityGapsPage />} />
            <Route path="/tags/:tag" element={<LibraryPage mode="tag" />} />
            <Route path="/collections/:collectionId" element={<CollectionPage />} />
            <Route path="/design" element={<DesignListPage />} />
            <Route path="/design/:id" element={<DesignProfilePage />} />
            <Route path="/team" element={<TeamToolsPage />} />
            <Route path="/mcp" element={<McpConnectPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/tools/new" element={<ToolFormPage />} />
            <Route path="/tools/:id" element={<ToolDetailPage />} />
            <Route path="/tools/:id/edit" element={<ToolFormPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </StudioShell>
        </OnboardingGate>
        </DesignProfilesProvider>
      </LibraryProvider>
    </PrefsProvider>
  )
}
