// Top bar (spec 00-common 4.4). Tour, Explain, Copy link and Save image arrive in M3.

import { STRINGS } from '../strings';
import styles from './TopBar.module.css';

export function TopBar() {
  return (
    <header className={styles.bar}>
      <h1 className={styles.title}>{STRINGS.appTitle}</h1>
    </header>
  );
}
