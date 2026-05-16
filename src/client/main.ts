import { getBootstrap, type BootstrapResponse } from './api';
import { Shell } from './ui/Shell';

declare global {
  interface Window {
    modContext?: BootstrapResponse;
  }
}

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Missing #app mount point');
}

const shell = new Shell(app);
shell.render();

getBootstrap()
  .then((context) => {
    window.modContext = context;
    shell.setContext(context);
  })
  .catch((error: unknown) => {
    shell.setError(error instanceof Error ? error.message : 'Failed to load ModLens context');
  });
