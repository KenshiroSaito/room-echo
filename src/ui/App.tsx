// The page (spec 00-common 4.4, spec 10-room-echo 3): the canvas fills the window and the
// panels float over it.

import { useEffect, useRef, useState } from 'react';
import { Engine } from '../app/engine';
import { requestGpu, type GpuContext } from '../gpu/solver';
import { domainCm } from '../sim/walls';
import { useStats } from '../state/stats';
import { useRoom } from '../state/store';
import { STRINGS } from '../strings';
import styles from './App.module.css';
import { BottomStrip } from './BottomStrip';
import { layoutStage } from './layout';
import { SidePanel } from './SidePanel';
import { Stage } from './Stage';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';

/** Hooks for the Playwright tests, present only with ?test in the URL. */
interface TestHooks {
  engine: Engine;
  room: typeof useRoom;
  stats: typeof useStats;
}

declare global {
  interface Window {
    __roomEcho?: TestHooks;
  }
}

/** Largest device-pixel ratio the canvas uses; more costs GPU time without a visible gain. */
const MAX_PIXEL_RATIO = 2;

export function App() {
  const [gpu, setGpu] = useState<GpuContext | null | undefined>(undefined);
  useEffect(() => {
    requestGpu()
      .then(setGpu)
      .catch(() => setGpu(null));
  }, []);
  if (gpu === undefined) return <div className={styles.root} />;
  if (gpu === null) return <NoWebGpu />;
  return <Room gpu={gpu} />;
}

function Room({ gpu }: { gpu: GpuContext }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRoom((s) => s.size);
  const panelOpen = useRoom((s) => s.panelOpen);

  // The engine lives as long as the page.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const engine = new Engine(gpu, element);
    engine.start();
    if (new URLSearchParams(location.search).has('test')) {
      window.__roomEcho = { engine, room: useRoom, stats: useStats };
    }
    return () => {
      engine.destroy();
      delete window.__roomEcho;
    };
  }, [gpu]);

  // Canvas resolution and the stage rectangle follow the window.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const update = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      element.width = Math.round(element.clientWidth * ratio);
      element.height = Math.round(element.clientHeight * ratio);
      const [w, h] = domainCm(size);
      useRoom
        .getState()
        .setStage(layoutStage(window.innerWidth, window.innerHeight, w / h, panelOpen));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [size, panelOpen]);

  useKeyboardShortcuts();

  return (
    <div className={styles.root}>
      <canvas ref={canvas} className={styles.canvas} aria-label={STRINGS.appTitle} />
      <Stage />
      <TopBar />
      <Toolbar />
      <SidePanel />
      <BottomStrip />
    </div>
  );
}

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      const room = useRoom.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) room.redo();
        else room.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        room.redo();
      } else if (mod || e.altKey) {
        return;
      } else if (key === 'w') {
        room.setTool('wall');
      } else if (key === 'e') {
        room.setTool('erase');
      } else if (key === 's') {
        room.setTool('source');
      } else if (key === 'c') {
        room.clap(undefined, true);
      } else if (e.key === ' ') {
        // Space on a focused button presses it; only take it when nothing is focused.
        if (target && target.tagName === 'BUTTON') return;
        e.preventDefault();
        room.setPlaying(!room.playing);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function NoWebGpu() {
  return (
    <div className={styles.message}>
      <h1>{STRINGS.noWebGpu.title}</h1>
      <p>{STRINGS.noWebGpu.body}</p>
    </div>
  );
}
