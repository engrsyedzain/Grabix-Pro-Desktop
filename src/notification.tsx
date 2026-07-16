import React from 'react';
import ReactDOM from 'react-dom/client';
import NotificationStack from './components/NotificationStack';
import './index.css';
// Must come after index.css: it undoes that file's main-window page styling,
// which would otherwise paint an opaque box behind the cards.
import './notification.css';

// No ToastProvider and no App: this entry renders into the separate `notify`
// window, which exists only to draw the download cards.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <NotificationStack />
  </React.StrictMode>,
);
