import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import TitleBar from "./components/TitleBar";
import { LanguageProvider } from "./contexts/LanguageContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";


function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// Visual direction: “加密索引库” — a graphite desktop workbench with restrained index-purple state cues.

function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
      <ThemeProvider
        defaultTheme="dark"
        // switchable
      >
        <TooltipProvider>
          {/* The OS title bar is replaced by TitleBar, so the shell owns the full
              window height and every screen scrolls inside this column. */}
          <div className="flex h-screen flex-col overflow-hidden bg-[#08080a]">
            <TitleBar />
            <div className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto">
              <Router />
            </div>
          </div>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}

export default App;
