import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { AdminRoute, OperadorRoute, RepRoute, OrcEditorRoute } from '@/routes/guards';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import OrcamentosPage from '@/pages/OrcamentosPage';
import PedidosPage from '@/pages/PedidosPage';
import ClientesPage from '@/pages/ClientesPage';
import FinanceiroPage from '@/pages/FinanceiroPage';
import PerfilPage from '@/pages/PerfilPage';
import AlertasPage from '@/pages/AlertasPage';
import AprovacoesPage from '@/pages/AprovacoesPage';
import NovoOrcamentoPage from '@/pages/NovoOrcamentoPage';
import EditarOrcamentoPage from '@/pages/EditarOrcamentoPage';
import AdminRepresentantesPage from '@/pages/admin/RepresentantesPage';
import AdminUsuariosPage from '@/pages/admin/UsuariosPage';
import AdminGruposPage from '@/pages/admin/GruposPage';
import AcompanhamentoPage from '@/pages/AcompanhamentoPage';
import Layout from '@/components/layout/Layout';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

function AppRoutes() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-green-900 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 text-sm">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Login renderiza em qualquer caminho SEM redirecionar para /login —
    // a URL permanece limpa (ex.: raiz do domínio) e o caminho de destino
    // é preservado até depois do login.
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />

        {/* Compartilhadas */}
        <Route path="dashboard"  element={<DashboardPage />} />
        <Route path="pedidos"    element={<PedidosPage />} />
        <Route path="perfil"     element={<PerfilPage />} />
        <Route path="alertas"    element={<AlertasPage />} />

        {/* Operador + Admin */}
        <Route path="aprovacoes" element={<OperadorRoute><AprovacoesPage /></OperadorRoute>} />

        {/* Apenas representantes */}
        <Route path="orcamentos"       element={<RepRoute><OrcamentosPage /></RepRoute>} />
        <Route path="orcamentos/novo"       element={<OrcEditorRoute><NovoOrcamentoPage /></OrcEditorRoute>} />
        <Route path="orcamentos/:id/editar" element={<OrcEditorRoute><EditarOrcamentoPage /></OrcEditorRoute>} />
        <Route path="acompanhamento" element={<RepRoute><AcompanhamentoPage /></RepRoute>} />
        <Route path="clientes"   element={<RepRoute><ClientesPage /></RepRoute>} />
        <Route path="financeiro" element={<RepRoute><FinanceiroPage /></RepRoute>} />

        {/* Apenas admin */}
        <Route path="admin/representantes" element={<AdminRoute><AdminRepresentantesPage /></AdminRoute>} />
        <Route path="admin/usuarios"       element={<AdminRoute><AdminUsuariosPage /></AdminRoute>} />
        <Route path="admin/grupos"         element={<AdminRoute><AdminGruposPage /></AdminRoute>} />
      </Route>
      {/* Já autenticado: qualquer rota desconhecida (inclusive /login) → dashboard */}
      <Route path="*"      element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* BrowserRouter: navegação com History API — voltar/avançar do navegador e
          do mouse funcionam dentro do app, e as URLs viram deep-links reais
          (compartilháveis e resistentes a F5; o rewrite SPA da Vercel cobre o refresh
          em qualquer caminho). Acesso continua protegido por guardas + RLS no banco. */}
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
