import { type ReactElement, type ReactNode } from 'react';
import { render as testingLibraryRender, type RenderOptions } from '@testing-library/react';
import { ConfirmProvider } from '../components/ConfirmProvider.js';
import { DialogInteractionProvider } from '../components/DialogLayer.js';

function Providers({ children }: { children: ReactNode }) {
  return <DialogInteractionProvider><ConfirmProvider>{children}</ConfirmProvider></DialogInteractionProvider>;
}

export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return testingLibraryRender(ui, { wrapper: Providers, ...options });
}
