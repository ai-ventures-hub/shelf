import { AppUpdateProvider } from './hooks/useAppUpdate'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { OnboardingGate } from './components/onboarding/OnboardingFlow'
import { StudioShell } from './components/StudioShell'
import { DesignProfilesProvider } from './hooks/useDesignProfiles'
import { LibraryProvider } from './hooks/useLibrary'
import { PrefsProvider } from './hooks/usePrefs'
const CollectionPage = lazy(() => import('./pages/CollectionPage').then((module) => ({ default: module.CollectionPage })))
const CapabilityGapsPage = lazy(() => import('./pages/CapabilityGapsPage').then((module) => ({ default: module.CapabilityGapsPage })))
const DesignListPage = lazy(() => import('./pages/DesignListPage').then((module) => ({ default: module.DesignListPage })))
const DesignProfilePage = lazy(() => import('./pages/DesignProfilePage').then((module) => ({ default: module.DesignProfilePage })))
import { LibraryPage } from './pages/LibraryPage'
const McpConnectPage = lazy(() => import('./pages/McpConnectPage').then((module) => ({ default: module.McpConnectPage })))
const TeamToolsPage = lazy(() => import('./pages/TeamToolsPage').then((module) => ({ default: module.TeamToolsPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const VerificationPage = lazy(() => import('./pages/VerificationPage').then((module) => ({ default: module.VerificationPage })))
const ProjectContextPage = lazy(() => import('./pages/ProjectContextPage').then((module) => ({ default: module.ProjectContextPage })))
const ToolDetailPage = lazy(() => import('./pages/ToolDetailPage').then((module) => ({ default: module.ToolDetailPage })))
const ToolFormPage = lazy(() => import('./pages/ToolFormPage').then((module) => ({ default: module.ToolFormPage })))

const AddProjectPage = lazy(() => import('./pages/AddProjectPage').then((module) => ({ default: module.AddProjectPage })))
const MorningBoardPage = lazy(() => import('./pages/MorningBoardPage').then((module) => ({ default: module.MorningBoardPage })))
const DraftToolsPage = lazy(() => import('./pages/DraftToolsPage').then((module) => ({ default: module.DraftToolsPage })))

export default function App() {
  return (
    <PrefsProvider>
      <AppUpdateProvider>
      <LibraryProvider>
        <DesignProfilesProvider>
        <OnboardingGate>
          <StudioShell>
          <Suspense fallback={<p role="status">Loading page…</p>}><Routes>
            <Route path="/" element={<LibraryPage mode="all" />} />
            <Route path="/favorites" element={<LibraryPage mode="favorites" />} />
            <Route path="/running" element={<LibraryPage mode="running" />} />
            <Route path="/recent" element={<LibraryPage mode="recent" />} />
            <Route path="/activity" element={<MorningBoardPage />} />
            <Route path="/drafts" element={<DraftToolsPage />} />
            <Route path="/gaps" element={<CapabilityGapsPage />} />
            <Route path="/tags/:tag" element={<LibraryPage mode="tag" />} />
            <Route path="/collections/:collectionId" element={<CollectionPage />} />
            <Route path="/design" element={<DesignListPage />} />
            <Route path="/design/:id" element={<DesignProfilePage />} />
            <Route path="/team" element={<TeamToolsPage />} />
            <Route path="/mcp" element={<McpConnectPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/tools/new" element={<AddProjectPage />} />
            <Route path="/tools/new/manual" element={<ToolFormPage />} />
            <Route path="/tools/:id" element={<ToolDetailPage />} />
            <Route path="/tools/:id/runs" element={<ToolDetailPage section="runs" />} />
            <Route path="/tools/:id/verify" element={<VerificationPage />} />
            <Route path="/tools/:id/context" element={<ProjectContextPage />} />
            <Route path="/tools/:id/edit" element={<ToolFormPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes></Suspense>
          </StudioShell>
        </OnboardingGate>
        </DesignProfilesProvider>
      </LibraryProvider>
    </AppUpdateProvider>
    </PrefsProvider>
  )
}
