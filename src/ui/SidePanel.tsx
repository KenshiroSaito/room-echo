// Right panel (spec 10-room-echo 3): room size, wall material, floor and view. Prepared rooms
// arrive in M3 and Listen in M2.

import { ROOM_SIZES, type RoomSize } from '../sim/grid';
import { FLOOR_MATERIALS, WALL_MATERIALS, type FloorMaterialId } from '../sim/materials';
import { useRoom } from '../state/store';
import { STRINGS } from '../strings';
import { SERIES } from '../styles/palette';
import controls from './controls.module.css';
import { ChevronIcon } from './icons';
import styles from './SidePanel.module.css';

const S = STRINGS.panel;
const SIZES: RoomSize[] = ['S', 'M', 'L'];

export function SidePanel() {
  const open = useRoom((s) => s.panelOpen);
  const setOpen = useRoom((s) => s.setPanelOpen);

  if (!open) {
    return (
      <button
        type="button"
        className={`${controls.panel} ${styles.tab}`}
        onClick={() => setOpen(true)}
        aria-label={S.show}
        title={S.show}
      >
        <ChevronIcon direction="left" />
      </button>
    );
  }

  return (
    <aside className={`${controls.panel} ${styles.panel}`} aria-label={S.label}>
      <button
        type="button"
        className={styles.hide}
        onClick={() => setOpen(false)}
        aria-label={S.hide}
        title={S.hide}
      >
        <ChevronIcon direction="right" size={18} />
      </button>
      <RoomSection />
      <MaterialSection />
      <FloorSection />
      <ViewSection />
    </aside>
  );
}

function RoomSection() {
  const size = useRoom((s) => s.size);
  const setSize = useRoom((s) => s.setSize);
  const clearWalls = useRoom((s) => s.clearWalls);
  const resetRoom = useRoom((s) => s.resetRoom);
  const hasWalls = useRoom((s) => s.walls.length > 0);
  const { widthM, heightM } = ROOM_SIZES[size];
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{S.room}</h2>
      <div className={styles.row}>
        <span className={controls.label}>{S.size}</span>
        <div className={controls.segmented} role="group" aria-label={S.size}>
          {SIZES.map((id) => (
            <button
              key={id}
              type="button"
              className={controls.segment}
              aria-pressed={size === id}
              onClick={() => setSize(id)}
            >
              {id}
            </button>
          ))}
        </div>
        <span className={controls.value}>{S.sizeDetail(widthM, heightM)}</span>
      </div>
      <div className={styles.buttons}>
        <button type="button" className={controls.button} onClick={clearWalls} disabled={!hasWalls}>
          {S.clearWalls}
        </button>
        <button type="button" className={controls.button} onClick={resetRoom}>
          {S.resetRoom}
        </button>
      </div>
    </section>
  );
}

function MaterialSection() {
  const material = useRoom((s) => s.material);
  const setMaterial = useRoom((s) => s.setMaterial);
  return (
    <section className={styles.section}>
      <h2 className={styles.heading} id="wall-material">
        {S.wallMaterial}
      </h2>
      <div className={styles.materials} role="radiogroup" aria-labelledby="wall-material">
        {WALL_MATERIALS.map((m, i) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={material === m.id}
            className={styles.material}
            onClick={() => setMaterial(m.id)}
          >
            <span className={controls.swatch} style={{ background: SERIES[i] }} />
            <span className={styles.materialName}>{STRINGS.materials[m.id]}</span>
            <span className={controls.value}>{S.alpha(m.alpha)}</span>
          </button>
        ))}
      </div>
      <p className={styles.note}>{S.wallMaterialNote}</p>
    </section>
  );
}

function FloorSection() {
  const floor = useRoom((s) => s.floor);
  const setFloor = useRoom((s) => s.setFloor);
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>
        <label htmlFor="floor">{S.floor}</label>
      </h2>
      <select
        id="floor"
        className={controls.select}
        value={floor}
        onChange={(e) => setFloor(e.target.value as FloorMaterialId)}
      >
        {FLOOR_MATERIALS.map((m) => (
          <option key={m.id} value={m.id}>
            {`${STRINGS.floors[m.id]} · ${S.alpha(m.alpha)}`}
          </option>
        ))}
      </select>
      <p className={styles.note}>{S.floorNote}</p>
    </section>
  );
}

function ViewSection() {
  const view = useRoom((s) => s.view);
  const setView = useRoom((s) => s.setView);
  const relief = useRoom((s) => s.relief);
  const setRelief = useRoom((s) => s.setRelief);
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{S.view}</h2>
      <div className={styles.row}>
        <div className={controls.segmented} role="group" aria-label={S.view}>
          <button
            type="button"
            className={controls.segment}
            aria-pressed={view === 'wave'}
            onClick={() => setView('wave')}
          >
            {S.wave}
          </button>
          <button
            type="button"
            className={controls.segment}
            aria-pressed={view === 'energy'}
            onClick={() => setView('energy')}
          >
            {S.energy}
          </button>
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={relief}
            disabled={view === 'energy'}
            onChange={(e) => setRelief(e.target.checked)}
          />
          {S.relief}
        </label>
      </div>
    </section>
  );
}
