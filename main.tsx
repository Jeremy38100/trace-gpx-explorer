import { createRoot } from 'react-dom/client';
import { GpxExplorer } from '@/components/gpx-explorer';
import './app/globals.css';

createRoot(document.getElementById('root')!).render(<GpxExplorer />);
