import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppShell from './AppShell';
import Today from '../pages/Today';
import Assistant from '../pages/Assistant';
import Staff from '../pages/Staff';
import Connections from '../pages/Connections';
import Approvals from '../pages/Approvals';
import Schedule from '../pages/Schedule';
import Travel from '../pages/Travel';
import Knowledge from '../pages/Knowledge';
import Skills from '../pages/Skills';
import Artifacts from '../pages/Artifacts';
import Usage from '../pages/Usage';
import Settings from '../pages/Settings';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/today" replace /> },
      { path: 'today', element: <Today /> },
      { path: 'assistant', element: <Assistant /> },
      { path: 'staff', element: <Staff /> },
      { path: 'connections', element: <Connections /> },
      { path: 'approvals', element: <Approvals /> },
      { path: 'schedule', element: <Schedule /> },
      { path: 'travel', element: <Travel /> },
      { path: 'knowledge', element: <Knowledge /> },
      { path: 'skills', element: <Skills /> },
      { path: 'artifacts', element: <Artifacts /> },
      { path: 'usage', element: <Usage /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);
