import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import SimpleChat from './SimpleChat';
import './index.css';

// Check if we should show simple chat based on URL param
const urlParams = new URLSearchParams(window.location.search);
const useSimpleChat = urlParams.has('simple');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {useSimpleChat ? <SimpleChat /> : <App />}
  </React.StrictMode>
);
