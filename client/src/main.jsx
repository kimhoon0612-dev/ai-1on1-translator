import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import App from './App.jsx'
import './index.css'

// ⚠️ React.StrictMode 제거
// StrictMode는 개발 환경에서 useEffect를 2번 실행하여
// WebSocket/LiveKit 연결이 이중으로 생기고 즉시 끊기는 치명적 버그를 유발함
ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </ErrorBoundary>,
)

