import { createRoot } from 'react-dom/client';
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-500.css';
import '@fontsource/roboto/latin-700.css';
import { GpxExplorer } from '@/components/gpx-explorer';
import './app/globals.css';

createRoot(document.getElementById('root')!).render(<GpxExplorer />);
