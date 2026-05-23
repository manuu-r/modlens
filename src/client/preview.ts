type PreviewDevvitGlobal = {
  token?: string;
  entrypoints?: Record<string, string>;
};

function requestExpandedApp(event: MouseEvent): void {
  const webview = globalThis.devvit as unknown as PreviewDevvitGlobal | undefined;
  if (!event.isTrusted || event.type !== 'click') {
    throw new Error('Expanded mode requires a trusted click.');
  }
  if (!webview?.entrypoints?.app) {
    throw new Error('Missing ModLens expanded entrypoint.');
  }

  const url = new URL(webview.entrypoints.app);
  if (webview.token) {
    url.searchParams.set('token', webview.token);
  }

  parent.postMessage(
    {
      type: 'devvit-internal',
      scope: 0,
      immersiveMode: {
        entryUrl: `${url}`,
        immersiveMode: 2,
      },
    },
    '*',
  );
}

const button = document.querySelector<HTMLButtonElement>('#open-modlens');

button?.addEventListener('click', (event) => {
  button.disabled = true;
  button.textContent = 'Opening...';
  try {
    requestExpandedApp(event);
  } catch (error) {
    console.error('Failed to open ModLens expanded mode', error);
    button.disabled = false;
    button.textContent = 'Open ModLens';
  }
});
