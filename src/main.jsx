import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { auth } from './firebase'; // Ensure this path is correct

const root = ReactDOM.createRoot(document.getElementById('root'));

// This listener ensures the app only renders once Firebase knows who the user is
auth.onAuthStateChanged((user) => {
  root.render(
    <React.StrictMode>
      <App user={user} />
    </React.StrictMode>
  );
});