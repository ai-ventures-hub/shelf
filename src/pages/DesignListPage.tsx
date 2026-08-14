/**
 * Design profiles list: card per profile (palette strip, fonts, counts) plus
 * a dashed create card. Creation seeds STARTER_TOKENS so the editor never
 * opens empty.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  NewProfileWizard,
  type NewProfileInput,
} from '../components/design/NewProfileWizard'
import { useDesignProfiles } from '../hooks/useDesignProfiles'
import { useLibrary } from '../hooks/useLibrary'
import { colorLeaves, leavesOf } from '../lib/designTokens'
import type { DesignProfile } from '../types'

/** Accent colors first — a strip of six grays sells no brand. */
const SWATCH_PRIORITY = ['brand', 'primary', 'accent', 'danger', 'success', 'warning']

function orderSwatches(leaves: ReturnType<typeof colorLeaves>) {
  const rank = (path: string): number => {
    const name = path.replace(/^color\./, '')
    const hit = SWATCH_PRIORITY.findIndex((p) => name === p || name.startsWith(`${p}-`))
    return hit === -1 ? SWATCH_PRIORITY.length : hit
  }
  return leaves.slice().sort((a, b) => rank(a.path) - rank(b.path))
}

function DesignProfileCard({
  profile,
  boundCollections,
  onOpen,
}: {
  profile: DesignProfile
  /** Names of collections bound to this profile — where the brand applies. */
  boundCollections: string[]
  onOpen: () => void
}) {
  const swatches = orderSwatches(colorLeaves(profile.tokens)).slice(0, 6)
  const families = leavesOf(profile.tokens, 'typography.font-family')
    .map((leaf) => String(leaf.value).split(',')[0].trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  const colorCount = colorLeaves(profile.tokens).length

  return (
    <button type="button" className="design-card" onClick={onOpen}>
      <div className="design-card-head">
        <strong className="design-card-name">{profile.name}</strong>
        {profile.isDefault ? <span className="tag-chip">Default</span> : null}
        {profile.origin === 'agent' ? (
          <span className="tag-chip" title={profile.sourceNote || 'Created by an agent over MCP'}>
            From agent
          </span>
        ) : null}
      </div>
      <div className="design-card-palette">
        {swatches.map((leaf) => (
          <span
            key={leaf.path}
            className="design-swatch"
            title={leaf.path.replace(/^color\./, '')}
            style={{ background: String(leaf.value) }}
          />
        ))}
        {swatches.length === 0 ? <span className="design-card-meta">No colors yet</span> : null}
      </div>
      {families.length > 0 ? (
        <p className="design-card-fonts">{families.join(' · ')}</p>
      ) : null}
      <p className="design-card-meta">
        {colorCount} color{colorCount === 1 ? '' : 's'} · {profile.assets.length} asset
        {profile.assets.length === 1 ? '' : 's'}
      </p>
      {boundCollections.length > 0 ? (
        <p
          className="design-card-meta"
          title="Agents building for tools in these collections resolve this profile"
        >
          Used by {boundCollections.join(' · ')}
        </p>
      ) : null}
    </button>
  )
}

export function DesignListPage() {
  const navigate = useNavigate()
  const { profiles, loading, error, saveProfile } = useDesignProfiles()
  const { collections } = useLibrary()
  const [promptOpen, setPromptOpen] = useState(false)

  async function createProfile(input: NewProfileInput) {
    // Thrown errors surface inside the wizard, which stays open for a retry.
    const saved = await saveProfile(input)
    setPromptOpen(false)
    navigate(`/design/${saved.id}`)
  }

  return (
    <>
      <header className="page-header">
        <div className="page-header-copy">
          <p className="eyebrow">Design</p>
          <h1 className="page-title">Design profiles</h1>
          <p className="page-lede">
            Your brand's source of truth — colors, type, voice, and assets. Connected agents
            pull the default profile when you say “use my branding.”
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setPromptOpen(true)}>
          New profile
        </button>
      </header>

      {error ? (
        <div className="warning-card" role="alert">
          {error}
        </div>
      ) : null}

      {!loading && profiles.length === 0 ? (
        <div className="empty-state">
          <div>
            <h2>No design profiles yet</h2>
            <p>
              A profile holds your brand colors, typography, voice, and logo assets. Ask any
              connected agent to “build it with my branding” and it pulls the default profile
              automatically.
            </p>
            <div className="empty-state-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setPromptOpen(true)}
              >
                Create your first profile
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="design-grid">
          {profiles.map((profile) => (
            <DesignProfileCard
              key={profile.id}
              profile={profile}
              boundCollections={collections
                .filter((collection) => collection.designProfileId === profile.id)
                .map((collection) => collection.name)}
              onOpen={() => navigate(`/design/${profile.id}`)}
            />
          ))}
          <button
            type="button"
            className="design-card design-card-new"
            onClick={() => setPromptOpen(true)}
          >
            + New profile
          </button>
        </div>
      )}

      <NewProfileWizard
        open={promptOpen}
        onCancel={() => setPromptOpen(false)}
        onCreate={createProfile}
      />
    </>
  )
}
