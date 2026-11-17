// Placeholder entry for M0. The editor and the canvas arrive in M1.
import './styles/tokens.css';
import { STRINGS } from './strings';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.style.cssText = 'max-width: 560px; margin: 0 auto; padding: 96px 24px;';
  const title = document.createElement('h1');
  title.textContent = STRINGS.appTitle;
  title.style.cssText = 'font-size: var(--size-heading); font-weight: 600; margin: 0 0 8px;';
  const lead = document.createElement('p');
  lead.textContent = STRINGS.home.lead;
  lead.style.cssText = 'color: var(--text-2); margin: 0 0 16px;';
  const link = document.createElement('a');
  link.href = '/bench/';
  link.textContent = STRINGS.home.benchLink;
  link.style.cssText = 'color: var(--text-1);';
  app.append(title, lead, link);
}
