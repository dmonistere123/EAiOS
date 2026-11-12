import Ticker from '../pages/Ticker';
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
import Podcasts from '../pages/Podcasts';
import SocialMedia from '../pages/SocialMedia';
import Skills from '../pages/Skills';
import Artifacts from '../pages/Artifacts';
import Usage from '../pages/Usage';
import ExecutiveInsights from '../pages/ExecutiveInsights';
import Settings from '../pages/Settings';
import Backup from '../pages/Backup';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/today" replace /> },
      { path: 'today', element: <Today /> },
      { path: 'assistant', element: <Assistant /> },
      { path: 'staff', element: <Staff key="staff" /> },
      { path: 'human-assistant', element: <Staff key="human" humanOnly /> },
      { path: 'connections', element: <Connections /> },
      { path: 'approvals', element: <Approvals /> },
      { path: 'schedule', element: <Schedule /> },
      { path: 'travel', element: <Travel /> },
      { path: 'knowledge', element: <Knowledge /> },
      { path: 'podcasts', element: <Podcasts /> },
      { path: 'social', element: <SocialMedia /> },
      { path: 'skills', element: <Skills /> },
      { path: 'artifacts', element: <Artifacts /> },
      { path: 'usage', element: <Usage /> },
      { path: 'insights', element: <ExecutiveInsights /> },
      { path: 'backup', element: <Backup /> },
      { path: 'ticker', element: <Ticker /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);
