// Tools on the left (spec 10-room-echo 3): Wall, Erase, Source, and undo. The Listener tool
// arrives with listening in M2.

import { useRoom, type Tool } from '../state/store';
import { STRINGS } from '../strings';
import controls from './controls.module.css';
import { EraseIcon, RedoIcon, SourceIcon, UndoIcon, WallIcon } from './icons';
import styles from './Toolbar.module.css';

const S = STRINGS.tools;

const TOOLS: { id: Tool; label: string; tip: string; Icon: typeof WallIcon }[] = [
  { id: 'wall', label: S.wall, tip: S.wallTip, Icon: WallIcon },
  { id: 'erase', label: S.erase, tip: S.eraseTip, Icon: EraseIcon },
  { id: 'source', label: S.source, tip: S.sourceTip, Icon: SourceIcon },
];

export function Toolbar() {
  const tool = useRoom((s) => s.tool);
  const setTool = useRoom((s) => s.setTool);
  const canUndo = useRoom((s) => s.past.length > 0);
  const canRedo = useRoom((s) => s.future.length > 0);
  const undo = useRoom((s) => s.undo);
  const redo = useRoom((s) => s.redo);

  return (
    <nav className={`${controls.panel} ${styles.toolbar}`} aria-label={S.label}>
      {TOOLS.map(({ id, label, tip, Icon }) => (
        <button
          key={id}
          type="button"
          className={styles.tool}
          aria-pressed={tool === id}
          title={tip}
          onClick={() => setTool(id)}
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
      <div className={styles.rule} />
      <div className={styles.history}>
        <button
          type="button"
          className={styles.small}
          onClick={undo}
          disabled={!canUndo}
          title={S.undoTip}
          aria-label={S.undo}
        >
          <UndoIcon size={18} />
        </button>
        <button
          type="button"
          className={styles.small}
          onClick={redo}
          disabled={!canRedo}
          title={S.redoTip}
          aria-label={S.redo}
        >
          <RedoIcon size={18} />
        </button>
      </div>
    </nav>
  );
}
