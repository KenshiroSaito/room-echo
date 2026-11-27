// Bottom strip (spec 10-room-echo 3): source type, tone frequency, display speed and play/pause.
// The response waveform and RT60 on its right arrive with listening in M2.

import { useState } from 'react';
import { SLOWDOWNS, formatSlowdown } from '../sim/display';
import { TONE_MAX_HZ, TONE_MIN_HZ } from '../sim/sources';
import { useRoom } from '../state/store';
import { STRINGS } from '../strings';
import controls from './controls.module.css';
import { PauseIcon, PlayIcon } from './icons';
import styles from './BottomStrip.module.css';

const S = STRINGS.strip;
const LOG_MIN = Math.log(TONE_MIN_HZ);
const LOG_MAX = Math.log(TONE_MAX_HZ);

export function BottomStrip() {
  const sourceType = useRoom((s) => s.sourceType);
  const setSourceType = useRoom((s) => s.setSourceType);
  const clap = useRoom((s) => s.clap);
  const slowdown = useRoom((s) => s.slowdown);
  const setSlowdown = useRoom((s) => s.setSlowdown);
  const playing = useRoom((s) => s.playing);
  const setPlaying = useRoom((s) => s.setPlaying);
  const speedIndex = Math.max(0, SLOWDOWNS.indexOf(slowdown as (typeof SLOWDOWNS)[number]));

  return (
    <footer className={`${controls.panel} ${styles.strip}`} aria-label={S.label}>
      <div className={styles.group}>
        <span className={controls.label}>{S.source}</span>
        <div className={controls.segmented} role="group" aria-label={S.source}>
          <button
            type="button"
            className={controls.segment}
            aria-pressed={sourceType === 'clap'}
            onClick={() => setSourceType('clap')}
          >
            {S.clap}
          </button>
          <button
            type="button"
            className={controls.segment}
            aria-pressed={sourceType === 'tone'}
            onClick={() => setSourceType('tone')}
          >
            {S.tone}
          </button>
        </div>
      </div>

      <div className={`${styles.group} ${styles.sourceDetail}`}>
        {sourceType === 'clap' ? (
          <button
            type="button"
            className={controls.button}
            onClick={() => clap(undefined, true)}
            title={S.clapAgainTip}
          >
            {S.clapAgain}
          </button>
        ) : (
          <ToneFrequency />
        )}
      </div>

      <div className={`${styles.group} ${styles.speed}`}>
        <label className={controls.label} htmlFor="speed">
          {S.speed}
        </label>
        <input
          id="speed"
          type="range"
          className={controls.slider}
          min={0}
          max={SLOWDOWNS.length - 1}
          step={1}
          value={speedIndex}
          aria-valuetext={formatSlowdown(slowdown)}
          onChange={(e) => setSlowdown(SLOWDOWNS[Number(e.target.value)])}
        />
        <span className={`${controls.value} ${styles.speedValue}`}>{formatSlowdown(slowdown)}</span>
        <button
          type="button"
          className={`${controls.button} ${styles.play}`}
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? S.pause : S.play}
          title={S.playTip}
        >
          {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        </button>
      </div>
    </footer>
  );
}

function ToneFrequency() {
  const toneHz = useRoom((s) => s.toneHz);
  const setToneHz = useRoom((s) => s.setToneHz);
  const [draft, setDraft] = useState(String(toneHz));
  // When the frequency changes elsewhere (the slider), show it in the box.
  const [shown, setShown] = useState(toneHz);
  if (shown !== toneHz) {
    setShown(toneHz);
    setDraft(String(toneHz));
  }

  const commit = () => {
    const hz = Number(draft);
    if (Number.isFinite(hz) && hz > 0) setToneHz(hz);
    else setDraft(String(toneHz));
  };

  return (
    <>
      <label className={controls.label} htmlFor="tone-slider">
        {S.frequency}
      </label>
      <input
        id="tone-slider"
        type="range"
        className={`${controls.slider} ${styles.toneSlider}`}
        min={LOG_MIN}
        max={LOG_MAX}
        step={0.001}
        value={Math.log(toneHz)}
        aria-valuetext={`${toneHz} ${S.hz}`}
        onChange={(e) => setToneHz(Math.round(Math.exp(Number(e.target.value))))}
      />
      <input
        type="number"
        className={controls.number}
        min={TONE_MIN_HZ}
        max={TONE_MAX_HZ}
        step={0.1}
        value={draft}
        aria-label={`${S.frequency} (${S.hz})`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      <span className={controls.label}>{S.hz}</span>
    </>
  );
}
