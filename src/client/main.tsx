import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { AuthProvider } from './auth';
import { CartProvider } from './cart';
import { I18nProvider } from './i18n';
import { LiveProvider } from './live';
import { SettingsProvider } from './settings';
import { ThemeProvider } from './theme';
import './styles.css';
import './features.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <BrowserRouter>
          <SettingsProvider>
            <AuthProvider>
              <LiveProvider>
                <CartProvider>
                  <App />
                </CartProvider>
              </LiveProvider>
            </AuthProvider>
          </SettingsProvider>
        </BrowserRouter>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
