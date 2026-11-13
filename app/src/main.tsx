import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import './index.css';
import { loadBoxIdentity } from './config';

async function mount() {
  await loadBoxIdentity();
  const [{ default: AssistantTask }, { router }, { startRuntime }] = await Promise.all([
    import('./pages/AssistantTask'), import('./app/routes'), import('./state/runtime'),
  ]);
  const assistantView=window.location.pathname==='/assistant-task';
  if(!assistantView)startRuntime();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {assistantView?<AssistantTask/>:<RouterProvider router={router} />}
    </StrictMode>,
  );
}
void mount();
