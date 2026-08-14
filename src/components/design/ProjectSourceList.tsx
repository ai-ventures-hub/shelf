/**
 * Project chooser shared by the Import dialog and the new-profile wizard:
 * registered tools that have a project folder, plus a native folder picker.
 */
import { useLibrary } from '../../hooks/useLibrary'

interface ProjectSourceListProps {
  onPick: (projectPath: string) => void
}

export function ProjectSourceList({ onPick }: ProjectSourceListProps) {
  const { tools } = useLibrary()
  const projects = tools.filter((tool) => tool.projectPath)

  return (
    <>
      {projects.length > 0 ? (
        <div className="import-tokens-sources" role="list">
          {projects.map((tool) => (
            <button
              key={tool.id}
              type="button"
              role="listitem"
              className="quick-open-row"
              onClick={() => onPick(tool.projectPath!)}
            >
              <span className="quick-open-row-main">
                <span className="quick-open-row-title">{tool.name}</span>
                <span className="quick-open-row-sub">{tool.projectPath}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="field-hint" style={{ margin: 0 }}>
          No registered tools have a project folder — choose one below.
        </p>
      )}
      <div className="action-row" style={{ marginTop: '.75rem' }}>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() =>
            void window.shelf.pickFolder().then((folder) => {
              if (folder) onPick(folder)
            })
          }
        >
          Choose folder…
        </button>
      </div>
    </>
  )
}
