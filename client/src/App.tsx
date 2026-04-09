import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Redirect } from "wouter";
import { lazy, Suspense, useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AdminRoute } from "./components/ProtectedRoute";
import { Loader2 } from "lucide-react";
import { loadSettings, applySettings } from "./lib/settings";

// 路由懒加载
const Home = lazy(() => import("./pages/Home"));
const ClawHome = lazy(() => import("./pages/ClawHome"));
const ClawAdmin = lazy(() => import("./pages/ClawAdmin"));
const Login = lazy(() => import("./pages/Login"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));

// 加载中组件
const LoadingFallback = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <p className="text-muted-foreground">加载中...</p>
    </div>
  </div>
);

function Router() {
  // 确保 light 主题
  useEffect(() => {
    loadSettings();
    applySettings({ themeMode: "light" });
  }, []);

  return (
    <Suspense fallback={<LoadingFallback />}>
      <Switch>
        {/* ── 首页 ── */}
        <Route path={"/"}>
          <ClawHome />
        </Route>

        {/* ── 管理控制台 ── */}
        <Route path={"/admin"}>
          <AdminRoute>
            <ClawAdmin />
          </AdminRoute>
        </Route>

        {/* ── 子虾控制台 ── */}
        <Route path={"/claw/:adoptId"}>
          <Home />
        </Route>

        {/* /scenarios 重定向到首页 */}
        <Route path={"/scenarios"}>
          <Redirect to="/" />
        </Route>
        <Route path={"/login"}>
          <Login />
        </Route>
        <Route path={"/reset-password"}>
          <ResetPassword />
        </Route>
        <Route path={"/404"}>
          <NotFound />
        </Route>
        <Route>
          <NotFound />
        </Route>
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
