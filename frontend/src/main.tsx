import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import FinanceDashboard from './dashboard';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><FinanceDashboard /></StrictMode>);
