import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import './index.css';
import AssistantTask from './pages/AssistantTask';
import { router } from './app/routes';
import { startRuntime } from './state/runtime';

const assistantView=window.location.pathname==='/assistant-task';
if(!assistantView)startRuntime();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {assistantView?<AssistantTask/>:<RouterProvider router={router} />}
  </StrictMode>,
);
