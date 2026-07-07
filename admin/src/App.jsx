import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './state/AuthContext.jsx'
import { ToastProvider } from './state/ToastContext.jsx'
import { AgentProvider } from './state/AgentContext.jsx'
import LoginPage from './pages/LoginPage.jsx'
import DashboardLayout from './pages/DashboardLayout.jsx'
import AgentTreeView from './pages/AgentTreeView.jsx'
import DownlineList from './pages/DownlineList.jsx'
import CreditGrantPanel from './pages/CreditGrantPanel.jsx'

// 路由守卫：未登录一律打回 /login
function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

function AuthedShell() {
  return (
    <AgentProvider>
      <DashboardLayout />
    </AgentProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AuthedShell />
              </RequireAuth>
            }
          >
            <Route index element={<AgentTreeView />} />
            <Route path="downline" element={<DownlineList />} />
            <Route path="credit" element={<CreditGrantPanel />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  )
}
